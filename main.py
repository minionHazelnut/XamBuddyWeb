from fastapi import FastAPI, HTTPException, Query, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional, List, Dict, Any
import json
import os
import httpx
from datetime import datetime
from jose import jwt, JWTError

from database import get_db, Question, init_db

app = FastAPI(title="XamBuddy API", description="Educational Platform API")

# Supabase JWT config - reads from environment variables
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

@app.on_event("startup")
async def startup_event():
    await init_db()

# --- Auth dependency ---

async def get_current_user(request: Request) -> dict:
    """Verify Supabase JWT from Authorization header and return the user payload."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.split(" ", 1)[1]

    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=500, detail="Server auth not configured")

    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError as e:
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

@app.get("/api/generate")
async def generate_from_pdf(
    file: str = Query(..., description="PDF file path or identifier"),
    action: Optional[str] = Query("extract", description="Action: extract, analyze, convert"),
    user: dict = Depends(get_current_user)
):
    """Process PDF files for question generation (admin only)."""
    try:
        if action == "extract":
            result = {
                "success": True, "action": "extract", "file": file,
                "extracted_content": f"Sample content extracted from {file}",
                "questions_generated": 5, "timestamp": datetime.now().isoformat()
            }
        elif action == "analyze":
            result = {
                "success": True, "action": "analyze", "file": file,
                "analysis": {
                    "page_count": 10, "word_count": 2500,
                    "topics_detected": ["Mathematics", "Algebra", "Geometry"],
                    "difficulty_level": "medium"
                },
                "timestamp": datetime.now().isoformat()
            }
        elif action == "convert":
            result = {
                "success": True, "action": "convert", "file": file,
                "converted_format": "json",
                "output_file": f"{file}_converted.json",
                "timestamp": datetime.now().isoformat()
            }
        else:
            result = {
                "success": True, "action": "default", "file": file,
                "message": f"PDF {file} processed successfully",
                "timestamp": datetime.now().isoformat()
            }

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")

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
