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

export default function GenerateQuestions({ showStatus }) {
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [qType, setQType] = useState('mcq')
  const [difficulty, setDifficulty] = useState('easy')
  const [numQs, setNumQs] = useState(5)
  const [file, setFile] = useState(null)
  const [output, setOutput] = useState('')

  const chapters = getChapters(exam, subject)

  async function handleGenerate(e) {
    e.preventDefault()
    if (!file) {
      showStatus('Please select a PDF file', 'error')
      return
    }
    if (!chapter) {
      showStatus('Please select a chapter', 'error')
      return
    }
    showStatus('Generating questions...', 'success')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('exam', exam)
      formData.append('subject', subject)
      formData.append('chapter', chapter)
      formData.append('q_type', qType)
      formData.append('difficulty', difficulty)
      formData.append('num_q', numQs)

      const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: formData
      })
      const result = await response.json()
      if (result.error) {
        setOutput(`Error: ${result.error}${result.hint ? '\n' + result.hint : ''}`)
        showStatus('Failed to generate questions', 'error')
      } else if (result.questions) {
        setOutput(JSON.stringify(result.questions, null, 2))
        showStatus(`Generated ${result.questions.length} questions!`, 'success')
      } else {
        setOutput(JSON.stringify(result, null, 2))
        showStatus('Questions generated successfully!', 'success')
      }
    } catch (err) {
      setOutput(`Error: ${err.message}`)
      showStatus('Error generating questions', 'error')
    }
  }

  return (
    <div className="page-content">
      <h2>Generate from PDF</h2>
      <form onSubmit={handleGenerate} className="form-panel">
        <div className="form-group">
          <label>Upload PDF File:</label>
          <label className={`file-input-label ${file ? 'has-file' : ''}`} htmlFor="fileInput">
            {file ? `Selected: ${file.name}` : 'Drag & drop PDF file here or click to browse'}
          </label>
          <input
            type="file" id="fileInput" accept=".pdf" style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </div>

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
              <option value="conceptual">Conceptual</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
          <div className="form-group">
            <label>Difficulty:</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
          <div className="form-group">
            <label>Number of Questions:</label>
            <input type="number" min="1" max="50" value={numQs} onChange={(e) => setNumQs(e.target.value)} />
          </div>
        </div>

        <button type="submit">Generate Questions</button>
      </form>

      {output && <div className="output-box">{output}</div>}
    </div>
  )
}
