import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''

const SMALL_WORDS = new Set(['a','an','the','and','but','or','nor','for','yet','so','at','by','in','of','on','to','up','as','is','via','with','from','into','onto','over','per','than','vs'])

function toTitleCase(text) {
  if (!text) return text
  return text.trim().split(' ').map((word, i) => {
    if (word.includes('-')) {
      return word.split('-').map((p, j) => (i === 0 && j === 0) || !SMALL_WORDS.has(p.toLowerCase()) ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()).join('-')
    }
    return (i === 0 || !SMALL_WORDS.has(word.toLowerCase())) ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()
  }).join(' ')
}

const GRADES = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']
const BOARDS = ['Stateboard', 'CBSE', 'ICSE']

const BATCHES = [
  { q_type: 'mcq',        num_q: 25, label: 'MCQs (1/2)' },
  { q_type: 'mcq',        num_q: 25, label: 'MCQs (2/2)' },
  { q_type: 'vsa',        num_q: 30, label: 'Very Short Answers' },
  { q_type: 'short',      num_q: 30, label: 'Short Answers' },
  { q_type: 'long',       num_q: 15, label: 'Long Answers' },
  { q_type: 'conceptual', num_q: 15, label: 'Conceptual' },
  { q_type: 'cbq',        num_q: 10, label: 'Case-Based Questions' },
]

const ANSWER_FILE_RE = /answers?[-_\s]*[12]/i

function parseFolderStructure(fileList) {
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'))
  const struct = {}
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/')
    const subject = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown'
    if (!struct[subject]) struct[subject] = { chapters: [], answers: [] }
    if (ANSWER_FILE_RE.test(file.name.replace(/\.pdf$/i, ''))) {
      struct[subject].answers.push(file)
    } else {
      struct[subject].chapters.push(file)
    }
  }
  for (const subject of Object.keys(struct)) {
    struct[subject].chapters.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
    struct[subject].answers.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
  }
  return struct
}

