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
    if q_type == "mixed":
        return item.get("question_type") or "short"
    if q_type == "conceptual":
        return "long"
    return q_type

def _exact_question_fingerprint(text: str) -> str:
    s = (text or "").strip().lower()
    return re.sub(r"\s+", " ", s)

def _ai_item_is_clean_for_db(q: dict, row_type: str) -> bool:
    qt = (q.get("question") or "").strip()
    if len(qt) < 3 or qt[0] in "[{" or "```" in qt:
        return False
    low = qt[:80].lower()
    if low.startswith('"question"') or low.startswith("'question'"):
        return False
    if row_type == "mcq":
        opts = q.get("options")
        if not isinstance(opts, dict) or len(opts) < 2:
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

def save_questions(questions, q_type, difficulty, subject, exam, chapter=""):
    diff_db = _difficulty_for_db(difficulty)
    chapter_db = chapter.strip() or None
    existing = _get_existing_fingerprints(exam, subject, chapter_db)
    to_insert = []
    for q in questions:
        qtext_raw = q.get("question") or ""
        row_type = _question_type_for_db(q_type, q)
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

def get_random_chunks(text, chunk_size=800, num_chunks=3):
    chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
    return " ".join(random.sample(chunks, min(num_chunks, len(chunks))))

# ---------- Claude prompt config ----------

FORMAT_EXAMPLES = {
    "mcq": '[{"question":"string","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"string"}]',
    "short": '[{"question":"string","answer":"string","explanation":"string"}]',
    "long": '[{"question":"string","answer":"string","explanation":"string"}]',
    "conceptual": '[{"question":"string","answer":"string","explanation":"string"}]',
    "mixed": '[{"question_type":"mcq","question":"string","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"string"},{"question_type":"short","question":"string","answer":"string","explanation":"string"}]',
}
TYPE_RULES = {
    "mcq": "Multiple choice ONLY. 4 options A-D, answer is a single letter. Return ONLY valid JSON array.",
    "short": "Short answer ONLY. Each item: question, answer (1-3 sentences), explanation. No options. Return ONLY valid JSON array.",
    "long": "Long answer ONLY. Each item: question, answer (detailed paragraph), explanation. No options. Return ONLY valid JSON array.",
    "mixed": "Mix of MCQ and short. Each item must have question_type field. Return ONLY valid JSON array.",
}
MAX_TOKENS_FOR_TYPE = {"mcq": 8192, "short": 8192, "long": 8192, "conceptual": 8192, "mixed": 8192}

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
    q_type: Literal["mcq", "short", "long", "conceptual", "mixed"] = Form(...),
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

    selected_content = get_random_chunks(text)
    existing_questions = []
    try:
        existing = get_cached_questions(q_type, difficulty, subject, exam, chapter, 500)
        existing_questions = [q["question"] for q in existing if q.get("question")]
    except Exception:
        pass

    difficulty_map = {"easy": "basic recall", "medium": "understanding and application", "hard": "deep reasoning", "mixed": "mix of all levels"}
    type_map = {"mcq": "multiple choice with 4 options (A-D)", "short": "short answer (1-3 sentences)", "long": "long-form paragraph answers", "mixed": "mix of MCQ and short-answer"}

    prompt = f"""You are a strict JSON generator.

Generate exactly {num_q} questions based ONLY on the CONTENT below.
Question type: {q_type} — {type_map.get(q_type, q_type)}
Difficulty: {difficulty_map.get(difficulty, difficulty)}

{TYPE_RULES.get(q_type, '')}

Do NOT reference figures, examples, tables, or page numbers from the PDF. Each question must be self-contained.

FORMAT:
{FORMAT_EXAMPLES.get(q_type, '')}

CONTENT:
{selected_content}"""

    if existing_questions:
        prompt += "\n\nDO NOT repeat these questions:\n" + "\n".join(f"- {q}" for q in existing_questions)

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
