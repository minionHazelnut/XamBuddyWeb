import { useState } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''
const EXAMS = ['10th CBSE Board', '12th CBSE Board']

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
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState([])

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
    const allResults = []
    let grandTotal = 0

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci]
      setProgress({ chapterIdx: ci + 1, total: chapters.length, subject: ch.subject, title: ch.title, batch: 0, totalBatches: BATCHES.length, batchLabel: 'Starting...', savedTotal: grandTotal })

      const chResult = { subject: ch.subject, title: ch.title, saved: 0, errors: [] }
      let fatalMismatch = false

      for (let bi = 0; bi < BATCHES.length; bi++) {
        const batch = BATCHES[bi]
        setProgress(p => ({ ...p, batch: bi + 1, batchLabel: batch.label }))

        const formData = new FormData()
        formData.append('file', ch.file)
        formData.append('exam', exam)
        formData.append('subject', ch.subject)
        formData.append('chapter', ch.title)
        formData.append('q_type', batch.q_type)
        formData.append('difficulty', 'mixed')
        formData.append('num_q', batch.num_q)
        if (ch.chapterNumber != null) formData.append('chapter_order', ch.chapterNumber)

        try {
          let res
          if (bi === 0) {
            ;[res] = await Promise.all([
              fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData }),
              uploadChapterPdf(ch.file, ch.subject, ch.title),
            ])
          } else {
            res = await fetch(`${API_BASE}/api/generate`, { method: 'POST', body: formData })
          }

          const result = await res.json()
          if (result.questions) {
            chResult.saved += result.questions.length
            grandTotal += result.questions.length
          } else if (result.error) {
            chResult.errors.push(`${batch.label}: ${result.error}`)
            if (res.status === 422) {
              fatalMismatch = true
              showStatus(`Mismatch detected for "${ch.title}" — check Error Log`, 'error')
              break
            }
          }
        } catch (err) {
          chResult.errors.push(`${batch.label}: ${err.message}`)
        }
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
              {EXAMS.map(ex => <option key={ex} value={ex}>{ex}</option>)}
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
                    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', background: ch.confidence === 'high' ? '#d4edda' : '#fff3cd', color: ch.confidence === 'high' ? '#155724' : '#856404' }}>
                      {ch.confidence}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontWeight: '600', color: '#2d4a47' }}>
              Chapter {progress.chapterIdx}/{progress.total}: {progress.subject} — {progress.title}
            </span>
            <span style={{ color: '#6b8a80', fontSize: '13px' }}>Batch {progress.batch}/{progress.totalBatches}: {progress.batchLabel}</span>
          </div>
          <div style={{ background: '#c8d8d5', borderRadius: '4px', height: '8px', overflow: 'hidden', marginBottom: '6px' }}>
            <div style={{
              background: '#4a6e6a', height: '100%', transition: 'width 0.3s',
              width: `${((progress.chapterIdx - 1 + progress.batch / progress.totalBatches) / progress.total) * 100}%`
            }} />
          </div>
          <p style={{ fontSize: '13px', color: '#6b8a80', margin: 0 }}>{progress.savedTotal} questions generated so far</p>
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
                <th style={{ padding: '6px 8px' }}>Questions Saved</th>
                <th style={{ padding: '6px 8px' }}>Issues</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e0e8e6' }}>
                  <td style={{ padding: '6px 8px' }}>{r.subject}</td>
                  <td style={{ padding: '6px 8px' }}>{r.title}</td>
                  <td style={{ padding: '6px 8px', fontWeight: '600', color: '#4a6e6a' }}>{r.saved}</td>
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
