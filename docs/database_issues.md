# XamBuddy Database — Issues & Problems

**Audited:** 2026-05-30  
Severity tiers: **CRITICAL** (breaks queries/data correctness) → **HIGH** (data gaps that affect features) → **MEDIUM** (operational debt) → **LOW** (schema/cleanup)

---

## CRITICAL — Breaks Query Correctness

### C1. `board`, `grade`, `class_level` columns in `questions` are always NULL
- **What:** All 39,156 rows have `board = NULL`, `grade = NULL`, `class_level = NULL`
- **Impact:** Any code that filters or groups on these columns gets 0 results. The actual board/grade is only available by parsing the `exam` string (e.g. `"10th CBSE Board"`)
- **Scope:** 39,156 rows / 100%

### C2. `difficulty` field is meaningless
- **What:** 39,151/39,156 rows are `"medium"`. Only 5 rows are `"easy"`. Zero rows are `"hard"`.
- **Impact:** The difficulty column cannot be used to filter, analyze, or present varied difficulty levels. All difficulty-based analytics will be flat/useless. The validator cannot use this to detect "off-level" questions by comparing to stored difficulty.
- **Scope:** 39,156 rows / 100%

### C3. Subject names have dirty whitespace — splits identical subjects into separate groups
- **What:** Two subject names have trailing spaces: `"Science "` (1,890 rows) and `"8th Eng Maths "` (1,830 rows). These are the same subjects as `"Science"` and `"8th Eng Maths"` but appear as different values in every GROUP BY, filter, and JOIN.
- **Impact:** Any aggregation on `subject` undercounts. The 8th Stateboard Science bucket looks like 1,596 when it should be 3,486. Analytics dashboards will show two separate rows for the same subject.
- **Scope:** 3,720 rows affected

---

## HIGH — Data Gaps That Break Features

### H1. `exam_questions.chapter` is NULL for 1,315 of 1,592 rows (83%)
- **What:** Real exam paper questions extracted from PDFs have no chapter tag. Only 277 of 1,592 rows have been tagged with a chapter name.
- **Impact:** The validator's per-chapter reference matching is impossible for 83% of reference questions. Chapter-level analytics comparing generated vs reference questions cannot be done.
- **Scope:** 1,315/1,592 rows

### H2. 65% of reference questions have no answer (`answer_pending = True`)
- **What:** 1,041 of 1,592 `exam_questions` rows still have `correct_answer = NULL` and `answer_pending = True`. Answer matching from answer key PDFs hasn't been completed.
- **Impact:** The validator cannot check "answer correctness" against reference answers for 2/3 of real papers. These questions are only usable for style/format reference, not answer validation.
- **Scope:** 1,041/1,592 rows

### H3. Reference papers exist only for Class 10 CBSE — 6 out of 7 exam types have no ground truth
- **What:** All 1,592 `exam_questions` rows are `class_level="10"`, `board="CBSE"`, `year="2025"`. There are zero reference papers for 6th, 8th, 9th CBSE or 8th, 9th, 10th Stateboard.
- **Impact:** The validator has no real-paper benchmark for 32,229 of the 39,156 generated questions (82%). Validation for these will need to rely entirely on a fallback heuristic — no ground truth comparison possible.
- **Scope:** 32,229/39,156 generated questions have no matching reference

### H4. `explanation` is NULL for 10,552 questions (27%)
- **What:** Over a quarter of generated questions have no explanation field. Concentrated in Stateboard Social Science and newer batches.
- **Worst buckets:**
  - 9th Stateboard Social Science: 1,284 missing
  - 8th Stateboard Social Science: 1,178 missing
  - 10th Stateboard socialscience part1: 602 missing
  - 10th Stateboard socialscience part2: 560 missing
  - 9th Stateboard Mathematics: 531 missing
  - 10th CBSE English: 515 missing
- **Impact:** The Review Queue UI cannot show "model's reasoning" for 27% of questions. The validator has less signal for judging answer quality.
- **Scope:** 10,552/39,156 rows

### H5. `exam_questions.subject` is a paper code, not a clean subject name
- **What:** Most rows have subject values like `"2025 Science 31/4/3"` or `"2025 English 2/1/1"` — these are paper set codes, not real subject names. Only a few rows have clean values like `"English"` or `"Social Science"`.
- **Impact:** You cannot directly join `exam_questions` to `questions` on subject. Mapping real subject from these codes requires string parsing (prefix before the set number).
- **Scope:** ~1,480 of 1,592 exam_questions rows

---

## MEDIUM — Operational Debt

### M1. `chapter_order = 999` for 140/292 chapter_meta rows (48%)
- **What:** 999 is the sentinel value for "unknown order". Nearly half of chapters don't have a proper curriculum ordering.
- **Impact:** Any UI that lists chapters in textbook order will fail for half the chapters. Bulk generation that processes chapters in order will use arbitrary ordering.
- **Scope:** 140/292 chapter_meta rows

### M2. `times_served` is 0 for every single question (39,156 rows)
- **What:** The `times_served` counter and `last_served_at` timestamp are never updated anywhere in the codebase. The serve/retrieve endpoints don't increment this counter.
- **Impact:** All usage analytics are dead. You cannot tell which questions are frequently used vs never used.
- **Scope:** 39,156 rows / 100%

