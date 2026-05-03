# XamBuddy Admin Panel — Progress & Status
**Last Updated**: May 3, 2026

---

## Architecture
- **Frontend**: React + Vite on Vercel, Supabase auth
- **Backend**: Python FastAPI as Vercel serverless function (`main.py`)
- **Database**: Supabase PostgreSQL via REST API (PostgREST over HTTPS)
- **Storage**: Supabase Storage bucket `pdf-uploads`
- **AI**: Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) for all extraction and generation

---

## Section A — Question Paper Bank

### Done
- Basic PDF upload UI for exam papers and answer keys (stored in Supabase Storage, metadata in `pdf_uploads` table)
- Cascading dropdowns (board → grade → subject) to list uploaded papers
- Delete removes record and storage files
- Extract every question from uploaded question paper PDFs using Claude (`/api/extract-paper`)
- Store extracted questions in `exam_questions` table with full spec schema plus extra columns: `question_number`, `has_diagram`, `paper_pdf_url`, `answer_pending`
- Question types supported in extraction: MCQ, VSA, SA, LA, CBQ, and AR (Assertion & Reason)
- Match answer key answers to questions by question number (`/api/match-answer-key`)
- Combined/multi-set answer key support (extracts answers for a specific set number only)
- Flag unanswered questions as `answer_pending = true`; cleared to `false` when answer is matched
- Re-upload answer key for a paper later and re-run matching (UI in ExamPaperUploads.jsx)
- Store correct MCQ/AR option (A/B/C/D) in `correct_answer`
- Duplicate detection before storing: exact-match fingerprint + 80% Jaccard similarity; logs skipped count in API response
- Auto-tag difficulty level per question (Easy/Medium/Hard) assigned by Claude during extraction
- `has_diagram` flag set per question; diagram description prepended to `question_text`
- Bulk exam paper folder upload: parses folder structure, auto-detects year, set number, subject from filenames (ExamPaperUploads.jsx)
- Papers table view grouped by `source_paper_id` with subject, board, year, exam_type, question count (ExamPaperRetrieve.jsx)
- Click into a paper to view all extracted questions with answers (ExamPaperRetrieve.jsx)
- Keywords extracted from answer key matches and stored in `keywords_json` per question
- Guide/reference book PDF upload slot: stored in `reference_uploads` table, not copied into question bank (`/api/upload-reference`, `/api/reference-uploads`)

### Not Done
- "Answer key matched" status indicator per paper in the papers table view (ExamPaperRetrieve shows question count but no explicit matched/pending flag per paper)
- Processing status column per paper (no `status` field — extraction either succeeds or errors to the log)

---

## Section B — Chapter Content & Question Generator

