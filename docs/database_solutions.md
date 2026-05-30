# XamBuddy Database — Solutions

**Companion to:** `database_issues.md`  
**Last updated:** 2026-05-30

---

## Priority Order

| Priority | Issue | Method | Cost | Time |
|---|---|---|---|---|
| 1 | C1: Populate board/grade/class_level | 1 SQL query | $0 | 2 min |
| 2 | C3: Strip subject whitespace | 1 SQL query | $0 | 2 min |
| 3 | H5: Parse real subject in exam_questions | 1 SQL update | $0 | 30 min |
| 4 | H2: Upload remaining answer keys | Admin UI | $0 | 1–2 hrs |
| 5 | M2: Wire up times_served increment | 1 code change | $0 | 15 min |
| 6 | H4: Generate missing explanations | Haiku batch script | ~$10 | 1 hr setup |
| 7 | H1: Tag exam_questions chapters | Haiku batch script | ~$3–5 | 1 hr setup |
| 8 | C2: Real difficulty via validator | Part of validator run | ~$175 | (existing plan) |
| 9 | H3: Upload more reference papers | Admin UI | $0 | ongoing |
| 10 | M3: Generate remaining embeddings | Batch script | ~$0.25 | 1 hr setup |

---

## C1 — Populate `board`, `grade`, `class_level` from `exam` string

Run once in the Supabase SQL editor. Updates all 39,156 rows in under a second.

```sql
UPDATE questions SET
  board = CASE
    WHEN exam LIKE '%CBSE%' THEN 'CBSE'
    WHEN exam LIKE '%Stateboard%' THEN 'Stateboard'
  END,
  grade = SPLIT_PART(exam, ' ', 1),
  class_level = REGEXP_REPLACE(SPLIT_PART(exam, ' ', 1), '[^0-9]', '', 'g')
WHERE board IS NULL;
```

---

## C2 — Difficulty is meaningless

Do not backfill — it would cost ~$150 to re-run Claude on 39k rows.  
**Fix:** When the validator runs, have Claude write the real difficulty into `validated_difficulty` in `validation_results`. Real difficulty data comes as a free byproduct of validation.

---

## C3 — Strip whitespace from subject names

Run once in the Supabase SQL editor. Merges `"Science "` into `"Science"` and `"8th Eng Maths "` into `"8th Eng Maths"`.

```sql
UPDATE questions SET subject = TRIM(subject) WHERE subject != TRIM(subject);
```

---

## H1 — Tag `exam_questions.chapter` (1,315 NULLs)

**Option A — Claude Haiku (~$3–5, recommended):** Batch script that sends each untagged question + the chapter list for that subject/grade to Haiku, asks it to tag the chapter.

**Option B — Free, ~60% accurate:** Keyword-match question text against `chapter_meta.headings` arrays. No API cost, but misses questions that don't use heading keywords verbatim.

---

## H2 — Match remaining 1,041 answer-pending questions

No code change needed. Upload the missing answer key PDFs through the existing **Exam Paper Uploads** admin panel (`/api/match-answer-key`). This is a data entry task.

---

## H3 — No reference papers for 6 out of 7 exam types

**Option A (best):** Upload real Stateboard/CBSE 8th–9th question papers through the existing admin panel. This populates `exam_questions` for those boards — no code change.

**Option B (validator fallback):** For boards with no reference, use Class 10 CBSE papers as a style proxy. Flag all such verdicts as `"fallback_reference"` in `validation_results`.

---

## H4 — Generate missing explanations (10,552 rows)

Use Claude Haiku in a resumable batch script. Haiku is 75% cheaper than Sonnet and explanation generation is straightforward.

**Estimated cost:** ~$8–10 total for all 10,552 rows  
**Script logic:**
1. Fetch rows where `explanation IS NULL`, in batches of 20
2. Call Haiku with question + answer, ask for a 50-word explanation
3. Write back to `questions.explanation`
4. Track progress in a local checkpoint file so it resumes after a crash

---

## H5 — Parse real subject from `exam_questions` paper codes

Run once in the Supabase SQL editor.

```sql
UPDATE exam_questions SET subject =
  CASE
    WHEN subject ILIKE '%Science%'        THEN 'Science'
    WHEN subject ILIKE '%English%'        THEN 'English'
    WHEN subject ILIKE '%Social Science%' THEN 'Social Science'
    WHEN subject ILIKE '%Maths%'
      OR subject ILIKE '%Math%'           THEN 'Mathematics'
    ELSE subject
  END
WHERE subject NOT IN ('Science', 'English', 'Social Science', 'Mathematics');
```

---

## M1 — `chapter_order = 999` for 48% of chapters

Do not backfill in bulk. Fix going forward: require `chapter_order` in the bulk upload flow before saving. For existing rows, fix the most-used subjects (Social Science, Science, Mathematics) manually in the Supabase table editor — ~30 minutes.

---

## M2 — `times_served` never increments

One code change in `main.py` inside the `/api/retrieve` endpoint, after fetching rows:

```python
for r in rows:
    _sb_patch("questions", r["id"], {
        "times_served": (r.get("times_served") or 0) + 1,
        "last_served_at": datetime.now().isoformat()
    })
```

---

## M3 — Embeddings only 31.5% coverage

Low urgency. When needed, batch-generate using Supabase's built-in `pgvector` + OpenAI `text-embedding-3-small`.

**Estimated cost:** ~$0.25 for all 26,813 missing rows at $0.02/million tokens.  
Run as a one-off background script — not needed until semantic dedup or similarity search is required.

---

## M4 — 562 unreviewed generation errors

Triage via the Error Log admin page. For chapters with low question counts due to failed batches, re-trigger generation from the Bulk Upload UI. No code change needed.

---

## L1 — Drop or keep `qpaper` table

Either drop it (`DROP TABLE qpaper;`) or leave it — 0 rows, nothing writes to it. Dropping removes confusion.

---

## L4, L5, L6 — Coverage gaps (6th grade, 10th Stateboard, no Hindi)

Content gaps, not code bugs. Generate more questions through the existing bulk upload pipeline by uploading the relevant chapter PDFs.
