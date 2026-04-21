I am building an admin panel for an ed-tech app called XamBuddy for CBSE Class 10 and 12 students. The backend has a database already connected. I need you to build two separate, clearly labelled admin features. Do not mix them up at any point in the code, the UI, the database tables, or the processing logic.

SECTION A — QUESTION PAPER UPLOAD SYSTEM
Create a dedicated section in the admin panel labelled "Question Papers & Answer Keys". This must be completely visually and functionally separate from the chapter content uploader.
Build a PDF uploader here with two upload slots per entry: one for the question paper PDF and one for the answer key PDF. Both are optional per upload but at least the question paper must be present to submit. Each upload entry must also capture: subject, class (10 or 12), board (CBSE/ICSE), year, and exam type (board exam, sample paper, school test).
When a question paper PDF is uploaded, scan it thoroughly using Claude's document reading capability. Extract every single question individually. For each question identify and store: the question text in full, the question number, the question type (MCQ, VSA, SA, LA, CBQ), the marks it carries, and the subject and chapter if identifiable from context.
Question type detection rules to follow strictly:

MCQ: has four options labelled A B C D or 1 2 3 4
VSA (Very Short Answer): carries 2 marks, answer not exceeding 40 words
SA (Short Answer): carries 3 marks, answer not exceeding 60 words
LA (Long Answer): carries 5 marks, answer not exceeding 120 words
CBQ (Case Based Question): has a passage followed by sub-questions, carries 4 marks total with 3 sub-questions, answers not exceeding 100 words each

When an answer key PDF is also uploaded, match every answer to its corresponding question by question number and store them linked. If an answer key is not uploaded at the time of question paper upload, leave the answer field null and flag it as "answer pending" in the database. Build a way in the admin UI to come back and upload the answer key for a paper later, and have it re-run the matching.
For MCQs extracted from question papers, store which option (A/B/C/D) is the correct answer separately from the question and options themselves.
Before storing any question, check the database for duplicates. Exact duplicate question text should not be stored again. Log a message to the admin saying "X duplicate questions skipped" after each upload.
Store all extracted questions in a table called exam_questions with columns: id, question_text, question_type, marks, subject, class_level, board, year, exam_type, chapter (nullable), correct_answer, options_json (for MCQs), difficulty_level (nullable at this stage), source_paper_id, created_at.
Also analyse each question and auto-tag a difficulty level based on the following logic and store it:

Easy: factual recall, definition-based, direct questions
Medium: application-based, requires some understanding
Hard: conceptual, why/how/which, multi-step reasoning, analytical

Store the difficulty tag in the difficulty_level column for every question extracted from papers.
<!-- This section also accepts guide book PDFs and sample question PDFs uploaded by the admin for the sole purpose of understanding question patterns, difficulty standards, and paper structure. These are reference materials only. Store them separately in a table called reference_uploads with columns: id, file_name, upload_type (question_paper / answer_key / guide_reference), subject, class_level, board, uploaded_at, processing_notes. Nothing uploaded here should be directly copied into the question bank. These uploads are used only to calibrate the level, style, and pattern of questions that get generated in Section B. When questions are generated from chapter PDFs, the system must use these reference uploads to match the standard, depth, and style of questioning — but must rewrite everything in different words, different names, and different numbers so that no content is copied from the reference material. The concept being tested must be retained but the framing must be original. -->

SECTION B — CHAPTER CONTENT UPLOAD AND QUESTION GENERATION SYSTEM
This is the existing chapter PDF uploader. Keep it separate. Add to it the following generation logic.
When a chapter PDF is uploaded with subject, class, chapter name, and board selected, do the following:
Step 1 — Chapter analysis
Read the entire chapter PDF thoroughly. Identify: all key concepts, definitions, formulas, diagrams described in text, examples, case studies, and practical vs theory content ratio. Store this analysis internally.
Determine the practical vs theory split of the chapter by looking at the proportion of the chapter that contains numerical problems, calculations, graphs, data interpretation, applied problem solving, and worked examples vs explanatory prose and conceptual text. Store this ratio as practical_pct and theory_pct for the chapter.
Use these subject-level defaults as a guide but override them if the PDF analysis gives a different result:

Mathematics: 90–95% practical
Physics: 60% practical 40% theory
Chemistry: 50% practical 50% theory
Biology: 15% practical 85% theory
Economics: theory portion is higher, statistics and data sections are practical — judge from the PDF
Accountancy: 85% practical
Business Studies: 20% practical 80% theory
History, Political Science, Geography, Sociology, English: judge from PDF but default to 90% theory
Any subject not listed: judge entirely from the PDF content

