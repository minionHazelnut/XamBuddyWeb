from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from typing import Optional, Literal
import json
import os
import re
import random
import logging
import urllib.request
import urllib.parse
import uuid
from datetime import datetime
from pypdf import PdfReader
import io
import anthropic

logger = logging.getLogger(__name__)

app = FastAPI(title="XamBuddy API")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
    )

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://klfekdsdosqpymxcikjw.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "") or os.environ.get("CLAUDE_API_KEY", "")

# ---------- Supabase REST helpers ----------

def _sb_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

def _sb_get(table, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=_sb_headers())
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())

def _sb_patch(table, id_val, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{id_val}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=_sb_headers(), method="PATCH")
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()

def _sb_delete(table, id_val):
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{id_val}"
    req = urllib.request.Request(url, headers=_sb_headers(), method="DELETE")
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()

def _sb_post(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=_sb_headers(), method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()

# ---------- Error logging ----------

def _log_error(endpoint: str, stage: str, error: str, context: dict = None):
    try:
        _sb_post("processing_errors", [{
            "endpoint": endpoint,
            "stage": stage,
            "error_message": error,
            "context_json": context or {},
        }])
    except Exception:
        pass

# ---------- Question helpers ----------

def _difficulty_for_db(difficulty: str) -> str:
    return "medium" if difficulty == "mixed" else difficulty

def _question_type_for_db(q_type: str, item: dict) -> str:
    if q_type in ("mixed", "cbq"):
        return item.get("question_type") or q_type
    if q_type == "conceptual":
        return "long"
    return q_type

def _exact_question_fingerprint(text: str) -> str:
    s = (text or "").strip().lower()
    return re.sub(r"\s+", " ", s)

def _jaccard(a: str, b: str) -> float:
    sa, sb = set(a.split()), set(b.split())
    union = sa | sb
    return len(sa & sb) / len(union) if union else 0.0

def _too_similar_to_existing(norm: str, existing: set, threshold: float = 0.8) -> bool:
    for ex in existing:
        if _jaccard(norm, ex) >= threshold:
            return True
    return False

def _ai_item_is_clean_for_db(q: dict, row_type: str) -> bool:
    # CBQ items are structured differently
    if row_type == "cbq":
        passage = (q.get("passage") or "").strip()
        subs = q.get("sub_questions")
        return len(passage) >= 20 and isinstance(subs, list) and len(subs) >= 1

    qt = (q.get("question") or "").strip()
    if len(qt) < 3 or qt[0] in "[{" or "```" in qt:
        return False
    low = qt[:80].lower()
    if low.startswith('"question"') or low.startswith("'question'"):
        return False
    if row_type == "mcq":
        opts = q.get("options")
        if not isinstance(opts, dict) or len(opts) < 4:
            return False
        ans = (q.get("answer") or "").strip().upper()
        if ans not in ("A", "B", "C", "D"):
            return False
    if row_type in ("short", "long", "conceptual"):
        ans = (q.get("answer") or "").strip()
        if len(ans) < 20:
            return False
    if row_type == "vsa":
        ans = (q.get("answer") or "").strip()
        if len(ans) < 5:
            return False
    return True

def _get_existing_fingerprints(exam, subject, chapter_db):
    params = {
        "select": "question_text",
        "exam": f"eq.{exam}",
        "subject": f"eq.{subject}",
        "limit": 1000,
    }
    if chapter_db:
        params["chapter"] = f"eq.{chapter_db}"
    else:
        params["chapter"] = "is.null"
    try:
        rows = _sb_get("questions", params)
        return {_exact_question_fingerprint(r["question_text"]) for r in rows}
    except Exception:
        return set()

def _get_existing_exam_question_fingerprints(subject, class_level, board):
    params = {
        "select": "question_text",
        "subject": f"eq.{subject}",
        "class_level": f"eq.{class_level}",
        "board": f"eq.{board}",
        "limit": 2000,
    }
    try:
        rows = _sb_get("exam_questions", params)
        return {_exact_question_fingerprint(r["question_text"]) for r in rows}
    except Exception:
        return set()

def _save_exam_questions(questions, subject, class_level, board, year, exam_type, source_paper_id):
    existing = _get_existing_exam_question_fingerprints(subject, class_level, board)
    type_map = {"MCQ": "mcq", "VSA": "vsa", "SA": "sa", "LA": "la", "CBQ": "cbq"}
    to_insert = []
    skipped = 0
    for q in questions:
        qtext = (q.get("question_text") or "").strip()
        if not qtext or len(qtext) < 5:
            continue
        norm = _exact_question_fingerprint(qtext)
        if norm in existing or _too_similar_to_existing(norm, existing):
            skipped += 1
            continue
        q_type_raw = (q.get("question_type") or "").upper()
        marks = q.get("marks")
        try:
            marks = int(marks) if marks is not None else None
        except (ValueError, TypeError):
            marks = None
        row = {
            "question_text": qtext,
            "question_type": type_map.get(q_type_raw, q_type_raw.lower()) or None,
            "marks": marks,
            "subject": subject,
            "class_level": class_level,
            "board": board,
            "year": year,
            "exam_type": exam_type,
            "chapter": q.get("chapter") or None,
            "correct_answer": None,
            "options_json": q.get("options") or None,
            "difficulty_level": (q.get("difficulty_level") or "").lower() or None,
            "answer_pending": True,
            "source_paper_id": source_paper_id,
        }
        to_insert.append(row)
        existing.add(norm)
    if to_insert:
        _sb_post("exam_questions", to_insert)
    return len(to_insert), skipped

def save_questions(questions, q_type, difficulty, subject, exam, chapter="", source_chapter_id=None):
    diff_db = _difficulty_for_db(difficulty)
    chapter_db = chapter.strip() or None
    existing = _get_existing_fingerprints(exam, subject, chapter_db)
    to_insert = []
    for q in questions:
        row_type = _question_type_for_db(q_type, q)

        # CBQ: store passage as question_text, sub_questions in options JSON
        if row_type == "cbq":
            if not _ai_item_is_clean_for_db(q, row_type):
                continue
            passage = (q.get("passage") or "").strip()
            norm = _exact_question_fingerprint(passage)
            if not norm or norm in existing or _too_similar_to_existing(norm, existing):
                continue
            row = {
                "exam": exam,
                "subject": subject,
                "chapter": chapter_db,
                "question_text": passage,
                "question_type": "cbq",
                "difficulty": diff_db,
                "correct_answer": None,
                "explanation": None,
                "options": {"sub_questions": q.get("sub_questions", [])},
                "keywords_json": q.get("keywords") or [],
                "is_practical": bool(q.get("is_practical", False)),
                "source_chapter_id": source_chapter_id,
            }
            to_insert.append(row)
            existing.add(norm)
            continue

        qtext_raw = q.get("question") or ""
        if not _ai_item_is_clean_for_db(q, row_type):
            continue
        norm = _exact_question_fingerprint(qtext_raw)
        if not norm or norm in existing or _too_similar_to_existing(norm, existing):
            continue
        row = {
            "exam": exam,
            "subject": subject,
            "chapter": chapter_db,
            "question_text": qtext_raw.strip(),
            "question_type": row_type,
            "difficulty": diff_db,
            "correct_answer": str(q["answer"]) if q.get("answer") is not None else None,
            "explanation": str(q["explanation"]) if q.get("explanation") else None,
            "keywords_json": q.get("keywords") or [],
            "is_practical": bool(q.get("is_practical", False)),
            "source_chapter_id": source_chapter_id,
        }
        if row_type == "mcq" and q.get("options") is not None:
            row["options"] = q["options"]
        to_insert.append(row)
        existing.add(norm)
    if to_insert:
        _sb_post("questions", to_insert)

def get_cached_questions(q_type, difficulty, subject, exam, chapter, limit):
    if limit <= 0:
        return []
    diff_db = _difficulty_for_db(difficulty)
    chapter_db = chapter.strip() or None
    params = {
        "select": "question_text,question_type,correct_answer,explanation,options",
        "exam": f"eq.{exam}",
        "subject": f"eq.{subject}",
        "difficulty": f"eq.{diff_db}",
        "limit": limit,
        "order": "created_at.desc",
    }
    if chapter_db:
        params["chapter"] = f"eq.{chapter_db}"
    else:
        params["chapter"] = "is.null"
    if q_type == "mixed":
        params["question_type"] = "in.(mcq,short)"
    elif q_type == "conceptual":
        params["question_type"] = "eq.long"
    else:
        params["question_type"] = f"eq.{q_type}"
    try:
        rows = _sb_get("questions", params)
    except Exception:
        return []
    for_mixed = q_type == "mixed"
    result = []
    for r in rows:
        item = {
            "question": r.get("question_text") or "",
            "answer": r.get("correct_answer") or "",
            "explanation": r.get("explanation") or "",
        }
        if r.get("question_type") == "mcq" and r.get("options"):
            item["options"] = r["options"]
        if for_mixed:
            item["question_type"] = r.get("question_type")
        result.append(item)
    return result

# ---------- PDF helpers ----------

def extract_text(file_bytes):
    reader = PdfReader(io.BytesIO(file_bytes))
    return "".join(page.extract_text() or "" for page in reader.pages)

def truncate_text(text, max_chars=18000):
    return text[:max_chars] if len(text) > max_chars else text

# ---------- Chapter analysis ----------

SUBJECT_DEFAULTS = {
    "mathematics": (90, 10), "math": (90, 10), "maths": (90, 10),
    "physics": (60, 40),
    "chemistry": (50, 50),
    "biology": (15, 85),
    "accountancy": (85, 15),
    "business studies": (20, 80),
    "history": (10, 90),
    "political science": (10, 90),
    "geography": (10, 90),
    "sociology": (10, 90),
    "english": (10, 90),
}

def _subject_defaults(subject):
    return SUBJECT_DEFAULTS.get((subject or "").lower().strip(), (50, 50))

def _analyse_chapter(text, subject):
    default_practical, default_theory = _subject_defaults(subject)
    snippet = text[:6000]
    prompt = f"""Analyse this CBSE chapter content and determine the practical vs theory content ratio.

SUBJECT: {subject}
SUBJECT DEFAULT: {default_practical}% practical, {default_theory}% theory — override only if the content clearly differs.

Practical content: numerical problems, calculations, graphs, data interpretation, applied problem solving, worked examples.
Theory content: explanatory prose, definitions, conceptual descriptions, historical or factual text.

Also list every major heading and sub-heading you can identify in the chapter.

Return ONLY this JSON object, no other text:
{{"practical_pct": {default_practical}, "theory_pct": {default_theory}, "headings": ["heading1", "heading2"]}}

CHAPTER CONTENT:
{snippet}"""
    try:
        claude_client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
        response = claude_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        if start != -1 and end > start:
            parsed = json.loads(raw[start:end])
            practical = int(parsed.get("practical_pct", default_practical))
            theory = int(parsed.get("theory_pct", default_theory))
            headings = parsed.get("headings") or []
            total = practical + theory
            if total != 100 and total > 0:
                practical = round(practical * 100 / total)
                theory = 100 - practical
            return practical, theory, headings
    except Exception:
        pass
    return default_practical, default_theory, []

def _run_coverage_check(headings, subject, exam, chapter, chapter_id, full_text):
    if not headings:
        return []
    try:
        rows = _sb_get("questions", {
            "select": "question_text",
            "subject": f"eq.{subject}",
            "exam": f"eq.{exam}",
            "chapter": f"eq.{chapter}",
            "limit": 1000,
        })
        all_text = " ".join((r.get("question_text") or "").lower() for r in rows)
    except Exception:
        return []

    uncovered = []
    for heading in headings:
        if heading.lower()[:30] not in all_text:
            uncovered.append(heading)

    if not uncovered:
        return []

    topup_prompt = f"""You are a CBSE question setter. The following chapter headings have no questions yet. Generate exactly 1 Short Answer (SA) question and 1 MCQ for EACH heading listed below.

SUBJECT: {subject}
CHAPTER: {chapter}

HEADINGS WITH NO COVERAGE:
{chr(10).join(f"- {h}" for h in uncovered)}

SA rules: begin with Explain/Describe/Why/How. Answer 40-70 words. Include keywords array (min 3). Set is_practical based on content.
MCQ rules: 4 options A B C D, answer is one letter. Include keywords array (min 3).

OUTPUT FORMAT (return ONLY a valid JSON array):
[{{"question_type":"short","question":"...","answer":"...","explanation":"...","keywords":["k1","k2","k3"],"is_practical":false}},{{"question_type":"mcq","question":"...","options":{{"A":"...","B":"...","C":"...","D":"..."}},"answer":"A","explanation":"...","keywords":["k1","k2","k3"],"is_practical":false}}]

CHAPTER CONTENT (excerpt):
{full_text[:8000]}"""

    try:
        claude_client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
        response = claude_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": topup_prompt}],
        )
        raw = response.content[0].text
        topup_data, err = _parse_ai_questions_json(raw, getattr(response, "stop_reason", None))
        if topup_data and not err:
            save_questions(topup_data, "mixed", "mixed", subject, exam, chapter, source_chapter_id=chapter_id)
            return uncovered
    except Exception:
        pass
    return uncovered

