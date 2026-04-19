import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CHAPTERS_BY_EXAM_SUBJECT } from '../lib/chapters'

const BOARDS = ['CBSE', 'ICSE', 'State']
const GRADES = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']
const EXAMS = ['10th CBSE Board', '12th CBSE Board']

function getSubjects(exam) {
  return exam ? Object.keys(CHAPTERS_BY_EXAM_SUBJECT[exam] || {}) : []
}

function getChapters(exam, subject) {
  return CHAPTERS_BY_EXAM_SUBJECT[exam]?.[subject] || []
}

export default function RetrieveChapterPdfs({ showStatus }) {
  const [exam, setExam] = useState('')
  const [board, setBoard] = useState('')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')

  const subjects = getSubjects(exam)
  const chapters = getChapters(exam, subject)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  function storagePathFromUrl(url) {
    if (!url) return null
    const marker = '/pdf-uploads/'
    const idx = url.indexOf(marker)
    return idx !== -1 ? url.slice(idx + marker.length) : null
  }

  async function handleDelete(row) {
    if (!window.confirm('Delete this PDF permanently?')) return
    setDeletingId(row.id)
    try {
      const path = storagePathFromUrl(row.chapter_pdf)
      if (path) await supabase.storage.from('pdf-uploads').remove([path])
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
      let query = supabase
        .from('pdf_uploads')
        .select('*')
        .not('chapter_pdf', 'is', null)

      if (board) query = query.eq('board', board)
      if (grade) query = query.eq('grade', grade)
      if (subject) query = query.eq('subject', subject)
      if (chapter) query = query.ilike('chapter', `%${chapter}%`)

      const { data, error } = await query.order('uploaded_at', { ascending: false })

      if (error) throw error

      setResults(data)
      if (data.length === 0) showStatus('No chapter PDFs found for the selected filters.', 'error')
    } catch (err) {
      showStatus(`Search failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-content">
      <h2>Retrieve Chapter PDFs</h2>

      <div className="form-panel">
        <form onSubmit={handleSearch}>
          <div className="form-row">
            <div className="form-group">
              <label>Exam</label>
              <select value={exam} onChange={e => { setExam(e.target.value); setSubject(''); setChapter('') }}>
                <option value="">All exams</option>
                {EXAMS.map(ex => <option key={ex} value={ex}>{ex}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Subject</label>
              <select value={subject} onChange={e => { setSubject(e.target.value); setChapter('') }} disabled={!exam}>
                <option value="">{exam ? 'All subjects' : 'Select exam first'}</option>
                {subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Chapter</label>
              <select value={chapter} onChange={e => setChapter(e.target.value)} disabled={!subject}>
                <option value="">{subject ? 'All chapters' : 'Select subject first'}</option>
                {chapters.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Board</label>
              <select value={board} onChange={e => setBoard(e.target.value)}>
                <option value="">All boards</option>
                {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Grade</label>
              <select value={grade} onChange={e => setGrade(e.target.value)}>
                <option value="">All grades</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
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
            {results.length} chapter PDF{results.length !== 1 ? 's' : ''} found
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {results.map(row => (
              <div key={row.id} style={{
                background: '#fff', border: '1px solid #d5e8e0', borderRadius: '12px',
                padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: '600', color: '#2c3e3a', fontSize: '15px' }}>
                    {row.subject}{row.chapter ? ` — ${row.chapter}` : ''}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b8a80', marginTop: '4px' }}>
                    {[row.board, row.grade].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <a
                    href={row.chapter_pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      background: 'linear-gradient(135deg, #4a6e6a 0%, #5a8a7a 100%)',
                      color: '#fff', textDecoration: 'none'
                    }}
                  >
                    Open PDF
                  </a>
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
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
