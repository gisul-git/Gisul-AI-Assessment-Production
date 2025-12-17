import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../../../lib/auth'
import Link from 'next/link'
import aimlApi from '../../../../lib/aiml/api'
import { ArrowLeft, Lightbulb, CheckCircle2, TrendingUp, AlertTriangle, Eye, Clock } from 'lucide-react'

interface AIFeedback {
  overall_score: number
  feedback_summary: string
  one_liner: string
  code_quality?: { score: number; comments: string }
  correctness?: { score: number; comments: string }
  task_completion?: { completed: number; total: number; details: string[] }
  library_usage?: { score: number; comments: string }
  output_quality?: { score: number; comments: string }
  strengths?: string[]
  areas_for_improvement?: string[]
  suggestions?: string[]
  deduction_reasons?: string[]
  ai_generated?: boolean
}

interface QuestionAnalytics {
  question_id: string
  question_title: string
  description?: string
  tasks?: string[]
  difficulty?: string
  language: string
  status?: string
  code: string
  outputs: string[]
  submitted_at: string | null
  created_at: string | null
  score?: number
  ai_feedback?: AIFeedback
}

interface CandidateAnalytics {
  candidate: {
    name: string
    email: string
  }
  submission: {
    score: number
    started_at: string | null
    submitted_at: string | null
    is_completed: boolean
    ai_feedback_status?: string
    evaluations?: Array<{
      question_id: string
      question_title: string
      score: number
      feedback: AIFeedback
    }>
  } | null
  question_analytics: QuestionAnalytics[]
  activity_logs: any[]
}

interface Candidate {
  user_id: string
  name: string
  email: string
  has_submitted?: boolean
  submission_score?: number
  created_at?: string
  submitted_at?: string
  status?: string // 'pending' | 'invited' | 'started' | 'completed'
}

