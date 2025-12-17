import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../../lib/auth'
import aimlApi from '../../../lib/aiml/api'
import Link from 'next/link'

interface Test {
  id: string
  title: string
  description: string
  duration_minutes: number
  is_published: boolean
  test_token?: string
  created_at?: string
  pausedAt?: string
}

// Helper function to get test status
const getTestStatus = (test: Test): 'draft' | 'active' | 'paused' => {
  if (test.pausedAt) {
    return 'paused'
  } else if (test.is_published) {
    return 'active'
  } else {
    return 'draft'
  }
}

// Helper function to get status badge colors
const getStatusColors = (status: 'draft' | 'active' | 'paused') => {
  switch (status) {
    case 'active':
      return { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' }
    case 'paused':
      return { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' }
    case 'draft':
      return { bg: 'rgba(201, 244, 212, 0.2)', text: '#1E5A3B', border: '#C9F4D4' }
    default:
      return { bg: 'rgba(201, 244, 212, 0.2)', text: '#1E5A3B', border: '#C9F4D4' }
  }
}

export default function AIMLTestsListPage() {
  const router = useRouter()
  const [tests, setTests] = useState<Test[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pausingId, setPausingId] = useState<string | null>(null)
  const [resumingId, setResumingId] = useState<string | null>(null)

  useEffect(() => {
    fetchTests()
  }, [])

  const fetchTests = async () => {
    try {
      setLoading(true)
      const response = await aimlApi.get('/tests/')
      setTests(response.data || [])
    } catch (error) {
      console.error('Error fetching tests:', error)
      alert('Failed to fetch tests')
    } finally {
      setLoading(false)
    }
  }

  const handlePublish = async (testId: string, currentStatus: boolean) => {
    try {
      const newStatus = !currentStatus
      await aimlApi.patch(`/tests/${testId}/publish?is_published=${newStatus}`)
      setTests(tests.map(t => 
        t.id === testId ? { ...t, is_published: newStatus } : t
      ))
      alert(`Test ${newStatus ? 'published' : 'unpublished'} successfully!`)
      // Refresh to get updated test_token
      fetchTests()
    } catch (error: any) {
      console.error('Publish error:', error)
      alert(error.response?.data?.detail || 'Failed to update publish status')
    }
  }

  const handleDelete = async (testId: string) => {
    if (!confirm('Are you sure you want to delete this test? This action cannot be undone.')) {
      return
    }

    setDeletingId(testId)
    try {
      await aimlApi.delete(`/tests/${testId}`)
      setTests(tests.filter(t => t.id !== testId))
      alert('Test deleted successfully!')
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to delete test')
    } finally {
      setDeletingId(null)
    }
  }

  const handlePauseTest = async (testId: string) => {
    setPausingId(testId)
    try {
      await aimlApi.post(`/tests/${testId}/pause`)
      alert('Test paused successfully')
      await fetchTests()
    } catch (error: any) {
      alert(error.response?.data?.detail || error.response?.data?.message || 'Failed to pause test')
    } finally {
      setPausingId(null)
    }
  }

  const handleResumeTest = async (testId: string) => {
    setResumingId(testId)
    try {
      await aimlApi.post(`/tests/${testId}/resume`)
      alert('Test resumed successfully')
      await fetchTests()
    } catch (error: any) {
      alert(error.response?.data?.detail || error.response?.data?.message || 'Failed to resume test')
    } finally {
      setResumingId(null)
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A'
    try {
      return new Date(dateString).toLocaleDateString()
    } catch {
      return 'N/A'
    }
  }

  if (loading) {
    return (
      <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
        <div className="container" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
          <div style={{ textAlign: "center" }}>Loading tests...</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <div className="container" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/aiml")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            ← Back
          </button>
        </div>

        <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0, color: "#1a1625" }}>AIML Tests</h1>
          <Link href="/aiml/create">
            <button className="btn-primary" style={{ padding: "0.5rem 1rem" }}>
              + Create Test
            </button>
          </Link>
        </div>

        <div className="card">
          {tests.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>
              <p>No tests found. Create your first test!</p>
              <Link href="/aiml/create">
                <button className="btn-primary" style={{ marginTop: "1rem" }}>
                  Create Test
                </button>
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {tests.map((test) => (
                <div
                  key={test.id}
                  style={{
                    padding: "1.5rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.75rem" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                        <h3 style={{ margin: 0, color: "#1a1625", fontSize: "1.25rem", fontWeight: 600 }}>
                          {test.title}
                        </h3>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <span
                            style={{
                              padding: "0.375rem 0.75rem",
                              borderRadius: "0.375rem",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                              color: "#1E5A3B",
                              backgroundColor: "#C9F4D4",
                            }}
                          >
                            AIML
                          </span>
                          {(() => {
                            const status = getTestStatus(test)
                            const colors = getStatusColors(status)
                            return (
                              <span
                                style={{
                                  padding: "0.375rem 0.75rem",
                                  borderRadius: "0.375rem",
                                  fontSize: "0.8125rem",
                                  fontWeight: 600,
                                  backgroundColor: colors.bg,
                                  color: colors.text,
                                  border: `1px solid ${colors.border}`,
                                  textTransform: 'capitalize',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.375rem'
                                }}
                              >
                                {status === 'paused' && '⏸️'}
                                {status}
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                      <p style={{ margin: 0, marginBottom: "0.5rem", color: "#64748b", fontSize: "0.875rem" }}>
                        {test.description || "No description"}
                      </p>
                      {test.created_at && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
                          <span>🕐</span>
                          <span>Created: {formatDate(test.created_at)}</span>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.375rem",
                            padding: "0.25rem 0.75rem",
                            borderRadius: "0.375rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            color: test.is_published ? "#059669" : "#6B7280",
                            backgroundColor: test.is_published ? "#D1FAE5" : "#F3F4F6",
                          }}
                        >
                          <span style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: test.is_published ? "#059669" : "#6B7280",
                          }}></span>
                          {test.is_published ? "Scheduled" : "Not Scheduled"}
                        </span>
                        <span
                          style={{
                            padding: "0.25rem 0.75rem",
                            borderRadius: "0.375rem",
                            fontSize: "0.875rem",
                            color: "#64748b",
                            backgroundColor: "#F3F4F6",
                          }}
                        >
                          ⏱️ {test.duration_minutes} minutes
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                    {(() => {
                      const status = getTestStatus(test)
                      return (
                        <>
                          {/* Analytics button: Show only when active */}
                          {status === 'active' && (
                            <Link href={`/aiml/tests/${test.id}/analytics`}>
                              <button 
                                className="btn-secondary" 
                                style={{ 
                                  padding: "0.75rem 1.5rem", 
                                  fontSize: "0.875rem",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                  borderRadius: "0.5rem",
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="20" x2="18" y2="10" />
                                  <line x1="12" y1="20" x2="12" y2="4" />
                                  <line x1="6" y1="20" x2="6" y2="14" />
                                </svg>
                                Analytics
                              </button>
                            </Link>
                          )}
                          {/* Edit button: Show when paused or draft */}
                          {(status === 'paused' || status === 'draft') && (
                            <Link href={`/aiml/tests/${test.id}/edit`}>
                              <button 
                                className="btn-secondary" 
                                style={{ 
                                  padding: "0.75rem 1.5rem", 
                                  fontSize: "0.875rem",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                  borderRadius: "0.5rem",
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                                Edit
                              </button>
                            </Link>
                          )}
                          {/* Pause button: Show when active */}
                          {status === 'active' && (
                            <button
                              onClick={() => handlePauseTest(test.id)}
                              disabled={pausingId === test.id || resumingId === test.id}
                              className="btn-secondary"
                              style={{
                                padding: "0.75rem 1.5rem",
                                fontSize: "0.875rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                borderRadius: "0.5rem",
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="6" y="4" width="4" height="16" />
                                <rect x="14" y="4" width="4" height="16" />
                              </svg>
                              {pausingId === test.id ? 'Pausing...' : 'Pause'}
                            </button>
                          )}
                          {/* Resume button: Show when paused */}
                          {status === 'paused' && (
                            <button
                              onClick={() => handleResumeTest(test.id)}
                              disabled={pausingId === test.id || resumingId === test.id}
                              className="btn-secondary"
                              style={{
                                padding: "0.75rem 1.5rem",
                                fontSize: "0.875rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                borderRadius: "0.5rem",
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3" />
                              </svg>
                              {resumingId === test.id ? 'Resuming...' : 'Resume'}
                            </button>
                          )}
                        </>
                      )
                    })()}
                    <button
                      onClick={() => handleDelete(test.id)}
                      disabled={deletingId === test.id}
                      style={{
                        padding: "0.75rem 1.5rem",
                        fontSize: "0.875rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        borderRadius: "0.5rem",
                        backgroundColor: "#EF4444",
                        color: "#ffffff",
                        border: "none",
                        cursor: deletingId === test.id ? "not-allowed" : "pointer",
                        opacity: deletingId === test.id ? 0.6 : 1,
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      {deletingId === test.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const getServerSideProps: GetServerSideProps = requireAuth