### Done
- Upload chapter PDF → send full text to Claude → generate questions → save to DB
- Question types supported: MCQ, VSA, Short Answer (SA), Long Answer (LA), Conceptual, CBQ, Mixed
- Prompt rules for each type aligned to spec (difficulty tiers, answer word limits, answer structure)
- MCQ correct answer distribution rule (A/B/C/D ≤30% each) enforced in prompt
- Coverage rule: Claude instructed to generate proportionally across entire chapter
- Exact-match duplicate detection before storing
- **Chapter analysis**: detect practical vs theory split from PDF content via Claude; store as `practical_pct`/`theory_pct` in `chapter_meta` table; apply subject-level defaults (e.g. Biology 85% theory, Maths 90% practical) but override from PDF
- Practical/theory ratio controls question mix: prompt calculates `practical_count` and `theory_count` per run
- **80% text similarity** duplicate check using Jaccard similarity (threshold 0.8)
- Extract and store keywords per answer in `keywords_json`
- `is_practical` boolean stored per question
- Headings extracted from chapter and stored in `chapter_meta.headings`
- PDF text reads up to 80,000 chars (was 18,000)
- Post-generation coverage check: confirms at least one question per heading; auto-generates 1 SA + 1 MCQ for any uncovered heading (`_run_coverage_check`)
- Admin dashboard shows existing vs newly generated questions side by side
- "Generate All" button: generates ~150 questions across all types in 7 batches with per-batch progress bar
- Chapter title auto-extracted from PDF first page via Claude (`/api/extract-chapter-title`); cached in `chapter_meta` by filename
- Bulk chapter folder upload: parses folder by subject, auto-extracts titles from filename (strips "Chapter N" prefix), editable before generation (BulkUpload.jsx)
- Default board is **Stateboard**; boards available: Stateboard, CBSE, ICSE
- **Answer PDF pairing**: folder may contain `answers-1.pdf` / `answers-2.pdf` alongside chapter PDFs; split evenly across chapters (odd chapter count → middle chapter gets both); passed to `/api/generate` as `answers_file` / `answers_file_2`
- Bulk upload resumes correctly on re-run: fetches existing counts from `/api/stats` at start, skips completed types, tops up partial ones — no duplicates
- Re-use stored chapter PDF from Supabase Storage for re-generation (no re-upload needed)
- Chapter history table: shows all chapters with generation stats
- Chapter mismatch check: validates chapter name against PDF content before generating; logs error and aborts if mismatch; always sends `title_edited: true` in bulk upload to skip mismatch for non-English (Kannada) chapter PDFs
- **PDF Splitter tool** (BulkUpload.jsx + `/api/split-pdf/preview` + `/api/split-pdf/download`): upload a full textbook PDF → detects Contents page automatically (embedded bookmarks → text scan → font-size detection) → extracts chapter titles + printed page numbers → page immediately after Contents = book page 1, all earlier pages excluded → each chapter split by exact page range → packaged as ZIP
- **PDF Splitter screenshot fallback**: when auto-detection fails (e.g. Kannada/non-English TOC), user drops 1–3 screenshots of the Contents/Index page(s) + enters the PDF page number of the first Contents page; Claude vision reads all screenshots in one call and extracts only top-level chapter headings (sub-topics like 1.1, 1.2 ignored); multiple images supported for TOCs that span 2+ pages
- **PDF Splitter screenshot page mapping**: physical page for each chapter resolved via `_split_find_content_start_idx` — scans the 10 pages immediately after the last TOC page, finds the first visible margin number, and anchors printed page 1 from there; adapts automatically to books with 0, 1, or 2 unnumbered opener/blank pages between TOC and content; `final_cp` passed to this function = `first_cp + num_toc_images − 1` (last TOC page, 1-indexed); full PDF margin scan disabled in screenshot mode to avoid false anchors from chapter-opener spreads
- **PDF Splitter non-English handling**: `_split_detect_body_font_size` calibrates threshold using English-only text spans; `_split_find_chapters_by_font` skips pages with no English content; font-size detection now works correctly for bilingual PDFs (e.g. KTBS Karnataka state board) where Kannada text would otherwise inflate the body-size threshold

### Not Done
- Rename/migrate `questions` table to `generated_questions` (still `questions`)
- Separate `class_level` and `board` columns in `questions` table (currently combined in `exam` field, e.g. "10th CBSE Board")
- `times_served` and `last_served_at` fields not in current schema
- Keyword count validation before insert: reject SA with fewer than 3 keywords, LA with fewer than 6 — not enforced in `_ai_item_is_clean_for_db`

---

## Section C — Admin UI

### Done
- Upload chapter PDF and trigger generation (GenerateQuestions.jsx)
- View existing questions per chapter, filter by type and difficulty (RetrieveQuestions.jsx)
- Upload exam paper + answer key, single and bulk folder (ExamPaperUploads.jsx)
- Bulk chapter folder upload with per-chapter generation (BulkUpload.jsx)
- Error Log page: failed uploads, stage, error message (ErrorLog.jsx + `/api/errors`)
- Dashboard: drillable question inventory exam → subject → chapter with type breakdown (Dashboard.jsx)
- Retrieve Chapter PDFs page (RetrieveChapterPdfs.jsx)
- Edit individual questions inline (RetrieveQuestions.jsx + `PATCH /api/questions/{id}`)
- Delete individual questions (RetrieveQuestions.jsx + `DELETE /api/questions/{id}`)
- Click into a paper → view all extracted questions with answers (ExamPaperRetrieve.jsx)
- Supabase Auth: admin login + protected routes (AdminLogin.jsx, ProtectedRoute)
- Sidebar navigation with 8 tabs
- Batch generation progress bar ("Generate All" flow in GenerateQuestions.jsx)
- **Split Textbook PDF panel** in BulkUpload.jsx: collapsible UI with PDF upload, chapter preview table, one-click ZIP download, and screenshot fallback section (drag-drop image + "Contents page # in PDF" input with clear instructions)

