import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function ErrorLog({ showStatus }) {
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchErrors() }, [])

  async function fetchErrors() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/errors?limit=100`)
      const data = await res.json()
      setErrors(data.errors || [])
    } catch (err) {
      showStatus(`Could not load errors: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-content">
      <h2>Error Log</h2>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ color: '#6b8a80', fontSize: '14px', margin: 0 }}>
          Failed uploads and processing errors logged by the system.
        </p>
        <button onClick={fetchErrors} style={{ background: 'none', border: '1px solid #4a6e6a', color: '#4a6e6a', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
          Refresh
        </button>
      </div>

      {loading ? <p>Loading...</p> : errors.length === 0 ? (
        <p style={{ color: '#6b8a80' }}>No errors logged.</p>
      ) : (
        <div>
          {errors.map(err => (
            <div key={err.id} className="form-panel" style={{ marginBottom: '10px', borderLeft: '4px solid #c0392b' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                <span style={{ background: '#fdecea', color: '#c0392b', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>{err.endpoint}</span>
                <span style={{ background: '#e8f0ee', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{err.stage}</span>
                <span style={{ color: '#6b8a80', fontSize: '12px', marginLeft: 'auto' }}>{new Date(err.created_at).toLocaleString()}</span>
              </div>
              <p style={{ fontSize: '14px', color: '#333', marginBottom: err.context_json ? '6px' : 0 }}>{err.error_message}</p>
              {err.context_json && Object.keys(err.context_json).length > 0 && (
                <p style={{ fontSize: '12px', color: '#6b8a80', fontFamily: 'monospace', margin: 0 }}>
                  {JSON.stringify(err.context_json)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
