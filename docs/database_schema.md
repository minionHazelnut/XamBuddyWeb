# XamBuddy Database — Complete Reference

**Last audited:** 2026-05-30  
**Database:** Supabase (PostgreSQL) — project `klfekdsdosqpymxcikjw`  
**Connection:** `postgresql+asyncpg://postgres:<pwd>@db.klfekdsdosqpymxcikjw.supabase.co:5432/postgres`  
**Supabase URL:** `https://klfekdsdosqpymxcikjw.supabase.co`  
**Credentials location:** `.env` — vars `SUPABASE_SERVICE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_DATABASE_PWD`

---

## Tables at a Glance

| Table | Rows | Purpose |
|---|---|---|
| `questions` | **39,156** | AI-generated questions (primary question bank) |
| `exam_questions` | **1,592** | Real exam paper questions extracted from PDFs |
| `chapter_meta` | **292** | Chapter metadata — practical/theory ratio, headings |
| `pdf_uploads` | **384** | Record of every PDF file uploaded (exam papers + chapter PDFs) |
| `processing_errors` | **562** | Error log from bulk upload and generation pipelines |
| `reference_uploads` | 0 | Reference guide/sample paper upload metadata (schema exists, no data yet) |
| `qpaper` | 0 | Unused table (schema exists, 0 rows) |
| `quiz_results` | 0 | Student quiz result storage (schema exists, 0 rows) |

**Storage bucket:** `pdf-uploads` (public)  
Sub-folders: `exam-papers/`, `answer-keys/`, `chapter-pdfs/`

---

## Table 1: `questions` — 39,156 rows

**Role:** The core generated question bank. All 39k+ AI-generated questions live here.

### Schema

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | integer (PK) | NO | Auto-increment integer primary key |
| `exam` | varchar(100) | YES | Board + grade string, e.g. `"10th CBSE Board"`, `"8th Stateboard Board"` |
| `subject` | varchar(100) | YES | Subject name, e.g. `"Science"`, `"Mathematics"`, `"Social Science"` |
| `chapter` | varchar(200) | YES | Chapter title as stored (0 NULLs — always filled) |
| `question_text` | text | NO | The question itself. For CBQ type: this is the passage text |
| `question_type` | varchar(50) | YES | `mcq`, `short`, `long`, `vsa`, `cbq` |
| `difficulty` | varchar(20) | YES | `easy`, `medium` (see critical note below) |
| `options` | jsonb | YES | For MCQ: `{"A":"...", "B":"...", "C":"...", "D":"..."}`. For CBQ: `{"sub_questions": [{question, answer, difficulty}, ...]}` |
| `correct_answer` | text | YES | Answer text. For MCQ: single letter `"A"`/`"B"`/`"C"`/`"D"`. For CBQ: NULL |
| `explanation` | text | YES | Step-by-step explanation or marking hints. NULL for 10,552 rows |
| `created_at` | timestamp | YES | Creation timestamp (no timezone) |
| `board` | text | YES | **ALWAYS NULL** — 0 rows filled. Board is encoded in `exam` column instead |
| `grade` | text | YES | **ALWAYS NULL** — 0 rows filled. Grade is encoded in `exam` column instead |
| `class_level` | text | YES | **ALWAYS NULL** — 0 rows filled |
| `is_practical` | boolean | NO | True if numerical/applied question. 9,844 practical, 29,312 theory |
| `keywords_json` | jsonb | NO | Array of keyword strings, e.g. `["additive inverse", "zero"]` (always filled) |
| `source_chapter_id` | uuid | YES | FK → `chapter_meta.id`. NULL for 5 rows only |
| `times_served` | integer | NO | How many times this question was served to a student. Default 0 (always filled) |
| `last_served_at` | timestamp | YES | Last time this question was served. Usually NULL |
| `embedding` | text | YES | Vector embedding stored as JSON string. Only 12,343 of 39,156 rows have this |

### Key Data Facts

**Difficulty distribution (critical):**
- `medium`: 39,151 (99.99% of all questions)
- `easy`: 5 (negligible)
- `hard`: **0 rows** — hard difficulty does not exist in this dataset

