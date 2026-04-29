import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const BOARDS = ['CBSE', 'ICSE', 'State']
const GRADES = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']
const SUBJECTS = ['Mathematics', 'Science', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Economics', 'Political Science', 'Accountancy', 'Business Studies']
const YEARS = ['2025', '2024', '2023', '2022', '2021', '2020']

const RETRIEVE_TYPES = [
  { id: 'sample_paper', label: 'Sample Paper' },
  { id: 'exam_paper', label: 'Question Paper' },
  { id: 'exam_and_answer', label: 'Question Paper + Answer Sheet' },
  { id: 'answer_only', label: 'Answer Sheet Only' },
]

export default function ExamPaperRetrieve({ showStatus }) {
  const [retrieveType, setRetrieveType] = useState('exam_paper')
  const [board, setBoard] = useState('')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [year, setYear] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const [papers, setPapers] = useState([])
  const [selectedPaperId, setSelectedPaperId] = useState('')
  const [paperQuestions, setPaperQuestions] = useState([])
  const [loadingPaperQs, setLoadingPaperQs] = useState(false)

  useEffect(() => {
    async function loadPapers() {
      const { data } = await supabase
        .from('exam_questions')
        .select('source_paper_id, subject, board, year, exam_type')
        .not('source_paper_id', 'is', null)
      if (!data) return
      const grouped = {}
      data.forEach(r => {
        const id = r.source_paper_id
        if (!grouped[id]) grouped[id] = { source_paper_id: id, subject: r.subject, board: r.board, year: r.year, exam_type: r.exam_type, count: 0 }
        grouped[id].count++
      })
      setPapers(Object.values(grouped).sort((a, b) => `${a.subject}`.localeCompare(`${b.subject}`)))
    }
    loadPapers()
  }, [])

  async function handlePaperSelect(paperId) {
    setSelectedPaperId(paperId)
    setPaperQuestions([])
    if (!paperId) return
    setLoadingPaperQs(true)
    const { data } = await supabase
      .from('exam_questions')
      .select('*')
      .eq('source_paper_id', paperId)
      .order('created_at', { ascending: true })
    setPaperQuestions(data || [])
    setLoadingPaperQs(false)
  }

  function paperLabel(p) {
    return `${p.board} · ${p.subject} · ${p.year} (${p.count} qs)`
  }

  function storagePathFromUrl(url) {
    if (!url) return null
    const marker = '/pdf-uploads/'
    const idx = url.indexOf(marker)
    return idx !== -1 ? url.slice(idx + marker.length) : null
  }

  async function handleDelete(row) {
    if (!window.confirm('Delete this record and its files permanently?')) return
    setDeletingId(row.id)
    try {
      const paths = [storagePathFromUrl(row.exam_paper_pdf), storagePathFromUrl(row.answer_key_pdf)].filter(Boolean)
      if (paths.length) await supabase.storage.from('pdf-uploads').remove(paths)
      const { error } = await supabase.from('pdf_uploads').delete().eq('id', row.id)
      if (error) throw error
      setResults(prev => prev.filter(r => r.id !== row.id))
      showStatus('Deleted successfully.', 'success')
    } catch (err) {
      showStatus(`Delete failed: ${err.message}`, 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSearch(e) {
    e.preventDefault()
    setLoading(true)
    setResults(null)

    try {
      let query = supabase.from('pdf_uploads').select('*')

      if (retrieveType === 'sample_paper') {
        query = query.eq('exam_type', 'sample_paper')
      } else {
        query = query.eq('exam_type', 'board_exam')
      }

      if (board) query = query.eq('board', board)
      if (grade) query = query.eq('grade', grade)
      if (subject) query = query.eq('subject', subject)
      if (year) query = query.eq('year', year)

      const { data, error } = await query.order('uploaded_at', { ascending: false })

      if (error) throw error

      setResults(data)
      if (data.length === 0) showStatus('No records found for the selected filters.', 'error')
    } catch (err) {
      showStatus(`Search failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  function getLinksForRow(row) {
    const links = []
    if (retrieveType === 'sample_paper' && row.exam_paper_pdf) {
      links.push({ label: 'Sample Paper', url: row.exam_paper_pdf })
    }
    if (retrieveType === 'exam_paper' && row.exam_paper_pdf) {
      links.push({ label: 'Question Paper', url: row.exam_paper_pdf })
    }
    if (retrieveType === 'exam_and_answer') {
      if (row.exam_paper_pdf) links.push({ label: 'Question Paper', url: row.exam_paper_pdf })
      if (row.answer_key_pdf) links.push({ label: 'Answer Sheet', url: row.answer_key_pdf })
    }
    if (retrieveType === 'answer_only' && row.answer_key_pdf) {
      links.push({ label: 'Answer Sheet', url: row.answer_key_pdf })
    }
    return links
  }

  return (
    <div className="page-content">
      <h2>Exam Paper Retrieve</h2>

      <div className="form-panel" style={{ marginBottom: '24px' }}>
        <div className="form-group">
          <label>Browse Extracted Questions by Paper</label>
          <select
            value={selectedPaperId}
            onChange={e => handlePaperSelect(e.target.value)}
            style={{ maxWidth: '480px' }}
          >
            <option value="">— Select a paper —</option>
            {papers.map(p => (
              <option key={p.source_paper_id} value={p.source_paper_id}>
                {paperLabel(p)}
              </option>
            ))}
          </select>
        </div>

        {loadingPaperQs && <p style={{ color: '#6b8a80', fontSize: '13px' }}>Loading questions…</p>}

        {paperQuestions.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ fontSize: '13px', color: '#6b8a80', marginBottom: '12px' }}>
              {paperQuestions.length} questions
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {paperQuestions.map((q, i) => (
                <div key={q.id} style={{
                  background: '#f7faf9', border: '1px solid #d5e8e0', borderRadius: '10px', padding: '12px 16px'
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: '#fff', background: '#4a6e6a', borderRadius: '5px', padding: '2px 8px' }}>
                      {q.question_type === 'ar' ? 'Assertion & Reason' : q.question_type?.toUpperCase()}
                    </span>
                    {q.marks && <span style={{ fontSize: '12px', color: '#6b8a80' }}>{q.marks} marks</span>}
                    <span style={{ fontSize: '12px', color: '#aaa', marginLeft: 'auto' }}>Q{q.question_number || i + 1}</span>
                  </div>
                  <p style={{ fontSize: '14px', color: '#2c3e3a', margin: 0, whiteSpace: 'pre-wrap' }}>{q.question_text}</p>
                  {q.has_diagram && q.paper_pdf_url && (
                    <a
                      href={q.paper_pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '10px',
                        padding: '6px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '600',
                        background: '#fff4e0', border: '1px solid #f0a830', color: '#b97000', textDecoration: 'none'
                      }}
                    >
                      View Original Paper — Q{q.question_number || i + 1}
                    </a>
                  )}
                  {q.correct_answer && (
                    <p style={{ fontSize: '13px', color: '#5a8a7a', marginTop: '8px', marginBottom: 0 }}>
                      <strong>Answer:</strong> {q.correct_answer}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="form-panel">
        <div className="form-group">
          <label>What do you want to retrieve?</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {RETRIEVE_TYPES.map(t => (
              <label key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                fontWeight: retrieveType === t.id ? '600' : '400',
                color: retrieveType === t.id ? '#4a6e6a' : '#6b8a80'
              }}>
                <input
                  type="radio"
                  name="retrieveType"
                  value={t.id}
                  checked={retrieveType === t.id}
                  onChange={() => { setRetrieveType(t.id); setResults(null) }}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <form onSubmit={handleSearch}>
          <div className="form-row">
            <div className="form-group">
              <label>Board</label>
              <select value={board} onChange={e => setBoard(e.target.value)}>
                <option value="">All boards</option>
                {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Grade</label>
              <select value={grade} onChange={e => setGrade(e.target.value)}>
                <option value="">All grades</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Subject</label>
              <select value={subject} onChange={e => setSubject(e.target.value)}>
                <option value="">All subjects</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Year</label>
              <select value={year} onChange={e => setYear(e.target.value)}>
                <option value="">All years</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {results && results.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <p style={{ fontSize: '13px', color: '#6b8a80', marginBottom: '12px' }}>
            {results.length} record{results.length !== 1 ? 's' : ''} found
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {results.map(row => {
              const links = getLinksForRow(row)
              return (
                <div key={row.id} style={{
                  background: '#fff', border: '1px solid #d5e8e0', borderRadius: '12px',
                  padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontWeight: '600', color: '#2c3e3a', fontSize: '15px' }}>
                      {row.subject} — {row.grade}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b8a80', marginTop: '4px' }}>
                      {row.board}{row.year ? ` · ${row.year}` : ''} · {row.exam_type === 'sample_paper' ? 'Sample Paper' : 'Board Exam'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {links.length > 0 ? links.map(link => (
                      <a
                        key={link.label}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                          background: 'linear-gradient(135deg, #4a6e6a 0%, #5a8a7a 100%)',
                          color: '#fff', textDecoration: 'none'
                        }}
                      >
                        {link.label}
                      </a>
                    )) : (
                      <span style={{ fontSize: '13px', color: '#aaa' }}>Not available</span>
                    )}
                    <button
                      onClick={() => handleDelete(row)}
                      disabled={deletingId === row.id}
                      style={{
                        padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                        background: '#fff', border: '1px solid #e57373', color: '#c62828', cursor: 'pointer'
                      }}
                    >
                      {deletingId === row.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
