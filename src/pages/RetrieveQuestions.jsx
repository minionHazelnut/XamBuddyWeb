import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CHAPTERS_BY_EXAM_SUBJECT } from '../lib/chapters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const EXAMS = ['10th CBSE Board', '12th CBSE Board']
const SUBJECTS = [
  'Psychology', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'English', 'Hindi', 'History', 'Geography', 'Political Science',
  'Economics', 'Computer Science'
]

function getChapters(exam, subject) {
  return CHAPTERS_BY_EXAM_SUBJECT[exam]?.[subject] || []
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`
  }
}

export default function RetrieveQuestions({ showStatus }) {
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [qType, setQType] = useState('mcq')
  const [difficulty, setDifficulty] = useState('easy')
  const [numQs, setNumQs] = useState(10)
  const [output, setOutput] = useState('')

  const chapters = getChapters(exam, subject)

  async function handleRetrieve(e) {
    e.preventDefault()
    showStatus('Retrieving questions...', 'success')
    try {
      const headers = await getAuthHeaders()
      const params = new URLSearchParams({
        exam, subject, chapter,
        q_type: qType, difficulty,
        limit: numQs.toString()
      })
      const response = await fetch(`${API_BASE}/api/retrieve?${params}`, { headers })
      const result = await response.json()
      if (result.success) {
        let text = `Found ${result.count} questions:\n\n`
        result.questions.forEach((q, i) => {
          text += `Q${i + 1}: ${q.question}\n`
          text += `Answer: ${q.answer || q.correct_answer}\n`
          if (q.subject) text += `Subject: ${q.subject}\n`
          if (q.difficulty) text += `Difficulty: ${q.difficulty}\n`
          if (q.chapter) text += `Chapter: ${q.chapter}\n`
          text += '---\n\n'
        })
        setOutput(text)
        showStatus('Questions retrieved successfully!', 'success')
      } else {
        setOutput(`Error: ${result.detail || 'Unknown error'}`)
        showStatus('Failed to retrieve questions', 'error')
      }
    } catch (err) {
      setOutput(`Error: ${err.message}`)
      showStatus('Error retrieving questions', 'error')
    }
  }

  return (
    <div className="page-content">
      <h2>Retrieve from Database</h2>
      <form onSubmit={handleRetrieve} className="form-panel">
        <div className="form-row">
          <div className="form-group">
            <label>Exam:</label>
            <select value={exam} onChange={(e) => { setExam(e.target.value); setChapter('') }}>
              <option value="">Select Exam</option>
              {EXAMS.map(ex => <option key={ex} value={ex}>{ex}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Subject:</label>
            <select value={subject} onChange={(e) => { setSubject(e.target.value); setChapter('') }}>
              <option value="">Select Subject</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Chapter:</label>
          <select value={chapter} onChange={(e) => setChapter(e.target.value)} disabled={chapters.length === 0}>
            <option value="">{chapters.length === 0 ? 'Select exam & subject first' : 'Select Chapter'}</option>
            {chapters.map(ch => <option key={ch} value={ch}>{ch}</option>)}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Question Type:</label>
            <select value={qType} onChange={(e) => setQType(e.target.value)}>
              <option value="mcq">MCQ</option>
              <option value="short">Short Answer</option>
              <option value="long">Long Answer</option>
            </select>
          </div>
          <div className="form-group">
            <label>Difficulty:</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="form-group">
            <label>Max Questions:</label>
            <input type="number" min="1" max="100" value={numQs} onChange={(e) => setNumQs(e.target.value)} />
          </div>
        </div>

        <button type="submit">Retrieve Questions</button>
      </form>

      {output && <div className="output-box">{output}</div>}
    </div>
  )
}