**Question type distribution:**
- `mcq`: 13,385
- `long`: 7,983
- `vsa`: 7,858
- `short`: 7,236
- `cbq`: 2,694

**Exam (board+grade) distribution:**
- `9th Stateboard Board`: 8,385
- `8th Stateboard Board`: 8,127
- `10th CBSE Board`: 6,927
- `9th CBSE Board`: 5,088
- `10th Stateboard Board`: 4,418
- `8th CBSE Board`: 4,852
- `6th CBSE Board`: 1,359

**Subject distribution (watch for dirty names):**
- `Social Science`: 10,250
- `Science`: 6,785 (note: `"Science "` with trailing space = 1,890 separate entries — data quality issue)
- `Mathematics`: 4,812
- `English`: 3,695
- `10th Stateboard socialscience part1`: 2,326
- `10th stateboard socialscience part2`: 2,092
- `8th Eng Maths `: 1,830 (trailing space — data quality issue)
- `Maths-2`: 1,596
- `Geography`: 1,054
- `Maths- 1`: 947 (space before 1 — data quality issue)
- `Civics`: 725
- `Economic Development`: 716
- `Biology`: 286
- `Physics`: 147
- `Psychology`: 5

**Data quality issues to be aware of:**
1. `difficulty` is virtually meaningless — everything is `medium`. No `hard` questions exist.
2. `board` and `grade` columns are always NULL — parse from `exam` string instead.
3. Subject names have inconsistencies: `"Science "` vs `"Science"`, `"Maths- 1"` vs `"Maths-2"`, `"8th Eng Maths "` (trailing spaces).
4. `embedding` only covers ~31% of questions (12,343/39,156).
5. `explanation` is NULL for ~27% of questions (10,552/39,156).

**Exam × Subject breakdown (full matrix):**

| Exam | Subject | Count |
|---|---|---|
| 6th CBSE Board | Mathematics | 1,359 |
| 8th CBSE Board | English | 681 |
| 8th CBSE Board | Maths- 1 | 947 |
| 8th CBSE Board | Maths-2 | 567 |
| 8th CBSE Board | Science | 1,596 |
| 8th CBSE Board | Social Science | 1,061 |
| 8th Stateboard Board | 8th Eng Maths  | 1,830 |
| 8th Stateboard Board | Science  | 1,890 |
| 8th Stateboard Board | Social Science | 4,407 |
| 9th CBSE Board | English | 1,125 |
| 9th CBSE Board | Mathematics | 1,108 |
| 9th CBSE Board | Maths-2 | 1,029 |
| 9th CBSE Board | Science | 1,826 |
| 9th Stateboard Board | Mathematics | 1,997 |
| 9th Stateboard Board | Science | 1,606 |
| 9th Stateboard Board | Social Science | 4,782 |
| 10th CBSE Board | Biology | 286 |
| 10th CBSE Board | Civics | 725 |
| 10th CBSE Board | Economic Development | 716 |
| 10th CBSE Board | English | 1,889 |
| 10th CBSE Board | Geography | 1,054 |
| 10th CBSE Board | Mathematics | 348 |
| 10th CBSE Board | Physics | 147 |
| 10th CBSE Board | Psychology | 5 |
| 10th CBSE Board | Science | 1,757 |
| 10th Stateboard Board | 10th Stateboard socialscience part1 | 2,326 |
| 10th Stateboard Board | 10th stateboard socialscience part2 | 2,092 |

### How to parse board/grade from `exam`
The `exam` field is the only reliable source for board and grade:
- Pattern: `"<grade> <board> Board"` → e.g. `"10th CBSE Board"`, `"8th Stateboard Board"`
- Known values: grades `6th`, `8th`, `9th`, `10th`; boards `CBSE`, `Stateboard`

---

## Table 2: `exam_questions` — 1,592 rows

**Role:** Real exam paper questions extracted from uploaded PDFs. This is the **ground-truth / reference dataset** for the validator. These came from actual CBSE board exam papers (currently only Class 10 CBSE 2025 papers).