Step 2 — Question generation rules
Generate questions of the following types. The split between practical and theory questions within each type must match the chapter's practical_pct and theory_pct.
All generated questions must be stored with their answers. All answers must include all important keywords that CBSE examiners look for, framed in complete sentences. Answers must be written such that a student who memorises them will score full marks in any school, board, or competitive exam on this topic.
Questions must be generated equally from across the entire chapter. Do not concentrate questions on the introduction or any single section. Divide the chapter into logical segments and generate proportionally from each.
Before storing any generated question, check if the same question or a question with more than 80% text similarity already exists in the database for the same subject, class, and chapter. If yes, skip it. Do not store duplicates. Indirect questions that approach the same concept differently are allowed.
MCQ Generation rules:
Generate MCQs at three difficulty levels:
Easy MCQs: surface-level factual questions. Test direct recall. One-line definitions, who discovered, what is the formula for, which of the following is correct about X. The correct answer should be unambiguous. Distractors should be plausible but clearly wrong to someone who has studied.
Medium MCQs: require understanding and application. The student must think, not just recall. Application of a concept to a scenario, identifying the correct process, choosing between two similar-sounding concepts.
Hard MCQs: conceptual depth questions. Why does X happen, which of the following best explains, how does X relate to Y, what would happen if. Distractors must be very close to the correct answer and require genuine understanding to differentiate.
For all MCQs: generate four options labelled A, B, C, D. Distribute correct answers equally across A, B, C, D across the full set of MCQs generated for a chapter. No option should be the correct answer more than 30% of the time. Randomise this distribution. Store the correct option explicitly.
Short Answer Question generation rules:
Generate SA questions that require a 2 to 4 line explanatory answer. No question should have a one-word or one-line answer. Questions must begin with explain, describe, why does, how does, what is the significance of, differentiate between, what happens when, or similar prompts that demand explanation. Include a mix of easy medium and hard questions. Answers must be 40 to 70 words, written in complete sentences, include all key terms a CBSE examiner would look for, and be structured as: one sentence of context, one to two sentences of core explanation, one sentence of implication or example if applicable.
Long Answer Question generation rules:
Generate LA questions that demand paragraph-level thinking. Word limit is 120 words maximum per the CBSE standard. Questions must use why, how, explain in detail, analyse, discuss, compare, evaluate. These must make the student think, structure their response, and demonstrate deep understanding. Every long answer must follow this structure strictly within the word limit: begin with a proper introduction sentence that sets context for the answer, follow with the core explanation covering all sub-points a CBSE marking scheme would award marks for, and end with a proper concluding sentence that summarises or states the significance. All necessary keywords that an examiner would look for must be present throughout the introduction, body, and conclusion. Answers must be written in structured paragraph format. Include diagrams or tables in the answer description where relevant by noting "[include diagram of X here]".
CBQ generation rules:
Generate case-based question sets. Each CBQ has a short passage of 60 to 100 words followed by 3 sub-questions. The passage must be based on a real-world application, current affairs hook, or scenario derived from the chapter content. Sub-questions must progress in difficulty: first sub-question easy, second medium, third hard. Each sub-question answer must not exceed 100 words.
Step 3 — Storage
Store all generated questions in a table called generated_questions with columns: id, question_text, question_type, difficulty_level, subject, class_level, board, chapter, answer_text, options_json (for MCQs), correct_option (for MCQs), is_practical (boolean), keywords_json, source_chapter_id, generated_at, times_served, last_served_at.
Store the keywords extracted from each answer in keywords_json so the app can later highlight them for students.

SECTION C — ADMIN UI REQUIREMENTS
Build the admin panel UI with two clearly separated cards or sections at the top level:
Section 1 labelled "Question Paper Bank" — this is for uploading past year papers, answer keys, and guide reference PDFs as described in Section A.
Section 2 labelled "Chapter Content & Question Generator" — this is for uploading chapter PDFs and triggering generation as described in Section B.
Both sections must have: upload progress indicator, a processing log that shows what is happening step by step as the PDF is being analysed, a summary screen after processing showing how many questions were extracted or generated, how many were skipped as duplicates, and the practical vs theory split detected.
In the Question Paper Bank section, show a table of all uploaded papers with their processing status, number of questions extracted, and whether an answer key has been matched. Allow admin to click any paper and see all extracted questions with their stored answers.
In the Chapter Content section, show a table of all uploaded chapters with generation stats. Allow admin to click and view all generated questions for that chapter, filter by type and difficulty, and manually edit or delete any question.

SECTION D — QUALITY AND ACCURACY RULES TO ENFORCE THROUGHOUT
Every answer stored in this system, whether extracted from a paper or generated from a chapter, must meet these standards before being written to the database. Build a validation layer that checks these before insert:
Answer is not empty. Answer is not a single word or single sentence for SA and LA types. Answer contains at least 3 domain-relevant keywords for SA and at least 6 for LA. MCQ has exactly 4 options and exactly one marked correct. Question text ends with a question mark. No question is stored without an answer except questions flagged as answer-pending from paper uploads.
Generated questions must collectively cover every major heading and sub-heading of the uploaded chapter. After generation, run a coverage check: list all headings found in the chapter PDF and confirm at least one question exists for each. If any heading has zero questions, generate at least one SA and one MCQ for it before finalising.
The system must never generate the same question twice for the same chapter. It must never generate a question whose answer is not derivable from the uploaded chapter content or from the question paper context.

SECTION E — DATABASE INTEGRITY
Use transactions for all multi-step inserts. If any part of a paper processing or chapter generation fails midway, roll back and log the error. Do not leave partial data in the database.
Build an admin-facing error log that shows any failed uploads, what stage they failed at, and allows re-processing.
Before writing anything to the database, check with the admin and confirm the exact name of every column in the existing database tables and what data will be stored in each column. Present a mapping like: "column_name — what will be stored here" for every table that will be written to. Do not proceed with any inserts or table creation until the admin has reviewed and approved this mapping. If the existing columns differ from what is proposed in this prompt, flag the difference and ask which to use. Do not rename or alter any existing column without explicit admin approval. STORE ALL THESE INSTRUCTIONS EXACTLY AS GIVEN IN AOTHER FILE. DONT MODIFY ADD OR DELETE ANYTHING OR MAKE ANY CHANGES TO THIS DOCUMENT UNLESS I SPECIFICALLY SAY SO.
