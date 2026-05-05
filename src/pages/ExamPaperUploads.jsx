import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''
const BOARDS = ['Stateboard', 'CBSE', 'ICSE']
const GRADES = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']
const SUBJECTS = ['Accountancy', 'Biology', 'Business Studies', 'Chemistry', 'Economics', 'English', 'Geography', 'History', 'Mathematics', 'Physics', 'Political Science', 'Science', 'Social Science']
const UPLOAD_TYPES = ['guide_reference', 'sample_question', 'other']

const sectionTitle = (text) => (
  <h3 style={{ margin: '0 0 16px 0', color: '#2d4a47', fontSize: '16px', borderBottom: '2px solid #e0e8e6', paddingBottom: '8px' }}>{text}</h3>
)

const divider = <hr style={{ border: 'none', borderTop: '2px solid #e0e8e6', margin: '32px 0' }} />

function detectYearFromName(name) {
  const m = name.match(/20(\d{2})/)
  return m ? `20${m[1]}` : ''
}

const SET_RE = /(\d+)[-_\/](\d+)[-_\/](\d+)/g

function detectSetNumberFromStart(name) {
  const base = name.replace(/\.[^.]+$/, '')
  const m = base.match(/^[^0-9]*(\d+)[-_\/](\d+)[-_\/](\d+)/)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : ''
}

function detectSetNumberFromEnd(name) {
  const base = name.replace(/\.[^.]+$/, '')
  const all = [...base.matchAll(SET_RE)]
  if (all.length === 0) return ''
  const last = all[all.length - 1]
  return `${last[1]}/${last[2]}/${last[3]}`
}

function detectSetNumber(name) {
  return detectSetNumberFromStart(name) || detectSetNumberFromEnd(name)
}

function buildPaperLabel(year, subjectCode, setNumber) {
  const parts = [year, subjectCode].filter(Boolean)
  if (setNumber) parts.push(setNumber)
  return parts.join(' ')
}

const SUBJECT_PREFIX_MAP = {
  acc: 'Accountancy', bio: 'Biology', bus: 'Business Studies',
  che: 'Chemistry', eco: 'Economics', eng: 'English',
  geo: 'Geography', his: 'History', mat: 'Mathematics',
  phy: 'Physics', pol: 'Political Science', sci: 'Science',
}

function detectSubjectFromFolderName(name) {
  const prefix = name.trim().slice(0, 3).toLowerCase()
  return SUBJECT_PREFIX_MAP[prefix] || ''
}

function detectTypeFromName(name) {
  const lower = name.toLowerCase()
  if (/sample|mock|practice|test/.test(lower)) return 'sample_paper'
  return 'board_exam'
}

function extractSetNumberFromLabel(label) {
  const m = (label || '').match(/(\d+\/\d+\/\d+)/)
  return m ? m[1] : ''
}

function extractSubjectFromLabel(label) {
  for (const s of SUBJECTS) {
    if ((label || '').includes(s)) return s
  }
  return (label || '').replace(/^\d{4}\s+/, '').replace(/\s+\d+[\\/\-]\d+[\\/\-]\d+$/, '').trim() || label
}


function matchAnswerKeys(qpEntries, akFiles) {
  // build map: setNumber -> akFile (set number read from END of AK filename)
  const akBySet = {}
  akFiles.forEach(f => {
    const set = detectSetNumberFromEnd(f.name)
    if (set) akBySet[set] = f
  })
  return qpEntries.map(qp => {
    const set = qp.setNumber || detectSetNumberFromStart(qp.file.name)
    return set && akBySet[set] ? akBySet[set] : null
  })
}

