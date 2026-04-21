import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CHAPTERS_BY_EXAM_SUBJECT } from '../lib/chapters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const SUBJECTS = [
  'Biology', 'Chemistry', 'Computer Science', 'Economics', 'English',
  'Geography', 'Hindi', 'History', 'Mathematics', 'Physics',
  'Political Science', 'Psychology',
]

function getChapters(exam, subject) {
  return CHAPTERS_BY_EXAM_SUBJECT[exam]?.[subject] || []
}

export default function GenerateQuestions({ showStatus }) {
  const [availableExams, setAvailableExams] = useState([])
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
  const [generatingAll, setGeneratingAll] = useState(false)
  const [allProgress, setAllProgress] = useState(null)
  const [existingQuestions, setExistingQuestions] = useState([])
  const [newQuestions, setNewQuestions] = useState([])
  const [existingCount, setExistingCount] = useState(0)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [chapterHistory, setChapterHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [chapters, setChapters] = useState([])
  const [loadingChapters, setLoadingChapters] = useState(false)

  const DEFAULT_EXAMS = ['10th CBSE Board', '12th CBSE Board']

  useEffect(() => {
    fetchChapterHistory()
    fetch(`${API_BASE}/api/meta/options`)
      .then(r => r.json())
      .then(data => {
        const db = data.exams || []
        const merged = [...new Set([...DEFAULT_EXAMS, ...db])].sort()
        setAvailableExams(merged)
      })
      .catch(() => setAvailableExams(DEFAULT_EXAMS))
  }, [])

  useEffect(() => {
    if (!exam || !subject) { setChapters([]); return }
    setLoadingChapters(true)
    fetch(`${API_BASE}/api/chapters?exam=${encodeURIComponent(exam)}&subject=${encodeURIComponent(subject)}`)
      .then(r => r.json())
      .then(data => {
        const db = data.chapters || []
        setChapters(db.length > 0 ? db : getChapters(exam, subject))
      })
      .catch(() => setChapters(getChapters(exam, subject)))
      .finally(() => setLoadingChapters(false))
  }, [exam, subject])

  async function fetchChapterHistory() {
    setHistoryLoading(true)
    try {
      const [statsRes, metaRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats`),
        supabase.from('chapter_meta').select('subject, exam, chapter, practical_pct, theory_pct'),
      ])
      const statsData = await statsRes.json()
      const metaData = metaRes.data || []
      const grouped = {}
      for (const row of (statsData.stats || [])) {
        const key = `${row.exam}||${row.subject}||${row.chapter}`
        if (!grouped[key]) grouped[key] = { exam: row.exam, subject: row.subject, chapter: row.chapter, total: 0, byType: {} }
        grouped[key].total += row.count
        grouped[key].byType[row.question_type] = (grouped[key].byType[row.question_type] || 0) + row.count
      }
      for (const meta of metaData) {
        const key = `${meta.exam}||${meta.subject}||${meta.chapter}`
        if (grouped[key]) { grouped[key].practical_pct = meta.practical_pct; grouped[key].theory_pct = meta.theory_pct }
      }
      setChapterHistory(Object.values(grouped).sort((a, b) => b.total - a.total))
    } catch {}
    setHistoryLoading(false)
  }

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

  const GENERATE_ALL_BATCHES = [
    { q_type: 'mcq',        num_q: 25, label: 'MCQs (1/2)' },
    { q_type: 'mcq',        num_q: 25, label: 'MCQs (2/2)' },
    { q_type: 'vsa',        num_q: 30, label: 'Very Short Answers' },
    { q_type: 'short',      num_q: 30, label: 'Short Answers' },
    { q_type: 'long',       num_q: 15, label: 'Long Answers' },
    { q_type: 'conceptual', num_q: 15, label: 'Conceptual' },
    { q_type: 'cbq',        num_q: 10, label: 'Case-Based Questions' },
  ]

  async function handleGenerateAll(e) {
    e.preventDefault()
    if (!file && !existingPdfUrl) { showStatus('Please select a PDF file', 'error'); return }
    if (!chapter) { showStatus('Please select a chapter', 'error'); return }

    setGeneratingAll(true)
    setAllProgress({ current: 0, total: GENERATE_ALL_BATCHES.length, label: '', saved: 0, errors: [] })

    const { grade, board: boardStr } = parseExam(exam)
    let pdfFile = file
    if (!pdfFile && existingPdfUrl) {
      const res = await fetch(existingPdfUrl)
      const blob = await res.blob()
      pdfFile = new File([blob], 'chapter.pdf', { type: 'application/pdf' })
    }

    let totalSaved = 0
    const errors = []

    for (let i = 0; i < GENERATE_ALL_BATCHES.length; i++) {
      const batch = GENERATE_ALL_BATCHES[i]
      setAllProgress({ current: i + 1, total: GENERATE_ALL_BATCHES.length, label: batch.label, saved: totalSaved, errors })

      try {
        const formData = new FormData()
        formData.append('file', pdfFile)
        formData.append('exam', exam)
        formData.append('subject', subject)
        formData.append('chapter', chapter)
        formData.append('q_type', batch.q_type)
        formData.append('difficulty', 'mixed')
        formData.append('num_q', batch.num_q)

        if (i === 0) {
          const [res] = await Promise.all([
            fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData }),
            uploadChapterPdf(grade, boardStr),
          ])
          const result = await res.json()
          if (result.questions) totalSaved += result.questions.length
          else if (result.error) errors.push(`${batch.label}: ${result.error}`)
        } else {
          const res = await fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData })
          const result = await res.json()
          if (result.questions) totalSaved += result.questions.length
          else if (result.error) errors.push(`${batch.label}: ${result.error}`)
        }
      } catch (err) {
        errors.push(`${batch.label}: ${err.message}`)
      }
    }

    setAllProgress({ current: GENERATE_ALL_BATCHES.length, total: GENERATE_ALL_BATCHES.length, label: 'Done', saved: totalSaved, errors })
    setGeneratingAll(false)
    showStatus(`Generate All complete — ${totalSaved} questions saved${errors.length ? `, ${errors.length} errors` : ''}`, errors.length ? 'error' : 'success')
    await fetchExisting()
    fetchChapterHistory()
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
              {availableExams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
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
          <select value={chapter} onChange={(e) => setChapter(e.target.value)} disabled={chapters.length === 0 || loadingChapters}>
            <option value="">{loadingChapters ? 'Loading chapters...' : chapters.length === 0 ? 'Select exam & subject first' : 'Select Chapter'}</option>
            {chapters.map(ch => <option key={ch} value={ch}>{ch}</option>)}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Question Type:</label>
            <select value={qType} onChange={(e) => setQType(e.target.value)}>
              <option value="mcq">MCQ</option>
              <option value="vsa">Very Short Answer</option>
              <option value="short">Short Answer</option>
              <option value="long">Long Answer</option>
              <option value="conceptual">Conceptual</option>
              <option value="cbq">Case-Based (CBQ)</option>
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

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" disabled={generating || generatingAll}>
            {generating ? 'Generating...' : 'Generate Questions'}
          </button>
          <button type="button" onClick={handleGenerateAll} disabled={generating || generatingAll}
            style={{ background: '#2d4a47', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
            {generatingAll ? 'Generating All...' : '⚡ Generate All (150 questions)'}
          </button>
        </div>
      </form>

      {generatingAll && allProgress && (
        <div style={{ marginTop: '16px', padding: '16px', background: '#f0f4f3', borderRadius: '10px', border: '1px solid #c8d8d5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontWeight: '600', color: '#2d4a47' }}>Generating: {allProgress.label}</span>
            <span style={{ color: '#6b8a80', fontSize: '13px' }}>{allProgress.current} / {allProgress.total} batches</span>
          </div>
          <div style={{ background: '#c8d8d5', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
            <div style={{ background: '#4a6e6a', height: '100%', width: `${(allProgress.current / allProgress.total) * 100}%`, transition: 'width 0.3s' }} />
          </div>
          <p style={{ marginTop: '8px', fontSize: '13px', color: '#6b8a80' }}>{allProgress.saved} questions saved so far</p>
          {allProgress.errors.length > 0 && allProgress.errors.map((e, i) => (
            <p key={i} style={{ fontSize: '12px', color: '#c0392b', margin: '2px 0' }}>{e}</p>
          ))}
        </div>
      )}

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
      <div style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3>Chapter History</h3>
          <button onClick={fetchChapterHistory} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Refresh</button>
        </div>
        {historyLoading ? <p>Loading...</p> : chapterHistory.length === 0 ? (
          <p style={{ color: '#6b8a80' }}>No chapters generated yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Exam</th>
                <th style={{ padding: '8px' }}>Subject</th>
                <th style={{ padding: '8px' }}>Chapter</th>
                <th style={{ padding: '8px' }}>Total Qs</th>
                <th style={{ padding: '8px' }}>By Type</th>
                <th style={{ padding: '8px' }}>Practical / Theory</th>
              </tr>
            </thead>
            <tbody>
              {chapterHistory.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                  <td style={{ padding: '8px' }}>{row.exam}</td>
                  <td style={{ padding: '8px' }}>{row.subject}</td>
                  <td style={{ padding: '8px' }}>{row.chapter}</td>
                  <td style={{ padding: '8px', fontWeight: '600' }}>{row.total}</td>
                  <td style={{ padding: '8px', fontSize: '12px', color: '#6b8a80' }}>
                    {Object.entries(row.byType).map(([t, c]) => `${t}: ${c}`).join(' · ')}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px' }}>
                    {row.practical_pct != null ? `${row.practical_pct}% / ${row.theory_pct}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
