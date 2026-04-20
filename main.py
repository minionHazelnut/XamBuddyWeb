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

def _sb_post(table, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=_sb_headers(), method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()

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
    if not qt.endswith("?"):
        qt_stripped = qt.rstrip(".!:;")
        if not qt_stripped.endswith("?") and not any(qt.lower().startswith(w) for w in ("explain", "describe", "discuss", "analyse", "analyze", "compare", "evaluate", "differentiate", "why", "how", "what")):
            pass
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

def save_questions(questions, q_type, difficulty, subject, exam, chapter=""):
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
            if not norm or norm in existing:
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
            }
            to_insert.append(row)
            existing.add(norm)
            continue

        qtext_raw = q.get("question") or ""
        if not _ai_item_is_clean_for_db(q, row_type):
            continue
        norm = _exact_question_fingerprint(qtext_raw)
        if not norm or norm in existing:
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

# ---------- Claude prompt config ----------

FORMAT_EXAMPLES = {
    "mcq": '[{"question":"Which of the following best describes X?","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"B","explanation":"Key terms: ...; This scores full marks because ..."}]',
    "short": '[{"question":"Explain why X occurs.","answer":"[Context sentence.] [Core explanation in 1-2 sentences with all key terms.] [Implication or example sentence.]","explanation":"Keywords that earn marks: X, Y, Z"}]',
    "long": '[{"question":"Analyse the significance of X in detail.","answer":"[Introduction sentence setting context.] [Core explanation covering all marking scheme sub-points, with all key terms.] [Diagram note if relevant: (include diagram of X here).] [Concluding sentence stating significance.]","explanation":"Marking scheme points: 1. ... 2. ... 3. ..."}]',
    "conceptual": '[{"question":"How does X relate to Y?","answer":"[Introduction.] [Core explanation.] [Conclusion.]","explanation":"Marking scheme points: 1. ... 2. ..."}]',
    "mixed": '[{"question_type":"mcq","question":"Which of the following is correct about X?","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"Key terms: ..."},{"question_type":"short","question":"Explain how X affects Y.","answer":"[Context.] [Explanation.] [Example.]","explanation":"Keywords: X, Y, Z"}]',
    "cbq": '[{"question_type":"cbq","passage":"[60-100 word real-world/current-affairs scenario derived from chapter content, NO direct copy from PDF]","sub_questions":[{"question":"What is X? [easy]","difficulty":"easy","answer":"[Direct recall answer, max 100 words]"},{"question":"Why does X happen? [medium]","difficulty":"medium","answer":"[Understanding-level answer, max 100 words]"},{"question":"Analyse how X impacts Y. [hard]","difficulty":"hard","answer":"[Analytical answer, max 100 words]"}]}]',
}

# Subject-level practical/theory defaults (Section B, Step 1)
SUBJECT_PRACTICAL_PCT = {
    "Mathematics": 92, "Physics": 60, "Chemistry": 50, "Biology": 15,
    "Accountancy": 85, "Business Studies": 20,
    "History": 10, "Political Science": 10, "Geography": 15,
    "Sociology": 10, "English": 10, "Hindi": 10,
    "Economics": 30,
}

def _practical_theory_instruction(subject: str) -> str:
    pct = SUBJECT_PRACTICAL_PCT.get(subject, None)
    if pct is None:
        return "Determine the practical vs theory split entirely from the chapter content. Practical questions involve calculations, data interpretation, numerical problems, graphs, or applied problem-solving. Theory questions involve explanations, definitions, concepts, and reasoning."
    theory_pct = 100 - pct
    return f"For {subject}: generate approximately {pct}% practical questions (calculations, numerical problems, applied problem-solving, data interpretation) and {theory_pct}% theory questions (definitions, explanations, concepts, reasoning). Override this ratio only if the chapter content clearly has a different balance."