def _get_or_store_chapter_meta(subject, exam, chapter, text, chapter_order=None, file_name=None):
    try:
        rows = _sb_get("chapter_meta", {
            "select": "id,practical_pct,theory_pct,headings,chapter_order",
            "subject": f"eq.{subject}",
            "exam": f"eq.{exam}",
            "chapter": f"eq.{chapter}",
            "limit": 1,
        })
        if rows:
            r = rows[0]
            if chapter_order is not None and (r.get("chapter_order") is None or r.get("chapter_order") == 999):
                try:
                    _sb_patch("chapter_meta", r["id"], {"chapter_order": chapter_order})
                except Exception:
                    pass
            return r["id"], r["practical_pct"], r["theory_pct"], r.get("headings") or []
    except Exception:
        pass
    practical_pct, theory_pct, headings = _analyse_chapter(text, subject)
    chapter_id = str(uuid.uuid4())
    try:
        row = {"id": chapter_id, "subject": subject, "exam": exam,
               "chapter": chapter, "practical_pct": practical_pct,
               "theory_pct": theory_pct, "headings": headings}
        if chapter_order is not None:
            row["chapter_order"] = chapter_order
        if file_name:
            row["file_name"] = file_name
        _sb_post("chapter_meta", [row])
    except Exception:
        pass
    return chapter_id, practical_pct, theory_pct, headings

