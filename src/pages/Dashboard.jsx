import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function Dashboard() {
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [drillPath, setDrillPath] = useState([]) // [{type: 'exam', value: '10th CBSE Board'}, ...]

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${API_BASE}/api/stats`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      })
      const result = await response.json()
      if (result.success) {
        setStats(result.stats)
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  function getTypeBadge(type, count) {
    const colors = {
      mcq: { bg: '#e8f5e9', color: '#2e7d32', label: 'MCQ' },
      short: { bg: '#fff3e0', color: '#e65100', label: 'Short' },
      long: { bg: '#e3f2fd', color: '#1565c0', label: 'Long' },
    }
    const style = colors[type] || { bg: '#f5f5f5', color: '#666', label: type }
    return (
      <span key={type} className="type-badge" style={{ background: style.bg, color: style.color }}>
        {style.label}: {count}
      </span>
    )
  }

  // Filter stats based on current drill path
  function getFilteredStats() {
    let filtered = stats
    for (const crumb of drillPath) {
      if (crumb.type === 'exam') filtered = filtered.filter(s => s.exam === crumb.value)
      if (crumb.type === 'subject') filtered = filtered.filter(s => s.subject === crumb.value)
    }
    return filtered
  }

  function getCurrentLevel() {
    if (drillPath.length === 0) return 'exam'
    if (drillPath.length === 1) return 'subject'
    return 'chapter'
  }

  function drillInto(type, value) {
    setDrillPath([...drillPath, { type, value }])
  }

  function navigateTo(index) {
    setDrillPath(drillPath.slice(0, index))
  }

  function renderCards() {
    const filtered = getFilteredStats()
    const level = getCurrentLevel()

    // Group by current level
    const groups = {}
    for (const row of filtered) {
      const key = row[level]
      if (!groups[key]) groups[key] = { mcq: 0, short: 0, long: 0, total: 0 }
      groups[key][row.question_type] = (groups[key][row.question_type] || 0) + row.count
      groups[key].total += row.count
    }

    const entries = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))

    if (entries.length === 0) {
      return <div className="empty-state">No questions found at this level.</div>
    }

    return (
      <div className="dashboard-grid">
        {entries.map(([name, counts]) => (
          <div
            key={name}
            className={`stat-card ${level !== 'chapter' ? 'clickable' : ''}`}
            onClick={() => level !== 'chapter' && drillInto(level, name)}
          >
            <div className="stat-card-header">
              <h3>{name}</h3>
              {level !== 'chapter' && <span className="drill-arrow">&rarr;</span>}
            </div>
            <div className="stat-card-total">{counts.total} questions</div>
            <div className="stat-card-types">
              {counts.mcq > 0 && getTypeBadge('mcq', counts.mcq)}
              {counts.short > 0 && getTypeBadge('short', counts.short)}
              {counts.long > 0 && getTypeBadge('long', counts.long)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Summary stats
  function getSummary() {
    const filtered = getFilteredStats()
    const total = filtered.reduce((sum, r) => sum + r.count, 0)
    const mcq = filtered.filter(r => r.question_type === 'mcq').reduce((sum, r) => sum + r.count, 0)
    const short = filtered.filter(r => r.question_type === 'short').reduce((sum, r) => sum + r.count, 0)
    const long = filtered.filter(r => r.question_type === 'long').reduce((sum, r) => sum + r.count, 0)
    const level = getCurrentLevel()
    const uniqueCount = new Set(filtered.map(r => r[level])).size
    return { total, mcq, short, long, uniqueCount }
  }

  if (loading) {
    return <div className="content-loading">Loading dashboard...</div>
  }

  const summary = getSummary()

  return (
    <div className="dashboard-content">
      <h2>Question Inventory</h2>

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span
          className={`breadcrumb-item ${drillPath.length > 0 ? 'clickable' : 'active'}`}
          onClick={() => navigateTo(0)}
        >
          All Exams
        </span>
        {drillPath.map((crumb, i) => (
          <span key={i}>
            <span className="breadcrumb-sep">/</span>
            <span
              className={`breadcrumb-item ${i < drillPath.length - 1 ? 'clickable' : 'active'}`}
              onClick={() => navigateTo(i + 1)}
            >
              {crumb.value}
            </span>
          </span>
        ))}
      </div>

      {/* Summary row */}
      <div className="summary-row">
        <div className="summary-card summary-total">
          <div className="summary-number">{summary.total}</div>
          <div className="summary-label">Total Questions</div>
        </div>
        <div className="summary-card summary-mcq">
          <div className="summary-number">{summary.mcq}</div>
          <div className="summary-label">MCQ</div>
        </div>
        <div className="summary-card summary-short">
          <div className="summary-number">{summary.short}</div>
          <div className="summary-label">Short Answer</div>
        </div>
        <div className="summary-card summary-long">
          <div className="summary-number">{summary.long}</div>
          <div className="summary-label">Long Answer</div>
        </div>
      </div>

      {/* Cards */}
      {renderCards()}
    </div>
  )
}
