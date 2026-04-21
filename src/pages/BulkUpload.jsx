import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''

const BATCHES = [
  { q_type: 'mcq',        num_q: 25, label: 'MCQs (1/2)' },
  { q_type: 'mcq',        num_q: 25, label: 'MCQs (2/2)' },
  { q_type: 'vsa',        num_q: 30, label: 'Very Short Answers' },
  { q_type: 'short',      num_q: 30, label: 'Short Answers' },
  { q_type: 'long',       num_q: 15, label: 'Long Answers' },
  { q_type: 'conceptual', num_q: 15, label: 'Conceptual' },
  { q_type: 'cbq',        num_q: 10, label: 'Case-Based Questions' },
]

function parseExam(examStr) {
  const gradeMatch = examStr.match(/^(\d+th|\d+st|\d+nd|\d+rd)/i)
  const grade = gradeMatch ? gradeMatch[1] : ''
  const boardMatch = examStr.match(/(CBSE|ICSE|State)/i)
  const board = boardMatch ? boardMatch[1].toUpperCase() : ''
  return { grade, board }
}

function parseFolderStructure(fileList) {
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'))
  const struct = {}
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/')
    // Expected: GradeFolder/SubjectFolder/chapter.pdf
    // parts[parts.length - 2] = immediate parent folder = subject
    const subject = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown'
    if (!struct[subject]) struct[subject] = []
    struct[subject].push(file)
  }
  for (const subject of Object.keys(struct)) {
    struct[subject].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
  }
  return struct
}

export default function BulkUpload({ showStatus }) {
  const [exam, setExam] = useState('')
  const [structure, setStructure] = useState({})
  const [chapters, setChapters] = useState([])
  const [extracting, setExtracting] = useState(false)
  const [availableExams, setAvailableExams] = useState([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState([])

  const DEFAULT_EXAMS = ['10th CBSE Board', '12th CBSE Board']

  useEffect(() => {
    fetch(`${API_BASE}/api/meta/options`)
      .then(r => r.json())
      .then(data => {
        const db = data.exams || []
        const merged = [...new Set([...DEFAULT_EXAMS, ...db])].sort()
        setAvailableExams(merged)
      })
      .catch(() => setAvailableExams(DEFAULT_EXAMS))
  }, [])

  function handleFolderChange(e) {
    const struct = parseFolderStructure(e.target.files)
    setStructure(struct)
    setChapters([])
    setResults([])
  }

  async function handleExtractTitles() {
    if (!exam) { showStatus('Select an exam first', 'error'); return }
    if (Object.keys(structure).length === 0) { showStatus('Upload a folder first', 'error'); return }
    setExtracting(true)
    const allChapters = []

    for (const [subject, files] of Object.entries(structure)) {
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('subject', subject)
        formData.append('exam', exam)
        try {
          const res = await fetch(`${API_BASE}/api/extract-chapter-title`, { method: 'POST', body: formData })
          const data = await res.json()
          allChapters.push({
            subject, file,
            title: data.chapter_title || file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' '),
            chapterNumber: data.chapter_number,
            confidence: data.confidence || 'low',
            status: 'pending',
            edited: false,
          })
        } catch {
          allChapters.push({
            subject, file,
            title: file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' '),
            chapterNumber: null,
            confidence: 'low',
            status: 'pending',
            edited: false,
          })
        }
      }
    }

    allChapters.sort((a, b) => {
      if (a.subject !== b.subject) return a.subject.localeCompare(b.subject)
      if (a.chapterNumber != null && b.chapterNumber != null) return a.chapterNumber - b.chapterNumber
      if (a.chapterNumber != null) return -1
      if (b.chapterNumber != null) return 1
      return a.file.name.localeCompare(b.file.name, undefined, { numeric: true })
    })

    setChapters(allChapters)
    setExtracting(false)
    const lowConf = allChapters.filter(c => c.confidence === 'low').length
    showStatus(
      `Titles extracted for ${allChapters.length} chapters${lowConf > 0 ? ` — ${lowConf} low-confidence (please review)` : ''}`,
      lowConf > 0 ? 'error' : 'success'
    )
  }

  async function uploadChapterPdf(file, subject, chapter) {
    try {
      const { grade, board } = parseExam(exam)
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
    } catch {}
  }

  async function handleProcessAll() {
    if (!exam) { showStatus('Select an exam', 'error'); return }
    if (chapters.length === 0) { showStatus('Extract chapter titles first', 'error'); return }
    setProcessing(true)

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
    } catch {}

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
          if (result.questions) {
            const count = result.questions.length
            chResult.saved += count
            chResult.breakdown[batch.q_type] = (chResult.breakdown[batch.q_type] || 0) + count
            grandTotal += count
            grandBreakdown[batch.q_type] = (grandBreakdown[batch.q_type] || 0) + count
            chapterBreakdown[batch.q_type] = (chapterBreakdown[batch.q_type] || 0) + count
            existingCounts[typeKey] = alreadyHave + count
            setProgress(p => ({ ...p, savedTotal: grandTotal, chapterBreakdown: { ...chapterBreakdown }, grandBreakdown: { ...grandBreakdown } }))
          } else if (result.error) {
            chResult.errors.push(`${batch.label}: ${result.error}`)
            fetch(`${API_BASE}/api/log`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: 'bulk-upload', stage: `batch_${batch.q_type}`, message: `Failed to generate ${batch.q_type} for "${ch.title}" (${ch.subject}): ${result.error}`, context: { subject: ch.subject, chapter: ch.title, exam, q_type: batch.q_type, num_q_requested: adjustedNumQ, num_q_generated: 0 } })
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

    setProgress(null)
    setProcessing(false)
    showStatus(`Done — ${grandTotal} questions generated across ${chapters.length} chapters`, 'success')
  }

  const subjectCount = Object.keys(structure).length
  const totalFiles = Object.values(structure).reduce((s, f) => s + f.length, 0)

  return (
    <div className="page-content">
      <h2>Bulk Chapter Upload</h2>
      <p style={{ color: '#6b8a80', fontSize: '14px', marginBottom: '24px' }}>
        Upload your entire grade folder. Expected structure: <code>GradeFolder / Subject / chapter.pdf</code>
      </p>

      {/* Step 1 */}
      <div className="form-panel" style={{ marginBottom: '16px' }}>
        <div className="form-row">
          <div className="form-group">
            <label>Exam / Grade:</label>
            <select value={exam} onChange={e => setExam(e.target.value)}>
              <option value="">Select Exam</option>
              {availableExams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
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

        {subjectCount > 0 && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#f0f4f3', borderRadius: '8px' }}>
            {Object.entries(structure).map(([subject, files]) => (
              <div key={subject} style={{ fontSize: '13px', color: '#6b8a80', marginBottom: '4px' }}>
                <strong style={{ color: '#2d4a47' }}>{subject}</strong> — {files.length} chapter{files.length !== 1 ? 's' : ''}
              </div>
            ))}
          </div>
        )}

        {subjectCount > 0 && (
          <button onClick={handleExtractTitles} disabled={extracting || processing || !exam} style={{ marginTop: '16px' }}>
            {extracting ? 'Extracting Titles...' : 'Extract Chapter Titles from PDFs'}
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
              disabled={processing || extracting}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Progress */}
      {processing && progress && (
        <div style={{ padding: '16px', background: '#f0f4f3', borderRadius: '10px', border: '1px solid #c8d8d5', marginBottom: '16px' }}>
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
    </div>
  )
}