# ---------- Claude prompt config ----------

FORMAT_EXAMPLES = {
    "mcq": '[{"question":"string","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"string","keywords":["keyword1","keyword2","keyword3"],"is_practical":false}]',
    "short": '[{"question":"string","answer":"string","explanation":"string","keywords":["keyword1","keyword2","keyword3"],"is_practical":false}]',
    "long": '[{"question":"string","answer":"string","explanation":"string","keywords":["keyword1","keyword2","keyword3","keyword4","keyword5","keyword6"],"is_practical":false}]',
    "conceptual": '[{"question":"string","answer":"string","explanation":"string","keywords":["keyword1","keyword2","keyword3","keyword4","keyword5","keyword6"],"is_practical":false}]',
    "mixed": '[{"question_type":"mcq","question":"string","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"string","keywords":["keyword1","keyword2","keyword3"],"is_practical":false},{"question_type":"short","question":"string","answer":"string","explanation":"string","keywords":["keyword1","keyword2","keyword3"],"is_practical":false}]',
    "cbq": '[{"question_type":"cbq","passage":"60-100 word real-world/scenario passage","sub_questions":[{"question":"string","difficulty":"easy","answer":"string"},{"question":"string","difficulty":"medium","answer":"string"},{"question":"string","difficulty":"hard","answer":"string"}],"keywords":["keyword1","keyword2","keyword3"],"is_practical":false}]',
    "vsa": '[{"question":"string","answer":"string","keywords":["keyword1","keyword2"],"is_practical":false}]',
}