### Schema

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid (PK) | NO | UUID primary key |
| `question_text` | text | — | The question text (verbatim from paper). For CBQ: includes passage |
| `question_type` | varchar | — | `mcq`, `vsa`, `sa`, `la`, `cbq`, `ar` (Assertion-Reason) |
| `marks` | integer | YES | Mark value (1, 2, 3, 4, 5, 10 etc.) |
| `subject` | varchar | — | Paper label string, e.g. `"2025 Science 31/4/3"`, `"2025 English 2/1/1"`, `"English"`, `"Social Science"` |
| `class_level` | varchar | — | Class number as string. Currently only `"10"` |
| `board` | varchar | — | Currently only `"CBSE"` |
| `year` | varchar | — | Paper year as string. Currently only `"2025"` |
| `exam_type` | varchar | — | `"board_exam"` (all rows currently) |
| `chapter` | text | YES | Chapter tag — NULL for most rows (1,592 rows, mostly untagged) |
| `correct_answer` | text | YES | Answer text. NULL for most rows (`answer_pending=True` for 1,041 rows) |
| `options_json` | jsonb | YES | For MCQ/AR: `{"A":"...", "B":"...", "C":"...", "D":"..."}`. For CBQ: `{"sub_questions": [{text, marks, number}, ...]}` |
| `difficulty_level` | varchar | YES | `"easy"`, `"medium"`, `"hard"` (all three exist here unlike `questions` table) |
| `answer_pending` | boolean | YES | True if answer has not been matched yet. 1,041 still pending |
| `source_paper_id` | uuid | — | Groups questions from the same paper. 43 unique papers |
| `created_at` | timestamp+tz | — | Creation timestamp |
| `keywords_json` | jsonb | YES | Keywords array |
| `question_number` | varchar | YES | Question number as printed in paper, e.g. `"1"`, `"2"` |
| `has_diagram` | boolean | YES | True if question involves a diagram. 98 rows with diagrams |
| `paper_pdf_url` | text | YES | Public URL to the source paper PDF/TXT in Supabase storage |

### Key Data Facts
- **All 1,592 rows are Class 10 CBSE 2025** — no other boards/grades yet
- **43 unique source papers** — each paper is a different set number (e.g. `"2025 Science 31/1/1"` = Science paper set 1/1/1)
- **Subject field is a paper label, not a clean subject name** — to get real subject, look at the label prefix (e.g. `"2025 Science..."` → Science, `"2025 English..."` → English)
- **1,041 questions still have no answer** (`answer_pending=True`) — answers are matched via separate answer key upload flow
- **Question types here differ from `questions` table**: uses `sa` (short answer) and `la` (long answer) and `ar` (assertion-reason) instead of `short`/`long`
- **This table = reference questions for the validator** — identifies real paper style, format, marks, difficulty

---

## Table 3: `chapter_meta` — 292 rows

**Role:** One row per chapter that has had a PDF uploaded. Stores AI-analysed content profile of each chapter, used to calibrate question generation.

### Schema

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid (PK) | NO | UUID primary key |
| `subject` | varchar | — | Subject name (matches `questions.subject`) |
| `exam` | varchar | — | Board+grade string (matches `questions.exam`) |
| `chapter` | varchar | — | Chapter title (matches `questions.chapter`) |
| `practical_pct` | integer | — | % of chapter that is practical/numerical (0–90) |
| `theory_pct` | integer | — | % of chapter that is theory/prose (0–100) |
| `headings` | jsonb | — | Array of heading/subheading strings found in the chapter |
| `created_at` | timestamp | — | When this chapter was first processed |
| `chapter_order` | integer | — | Ordering within subject (999 = unknown/unset) |
| `file_name` | varchar | YES | Relative path of source PDF, e.g. `"10th Grade/English/jeff107.pdf"` |

### Key Data Facts
- `practical_pct` range: 0–90; `theory_pct` range: 0–100
- `chapter_order = 999` means unknown/unset (many chapters have this)
- Covers all 7 exam types: `6th CBSE Board` through `10th Stateboard Board`
- The `headings` array quality varies — English chapters often have generic headings like `["BEFORE YOU READ", "Activity", "I"]`

