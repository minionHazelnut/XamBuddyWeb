import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''
const BOARDS = ['CBSE', 'ICSE', 'State']
const GRADES = ['10', '12']
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Economics', 'Political Science', 'Accountancy', 'Business Studies', 'Computer Science']
const EXAM_TYPES = ['board exam', 'sample paper', 'school test']

export default function QuestionPaperBank({ showStatus }) {
  const [subject, setSubject] = useState('')
  const [classLevel, setClassLevel] = useState('')
  const [board, setBoard] = useState('')
  const [year, setYear] = useState('')
  const [examType, setExamType] = useState('')
  const [paperFile, setPaperFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])

  const [papers, setPapers] = useState([])
  const [loadingPapers, setLoadingPapers] = useState(false)

  const [selectedPaper, setSelectedPaper] = useState(null)
  const [paperQuestions, setPaperQuestions] = useState([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)

  const [answerKeyFile, setAnswerKeyFile] = useState(null)
  const [matchingAnswerKey, setMatchingAnswerKey] = useState(false)

  useEffect(() => { fetchPapers() }, [])

  async function fetchPapers() {
    setLoadingPapers(true)
    try {
      const { data, error } = await supabase
        .from('exam_questions')
        .select('source_paper_id, subject, class_level, board, year, exam_type, answer_pending')
        .not('source_paper_id', 'is', null)
      if (error) throw error
      const grouped = {}
      for (const row of data) {
        const id = row.source_paper_id
        if (!grouped[id]) {
          grouped[id] = { source_paper_id: id, subject: row.subject, class_level: row.class_level, board: row.board, year: row.year, exam_type: row.exam_type, total: 0, pending: 0 }
        }
        grouped[id].total++
        if (row.answer_pending) grouped[id].pending++
      }
      setPapers(Object.values(grouped))
    } catch (err) {
      showStatus(`Could not load papers: ${err.message}`, 'error')
    } finally {
      setLoadingPapers(false)
    }
  }

  async function handleExtract(e) {
    e.preventDefault()
    if (!paperFile) { showStatus('Please select a question paper PDF.', 'error'); return }
    if (!subject || !classLevel || !board || !examType) { showStatus('Please fill all required fields.', 'error'); return }
    setLoading(true)
    setLog(['Reading PDF and extracting questions...'])
    const formData = new FormData()
    formData.append('file', paperFile)
    formData.append('subject', subject)
    formData.append('class_level', classLevel)
    formData.append('board', board)
    formData.append('year', year)
    formData.append('exam_type', examType)
    try {
      const res = await fetch(`${API_BASE}/api/extract-paper`, { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      setLog([
        'Done.',
        `Questions extracted: ${result.questions_extracted}`,
        `Questions saved: ${result.questions_saved}`,
        `Duplicates skipped: ${result.duplicates_skipped}`,
        `Paper ID: ${result.source_paper_id}`,
      ])
      showStatus(`Extracted ${result.questions_saved} questions successfully.`, 'success')
      setPaperFile(null)
      fetchPapers()
    } catch (err) {
      setLog([`Error: ${err.message}`])
      showStatus(`Extraction failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleMatchAnswerKey(paperId) {
    if (!answerKeyFile) { showStatus('Please select an answer key PDF.', 'error'); return }
    setMatchingAnswerKey(true)
    const formData = new FormData()
    formData.append('file', answerKeyFile)
    formData.append('source_paper_id', paperId)
    try {
      const res = await fetch(`${API_BASE}/api/match-answer-key`, { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      showStatus(`Matched ${result.answers_matched} answers. ${result.answers_failed} failed.`, 'success')
      setAnswerKeyFile(null)
      fetchPapers()
      if (selectedPaper?.source_paper_id === paperId) viewQuestions(paperId)
    } catch (err) {
      showStatus(`Matching failed: ${err.message}`, 'error')
    } finally {
      setMatchingAnswerKey(false)
    }
  }

  async function viewQuestions(paperId) {
    setSelectedPaper(papers.find(p => p.source_paper_id === paperId) || { source_paper_id: paperId })
    setLoadingQuestions(true)
    try {
      const { data, error } = await supabase
        .from('exam_questions')
        .select('*')
        .eq('source_paper_id', paperId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setPaperQuestions(data)
    } catch (err) {
      showStatus(`Could not load questions: ${err.message}`, 'error')
    } finally {
      setLoadingQuestions(false)
    }
  }

  if (selectedPaper) {
    return (
      <div className="page-content">
        <button
          onClick={() => { setSelectedPaper(null); setPaperQuestions([]) }}
          style={{ marginBottom: '16px', background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}
        >
          Back to Papers
        </button>
        <h2>{selectedPaper.subject} — {selectedPaper.board} Class {selectedPaper.class_level} {selectedPaper.year}</h2>

        <div className="form-panel" style={{ marginBottom: '20px' }}>
          <label><strong>Upload Answer Key for this paper</strong></label>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
            <label className={`file-input-label ${answerKeyFile ? 'has-file' : ''}`} style={{ flex: 1 }}>
              {answerKeyFile ? answerKeyFile.name : 'Click to select answer key PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setAnswerKeyFile(e.target.files[0] || null)} />
            </label>
            <button
              onClick={() => handleMatchAnswerKey(selectedPaper.source_paper_id)}
              disabled={matchingAnswerKey || !answerKeyFile}
              style={{ whiteSpace: 'nowrap' }}
            >
              {matchingAnswerKey ? 'Matching...' : 'Match Answers'}
            </button>
          </div>
        </div>

        {loadingQuestions ? <p>Loading questions...</p> : (
          <div>
            <p style={{ color: '#6b8a80', marginBottom: '12px' }}>{paperQuestions.length} questions</p>
            {paperQuestions.map((q, i) => (
              <div key={q.id} className="form-panel" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  <span style={{ background: '#e8f0ee', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{(q.question_type || '').toUpperCase()}</span>
                  {q.difficulty_level && <span style={{ background: '#e8f0ee', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{q.difficulty_level}</span>}
                  {q.marks && <span style={{ background: '#e8f0ee', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{q.marks} marks</span>}
                  {q.answer_pending && <span style={{ background: '#fff3cd', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', color: '#856404' }}>Answer Pending</span>}
                </div>
                <p style={{ fontWeight: '500', marginBottom: '6px' }}>Q{i + 1}. {q.question_text}</p>
                {q.options_json && typeof q.options_json === 'object' && !q.options_json.sub_questions && (
                  <div style={{ fontSize: '14px', color: '#555', marginTop: '4px', marginBottom: '6px' }}>
                    {Object.entries(q.options_json).map(([k, v]) => (
                      <div key={k}><strong>{k}.</strong> {v}</div>
                    ))}
                  </div>
                )}
                {q.correct_answer && (
                  <p style={{ color: '#4a6e6a', fontSize: '14px' }}><strong>Answer:</strong> {q.correct_answer}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-content">
      <h2>Question Paper Bank</h2>

      <div className="form-panel">
        <h3 style={{ marginBottom: '16px' }}>Extract Questions from Paper PDF</h3>
        <form onSubmit={handleExtract}>
          <div className="form-row">
            <div className="form-group">
              <label>Board *</label>
              <select value={board} onChange={e => setBoard(e.target.value)} required>
                <option value="">Select board</option>
                {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Class *</label>
              <select value={classLevel} onChange={e => setClassLevel(e.target.value)} required>
                <option value="">Select class</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Subject *</label>
              <select value={subject} onChange={e => setSubject(e.target.value)} required>
                <option value="">Select subject</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Year</label>
              <input type="text" placeholder="e.g. 2024" value={year} onChange={e => setYear(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Exam Type *</label>
            <select value={examType} onChange={e => setExamType(e.target.value)} required>
              <option value="">Select type</option>
              {EXAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Question Paper PDF *</label>
            <label className={`file-input-label ${paperFile ? 'has-file' : ''}`}>
              {paperFile ? paperFile.name : 'Click to select PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setPaperFile(e.target.files[0] || null)} />
            </label>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Extracting...' : 'Extract Questions'}
          </button>
        </form>

        {log.length > 0 && (
          <div style={{ marginTop: '16px', background: '#f0f4f3', borderRadius: '8px', padding: '12px', fontSize: '13px', fontFamily: 'monospace' }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      <div style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3>Uploaded Papers</h3>
          <button onClick={fetchPapers} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Refresh</button>
        </div>
        {loadingPapers ? <p>Loading...</p> : papers.length === 0 ? (
          <p style={{ color: '#6b8a80' }}>No papers uploaded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Subject</th>
                <th style={{ padding: '8px' }}>Board</th>
                <th style={{ padding: '8px' }}>Class</th>
                <th style={{ padding: '8px' }}>Year</th>
                <th style={{ padding: '8px' }}>Type</th>
                <th style={{ padding: '8px' }}>Questions</th>
                <th style={{ padding: '8px' }}>Answers</th>
                <th style={{ padding: '8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {papers.map(p => (
                <tr key={p.source_paper_id} style={{ borderBottom: '1px solid #e0e8e6' }}>
                  <td style={{ padding: '8px' }}>{p.subject}</td>
                  <td style={{ padding: '8px' }}>{p.board}</td>
                  <td style={{ padding: '8px' }}>{p.class_level}</td>
                  <td style={{ padding: '8px' }}>{p.year || '—'}</td>
                  <td style={{ padding: '8px' }}>{p.exam_type}</td>
                  <td style={{ padding: '8px' }}>{p.total}</td>
                  <td style={{ padding: '8px' }}>
                    {p.pending === 0
                      ? <span style={{ color: '#2e7d5a' }}>All matched</span>
                      : <span style={{ color: '#856404' }}>{p.pending} pending</span>}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button
                      onClick={() => viewQuestions(p.source_paper_id)}
                      style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      View
                    </button>
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
