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

function detectYearFromName(name) {
  const m = name.match(/20(\d{2})/)
  return m ? `20${m[1]}` : ''
}

function detectTypeFromName(name) {
  const lower = name.toLowerCase()
  if (/sample|mock|practice|test/.test(lower)) return 'sample_paper'
  return 'board_exam'
}

function parsePaperFolder(fileList) {
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'))
  const entries = []
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/')
    // Support: SubjectFolder/paper.pdf  OR  GradeFolder/SubjectFolder/paper.pdf
    const subject = parts.length >= 3 ? parts[parts.length - 2] : parts[0]
    entries.push({
      file,
      subject,
      year: detectYearFromName(file.name),
      paperType: detectTypeFromName(file.name),
      edited: false,
    })
  }
  // Sort: subject asc, then filename asc
  entries.sort((a, b) => a.subject.localeCompare(b.subject) || a.file.name.localeCompare(b.file.name))
  return entries
}

export default function ExamPaperUploads({ showStatus }) {
  // — single paper upload state —
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

  // — bulk QP upload state —
  const [bulkBoard, setBulkBoard] = useState('')
  const [bulkGrade, setBulkGrade] = useState('')
  const [bulkPapers, setBulkPapers] = useState([])       // parsed entries
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)  // { idx, total, subject, file }
  const [bulkResults, setBulkResults] = useState([])      // [{subject, file, saved, skipped, error}]

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

  function handleBulkFolderChange(e) {
    const files = e.target.files
    if (!files || files.length === 0) { setBulkPapers([]); return }
    setBulkPapers(parsePaperFolder(files))
    setBulkResults([])
    setBulkProgress(null)
  }

  function updateBulkRow(idx, field, value) {
    setBulkPapers(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value, edited: true } : r))
  }

  async function handleBulkProcess() {
    if (!bulkBoard || !bulkGrade) { showStatus('Select board and grade first.', 'error'); return }
    if (bulkPapers.length === 0) { showStatus('No papers found in folder.', 'error'); return }
    setBulkProcessing(true)
    setBulkResults([])
    const classLevel = bulkGrade.replace(/[a-z]+$/i, '')
    const results = []
    let totalSaved = 0

    for (let i = 0; i < bulkPapers.length; i++) {
      const entry = bulkPapers[i]
      setBulkProgress({ idx: i + 1, total: bulkPapers.length, subject: entry.subject, file: entry.file.name })
      const row = { subject: entry.subject, file: entry.file.name, saved: 0, skipped: 0, extracted: 0, error: null }
      try {
        const formData = new FormData()
        formData.append('file', entry.file)
        formData.append('subject', entry.subject)
        formData.append('class_level', classLevel)
        formData.append('board', bulkBoard)
        formData.append('year', entry.year || '')
        formData.append('exam_type', entry.paperType)
        const res = await fetch(`${API_BASE}/api/extract-paper`, { method: 'POST', body: formData })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        row.extracted = result.questions_extracted || 0
        row.saved = result.questions_saved || 0
        row.skipped = result.duplicates_skipped || 0
        totalSaved += row.saved
      } catch (err) {
        row.error = err.message
        await fetch(`${API_BASE}/api/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: 'bulk-qp-upload', stage: 'extract_paper', message: `Failed: ${entry.file.name} (${entry.subject}): ${err.message}`, context: { subject: entry.subject, file: entry.file.name, board: bulkBoard, grade: bulkGrade } })
        }).catch(() => {})
      }
      results.push(row)
      setBulkResults([...results])
    }

    setBulkProcessing(false)
    setBulkProgress(null)
    fetchPapers()
    showStatus(`Bulk QP processing complete. ${totalSaved} questions saved across ${bulkPapers.length} papers.`, 'success')
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
            {paperQuestions.map((q, i) => {
              const isCbq = q.question_type === 'cbq'
              const subQs = isCbq && q.options_json?.sub_questions
              return (
                <div key={q.id} className="form-panel" style={{ marginBottom: '12px', borderLeft: isCbq ? '3px solid #4a6e6a' : undefined }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ background: isCbq ? '#d4e8e4' : '#e8f0ee', color: isCbq ? '#2d4a47' : undefined, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: isCbq ? '600' : undefined }}>{(q.question_type || '').toUpperCase()}</span>
                    {q.difficulty_level && <span style={{ background: '#e8f0ee', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{q.difficulty_level}</span>}
                    {q.marks && <span style={{ background: '#e8f0ee', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{q.marks} marks</span>}
                    {q.chapter && <span style={{ background: '#f0f4f3', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', color: '#4a6e6a' }}>{q.chapter}</span>}
                    {q.answer_pending && <span style={{ background: '#fff3cd', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', color: '#856404' }}>Answer Pending</span>}
                  </div>

                  {isCbq ? (
                    <>
                      <div style={{ background: '#f7faf9', border: '1px solid #d4e8e4', borderRadius: '6px', padding: '10px 14px', marginBottom: '10px', fontSize: '14px', color: '#333', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: '#6b8a80', display: 'block', marginBottom: '4px' }}>PASSAGE</span>
                        {q.question_text}
                      </div>
                      {subQs && subQs.length > 0 && (
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: '600', color: '#6b8a80', display: 'block', marginBottom: '6px' }}>SUB-QUESTIONS</span>
                          {subQs.map((sq, si) => (
                            <div key={si} style={{ display: 'flex', gap: '10px', padding: '6px 0', borderTop: si > 0 ? '1px solid #e0e8e6' : undefined, fontSize: '14px' }}>
                              <span style={{ color: '#4a6e6a', fontWeight: '600', minWidth: '24px' }}>({sq.number})</span>
                              <span style={{ flex: 1 }}>{sq.text}</span>
                              {sq.marks && <span style={{ color: '#6b8a80', fontSize: '12px', whiteSpace: 'nowrap' }}>[{sq.marks}m]</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p style={{ fontWeight: '500', marginBottom: '6px' }}>Q{i + 1}. {q.question_text}</p>
                      {q.options_json && typeof q.options_json === 'object' && (
                        <div style={{ fontSize: '14px', color: '#555', marginTop: '4px', marginBottom: '6px' }}>
                          {Object.entries(q.options_json).map(([k, v]) => <div key={k}><strong>{k}.</strong> {v}</div>)}
                        </div>
                      )}
                    </>
                  )}

                  {q.correct_answer && <p style={{ color: '#4a6e6a', fontSize: '14px', marginTop: '6px' }}><strong>Answer:</strong> {q.correct_answer}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-content">
      <h2>Exam Paper Uploads</h2>

      {/* ── Section 1: Bulk QP Folder Upload ── */}
      <div className="form-panel">
        {sectionTitle('Bulk Question Paper Upload (Folder)')}
        <p style={{ color: '#6b8a80', fontSize: '14px', marginTop: '-8px', marginBottom: '16px' }}>
          Select a folder containing subject subfolders, each with QP PDFs inside.<br />
          Year and paper type are auto-detected from filenames — edit any row if wrong.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label>Board *</label>
            <select value={bulkBoard} onChange={e => setBulkBoard(e.target.value)}>
              <option value="">Select board</option>
              {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Grade *</label>
            <select value={bulkGrade} onChange={e => setBulkGrade(e.target.value)}>
              <option value="">Select grade</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Select Folder *</label>
          <label className={`file-input-label ${bulkPapers.length > 0 ? 'has-file' : ''}`}>
            {bulkPapers.length > 0 ? `${bulkPapers.length} PDFs found` : 'Click to select folder'}
            <input
              type="file"
              style={{ display: 'none' }}
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleBulkFolderChange}
            />
          </label>
        </div>

        {bulkPapers.length > 0 && (
          <div style={{ marginTop: '16px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>File</th>
                  <th style={{ padding: '6px 8px' }}>Subject</th>
                  <th style={{ padding: '6px 8px' }}>Year</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {bulkPapers.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                    <td style={{ padding: '6px 8px', color: '#4a6e6a', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.file.name}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <input
                        value={row.subject}
                        onChange={e => updateBulkRow(i, 'subject', e.target.value)}
                        style={{ width: '120px', padding: '3px 6px', border: '1px solid #c5d5d2', borderRadius: '4px', fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <input
                        value={row.year}
                        onChange={e => updateBulkRow(i, 'year', e.target.value)}
                        placeholder="e.g. 2024"
                        style={{ width: '72px', padding: '3px 6px', border: '1px solid #c5d5d2', borderRadius: '4px', fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <select
                        value={row.paperType}
                        onChange={e => updateBulkRow(i, 'paperType', e.target.value)}
                        style={{ padding: '3px 6px', border: '1px solid #c5d5d2', borderRadius: '4px', fontSize: '13px' }}
                      >
                        <option value="board_exam">Board Exam</option>
                        <option value="sample_paper">Sample Paper</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bulkProgress && (
          <div style={{ marginTop: '16px', background: '#f0f4f3', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ fontSize: '13px', color: '#2d4a47', marginBottom: '6px' }}>
              Processing {bulkProgress.idx}/{bulkProgress.total}: <strong>{bulkProgress.subject}</strong> — {bulkProgress.file}
            </div>
            <div style={{ background: '#c5d5d2', borderRadius: '4px', height: '6px' }}>
              <div style={{ background: '#4a6e6a', height: '6px', borderRadius: '4px', width: `${(bulkProgress.idx / bulkProgress.total) * 100}%`, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {bulkPapers.length > 0 && (
          <button
            onClick={handleBulkProcess}
            disabled={bulkProcessing || !bulkBoard || !bulkGrade}
            style={{ marginTop: '16px' }}
          >
            {bulkProcessing ? 'Processing...' : `Extract Questions from All ${bulkPapers.length} Papers`}
          </button>
        )}

        {bulkResults.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <strong style={{ fontSize: '14px' }}>Results</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '8px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Subject</th>
                  <th style={{ padding: '6px 8px' }}>File</th>
                  <th style={{ padding: '6px 8px' }}>Extracted</th>
                  <th style={{ padding: '6px 8px' }}>Saved</th>
                  <th style={{ padding: '6px 8px' }}>Duplicates</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {bulkResults.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                    <td style={{ padding: '6px 8px' }}>{r.subject}</td>
                    <td style={{ padding: '6px 8px', color: '#4a6e6a', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file}</td>
                    <td style={{ padding: '6px 8px' }}>{r.error ? '—' : r.extracted}</td>
                    <td style={{ padding: '6px 8px' }}>{r.error ? '—' : r.saved}</td>
                    <td style={{ padding: '6px 8px' }}>{r.error ? '—' : r.skipped}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {r.error
                        ? <span style={{ color: '#c0392b', fontSize: '12px' }}>{r.error}</span>
                        : <span style={{ color: '#2e7d5a', fontSize: '12px' }}>Done</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {divider}

      {/* ── Section 2: Single exam / sample paper upload ── */}
      <div className="form-panel">
        {sectionTitle('Upload Single Exam / Sample Paper')}
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

      {/* ── Section 3: Extracted papers table ── */}
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

      {/* ── Section 4: Reference / guide book upload ── */}
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
