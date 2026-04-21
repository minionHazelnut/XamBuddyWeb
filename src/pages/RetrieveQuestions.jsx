import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CHAPTERS_BY_EXAM_SUBJECT } from '../lib/chapters'

const API_BASE = import.meta.env.VITE_API_URL || ''

function getChapters(exam, subject) {
  return CHAPTERS_BY_EXAM_SUBJECT[exam]?.[subject] || []
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` }
}

export default function RetrieveQuestions({ showStatus }) {
  const [exam, setExam] = useState('')
  const [subject, setSubject] = useState('')
  const [chapter, setChapter] = useState('')
  const [qType, setQType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [numQs, setNumQs] = useState(10)
  const [questions, setQuestions] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editFields, setEditFields] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)

  const [availableExams, setAvailableExams] = useState([])
  const [availableSubjects, setAvailableSubjects] = useState([])
  const [chapters, setChapters] = useState([])
  const [loadingChapters, setLoadingChapters] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/meta/options`)
      .then(r => r.json())
      .then(data => { setAvailableExams(data.exams || []) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!exam) { setAvailableSubjects([]); return }
    fetch(`${API_BASE}/api/meta/options?exam=${encodeURIComponent(exam)}`)
      .then(r => r.json())
      .then(data => { setAvailableSubjects(data.subjects || []) })
      .catch(() => {})
  }, [exam])

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

  async function handleRetrieve(e) {
    e.preventDefault()
    showStatus('Retrieving questions...', 'success')
    try {
      const headers = await getAuthHeaders()
      const params = new URLSearchParams({ exam, subject, chapter, q_type: qType, difficulty, limit: numQs.toString() })
      const response = await fetch(`${API_BASE}/api/retrieve?${params}`, { headers })
      const result = await response.json()
      if (result.success) {
        setQuestions(result.questions)
        showStatus(`Retrieved ${result.count} questions.`, 'success')
      } else {
        showStatus('Failed to retrieve questions', 'error')
      }
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error')
    }
  }

  function startEdit(q) {
    setEditingId(q.id)
    setEditFields({ question_text: q.question, correct_answer: q.answer || '', explanation: q.explanation || '', difficulty: q.difficulty || '', question_type: q.question_type || '' })
  }

  async function saveEdit(id) {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/questions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFields),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.detail || 'Save failed')
      setQuestions(qs => qs.map(q => q.id === id ? { ...q, question: editFields.question_text, answer: editFields.correct_answer, explanation: editFields.explanation, difficulty: editFields.difficulty, question_type: editFields.question_type } : q))
      setEditingId(null)
      showStatus('Question updated.', 'success')
    } catch (err) {
      showStatus(`Save failed: ${err.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this question?')) return
    setDeleting(id)
    try {
      const res = await fetch(`${API_BASE}/api/questions/${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (!result.success) throw new Error(result.detail || 'Delete failed')
      setQuestions(qs => qs.filter(q => q.id !== id))
      showStatus('Question deleted.', 'success')
    } catch (err) {
      showStatus(`Delete failed: ${err.message}`, 'error')
    } finally {
      setDeleting(null)
    }
  }

  const badge = (text, color = '#e8f0ee') => (
    <span style={{ background: color, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', marginRight: '6px' }}>{text}</span>
  )

  return (
    <div className="page-content">
      <h2>Retrieve from Database</h2>
      <form onSubmit={handleRetrieve} className="form-panel">
        <div className="form-row">
          <div className="form-group">
            <label>Exam:</label>
            <select value={exam} onChange={(e) => { setExam(e.target.value); setSubject(''); setChapter('') }}>
              <option value="">Select Exam</option>
              {availableExams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Subject:</label>
            <select value={subject} onChange={(e) => { setSubject(e.target.value); setChapter('') }} disabled={!exam || availableSubjects.length === 0}>
              <option value="">{!exam ? 'Select exam first' : availableSubjects.length === 0 ? 'No subjects found' : 'Select Subject'}</option>
              {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
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
              <option value="">All Types</option>
              <option value="mcq">MCQ</option>
              <option value="short">Short Answer</option>
              <option value="long">Long Answer</option>
              <option value="conceptual">Conceptual</option>
              <option value="cbq">CBQ</option>
            </select>
          </div>
          <div className="form-group">
            <label>Difficulty:</label>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">All Levels</option>
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

      {questions.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <p style={{ color: '#6b8a80', marginBottom: '12px', fontSize: '14px' }}>{questions.length} questions</p>
          {questions.map((q, i) => (
            <div key={q.id || i} className="form-panel" style={{ marginBottom: '12px' }}>
              {editingId === q.id ? (
                <div>
                  <div className="form-group">
                    <label style={{ fontSize: '12px' }}>Question</label>
                    <textarea rows={3} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #c8d8d5', fontSize: '14px', resize: 'vertical' }} value={editFields.question_text} onChange={e => setEditFields(f => ({ ...f, question_text: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '12px' }}>Answer</label>
                    <textarea rows={3} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #c8d8d5', fontSize: '14px', resize: 'vertical' }} value={editFields.correct_answer} onChange={e => setEditFields(f => ({ ...f, correct_answer: e.target.value }))} />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontSize: '12px' }}>Difficulty</label>
                      <select value={editFields.difficulty} onChange={e => setEditFields(f => ({ ...f, difficulty: e.target.value }))}>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '12px' }}>Type</label>
                      <select value={editFields.question_type} onChange={e => setEditFields(f => ({ ...f, question_type: e.target.value }))}>
                        <option value="mcq">MCQ</option>
                        <option value="short">Short Answer</option>
                        <option value="long">Long Answer</option>
                        <option value="conceptual">Conceptual</option>
                        <option value="cbq">CBQ</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => saveEdit(q.id)} disabled={saving} style={{ padding: '6px 16px' }}>{saving ? 'Saving...' : 'Save'}</button>
                    <button onClick={() => setEditingId(null)} style={{ padding: '6px 16px', background: 'none', border: '1px solid #c8d8d5', color: '#6b8a80', cursor: 'pointer', borderRadius: '8px' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      {q.question_type && badge(q.question_type.toUpperCase())}
                      {q.difficulty && badge(q.difficulty)}
                      {q.chapter && badge(q.chapter, '#f0f4f3')}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button onClick={() => startEdit(q)} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>Edit</button>
                      <button onClick={() => handleDelete(q.id)} disabled={deleting === q.id} style={{ background: 'none', border: '1px solid #c0392b', color: '#c0392b', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>{deleting === q.id ? '...' : 'Delete'}</button>
                    </div>
                  </div>
                  <p style={{ fontWeight: '500', marginBottom: '6px' }}>Q{i + 1}. {q.question}</p>
                  {q.options && typeof q.options === 'object' && (
                    <div style={{ fontSize: '14px', color: '#555', margin: '4px 0 8px 0' }}>
                      {Object.entries(q.options).map(([k, v]) => <div key={k}><strong>{k}.</strong> {v}</div>)}
                    </div>
                  )}
                  {(q.answer || q.correct_answer) && (
                    <p style={{ color: '#4a6e6a', fontSize: '14px' }}><strong>Answer:</strong> {q.answer || q.correct_answer}</p>
                  )}
                  {q.explanation && (
                    <p style={{ color: '#6b8a80', fontSize: '13px', marginTop: '4px' }}><strong>Explanation:</strong> {q.explanation}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