TYPE_RULES = {
    "mcq": """MCQ GENERATION RULES — follow every rule strictly:

EASY MCQs — surface-level factual recall:
  - Test direct recall: one-line definitions, "who discovered", "what is the formula for", "which of the following is correct about X"
  - Correct answer must be unambiguous
  - Distractors must be plausible but clearly wrong to any student who has studied the chapter

MEDIUM MCQs — understanding and application:
  - Student must think, not just recall
  - Types: apply a concept to a scenario, identify the correct process, choose between two similar-sounding concepts
  - No trivially easy or trivially hard questions at this level

HARD MCQs — conceptual depth:
  - Use: "why does X happen", "which of the following best explains", "how does X relate to Y", "what would happen if"
  - Distractors must be very close to the correct answer — genuine understanding required to differentiate

ALL MCQs:
  - Exactly 4 options labelled A, B, C, D — no more, no less
  - Distribute correct answers across A, B, C, D — no single option correct more than 30% of the time across the full set — randomise this
  - "answer" field must be a single uppercase letter: A, B, C, or D
  - "explanation" field: state which key terms/concepts make this the correct answer and why each distractor is wrong""",

    "short": """SHORT ANSWER (SA) GENERATION RULES — follow every rule strictly:

QUESTION RULES:
  - Every question MUST begin with one of: Explain, Describe, Why does, How does, What is the significance of, Differentiate between, What happens when — or equivalent explanation-demanding prompt
  - FORBIDDEN: questions with a one-word or one-line answer
  - Include a mix of easy (recall-based), medium (application), and hard (analytical) questions

ANSWER RULES — strictly 40 to 70 words per answer:
  - Written in complete sentences only
  - Structure: (1) one sentence of context setting the topic → (2) one to two sentences of core explanation containing ALL key terms a CBSE examiner looks for → (3) one sentence of implication, significance, or example
  - Every answer must contain at least 3 domain-relevant keywords
  - Answers must be written so a student who memorises them scores full marks in CBSE exams

"explanation" field: list the specific keywords and sub-points that earn marks in a CBSE marking scheme""",

    "long": """LONG ANSWER (LA) GENERATION RULES — follow every rule strictly:

QUESTION RULES:
  - Questions MUST use: why, how, explain in detail, analyse, discuss, compare, evaluate
  - Questions must demand paragraph-level thinking and deep understanding

ANSWER RULES — strictly max 120 words, structured paragraph format:
  - STRUCTURE (mandatory):
      → Introduction: one proper sentence setting context for the answer
      → Body: core explanation covering ALL sub-points a CBSE marking scheme would award marks for; include every keyword an examiner looks for
      → Conclusion: one sentence summarising or stating the significance
  - If a diagram or table is relevant, note it as: (include diagram of X here)
  - Every answer must contain at least 6 domain-relevant keywords
  - Answers must be written so a student who memorises them scores full marks in CBSE exams

"explanation" field: list all marking scheme points (e.g. "1. definition of X — 1 mark; 2. process of Y — 2 marks")""",

    "conceptual": """CONCEPTUAL / LONG ANSWER GENERATION RULES — same as Long Answer, follow every rule:

QUESTION RULES:
  - Use: why, how, analyse, evaluate, discuss — demand deep conceptual understanding
  - No surface-level or recall-based questions

ANSWER RULES — max 120 words, structured paragraphs:
  - Introduction → Body (all key sub-points + keywords) → Conclusion
  - Minimum 6 domain-relevant keywords
  - Note diagrams where relevant: (include diagram of X here)

"explanation" field: list marking scheme points""",

    "mixed": """MIXED (MCQ + SHORT ANSWER) GENERATION RULES:
  - Each item MUST have "question_type" set to either "mcq" or "short"
  - Roughly half MCQ, half short answer
  - Apply ALL MCQ rules exactly for question_type="mcq" items
  - Apply ALL Short Answer rules exactly for question_type="short" items""",

    "cbq": """CASE-BASED QUESTION (CBQ) GENERATION RULES — follow every rule strictly:

PASSAGE RULES:
  - 60 to 100 words exactly
  - Must be based on a real-world application, current affairs hook, or scenario DERIVED from the chapter content
  - Must NOT directly copy text from the PDF — reframe in new words as a scenario

SUB-QUESTION RULES — exactly 3 sub-questions per CBQ:
  - Sub-question 1 (easy): direct recall from the passage
  - Sub-question 2 (medium): requires understanding and application
  - Sub-question 3 (hard): requires analysis, evaluation, or application beyond the passage
  - Each sub-question answer: max 100 words, complete sentences, all relevant keywords present
  - Total CBQ carries 4 marks""",
}