function parsePaperFolder(fileList) {
  const files = Array.from(fileList).filter(f => /\.(pdf|txt)$/i.test(f.name))
  const entries = []
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/')
    // Support: SubjectFolder/paper.pdf  OR  GradeFolder/SubjectFolder/paper.pdf
    const subject = parts.length >= 3 ? parts[parts.length - 2] : parts[0]
    entries.push({
      file,
      subject,
      year: detectYearFromName(file.name),
      setNumber: detectSetNumber(file.name),
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
  const [akSetNumber, setAkSetNumber] = useState('')

  // — section-level answer key matching state —
  const [checkedPaperIds, setCheckedPaperIds] = useState(new Set())
  const [sectionAKFile, setSectionAKFile] = useState(null)
  const [sectionAKMatching, setSectionAKMatching] = useState(false)
  const [sectionAKResults, setSectionAKResults] = useState([])

  // — reference upload state —
  const [refBoard, setRefBoard] = useState('')
  const [refGrade, setRefGrade] = useState('')
  const [refSubject, setRefSubject] = useState('')
  const [refUploadType, setRefUploadType] = useState('')
  const [refFile, setRefFile] = useState(null)
  const [refLoading, setRefLoading] = useState(false)
  const [refUploads, setRefUploads] = useState([])
  const [loadingRefUploads, setLoadingRefUploads] = useState(false)

  // — chapter tagging state —
  const [tagBoard, setTagBoard] = useState('')
  const [tagGrade, setTagGrade] = useState('')
  const [tagSubject, setTagSubject] = useState('')
  const [tagLoading, setTagLoading] = useState(false)
  const [tagResult, setTagResult] = useState(null)

  // — bulk QP upload state —
  const [bulkBoard, setBulkBoard] = useState('')
  const [bulkGrade, setBulkGrade] = useState('')
  const [bulkSubject, setBulkSubject] = useState('')
  const [bulkYear, setBulkYear] = useState('')
  const [bulkPapers, setBulkPapers] = useState([])       // parsed entries
  const [bulkAnswerFiles, setBulkAnswerFiles] = useState([])  // answer key File objects
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)  // { idx, total, subject, file }
  const [bulkResults, setBulkResults] = useState([])      // [{subject, file, saved, skipped, error}]

  useEffect(() => { fetchPapers(); fetchRefUploads() }, [])

  useEffect(() => {
    if (!selectedPaper) return
    setAkSetNumber(extractSetNumberFromLabel(selectedPaper.subject))
  }, [selectedPaper?.source_paper_id])

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
        formData.append('paper_pdf_url', examUrlData.publicUrl)
        const res = await fetch(`${API_BASE}/api/extract-paper`, { method: 'POST', body: formData })
        const result = await res.json()
        if (result.error || result.detail) throw new Error(result.error || result.detail)
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

  async function handleMatchAnswerKey() {
    if (!answerKeyForPaper) { showStatus('Please select an answer key PDF.', 'error'); return }
    setMatchingAnswerKey(true)
    try {
      const formData = new FormData()
      formData.append('file', answerKeyForPaper)
      formData.append('source_paper_id', selectedPaper.source_paper_id)
      if (akSetNumber) formData.append('set_number', akSetNumber)
      const res = await fetch(`${API_BASE}/api/match-answer-key`, { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      let msg = `Matched ${result.answers_matched} answers`
      if (result.mismatched_rejected > 0) msg += `, ${result.mismatched_rejected} rejected (Q&A mismatch)`
      if (result.answers_failed > 0) msg += `, ${result.answers_failed} unmatched`
      showStatus(msg, 'success')
      setAnswerKeyForPaper(null)
      fetchPapers()
      viewQuestions(selectedPaper.source_paper_id)
    } catch (err) {
      showStatus(`Matching failed: ${err.message}`, 'error')
    } finally {
      setMatchingAnswerKey(false)
    }
  }

  async function handleSectionMatchAK() {
    if (!sectionAKFile) { showStatus('Please select an answer key file.', 'error'); return }
    if (checkedPaperIds.size === 0) { showStatus('Select at least one paper.', 'error'); return }
    setSectionAKMatching(true)
    setSectionAKResults([])
    const selected = papers.filter(p => checkedPaperIds.has(p.source_paper_id))
    const results = []
    let totalMatched = 0, totalRejected = 0
    for (const paper of selected) {
      const setNumber = extractSetNumberFromLabel(paper.subject)
      const row = { subject: paper.subject, matched: 0, rejected: 0, error: null }
      try {
        const formData = new FormData()
        formData.append('file', sectionAKFile)
        formData.append('source_paper_id', paper.source_paper_id)
        if (setNumber) formData.append('set_number', setNumber)
        const res = await fetch(`${API_BASE}/api/match-answer-key`, { method: 'POST', body: formData })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        row.matched = result.answers_matched || 0
        row.rejected = result.mismatched_rejected || 0
        totalMatched += row.matched
        totalRejected += row.rejected
      } catch (err) {
        row.error = err.message
      }
      results.push(row)
      setSectionAKResults([...results])
    }
    setSectionAKMatching(false)
    fetchPapers()
    const rejMsg = totalRejected > 0 ? `, ${totalRejected} rejected` : ''
    showStatus(`Matched ${totalMatched} answers across ${selected.length} papers${rejMsg}.`, 'success')
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
    const folderName = files[0].webkitRelativePath.split('/')[0]
    const detectedYear = detectYearFromName(folderName)
    const detectedSubject = detectSubjectFromFolderName(folderName)
    const yearToUse = detectedYear || bulkYear
    const subjectToUse = bulkSubject || detectedSubject
    if (detectedYear) setBulkYear(detectedYear)
    if (!bulkSubject && detectedSubject) setBulkSubject(detectedSubject)
    const base = parsePaperFolder(files).map(row => ({
      ...row,
      subject: subjectToUse || row.subject,
      year: yearToUse || row.year,
      setNumber: row.setNumber || detectSetNumber(row.file.name),
      answerKeyFile: null,
    }))
    const matched = bulkAnswerFiles.length > 0 ? matchAnswerKeys(base, bulkAnswerFiles) : []
    const parsed = base.map((r, i) => ({ ...r, answerKeyFile: matched[i] || null }))
    setBulkPapers(parsed)
    setBulkResults([])
    setBulkProgress(null)
  }

  function updateBulkRow(idx, field, value) {
    setBulkPapers(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value, edited: true } : r))
  }

  function removeBulkPaper(idx) {
    setBulkPapers(prev => prev.filter((_, i) => i !== idx))
  }

  function handleAnswerKeyFolderChange(e) {
    const files = Array.from(e.target.files).filter(f => /\.(pdf|txt)$/i.test(f.name))
    setBulkAnswerFiles(files)
    if (bulkPapers.length > 0 && files.length > 0) {
      const matched = matchAnswerKeys(bulkPapers, files)
      setBulkPapers(prev => prev.map((r, i) => ({ ...r, answerKeyFile: matched[i] || null })))
    }
  }

  async function handleBulkProcess() {
    if (!bulkBoard || !bulkGrade) { showStatus('Select board and grade first.', 'error'); return }
    if (!bulkSubject) { showStatus('Select a subject first.', 'error'); return }
    if (!bulkYear) { showStatus('Enter a year first.', 'error'); return }
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
        // Read file bytes once — reuse for both storage upload and extraction
        const fileBytes = await entry.file.arrayBuffer()
        const fileBlob = new Blob([fileBytes], { type: 'application/pdf' })

        // Upload PDF to storage
        const fileName = `exam-papers/${Date.now()}_${entry.file.name}`
        const { error: storageError } = await supabase.storage.from('pdf-uploads').upload(fileName, fileBlob)
        if (storageError) throw storageError
        const { data: urlData } = supabase.storage.from('pdf-uploads').getPublicUrl(fileName)

        // Save to pdf_uploads
        await supabase.from('pdf_uploads').insert({
          board: bulkBoard,
          grade: bulkGrade,
          subject: entry.subject,
          year: entry.year || null,
          exam_type: entry.paperType === 'sample_paper' ? 'sample_paper' : 'board_exam',
          exam_paper_pdf: urlData.publicUrl
        })

        const paperLabel = buildPaperLabel(entry.year, entry.subject, entry.setNumber)
        const formData = new FormData()
        formData.append('file', new File([fileBytes], entry.file.name, { type: 'application/pdf' }))
        formData.append('subject', paperLabel || entry.subject)
        formData.append('class_level', classLevel)
        formData.append('board', bulkBoard)
        formData.append('year', entry.year || '')
        formData.append('exam_type', entry.paperType)
        formData.append('paper_pdf_url', urlData.publicUrl)
        const res = await fetch(`${API_BASE}/api/extract-paper`, { method: 'POST', body: formData })
        const result = await res.json()
        if (result.error || result.detail) throw new Error(result.error || result.detail)
        row.extracted = result.questions_extracted || 0
        row.saved = result.questions_saved || 0
        row.skipped = result.duplicates_skipped || 0
        totalSaved += row.saved

        // Upload and match answer key if provided
        if (entry.answerKeyFile && result.source_paper_id) {
          const akBytes = await entry.answerKeyFile.arrayBuffer()
          const akFileName = `answer-keys/${Date.now()}_${entry.answerKeyFile.name}`
          const { error: akErr } = await supabase.storage.from('pdf-uploads').upload(akFileName, new Blob([akBytes], { type: 'application/pdf' }))
          if (!akErr) {
            const { data: akUrlData } = supabase.storage.from('pdf-uploads').getPublicUrl(akFileName)
            await supabase.from('pdf_uploads').update({ answer_key_pdf: akUrlData.publicUrl }).eq('exam_paper_pdf', urlData.publicUrl)
            const akForm = new FormData()
            akForm.append('file', new File([akBytes], entry.answerKeyFile.name, { type: 'application/pdf' }))
            akForm.append('source_paper_id', result.source_paper_id)
            const akRes = await fetch(`${API_BASE}/api/match-answer-key`, { method: 'POST', body: akForm })
            const akResult = await akRes.json()
            row.answersMatched = akResult.answers_matched || 0
          }
        }
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

  async function handleTagChapters() {
    if (!tagBoard || !tagGrade || !tagSubject) { showStatus('Select board, grade and subject first.', 'error'); return }
    setTagLoading(true)
    setTagResult(null)
    const exam = `${tagGrade} ${tagBoard} Board`
    const fd = new FormData()
    fd.append('subject', tagSubject)
    fd.append('class_level', tagGrade)
    fd.append('board', tagBoard)
    fd.append('exam', exam)
    try {
      const res = await fetch(`${API_BASE}/api/tag-exam-question-chapters`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { showStatus(data.detail || 'Tagging failed', 'error'); return }
      setTagResult(data)
      showStatus(data.message, data.tagged > 0 ? 'success' : 'error')
    } catch (err) {
      showStatus('Error: ' + err.message, 'error')
    } finally {
      setTagLoading(false)
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
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
            <label className={`file-input-label ${answerKeyForPaper ? 'has-file' : ''}`} style={{ flex: 1, minWidth: '180px' }}>
              {answerKeyForPaper ? answerKeyForPaper.name : 'Click to select answer key PDF / TXT'}
              <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={e => setAnswerKeyForPaper(e.target.files[0] || null)} />
            </label>
            {akSetNumber && (
              <span style={{ fontSize: '13px', color: '#6b8a80', whiteSpace: 'nowrap' }}>Set: {akSetNumber}</span>
            )}
            <button onClick={handleMatchAnswerKey} disabled={matchingAnswerKey || !answerKeyForPaper} style={{ whiteSpace: 'nowrap' }}>
              {matchingAnswerKey ? 'Matching...' : 'Match Answers'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#6b8a80', marginTop: '6px' }}>
            To match one answer key across multiple papers, go back and use the multi-select in the Extracted Papers table.
          </p>
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

        <div className="form-row">
          <div className="form-group">
            <label>Subject * <span style={{ fontWeight: 400, color: '#6b8a80', fontSize: '12px' }}>(applies to all papers)</span></label>
            <select value={bulkSubject} onChange={e => {
              setBulkSubject(e.target.value)
              if (bulkPapers.length > 0) setBulkPapers(prev => prev.map(r => ({ ...r, subject: e.target.value })))
            }}>
              <option value="">Select subject</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Year * <span style={{ fontWeight: 400, color: '#6b8a80', fontSize: '12px' }}>(applies to all papers)</span></label>
            <input
              type="text"
              value={bulkYear}
              onChange={e => {
                setBulkYear(e.target.value)
                if (bulkPapers.length > 0) setBulkPapers(prev => prev.map(r => ({ ...r, year: e.target.value })))
              }}
              placeholder="e.g. 2025"
              style={{ padding: '8px 12px', border: '1px solid #c5d5d2', borderRadius: '8px', fontSize: '14px', width: '100%' }}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Question Papers Folder *</label>
            <label className={`file-input-label ${bulkPapers.length > 0 ? 'has-file' : ''}`}>
              {bulkPapers.length > 0 ? `${bulkPapers.length} QPs found` : 'Click to select folder'}
              <input type="file" style={{ display: 'none' }} webkitdirectory="" directory="" multiple onChange={handleBulkFolderChange} />
            </label>
          </div>
          <div className="form-group">
            <label>Answer Keys Folder <span style={{ fontWeight: 400, color: '#6b8a80', fontSize: '12px' }}>(optional)</span></label>
            <label className={`file-input-label ${bulkAnswerFiles.length > 0 ? 'has-file' : ''}`}>
              {bulkAnswerFiles.length > 0 ? `${bulkAnswerFiles.length} answer keys found` : 'Click to select folder'}
              <input type="file" style={{ display: 'none' }} webkitdirectory="" directory="" multiple onChange={handleAnswerKeyFolderChange} />
            </label>
          </div>
        </div>

        {bulkPapers.length > 0 && (
          <div style={{ marginTop: '16px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>File</th>
                  <th style={{ padding: '6px 8px' }}>Paper Label</th>
                  <th style={{ padding: '6px 8px' }}>Subject</th>
                  <th style={{ padding: '6px 8px' }}>Year</th>
                  <th style={{ padding: '6px 8px' }}>Set No</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Answer Key</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {bulkPapers.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                    <td style={{ padding: '6px 8px', color: '#4a6e6a', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.file.name}</td>
                    <td style={{ padding: '6px 8px', fontWeight: '600', color: '#2d4a47', whiteSpace: 'nowrap' }}>
                      {buildPaperLabel(row.year, row.subject?.slice(0, 3), row.setNumber)}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <select
                        value={row.subject}
                        onChange={e => updateBulkRow(i, 'subject', e.target.value)}
                        style={{ padding: '3px 6px', border: '1px solid #c5d5d2', borderRadius: '4px', fontSize: '13px' }}
                      >
                        <option value="">— subject —</option>
                        {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
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
                      <input
                        value={row.setNumber}
                        onChange={e => updateBulkRow(i, 'setNumber', e.target.value)}
                        placeholder="e.g. 65/1/1"
                        style={{ width: '80px', padding: '3px 6px', border: '1px solid #c5d5d2', borderRadius: '4px', fontSize: '13px' }}
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
                    <td style={{ padding: '6px 8px', fontSize: '12px', color: row.answerKeyFile ? '#2e7d5a' : '#aaa' }}>
                      {row.answerKeyFile ? row.answerKeyFile.name : '—'}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      <button
                        onClick={() => removeBulkPaper(i)}
                        disabled={bulkProcessing}
                        title="Remove from queue"
                        style={{ background: 'none', border: 'none', color: '#bbb', cursor: bulkProcessing ? 'not-allowed' : 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px' }}
                      >×</button>
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
                  <th style={{ padding: '6px 8px' }}>Answers Matched</th>
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
                    <td style={{ padding: '6px 8px' }}>{r.error ? '—' : (r.answersMatched ?? '—')}</td>
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
              {examPaperFile ? examPaperFile.name : 'Click to select PDF or TXT'}
              <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={e => setExamPaperFile(e.target.files[0] || null)} />
            </label>
          </div>
          <div className="form-group">
            <label>Answer Key PDF/TXT (optional)</label>
            <label className={`file-input-label ${answerKeyFile ? 'has-file' : ''}`}>
              {answerKeyFile ? answerKeyFile.name : 'Click to select PDF or TXT'}
              <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={e => setAnswerKeyFile(e.target.files[0] || null)} />
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

      {/* ── Section 3: Extracted papers (grouped by subject) ── */}
      <div className="form-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          {sectionTitle('Extracted Papers')}
          <button onClick={fetchPapers} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginTop: '-16px' }}>Refresh</button>
        </div>

        {/* Answer key + match bar — shown when papers exist */}
        {papers.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px', padding: '10px 14px', background: '#f0f4f3', borderRadius: '8px', flexWrap: 'wrap' }}>
            <label className={`file-input-label ${sectionAKFile ? 'has-file' : ''}`} style={{ flex: 1, minWidth: '180px', margin: 0 }}>
              {sectionAKFile ? sectionAKFile.name : 'Select answer key for checked papers'}
              <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={e => setSectionAKFile(e.target.files[0] || null)} />
            </label>
            <button
              onClick={handleSectionMatchAK}
              disabled={sectionAKMatching || !sectionAKFile || checkedPaperIds.size === 0}
              style={{ whiteSpace: 'nowrap' }}
            >
              {sectionAKMatching ? 'Matching...' : checkedPaperIds.size > 0 ? `Match Answers (${checkedPaperIds.size} paper${checkedPaperIds.size > 1 ? 's' : ''})` : 'Match Answers'}
            </button>
          </div>
        )}

        {loadingPapers ? <p>Loading...</p> : papers.length === 0 ? (
          <p style={{ color: '#6b8a80' }}>No questions extracted yet. Upload a paper with the checkbox ticked.</p>
        ) : (() => {
          // Group by real subject name, sort within each group by set number
          const groups = {}
          for (const p of papers) {
            const subj = extractSubjectFromLabel(p.subject)
            if (!groups[subj]) groups[subj] = []
            groups[subj].push(p)
          }
          for (const subj of Object.keys(groups)) {
            groups[subj].sort((a, b) =>
              extractSetNumberFromLabel(a.subject).localeCompare(extractSetNumberFromLabel(b.subject), undefined, { numeric: true, sensitivity: 'base' })
            )
          }
          return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([subj, grp]) => {
            const allChecked = grp.every(p => checkedPaperIds.has(p.source_paper_id))
            const someChecked = grp.some(p => checkedPaperIds.has(p.source_paper_id))
            return (
              <div key={subj} style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '2px solid #e0e8e6', marginBottom: '2px' }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                    onChange={e => {
                      const next = new Set(checkedPaperIds)
                      grp.forEach(p => e.target.checked ? next.add(p.source_paper_id) : next.delete(p.source_paper_id))
                      setCheckedPaperIds(next)
                    }}
                    style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: '#4a6e6a' }}
                  />
                  <strong style={{ color: '#2d4a47', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{subj}</strong>
                  <span style={{ fontSize: '12px', color: '#6b8a80' }}>{grp.length} paper{grp.length > 1 ? 's' : ''}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <tbody>
                    {grp.map(p => (
                      <tr key={p.source_paper_id} style={{ borderBottom: '1px solid #f0f4f3' }}>
                        <td style={{ padding: '6px 8px', width: '28px' }}>
                          <input
                            type="checkbox"
                            checked={checkedPaperIds.has(p.source_paper_id)}
                            onChange={e => {
                              const next = new Set(checkedPaperIds)
                              e.target.checked ? next.add(p.source_paper_id) : next.delete(p.source_paper_id)
                              setCheckedPaperIds(next)
                            }}
                            style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#4a6e6a' }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', fontWeight: '600', color: '#2d4a47' }}>{p.subject}</td>
                        <td style={{ padding: '6px 8px', color: '#6b8a80', fontSize: '12px' }}>{p.board} · Class {p.class_level}</td>
                        <td style={{ padding: '6px 8px', color: '#6b8a80', fontSize: '12px' }}>{p.exam_type?.replace('_', ' ')}</td>
                        <td style={{ padding: '6px 8px', fontSize: '12px' }}>{p.total} Q</td>
                        <td style={{ padding: '6px 8px', fontSize: '12px' }}>
                          {p.pending === 0
                            ? <span style={{ color: '#2e7d5a' }}>All matched</span>
                            : <span style={{ color: '#856404' }}>{p.pending} pending</span>}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <button onClick={() => viewQuestions(p.source_paper_id)} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })
        })()}

        {/* Match results */}
        {sectionAKResults.length > 0 && (
          <div style={{ marginTop: '16px', borderTop: '1px solid #e0e8e6', paddingTop: '12px' }}>
            <strong style={{ fontSize: '13px' }}>Match Results</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '8px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e0e8e6', textAlign: 'left' }}>
                  <th style={{ padding: '5px 8px' }}>Paper</th>
                  <th style={{ padding: '5px 8px' }}>Matched</th>
                  <th style={{ padding: '5px 8px' }}>Rejected</th>
                  <th style={{ padding: '5px 8px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sectionAKResults.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f4f3' }}>
                    <td style={{ padding: '5px 8px' }}>{r.subject}</td>
                    <td style={{ padding: '5px 8px' }}>{r.error ? '—' : r.matched}</td>
                    <td style={{ padding: '5px 8px' }}>{r.error ? '—' : r.rejected}</td>
                    <td style={{ padding: '5px 8px' }}>
                      {r.error
                        ? <span style={{ color: '#c0392b', fontSize: '12px' }}>{r.error}</span>
                        : <span style={{ color: '#2e7d5a', fontSize: '12px' }}>Done</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {divider}

      {/* ── Section 4: Tag exam questions by chapter ── */}
      <div className="form-panel">
        {sectionTitle('Tag Questions by Chapter')}
        <p style={{ color: '#6b8a80', fontSize: '14px', marginTop: '-8px', marginBottom: '16px' }}>
          After extracting questions from papers, run this to classify every question into its chapter using the headings stored in your chapter library.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Board</label>
            <select value={tagBoard} onChange={e => setTagBoard(e.target.value)} className="form-select">
              <option value="">Select board</option>
              {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Grade</label>
            <select value={tagGrade} onChange={e => setTagGrade(e.target.value)} className="form-select">
              <option value="">Select grade</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Subject</label>
            <select value={tagSubject} onChange={e => setTagSubject(e.target.value)} className="form-select">
              <option value="">Select subject</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={handleTagChapters}
          disabled={tagLoading || !tagBoard || !tagGrade || !tagSubject}
          className="btn-primary"
          style={{ marginTop: '8px' }}
        >
          {tagLoading ? 'Tagging…' : 'Tag Chapters'}
        </button>
        {tagResult && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#f0f8f4', border: '1px solid #b8d8cc', borderRadius: '6px', fontSize: '13px' }}>
            <strong style={{ color: '#2e7d5a' }}>{tagResult.tagged}</strong> questions tagged &nbsp;·&nbsp;
            <strong style={{ color: tagResult.unmatched > 0 ? '#b85c00' : '#888' }}>{tagResult.unmatched}</strong> unmatched &nbsp;·&nbsp;
            {tagResult.total} total
          </div>
        )}
      </div>

      {divider}

      {/* ── Section 5: Reference / guide book upload ── */}
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