### Not Done
- Real-time step-by-step processing log during single PDF upload/generation (single-file uploads show a spinner only, not a step-by-step log)
- Post-processing summary screen: questions generated, duplicates skipped, practical/theory split detected — API returns this data but the frontend only shows the question count; no dedicated summary view

---

## Section D — Quality & Accuracy Checks

### Done
- MCQ: exactly 4 options required, answer must be A/B/C/D (enforced in `_ai_item_is_clean_for_db`)
- SA/LA: answer minimum 20 chars
- VSA: answer minimum 5 chars
- CBQ: passage ≥ 20 chars and at least 1 sub-question required
- Post-generation coverage check: auto-generates 1 SA + 1 MCQ per uncovered heading (`_run_coverage_check`)
- Paper-extracted questions with no matched answer get `answer_pending = true` instead of being blocked

### Not Done
- Reject SA answers with fewer than 3 domain-relevant keywords
- Reject LA answers with fewer than 6 domain-relevant keywords
- Question text must end with `?` — not enforced; falls through in `_ai_item_is_clean_for_db`

---

## Section E — Database Integrity

### Done
- Error logging to `processing_errors` table via `_log_error` (backend)
- Frontend error logging via `POST /api/log`
- Admin-facing error log: endpoint, stage, error message, timestamp (ErrorLog.jsx + `/api/errors`)
- Chapter mismatch errors logged before aborting generation

### Not Done
- Wrap all multi-step inserts in transactions; roll back on any failure — not possible via Supabase PostgREST; partial data can remain on mid-process failure
- Option to re-process a failed upload directly from the error log UI

---

## API Endpoints (current)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check + API key status |
| GET | `/api/retrieve` | Retrieve questions from `questions` table with filters |
| GET | `/api/stats` | Question counts by exam/subject/chapter/type |
| GET | `/api/metadata` | Distinct boards, subjects, chapters |
| GET | `/api/meta/options` | Distinct exams and subjects (used by dropdowns) |
| GET | `/api/chapters` | Chapter list for exam+subject from `chapter_meta` |
| POST | `/api/generate` | Generate questions from chapter PDF |
| POST | `/api/extract-paper` | Extract questions from exam paper PDF |
| POST | `/api/match-answer-key` | Match answer key to extracted questions + extract keywords |
| POST | `/api/upload-reference` | Register a reference/guide book upload |
| GET | `/api/reference-uploads` | List reference uploads |
| PATCH | `/api/questions/{id}` | Edit a generated question |
| DELETE | `/api/questions/{id}` | Delete a generated question |
| GET | `/api/errors` | Fetch error log |
| POST | `/api/log` | Log a frontend error |
| POST | `/api/extract-chapter-title` | Extract chapter title from PDF first page |
| POST | `/api/split-pdf/preview` | Detect chapter boundaries in a PDF; returns chapter list with page ranges |
| POST | `/api/split-pdf/download` | Split PDF into chapters and stream as a ZIP file |
| POST | `/api/split-pdf/toc-from-image` | Extract chapter titles + page numbers from a single TOC screenshot using Claude vision |

---

## Known Constraints
- Vercel: no C extensions, no direct PostgreSQL, 250MB package limit — all DB access via Supabase REST API
- PDF extraction uses `pypdf` (pure Python); complex layouts or scanned PDFs may lose formatting
- PDF splitting uses `PyMuPDF` (fitz) for font-size analysis; scanned PDFs (no text layer) will not work
- No transaction support via Supabase REST API — multi-step operations can leave partial data on failure