MAX_TOKENS_FOR_TYPE = {"mcq": 8192, "short": 8192, "long": 8192, "conceptual": 8192, "mixed": 8192, "cbq": 8192}

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
    q_type: Literal["mcq", "short", "long", "conceptual", "mixed", "cbq"] = Form(...),
    num_q: int = Form(...),
    subject: str = Form("general"),
    exam: str = Form("general"),
    chapter: str = Form(...),
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

    full_text = truncate_text(text)
    existing_questions = []
    try:
        existing = get_cached_questions(q_type, difficulty, subject, exam, chapter, 500)
        existing_questions = [q["question"] for q in existing if q.get("question")]
    except Exception:
        pass

    difficulty_map = {
        "easy":   "EASY — test surface-level factual recall and direct definitions only",
        "medium": "MEDIUM — test understanding and application; student must think, not just recall",
        "hard":   "HARD — test deep reasoning, conceptual analysis, multi-step thinking",
        "mixed":  "MIXED — distribute questions equally across easy, medium, and hard difficulty levels",
    }

    practical_theory_rule = _practical_theory_instruction(subject)

    prompt = f"""You are a senior CBSE question paper setter with 20 years of experience writing board exam papers for Class 10 and Class 12 students in India. You set questions for the subject {subject}.

═══════════════════════════════════════════════
TASK PARAMETERS
═══════════════════════════════════════════════
Subject      : {subject}
Chapter      : {chapter}
Exam         : {exam}
Question Type: {q_type.upper()}
Difficulty   : {difficulty_map.get(difficulty, difficulty)}
Count        : Generate exactly {num_q} question(s)

═══════════════════════════════════════════════
STEP 1 — CHAPTER ANALYSIS (do this mentally before generating)
═══════════════════════════════════════════════
Before generating any question:
1. Read the entire CHAPTER CONTENT below thoroughly.
2. Identify all major headings, sub-headings, key concepts, definitions, formulas, examples, and case studies.
3. Determine the practical vs theory split of this chapter.
   {practical_theory_rule}
4. Divide the chapter into logical segments. You must generate questions proportionally from EVERY segment — do NOT cluster questions around the introduction or any single section. Every major heading must be represented by at least one question in the final output.

═══════════════════════════════════════════════
STEP 2 — QUESTION TYPE RULES
═══════════════════════════════════════════════
{TYPE_RULES.get(q_type, '')}

═══════════════════════════════════════════════
STEP 3 — UNIVERSAL QUALITY STANDARDS (Section D)
═══════════════════════════════════════════════
Every single question and answer you generate MUST pass ALL of the following checks:

QUESTION CHECKS:
✓ Question text must end with a question mark OR be a clear instruction (Explain..., Analyse..., Describe...)
✓ Question must be fully self-contained — do NOT reference "the figure above", "Table 2", "as shown", "Example 3", or any page/section numbers from the PDF
✓ Question must be derivable from and answerable using the chapter content provided

ANSWER CHECKS:
✓ Answer must NOT be empty
✓ For SA and LA: answer must NOT be a single word or single sentence — full structured answer required
✓ SA answers: minimum 3 domain-relevant keywords from the chapter
✓ LA/Conceptual answers: minimum 6 domain-relevant keywords from the chapter
✓ All answers must be written in complete sentences
✓ Answers must be written such that a student who memorises them will score FULL MARKS in any CBSE school exam, board exam, or competitive exam on this topic

MCQ-SPECIFIC CHECKS:
✓ Exactly 4 options labelled A, B, C, D — no more, no less
✓ Exactly one correct answer stored in the "answer" field as a single uppercase letter
✓ Correct answers distributed across A, B, C, D — no option correct more than 30% of the time

═══════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════
Return ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Just the raw JSON array.
Example format:
{FORMAT_EXAMPLES.get(q_type, '')}

═══════════════════════════════════════════════
CHAPTER CONTENT
═══════════════════════════════════════════════
{full_text}"""

    if existing_questions:
        prompt += "\n\n═══════════════════════════════════════════════\nDO NOT REPEAT — existing questions for this chapter (skip any question with >80% similarity to these):\n═══════════════════════════════════════════════\n" + "\n".join(f"- {q}" for q in existing_questions)

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
        save_questions(data, q_type, difficulty, subject, exam, chapter)
    except Exception as e:
        return {"questions": data, "save_warning": str(e)}

    return {"questions": data}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