export default function AnalyticsPage() {
  const router = useRouter()
  const { id: testId, candidate: candidateUserId } = router.query
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<CandidateAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [proctorLogs, setProctorLogs] = useState<any[]>([])
  const [eventTypeLabels, setEventTypeLabels] = useState<Record<string, string>>({})
  const [loadingProctorLogs, setLoadingProctorLogs] = useState(false)
  const [showProctorLogs, setShowProctorLogs] = useState(false)
  const [showAddCandidateModal, setShowAddCandidateModal] = useState(false)
  const [newCandidateName, setNewCandidateName] = useState("")
  const [newCandidateEmail, setNewCandidateEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [addingCandidate, setAddingCandidate] = useState(false)
  const [testInfo, setTestInfo] = useState<any>(null)
  const [showEmailTemplateModal, setShowEmailTemplateModal] = useState(false)
  const [emailTemplate, setEmailTemplate] = useState({
    logoUrl: "",
    companyName: "",
    message: "You have been invited to take an AIML test. Please click the link below to start.",
    footer: "",
    sentBy: "AI Assessment Platform"
  })
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [sendingInvitations, setSendingInvitations] = useState(false)

  const fetchProctorLogs = async (userKey: string) => {
    if (!testId || typeof testId !== 'string') return
    if (!userKey) return

    setLoadingProctorLogs(true)
    try {
      const response = await fetch(
        `/api/proctor/logs?assessmentId=${encodeURIComponent(testId)}&userId=${encodeURIComponent(userKey)}`
      )
      const data = await response.json()

      if (data.success && data.data) {
        setProctorLogs(data.data.logs || [])
        setEventTypeLabels(data.data.eventTypeLabels || {})
        // Auto-show logs when available (candidate expects to see violations without extra click)
        if ((data.data.logs || []).length > 0) {
          setShowProctorLogs(true)
        }
      } else {
        setProctorLogs([])
        setEventTypeLabels({})
      }
    } catch (error) {
      console.error('Error fetching proctor logs:', error)
      setProctorLogs([])
      setEventTypeLabels({})
    } finally {
      setLoadingProctorLogs(false)
    }
  }

  const fetchAnalytics = async (userId: string) => {
    if (!testId || typeof testId !== 'string') return
    
    setLoadingAnalytics(true)
    try {
      const response = await aimlApi.get(`/tests/${testId}/candidates/${userId}/analytics`)
      setAnalytics(response.data)
      // Proctor logs are keyed by the same identifier used by /api/proctor/record.
      // For AIML we record with candidate email (preferred) and fall back to userId.
      const email = response.data?.candidate?.email
      await fetchProctorLogs(email || userId)
      // Ensure UI is ready to display logs for newly selected candidate
      setShowProctorLogs(true)
    } catch (error) {
      console.error('Error fetching analytics:', error)
      alert('Failed to load analytics')
    } finally {
      setLoadingAnalytics(false)
    }
  }

  useEffect(() => {
    if (!testId || typeof testId !== 'string') return

    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch test info
        try {
          const testResponse = await aimlApi.get(`/tests/${testId}`)
          setTestInfo(testResponse.data)
          
          // Load email template if exists, otherwise use default
          if (testResponse.data?.invitationTemplate) {
            setEmailTemplate(testResponse.data.invitationTemplate)
          } else {
            // Use default template
            setEmailTemplate({
              logoUrl: "",
              companyName: "",
              message: "You have been invited to take an AIML test. Please click the link below to start.",
              footer: "",
              sentBy: "AI Assessment Platform"
            })
          }
        } catch (error) {
          console.error('Error fetching test info:', error)
        }
        
        // Fetch candidates
        const response = await aimlApi.get(`/tests/${testId}/candidates`)
        setCandidates(response.data || [])
        
        // If candidate query param is set, load that candidate's analytics
        if (candidateUserId && typeof candidateUserId === 'string') {
          setSelectedCandidate(candidateUserId)
          fetchAnalytics(candidateUserId)
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        alert('Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [testId, candidateUserId])

  const handleCandidateSelect = (userId: string) => {
    setSelectedCandidate(userId)
    fetchAnalytics(userId)
    // Scroll to top of analytics content when candidate is selected
    setTimeout(() => {
      const analyticsContent = document.querySelector('[data-analytics-content]')
      if (analyticsContent) {
        analyticsContent.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 100)
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }
    return date.toLocaleString('en-US', options)
  }

  const formatViolationDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }

  const validateEmail = (email: string): boolean => {
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    return emailPattern.test(email)
  }

  const handleAddCandidate = async () => {
    if (!testId || typeof testId !== 'string') return
    
    // Validate email
    if (!validateEmail(newCandidateEmail.trim())) {
      setEmailError("Please enter a valid email address.")
      return
    }
    
    if (!newCandidateName.trim()) {
      setEmailError("Please enter a candidate name.")
      return
    }
    
    setEmailError(null)
    setAddingCandidate(true)
    
    try {
      const response = await aimlApi.post(`/tests/${testId}/add-candidate`, {
        name: newCandidateName.trim(),
        email: newCandidateEmail.trim(),
      })
      
      if (response.data) {
        // Refresh candidates list
        const candidatesResponse = await aimlApi.get(`/tests/${testId}/candidates`)
        setCandidates(candidatesResponse.data || [])
        
        // Close modal and reset form
        setShowAddCandidateModal(false)
        setNewCandidateName("")
        setNewCandidateEmail("")
        setEmailError(null)
        alert("Candidate added successfully!")
      }
    } catch (err: any) {
      setEmailError(err.response?.data?.detail || err.response?.data?.message || "Failed to add candidate")
    } finally {
      setAddingCandidate(false)
    }
  }

  const handleResendInvitation = async (email: string) => {
    if (!testId || typeof testId !== 'string') return
    
    try {
      const candidate = candidates.find(c => c.email === email)
      if (!candidate) {
        alert("Candidate not found")
        return
      }
      
      const response = await aimlApi.post(`/tests/${testId}/add-candidate`, {
        name: candidate.name,
        email: candidate.email,
      })
      
      if (response.data) {
        alert("Invitation resent successfully!")
        // Refresh candidates list
        const candidatesResponse = await aimlApi.get(`/tests/${testId}/candidates`)
        setCandidates(candidatesResponse.data || [])
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || err.response?.data?.message || "Failed to resend invitation")
    }
  }

  const handleRemoveCandidate = async (userId: string) => {
    if (!testId || typeof testId !== 'string') return
    const candidate = candidates.find(c => c.user_id === userId)
    if (!candidate) return
    if (!confirm(`Are you sure you want to remove ${candidate.name} (${candidate.email}) from this test?`)) return
    
    try {
      await aimlApi.delete(`/tests/${testId}/candidates/${userId}`)
      // Refresh candidates list
      const candidatesResponse = await aimlApi.get(`/tests/${testId}/candidates`)
      setCandidates(candidatesResponse.data || [])
      // Clear selection if removed candidate was selected
      if (selectedCandidate === userId) {
        setSelectedCandidate(null)
        setAnalytics(null)
      }
      alert("Candidate removed successfully!")
    } catch (err: any) {
      alert(err.response?.data?.detail || err.response?.data?.message || "Failed to remove candidate")
    }
  }

  const handleSaveEmailTemplate = async () => {
    if (!testId || typeof testId !== 'string') return
    
    setSavingTemplate(true)
    try {
      // Update test with email template
      await aimlApi.patch(`/tests/${testId}`, {
        invitationTemplate: emailTemplate
      })
      
      // Update local test info
      setTestInfo((prev: any) => ({
        ...prev,
        invitationTemplate: emailTemplate
      }))
      
      setShowEmailTemplateModal(false)
      alert("Email template saved successfully!")
    } catch (err: any) {
      alert(err.response?.data?.detail || err.response?.data?.message || "Failed to save email template")
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleSendInvitationsToAll = async () => {
    if (!testId || typeof testId !== 'string') return
    
    if (candidates.length === 0) {
      alert("No candidates to send invitations to.")
      return
    }
    
    if (!confirm(`Send invitation emails to all ${candidates.length} candidates?`)) {
      return
    }
    
    setSendingInvitations(true)
    try {
      const response = await aimlApi.post(`/tests/${testId}/send-invitations-to-all`)
      
      if (response.data) {
        const successCount = response.data.success_count || 0
        const failedCount = response.data.failed_count || 0
        
        // Refresh candidates list to show updated statuses
        const candidatesResponse = await aimlApi.get(`/tests/${testId}/candidates`)
        setCandidates(candidatesResponse.data || [])
        
        if (failedCount === 0) {
          alert(`Successfully sent invitation emails to all ${successCount} candidates!`)
        } else {
          alert(
            `Invitation emails sent:\n` +
            `✓ Success: ${successCount}\n` +
            `✗ Failed: ${failedCount}\n\n` +
            `Check the console for details.`
          )
          console.error("Failed emails:", response.data.failed)
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || err.response?.data?.message || "Failed to send invitation emails")
    } finally {
      setSendingInvitations(false)
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  // Calculate overall statistics
  const submittedCandidates = candidates.filter(c => c.has_submitted)
  const totalCandidates = candidates.length
  const submittedCount = submittedCandidates.length
  const avgScore = submittedCount > 0
    ? submittedCandidates.reduce((sum, c) => sum + (c.submission_score || 0), 0) / submittedCount
    : 0
  const passedCount = submittedCandidates.filter(c => (c.submission_score || 0) >= 60).length
  const failedCount = submittedCandidates.filter(c => (c.submission_score || 0) < 60).length

  return (
    <div className="container">
      <div className="card">
        {/* Back Button */}
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/dashboard")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            AIML Test Analytics
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            {testInfo?.title || 'AIML Test'} - View detailed analytics and AI feedback
          </p>
        </div>

        {/* Test Access & Email Template Section */}
        {testInfo && (
          <div style={{ 
            marginBottom: "2rem", 
            padding: "1.5rem", 
            backgroundColor: "#f8fafc", 
            borderRadius: "0.75rem", 
            border: "1px solid #e2e8f0" 
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 0 }}>
                Test Access & Email Settings
              </h2>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowEmailTemplateModal(true)}
                style={{ 
                  padding: "0.5rem 1rem", 
                  fontSize: "0.875rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem"
                }}
              >
                ✏️ Edit Email Template
              </button>
            </div>
            <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "1rem" }}>
              {testInfo.invitationTemplate ? (
                <span style={{ color: "#10b981" }}>✓ Custom email template is configured</span>
              ) : (
                <span>Using system default email template</span>
              )}
            </div>
            
            {/* Test URL */}
            {testInfo.test_token && testId && (
              <div style={{ marginTop: "1.5rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Test URL
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/aiml/test/${testId}?token=${testInfo.test_token}`}
                    readOnly
                    style={{
                      flex: 1,
                      padding: "0.75rem",
                      border: "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      backgroundColor: "#ffffff",
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const testUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/aiml/test/${testId}?token=${testInfo.test_token}`;
                      navigator.clipboard.writeText(testUrl);
                      alert("Test URL copied to clipboard!");
                    }}
                    style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                  >
                    Copy URL
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Candidates Management Section */}
        <div style={{ 
          marginBottom: "2rem", 
          padding: "1.5rem", 
          backgroundColor: "#ffffff", 
          borderRadius: "0.75rem", 
          border: "1px solid #e2e8f0" 
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Candidates</h2>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {candidates.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleSendInvitationsToAll}
                  disabled={sendingInvitations}
                  style={{ 
                    padding: "0.5rem 1rem", 
                    fontSize: "0.875rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem"
                  }}
                >
                  {sendingInvitations ? "Sending..." : "📧 Send Email to All"}
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowAddCandidateModal(true)}
                style={{ 
                  padding: "0.5rem 1rem", 
                  fontSize: "0.875rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem"
                }}
              >
                ➕ Add Candidate
              </button>
            </div>
          </div>
          
          {candidates.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "0.875rem" }}>No candidates added yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Email</th>
                    <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Name</th>
                    <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Status</th>
                    <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.user_id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>{candidate.email}</td>
                      <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>{candidate.name}</td>
                      <td style={{ padding: "0.75rem" }}>
                        <span style={{
                          padding: "0.25rem 0.75rem",
                          borderRadius: "9999px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          backgroundColor: 
                            candidate.status === "completed" ? "#d1fae5" :
                            candidate.status === "started" ? "#dbeafe" :
                            candidate.status === "invited" ? "#fef3c7" :
                            "#f3f4f6",
                          color: 
                            candidate.status === "completed" ? "#065f46" :
                            candidate.status === "started" ? "#1e40af" :
                            candidate.status === "invited" ? "#92400e" :
                            "#374151",
                        }}>
                          {candidate.status || (candidate.has_submitted ? "completed" : "pending")}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleResendInvitation(candidate.email)}
                          style={{
                            padding: "0.25rem 0.75rem",
                            fontSize: "0.75rem",
                            backgroundColor: "#10b981",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "0.375rem",
                            cursor: "pointer",
                          }}
                        >
                          Resend Invitation
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveCandidate(candidate.user_id)}
                          style={{
                            padding: "0.25rem 0.75rem",
                            fontSize: "0.75rem",
                            backgroundColor: "#ef4444",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "0.375rem",
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
          {/* Candidate List Sidebar */}
          <div>
            <div style={{
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              padding: "1rem",
              backgroundColor: "#ffffff",
            }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem" }}>Candidates</h2>
              <button
                onClick={() => {
                  setSelectedCandidate(null)
                  setAnalytics(null)
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  border: selectedCandidate === null
                    ? "2px solid #3b82f6"
                    : "1px solid #e2e8f0",
                  backgroundColor: selectedCandidate === null
                    ? "#eff6ff"
                    : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  marginBottom: "0.5rem",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
                onMouseEnter={(e) => {
                  if (selectedCandidate !== null) {
                    e.currentTarget.style.backgroundColor = "#f8fafc"
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedCandidate !== null) {
                    e.currentTarget.style.backgroundColor = "#ffffff"
                  }
                }}
              >
                📊 Overall Analytics
              </button>
              {candidates.length === 0 ? (
                <p style={{ fontSize: "0.875rem", color: "#64748b" }}>
                  No candidates found
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.user_id}
                      onClick={() => handleCandidateSelect(candidate.user_id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.75rem",
                        borderRadius: "0.5rem",
                        border: selectedCandidate === candidate.user_id
                          ? "2px solid #3b82f6"
                          : "1px solid #e2e8f0",
                        backgroundColor: selectedCandidate === candidate.user_id
                          ? "#eff6ff"
                          : "#ffffff",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (selectedCandidate !== candidate.user_id) {
                          e.currentTarget.style.backgroundColor = "#f8fafc"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedCandidate !== candidate.user_id) {
                          e.currentTarget.style.backgroundColor = "#ffffff"
                        }
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{candidate.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                        {candidate.email}
                      </div>
                      {candidate.has_submitted && (
                        <div style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "0.25rem", fontWeight: 600 }}>
                          Score: {candidate.submission_score || 0}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Analytics Content */}
          <div data-analytics-content>
            {loadingAnalytics ? (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "3rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
              }}>
                <div>Loading analytics...</div>
              </div>
            ) : !selectedCandidate ? (
              // Overall Analytics View
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
                    Overall Test Performance
                  </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Total Candidates</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{totalCandidates}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Submitted</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {submittedCount} / {totalCandidates}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Average Score</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {avgScore.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Passed</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{passedCount}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginTop: "1rem" }}>
                    <div style={{
                      padding: "1rem",
                      backgroundColor: "#d1fae5",
                      borderRadius: "0.5rem",
                      border: "1px solid #10b981",
                    }}>
                      <div style={{ fontSize: "0.875rem", color: "#065f46", marginBottom: "0.25rem", fontWeight: 600 }}>Passed</div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#059669" }}>{passedCount}</div>
                    </div>
                    <div style={{
                      padding: "1rem",
                      backgroundColor: "#fee2e2",
                      borderRadius: "0.5rem",
                      border: "1px solid #ef4444",
                    }}>
                      <div style={{ fontSize: "0.875rem", color: "#991b1b", marginBottom: "0.25rem", fontWeight: 600 }}>Failed</div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#dc2626" }}>{failedCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : !analytics ? (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "3rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
              }}>
                <p style={{ color: "#64748b" }}>Select a candidate to view their analytics</p>
              </div>
            ) : !analytics.submission ? (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "3rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
              }}>
                <p style={{ color: "#64748b" }}>
                  {analytics.candidate.name} has not submitted the test yet.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                {/* Candidate Information */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
                    Candidate Information
                  </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Name</div>
                      <div style={{ fontSize: "1rem", fontWeight: 600 }}>{analytics.candidate.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Email</div>
                      <div style={{ fontSize: "1rem", fontWeight: 600 }}>{analytics.candidate.email}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Total Score</div>
                      <div style={{ 
                        fontSize: "1.5rem", 
                        fontWeight: 700,
                        color: analytics.submission.score >= 70 ? "#166534" : analytics.submission.score >= 50 ? "#92400e" : "#991b1b"
                      }}>
                        {analytics.submission.score}/100
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Started</div>
                      <div style={{ fontSize: "1rem" }}>{formatDate(analytics.submission.started_at)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Submitted</div>
                      <div style={{ fontSize: "1rem" }}>{formatDate(analytics.submission.submitted_at)}</div>
                    </div>
                  </div>
                </div>

                {/* Proctoring Logs Section */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <AlertTriangle style={{ width: "20px", height: "20px", color: "#f59e0b" }} />
                      <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Proctoring Logs</h2>
                      {proctorLogs.length > 0 && (
                        <span style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", fontWeight: 600, backgroundColor: "#fee2e2", color: "#991b1b", borderRadius: "9999px" }}>
                          {proctorLogs.length} {proctorLogs.length === 1 ? 'violation' : 'violations'}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowProctorLogs(!showProctorLogs)}
                      disabled={loadingProctorLogs}
                      style={{ marginTop: 0 }}
                    >
                      {loadingProctorLogs ? 'Loading...' : showProctorLogs ? 'Hide Logs' : 'Show Logs'}
                    </button>
                  </div>

                  {loadingProctorLogs ? (
                    <div style={{ textAlign: "center", padding: "1rem", color: "#64748b" }}>
                      Loading proctoring logs...
                    </div>
                  ) : proctorLogs.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "1rem", color: "#64748b" }}>
                      No proctoring violations detected
                    </div>
                  ) : showProctorLogs ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "600px", overflowY: "auto" }}>
                      {proctorLogs.map((log, index) => (
                        <div
                          key={log._id || index}
                          style={{ border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "1rem", backgroundColor: "#fef2f2" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <AlertTriangle style={{ width: "16px", height: "16px", color: "#ef4444", flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: "#991b1b" }}>
                                {eventTypeLabels[log.eventType] || log.eventType || 'Unknown Violation'}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "#64748b" }}>
                              <Clock style={{ width: "12px", height: "12px" }} />
                              <span>{formatViolationDate(log.timestamp)}</span>
                            </div>
                          </div>

                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <div style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Details:</div>
                              <div style={{ backgroundColor: "#1e293b", borderRadius: "0.375rem", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                                {Object.entries(log.metadata).map(([key, value]: any) => (
                                  <div key={key} style={{ marginBottom: "0.25rem" }}>
                                    <span style={{ color: "#94a3b8" }}>{key}:</span>{' '}
                                    <span style={{ color: "#e2e8f0" }}>
                                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {log.snapshotBase64 && (
                            <div style={{ marginTop: "0.75rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.5rem" }}>Evidence Snapshot:</div>
                              <img
                                src={log.snapshotBase64.startsWith("data:") ? log.snapshotBase64 : `data:image/png;base64,${log.snapshotBase64}`}
                                alt="Violation snapshot"
                                style={{ maxWidth: "100%", height: "auto", borderRadius: "0.375rem", border: "1px solid #475569", maxHeight: "200px" }}
                                onError={(e) => {
                                  console.error("Error loading snapshot image:", e);
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Question Analytics */}
                {analytics.question_analytics.map((qa, index) => (
                  <div key={qa.question_id} style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.75rem",
                    padding: "1.5rem",
                    backgroundColor: "#ffffff",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                      <h3 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
                        Question {index + 1}: {qa.question_title}
                      </h3>
                      {qa.score !== undefined && (
                        <span style={{
                          padding: "0.5rem 1rem",
                          borderRadius: "0.5rem",
                          fontSize: "1rem",
                          fontWeight: 700,
                          backgroundColor: qa.score >= 70 ? "#dcfce7" : qa.score >= 50 ? "#fef3c7" : "#fee2e2",
                          color: qa.score >= 70 ? "#166534" : qa.score >= 50 ? "#92400e" : "#991b1b",
                        }}>
                          {qa.score}/100
                        </span>
                      )}
                    </div>

                    {/* Difficulty and Tasks */}
                    {(qa.difficulty || qa.tasks) && (
                      <div style={{ marginBottom: "1rem", padding: "0.75rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem" }}>
                        {qa.difficulty && (
                          <span style={{
                            display: "inline-block",
                            marginRight: "0.75rem",
                            padding: "0.25rem 0.5rem",
                            borderRadius: "0.25rem",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            backgroundColor: qa.difficulty === 'easy' ? "#d1fae5" : qa.difficulty === 'medium' ? "#fef3c7" : "#fee2e2",
                            color: qa.difficulty === 'easy' ? "#065f46" : qa.difficulty === 'medium' ? "#92400e" : "#991b1b",
                          }}>
                            {qa.difficulty.charAt(0).toUpperCase() + qa.difficulty.slice(1)}
                          </span>
                        )}
                        {qa.tasks && qa.tasks.length > 0 && (
                          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                            {qa.tasks.length} task{qa.tasks.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                    
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                      <div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Status</div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 500, color: qa.status === 'evaluated' ? "#059669" : qa.status === 'submitted' ? "#2563eb" : "#dc2626" }}>
                          {qa.status === 'evaluated' ? '✓ Evaluated' : qa.status === 'submitted' ? '⏳ Submitted' : 'Not submitted'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Language</div>
                        <div style={{ fontSize: "0.875rem" }}>{qa.language}</div>
                      </div>
                      {qa.submitted_at && (
                        <div>
                          <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Submitted At</div>
                          <div style={{ fontSize: "0.875rem" }}>{formatDate(qa.submitted_at)}</div>
                        </div>
                      )}
                    </div>

                    {/* Code Display */}
                    {qa.code && (
                      <details style={{ marginTop: "1rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, color: "#64748b" }}>
                          View Code
                        </summary>
                        <pre style={{ marginTop: "0.5rem", padding: "1rem", backgroundColor: "#1e293b", borderRadius: "0.5rem", overflowX: "auto", fontSize: "0.75rem", color: "#e2e8f0" }}>
                          <code>{qa.code}</code>
                        </pre>
                      </details>
                    )}

                    {/* Outputs Display */}
                    {qa.outputs && qa.outputs.length > 0 && (
                      <details style={{ marginTop: "1rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, color: "#64748b" }}>
                          View Outputs ({qa.outputs.length})
                        </summary>
                        <div style={{ marginTop: "0.5rem", padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem" }}>
                          {qa.outputs.map((output, idx) => (
                            <div key={idx} style={{ marginBottom: "0.5rem", padding: "0.5rem", backgroundColor: "#ffffff", borderRadius: "0.375rem", fontSize: "0.875rem" }}>
                              <strong>Output {idx + 1}:</strong>
                              <pre style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{output}</pre>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* AI Feedback Section */}
                    {qa.ai_feedback && (
                      <div style={{ 
                        marginTop: "1.5rem", 
                        padding: "1.5rem", 
                        backgroundColor: "#f0fdf4", 
                        borderRadius: "0.75rem",
                        border: "1px solid #86efac"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                          <Lightbulb size={24} className="text-emerald-600" />
                          <h4 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#166534", margin: 0 }}>
                            AI Evaluation
                          </h4>
                          <span style={{
                            marginLeft: "auto",
                            padding: "0.25rem 0.75rem",
                            borderRadius: "9999px",
                            fontSize: "0.875rem",
                            fontWeight: 700,
                            backgroundColor: qa.ai_feedback.overall_score >= 70 ? "#dcfce7" : qa.ai_feedback.overall_score >= 50 ? "#fef3c7" : "#fee2e2",
                            color: qa.ai_feedback.overall_score >= 70 ? "#166534" : qa.ai_feedback.overall_score >= 50 ? "#92400e" : "#991b1b",
                          }}>
                            Score: {qa.ai_feedback.overall_score}/100
                          </span>
                        </div>

                        {/* One-liner summary */}
                        {qa.ai_feedback.one_liner && (
                          <div style={{ 
                            fontSize: "0.875rem", 
                            fontStyle: "italic", 
                            color: "#475569", 
                            marginBottom: "1rem",
                            padding: "0.5rem 1rem",
                            backgroundColor: "#ffffff",
                            borderRadius: "0.375rem",
                            borderLeft: "3px solid #10b981"
                          }}>
                            {qa.ai_feedback.one_liner}
                          </div>
                        )}

                        {/* Feedback Summary */}
                        {qa.ai_feedback.feedback_summary && (
                          <div style={{ marginBottom: "1rem" }}>
                            <h5 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.5rem" }}>
                              Summary
                            </h5>
                            <p style={{ fontSize: "0.875rem", color: "#475569", margin: 0 }}>
                              {qa.ai_feedback.feedback_summary}
                            </p>
                          </div>
                        )}

                        {/* Score Breakdown */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                          {qa.ai_feedback.code_quality && (
                            <div style={{ padding: "0.75rem", backgroundColor: "#ffffff", borderRadius: "0.5rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Code Quality</div>
                              <div style={{ fontSize: "1rem", fontWeight: 600 }}>{qa.ai_feedback.code_quality.score}/25</div>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>{qa.ai_feedback.code_quality.comments}</div>
                            </div>
                          )}
                          {qa.ai_feedback.correctness && (
                            <div style={{ padding: "0.75rem", backgroundColor: "#ffffff", borderRadius: "0.5rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Correctness</div>
                              <div style={{ fontSize: "1rem", fontWeight: 600 }}>{qa.ai_feedback.correctness.score}/40</div>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>{qa.ai_feedback.correctness.comments}</div>
                            </div>
                          )}
                          {qa.ai_feedback.library_usage && (
                            <div style={{ padding: "0.75rem", backgroundColor: "#ffffff", borderRadius: "0.5rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Library Usage</div>
                              <div style={{ fontSize: "1rem", fontWeight: 600 }}>{qa.ai_feedback.library_usage.score}/20</div>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>{qa.ai_feedback.library_usage.comments}</div>
                            </div>
                          )}
                          {qa.ai_feedback.output_quality && (
                            <div style={{ padding: "0.75rem", backgroundColor: "#ffffff", borderRadius: "0.5rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Output Quality</div>
                              <div style={{ fontSize: "1rem", fontWeight: 600 }}>{qa.ai_feedback.output_quality.score}/15</div>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>{qa.ai_feedback.output_quality.comments}</div>
                            </div>
                          )}
                        </div>

                        {/* Task Completion */}
                        {qa.ai_feedback.task_completion && (
                          <div style={{ marginBottom: "1rem", padding: "0.75rem", backgroundColor: "#ffffff", borderRadius: "0.5rem" }}>
                            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.5rem" }}>
                              Task Completion: {qa.ai_feedback.task_completion.completed}/{qa.ai_feedback.task_completion.total}
                            </div>
                            {qa.ai_feedback.task_completion.details && qa.ai_feedback.task_completion.details.length > 0 && (
                              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: "#475569" }}>
                                {qa.ai_feedback.task_completion.details.map((detail, idx) => (
                                  <li key={idx}>{detail}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {/* Strengths and Areas for Improvement */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                          {qa.ai_feedback.strengths && qa.ai_feedback.strengths.length > 0 && (
                            <div>
                              <h5 style={{ 
                                fontSize: "0.875rem", 
                                fontWeight: 600, 
                                color: "#166534", 
                                marginBottom: "0.5rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem"
                              }}>
                                <CheckCircle2 size={16} /> Strengths
                              </h5>
                              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: "#166534" }}>
                                {qa.ai_feedback.strengths.map((strength, idx) => (
                                  <li key={idx}>{strength}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {qa.ai_feedback.areas_for_improvement && qa.ai_feedback.areas_for_improvement.length > 0 && (
                            <div>
                              <h5 style={{ 
                                fontSize: "0.875rem", 
                                fontWeight: 600, 
                                color: "#dc2626", 
                                marginBottom: "0.5rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem"
                              }}>
                                <AlertTriangle size={16} /> Areas to Improve
                              </h5>
                              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: "#dc2626" }}>
                                {qa.ai_feedback.areas_for_improvement.map((area, idx) => (
                                  <li key={idx}>{area}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {/* Suggestions */}
                        {qa.ai_feedback.suggestions && qa.ai_feedback.suggestions.length > 0 && (
                          <div style={{ marginTop: "1rem" }}>
                            <h5 style={{ 
                              fontSize: "0.875rem", 
                              fontWeight: 600, 
                              color: "#1e40af", 
                              marginBottom: "0.5rem",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem"
                            }}>
                              <TrendingUp size={16} /> Suggestions for Improvement
                            </h5>
                            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: "#1e40af" }}>
                              {qa.ai_feedback.suggestions.map((suggestion, idx) => (
                                <li key={idx}>{suggestion}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* AI Generated Badge */}
                        <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#64748b", textAlign: "right" }}>
                          {qa.ai_feedback.ai_generated ? "🤖 AI-generated feedback" : "📊 Rule-based evaluation"}
                        </div>
                      </div>
                    )}

                    {/* If no AI feedback yet but test is completed */}
                    {!qa.ai_feedback && qa.status === 'evaluated' && (
                      <div style={{ 
                        marginTop: "1rem", 
                        padding: "1rem", 
                        backgroundColor: "#fef3c7", 
                        borderRadius: "0.5rem",
                        textAlign: "center",
                        fontSize: "0.875rem",
                        color: "#92400e"
                      }}>
                        AI evaluation pending...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Candidate Modal */}
      {showAddCandidateModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={() => {
          if (!addingCandidate) {
            setShowAddCandidateModal(false)
            setNewCandidateName("")
            setNewCandidateEmail("")
            setEmailError(null)
          }
        }}
        >
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "0.75rem",
            padding: "2rem",
            width: "90%",
            maxWidth: "600px",
            maxHeight: "90vh",
            overflow: "auto",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1.5rem", color: "#2D7A52" }}>
              Add Candidate
            </h2>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Full Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  value={newCandidateName}
                  onChange={(e) => {
                    setNewCandidateName(e.target.value)
                    setEmailError(null)
                  }}
                  placeholder="Enter candidate's full name"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                  disabled={addingCandidate}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Email Address <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="email"
                  value={newCandidateEmail}
                  onChange={(e) => {
                    setNewCandidateEmail(e.target.value)
                    setEmailError(null)
                  }}
                  placeholder="Enter candidate's email address"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: emailError ? "1px solid #ef4444" : "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                  disabled={addingCandidate}
                />
                {emailError && (
                  <p style={{ color: "#ef4444", fontSize: "0.875rem", marginTop: "0.25rem" }}>
                    {emailError}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowAddCandidateModal(false)
                    setNewCandidateName("")
                    setNewCandidateEmail("")
                    setEmailError(null)
                  }}
                  disabled={addingCandidate}
                  style={{ marginTop: 0 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleAddCandidate}
                  disabled={addingCandidate}
                  style={{ marginTop: 0 }}
                >
                  {addingCandidate ? "Adding..." : "Add Candidate"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Template Edit Modal */}
      {showEmailTemplateModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={() => {
          if (!savingTemplate) {
            setShowEmailTemplateModal(false)
          }
        }}
        >
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "0.75rem",
            padding: "2rem",
            width: "90%",
            maxWidth: "700px",
            maxHeight: "90vh",
            overflow: "auto",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1.5rem", color: "#2D7A52" }}>
              Edit Email Template
            </h2>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Logo URL (optional)
                </label>
                <input
                  type="text"
                  value={emailTemplate.logoUrl}
                  onChange={(e) => setEmailTemplate({ ...emailTemplate, logoUrl: e.target.value })}
                  placeholder="https://example.com/logo.png"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                  disabled={savingTemplate}
                />
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Company Name (optional)
                </label>
                <input
                  type="text"
                  value={emailTemplate.companyName}
                  onChange={(e) => setEmailTemplate({ ...emailTemplate, companyName: e.target.value })}
                  placeholder="Your Company Name"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                  disabled={savingTemplate}
                />
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Message <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  value={emailTemplate.message}
                  onChange={(e) => setEmailTemplate({ ...emailTemplate, message: e.target.value })}
                  placeholder="You have been invited to take an AIML test. Please click the link below to start."
                  rows={6}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontFamily: "inherit",
                  }}
                  disabled={savingTemplate}
                />
                <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                  Available placeholders: {"{{candidate_name}}"}, {"{{candidate_email}}"}, {"{{exam_url}}"}, {"{{company_name}}"}
                </p>
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Footer (optional)
                </label>
                <textarea
                  value={emailTemplate.footer}
                  onChange={(e) => setEmailTemplate({ ...emailTemplate, footer: e.target.value })}
                  placeholder="Additional footer text"
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontFamily: "inherit",
                  }}
                  disabled={savingTemplate}
                />
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Sent By (optional)
                </label>
                <input
                  type="text"
                  value={emailTemplate.sentBy}
                  onChange={(e) => setEmailTemplate({ ...emailTemplate, sentBy: e.target.value })}
                  placeholder="AI Assessment Platform"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                  disabled={savingTemplate}
                />
              </div>
              
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowEmailTemplateModal(false)
                    // Reset to saved template
                    if (testInfo?.invitationTemplate) {
                      setEmailTemplate(testInfo.invitationTemplate)
                    }
                  }}
                  disabled={savingTemplate}
                  style={{ marginTop: 0 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveEmailTemplate}
                  disabled={savingTemplate || !emailTemplate.message.trim()}
                  style={{ marginTop: 0 }}
                >
                  {savingTemplate ? "Saving..." : "Save Template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const getServerSideProps: GetServerSideProps = requireAuth
