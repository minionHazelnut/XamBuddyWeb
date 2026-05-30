# Claude Code Prompt — XamBuddy Question Validator & Analytics

Copy everything below the `---` line into Claude Code. Fill in the `[FILL IN]` placeholders first (or leave them and Claude Code will ask).

---

# Build me a Question Validation & Analytics System for XamBuddy

## Context

I run a project called **XamBuddy** that generates exam questions for Indian school students across multiple grades and boards (CBSE, various State Boards, etc.). I have a database of **35,000+ AI-generated questions with answers**, spanning multiple grades, subjects, and boards. The generation process was imperfect — a meaningful fraction of these questions are either:

- **Dumb / nonsensical** (the question itself doesn't make pedagogical sense)
- **Mismatched** (the answer doesn't actually answer the question — sometimes both the Q and the A are individually fine, but they belong to *different* items and got crossed)
- **Factually wrong** (Q is fine, but the A is incorrect)
- **Off-level** (way too easy for the grade, or absurdly hard, in a way that doesn't match real exam questions)

I have also **uploaded real question papers** into the database for certain grades/subjects/boards. These real papers are the **ground-truth standard** — generated questions should look and feel like questions from these papers in terms of style, difficulty range, and pedagogical sensibility.

I need you to build me a system that (a) classifies every generated question into PASS / NEEDS_REVIEW / REJECT, and (b) gives me deep analytics on the dataset so I can see where the gaps are. I want to access everything from a **web interface**.

## What I have (please verify and ask if anything is unclear)

- **Database**: `[FILL IN: e.g., PostgreSQL on Supabase / MongoDB Atlas / MySQL / SQLite file at path X]`
- **Connection details**: `[FILL IN: connection string, env var name, or "I'll provide via .env"]`
- **Schema**: I don't remember every column. **Please inspect the database first and show me the schema before writing validation logic.** I expect tables roughly covering: questions, answers, grade, board, subject, difficulty (maybe), source (generated vs from-paper), created_at.
- **Reference question papers**: These are stored in the database (or in `[FILL IN: e.g., S3 bucket / a `reference_questions` table / a folder]`). Identify them by `[FILL IN: e.g., `source = 'paper_extracted'` or a `is_reference = true` flag]`. **If you can't tell reference from generated, stop and ask me.**
- **Boards/grades I care about most**: All present in the DB, but **Class 8–10 CBSE and State Board** are highest priority for the analytics.
- **LLM access for validation**: Use the Anthropic API. I'll provide `ANTHROPIC_API_KEY` in `.env`. Use Claude Sonnet (latest available) for the per-question judgment calls — it's the right cost/quality balance for 35k items. Don't use Opus by default (too expensive at this volume); flag if you want it for hard cases.

## Step 0 — Discovery (do this first, don't skip)

Before writing any validation logic:

1. Connect to the database, inspect the schema, and show me a summary: tables, columns, row counts, distinct values for board/grade/subject.
2. Pull 10 random generated questions and 10 random reference (paper-extracted) questions and show them to me side-by-side so we agree on what "good" looks like before scaling up.
3. Confirm with me: which boards, grades, and subjects have reference papers available? Which don't? For subjects with **no reference papers**, the validator needs a fallback policy — propose one and let me approve it.
4. Show me the breakdown: how many generated questions per (board, grade, subject)?

**Do not proceed to Step 1 until I confirm Step 0.**

## Step 1 — Build the Reference Standard

For each (board, grade, subject) combination that has reference papers:

1. Extract the reference questions and use Claude Sonnet to produce a **profile** of that group:
   - Typical question structure and length
   - Cognitive level (recall / understanding / application / analysis — roughly Bloom's)
   - Difficulty range (easy / medium / hard distribution)
   - Common question formats (MCQ, short answer, long answer, numerical, diagram-based, etc.)
   - Style markers (formal vs conversational, level of vocabulary, etc.)
2. Store this profile in a new table `reference_profiles` keyed by (board, grade, subject). Persist it — don't recompute on every run.
3. For (board, grade, subject) combos with **no reference papers**, mark the profile as `fallback` and use the closest available profile (same subject + nearest grade, or same grade + same subject + sibling board) plus a generic NCERT-aligned default.

## Step 2 — Validation Engine (per question)

For each generated question in the database, call Claude Sonnet with a structured judgment prompt. The model should return JSON with these fields:

```json
{
  "verdict": "PASS" | "REVIEW" | "REJECT",
  "issues": ["dumb_question", "answer_doesnt_match", "answer_incorrect",
             "off_level_too_easy", "off_level_too_hard", "ambiguous",
             "factual_error", "grammar_or_clarity", "duplicate_concept",
             "answer_belongs_to_different_question", "other"],
  "issue_details": "short human-readable explanation",
  "estimated_difficulty": "easy" | "medium" | "hard",
  "difficulty_vs_reference": "easier" | "comparable" | "harder",
  "confidence": 0.0 to 1.0,
  "matches_reference_style": true | false
}
```

### Decision rules (encode these explicitly in the prompt to Claude):

- **PASS** — Question makes sense, answer correctly answers *this exact question*, difficulty is within or close to the reference range, style is acceptable for the grade. **Easy questions are PASS** if they are legitimate easy questions (the kind a teacher might use for a warm-up or basic recall check).
- **REJECT** — Clear, unambiguous problems:
  - Question is incoherent, nonsensical, or grammatically broken beyond comprehension
  - Answer is factually wrong AND clearly so
  - Answer obviously belongs to a different question (no plausible relationship)
  - Question is at an absurdly wrong level (e.g., Class 10 Physics question reading "What color is the sky?")
- **REVIEW** — Any doubt at all. Specifically:
  - Could be a legitimate easy question OR a dumb one — ambiguous
  - Answer partially answers the question or is close but not quite right
  - Style is unusual but not clearly wrong
  - Model confidence is below 0.75 for any reason
  - Question is borderline off-level

**Hard rule: when in doubt, REVIEW, not REJECT.** I'd rather review extra than lose good questions.

### Cross-question check (catch swapped answers):

After the per-question pass, run a **second pass** specifically to detect "answer belongs to a different question" cases. For each REVIEW or REJECT flagged with `answer_doesnt_match` or `answer_belongs_to_different_question`, search the same (board, grade, subject) bucket for a question that the answer *would* correctly answer. If found, flag both questions as `possible_swap` with a link to each other so I can fix them together during review.

### Performance & cost:

- Batch requests where possible (10–20 questions per API call) to control cost.
- Cache verdicts in a new table `validation_results` keyed on a hash of (question_text + answer_text). If a question is re-validated and nothing changed, skip the API call.
- Show me a cost estimate **before** running on the full 35k. Run on a 500-question sample first, show me precision/recall on a tiny manual spot-check I'll do via the UI, then proceed.
- Make the full run resumable — if it crashes at 18,000, I should be able to restart and continue.

## Step 3 — Web Interface

Build a web app I can run locally and (later) deploy. Tech: **Next.js + Tailwind + a clean component library (shadcn/ui)**. Backend can be Next.js API routes or a separate FastAPI/Python service — your call, justify it briefly.

### Pages I need:

1. **Dashboard (home)**
   - Total questions, % PASS / REVIEW / REJECT
   - Heatmap: rows = (board, grade), columns = subjects, cell color = % PASS
   - Top 10 worst-performing (board, grade, subject) buckets
   - Big call-out: "X questions waiting in your review queue"

2. **Review Queue**
   - Table of all `REVIEW` items, filterable by board, grade, subject, issue type
   - Each row expandable to show: question, answer, model's `issue_details`, the matched reference profile, and (if `possible_swap`) the candidate paired question
   - Buttons per row: **Approve as PASS**, **Mark as REJECT**, **Edit Q/A and Approve**, **Skip**
   - Keyboard shortcuts (j/k to navigate, a/r/e/s for actions) — I'll be doing this a lot
   - My decisions write back to the DB and to a `human_review_log` table so we can later retrain or audit

3. **Rejected Questions**
   - Same UI as Review Queue but for `REJECT`s — in case I want to rescue any
   - Bulk delete with confirmation

4. **Analytics** (the deep one — see Step 4)

5. **Settings / Run Validation**
   - Trigger a fresh validation run, scoped to (board / grade / subject / "everything")
   - Show progress, ETA, current cost
   - Show last run's summary

## Step 4 — Analytics Dashboard (this is critical to me)

This is a separate page with these views:

### A. Difficulty Comparison vs Reference

For each (board, grade, subject) with a reference profile:
- Stacked bar: % easy / medium / hard in **reference** vs **generated**
- A single "skew" number: positive = generated is harder than reference on average, negative = easier
- List of subjects where generated questions are **significantly easier** than reference (these are the dumb-question risk zones)
- List where they're **significantly harder** (potentially unfair for students)

### B. Question Count Coverage — Class 8–10, CBSE and State Board (priority view)

A dedicated section just for this:
- Table: rows = subjects (Math, Science, English, Social Studies, Hindi, Sanskrit, regional languages, etc. — whatever's in the DB), columns = (Class 8 CBSE, Class 9 CBSE, Class 10 CBSE, Class 8 State, Class 9 State, Class 10 State)
- Each cell shows: total generated count, % PASS, gap vs a target (let me set the target in settings — default 500 per cell)
- Highlight in red any cell where count is **less than 50% of the highest cell in the same row** — these are the under-served subjects
- Sort the table by largest deficit at the top

### C. Issue Type Breakdown

- Pie / bar of what kinds of problems are most common
- Filterable by board / grade / subject so I can see if, say, "answer_doesnt_match" is concentrated in one subject

### D. Overall Health Score

A single per-bucket score (0–100) combining: % PASS, difficulty alignment with reference, coverage vs target, issue diversity. Show me which buckets need the most work.

### Export

Every analytics view should have a "Download CSV" button. The Class 8–10 coverage table specifically — I'll want to share that with my team.

## Step 5 — Make it Operable

- `.env.example` with every required variable
- `README.md` with: setup, how to run locally, how to trigger validation, how to interpret results
- A `scripts/` folder with one-off utilities: re-run validation for a specific bucket, export human review decisions, dump a CSV of all REJECTs, etc.
- Logging: every API call, every human review action, every status change — into a log file and into the DB
- Don't hardcode model names, API endpoints, or thresholds — put them in `config.ts` / `config.py` so I can tune without code changes

## Constraints & Preferences

- **Don't be clever with my data.** Never auto-delete rejected questions — only mark them. Deletion is a manual action I do from the UI after I've reviewed.
- **Idempotent runs.** Re-running validation on the same data should produce the same result (modulo LLM stochasticity, which is fine).
- **Cost transparency.** Always show me total API spend so far and per-run cost.
- **Honest uncertainty.** If the model's confidence is low, the verdict is REVIEW, not PASS. Don't optimize for fewer review items at the cost of letting bad questions through.
- **Code quality.** Typed (TypeScript on the frontend, Python type hints if backend is Python), tested where it matters (validation logic especially), commented where the *why* isn't obvious from the code.

## Deliverables Checklist

- [ ] Database inspection report (Step 0)
- [ ] `reference_profiles` table populated for all available (board, grade, subject) combos
- [ ] `validation_results` table with verdicts for all 35k+ questions
- [ ] `human_review_log` table for tracking my decisions
- [ ] Next.js web app with all five pages above
- [ ] Analytics page with all four sections (A, B, C, D)
- [ ] CSV exports working
- [ ] `.env.example` + `README.md`
- [ ] A small sample run completed and shown to me **before** the full 35k run

## How I want you to work

1. Do Step 0 and stop. Show me what you found and your proposed approach. Wait for my approval.
2. Build the validator on a 500-question sample. Show me 20 results of each verdict type. I'll spot-check and either approve or ask for prompt tuning.
3. Build the web UI in parallel with the full validation run.
4. Demo the analytics dashboard last, once we have real verdicts to display.

If at any point you're missing information you need, **ask me** — don't guess on schema, don't guess on what "dumb" means in my domain, don't guess on tech choices that I might care about. Brief questions are fine; surprises later are not.

Let's start with Step 0.