---

## Table 4: `pdf_uploads` — 384 rows

**Role:** A record of every PDF file that was uploaded through the admin panel (exam papers, chapter PDFs). This is a metadata log — the actual files are in Supabase Storage.

### Schema

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | integer (PK) | NO | Auto-increment integer |
| `board` | varchar | YES | Board name, e.g. `"CBSE"`, `"Stateboard"` |
| `grade` | varchar | YES | Grade as string, e.g. `"10th"`, `"8th"` |
| `subject` | varchar | YES | Subject name |
| `chapter` | varchar | YES | Chapter title (NULL if exam paper, filled if chapter PDF) |
| `year` | varchar | YES | Year string, e.g. `"2025"` |
| `exam_type` | varchar | YES | `"board_exam"` or `"sample_paper"` |
| `exam_paper_pdf` | text | YES | Public URL to exam paper in `pdf-uploads/exam-papers/` |
| `answer_key_pdf` | text | YES | Public URL to answer key in `pdf-uploads/answer-keys/` |
| `chapter_pdf` | text | YES | Public URL to chapter PDF in `pdf-uploads/chapter-pdfs/` |
| `uploaded_at` | timestamp | — | Upload timestamp |

### Key Data Facts
- 384 rows = 384 PDF upload events
- Both exam papers and chapter PDFs are logged here

---

## Table 5: `processing_errors` — 562 rows

**Role:** Error log table. Every time the generation pipeline or bulk upload fails, an error is logged here. Used by the Error Log admin page.

### Schema

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid (PK) | NO | UUID |
| `endpoint` | varchar | YES | Which API endpoint triggered the error: `/api/generate`, `/api/extract-chapter-title`, `bulk-upload`, `bulk-qp-upload` |
| `stage` | varchar | YES | Processing stage: `batch_mcq`, `batch_short`, `batch_long`, `batch_vsa`, `batch_cbq`, `batch_conceptual`, `chapter_mismatch`, `chapter_summary`, `chapter_title_mismatch`, `claude_extract`, `extract_paper`, `json_parse_failed` |
| `error_message` | text | YES | Human-readable error description |
| `context_json` | jsonb | YES | Contextual data: exam, subject, chapter, q_type, num_q_generated, etc. |
| `created_at` | timestamp | YES | When the error occurred |

### Error Distribution
- `bulk-upload`: 419 errors (most common — background batch processing)
- `/api/generate`: 58 errors
- `/api/extract-chapter-title`: 53 errors
- `bulk-qp-upload`: 32 errors

---

## Table 6: `reference_uploads` — 0 rows (schema only)

**Role:** Tracks reference material uploads — guide books, sample question papers, or other reference docs for a board/grade/subject. The feature exists in the UI and API but no data has been uploaded yet.

### Schema (from code + column probing)

| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | UUID |
| `file_name` | varchar | Original file name |
| `upload_type` | varchar | `"guide_reference"`, `"sample_question"`, or `"other"` |
| `subject` | varchar | Subject name |
| `class_level` | varchar | Class number as string |
| `board` | varchar | Board name |
| `processing_notes` | text | Optional notes |
| `uploaded_at` | timestamp+tz | Upload timestamp (used for ordering) |

---

## Table 7: `qpaper` — 0 rows (schema only)

**Role:** Appears to be an older or planned table for question paper metadata. Currently 0 rows. Likely superseded by `pdf_uploads` + `exam_questions`.

### Schema (from column probing)

| Column | Type | Description |
|---|---|---|
| `id` | integer (PK) | Auto-increment |
| `board` | varchar | NOT NULL |
| `grade` | varchar | NOT NULL |
| `subject` | varchar | NOT NULL |
| `year` | varchar | NOT NULL |
| `exam_type` | varchar | NOT NULL |
| `created_at` | timestamp | Auto-set |

---

## Table 8: `quiz_results` — 0 rows (schema only)

**Role:** Designed to store student quiz/practice session results. Feature not yet activated (0 rows).

### Schema (from column probing)