TYPE_RULES = {
    "mcq": """MCQ rules (follow strictly):
- Easy MCQs: surface-level factual, direct recall, one-line definitions, who/what/which questions. Distractors plausible but clearly wrong to a student who has studied.
- Medium MCQs: require understanding and application. Student must think, not just recall. Apply concept to a scenario, identify the correct process, choose between similar-sounding concepts.
- Hard MCQs: conceptual depth. Why does X happen, which best explains, how does X relate to Y. Distractors must be very close to the correct answer and require genuine understanding to differentiate.
- Generate 4 options labelled A, B, C, D for every MCQ.
- Distribute correct answers equally across A, B, C, D — no single option should be correct more than 30% of the time across the set.
- answer field must be a single letter: A, B, C, or D.
- Return ONLY a valid JSON array.""",

    "short": """Short Answer (SA) rules (follow strictly):
- Every question must begin with: Explain, Describe, Why does, How does, What is the significance of, Differentiate between, What happens when, or a similar prompt that demands explanation.
- NO one-word or one-line answer questions allowed.
- Answer format (40–70 words, complete sentences): one sentence of context → one to two sentences of core explanation → one sentence of implication or example if applicable.
- Include all key terms a CBSE examiner would look for in the answer.
- explanation field: note what keywords/concepts make this answer score full marks.
- Return ONLY a valid JSON array.""",

    "long": """Long Answer (LA) rules (follow strictly):
- Questions must use: why, how, explain in detail, analyse, discuss, compare, evaluate.
- Answer structure (max 120 words, complete paragraphs): proper introduction sentence setting context → core explanation covering every sub-point a CBSE marking scheme awards marks for → concluding sentence summarising or stating significance.
- All keywords an examiner would look for must appear throughout introduction, body, and conclusion.
- Note "[include diagram of X here]" in the answer where a diagram is relevant.
- explanation field: list the key points that would earn marks in a CBSE marking scheme.
- Return ONLY a valid JSON array.""",

    "conceptual": """Conceptual/Long Answer rules (follow strictly):
- Same rules as Long Answer above.
- Focus on why/how/analyse/evaluate/discuss prompts requiring deep understanding.
- Max 120 words per answer. Structured paragraph format.
- Return ONLY a valid JSON array.""",

    "mixed": """Mixed (MCQ + Short Answer) rules:
- Each item must have a question_type field set to either "mcq" or "short".
- Follow MCQ rules exactly for mcq items.
- Follow Short Answer rules exactly for short items.
- Return ONLY a valid JSON array.""",

    "vsa": """Very Short Answer (VSA) rules (follow strictly):
- Questions must be direct and factual: What is, Define, Name, State, Who, When, Which.
- Answer must be exactly 1-2 complete sentences, 20-40 words maximum. No elaboration.
- Include 2-3 keywords an examiner would look for.
- Return ONLY a valid JSON array.""",

    "cbq": """Case-Based Question (CBQ) rules (follow strictly):
- Each CBQ must have: a passage of 60–100 words based on a real-world application, current affairs hook, or scenario derived from the chapter content.
- 3 sub-questions progressing in difficulty: first easy (direct recall from passage), second medium (requires understanding), third hard (requires analysis or application beyond the passage).
- Each sub-question answer must not exceed 100 words.
- Return ONLY a valid JSON array.""",
}

MAX_TOKENS_FOR_TYPE = {"mcq": 8192, "short": 8192, "long": 8192, "conceptual": 8192, "mixed": 8192, "cbq": 8192, "vsa": 8192}

def _strip_markdown_code_fence(text):
    t = text.strip()
    if not t.startswith("```"):
        return t
    lines = t.split("\n")
    if lines[0].startswith("```"):
        lines = lines[1:]
    while lines and lines[-1].strip() == "":
        lines.pop()
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()

def _extract_json_array_string(text):
    s = _strip_markdown_code_fence(text)
    start = s.find("[")
    if start == -1:
        return None
    depth, in_str, i = 0, False, start
    while i < len(s):
        ch = s[i]
        if in_str:
            if ch == "\\" and i + 1 < len(s):
                i += 2; continue
            if ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return s[start:i+1]
        i += 1
    return None

def _parse_ai_questions_json(raw, stop_reason):
    json_str = _extract_json_array_string(raw)
    if not json_str:
        return None, "Could not find a JSON array in the model output."
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        hint = " Output may be cut off — try fewer questions." if stop_reason == "max_tokens" else ""
        return None, f"JSON parse error: {e}.{hint}"
    if not isinstance(data, list):
        return None, "Model output was not a JSON array."
    return data, None

# ---------- API endpoints ----------

@app.get("/api/health")
async def health_check():
    key = CLAUDE_API_KEY
    key_debug = (key[:8] + "..." + key[-4:]) if len(key) > 12 else ("SET" if key else "MISSING")
    return {"status": "healthy", "timestamp": datetime.now().isoformat(), "claude_key": key_debug, "key_len": len(key), "has_newline": "\n" in key or "\r" in key}

