import { useState } from 'react'
import { supabase } from '../lib/supabase'

const BOARDS = ['CBSE', 'ICSE', 'State']
const GRADES = ['6th', '7th', '8th', '9th', '10th', '11th', '12th']
const SUBJECTS = ['Mathematics', 'Science', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Economics', 'Political Science', 'Accountancy', 'Business Studies']

export default function ExamPaperUploads({ showStatus }) {
  const [paperType, setPaperType] = useState('exam_paper')
  const [board, setBoard] = useState('')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [year, setYear] = useState('')
  const [examPaperFile, setExamPaperFile] = useState(null)
  const [answerKeyFile, setAnswerKeyFile] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!board || !grade || !subject) {
      showStatus('Please fill in all required fields.', 'error')
      return
    }
    if (!examPaperFile) {
      showStatus('Please select a PDF to upload.', 'error')
      return
    }

    setLoading(true)

    try {
      const examType = paperType === 'exam_paper' ? 'board_exam' : 'sample_paper'
      const folder = paperType === 'exam_paper' ? 'exam-papers' : 'sample-papers'

      const examFileName = `${folder}/${Date.now()}_${examPaperFile.name}`
      const { error: examUploadError } = await supabase.storage
        .from('pdf-uploads')
        .upload(examFileName, examPaperFile)

      if (examUploadError) throw examUploadError

      const { data: examUrlData } = supabase.storage
        .from('pdf-uploads')
        .getPublicUrl(examFileName)

      let answerKeyUrl = null
      if (answerKeyFile) {
        const answerFileName = `answer-keys/${Date.now()}_${answerKeyFile.name}`
        const { error: answerUploadError } = await supabase.storage
          .from('pdf-uploads')
          .upload(answerFileName, answerKeyFile)

        if (answerUploadError) throw answerUploadError

        const { data: answerUrlData } = supabase.storage
          .from('pdf-uploads')
          .getPublicUrl(answerFileName)

        answerKeyUrl = answerUrlData.publicUrl
      }

      const { error: dbError } = await supabase
        .from('pdf_uploads')
        .insert({
          board,
          grade,
          subject,
          year: year || null,
          exam_type: examType,
          exam_paper_pdf: examUrlData.publicUrl,
          answer_key_pdf: answerKeyUrl,
        })

      if (dbError) throw dbError

      showStatus('PDF uploaded successfully!', 'success')
      setExamPaperFile(null)
      setAnswerKeyFile(null)
      setYear('')
    } catch (err) {
      showStatus(`Upload failed: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-content">
      <h2>Exam Paper Uploads</h2>

      <div className="form-panel">
        <div className="form-group">
          <label>Paper Type</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: paperType === 'exam_paper' ? '600' : '400', color: paperType === 'exam_paper' ? '#4a6e6a' : '#6b8a80' }}>
              <input
                type="radio"
                name="paperType"
                value="exam_paper"
                checked={paperType === 'exam_paper'}
                onChange={() => setPaperType('exam_paper')}
              />
              Exam Paper
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: paperType === 'sample_paper' ? '600' : '400', color: paperType === 'sample_paper' ? '#4a6e6a' : '#6b8a80' }}>
              <input
                type="radio"
                name="paperType"
                value="sample_paper"
                checked={paperType === 'sample_paper'}
                onChange={() => setPaperType('sample_paper')}
              />
              Sample Paper
            </label>
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
              <input
                type="text"
                placeholder="e.g. 2024"
                value={year}
                onChange={e => setYear(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>{paperType === 'exam_paper' ? 'Exam Paper PDF *' : 'Sample Paper PDF *'}</label>
            <label className={`file-input-label ${examPaperFile ? 'has-file' : ''}`}>
              {examPaperFile ? examPaperFile.name : 'Click to select PDF'}
              <input
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={e => setExamPaperFile(e.target.files[0] || null)}
              />
            </label>
          </div>

          <div className="form-group">
            <label>Answer Key PDF (optional)</label>
            <label className={`file-input-label ${answerKeyFile ? 'has-file' : ''}`}>
              {answerKeyFile ? answerKeyFile.name : 'Click to select PDF'}
              <input
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={e => setAnswerKeyFile(e.target.files[0] || null)}
              />
            </label>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      </div>
    </div>
  )
}