export default function BulkUpload({ showStatus }) {
  const [grade, setGrade] = useState('')
  const [board, setBoard] = useState('Stateboard')
  const [structure, setStructure] = useState({})
  const [chapters, setChapters] = useState([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState([])
  const [wakeLockActive, setWakeLockActive] = useState(false)

  // Split PDF tool state
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitFile, setSplitFile] = useState(null)
  const [splitPreviewing, setSplitPreviewing] = useState(false)
  const [splitDownloading, setSplitDownloading] = useState(false)
  const [splitPreview, setSplitPreview] = useState(null)
  const [splitError, setSplitError] = useState(null)
  const [splitTocImages, setSplitTocImages] = useState([])
  const [splitTocDragging, setSplitTocDragging] = useState(false)
  const [splitImageExtracting, setSplitImageExtracting] = useState(false)
  const [splitContentsPage, setSplitContentsPage] = useState(1)

  const [manualAnswerKeys, setManualAnswerKeys] = useState([])
  const [answerKeyDragging, setAnswerKeyDragging] = useState(false)

  const wakeLockRef = useRef(null)
  const processingRef = useRef(false)

  const exam = grade && board ? `${grade} ${board} Board` : ''

  useEffect(() => {
    async function onVisibilityChange() {
      if (document.visibilityState === 'visible' && processingRef.current && 'wakeLock' in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen')
          setWakeLockActive(true)
        } catch {
          // Wake lock support varies by browser.
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  function handleFolderChange(e) {
    const struct = parseFolderStructure(e.target.files)
    setStructure(struct)
    setChapters([])
    setResults([])
  }

  function removeFileFromStructure(subject, fileName) {
    setStructure(prev => {
      const subj = prev[subject]
      const updated = {
        ...prev,
        [subject]: {
          chapters: subj.chapters.filter(f => f.name !== fileName),
          answers: subj.answers.filter(f => f.name !== fileName),
        }
      }
      if (updated[subject].chapters.length === 0 && updated[subject].answers.length === 0) {
        const { [subject]: _, ...rest } = updated
        return rest
      }
      return updated
    })
    setChapters([])
    setResults([])
  }

  function removeChapter(idx) {
    setChapters(prev => prev.filter((_, i) => i !== idx))
  }

  function handleExtractTitles() {
    if (!exam) { showStatus('Select an exam first', 'error'); return }
    if (Object.keys(structure).length === 0) { showStatus('Upload a folder first', 'error'); return }

    const allChapters = []

    for (const [subject, { chapters: files }] of Object.entries(structure)) {
      for (const file of files) {
        const stem = file.name.replace(/\.pdf$/i, '')
        const chNumMatch = stem.match(/^chapter\s*(\d+)/i)
        const chapterNumber = chNumMatch ? parseInt(chNumMatch[1], 10) : null
        const titleRaw = stem.replace(/^chapter\s*\d+\s*/i, '').replace(/[_-]/g, ' ').trim()
        const title = toTitleCase(titleRaw || stem.replace(/[_-]/g, ' '))
        allChapters.push({ subject, file, title, chapterNumber, confidence: 'high', status: 'pending', edited: false })
      }
    }

    allChapters.sort((a, b) => {
      if (a.subject !== b.subject) return a.subject.localeCompare(b.subject)
      return a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    setChapters(allChapters)
    showStatus(`${allChapters.length} chapter titles ready — edit any if needed`, 'success')
  }

  async function uploadChapterPdf(file, subject, chapter) {
    try {
      const { data: existing } = await supabase
        .from('pdf_uploads').select('id')
        .eq('board', board).eq('grade', grade).eq('subject', subject).eq('chapter', chapter)
        .not('chapter_pdf', 'is', null).limit(1)
      if (existing && existing.length > 0) return
      const fileName = `chapter-pdfs/${Date.now()}_${file.name}`
      const { error } = await supabase.storage.from('pdf-uploads').upload(fileName, file)
      if (error) return
      const { data: urlData } = supabase.storage.from('pdf-uploads').getPublicUrl(fileName)
      await supabase.from('pdf_uploads').insert({ board, grade, subject, chapter, chapter_pdf: urlData.publicUrl })
    } catch {
      // Best-effort storage mirror; generation can continue if this fails.
    }
  }

  async function handleProcessAll() {
    if (!exam) { showStatus('Select an exam', 'error'); return }
    if (chapters.length === 0) { showStatus('Extract chapter titles first', 'error'); return }
    processingRef.current = true
    setProcessing(true)
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        setWakeLockActive(true)
      } catch {
        // Wake lock support varies by browser.
      }
    }

    // Target question counts per type (in DB, conceptual stores as 'long')
    const DB_TYPE = { mcq: 'mcq', vsa: 'vsa', short: 'short', long: 'long', conceptual: 'long', cbq: 'cbq' }
    const TYPE_TARGETS = { mcq: 50, vsa: 30, short: 30, long: 30, cbq: 10 }

    // Fetch existing counts for this exam upfront — one call covers all chapters
    const existingCounts = {}
    try {
      const statsRes = await fetch(`${API_BASE}/api/stats`)
      const statsData = await statsRes.json()
      for (const row of (statsData.stats || [])) {
        if (row.exam === exam) {
          const key = `${row.subject}||${row.chapter}||${row.question_type}`
          existingCounts[key] = (existingCounts[key] || 0) + row.count
        }
      }
    } catch {
      // Stats are an optimization; continue without them if unavailable.
    }

    // Build per-subject answers assignment map: chapterFileName → [answerFile, ...]
    const chapterAnswersMap = {}
    for (const [subject, { chapters: chs, answers: ans }] of Object.entries(structure)) {
      if (ans.length === 0) continue
      const N = chs.length
      const splitIdx = Math.floor(N / 2)
      chs.forEach((f, idx) => {
        let files = []
        if (ans.length >= 2) {
          if (N % 2 === 0) {
            files = idx < splitIdx ? [ans[0]] : [ans[1]]
          } else {
            if (idx < splitIdx) files = [ans[0]]
            else if (idx === splitIdx) files = [ans[0], ans[1]]
            else files = [ans[1]]
          }
        } else if (ans.length === 1) {
          files = [ans[0]]
        }
        chapterAnswersMap[`${subject}||${f.name}`] = files
      })
    }

    const EMPTY_BREAKDOWN = { mcq: 0, vsa: 0, short: 0, long: 0, conceptual: 0, cbq: 0 }
    const allResults = []
    let grandTotal = 0
    const grandBreakdown = { ...EMPTY_BREAKDOWN }

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci]
      const chapterBreakdown = { ...EMPTY_BREAKDOWN }
      setProgress({ chapterIdx: ci + 1, total: chapters.length, subject: ch.subject, title: ch.title, batch: 0, totalBatches: BATCHES.length, batchLabel: 'Checking...', savedTotal: grandTotal, chapterBreakdown, grandBreakdown: { ...grandBreakdown } })

      const chResult = { subject: ch.subject, title: ch.title, saved: 0, skipped: 0, errors: [], breakdown: { ...EMPTY_BREAKDOWN } }
      let fatalMismatch = false
      let firstBatchRun = true

      for (let bi = 0; bi < BATCHES.length; bi++) {
        const batch = BATCHES[bi]
        const dbType = DB_TYPE[batch.q_type]
        const target = TYPE_TARGETS[dbType] || batch.num_q
        const typeKey = `${ch.subject}||${ch.title}||${dbType}`
        const alreadyHave = existingCounts[typeKey] || 0

        if (alreadyHave >= target) {
          chResult.skipped++
          continue
        }

        const adjustedNumQ = Math.min(batch.num_q, target - alreadyHave)
        setProgress(p => ({ ...p, batch: bi + 1, batchLabel: batch.label }))

        const formData = new FormData()
        formData.append('file', ch.file)
        formData.append('exam', exam)
        formData.append('subject', ch.subject)
        formData.append('chapter', ch.title)
        formData.append('q_type', batch.q_type)
        formData.append('difficulty', 'mixed')
        formData.append('num_q', adjustedNumQ)
        if (ch.chapterNumber != null) formData.append('chapter_order', ch.chapterNumber)
        formData.append('title_edited', 'true')
        const ansFiles = manualAnswerKeys.length > 0
          ? manualAnswerKeys
          : (chapterAnswersMap[`${ch.subject}||${ch.file.name}`] || [])
        if (ansFiles[0]) formData.append('answers_file', ansFiles[0])
        if (ansFiles[1]) formData.append('answers_file_2', ansFiles[1])

        try {
          let res
          if (firstBatchRun) {
            ;[res] = await Promise.all([
              fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData }),
              uploadChapterPdf(ch.file, ch.subject, ch.title),
            ])
            firstBatchRun = false
          } else {
            res = await fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData })
          }

          const result = await res.json()
          const errMsg = result.error || result.detail || null
          if (Array.isArray(result.questions)) {
            const count = result.questions.length
            chResult.saved += count
            chResult.breakdown[batch.q_type] = (chResult.breakdown[batch.q_type] || 0) + count
            grandTotal += count
            grandBreakdown[batch.q_type] = (grandBreakdown[batch.q_type] || 0) + count
            chapterBreakdown[batch.q_type] = (chapterBreakdown[batch.q_type] || 0) + count
            existingCounts[typeKey] = alreadyHave + count
            setProgress(p => ({ ...p, savedTotal: grandTotal, chapterBreakdown: { ...chapterBreakdown }, grandBreakdown: { ...grandBreakdown } }))
          } else if (errMsg || !res.ok) {
            const displayErr = errMsg || `HTTP ${res.status}`
            chResult.errors.push(`${batch.label}: ${displayErr}`)
            fetch(`${API_BASE}/api/log`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: 'bulk-upload', stage: `batch_${batch.q_type}`, message: `Failed to generate ${batch.q_type} for "${ch.title}" (${ch.subject}): ${displayErr}`, context: { subject: ch.subject, chapter: ch.title, exam, q_type: batch.q_type, num_q_requested: adjustedNumQ, num_q_generated: 0 } })
            }).catch(() => {})
            if (res.status === 422) {
              fatalMismatch = true
              fetch(`${API_BASE}/api/log`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: 'bulk-upload', stage: 'chapter_mismatch', message: `Chapter title mismatch: "${ch.title}" (${ch.subject}) — remaining batches skipped`, context: { subject: ch.subject, chapter: ch.title, exam, batches_completed: bi, batches_skipped: BATCHES.length - bi - 1, generated_so_far: chResult.saved } })
              }).catch(() => {})
              showStatus(`Mismatch detected for "${ch.title}" — check Error Log`, 'error')
              break
            }
          }
        } catch (err) {
          chResult.errors.push(`${batch.label}: ${err.message}`)
          fetch(`${API_BASE}/api/log`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: 'bulk-upload', stage: `batch_${batch.q_type}`, message: `Network error for "${ch.title}" (${ch.subject}), ${batch.label}: ${err.message}`, context: { subject: ch.subject, chapter: ch.title, exam, q_type: batch.q_type } })
          }).catch(() => {})
        }
      }

      // Log chapter summary if any failures
      if (chResult.errors.length > 0 || fatalMismatch) {
        const successTypes = BATCHES.filter((b, i) => i < BATCHES.length && !chResult.errors.some(e => e.startsWith(b.label))).map(b => b.label)
        fetch(`${API_BASE}/api/log`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: 'bulk-upload', stage: 'chapter_summary', message: `Chapter "${ch.title}" (${ch.subject}): ${chResult.saved} questions generated. Successful: [${successTypes.join(', ')}]. Failed: [${chResult.errors.map(e => e.split(':')[0]).join(', ')}]`, context: { subject: ch.subject, chapter: ch.title, exam, total_generated: chResult.saved, failed_batches: chResult.errors.length, mismatch: fatalMismatch } })
        }).catch(() => {})
      }

      allResults.push({ ...chResult, mismatch: fatalMismatch })
      setResults([...allResults])
      setChapters(prev => prev.map((c, i) =>
        i === ci ? { ...c, status: fatalMismatch ? 'mismatch' : chResult.errors.length > 0 ? 'error' : 'done' } : c
      ))
    }

    if (wakeLockRef.current) {
      try { await wakeLockRef.current.release() } catch {
        // Nothing to recover; the browser may have already released it.
      }
      wakeLockRef.current = null
    }
    processingRef.current = false
    setWakeLockActive(false)
    setProgress(null)
    setProcessing(false)
    showStatus(`Done — ${grandTotal} questions generated across ${chapters.length} chapters`, 'success')
  }

  async function handleSplitPreview() {
    if (!splitFile) return
    setSplitPreviewing(true)
    setSplitPreview(null)
    setSplitError(null)
    try {
      const fd = new FormData()
      fd.append('file', splitFile)
      const res = await fetch(`${API_BASE}/api/split-pdf/preview`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) {
        setSplitError(data.error || data.detail || `Error ${res.status}`)
      } else {
        setSplitContentsPage(data.contents_physical_page || 1)
        setSplitPreview({ ...data, source: 'pdf' })
      }
    } catch (err) {
      setSplitError(err.message)
    } finally {
      setSplitPreviewing(false)
    }
  }

  function handleSplitTocImagesAdd(files) {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      setSplitError('Please select image files for the Contents page screenshot.')
      return
    }
    setSplitTocImages(prev => [...prev, ...imageFiles])
    setSplitPreview(null)
    setSplitError(null)
  }

  function removeSplitTocImage(index) {
    setSplitTocImages(prev => prev.filter((_, i) => i !== index))
    setSplitPreview(null)
  }

  async function handleSplitImagePreview() {
    if (!splitFile || splitTocImages.length === 0) return
    setSplitImageExtracting(true)
    setSplitPreview(null)
    setSplitError(null)
    try {
      const previewFd = new FormData()
      previewFd.append('file', splitFile)
      splitTocImages.forEach(img => previewFd.append('toc_images', img))
      previewFd.append('contents_physical_page', String(Math.max(1, Number(splitContentsPage) || 1)))
      previewFd.append('anchor_mode', 'contents_page')
      const previewRes = await fetch(`${API_BASE}/api/split-pdf/preview`, { method: 'POST', body: previewFd })
      const previewData = await previewRes.json()
      if (!previewRes.ok || previewData.error || previewData.detail) {
        setSplitError(previewData.error || previewData.detail || `Error ${previewRes.status}`)
      } else {
        setSplitPreview({ ...previewData, source: 'image' })
      }
    } catch (err) {
      setSplitError(err.message)
    } finally {
      setSplitImageExtracting(false)
    }
  }

  async function handleSplitDownload() {
    if (!splitFile) return
    setSplitDownloading(true)
    try {
      const fd = new FormData()
      fd.append('file', splitFile)
      if (splitPreview?.source === 'image') {
        const chaptersForDownload = splitPreview.chapters.map(({ title, printed_page }) => ({ title, printed_page }))
        fd.append('chapters_json', JSON.stringify(chaptersForDownload))
        fd.append('contents_physical_page', String(splitPreview.contents_physical_page || splitContentsPage || 1))
        fd.append('anchor_mode', 'contents_page')
      }
      const res = await fetch(`${API_BASE}/api/split-pdf/download`, { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json()
        setSplitError(data.detail || `Error ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      a.download = match ? match[1] : 'chapters.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setSplitError(err.message)
    } finally {
      setSplitDownloading(false)
    }
  }

  const subjectCount = Object.keys(structure).length
  const totalFiles = Object.values(structure).reduce((s, v) => s + v.chapters.length + v.answers.length, 0)

  return (
    <div className="page-content">
      <h2>Bulk Chapter Upload</h2>
      <p style={{ color: '#6b8a80', fontSize: '14px', marginBottom: '24px' }}>
        Upload a grade folder (<code>Grade / Subject / chapter.pdf</code>) or a subject folder directly (<code>Subject / chapter.pdf</code>). Both structures are supported.
      </p>

      {/* Step 1 */}
      <div className="form-panel" style={{ marginBottom: '16px' }}>
        <div className="form-row">
          <div className="form-group">
            <label>Grade:</label>
            <select value={grade} onChange={e => { setGrade(e.target.value); setChapters([]); setResults([]) }}>
              <option value="">Select Grade</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Board:</label>
            <select value={board} onChange={e => { setBoard(e.target.value); setChapters([]); setResults([]) }}>
              {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Grade Folder:</label>
            <label className={`file-input-label ${subjectCount > 0 ? 'has-file' : ''}`} htmlFor="folderInput" style={{ cursor: 'pointer' }}>
              {subjectCount > 0
                ? `${subjectCount} subject${subjectCount !== 1 ? 's' : ''}, ${totalFiles} PDFs found`
                : 'Click to select grade folder'}
            </label>
            <input
              type="file" id="folderInput" style={{ display: 'none' }}
              webkitdirectory="true" directory="true" multiple
              onChange={handleFolderChange}
            />
          </div>
        </div>

        {/* Answer key manual upload */}
        <div style={{ marginTop: '14px', padding: '12px 14px', background: '#f7fbfa', border: '1px solid #d4e0de', borderRadius: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#2d4a47', marginBottom: '8px' }}>
            Answer Key / Hints PDFs
            <span style={{ fontWeight: '400', color: '#6b8a80', marginLeft: '6px' }}>(applied to all chapters)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {manualAnswerKeys.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#edf8ef', border: '1px solid #b8d8cc', borderRadius: '6px', fontSize: '12px' }}>
                <span style={{ color: '#2e7d32', fontWeight: '500' }}>PDF {i + 1}: {f.name}</span>
                <button
                  onClick={() => setManualAnswerKeys(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: '15px', padding: '0 4px', lineHeight: 1 }}
                  title="Remove"
                >×</button>
              </div>
            ))}
            {manualAnswerKeys.length < 2 && (
              <label
                htmlFor="answerKeyInput"
                onDragOver={e => { e.preventDefault(); setAnswerKeyDragging(true) }}
                onDragLeave={() => setAnswerKeyDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setAnswerKeyDragging(false)
                  const dropped = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'))
                  if (dropped.length) setManualAnswerKeys(prev => [...prev, ...dropped].slice(0, 2))
                }}
                style={{
                  display: 'block', padding: '12px 14px', textAlign: 'center',
                  background: answerKeyDragging ? '#eef8f3' : '#fff',
                  border: `2px dashed ${answerKeyDragging ? '#4a6e6a' : '#b8d8cc'}`,
                  borderRadius: '6px', fontSize: '12px', color: answerKeyDragging ? '#4a6e6a' : '#6b8a80',
                  cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                {answerKeyDragging ? 'Drop PDF here' : `+ Drag or click to add answer key PDF${manualAnswerKeys.length > 0 ? ' (2nd)' : ''}`}
              </label>
            )}
            <input
              type="file" id="answerKeyInput" accept=".pdf" style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file && file.name.toLowerCase().endsWith('.pdf')) {
                  setManualAnswerKeys(prev => [...prev, file].slice(0, 2))
                }
                e.target.value = ''
              }}
            />
          </div>
          <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: '#6b8a80' }}>
            Upload up to 2 answer hint PDFs. These override any answer PDFs detected in the folder.
          </p>
        </div>

        {subjectCount > 0 && (
          <div style={{ marginTop: '12px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #d4e0de' }}>
            {Object.entries(structure).map(([subject, { chapters: cFiles, answers: aFiles }]) => (
              <div key={subject}>
                <div style={{ padding: '5px 12px', background: '#e0ebe9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px', color: '#2d4a47' }}>{subject}</strong>
                  <span style={{ fontSize: '12px', color: '#6b8a80' }}>
                    {cFiles.length} chapter{cFiles.length !== 1 ? 's' : ''}
                    {aFiles.length > 0 ? ` · ${aFiles.length} answers PDF${aFiles.length !== 1 ? 's' : ''}` : ''}
                  </span>
                </div>
                {cFiles.map(f => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', padding: '3px 12px', borderBottom: '1px solid #edf2f1', fontSize: '13px', color: '#4a6e6a' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <button
                      onClick={() => removeFileFromStructure(subject, f.name)}
                      title="Remove from queue"
                      style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                    >×</button>
                  </div>
                ))}
                {aFiles.map(f => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', padding: '3px 12px', borderBottom: '1px solid #edf2f1', fontSize: '13px', color: '#6b8a80', background: '#f7fbfa' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '10px', background: '#c8e6c9', color: '#2e7d32', borderRadius: '3px', padding: '1px 4px', marginRight: '6px', fontWeight: '600' }}>ANS</span>
                      {f.name}
                    </span>
                    <button
                      onClick={() => removeFileFromStructure(subject, f.name)}
                      title="Remove from queue"
                      style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {subjectCount > 0 && (
          <button onClick={handleExtractTitles} disabled={processing || !exam} style={{ marginTop: '16px' }}>
            Extract Chapter Titles
          </button>
        )}
      </div>

      {/* Step 2: title table */}
      {chapters.length > 0 && (
        <div className="form-panel" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>Extracted Chapters ({chapters.length}) — edit any title if wrong</h3>
            <button
              onClick={handleProcessAll}
              disabled={processing}
              style={{ background: '#2d4a47', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}
            >
              {processing ? 'Processing...' : '⚡ Generate All Chapters (150 Qs each)'}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>#</th>
                <th style={{ padding: '6px 8px' }}>Subject</th>
                <th style={{ padding: '6px 8px' }}>File</th>
                <th style={{ padding: '6px 8px' }}>Extracted Title (editable)</th>
                <th style={{ padding: '6px 8px' }}>Confidence</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((ch, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                  <td style={{ padding: '6px 8px', color: '#6b8a80' }}>{ch.chapterNumber ?? i + 1}</td>
                  <td style={{ padding: '6px 8px', fontWeight: '500' }}>{ch.subject}</td>
                  <td style={{ padding: '6px 8px', color: '#6b8a80', fontSize: '12px' }}>{ch.file.name}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      value={ch.title}
                      onChange={e => setChapters(prev => prev.map((c, j) =>
                        j === i ? { ...c, title: e.target.value, edited: true } : c
                      ))}
                      onBlur={e => {
                        const formatted = toTitleCase(e.target.value)
                        if (formatted !== e.target.value) {
                          setChapters(prev => prev.map((c, j) =>
                            j === i ? { ...c, title: formatted, edited: true } : c
                          ))
                        }
                      }}
                      style={{ width: '100%', border: ch.edited ? '1px solid #4a6e6a' : '1px solid #e0e8e6', borderRadius: '4px', padding: '3px 6px', fontSize: '13px', background: ch.edited ? '#f0f9f7' : 'transparent' }}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px',
                      background: ch.confidence === 'cached' ? '#cce5ff' : ch.confidence === 'high' ? '#d4edda' : '#fff3cd',
                      color: ch.confidence === 'cached' ? '#004085' : ch.confidence === 'high' ? '#155724' : '#856404' }}>
                      {ch.confidence === 'cached' ? '✓ cached' : ch.confidence}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px',
                      background: ch.status === 'done' ? '#d4edda' : ch.status === 'mismatch' ? '#fdecea' : ch.status === 'error' ? '#fff3cd' : '#e8f0ee',
                      color: ch.status === 'done' ? '#155724' : ch.status === 'mismatch' ? '#c0392b' : ch.status === 'error' ? '#856404' : '#4a6e6a'
                    }}>
                      {ch.status}
                    </span>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    {ch.status === 'pending' && (
                      <button
                        onClick={() => removeChapter(i)}
                        disabled={processing}
                        title="Remove from queue"
                        style={{ background: 'none', border: 'none', color: '#bbb', cursor: processing ? 'not-allowed' : 'pointer', fontSize: '17px', lineHeight: 1, padding: '0 4px' }}
                      >×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Progress */}
      {processing && progress && (
        <div style={{ padding: '16px', background: '#f0f4f3', borderRadius: '10px', border: '1px solid #c8d8d5', marginBottom: '16px' }}>
          {wakeLockActive && (
            <div style={{ fontSize: '11px', color: '#6b8a80', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#4a6e6a' }} />
              Screen kept awake — safe to leave this tab open
            </div>
          )}
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontWeight: '600', color: '#2d4a47', fontSize: '14px' }}>
              Chapter {progress.chapterIdx}/{progress.total}: <span style={{ color: '#4a6e6a' }}>{progress.subject}</span> — {progress.title}
            </span>
            <span style={{ color: '#6b8a80', fontSize: '13px' }}>{progress.batchLabel}</span>
          </div>

          {/* Progress bar */}
          <div style={{ background: '#c8d8d5', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{ background: '#4a6e6a', height: '100%', transition: 'width 0.4s', width: `${((progress.chapterIdx - 1 + progress.batch / progress.totalBatches) / progress.total) * 100}%` }} />
          </div>

          {/* Current chapter breakdown */}
          <div style={{ marginBottom: '10px' }}>
            <p style={{ fontSize: '11px', color: '#6b8a80', margin: '0 0 5px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>This chapter</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { key: 'mcq', label: 'MCQ' },
                { key: 'vsa', label: 'VSA' },
                { key: 'short', label: 'Short Ans' },
                { key: 'long', label: 'Long Ans' },
                { key: 'conceptual', label: 'Conceptual' },
                { key: 'cbq', label: 'CBQ' },
              ].map(({ key, label }) => {
                const count = progress.chapterBreakdown?.[key] || 0
                return (
                  <span key={key} style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: count > 0 ? '600' : '400', background: count > 0 ? '#4a6e6a' : '#e0e8e6', color: count > 0 ? '#fff' : '#6b8a80' }}>
                    {label}: {count}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Grand total breakdown */}
          <div style={{ borderTop: '1px solid #c8d8d5', paddingTop: '10px' }}>
            <p style={{ fontSize: '11px', color: '#6b8a80', margin: '0 0 5px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Grand total — {progress.savedTotal} questions</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { key: 'mcq', label: 'MCQ' },
                { key: 'vsa', label: 'VSA' },
                { key: 'short', label: 'Short Ans' },
                { key: 'long', label: 'Long Ans' },
                { key: 'conceptual', label: 'Conceptual' },
                { key: 'cbq', label: 'CBQ' },
              ].map(({ key, label }) => {
                const count = progress.grandBreakdown?.[key] || 0
                return (
                  <span key={key} style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', background: '#e8f0ee', color: '#2d4a47' }}>
                    {label}: <strong>{count}</strong>
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && !processing && (
        <div className="form-panel">
          <h3>Results Summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Subject</th>
                <th style={{ padding: '6px 8px' }}>Chapter</th>
                <th style={{ padding: '6px 8px' }}>New Questions</th>
                <th style={{ padding: '6px 8px' }}>Batches Skipped</th>
                <th style={{ padding: '6px 8px' }}>Issues</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                  <td style={{ padding: '6px 8px' }}>{r.subject}</td>
                  <td style={{ padding: '6px 8px' }}>{r.title}</td>
                  <td style={{ padding: '6px 8px', fontWeight: '600', color: '#4a6e6a' }}>{r.saved}</td>
                  <td style={{ padding: '6px 8px', color: r.skipped === BATCHES.length ? '#155724' : '#6b8a80' }}>
                    {r.skipped}/{BATCHES.length} {r.skipped === BATCHES.length ? '✓ already complete' : ''}
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: r.errors.length > 0 ? '#c0392b' : '#6b8a80' }}>
                    {r.mismatch ? 'Chapter mismatch — skipped (see Error Log)' : r.errors.length > 0 ? r.errors.join(' | ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '12px', fontWeight: '600', color: '#2d4a47' }}>
            Total: {results.reduce((s, r) => s + r.saved, 0)} questions across {results.length} chapters
          </p>
        </div>
      )}
      {/* Split PDF Tool */}
      <div className="form-panel" style={{ marginTop: '16px' }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setSplitOpen(o => !o)}
        >
          <h3 style={{ margin: 0, fontSize: '15px' }}>✂ Split Textbook PDF into Chapter ZIPs</h3>
          <span style={{ color: '#6b8a80', fontSize: '16px' }}>{splitOpen ? '▲' : '▼'}</span>
        </div>

        {splitOpen && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ color: '#6b8a80', fontSize: '13px', margin: '0 0 14px 0' }}>
              Upload a full textbook PDF. The tool reads the Contents page, extracts chapter names and page numbers exactly as listed, and packages each chapter as a separate PDF in a ZIP — ready to upload above. Answers sections are automatically separated too.
            </p>

            {/* Inputs */}
            <div className="form-row" style={{ alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '2', minWidth: '200px' }}>
                <label>Textbook PDF:</label>
                <label
                  className={`file-input-label ${splitFile ? 'has-file' : ''}`}
                  htmlFor="splitPdfInput"
                  style={{ cursor: 'pointer', display: 'block' }}
                >
                  {splitFile ? splitFile.name : 'Click to select PDF'}
                </label>
                <input
                  type="file" id="splitPdfInput" accept=".pdf" style={{ display: 'none' }}
                  onChange={e => { setSplitFile(e.target.files[0] || null); setSplitPreview(null); setSplitError(null) }}
                />
              </div>

              <div className="form-group" style={{ flex: '0 0 auto' }}>
                <label style={{ visibility: 'hidden' }}>.</label>
                <button
                  onClick={handleSplitPreview}
                  disabled={!splitFile || splitPreviewing || splitDownloading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {splitPreviewing ? 'Reading Contents...' : 'Preview Chapters'}
                </button>
              </div>
            </div>

            <div style={{ marginTop: '14px', padding: '14px', border: '1px solid #d4e0de', borderRadius: '8px', background: '#f8fcfa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: '#2d4a47', fontSize: '13px' }}>Index screenshot fallback</strong>
                  <p style={{ color: '#6b8a80', fontSize: '12px', margin: '4px 0 0 0' }}>
                    Drop a screenshot of the Contents/Index page if auto-detection fails. Also set the page number below.
                  </p>
                </div>
                <div style={{ width: '210px', flexShrink: 0 }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: '#4a6e6a' }}>
                    Contents page # in PDF
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={splitContentsPage}
                    onChange={e => { setSplitContentsPage(e.target.value); setSplitPreview(null); setSplitError(null) }}
                    style={{ padding: '8px 10px', fontSize: '13px', width: '100%' }}
                  />
                  <p style={{ color: '#6b8a80', fontSize: '11px', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                    Open the PDF in a viewer, go to the Contents/Index page, note the page count shown (e.g. "6 of 120"). Enter that number here.
                  </p>
                </div>
              </div>

              <label
                htmlFor="splitTocImageInput"
                onDragOver={e => { e.preventDefault(); setSplitTocDragging(true) }}
                onDragLeave={() => setSplitTocDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setSplitTocDragging(false)
                  handleSplitTocImagesAdd(e.dataTransfer.files)
                }}
                style={{
                  display: 'block',
                  padding: '14px 18px',
                  border: `2px dashed ${splitTocDragging ? '#4a6e6a' : splitTocImages.length > 0 ? '#28a745' : '#b8d8cc'}`,
                  borderRadius: '8px',
                  background: splitTocDragging ? '#eef8f3' : '#fff',
                  color: '#6b8a80',
                  textAlign: 'center',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                {splitTocImages.length > 0
                  ? `+ Add more pages (${splitTocImages.length} image${splitTocImages.length > 1 ? 's' : ''} added)`
                  : 'Drag contents/index screenshot here, or click to select'}
              </label>
              <input
                type="file"
                id="splitTocImageInput"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={e => { handleSplitTocImagesAdd(e.target.files); e.target.value = '' }}
              />

              {splitTocImages.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {splitTocImages.map((img, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#edf8ef', borderRadius: '6px', fontSize: '12px', color: '#155724' }}>
                      <span>Page {i + 1}: {img.name}</span>
                      <button
                        onClick={() => removeSplitTocImage(i)}
                        style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: '14px', padding: '0 4px', lineHeight: 1 }}
                        title="Remove"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleSplitImagePreview}
                disabled={!splitFile || splitTocImages.length === 0 || splitImageExtracting || splitPreviewing || splitDownloading}
                style={{ marginTop: '10px', whiteSpace: 'nowrap' }}
              >
                {splitImageExtracting ? 'Reading Screenshot...' : 'Use Screenshot for Chapters'}
              </button>
            </div>

            {/* Error */}
            {splitError && (
              <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fdecea', borderRadius: '8px', color: '#c0392b', fontSize: '13px' }}>
                {splitError}
              </div>
            )}

            {/* Preview table */}
            {splitPreview && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', color: '#4a6e6a' }}>
                    <strong>{splitPreview.chapters.length} entries</strong> found in Contents &nbsp;·&nbsp;
                    Source: <code style={{ background: '#e8f0ee', padding: '1px 5px', borderRadius: '3px' }}>{splitPreview.source === 'image' ? 'screenshot + PDF match' : 'PDF'}</code> &nbsp;·&nbsp;
                    Contents page: <strong>{splitPreview.contents_physical_page}</strong> &nbsp;·&nbsp;
                    Subject folder: <code style={{ background: '#e8f0ee', padding: '1px 5px', borderRadius: '3px' }}>{splitPreview.subject_name}</code> &nbsp;·&nbsp;
                    {splitPreview.total_pages} pages total
                  </div>
                  <button
                    onClick={handleSplitDownload}
                    disabled={splitDownloading}
                    style={{ background: '#2d4a47', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 18px', cursor: 'pointer', fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap' }}
                  >
                    {splitDownloading ? 'Building ZIP...' : '⬇ Download ZIP'}
                  </button>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e0e8e6', textAlign: 'left' }}>
                      <th style={{ padding: '5px 8px' }}>Chapter Title (from Contents)</th>
                      <th style={{ padding: '5px 8px' }}>Book Pages</th>
                      <th style={{ padding: '5px 8px' }}>Page Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {splitPreview.chapters.map((ch, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                        <td style={{ padding: '5px 8px', fontWeight: '500' }}>{ch.title}</td>
                        <td style={{ padding: '5px 8px', color: '#6b8a80' }}>{ch.printed_page} – {ch.end_printed_page}</td>
                        <td style={{ padding: '5px 8px', color: '#6b8a80' }}>{ch.pages} pg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p style={{ marginTop: '10px', fontSize: '12px', color: '#6b8a80' }}>
                  Chapter titles are copied exactly from the Contents page. The ZIP folder will be named <strong>{splitPreview.subject_name}</strong> — use that exact name as the subject folder when uploading above.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
