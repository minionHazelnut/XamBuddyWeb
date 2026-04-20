import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CHAPTERS_BY_EXAM_SUBJECT } from '../lib/chapters'

const EXAMS = ['10th CBSE Board', '12th CBSE Board']
const SUBJECTS = [
  'Psychology', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'English', 'Hindi', 'History', 'Geography', 'Political Science',
  'Economics', 'Computer Science'
]
const Q_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'mcq', label: 'MCQ' },
  { value: 'short', label: 'Short Answer (SA)' },
  { value: 'long', label: 'Long Answer (LA)' },
  { value: 'cbq', label: 'Case-Based (CBQ)' },
]
const DIFFICULTIES = [
  { value: '', label: 'All Difficulties' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

function getChapters(exam, subject) {
  return CHAPTERS_BY_EXAM_SUBJECT[exam]?.[subject] || []
}

// ── MCQ Question Card ─────────────────────────────────────────────────────────
function MCQCard({ q, index, total, onNext, onPrev }) {
  const [selected, setSelected] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const options = q.options || {}
  const correct = (q.answer || '').trim().toUpperCase()

  function handleOption(key) {
    if (revealed) return
    setSelected(key)
  }

  function handleReveal() {
    setRevealed(true)
  }

  function handleNext() {
    setSelected(null)
    setRevealed(false)
    onNext()
  }

  function handlePrev() {
    setSelected(null)
    setRevealed(false)
    onPrev()
  }

  function optionClass(key) {
    if (!revealed) return selected === key ? 'opt selected' : 'opt'
    if (key === correct) return 'opt correct'
    if (key === selected && key !== correct) return 'opt wrong'
    return 'opt'
  }

  return (
    <div className="student-qcard">
      <div className="student-qmeta">
        <span className="student-qtag mcq-tag">MCQ</span>
        <span className="student-qnum">Q{index + 1} / {total}</span>
        {q.difficulty && <span className={`student-diff diff-${q.difficulty}`}>{q.difficulty}</span>}
      </div>

      <p className="student-qtext">{q.question}</p>

      <div className="student-options">
        {['A', 'B', 'C', 'D'].map(key => options[key] ? (
          <button key={key} className={optionClass(key)} onClick={() => handleOption(key)}>
            <span className="opt-key">{key}</span>
            <span className="opt-text">{options[key]}</span>
          </button>
        ) : null)}
      </div>

      {revealed && (
        <div className="student-answer-box">
          <div className="answer-correct-line">
            Correct Answer: <strong>{correct}</strong> — {options[correct]}
          </div>
          {q.explanation && <p className="answer-explanation">{q.explanation}</p>}
        </div>
      )}

      <div className="student-qactions">
        <button className="btn-secondary" onClick={handlePrev} disabled={index === 0}>Prev</button>
        {!revealed && selected && (
          <button className="btn-primary" onClick={handleReveal}>Check Answer</button>
        )}
        {revealed && (
          <button className="btn-primary" onClick={handleNext} disabled={index === total - 1}>Next</button>
        )}
        {revealed && index === total - 1 && (
          <span className="finished-label">You've reached the end!</span>
        )}
      </div>
    </div>
  )
}

// ── SA / LA Question Card ─────────────────────────────────────────────────────
function WrittenCard({ q, index, total, onNext, onPrev, typeLabel }) {
  const [showAnswer, setShowAnswer] = useState(false)

  function handleNext() {
    setShowAnswer(false)
    onNext()
  }

  function handlePrev() {
    setShowAnswer(false)
    onPrev()
  }

  const wordLimit = q.question_type === 'long' ? '120 words' : '40–70 words'

  return (
    <div className="student-qcard">
      <div className="student-qmeta">
        <span className={`student-qtag ${q.question_type === 'long' ? 'la-tag' : 'sa-tag'}`}>{typeLabel}</span>
        <span className="student-qnum">Q{index + 1} / {total}</span>
        {q.difficulty && <span className={`student-diff diff-${q.difficulty}`}>{q.difficulty}</span>}
        <span className="word-limit">~{wordLimit}</span>
      </div>

      <p className="student-qtext">{q.question}</p>

      {!showAnswer ? (
        <button className="btn-outline show-answer-btn" onClick={() => setShowAnswer(true)}>
          Show Model Answer
        </button>
      ) : (
        <div className="student-answer-box written-answer">
          <div className="answer-label">Model Answer</div>
          <p className="answer-text">{q.answer}</p>
          {q.explanation && (
            <div className="answer-keywords">
              <span className="keywords-label">Key points for marks:</span> {q.explanation}
            </div>
          )}
        </div>
      )}

      <div className="student-qactions">
        <button className="btn-secondary" onClick={handlePrev} disabled={index === 0}>Prev</button>
        <button className="btn-primary" onClick={handleNext} disabled={index === total - 1}>Next</button>
        {index === total - 1 && <span className="finished-label">End of questions!</span>}
      </div>
    </div>
  )
}

// ── CBQ Card ──────────────────────────────────────────────────────────────────
function CBQCard({ q, index, total, onNext, onPrev }) {
  const [showAnswers, setShowAnswers] = useState([])
  const subQs = q.options?.sub_questions || []

  function toggleAnswer(i) {
    setShowAnswers(prev =>
      prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
    )
  }

  function handleNext() {
    setShowAnswers([])
    onNext()
  }

  function handlePrev() {
    setShowAnswers([])
    onPrev()
  }

  const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

  return (
    <div className="student-qcard cbq-card">
      <div className="student-qmeta">
        <span className="student-qtag cbq-tag">CBQ</span>
        <span className="student-qnum">Q{index + 1} / {total}</span>
        {q.difficulty && <span className={`student-diff diff-${q.difficulty}`}>{q.difficulty}</span>}
        <span className="word-limit">4 marks</span>
      </div>

      <div className="cbq-passage">
        <div className="passage-label">Read the following passage:</div>
        <p>{q.question}</p>
      </div>

      <div className="cbq-subquestions">
        {subQs.map((sub, i) => (
          <div key={i} className="cbq-sub">
            <div className="cbq-sub-header">
              <span className="cbq-sub-num">({i + 1})</span>
              <span className="cbq-sub-diff">{diffLabel[sub.difficulty] || sub.difficulty}</span>
              <p className="cbq-sub-q">{sub.question}</p>
            </div>
            <button className="btn-outline btn-sm" onClick={() => toggleAnswer(i)}>
              {showAnswers.includes(i) ? 'Hide Answer' : 'Show Answer'}
            </button>
            {showAnswers.includes(i) && (
              <div className="cbq-sub-answer">{sub.answer}</div>
            )}
          </div>
        ))}
        {subQs.length === 0 && (
          <p className="cbq-no-subs">No sub-questions found for this CBQ.</p>
        )}
      </div>

      <div className="student-qactions">
        <button className="btn-secondary" onClick={handlePrev} disabled={index === 0}>Prev</button>
        <button className="btn-primary" onClick={handleNext} disabled={index === total - 1}>Next</button>
        {index === total - 1 && <span className="finished-label">End of questions!</span>}
      </div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function StudentDashboard() {
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [qType, setQType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [questions, setQuestions] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)

  const chapters = getChapters(exam, subject)

  async function loadQuestions() {
    if (!exam || !subject) {
      setError('Please select an exam and subject.')
      return
    }
    setLoading(true)
    setError('')
    try {
      let query = supabase
        .from('questions')
        .select('question_text,question_type,correct_answer,explanation,options,difficulty')
        .eq('exam', exam)
        .eq('subject', subject)
        .order('created_at', { ascending: false })
        .limit(100)

      if (chapter) query = query.eq('chapter', chapter)
      if (qType) query = query.eq('question_type', qType)
      if (difficulty) query = query.eq('difficulty', difficulty)

      const { data, error: err } = await query
      if (err) throw err

      if (!data || data.length === 0) {
        setError('No questions found for this selection. Try different filters or generate questions first.')
        setQuestions([])
        return
      }

      // Shuffle
      const shuffled = [...data].sort(() => Math.random() - 0.5)
      const mapped = shuffled.map(r => ({
        question: r.question_text,
        question_type: r.question_type,
        answer: r.correct_answer,
        explanation: r.explanation,
        options: r.options,
        difficulty: r.difficulty,
      }))
      setQuestions(mapped)
      setCurrentIdx(0)
      setStarted(true)
    } catch (e) {
      setError(`Failed to load questions: ${e.message}`)
    }
    setLoading(false)
  }

  function reset() {
    setStarted(false)
    setQuestions([])
    setCurrentIdx(0)
    setError('')
  }

  const q = questions[currentIdx]

  function renderQuestion() {
    if (!q) return null
    const type = q.question_type
    if (type === 'mcq') {
      return <MCQCard q={q} index={currentIdx} total={questions.length} onNext={() => setCurrentIdx(i => i + 1)} onPrev={() => setCurrentIdx(i => i - 1)} />
    }
    if (type === 'short') {
      return <WrittenCard q={q} index={currentIdx} total={questions.length} onNext={() => setCurrentIdx(i => i + 1)} onPrev={() => setCurrentIdx(i => i - 1)} typeLabel="Short Answer" />
    }
    if (type === 'long' || type === 'conceptual') {
      return <WrittenCard q={q} index={currentIdx} total={questions.length} onNext={() => setCurrentIdx(i => i + 1)} onPrev={() => setCurrentIdx(i => i - 1)} typeLabel="Long Answer" />
    }
    if (type === 'cbq') {
      return <CBQCard q={q} index={currentIdx} total={questions.length} onNext={() => setCurrentIdx(i => i + 1)} onPrev={() => setCurrentIdx(i => i - 1)} />
    }
    return <WrittenCard q={q} index={currentIdx} total={questions.length} onNext={() => setCurrentIdx(i => i + 1)} onPrev={() => setCurrentIdx(i => i - 1)} typeLabel={type} />
  }

  // ── Selector screen ──
  if (!started) {
    return (
      <div className="student-dashboard">
        <div className="student-hero">
          <h1>Practice Questions</h1>
          <p>Select your exam, subject, and chapter to begin practising CBSE-aligned questions.</p>
        </div>

        <div className="student-selector">
          <div className="selector-row">
            <div className="selector-group">
              <label>Exam</label>
              <select value={exam} onChange={e => { setExam(e.target.value); setSubject(''); setChapter('') }}>
                <option value="">Select Exam</option>
                {EXAMS.map(ex => <option key={ex} value={ex}>{ex}</option>)}
              </select>
            </div>
            <div className="selector-group">
              <label>Subject</label>
              <select value={subject} onChange={e => { setSubject(e.target.value); setChapter('') }} disabled={!exam}>
                <option value="">Select Subject</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="selector-row">
            <div className="selector-group">
              <label>Chapter</label>
              <select value={chapter} onChange={e => setChapter(e.target.value)} disabled={chapters.length === 0}>
                <option value="">{chapters.length === 0 ? 'Select exam & subject first' : 'All Chapters'}</option>
                {chapters.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            </div>
            <div className="selector-group">
              <label>Question Type</label>
              <select value={qType} onChange={e => setQType(e.target.value)}>
                {Q_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="selector-group">
              <label>Difficulty</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)}>
                {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          {error && <div className="student-error">{error}</div>}

          <button
            className="btn-start"
            onClick={loadQuestions}
            disabled={loading || !exam || !subject}
          >
            {loading ? 'Loading...' : 'Start Practising'}
          </button>
        </div>

        <div className="student-type-guide">
          <h3>Question Types</h3>
          <div className="type-guide-grid">
            <div className="type-guide-card">
              <span className="student-qtag mcq-tag">MCQ</span>
              <p>4 options (A–D). Select the correct answer. Easy = recall, Medium = application, Hard = conceptual.</p>
            </div>
            <div className="type-guide-card">
              <span className="student-qtag sa-tag">SA</span>
              <p>Short Answer. 40–70 words. Begins with Explain / Describe / Why / How. Includes all CBSE keywords.</p>
            </div>
            <div className="type-guide-card">
              <span className="student-qtag la-tag">LA</span>
              <p>Long Answer. Max 120 words. Intro → Core Explanation → Conclusion. Full marks answer structure.</p>
            </div>
            <div className="type-guide-card">
              <span className="student-qtag cbq-tag">CBQ</span>
              <p>Case-Based. Read a real-world passage, then answer 3 sub-questions (easy → medium → hard).</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Practice screen ──
  return (
    <div className="student-dashboard">
      <div className="student-practice-header">
        <button className="btn-back" onClick={reset}>&larr; Back to Selection</button>
        <div className="practice-context">
          <strong>{exam}</strong> · {subject}{chapter ? ` · ${chapter}` : ''}{qType ? ` · ${Q_TYPES.find(t => t.value === qType)?.label}` : ''}
        </div>
        <div className="practice-progress">
          {currentIdx + 1} / {questions.length}
        </div>
      </div>

      <div className="student-progress-bar">
        <div className="student-progress-fill" style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }} />
      </div>

      {renderQuestion()}
    </div>
  )
}
