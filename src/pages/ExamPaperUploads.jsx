import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''
const BOARDS = ['CBSE', 'ICSE', 'State']
const GRADES = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']
const SUBJECTS = ['Accountancy', 'Biology', 'Business Studies', 'Chemistry', 'Economics', 'English', 'Geography', 'History', 'Mathematics', 'Physics', 'Political Science', 'Science']
const UPLOAD_TYPES = ['guide_reference', 'sample_question', 'other']

const sectionTitle = (text) => (
  <h3 style={{ margin: '0 0 16px 0', color: '#2d4a47', fontSize: '16px', borderBottom: '2px solid #e0e8e6', paddingBottom: '8px' }}>{text}</h3>
)

const divider = <hr style={{ border: 'none', borderTop: '2px solid #e0e8e6', margin: '32px 0' }} />

export default function ExamPaperUploads({ showStatus }) {
  // — exam paper upload state —
  const [paperType, setPaperType] = useState('exam_paper')
  const [board, setBoard] = useState('')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [year, setYear] = useState('')
  const [examPaperFile, setExamPaperFile] = useState(null)
  const [answerKeyFile, setAnswerKeyFile] = useState(null)
  const [extractQuestions, setExtractQuestions] = useState(false)
  const [loading, setLoading] = useState(false)
  const [extractLog, setExtractLog] = useState([])

  // — extracted papers state —
  const [papers, setPapers] = useState([])
  const [loadingPapers, setLoadingPapers] = useState(false)
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [paperQuestions, setPaperQuestions] = useState([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [answerKeyForPaper, setAnswerKeyForPaper] = useState(null)
  const [matchingAnswerKey, setMatchingAnswerKey] = useState(false)

  // — reference upload state —
  const [refBoard, setRefBoard] = useState('')
  const [refGrade, setRefGrade] = useState('')
  const [refSubject, setRefSubject] = useState('')
  const [refUploadType, setRefUploadType] = useState('')
  const [refFile, setRefFile] = useState(null)
  const [refLoading, setRefLoading] = useState(false)
  const [refUploads, setRefUploads] = useState([])
  const [loadingRefUploads, setLoadingRefUploads] = useState(false)

  useEffect(() => { fetchPapers(); fetchRefUploads() }, [])

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
        if (!grouped[id]) grouped[id] = { source_paper_id: id, subject: row.subject, class_level: row.class_level, board: row.board, year: row.year, exam_type: row.exam_type, total: 0, pending: 0 }
        grouped[id].total++
        if (row.answer_pending) grouped[id].pending++
      }
      setPapers(Object.values(grouped))
    } catch (err) {
      showStatus(`Could not load extracted papers: ${err.message}`, 'error')
    } finally {
      setLoadingPapers(false)
    }
  }

  async function fetchRefUploads() {
    setLoadingRefUploads(true)
    try {
      const { data, error } = await supabase.from('reference_uploads').select('*').order('uploaded_at', { ascending: false })
      if (error) throw error
      setRefUploads(data)
    } catch (err) {
      showStatus(`Could not load reference uploads: ${err.message}`, 'error')
    } finally {
      setLoadingRefUploads(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!board || !grade || !subject) { showStatus('Please fill in all required fields.', 'error'); return }
    if (!examPaperFile) { showStatus('Please select a PDF to upload.', 'error'); return }
    setLoading(true)
    setExtractLog([])
    try {
      const examType = paperType === 'exam_paper' ? 'board_exam' : 'sample_paper'
      const folder = paperType === 'exam_paper' ? 'exam-papers' : 'sample-papers'
      const examFileName = `${folder}/${Date.now()}_${examPaperFile.name}`
      const { error: examUploadError } = await supabase.storage.from('pdf-uploads').upload(examFileName, examPaperFile)
      if (examUploadError) throw examUploadError
      const { data: examUrlData } = supabase.storage.from('pdf-uploads').getPublicUrl(examFileName)
      let answerKeyUrl = null
      if (answerKeyFile) {
        const answerFileName = `answer-keys/${Date.now()}_${answerKeyFile.name}`
        const { error: answerUploadError } = await supabase.storage.from('pdf-uploads').upload(answerFileName, answerKeyFile)
        if (answerUploadError) throw answerUploadError
        const { data: answerUrlData } = supabase.storage.from('pdf-uploads').getPublicUrl(answerFileName)
        answerKeyUrl = answerUrlData.publicUrl
      }
      const { error: dbError } = await supabase.from('pdf_uploads').insert({ board, grade, subject, year: year || null, exam_type: examType, exam_paper_pdf: examUrlData.publicUrl, answer_key_pdf: answerKeyUrl })
      if (dbError) throw dbError
      showStatus('PDF uploaded successfully!', 'success')
      if (extractQuestions) {
        setExtractLog(['Extracting questions from paper...'])
        const formData = new FormData()
        formData.append('file', examPaperFile)
        formData.append('subject', subject)
        formData.append('class_level', grade.replace(/[a-z]+$/i, ''))
        formData.append('board', board)
        formData.append('year', year || '')
        formData.append('exam_type', examType)
        const res = await fetch(`${API_BASE}/api/extract-paper`, { method: 'POST', body: formData })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        setExtractLog(['Done.', `Questions extracted: ${result.questions_extracted}`, `Saved: ${result.questions_saved}`, `Duplicates skipped: ${result.duplicates_skipped}`])
        fetchPapers()
      }
      setExamPaperFile(null)
      setAnswerKeyFile(null)
      setYear('')
    } catch (err) {
      showStatus(`Failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefUpload(e) {
    e.preventDefault()
    if (!refFile) { showStatus('Please select a PDF.', 'error'); return }
    if (!refSubject || !refGrade || !refBoard || !refUploadType) { showStatus('Please fill all required fields.', 'error'); return }
    setRefLoading(true)
    try {
      const fileName = `reference-uploads/${Date.now()}_${refFile.name}`
      const { error: storageError } = await supabase.storage.from('pdf-uploads').upload(fileName, refFile)
      if (storageError) throw storageError
      const formData = new FormData()
      formData.append('file_name', refFile.name)
      formData.append('subject', refSubject)
      formData.append('class_level', refGrade.replace(/[a-z]+$/i, ''))
      formData.append('board', refBoard)
      formData.append('upload_type', refUploadType)
      const res = await fetch(`${API_BASE}/api/upload-reference`, { method: 'POST', body: formData })
      const result = await res.json()
      if (!result.success) throw new Error(result.detail || 'Upload failed')
      showStatus('Reference uploaded successfully.', 'success')
      setRefFile(null)
      fetchRefUploads()
    } catch (err) {
      showStatus(`Upload failed: ${err.message}`, 'error')
    } finally {
      setRefLoading(false)
    }
  }

  async function handleMatchAnswerKey(paperId) {
    if (!answerKeyForPaper) { showStatus('Please select an answer key PDF.', 'error'); return }
    setMatchingAnswerKey(true)
    const formData = new FormData()
    formData.append('file', answerKeyForPaper)
    formData.append('source_paper_id', paperId)
    try {
      const res = await fetch(`${API_BASE}/api/match-answer-key`, { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      showStatus(`Matched ${result.answers_matched} answers. ${result.answers_failed} failed.`, 'success')
      setAnswerKeyForPaper(null)
      fetchPapers()
      viewQuestions(paperId)
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
      const { data, error } = await supabase.from('exam_questions').select('*').eq('source_paper_id', paperId).order('created_at', { ascending: true })
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
        <button onClick={() => { setSelectedPaper(null); setPaperQuestions([]) }} style={{ marginBottom: '16px', background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}>
          Back
        </button>
        <h2>{selectedPaper.subject} — {selectedPaper.board} Class {selectedPaper.class_level} {selectedPaper.year}</h2>
        <div className="form-panel" style={{ marginBottom: '20px' }}>
          <label><strong>Upload Answer Key for this paper</strong></label>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
            <label className={`file-input-label ${answerKeyForPaper ? 'has-file' : ''}`} style={{ flex: 1 }}>
              {answerKeyForPaper ? answerKeyForPaper.name : 'Click to select answer key PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setAnswerKeyForPaper(e.target.files[0] || null)} />
            </label>
            <button onClick={() => handleMatchAnswerKey(selectedPaper.source_paper_id)} disabled={matchingAnswerKey || !answerKeyForPaper} style={{ whiteSpace: 'nowrap' }}>
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
                    {Object.entries(q.options_json).map(([k, v]) => <div key={k}><strong>{k}.</strong> {v}</div>)}
                  </div>
                )}
                {q.correct_answer && <p style={{ color: '#4a6e6a', fontSize: '14px' }}><strong>Answer:</strong> {q.correct_answer}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-content">
      <h2>Exam Paper Uploads</h2>

      {/* ── Section 1: Upload exam / sample paper ── */}
      <div className="form-panel">
        {sectionTitle('Upload Exam / Sample Paper')}
        <div className="form-group">
          <label>Paper Type</label>
          <div style={{ display: 'flex', gap: '16px' }}>
            {['exam_paper', 'sample_paper'].map(val => (
              <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: paperType === val ? '600' : '400', color: paperType === val ? '#4a6e6a' : '#6b8a80' }}>
                <input type="radio" name="paperType" value={val} checked={paperType === val} onChange={() => setPaperType(val)} />
                {val === 'exam_paper' ? 'Exam Paper' : 'Sample Paper'}
              </label>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Board *</label>
              <select value={board} onChange={e => setBoard(e.target.value)} required>
                <option value="">Select board</option>
                {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Grade *</label>
              <select value={grade} onChange={e => setGrade(e.target.value)} required>
                <option value="">Select grade</option>
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
            <label>{paperType === 'exam_paper' ? 'Exam Paper PDF *' : 'Sample Paper PDF *'}</label>
            <label className={`file-input-label ${examPaperFile ? 'has-file' : ''}`}>
              {examPaperFile ? examPaperFile.name : 'Click to select PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setExamPaperFile(e.target.files[0] || null)} />
            </label>
          </div>
          <div className="form-group">
            <label>Answer Key PDF (optional)</label>
            <label className={`file-input-label ${answerKeyFile ? 'has-file' : ''}`}>
              {answerKeyFile ? answerKeyFile.name : 'Click to select PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setAnswerKeyFile(e.target.files[0] || null)} />
            </label>
          </div>

          {/* Checkbox — standalone row, not wrapped in form-group label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '12px 0 16px 0', padding: '10px 14px', background: '#f0f4f3', borderRadius: '8px', cursor: 'pointer' }} onClick={() => setExtractQuestions(v => !v)}>
            <input type="checkbox" checked={extractQuestions} onChange={e => { e.stopPropagation(); setExtractQuestions(e.target.checked) }} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#4a6e6a' }} />
            <span style={{ fontSize: '14px', color: '#2d4a47', fontWeight: '500' }}>Also extract questions from this paper into the question bank</span>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? (extractQuestions ? 'Uploading & Extracting...' : 'Uploading...') : 'Upload'}
          </button>
        </form>

        {extractLog.length > 0 && (
          <div style={{ marginTop: '16px', background: '#e8f4ea', borderRadius: '8px', padding: '12px', fontSize: '13px', fontFamily: 'monospace', color: '#2d4a47' }}>
            {extractLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      {divider}

      {/* ── Section 2: Extracted papers table ── */}
      <div className="form-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          {sectionTitle('Extracted Papers')}
          <button onClick={fetchPapers} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginTop: '-16px' }}>Refresh</button>
        </div>
        {loadingPapers ? <p>Loading...</p> : papers.length === 0 ? (
          <p style={{ color: '#6b8a80' }}>No questions extracted yet. Upload a paper with the checkbox ticked.</p>
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
                    {p.pending === 0 ? <span style={{ color: '#2e7d5a' }}>All matched</span> : <span style={{ color: '#856404' }}>{p.pending} pending</span>}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button onClick={() => viewQuestions(p.source_paper_id)} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {divider}

      {/* ── Section 3: Reference / guide book upload ── */}
      <div className="form-panel">
        {sectionTitle('Upload Reference Material')}
        <p style={{ color: '#6b8a80', fontSize: '14px', marginTop: '-8px', marginBottom: '16px' }}>Guide books and sample PDFs for reference only — never added to the question bank.</p>
        <form onSubmit={handleRefUpload}>
          <div className="form-row">
            <div className="form-group">
              <label>Board *</label>
              <select value={refBoard} onChange={e => setRefBoard(e.target.value)} required>
                <option value="">Select board</option>
                {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Grade *</label>
              <select value={refGrade} onChange={e => setRefGrade(e.target.value)} required>
                <option value="">Select grade</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Subject *</label>
              <select value={refSubject} onChange={e => setRefSubject(e.target.value)} required>
                <option value="">Select subject</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Upload Type *</label>
              <select value={refUploadType} onChange={e => setRefUploadType(e.target.value)} required>
                <option value="">Select type</option>
                {UPLOAD_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>PDF File *</label>
            <label className={`file-input-label ${refFile ? 'has-file' : ''}`}>
              {refFile ? refFile.name : 'Click to select PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setRefFile(e.target.files[0] || null)} />
            </label>
          </div>
          <button type="submit" disabled={refLoading}>{refLoading ? 'Uploading...' : 'Upload Reference'}</button>
        </form>

        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <strong style={{ fontSize: '14px' }}>Uploaded References</strong>
            <button onClick={fetchRefUploads} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Refresh</button>
          </div>
          {loadingRefUploads ? <p>Loading...</p> : refUploads.length === 0 ? (
            <p style={{ color: '#6b8a80', fontSize: '14px' }}>No references uploaded yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>File Name</th>
                  <th style={{ padding: '8px' }}>Subject</th>
                  <th style={{ padding: '8px' }}>Board</th>
                  <th style={{ padding: '8px' }}>Class</th>
                  <th style={{ padding: '8px' }}>Type</th>
                  <th style={{ padding: '8px' }}>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {refUploads.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #e0e8e6' }}>
                    <td style={{ padding: '8px' }}>{u.file_name}</td>
                    <td style={{ padding: '8px' }}>{u.subject}</td>
                    <td style={{ padding: '8px' }}>{u.board}</td>
                    <td style={{ padding: '8px' }}>{u.class_level}</td>
                    <td style={{ padding: '8px' }}>{(u.upload_type || '').replace(/_/g, ' ')}</td>
                    <td style={{ padding: '8px' }}>{new Date(u.uploaded_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
