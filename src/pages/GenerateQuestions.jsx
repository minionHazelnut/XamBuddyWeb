import { useState, useEffect } from 'react'
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

export default function GenerateQuestions({ showStatus }) {
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [qType, setQType] = useState('mcq')
  const [difficulty, setDifficulty] = useState('easy')
  const [numQs, setNumQs] = useState(5)
  const [file, setFile] = useState(null)
  const [existingPdfUrl, setExistingPdfUrl] = useState(null)
  const [checkingPdf, setCheckingPdf] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [existingQuestions, setExistingQuestions] = useState([])
  const [newQuestions, setNewQuestions] = useState([])
  const [existingCount, setExistingCount] = useState(0)
  const [loadingExisting, setLoadingExisting] = useState(false)

  const chapters = getChapters(exam, subject)

  useEffect(() => {
    if (exam && subject && chapter) {
      fetchExisting()
      checkForExistingPdf()
    } else {
      setExistingQuestions([])
      setExistingCount(0)
      setExistingPdfUrl(null)
    }
  }, [exam, subject, chapter, qType, difficulty])

  async function checkForExistingPdf() {
    setCheckingPdf(true)
    const { grade, board } = parseExam(exam)
    const { data } = await supabase
      .from('pdf_uploads')
      .select('chapter_pdf')
      .eq('board', board)
      .eq('grade', grade)
      .eq('subject', subject)
      .eq('chapter', chapter)
      .not('chapter_pdf', 'is', null)
      .limit(1)
    setExistingPdfUrl(data?.[0]?.chapter_pdf || null)
    setCheckingPdf(false)
  }

  async function fetchExisting() {
    setLoadingExisting(true)
    try {
      const params = new URLSearchParams({
        exam, subject, chapter, q_type: qType, difficulty, limit: '500', shuffle: 'false'
      })
      const resp = await fetch(`${API_BASE}/api/retrieve?${params}`)
      const data = await resp.json()
      if (data.questions) {
        setExistingQuestions(data.questions)
        setExistingCount(data.questions.length)
      }
    } catch {
      setExistingQuestions([])
      setExistingCount(0)
    }
    setLoadingExisting(false)
  }

  function parseExam(examStr) {
    const gradeMatch = examStr.match(/^(\d+th|\d+st|\d+nd|\d+rd)/i)
    const grade = gradeMatch ? gradeMatch[1] : ''
    const boardMatch = examStr.match(/(CBSE|ICSE|State)/i)
    const board = boardMatch ? boardMatch[1].toUpperCase() : ''
    return { grade, board }
  }

  async function uploadChapterPdf(grade, board) {
    try {
      const { data: existing } = await supabase
        .from('pdf_uploads')
        .select('id')
        .eq('board', board)
        .eq('grade', grade)
        .eq('subject', subject)
        .eq('chapter', chapter)
        .not('chapter_pdf', 'is', null)
        .limit(1)
      if (existing && existing.length > 0) return

      const fileName = `chapter-pdfs/${Date.now()}_${file.name}`
      const { error: storageError } = await supabase.storage
        .from('pdf-uploads')
        .upload(fileName, file)
      if (storageError) return
      const { data: urlData } = supabase.storage.from('pdf-uploads').getPublicUrl(fileName)
      await supabase.from('pdf_uploads').insert({
        board, grade, subject, chapter,
        chapter_pdf: urlData.publicUrl,
      })
    } catch {}
  }

  async function handleGenerate(e) {
    e.preventDefault()
    if (!file && !existingPdfUrl) {
      showStatus('Please select a PDF file', 'error')
      return
    }
    if (!chapter) {
      showStatus('Please select a chapter', 'error')
      return
    }
    setGenerating(true)
    setNewQuestions([])
    try {
      const { grade, board } = parseExam(exam)

      let pdfFile = file
      if (!pdfFile && existingPdfUrl) {
        const res = await fetch(existingPdfUrl)
        const blob = await res.blob()
        pdfFile = new File([blob], 'chapter.pdf', { type: 'application/pdf' })
      }

      const formData = new FormData()
      formData.append('file', pdfFile)
      formData.append('exam', exam)
      formData.append('subject', subject)
      formData.append('chapter', chapter)
      formData.append('q_type', qType)
      formData.append('difficulty', difficulty)
      formData.append('num_q', numQs)

      const [response] = await Promise.all([
        fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData }),
        uploadChapterPdf(grade, board),
      ])

      const text = await response.text()
      if (!text) {
        showStatus(`Server returned an empty response (status ${response.status})`, 'error')
        return
      }
      let result
      try {
        result = JSON.parse(text)
      } catch {
        showStatus(`Server error: ${text.slice(0, 200)}`, 'error')
        return
      }
      if (result.error) {
        showStatus(`Failed: ${result.error}`, 'error')
      } else if (result.questions) {
        setNewQuestions(result.questions)
        showStatus(`Generated ${result.questions.length} new questions!`, 'success')
        await fetchExisting()
      }
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error')
    }
    setGenerating(false)
  }

  const filterLabel = [exam, subject, chapter, qType.toUpperCase(), difficulty].filter(Boolean).join(' / ')

  return (
    <div className="page-content">
      <h2>Generate from PDF</h2>

      <form onSubmit={handleGenerate} className="form-panel">
        <div className="form-group">
          <label>PDF File:</label>
          {checkingPdf ? (
            <div className="file-input-label" style={{ color: '#6b8a80' }}>Checking database...</div>
          ) : existingPdfUrl && !file ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: '#d4edda', border: '2px solid #28a745', borderRadius: '10px' }}>
              <span style={{ flex: 1, fontSize: '14px', color: '#155724', fontWeight: '500' }}>Using saved PDF from database</span>
              <button type="button" onClick={() => setExistingPdfUrl(null)} style={{ fontSize: '12px', color: '#155724', background: 'none', border: '1px solid #28a745', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>Upload different PDF</button>
            </div>
          ) : (
            <>
              <label className={`file-input-label ${file ? 'has-file' : ''}`} htmlFor="fileInput">
                {file ? `Selected: ${file.name}` : 'Drag & drop PDF file here or click to browse'}
              </label>
              <input
                type="file" id="fileInput" accept=".pdf" style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
            </>
          )}
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

        <button type="submit" disabled={generating}>
          {generating ? 'Generating...' : 'Generate Questions'}
        </button>
      </form>

      {/* Loading overlay */}
      {generating && (
        <div className="gen-loading">
          <div className="gen-spinner"></div>
          <p>Generating {numQs} {qType.toUpperCase()} questions...</p>
          <p className="gen-loading-sub">This may take 15-30 seconds depending on the number of questions</p>
        </div>
      )}

      {/* Stats bar */}
      {exam && subject && chapter && (
        <div className="gen-stats">
          <span className="gen-stats-label">{filterLabel}</span>
          <span className="gen-stats-count">
            {loadingExisting ? '...' : `${existingCount} questions in database`}
            {newQuestions.length > 0 && ` (+${newQuestions.length} just added)`}
          </span>
        </div>
      )}

      {/* Two-panel comparison */}
      {(existingQuestions.length > 0 || newQuestions.length > 0) && (
        <div className="gen-panels">
          <div className="gen-panel">
            <div className="gen-panel-header">
              <h3>Existing Questions ({existingCount})</h3>
            </div>
            <div className="gen-panel-body">
              {existingQuestions.length === 0 ? (
                <p className="gen-empty">No existing questions for this category</p>
              ) : (
                <ol className="gen-question-list">
                  {existingQuestions.map((q, i) => (
                    <li key={i}>{q.question}</li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="gen-panel gen-panel-new">
            <div className="gen-panel-header gen-panel-header-new">
              <h3>Newly Generated ({newQuestions.length})</h3>
            </div>
            <div className="gen-panel-body">
              {newQuestions.length === 0 ? (
                <p className="gen-empty">{generating ? 'Generating...' : 'No new questions yet'}</p>
              ) : (
                <ol className="gen-question-list" start={existingCount - newQuestions.length + 1}>
                  {newQuestions.map((q, i) => (
                    <li key={i}>{q.question}</li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