@app.get("/api/retrieve")
async def retrieve_questions(
    exam: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    chapter: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    q_type: Optional[str] = Query(None),
    limit: Optional[int] = Query(50),
    shuffle: Optional[str] = Query("false"),
):
    try:
        params = {"select": "*", "limit": limit or 50, "order": "created_at.desc"}
        if exam: params["exam"] = f"eq.{exam}"
        if subject: params["subject"] = f"ilike.*{subject}*"
        if chapter: params["chapter"] = f"ilike.*{chapter}*"
        if difficulty: params["difficulty"] = f"eq.{difficulty}"
        if q_type: params["question_type"] = f"eq.{q_type}"
        rows = _sb_get("questions", params)
        if shuffle == "true":
            random.shuffle(rows)
        questions_data = [{
            "id": r.get("id"), "exam": r.get("exam"), "subject": r.get("subject"),
            "chapter": r.get("chapter"), "question": r.get("question_text"),
            "question_type": r.get("question_type"), "difficulty": r.get("difficulty"),
            "options": r.get("options"), "answer": r.get("correct_answer"),
            "explanation": r.get("explanation"), "created_at": r.get("created_at"),
        } for r in rows]
        return {"success": True, "count": len(questions_data), "questions": questions_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving questions: {str(e)}")

@app.get("/api/stats")
async def get_stats():
    try:
        rows = _sb_get("questions", {"select": "exam,subject,chapter,question_type"})
        counts = {}
        for r in rows:
            key = (r.get("exam"), r.get("subject"), r.get("chapter"), r.get("question_type"))
            counts[key] = counts.get(key, 0) + 1
        stats = [{"exam": k[0], "subject": k[1], "chapter": k[2], "question_type": k[3], "count": v} for k, v in counts.items()]
        return {"success": True, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/metadata")
async def get_metadata():
    try:
        rows = _sb_get("questions", {"select": "exam,subject,chapter"})
        boards = sorted({r["exam"] for r in rows if r.get("exam")})
        subjects = sorted({r["subject"] for r in rows if r.get("subject")})
        chapters = sorted({r["chapter"] for r in rows if r.get("chapter")})
        return {"success": True, "boards": boards, "subjects": subjects, "chapters": chapters}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
async def generate_from_pdf(
    file: UploadFile = File(...),
    difficulty: Literal["easy", "medium", "hard", "mixed"] = Form(...),
    q_type: Literal["mcq", "short", "long", "conceptual", "mixed", "cbq", "vsa"] = Form(...),
    num_q: int = Form(...),
    subject: str = Form("general"),
    exam: str = Form("general"),
    chapter: str = Form(...),
    chapter_order: Optional[int] = Form(None),
):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Claude API key not configured")
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase service key not configured")
    if num_q < 1:
        raise HTTPException(status_code=400, detail="num_q must be at least 1.")
    if not chapter or not chapter.strip():
        raise HTTPException(status_code=400, detail="chapter is required.")

    content = await file.read()
    try:
        text = extract_text(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")
    if not text.strip():
        raise HTTPException(status_code=400, detail="No text found in the PDF.")

    full_text = truncate_text(text, 80000)

    # Consistency check: verify chapter name matches PDF content
    chapter_words = [w for w in re.sub(r'[^a-z\s]', '', chapter.lower()).split() if len(w) >= 4]
    if chapter_words:
        first_chunk = full_text[:4000].lower()
        matched = sum(1 for w in chapter_words if w in first_chunk)
        match_ratio = matched / len(chapter_words)
        if match_ratio < 0.25:
            err_msg = (f"Chapter mismatch: '{chapter}' does not appear to match the uploaded PDF "
                       f"({matched}/{len(chapter_words)} title words found in PDF). "
                       f"Please verify you selected the correct chapter and uploaded the correct PDF.")
            _log_error("/api/generate", "chapter_title_mismatch", err_msg,
                       {"subject": subject, "exam": exam, "chapter": chapter, "match_ratio": round(match_ratio, 2)})
            return JSONResponse(status_code=422, content={"error": err_msg})

    # Step 1: analyse chapter — get practical/theory split and headings
    chapter_id, practical_pct, theory_pct, headings = _get_or_store_chapter_meta(
        subject, exam, chapter, full_text, chapter_order=chapter_order, file_name=file.filename
    )

    practical_count = round(num_q * practical_pct / 100)
    theory_count = num_q - practical_count

    existing_questions = []
    try:
        existing = get_cached_questions(q_type, difficulty, subject, exam, chapter, 500)
        existing_questions = [q["question"] for q in existing if q.get("question")]
    except Exception:
        pass

    difficulty_map = {
        "easy": "Easy — surface-level factual, direct recall, definitions",
        "medium": "Medium — understanding and application, requires thinking not just recall",
        "hard": "Hard — deep reasoning, analytical, conceptual, multi-step",
        "mixed": "Mixed — distribute equally across easy, medium, and hard",
    }

    prompt = f"""You are an expert CBSE question paper setter generating questions for Class 10/12 students.

SUBJECT: {subject}
CHAPTER: {chapter}
EXAM: {exam}
QUESTION TYPE: {q_type}
DIFFICULTY: {difficulty_map.get(difficulty, difficulty)}
NUMBER OF QUESTIONS TO GENERATE: {num_q}

PRACTICAL vs THEORY SPLIT: This chapter is {practical_pct}% practical and {theory_pct}% theory. Of the {num_q} questions, generate approximately {practical_count} as numerical/applied/practical questions and {theory_count} as conceptual/theoretical questions. Set is_practical to true for practical questions and false for theory questions.

RULES FOR THIS QUESTION TYPE:
{TYPE_RULES.get(q_type, '')}

COVERAGE RULE: Generate questions proportionally from across the ENTIRE chapter content below. Do NOT concentrate questions on the introduction or any single section. Identify all major topics/headings in the content and ensure each is represented.

ANSWER QUALITY RULE: Every answer must include all important keywords that CBSE examiners look for. Answers must be written in complete sentences such that a student who memorises them will score full marks in any school, board, or competitive exam on this topic.

SELF-CONTAINED RULE: Do NOT reference figures, tables, examples by number, or page numbers from the PDF. Every question and answer must be fully self-contained.

OUTPUT FORMAT (return ONLY a valid JSON array, no other text):
{FORMAT_EXAMPLES.get(q_type, '')}

CHAPTER CONTENT:
{full_text}"""

    if existing_questions:
        prompt += "\n\nDO NOT repeat or closely paraphrase any of these existing questions:\n" + "\n".join(f"- {q}" for q in existing_questions)

    claude_client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    response = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=MAX_TOKENS_FOR_TYPE[q_type],
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text
    stop_reason = getattr(response, "stop_reason", None)
    data, parse_err = _parse_ai_questions_json(raw, stop_reason)
    if parse_err:
        return {"error": parse_err, "raw": raw}

    try:
        save_questions(data, q_type, difficulty, subject, exam, chapter, source_chapter_id=chapter_id)
    except Exception as e:
        _log_error("/api/generate", "save_questions", str(e), {"subject": subject, "chapter": chapter, "exam": exam})
        return {"questions": data, "save_warning": str(e)}

    uncovered = _run_coverage_check(headings, subject, exam, chapter, chapter_id, full_text)

    return {
        "questions": data,
        "practical_pct": practical_pct,
        "theory_pct": theory_pct,
        "headings": headings,
        "uncovered_headings_filled": uncovered,
    }

@app.post("/api/extract-paper")
async def extract_paper(
    file: UploadFile = File(...),
    subject: str = Form(...),
    class_level: str = Form(...),
    board: str = Form(...),
    year: str = Form(...),
    exam_type: str = Form(...),
    source_paper_id: Optional[str] = Form(None),
):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Claude API key not configured")
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase service key not configured")

    content = await file.read()
    try:
        text = extract_text(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")
    if not text.strip():
        raise HTTPException(status_code=400, detail="No text found in the PDF.")

    paper_id = source_paper_id or str(uuid.uuid4())
    full_text = truncate_text(text, 60000)

    existing_fingerprints = _get_existing_exam_question_fingerprints(subject, class_level, board)
    has_existing = len(existing_fingerprints) > 0

    if has_existing:
        prompt = f"""You are an expert CBSE question paper analyser. Questions for this subject already exist in the database. Your job is to extract the CONCEPTS tested in this paper and generate NEW questions that test the same concepts but using different wording, different scenarios, different numbers, or a different angle. Do not copy question text verbatim — rephrase everything so students see fresh questions on the same topics.

MULTI-LINE QUESTION RULE: Many questions span multiple lines or have sub-parts. Treat the entire question — including all its lines, clauses, and sub-parts — as a single question_text. Never split one question across multiple entries.

PAPER DETAILS:
Subject: {subject}
Class: {class_level}
Board: {board}
Year: {year}
Exam Type: {exam_type}

QUESTION TYPE DETECTION RULES (follow strictly):
- MCQ: has four options labelled A B C D or 1 2 3 4
- VSA (Very Short Answer): carries 2 marks
- SA (Short Answer): carries 3 marks
- LA (Long Answer): carries 5 marks
- CBQ (Case Based Question): has a passage followed by sub-questions, carries 4 marks total

DIFFICULTY TAGGING RULES:
- easy: factual recall, definition-based, direct questions
- medium: application-based, requires some understanding
- hard: conceptual, why/how/which, multi-step reasoning, analytical

For each question generate:
- question_number: the number as it appears in the paper
- question_text: your REPHRASED version testing the same concept
- question_type: one of MCQ, VSA, SA, LA, CBQ
- marks: integer marks for this question
- options: for MCQs only, object with keys A B C D — null for all other types
- chapter: the chapter name if identifiable from context, otherwise null
- difficulty_level: easy, medium, or hard

OUTPUT FORMAT (return ONLY a valid JSON array, no other text):
[{{"question_number":"1","question_text":"rephrased question text","question_type":"MCQ","marks":1,"options":{{"A":"...","B":"...","C":"...","D":"..."}},"chapter":null,"difficulty_level":"easy"}}]

QUESTION PAPER:
{full_text}"""
    else:
        prompt = f"""You are an expert CBSE question paper analyser. Extract every single question from the question paper below. Do not miss any question.

MULTI-LINE QUESTION RULE: Many questions span multiple lines or have sub-parts. Treat the entire question — including all its lines, clauses, and sub-parts — as a single question_text. Never split one question across multiple entries just because it has line breaks.

PAPER DETAILS:
Subject: {subject}
Class: {class_level}
Board: {board}
Year: {year}
Exam Type: {exam_type}

QUESTION TYPE DETECTION RULES (follow strictly):
- MCQ: has four options labelled A B C D or 1 2 3 4
- VSA (Very Short Answer): carries 2 marks
- SA (Short Answer): carries 3 marks
- LA (Long Answer): carries 5 marks
- CBQ (Case Based Question): has a passage followed by sub-questions, carries 4 marks total

DIFFICULTY TAGGING RULES:
- easy: factual recall, definition-based, direct questions
- medium: application-based, requires some understanding
- hard: conceptual, why/how/which, multi-step reasoning, analytical

For each question extract:
- question_number: the number as it appears in the paper
- question_text: the FULL question text including all sub-parts
- question_type: one of MCQ, VSA, SA, LA, CBQ
- marks: integer marks for this question
- options: for MCQs only, object with keys A B C D — null for all other types
- chapter: the chapter name if identifiable from context, otherwise null
- difficulty_level: easy, medium, or hard

OUTPUT FORMAT (return ONLY a valid JSON array, no other text):
[{{"question_number":"1","question_text":"full question text","question_type":"MCQ","marks":1,"options":{{"A":"...","B":"...","C":"...","D":"..."}},"chapter":null,"difficulty_level":"easy"}}]

QUESTION PAPER:
{full_text}"""

    claude_client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    response = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text
    stop_reason = getattr(response, "stop_reason", None)
    data, parse_err = _parse_ai_questions_json(raw, stop_reason)
    if parse_err:
        return {"error": parse_err, "raw": raw}

    try:
        saved, skipped = _save_exam_questions(data, subject, class_level, board, year, exam_type, paper_id)
    except Exception as e:
        _log_error("/api/extract-paper", "save_exam_questions", str(e), {"subject": subject, "paper_id": paper_id})
        return {"questions": data, "save_warning": str(e)}

    return {
        "success": True,
        "source_paper_id": paper_id,
        "questions_extracted": len(data),
        "questions_saved": saved,
        "duplicates_skipped": skipped,
    }

@app.post("/api/match-answer-key")
async def match_answer_key(
    file: UploadFile = File(...),
    source_paper_id: str = Form(...),
):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Claude API key not configured")
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase service key not configured")

    # Fetch all questions for this paper
    try:
        rows = _sb_get("exam_questions", {
            "select": "id,question_text,question_type,keywords_json",
            "source_paper_id": f"eq.{source_paper_id}",
            "limit": 500,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not fetch questions: {e}")
    if not rows:
        raise HTTPException(status_code=404, detail="No questions found for this source_paper_id.")

    content = await file.read()
    try:
        text = extract_text(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")
    if not text.strip():
        raise HTTPException(status_code=400, detail="No text found in the answer key PDF.")

    full_text = truncate_text(text, 60000)

    question_list = "\n".join(
        f'- id:{r["id"]} | type:{r.get("question_type","?")} | question:{r["question_text"][:120]}'
        for r in rows
    )

    prompt = f"""You are an expert CBSE answer key analyser. Match every answer in the answer key below to its corresponding question.

QUESTIONS TO MATCH (each has an id):
{question_list}

INSTRUCTIONS:
- For each answer in the key, find the matching question by question number or by matching the question text.
- For MCQ questions: correct_answer must be a single letter A, B, C, or D.
- For all other types: correct_answer is the full answer text.
- If you cannot confidently match an answer to a question, skip it — do not guess.

OUTPUT FORMAT (return ONLY a valid JSON array, no other text):
[{{"id":"question-uuid-here","correct_answer":"A"}}]

ANSWER KEY:
{full_text}"""

    claude_client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    response = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text
    stop_reason = getattr(response, "stop_reason", None)
    data, parse_err = _parse_ai_questions_json(raw, stop_reason)
    if parse_err:
        return {"error": parse_err, "raw": raw}

    # Collect valid matched pairs first
    existing_by_id = {r["id"]: r for r in rows}
    valid_ids = set(existing_by_id.keys())
    matched_pairs = []
    failed = 0
    for item in data:
        q_id = (item.get("id") or "").strip()
        answer = (item.get("correct_answer") or "").strip()
        if not q_id or q_id not in valid_ids or not answer:
            failed += 1
            continue
        matched_pairs.append({"id": q_id, "answer": answer})

    # One Claude call to extract keywords for all matched answers
    keywords_by_id = {}
    if matched_pairs:
        qa_list = "\n".join(
            f'- id:{p["id"]} | answer:{p["answer"][:300]}'
            for p in matched_pairs
        )
        kw_prompt = f"""Extract domain-relevant keywords from each answer below. Keywords are subject-specific terms, concepts, names, and formulas that a CBSE examiner would look for.

For each entry return its id and a keywords array. Do not delete or omit any meaningful term.

OUTPUT FORMAT (return ONLY a valid JSON array, no other text):
[{{"id":"question-uuid","keywords":["keyword1","keyword2"]}}]

ANSWERS:
{qa_list}"""
        try:
            kw_response = claude_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                messages=[{"role": "user", "content": kw_prompt}],
            )
            kw_data, kw_err = _parse_ai_questions_json(kw_response.content[0].text, getattr(kw_response, "stop_reason", None))
            if kw_data and not kw_err:
                for entry in kw_data:
                    eid = (entry.get("id") or "").strip()
                    kws = entry.get("keywords") or []
                    if eid and isinstance(kws, list):
                        keywords_by_id[eid] = kws
        except Exception:
            pass

    # PATCH each question with answer + merged keywords
    matched = 0
    for pair in matched_pairs:
        q_id = pair["id"]
        answer = pair["answer"]
        existing_kws = existing_by_id[q_id].get("keywords_json") or []
        new_kws = keywords_by_id.get(q_id, [])
        merged_kws = list(dict.fromkeys(existing_kws + [k for k in new_kws if k not in existing_kws]))
        try:
            url = f"{SUPABASE_URL}/rest/v1/exam_questions?id=eq.{q_id}"
            body = json.dumps({"correct_answer": answer, "answer_pending": False, "keywords_json": merged_kws}).encode()
            headers = {**_sb_headers(), "Prefer": "return=minimal"}
            req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
            matched += 1
        except Exception as e:
            _log_error("/api/match-answer-key", "patch_answer", str(e), {"question_id": q_id, "source_paper_id": source_paper_id})
            failed += 1

    return {
        "success": True,
        "source_paper_id": source_paper_id,
        "answers_matched": matched,
        "answers_failed": failed,
        "total_questions": len(rows),
    }

@app.post("/api/upload-reference")
async def upload_reference(
    subject: str = Form(...),
    class_level: str = Form(...),
    board: str = Form(...),
    upload_type: str = Form(...),
    file_name: str = Form(...),
    processing_notes: str = Form(""),
):
    if not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase service key not configured")
    try:
        _sb_post("reference_uploads", [{
            "file_name": file_name,
            "upload_type": upload_type,
            "subject": subject,
            "class_level": class_level,
            "board": board,
            "processing_notes": processing_notes or None,
        }])
    except Exception as e:
        _log_error("/api/upload-reference", "insert_metadata", str(e), {"file_name": file_name, "subject": subject})
        raise HTTPException(status_code=500, detail=f"Could not save reference upload: {e}")
    return {"success": True, "file_name": file_name}

@app.get("/api/reference-uploads")
async def get_reference_uploads(
    subject: Optional[str] = Query(None),
    class_level: Optional[str] = Query(None),
    board: Optional[str] = Query(None),
):
    try:
        params = {"select": "*", "order": "uploaded_at.desc", "limit": 200}
        if subject: params["subject"] = f"eq.{subject}"
        if class_level: params["class_level"] = f"eq.{class_level}"
        if board: params["board"] = f"eq.{board}"
        rows = _sb_get("reference_uploads", params)
        return {"success": True, "count": len(rows), "uploads": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/questions/{question_id}")
async def edit_question(question_id: str, request: Request):
    body = await request.json()
    allowed = {"question_text", "correct_answer", "explanation", "difficulty", "question_type"}
    update = {k: v for k, v in body.items() if k in allowed}
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields to update.")
    try:
        _sb_patch("questions", question_id, update)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True}

@app.delete("/api/questions/{question_id}")
async def delete_question(question_id: str):
    try:
        _sb_delete("questions", question_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True}

@app.get("/api/errors")
async def get_errors(limit: int = Query(50)):
    try:
        rows = _sb_get("processing_errors", {"select": "*", "order": "created_at.desc", "limit": limit})
        return {"success": True, "count": len(rows), "errors": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/meta/options")
async def get_meta_options(
    exam: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
):
    exams_set, subjects_set = set(), set()
    try:
        rows = _sb_get("questions", {"select": "exam,subject", "limit": 5000})
        for r in rows:
            if r.get("exam"): exams_set.add(r["exam"])
            if r.get("subject") and (not exam or r.get("exam") == exam):
                subjects_set.add(r["subject"])
    except Exception:
        pass
    try:
        cm_params = {"select": "exam,subject", "limit": 2000}
        if exam: cm_params["exam"] = f"eq.{exam}"
        rows = _sb_get("chapter_meta", cm_params)
        for r in rows:
            if r.get("exam"): exams_set.add(r["exam"])
            if r.get("subject"): subjects_set.add(r["subject"])
    except Exception:
        pass
    return {"success": True, "exams": sorted(exams_set), "subjects": sorted(subjects_set)}


@app.post("/api/log")
async def log_frontend_error(request: Request):
    try:
        body = await request.json()
        _log_error(
            body.get("endpoint") or "frontend",
            body.get("stage") or "unknown",
            body.get("message") or "",
            body.get("context") or {}
        )
    except Exception:
        pass
    return {"success": True}


@app.post("/api/extract-chapter-title")
async def extract_chapter_title(
    file: UploadFile = File(...),
    subject: str = Form(""),
    exam: str = Form(""),
):
    content = await file.read()
    try:
        text = extract_text(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    snippet = text[:3000]
    ch_num_match = re.search(r'chapter\s+(\d+)', text[:1000].lower())
    regex_ch_num = int(ch_num_match.group(1)) if ch_num_match else None

    fallback_title = file.filename.replace(".pdf", "").replace(".PDF", "").replace("_", " ").replace("-", " ").strip()

    if not CLAUDE_API_KEY:
        return {"success": False, "chapter_title": fallback_title, "chapter_number": regex_ch_num, "confidence": "low", "file_name": file.filename}

    prompt = f"""This is the beginning of a CBSE textbook chapter PDF. Identify the chapter title.

The chapter title is the main prominent heading at the start of the chapter — not the book title, not a sub-heading, not a table of contents entry. It is usually the largest text near the top.

Return ONLY this JSON (no other text):
{{"chapter_title": "exact chapter title as written in the textbook", "chapter_number": 1}}

If chapter number is not visible, use null for chapter_number.

CONTENT (first part of PDF):
{snippet}"""

    try:
        claude_client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
        response = claude_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=128,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        if start != -1 and end > start:
            parsed = json.loads(raw[start:end])
            title = (parsed.get("chapter_title") or "").strip()
            ch_num = parsed.get("chapter_number") or regex_ch_num
            if title and len(title) > 3:
                return {"success": True, "chapter_title": title, "chapter_number": ch_num, "confidence": "high", "file_name": file.filename}
    except Exception as e:
        _log_error("/api/extract-chapter-title", "claude_extract", str(e), {"file": file.filename})

    return {"success": False, "chapter_title": fallback_title, "chapter_number": regex_ch_num, "confidence": "low", "file_name": file.filename}


@app.get("/api/chapters")
async def get_chapters(
    exam: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
):
    try:
        params = {"select": "chapter,chapter_order", "order": "chapter_order.asc,chapter.asc", "limit": 200}
        if exam: params["exam"] = f"eq.{exam}"
        if subject: params["subject"] = f"eq.{subject}"
        rows = _sb_get("chapter_meta", params)
        chapters = [r["chapter"] for r in rows if r.get("chapter")]
        return {"success": True, "chapters": chapters}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
