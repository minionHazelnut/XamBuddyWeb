from fastapi import FastAPI, HTTPException, Query, Depends, Request, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional, List, Dict, Any, Literal
import json
import os
import httpx
import re
import random
import logging
from datetime import datetime
from jose import jwt as jose_jwt, JWTError
import jwt as pyjwt
import fitz
import anthropic
import psycopg2
from psycopg2 import OperationalError, DatabaseError

logger = logging.getLogger(__name__)

from database import get_db, Question, init_db

app = FastAPI(title="XamBuddy API", description="Educational Platform API")

# Supabase JWT config - reads from environment variables
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "") or os.environ.get("CLAUDE_API_KEY", "")

# ---------- Generate helpers ----------

_DEFAULT_DATABASE_URL = "postgresql+asyncpg://postgres:xambuddypwd@139.59.93.35:5432/xambuddydb"


def _normalize_psycopg2_dsn(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + url[len("postgresql+asyncpg://"):]
    return url


def get_db_connection():
    raw = os.getenv("DATABASE_URL", _DEFAULT_DATABASE_URL)
    dsn = _normalize_psycopg2_dsn(raw.strip())
    return psycopg2.connect(dsn)


def _difficulty_for_db(difficulty: str) -> str:
    if difficulty == "mixed":
        return "medium"
    return difficulty


def _question_type_for_db(q_type: str, item: dict) -> str:
    if q_type == "mixed":
        return item.get("question_type") or "short"
    if q_type == "conceptual":
        return "long"
    return q_type


def _exact_question_fingerprint(text: str) -> str:
    s = (text or "").strip().lower()
    return re.sub(r"\s+", " ", s)


def _question_row_exists(cur, exam, subject, chapter, diff_db, row_type, norm_text: str) -> bool:
    if not norm_text:
        return True
    cur.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM questions
            WHERE exam = %s
              AND subject = %s
              AND chapter IS NOT DISTINCT FROM %s
              AND difficulty = %s
              AND question_type = %s
              AND lower(
                    trim(
                        both ' ' FROM regexp_replace(question_text, '[[:space:]]+', ' ', 'g')
                    )
                  ) = %s
        )
        """,
        (exam, subject, chapter or None, diff_db, row_type, norm_text),
    )
    return cur.fetchone()[0]


def _ai_item_is_clean_for_db(q: dict, row_type: str) -> bool:
    qt = (q.get("question") or "").strip()
    if len(qt) < 3:
        return False
    if qt[0] in "[{":
        return False
    if "```" in qt:
        return False
    low = qt[:80].lower()
    if low.startswith('"question"') or low.startswith("'question'"):
        return False
    if row_type == "mcq":
        opts = q.get("options")
        if not isinstance(opts, dict) or len(opts) < 2:
            return False
    return True


def save_questions(questions, q_type, difficulty, subject, exam, chapter: str = ""):
    diff_db = _difficulty_for_db(difficulty)
    chapter_db = chapter.strip() or None
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            for q in questions:
                qtext_raw = q.get("question") or ""
                row_type = _question_type_for_db(q_type, q)
                if not _ai_item_is_clean_for_db(q, row_type):
                    logger.warning("Skipping malformed AI question item: %s...", qtext_raw[:120])
                    continue
                norm = _exact_question_fingerprint(qtext_raw)
                if not norm:
                    continue
                if _question_row_exists(cur, exam, subject, chapter_db, diff_db, row_type, norm):
                    continue
                if row_type == "mcq" and q.get("options") is not None:
                    opts = json.dumps(q["options"])
                else:
                    opts = None
                ans = q.get("answer")
                if ans is not None:
                    ans = str(ans)
                expl = q.get("explanation")
                if expl is not None:
                    expl = str(expl)
                else:
                    expl = ""
                cur.execute(
                    """
                    INSERT INTO questions (
                        exam, subject, chapter, question_text, question_type,
                        difficulty, options, correct_answer, explanation
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    (exam, subject, chapter_db, qtext_raw.strip(), row_type,
                     diff_db, opts, ans, expl),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row_to_api_item(row, for_mixed_pool: bool):
    (_id, _exam, _subj, _chapter, question_text, qtype, _diff,
     options, correct_answer, explanation, _ts) = row
    item = {
        "question": question_text or "",
        "answer": correct_answer if correct_answer is not None else "",
        "explanation": explanation if explanation is not None else "",
    }
    if qtype == "mcq" and options is not None:
        if isinstance(options, str):
            item["options"] = json.loads(options)
        else:
            item["options"] = options
    if for_mixed_pool:
        item["question_type"] = qtype
    return item


def _db_question_type_filter(q_type: str):
    if q_type == "mixed":
        return "question_type IN ('mcq', 'short')", []
    if q_type == "conceptual":
        return "question_type = %s", ["long"]
    return "question_type = %s", [q_type]


def get_cached_questions(q_type, difficulty, subject, exam, chapter: str, limit,
                         order: Literal["newest", "random"] = "newest"):
    if limit <= 0:
        return []
    diff_db = _difficulty_for_db(difficulty)
    order_sql = "ORDER BY RANDOM()" if order == "random" else "ORDER BY created_at DESC"
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            type_sql, type_params = _db_question_type_filter(q_type)
            chapter_clause = "chapter IS NOT DISTINCT FROM %s"
            params = [exam, subject, chapter.strip() or None, diff_db] + type_params + [limit]
            cur.execute(
                f"""
                SELECT id, exam, subject, chapter, question_text, question_type, difficulty,
                       options, correct_answer, explanation, created_at
                FROM questions
                WHERE exam = %s AND subject = %s AND {chapter_clause}
                  AND difficulty = %s AND ({type_sql})
                {order_sql}
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    for_mixed = q_type == "mixed"
    return [_row_to_api_item(r, for_mixed) for r in rows]


def extract_text(file_bytes):
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return text


def get_random_chunks(text, chunk_size=800, num_chunks=3):
    chunks = [text[i: i + chunk_size] for i in range(0, len(text), chunk_size)]
    return " ".join(random.sample(chunks, min(num_chunks, len(chunks))))


FORMAT_EXAMPLES = {
    "mcq": """[
  {
    "question": "string",
    "options": {"A": "option text", "B": "option text", "C": "option text", "D": "option text"},
    "answer": "A",
    "explanation": "string"
  }
]""",
    "short": """[
  {"question": "string", "answer": "string", "explanation": "string"}
]""",
    "long": """[
  {"question": "string", "answer": "string", "explanation": "string"}
]""",
    "conceptual": """[
  {"question": "string", "answer": "string", "explanation": "string"}
]""",
    "mixed": """[
  {"question_type": "mcq", "question": "string", "options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "answer": "A", "explanation": "string"},
  {"question_type": "short", "question": "string", "answer": "string", "explanation": "string"}
]""",
}

TYPE_RULES = {
    "mcq": """
Multiple choice ONLY.
Each item MUST:
- Have exactly 4 options labeled A, B, C, D
- Have answer as a single letter: A, B, C, or D
- Include question, options, correct_answer, explanation
CRITICAL RULES:
1. Do NOT modify or rephrase option text — only reorder options if needed.
2. The correct answer position should be reasonably distributed across A, B, C, D.
3. You MAY shuffle option order to change answer position.
4. Ensure correct_answer always matches the correct option after shuffling.
5. Return ONLY valid JSON. No markdown, no ```json, no extra text.
""",
    "short": """
Short answer ONLY.
Each item MUST include: question, answer (1–3 sentences), explanation.
No options. No MCQ fields. Include key terms required for scoring marks.
Return ONLY valid JSON array.
""",
    "long": """
Long answer ONLY.
Each item MUST include: question, answer (detailed), explanation.
No options. Focus on "why", "how", conceptual understanding.
Return ONLY valid JSON array.
""",
    "mixed": """
Include a mix of MCQ and short questions.
Each item MUST include: question_type ("mcq" or "short").
MCQ: options (A–D), correct_answer. Short: answer text only.
Return ONLY valid JSON array.
""",
}

MAX_TOKENS_FOR_TYPE = {
    "mcq": 8192, "short": 8192, "long": 8192, "conceptual": 8192, "mixed": 8192,
}


def _strip_markdown_code_fence(text: str) -> str:
    t = text.strip()
    if not t.startswith("```"):
        return t
    lines = t.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    while lines and lines[-1].strip() == "":
        lines.pop()
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _extract_json_array_string(text: str) -> str | None:
    s = _strip_markdown_code_fence(text)
    start = s.find("[")
    if start == -1:
        return None
    depth = 0
    in_str = False
    i = start
    n = len(s)
    while i < n:
        ch = s[i]
        if in_str:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            i += 1
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return s[start: i + 1]
        i += 1
    return None


def _parse_ai_questions_json(raw: str, stop_reason: str | None) -> tuple[list | None, str | None]:
    json_str = _extract_json_array_string(raw)
    if not json_str:
        return None, "Could not find a JSON array in the model output."
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        hint = ""
        if stop_reason == "max_tokens":
            hint = (" Output was likely cut off at the token limit. Try fewer questions per request, "
                     "or use short/MCQ types.")
        return None, f"JSON parse error: {e}.{hint}"
    if not isinstance(data, list):
        return None, "Model output was not a JSON array."
    return data, None


@app.on_event("startup")
async def startup_event():
    await init_db()

# --- Auth dependency ---

_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        _jwks_client = pyjwt.PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


async def get_current_user(request: Request) -> dict:
    """Verify Supabase JWT from Authorization header and return the user payload."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.split(" ", 1)[1]

    try:
        header = pyjwt.get_unverified_header(token)
        alg = header.get("alg", "")
    except pyjwt.exceptions.DecodeError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token header: {e}")

    try:
        if alg.startswith("HS"):
            # Legacy HS256 shared secret
            if not SUPABASE_JWT_SECRET:
                raise HTTPException(status_code=500, detail="Server auth not configured")
            payload = pyjwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            # ES256 / asymmetric keys — fetch public key from Supabase JWKS
            if not SUPABASE_URL:
                raise HTTPException(status_code=500, detail="SUPABASE_URL not configured")
            jwks_client = _get_jwks_client()
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = pyjwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "ES384", "RS256", "EdDSA"],
                audience="authenticated",
            )
    except pyjwt.exceptions.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    return payload

# --- Public endpoints ---

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }

@app.get("/api/retrieve")
async def retrieve_questions(
    exam: Optional[str] = Query(None, description="Exam type"),
    subject: Optional[str] = Query(None, description="Subject name"),
    chapter: Optional[str] = Query(None, description="Chapter name"),
    difficulty: Optional[str] = Query(None, description="Difficulty level: easy, medium, hard"),
    q_type: Optional[str] = Query(None, description="Question type: mcq, short, long"),
    limit: Optional[int] = Query(50, description="Maximum number of questions to return"),
    shuffle: Optional[str] = Query("false", description="Shuffle questions: true/false"),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve questions based on filters."""
    try:
        query = select(Question)

        if subject:
            query = query.where(Question.subject.ilike(f"%{subject}%"))
        if difficulty:
            query = query.where(Question.difficulty == difficulty)
        if exam:
            query = query.where(Question.exam == exam)
        if chapter:
            query = query.where(Question.chapter.ilike(f"%{chapter}%"))
        if q_type:
            query = query.where(Question.question_type == q_type)
        if limit:
            query = query.limit(limit)

        result = await db.execute(query)
        questions = result.scalars().all()

        if shuffle == "true":
            import random
            questions = list(questions)
            random.shuffle(questions)

        questions_data = []
        for q in questions:
            questions_data.append({
                "id": q.id,
                "question": q.question,
                "answer": q.answer,
                "subject": q.subject,
                "difficulty": q.difficulty,
                "exam": q.exam,
                "chapter": q.chapter,
                "question_type": q.question_type,
                "options": q.options,
                "explanation": q.explanation,
                "created_at": q.created_at.isoformat() if q.created_at else None
            })

        return {
            "success": True,
            "count": len(questions_data),
            "questions": questions_data,
            "filters": {"exam": exam, "subject": subject, "difficulty": difficulty}
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving questions: {str(e)}")

@app.get("/api/subjects")
async def get_subjects(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Question.subject).distinct())
        subjects = [row[0] for row in result.fetchall()]
        return {"success": True, "subjects": subjects}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving subjects: {str(e)}")

@app.get("/api/metadata")
async def get_metadata(db: AsyncSession = Depends(get_db)):
    try:
        boards_result = await db.execute(select(Question.exam).distinct())
        boards = [row[0] for row in boards_result.fetchall() if row[0]]

        subjects_result = await db.execute(select(Question.subject).distinct())
        subjects = [row[0] for row in subjects_result.fetchall() if row[0]]

        chapters_result = await db.execute(select(Question.chapter).distinct())
        chapters = [row[0] for row in chapters_result.fetchall() if row[0]]

        return {
            "success": True,
            "boards": sorted(boards),
            "subjects": sorted(subjects),
            "chapters": sorted(chapters)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving metadata: {str(e)}")

@app.get("/api/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Return question counts grouped by exam, subject, chapter, and question_type."""
    try:
        result = await db.execute(
            select(
                Question.exam,
                Question.subject,
                Question.chapter,
                Question.question_type,
                func.count().label("count")
            )
            .group_by(Question.exam, Question.subject, Question.chapter, Question.question_type)
            .order_by(Question.exam, Question.subject, Question.chapter, Question.question_type)
        )
        rows = result.fetchall()

        stats = []
        for row in rows:
            stats.append({
                "exam": row[0],
                "subject": row[1],
                "chapter": row[2],
                "question_type": row[3],
                "count": row[4]
            })

        return {"success": True, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving stats: {str(e)}")

@app.get("/api/subjects/{board}")
async def get_subjects_by_board(board: str, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Question.subject).where(Question.exam == board).distinct())
        subjects = [row[0] for row in result.fetchall() if row[0]]
        return {"success": True, "subjects": sorted(subjects)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving subjects for board {board}: {str(e)}")

@app.get("/api/chapters/{board}/{subject}")
async def get_chapters_by_board_subject(board: str, subject: str, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(
            select(Question.chapter)
            .where(Question.exam == board, Question.subject == subject)
            .distinct()
        )
        chapters = [row[0] for row in result.fetchall() if row[0]]
        return {"success": True, "chapters": sorted(chapters)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving chapters: {str(e)}")

# --- Admin-only endpoints (require auth) ---

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
    """Generate questions from PDF using Claude API."""
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=500, detail="Claude API key not configured")
    if num_q < 1:
        raise HTTPException(status_code=400, detail="num_q must be at least 1.")
    if not chapter or not chapter.strip():
        raise HTTPException(status_code=400, detail="chapter is required.")


    content = await file.read()
    try:
        text = extract_text(content)
    except fitz.FileDataError:
        raise HTTPException(
            status_code=400,
            detail="Could not read that file as a PDF. Upload a real PDF (not a Word/image file renamed to .pdf).",
        )

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="No text found in the PDF. Try a different file or one with selectable text.",
        )

    selected_content = get_random_chunks(text)

    # Fetch existing question texts to avoid duplicates
    existing_questions = []
    try:
        existing = get_cached_questions(q_type, difficulty, subject, exam, chapter, 500)
        existing_questions = [q["question"] for q in existing if q.get("question")]
    except Exception:
        pass

    difficulty_map = {
        "easy": "basic recall", "medium": "understanding and application",
        "hard": "deep reasoning", "mixed": "mix of all levels",
    }
    type_map = {
        "mcq": "multiple choice with 4 options (A–D), letter answer, explanation",
        "short": "short answer (1–3 sentences per answer), no choices",
        "long": "long-form paragraph answers, why/how conceptual answers (paragraph), no choices",
        "mixed": "mix of MCQ and short-answer style items as in FORMAT",
    }

    format_example = FORMAT_EXAMPLES[q_type]
    type_rule = TYPE_RULES[q_type]
    max_out = MAX_TOKENS_FOR_TYPE[q_type]

    prompt = f"""
You are a strict JSON generator.

Generate exactly {num_q} questions based ONLY on the CONTENT below.

User-selected question type: {q_type}
Difficulty focus: {difficulty_map[difficulty]}
Style: {type_map[q_type]}

CRITICAL — follow this type exactly:
{type_rule}
If the type is not "mcq", you MUST NOT output "options" or A/B/C/D choices.

RULES:
- Return ONLY valid JSON (one array). Do NOT wrap in markdown code fences (no ```).
- No markdown, no headings, no text outside the JSON array
- The entire JSON must be complete and parseable — if you run out of space, shorten answers; never stop mid-quote or mid-string.
- Do NOT reference specific examples, figures, diagrams, tables, or page numbers from the source material (e.g. "In Example 3..." or "As shown in Figure 2..."). Students will not have access to the PDF. Each question must be fully self-contained and understandable on its own.

FORMAT (match this structure exactly for type "{q_type}"):

{format_example}

CONTENT:
{selected_content}
"""

    if existing_questions:
        dedup_list = "\n".join(f"- {q}" for q in existing_questions)
        prompt += f"""

ALREADY GENERATED (do NOT repeat or rephrase these — generate completely NEW and DIFFERENT questions):
{dedup_list}
"""

    claude_client = anthropic.Anthropic()
    response = claude_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_out,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text
    stop_reason = getattr(response, "stop_reason", None)
    if stop_reason == "max_tokens":
        logger.warning("Claude stopped at max_tokens; JSON may be incomplete (q_type=%s)", q_type)

    data, parse_err = _parse_ai_questions_json(raw, stop_reason)
    if parse_err:
        err = {"error": parse_err, "raw": raw}
        if stop_reason == "max_tokens":
            err["hint"] = (
                "Model hit the output limit. Try generating fewer questions at once, "
                "or use short-answer / MCQ mode for this chapter."
            )
        return err

    try:
        save_questions(data, q_type, difficulty, subject, exam, chapter)
    except (OperationalError, DatabaseError) as e:
        logger.exception("Database error while saving questions")
        raise HTTPException(
            status_code=503,
            detail="Generated questions but could not save them. Try again later.",
        ) from e

    return {"questions": data}

@app.post("/api/questions")
async def add_question(
    question: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user)
):
    """Add a new question (admin only)."""
    try:
        new_question = Question(
            question_text=question.get("question"),
            correct_answer=question.get("answer"),
            subject=question.get("subject"),
            difficulty=question.get("difficulty", "medium"),
            exam=question.get("exam"),
            chapter=question.get("chapter"),
            question_type=question.get("question_type", "short")
        )

        db.add(new_question)
        await db.commit()
        await db.refresh(new_question)

        return {
            "success": True,
            "message": "Question added successfully",
            "question": {
                "id": new_question.id,
                "question": new_question.question,
                "answer": new_question.answer,
                "subject": new_question.subject,
                "difficulty": new_question.difficulty,
                "exam": new_question.exam,
                "chapter": new_question.chapter,
                "question_type": new_question.question_type,
                "options": new_question.options,
                "explanation": new_question.explanation,
                "created_at": new_question.created_at.isoformat() if new_question.created_at else None
            }
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Error adding question: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