| Column | Type | Description |
|---|---|---|
| `id` | serial (PK) | Auto-increment (cannot insert manually) |
| `user_id` | uuid | FK to auth user |
| `total` | integer | Total questions in the session |
| `subject` | varchar | NOT NULL |
| `chapter` | varchar | NOT NULL |
| `correct` | integer | Number of correct answers |
| `created_at` | timestamp+tz | Session timestamp |

---

## Storage Bucket: `pdf-uploads` (public)

Single bucket with three sub-folders:

| Folder | Contents |
|---|---|
| `exam-papers/` | Uploaded exam paper PDFs and extracted TXT files |
| `answer-keys/` | Uploaded answer key PDFs |
| `chapter-pdfs/` | Chapter PDFs uploaded for question generation |

File naming pattern: `{folder}/{unix_timestamp_ms}_{original_filename}`

---

## Relationships Between Tables

```
questions
  └── source_chapter_id → chapter_meta.id  (FK, 39,151/39,156 filled)

exam_questions
  └── source_paper_id → (logical grouping, no FK table — paper metadata is aggregated in-memory)
  └── paper_pdf_url → Storage: pdf-uploads/exam-papers/...

pdf_uploads
  └── exam_paper_pdf → Storage: pdf-uploads/exam-papers/...
  └── answer_key_pdf → Storage: pdf-uploads/answer-keys/...
  └── chapter_pdf → Storage: pdf-uploads/chapter-pdfs/...

processing_errors
  └── context_json.source_chapter_id → chapter_meta.id (soft reference, not FK)
```

---

## Key Architecture Points for the Validator

### What counts as "generated" questions?
All rows in `questions` table. These are AI-generated by the system via Claude (Haiku for question generation, Sonnet for complex tasks).

### What counts as "reference" questions?
All rows in `exam_questions` table. These were extracted from actual CBSE board exam papers. Currently **only Class 10 CBSE 2025 papers** exist (43 unique papers, 1,592 questions).

### Coverage gap for the validator
Reference papers only exist for Class 10 CBSE. All other combos (6th, 8th, 9th CBSE; 8th, 9th, 10th Stateboard) have **no reference papers** — the validator will need a fallback strategy for these.

### Difficulty field is not usable
The `questions.difficulty` column is `"medium"` for 99.99% of rows — it was set uniformly during generation and does not reflect actual question difficulty. The validator should infer difficulty from question content, not this field.

### Subject name normalization needed
Several subject names have inconsistencies — trailing spaces, variant spellings. Before any cross-table joins on subject, normalize: strip whitespace, lowercase for comparison.

### The `exam` column is the primary board/grade identifier in `questions`
Parse it as: first token = grade (`"6th"`, `"8th"`, `"9th"`, `"10th"`), middle token = board (`"CBSE"`, `"Stateboard"`).

---

## API Endpoints That Touch the Database

Key endpoints in `main.py`:

| Endpoint | Method | Tables | Description |
|---|---|---|---|
| `GET /api/retrieve` | GET | `questions` | Retrieve questions with filters (exam, subject, chapter, difficulty, q_type) |
| `GET /api/stats` | GET | `questions` | Count by (exam, subject, chapter, question_type) |
| `GET /api/metadata` | GET | `questions` | Distinct boards/subjects/chapters |
| `POST /api/generate` | POST | `questions`, `chapter_meta` | Generate questions from PDF upload |
| `GET /api/errors` | GET | `processing_errors` | Recent errors |
| `POST /api/extract-paper` | POST | `exam_questions` | Extract questions from exam paper PDF |
| `POST /api/match-answer-key` | POST | `exam_questions` | Match answers to extracted questions |
| `POST /api/upload-reference` | POST | `reference_uploads` | Log a reference upload |
| `GET /api/reference-uploads` | GET | `reference_uploads` | List reference uploads |
| `PATCH /api/questions/{id}` | PATCH | `questions` | Edit a question |
| `DELETE /api/questions/{id}` | DELETE | `questions` | Delete a question |
| `POST /api/tag-chapters` | POST | `exam_questions` | Tag exam_questions with chapter names |
| `POST /api/split-pdf` | POST | — | Split a textbook PDF into chapters |