### M3. `embedding` only covers 31.5% of questions (12,343 rows)
- **What:** Vector embeddings have only been computed for 12,343 of 39,156 questions. The remaining 26,813 rows have `embedding = NULL`.
- **Impact:** Semantic deduplication, similarity search, and "find questions similar to X" features only work for about a third of the question bank.
- **Scope:** 26,813/39,156 rows

### M4. 562 unreviewed errors in `processing_errors` — 419 from bulk-upload
- **What:** The error log has 562 entries. 419 come from bulk-upload (batch generation failures). These represent questions that *should* have been generated but weren't because of JSON parse failures or Claude API issues.
- **Impact:** Unknown number of chapters have fewer questions than intended. The counts in the dashboard are lower than the target due to silent failures.
- **Scope:** 562 error events; true question count impact unknown

### M5. `chapter_meta.headings` quality is poor for English chapters
- **What:** English chapter headings parsed from NCERT PDFs are generic labels like `["BEFORE YOU READ", "Activity", "I", "Oral Comprehension Check"]` — not the actual literary/thematic headings. This is because the PDF uses section labels, not meaningful chapter headings.
- **Impact:** Coverage checks for English chapters will report false gaps (it looks for heading keywords in generated questions, but these heading names don't appear in questions).
- **Scope:** ~15–20 English chapter_meta rows

---

## LOW — Schema Debt & Coverage Gaps

### L1. `qpaper` table: empty and redundant with `pdf_uploads`
- **What:** `qpaper` (0 rows) has a schema that overlaps almost entirely with `pdf_uploads` (384 rows). It was likely a first-draft version of `pdf_uploads`.
- **Impact:** Wasted schema, potential confusion for future developers.

### L2. `quiz_results` table: empty — student feature not wired up
- **What:** The `quiz_results` table exists but has 0 rows. The student-facing quiz experience doesn't write results anywhere.
- **Impact:** No student performance data is being captured.

### L3. `reference_uploads` table: 0 rows — upload UI exists but never used
- **What:** The Reference Upload UI in the admin panel (for uploading guide books / sample question papers) exists and is wired to the API, but nobody has uploaded anything yet.
- **Impact:** No reference guides available for fallback validation.

### L4. Coverage gap: 6th grade has only Mathematics
- **What:** The entire 6th grade dataset contains only 1,359 Mathematics questions. No English, Science, Social Science, or any other subject.
- **Impact:** 6th grade is essentially not usable for a student-facing product.

### L5. Coverage gap: 10th Stateboard has only Social Science
- **What:** 10th Stateboard Board has 4,418 rows — but they are entirely Social Science (split into part1 and part2). No Maths, Science, or English for 10th Stateboard.
- **Impact:** A 10th Stateboard student can only practice Social Science.

### L6. No Hindi, Sanskrit, or regional language subjects in the database
- **What:** All subjects are English-medium. Hindi, Sanskrit, Kannada, and other regional languages that appear in CBSE and Stateboard curricula are absent entirely.

### L7. `source_chapter_id` field name mismatch in old questions
- **What:** The `source_chapter_id` column links to `chapter_meta.id`. However, 5 rows have NULL here (likely very early questions before the column existed). Not a serious issue but worth knowing.
- **Scope:** 5 rows

---

## Summary Table

| ID | Issue | Rows Affected | Severity |
|---|---|---|---|
| C1 | `board`/`grade`/`class_level` always NULL | 39,156 (100%) | CRITICAL |
| C2 | `difficulty` is meaningless (all medium) | 39,156 (100%) | CRITICAL |
| C3 | Subject dirty whitespace splits data | 3,720 rows | CRITICAL |
| H1 | `exam_questions.chapter` NULL (83%) | 1,315/1,592 | HIGH |
| H2 | 65% of reference questions have no answer | 1,041/1,592 | HIGH |
| H3 | Reference papers only for Class 10 CBSE | 32,229/39,156 | HIGH |
| H4 | `explanation` NULL for 27% of questions | 10,552/39,156 | HIGH |
| H5 | `exam_questions.subject` is a paper code | ~1,480/1,592 | HIGH |
| M1 | `chapter_order=999` for 48% of chapters | 140/292 | MEDIUM |
| M2 | `times_served` never incremented (all 0) | 39,156 (100%) | MEDIUM |
| M3 | Embeddings only 31.5% coverage | 26,813/39,156 | MEDIUM |
| M4 | 562 unreviewed generation errors | 562 errors | MEDIUM |
| M5 | English chapter headings are low quality | ~20 chapters | MEDIUM |
| L1 | `qpaper` table empty and redundant | 0 rows | LOW |
| L2 | `quiz_results` never populated | 0 rows | LOW |
| L3 | `reference_uploads` never used | 0 rows | LOW |
| L4 | 6th grade: only Mathematics | 1,359 rows | LOW |
| L5 | 10th Stateboard: only Social Science | 4,418 rows | LOW |
| L6 | No Hindi/Sanskrit/regional languages | — | LOW |
| L7 | 5 rows with NULL `source_chapter_id` | 5 rows | LOW |
