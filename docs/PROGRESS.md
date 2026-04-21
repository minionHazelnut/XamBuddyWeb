# XamBuddy Admin Panel — Progress & Status
**Last Updated**: April 20, 2026

---

## Architecture
- **Frontend**: React + Vite on Vercel, Supabase auth
- **Backend**: Python FastAPI as Vercel serverless function (`main.py`)
- **Database**: Supabase PostgreSQL via REST API (PostgREST over HTTPS)
- **Storage**: Supabase Storage bucket `pdf-uploads`

---

## Section A — Question Paper Bank

### Done
- Basic PDF upload UI for exam papers and answer keys (stored in Supabase Storage, metadata in `pdf_uploads` table)
- Cascading dropdowns (board → grade → subject) to list uploaded papers
- Delete removes record and storage files

### Not Done
- Extract every question from uploaded question paper PDFs using Claude
- Store extracted questions in `exam_questions` table (spec-defined schema: `id`, `question_text`, `question_type`, `marks`, `subject`, `class_level`, `board`, `year`, `exam_type`, `chapter`, `correct_answer`, `options_json`, `difficulty_level`, `source_paper_id`, `created_at`)
- Match answer key answers to questions by question number
- Flag unanswered questions as "answer pending"
- Re-upload answer key for a paper later and re-run matching
- Store correct MCQ option (A/B/C/D) separately
- Duplicate detection: skip exact duplicate question text, log "X duplicates skipped" to admin
- Auto-tag difficulty level per question (Easy / Medium / Hard) using the spec rules
- Show table of all uploaded papers with: processing status, question count, answer key matched status
- Click into a paper to view all extracted questions and answers
- Guide/reference book PDF upload slot (stored in `reference_uploads` table, not copied into question bank)

---

## Section B — Chapter Content & Question Generator

### Done
- Upload chapter PDF → send full text to Claude → generate questions → save to DB
- Question types supported: MCQ, Short Answer (SA), Long Answer (LA), CBQ, Mixed
- Prompt rules for each type aligned to spec (difficulty tiers, answer word limits, answer structure)
- MCQ correct answer distribution rule (A/B/C/D ≤30% each) in prompt
- Coverage rule: Claude instructed to generate proportionally across entire chapter
- Exact-match duplicate detection before storing
- Admin dashboard shows existing vs newly generated questions side by side

### Not Done
- **Step 1 — Chapter analysis**: detect practical vs theory split from PDF content; store as `practical_pct` / `theory_pct`; apply subject-level defaults (e.g. Biology 85% theory, Maths 90% practical) but override from PDF
- Practical/theory ratio must control the mix of questions generated within each type
- 80% text similarity duplicate check (current check is exact-match only)
- Extract and store keywords per answer in `keywords_json`
- `is_practical` boolean stored per question
- Rename/migrate table to `generated_questions` (currently `questions`) with full spec schema: `source_chapter_id`, `times_served`, `last_served_at`, `class_level`, `board` (currently collapsed into `exam`)
- PDF text currently truncated to 18,000 chars — must read entire chapter

---

## Section C — Admin UI

### Done
- Upload chapter PDF and trigger generation
- View existing questions per chapter
- Upload exam paper + answer key

### Not Done
- Upload progress indicator (real-time, step-by-step processing log while PDF is being analysed)
- Post-processing summary screen: questions generated, duplicates skipped, practical/theory split detected
- Question Paper Bank table: all papers, processing status, question count, answer key matched
- Click into a paper → view all extracted questions with answers
- Chapter Content table: all chapters with generation stats
- Click into a chapter → view all generated questions, filter by type and difficulty
- Edit or delete individual questions from the admin panel

---

## Section D — Quality & Accuracy Checks

### Done
- MCQ: exactly 4 options required, answer must be A/B/C/D
- SA/LA: answer length minimum enforced (rejects answers under 20 chars)

### Not Done
- Reject SA answers with fewer than 3 domain-relevant keywords
- Reject LA answers with fewer than 6 domain-relevant keywords
- Question text must end with `?` — check exists in code but falls through without rejecting ([main.py:98-100](../main.py#L98-L100))
- Post-generation coverage check: list all headings from chapter PDF, confirm at least one question per heading; if missing, auto-generate one SA + one MCQ for that heading
- Validate answers from paper uploads are not empty before storing

---

## Section E — Database Integrity

### Done
- None

### Not Done
- Wrap all multi-step inserts in transactions; roll back on any failure
- Do not leave partial data in DB if processing fails midway
- Admin-facing error log: failed uploads, which stage failed, option to re-process

---

## Known Constraints
- Vercel: no C extensions, no direct PostgreSQL (IPv6 only), 250MB package limit — all DB access via Supabase REST API
- PDF extraction uses `pypdf` (pure Python); complex layouts or scanned PDFs may lose formatting
