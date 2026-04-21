import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Dashboard from './Dashboard'
import GenerateQuestions from './GenerateQuestions'
import RetrieveQuestions from './RetrieveQuestions'
import ExamPaperUploads from './ExamPaperUploads'
import ExamPaperRetrieve from './ExamPaperRetrieve'
import RetrieveChapterPdfs from './RetrieveChapterPdfs'
import ReferenceUploads from './ReferenceUploads'
import ErrorLog from './ErrorLog'

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [status, setStatus] = useState(null)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email || '')
    })
  }, [])

  function showStatus(message, type) {
    setStatus({ message, type })
    setTimeout(() => setStatus(null), 5000)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '\u2302' },
    { id: 'generate', label: 'Generate Questions', icon: '\u2B06' },
    { id: 'retrieve', label: 'Retrieve Questions', icon: '\u2B07' },
    { id: 'exam-uploads', label: 'Exam Paper Uploads', icon: '\u{1F4C4}' },
    { id: 'exam-retrieve', label: 'Exam Paper Retrieve', icon: '\u{1F50D}' },
    { id: 'chapter-retrieve', label: 'Retrieve Chapter PDFs', icon: '\u{1F4DA}' },
    { id: 'reference-uploads', label: 'Reference Uploads', icon: '\u{1F4D6}' },
    { id: 'error-log', label: 'Error Log', icon: '\u26A0' },
  ]

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>XamBuddy</h1>
        </div>

        <nav className="sidebar-nav">
          {menuItems.map(item => (
            <button
              key={item.id}
              className={`sidebar-link ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">{userEmail}</div>
          <button className="sidebar-logout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        {status && (
          <div className={`status-message status-${status.type}`}>
            {status.message}
          </div>
        )}

        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'generate' && <GenerateQuestions showStatus={showStatus} />}
        {activeTab === 'retrieve' && <RetrieveQuestions showStatus={showStatus} />}
        {activeTab === 'exam-uploads' && <ExamPaperUploads showStatus={showStatus} />}
        {activeTab === 'exam-retrieve' && <ExamPaperRetrieve showStatus={showStatus} />}
        {activeTab === 'chapter-retrieve' && <RetrieveChapterPdfs showStatus={showStatus} />}
        {activeTab === 'reference-uploads' && <ReferenceUploads showStatus={showStatus} />}
        {activeTab === 'error-log' && <ErrorLog showStatus={showStatus} />}
      </main>
    </div>
  )
}
