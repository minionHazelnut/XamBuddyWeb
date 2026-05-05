# XamBuddy Project Status
**Last Updated**: May 5, 2026

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
- Split-PDF endpoints: `/api/split-pdf/preview` and `/api/split-pdf/download`; detection chain: embedded bookmarks → text scan (any language) → font-size (English-only calibration); screenshot fallback via `toc_image` upload + `contents_physical_page` form param; visual page-match skipped when page number is explicitly provided; page-range formula in screenshot mode is `last_toc_page + printed_page − 1` (direct, no margin scan — margin scan was removed after it misread NCERT chapter-number headers as page numbers)
- `_is_fundamental_duties_page()`: filters out NCERT "Fundamental Duties" boilerplate pages during PDF text extraction so they don't pollute generated questions
- `_parse_answer_hints_structured()`: Claude Haiku call that parses raw answers/hints PDF text into an exercise→question→answer lookup table; embedded directly in the `/api/generate` prompt so questions are answered from the textbook's own solutions
- Chapter tagging for exam paper questions: `POST /api/tag-exam-question-chapters` — fetches all `exam_questions` rows where `chapter IS NULL`, fetches chapter names + headings from `chapter_meta`, batches 80 questions at a time to Claude Haiku, PATCHes `chapter` field per question; runs from the DB only (no PDF re-upload needed)

### Frontend (`src/`)
- **AdminLogin.jsx** — Supabase email/password login
- **AdminDashboard.jsx** — Sidebar shell with 8 tabs
- **Dashboard.jsx** — Drillable question inventory (exam → subject → chapter)
- **GenerateQuestions.jsx** — Single PDF upload + Generate All (150 questions, 7 batches, progress bar)
- **BulkUpload.jsx** — Bulk chapter folder upload: titles extracted from filenames (strips "Chapter N"), default board Stateboard, answer PDF pairing (answers-1/2 split evenly across chapters), manual answer key override (drag-drop up to 2 PDFs applied to all chapters), built-in PDF splitter with screenshot fallback
- **RetrieveQuestions.jsx** — Filter, view, inline-edit, and delete generated questions
- **ExamPaperUploads.jsx** — Single and bulk exam paper + answer key uploads with filename-based auto-detection; "Tag Questions by Chapter" panel to batch-classify all extracted questions using `chapter_meta` headings; boards normalised to Stateboard/CBSE/ICSE; Social Science added to subject list
- **ExamPaperRetrieve.jsx** — View papers and drill into extracted questions per paper
- **RetrieveChapterPdfs.jsx** — Browse stored chapter PDFs
- **ErrorLog.jsx** — View processing error log

---

## Remaining Work

See `docs/PROGRESS.md` for the full breakdown. High-level gaps:

- **Split PDF**: auto-detection still fails for fully scanned PDFs (no text layer); screenshot fallback required in those cases; visual page-matching (cosine similarity on ink grid) only runs when no page number is provided
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
