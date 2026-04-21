import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''
const BOARDS = ['CBSE', 'ICSE', 'State']
const GRADES = ['10', '12']
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Economics', 'Political Science', 'Accountancy', 'Business Studies', 'Computer Science']
const UPLOAD_TYPES = ['guide_reference', 'sample_question', 'other']

export default function ReferenceUploads({ showStatus }) {
  const [subject, setSubject] = useState('')
  const [classLevel, setClassLevel] = useState('')
  const [board, setBoard] = useState('')
  const [uploadType, setUploadType] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploads, setUploads] = useState([])
  const [loadingUploads, setLoadingUploads] = useState(false)

  useEffect(() => { fetchUploads() }, [])

  async function fetchUploads() {
    setLoadingUploads(true)
    try {
      const { data, error } = await supabase
        .from('reference_uploads')
        .select('*')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      setUploads(data)
    } catch (err) {
      showStatus(`Could not load uploads: ${err.message}`, 'error')
    } finally {
      setLoadingUploads(false)
    }
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) { showStatus('Please select a PDF.', 'error'); return }
    if (!subject || !classLevel || !board || !uploadType) { showStatus('Please fill all required fields.', 'error'); return }
    setLoading(true)
    try {
      const fileName = `reference-uploads/${Date.now()}_${file.name}`
      const { error: storageError } = await supabase.storage.from('pdf-uploads').upload(fileName, file)
      if (storageError) throw storageError

      const formData = new FormData()
      formData.append('file_name', file.name)
      formData.append('subject', subject)
      formData.append('class_level', classLevel)
      formData.append('board', board)
      formData.append('upload_type', uploadType)

      const res = await fetch(`${API_BASE}/api/upload-reference`, { method: 'POST', body: formData })
      const result = await res.json()
      if (!result.success) throw new Error(result.detail || 'Upload failed')

      showStatus('Reference uploaded successfully.', 'success')
      setFile(null)
      fetchUploads()
    } catch (err) {
      showStatus(`Upload failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-content">
      <h2>Reference Uploads</h2>
      <p style={{ color: '#6b8a80', marginBottom: '20px', fontSize: '14px' }}>
        Upload guide books and sample PDFs for reference only. These are never added to the question bank.
      </p>

      <div className="form-panel">
        <form onSubmit={handleUpload}>
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
              <label>Upload Type *</label>
              <select value={uploadType} onChange={e => setUploadType(e.target.value)} required>
                <option value="">Select type</option>
                {UPLOAD_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>PDF File *</label>
            <label className={`file-input-label ${file ? 'has-file' : ''}`}>
              {file ? file.name : 'Click to select PDF'}
              <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0] || null)} />
            </label>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Uploading...' : 'Upload Reference'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3>Uploaded References</h3>
          <button onClick={fetchUploads} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Refresh</button>
        </div>
        {loadingUploads ? <p>Loading...</p> : uploads.length === 0 ? (
          <p style={{ color: '#6b8a80' }}>No references uploaded yet.</p>
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
              {uploads.map(u => (
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
  )
}
