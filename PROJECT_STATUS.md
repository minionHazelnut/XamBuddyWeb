# XamBuddy Project Status
**Last Updated**: April 29, 2026

---

## Project Overview
XamBuddy is an educational platform for CBSE Class 10 and 12 students. The current build is an admin panel used to manage the question bank — uploading chapter PDFs and exam papers, running Claude-powered extraction and generation, and reviewing the resulting questions.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React + Vite, deployed on Vercel |
| Backend | Python FastAPI, deployed as a Vercel serverless function (`main.py`) |
| Database | Supabase PostgreSQL, accessed via PostgREST REST API |
| Storage | Supabase Storage (`pdf-uploads` bucket) |
| Auth | Supabase Auth (email/password), admin-only |
| AI | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) |

---

## Completed Features

### Backend (`main.py`)
- Supabase REST helpers (`_sb_get`, `_sb_post`, `_sb_patch`, `_sb_delete`)
- Error logging to `processing_errors` table (`_log_error`)
- Question generation from chapter PDFs: reads up to 80,000 chars, analyses practical/theory split, generates questions with Jaccard 80% similarity dedup, stores with `keywords_json` and `is_practical`
- Chapter analysis: detects practical/theory ratio, extracts headings, stores in `chapter_meta`
- Coverage check: after generation, auto-fills uncovered headings with 1 SA + 1 MCQ
- Chapter title extraction from PDF first page (`/api/extract-chapter-title`)
- Question paper extraction: extracts all questions from exam paper PDFs with type detection (MCQ, AR, VSA, SA, LA, CBQ), difficulty tagging, diagram detection
- Answer key matching: matches answers to extracted questions by question number, handles multi-set answer keys, extracts and stores keywords
- Reference upload registration (`reference_uploads` table)
- Edit and delete generated questions (`PATCH`/`DELETE /api/questions/{id}`)
- Full API endpoint list: see `docs/PROGRESS.md`
- Split-PDF endpoints: `/api/split-pdf/preview` (chapter detection) and `/api/split-pdf/download` (ZIP stream); uses PyMuPDF font-size analysis with watermark filtering

### Frontend (`src/`)
- **AdminLogin.jsx** — Supabase email/password login
- **AdminDashboard.jsx** — Sidebar shell with 8 tabs
- **Dashboard.jsx** — Drillable question inventory (exam → subject → chapter)
- **GenerateQuestions.jsx** — Single PDF upload + Generate All (150 questions, 7 batches, progress bar)
- **BulkUpload.jsx** — Bulk chapter folder upload with auto title extraction, editable chapter list, and built-in PDF splitter tool
- **RetrieveQuestions.jsx** — Filter, view, inline-edit, and delete generated questions
- **ExamPaperUploads.jsx** — Single and bulk exam paper + answer key uploads with filename-based auto-detection
- **ExamPaperRetrieve.jsx** — View papers and drill into extracted questions per paper
- **RetrieveChapterPdfs.jsx** — Browse stored chapter PDFs
- **ErrorLog.jsx** — View processing error log

---

## Remaining Work

See `docs/PROGRESS.md` for the full breakdown. High-level gaps:

- **Split PDF**: chapter detection is font-size heuristic based; scanned PDFs or PDFs with non-standard fonts may need threshold adjustment
- **Schema**: `questions` table still uses combined `exam` field instead of separate `class_level`/`board`; no `times_served`/`last_served_at`
- **Validation**: keyword count checks for SA/LA not enforced; question text `?` check not enforced
- **UI**: no real-time step-by-step progress log for single uploads; no dedicated post-processing summary screen
- **Integrity**: no transaction rollback (Supabase REST limitation); no re-process button in error log
- **Student side**: not started — pricing, auth for students, content gating, practice UI (see `docs/PRICING_AND_PAYMENTS.md`)

---

## Database Tables

| Table | Purpose |
|---|---|
| `questions` | Generated questions from chapter PDFs |
| `chapter_meta` | Chapter analysis results (practical/theory split, headings) |
| `exam_questions` | Questions extracted from past exam papers |
| `pdf_uploads` | Exam paper upload metadata |
| `reference_uploads` | Guide/reference book upload metadata |
| `processing_errors` | Backend error log |
