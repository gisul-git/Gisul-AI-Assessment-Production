'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../../../lib/auth'
import Link from 'next/link'
import dsaApi from '../../../../lib/dsa/api'
import { ArrowLeft, Lightbulb, CheckCircle2, TrendingUp, AlertTriangle, Eye, Clock, Video } from 'lucide-react'
import LiveProctoringDashboard from '../../../../components/proctor/LiveProctoringDashboard'

interface AIFeedback {
  overall_score?: number
  feedback_summary?: string
  one_liner?: string
  code_quality?: {
    score?: number
    comments?: string
  }
  efficiency?: {
    time_complexity?: string
    space_complexity?: string
    comments?: string
  }
  correctness?: {
    score?: number
    comments?: string
  }
  suggestions?: string[]
  strengths?: string[]
  areas_for_improvement?: string[]
  deduction_reasons?: string[]
  improvement_suggestions?: string[]
  test_breakdown?: {
    public_passed?: number
    public_total?: number
    hidden_passed?: number
    hidden_total?: number
    total_passed?: number
    total_tests?: number
  }
  scoring_basis?: {
    base_score?: number
    correctness_score?: number
    pass_rate?: string
    efficiency_bonus?: number
    code_quality_score?: number
    code_quality_adjustment?: number
    time_complexity?: string
    space_complexity?: string
    final_score?: number
    points_deducted?: number
    explanation?: string
  }
}

interface QuestionAnalytics {
  question_id: string
  question_title: string
  language: string
  status?: string
  invited?: boolean
  invited_at?: string | null
  passed_testcases: number
  total_testcases: number
  execution_time?: number
  memory_used?: number
  code: string
  test_results: any[]
  ai_feedback?: AIFeedback
  created_at: string | null
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
  const { data: session } = useSession()
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
    message: "You have been invited to take a DSA test. Please click the link below to start.",
    footer: "",
    sentBy: "AI Assessment Platform"
  })
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [sendingInvitations, setSendingInvitations] = useState(false)
  const [showLiveProctoring, setShowLiveProctoring] = useState(false)
  
  // Memoize proctorAssessmentId to prevent infinite loops
  const proctorAssessmentId = useMemo(() => (testId as string) || "", [testId])
  const proctorAdminId = useMemo(() => (session as any)?.user?.id || (session as any)?.user?.email || 'admin', [session])
  
  // Stable callback to prevent re-renders
  const handleProctorError = useCallback((error: string) => {
    console.error('Multi-proctor error:', error)
  }, [])
  
  // Multi-proctor hook for viewing all candidates
  const {
    candidateStreams,
    activeCandidates,
    isLoading: isProctorLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
    resumePollingIfPaused,
  } = useMultiLiveProctorAdmin({
    assessmentId: proctorAssessmentId,
    adminId: proctorAdminId,
    onError: handleProctorError,
    debugMode: false, // Disable debug mode in production
  })
  
  // Start monitoring when live proctor panel opens
  // Note: startMonitoring/stopMonitoring are excluded from deps to prevent infinite loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (showLiveProctor && testId && typeof testId === 'string') {
      startMonitoring()
    } else {
      stopMonitoring()
    }
    
    return () => {
      stopMonitoring()
    }
  }, [showLiveProctor, testId])

  const fetchAnalytics = async (userId: string, showLoading: boolean = true) => {
    if (!testId || typeof testId !== 'string') return
    
    if (showLoading) {
      setLoadingAnalytics(true)
    }
    try {
      const response = await dsaApi.get(`/tests/${testId}/candidates/${userId}/analytics`)
      setAnalytics(response.data)
      
      // Check if any AI feedback is still being processed
      // AI feedback is pending if: it's null/undefined, or it exists but has no overall_score and no error
      const hasPendingFeedback = response.data?.question_analytics?.some(
        (qa: QuestionAnalytics) => {
          if (!qa.ai_feedback) return true // No feedback yet
          const feedback = qa.ai_feedback as any
          // If it has an error, it's done (even if failed)
          if (feedback.error) return false
          // If it has overall_score, it's done
          if (feedback.overall_score !== undefined && feedback.overall_score !== null) return false
          // Otherwise, it's still pending
          return true
        }
      )
      
      return hasPendingFeedback
    } catch (error) {
      console.error('Error fetching analytics:', error)
      if (showLoading) {
        alert('Failed to load analytics')
      }
      return false
    } finally {
      if (showLoading) {
        setLoadingAnalytics(false)
      }
    }
  }

  const fetchProctorLogs = async (userId: string) => {
    if (!testId || typeof testId !== 'string') return
    
    setLoadingProctorLogs(true)
    try {
      const response = await fetch(`/api/proctor/logs?assessmentId=${encodeURIComponent(testId)}&userId=${encodeURIComponent(userId)}`)
      const data = await response.json()
      
      if (data.success && data.data) {
        setProctorLogs(data.data.logs || [])
        setEventTypeLabels(data.data.eventTypeLabels || {})
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

  useEffect(() => {
    if (!testId || typeof testId !== 'string') return

    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch test info
        try {
          const testResponse = await dsaApi.get(`/tests/${testId}`)
          setTestInfo(testResponse.data)
          
          // Load email template if exists, otherwise use default
          if (testResponse.data?.invitationTemplate) {
            setEmailTemplate(testResponse.data.invitationTemplate)
          } else {
            // Use default template
            setEmailTemplate({
              logoUrl: "",
              companyName: "",
              message: "You have been invited to take a DSA test. Please click the link below to start.",
              footer: "",
              sentBy: "AI Assessment Platform"
            })
          }
        } catch (error) {
          console.error('Error fetching test info:', error)
        }
        
        // Fetch candidates
        const response = await dsaApi.get(`/tests/${testId}/candidates`)
        setCandidates(response.data || [])
        
        // If candidate query param is set, load that candidate's analytics
        if (candidateUserId && typeof candidateUserId === 'string') {
          setSelectedCandidate(candidateUserId)
          fetchAnalytics(candidateUserId)
          fetchProctorLogs(candidateUserId)
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

  // Polling for AI feedback updates
  useEffect(() => {
    if (!selectedCandidate || !testId || typeof testId !== 'string') return
    
    // Check if analytics has pending AI feedback
    const hasPendingFeedback = analytics?.question_analytics?.some(
      (qa: QuestionAnalytics) => {
        if (!qa.ai_feedback) return true // No feedback yet
        const feedback = qa.ai_feedback as any
        // If it has an error, it's done (even if failed)
        if (feedback.error) return false
        // If it has overall_score, it's done
        if (feedback.overall_score !== undefined && feedback.overall_score !== null) return false
        // Otherwise, it's still pending
        return true
      }
    )
    
    if (!hasPendingFeedback) return // No pending feedback, stop polling
    
    // Poll every 5 seconds for AI feedback updates
    const pollInterval = setInterval(async () => {
      const stillPending = await fetchAnalytics(selectedCandidate, false)
      if (!stillPending) {
        clearInterval(pollInterval)
      }
    }, 5000)
    
    return () => clearInterval(pollInterval)
  }, [selectedCandidate, testId, analytics])

  const handleCandidateSelect = (userId: string) => {
    setSelectedCandidate(userId)
    fetchAnalytics(userId)
    fetchProctorLogs(userId)
    // Auto-show logs when candidate is selected (same expectation as AI assessment analytics)
    setShowProctorLogs(true)
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
      const response = await dsaApi.post(`/tests/${testId}/add-candidate`, {
        name: newCandidateName.trim(),
        email: newCandidateEmail.trim(),
      })
      
      if (response.data) {
        // Refresh candidates list
        const candidatesResponse = await dsaApi.get(`/tests/${testId}/candidates`)
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
      const response = await dsaApi.post(`/tests/${testId}/send-invitation`, { email })
      if (response.data) {
        alert("Invitation sent successfully!")
        const candidatesResponse = await dsaApi.get(`/tests/${testId}/candidates`)
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
      // Note: DSA API may need a remove-candidate endpoint
      // For now, we'll show an alert that this feature needs backend support
      alert("Remove candidate functionality requires backend API support. Please contact support.")
    } catch (err: any) {
      alert(err.response?.data?.detail || err.response?.data?.message || "Failed to remove candidate")
    }
  }

  const handleSaveEmailTemplate = async () => {
    if (!testId || typeof testId !== 'string') return
    
    setSavingTemplate(true)
    try {
      // Update test with email template
      await dsaApi.patch(`/tests/${testId}`, {
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
      const response = await dsaApi.post(`/tests/${testId}/send-invitations-to-all`)
      
      if (response.data) {
        const successCount = response.data.success_count || 0
        const failedCount = response.data.failed_count || 0
        
        // Refresh candidates list to show updated statuses
        const candidatesResponse = await dsaApi.get(`/tests/${testId}/candidates`)
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
          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              backgroundColor: "#f1f5f9",
              color: "#475569",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              textDecoration: "none",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#e2e8f0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#f1f5f9";
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Test Analytics
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            {testInfo?.title || 'DSA Test'} - View detailed analytics and AI feedback
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
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/test/${testId}?token=${testInfo.test_token}`}
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
                      const testUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/test/${testId}?token=${testInfo.test_token}`;
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
                  setProctorLogs([])
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
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {analytics.submission.score}
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

                {/* Overall Performance Summary */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
                      {analytics.candidate.name} - Overall Performance
                    </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                      <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Total Score</div>
                      <div style={{ fontSize: "2rem", fontWeight: 700 }}>{analytics.submission.score} / 100</div>
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

                    {/* Overall Score Deduction Reasons */}
                    {(() => {
                      // Score is already normalized to 100 in backend, so max is always 100
                      const maxPossibleScore = 100
                      const actualScore = analytics.submission.score
                      const scoreDifference = maxPossibleScore - actualScore
                      
                      const allDeductionReasons: string[] = []
                      const allImprovementSuggestions: string[] = []
                      
                      analytics.question_analytics.forEach((qa, index) => {
                        if (qa.ai_feedback?.overall_score !== undefined && qa.ai_feedback.overall_score < 100) {
                          const questionDeduction = 100 - qa.ai_feedback.overall_score
                          
                          if (qa.ai_feedback.deduction_reasons && qa.ai_feedback.deduction_reasons.length > 0) {
                            qa.ai_feedback.deduction_reasons.forEach(reason => {
                              allDeductionReasons.push(`Question ${index + 1}: ${reason} (-${questionDeduction} points)`)
                            })
                          } else if (qa.ai_feedback.scoring_basis) {
                            const basis = qa.ai_feedback.scoring_basis
                            const reasons: string[] = []
                            
                            if (basis.base_score && basis.base_score < 100) {
                              reasons.push(`Base score reduced to ${basis.base_score}/100 due to test pass rate: ${basis.pass_rate || 'N/A'}`)
                            }
                            
                            if (basis.efficiency_bonus && basis.efficiency_bonus < 0) {
                              reasons.push(`Efficiency penalty: ${basis.efficiency_bonus} points (Time: ${basis.time_complexity}, Space: ${basis.space_complexity})`)
                            }
                            
                            if (basis.code_quality_adjustment && basis.code_quality_adjustment < 0) {
                              reasons.push(`Code quality adjustment: ${basis.code_quality_adjustment} points`)
                            }
                            
                            if (reasons.length > 0) {
                              reasons.forEach(reason => {
                                allDeductionReasons.push(`Question ${index + 1}: ${reason} (-${questionDeduction} points)`)
                              })
                            } else {
                              const effBonus = basis.efficiency_bonus || 0
                              const codeQualAdj = basis.code_quality_adjustment || 0
                              allDeductionReasons.push(
                                `Question ${index + 1}: Score ${qa.ai_feedback.overall_score}/100 calculated as Base (${basis.base_score || 'N/A'}) + Efficiency (${effBonus >= 0 ? '+' : ''}${effBonus}) + Code Quality (${codeQualAdj >= 0 ? '+' : ''}${codeQualAdj}) = ${qa.ai_feedback.overall_score} (-${questionDeduction} points)`
                              )
                            }
                          } else {
                            allDeductionReasons.push(`Question ${index + 1}: Score ${qa.ai_feedback.overall_score}/100 (-${questionDeduction} points)`)
                          }
                          
                          if (qa.ai_feedback.improvement_suggestions && qa.ai_feedback.improvement_suggestions.length > 0) {
                            qa.ai_feedback.improvement_suggestions.forEach(suggestion => {
                              allImprovementSuggestions.push(`Question ${index + 1}: ${suggestion}`)
                            })
                          }
                        }
                      })

                      if (scoreDifference > 0) {
                        return (
                        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          <div style={{ backgroundColor: "#fee2e2", border: "2px solid #ef4444", borderRadius: "0.5rem", padding: "1rem" }}>
                            <h4 style={{ fontSize: "1rem", fontWeight: 700, color: "#991b1b", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <AlertTriangle style={{ width: "20px", height: "20px" }} />
                                Overall Score Deduction ({scoreDifference} points deducted)
                              </h4>
                            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#991b1b", marginBottom: "0.75rem", backgroundColor: "#fecaca", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}>
                                Total Score: {actualScore}/{maxPossibleScore}
                              </div>
                              {allDeductionReasons.length > 0 ? (
                              <ul style={{ fontSize: "0.875rem", color: "#991b1b", listStyle: "disc", paddingLeft: "1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: 500 }}>
                                  {allDeductionReasons.map((reason, idx) => (
                                  <li key={idx} style={{ lineHeight: "1.5" }}>{reason}</li>
                                  ))}
                                </ul>
                              ) : (
                              <div style={{ fontSize: "0.875rem", color: "#991b1b" }}>
                                <p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>Score breakdown by question:</p>
                                <ul style={{ listStyle: "disc", paddingLeft: "1.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                                    {analytics.question_analytics.map((qa, idx) => {
                                      if (qa.ai_feedback?.overall_score !== undefined && qa.ai_feedback.overall_score < 100) {
                                        const deduction = 100 - qa.ai_feedback.overall_score
                                        return (
                                          <li key={idx}>
                                            Question {idx + 1}: {qa.ai_feedback.overall_score}/100 (-{deduction} points)
                                          </li>
                                        )
                                      }
                                      return null
                                    })}
                                  </ul>
                                </div>
                              )}
                            </div>

                            {allImprovementSuggestions.length > 0 && (
                            <div style={{ backgroundColor: "#fef3c7", border: "2px solid #fbbf24", borderRadius: "0.5rem", padding: "1rem" }}>
                              <h4 style={{ fontSize: "1rem", fontWeight: 700, color: "#92400e", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <Lightbulb style={{ width: "20px", height: "20px" }} />
                                  Overall Improvement Suggestions
                                </h4>
                              <ul style={{ fontSize: "0.875rem", color: "#92400e", listStyle: "disc", paddingLeft: "1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontWeight: 500 }}>
                                  {allImprovementSuggestions.map((suggestion, idx) => (
                                  <li key={idx} style={{ lineHeight: "1.5" }}>{suggestion}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )
                      }
                      return null
                    })()}
                </div>

                {/* Live Proctoring Section */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                  marginBottom: "1.5rem",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Eye style={{ width: "20px", height: "20px", color: "#3b82f6" }} />
                      <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Live Proctoring</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowLiveProctoring(true)}
                      style={{
                        padding: "0.5rem 1rem",
                        fontSize: "0.875rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        backgroundColor: "#3b82f6",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "0.5rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      <Eye size={16} />
                      Open Live Proctoring
                    </button>
                  </div>
                  <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
                    Monitor candidates in real-time via webcam and screen sharing
                  </p>
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
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
                                <span>{formatDate(log.timestamp)}</span>
                              </div>
                            </div>
                            
                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <div style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Details:</div>
                              <div style={{ backgroundColor: "#1e293b", borderRadius: "0.375rem", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                                  {Object.entries(log.metadata).map(([key, value]) => (
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
                    <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem" }}>
                        Question {index + 1}: {qa.question_title}
                      </h3>
                      
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                        <div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Status</div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 500, color: qa.status === 'accepted' ? "#059669" : "#dc2626" }}>
                            {qa.status}
                          </div>
                        </div>
                        <div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Test Cases</div>
                        <div style={{ fontSize: "0.875rem" }}>
                            {qa.passed_testcases} / {qa.total_testcases} passed
                          </div>
                        </div>
                        <div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Language</div>
                        <div style={{ fontSize: "0.875rem" }}>{qa.language}</div>
                        </div>
                        {qa.execution_time && (
                          <div>
                          <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Execution Time</div>
                          <div style={{ fontSize: "0.875rem" }}>{qa.execution_time}ms</div>
                          </div>
                        )}
                      </div>

                      {/* AI Feedback */}
                      {qa.ai_feedback && (
                      <div style={{ marginTop: "1.5rem", border: "1px solid #3b82f6", borderRadius: "0.5rem", backgroundColor: "#eff6ff", overflow: "hidden" }}>
                        <div style={{ padding: "0.75rem 1rem", backgroundColor: "#dbeafe", borderBottom: "1px solid #3b82f6" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <Lightbulb style={{ width: "20px", height: "20px", color: "#3b82f6" }} />
                            <span style={{ fontWeight: 600, color: "#1e40af" }}>AI Feedback</span>
                              {qa.ai_feedback.overall_score !== undefined && (
                              <span style={{ fontSize: "1.125rem", fontWeight: 700, color: qa.ai_feedback.overall_score >= 80 ? "#059669" : qa.ai_feedback.overall_score >= 60 ? "#f59e0b" : "#dc2626" }}>
                                  Score: {qa.ai_feedback.overall_score}/100
                                </span>
                              )}
                            </div>
                          </div>
                          
                        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {/* Test Case Breakdown */}
                            {qa.ai_feedback.test_breakdown && (
                            <div style={{ backgroundColor: "#1e293b", borderRadius: "0.5rem", padding: "0.75rem", border: "1px solid #3b82f6" }}>
                              <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <CheckCircle2 style={{ width: "12px", height: "12px" }} />
                                  Test Case Results
                                </h4>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem", fontSize: "0.875rem" }}>
                                <div style={{ backgroundColor: "#0f172a", borderRadius: "0.375rem", padding: "0.5rem" }}>
                                  <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.25rem" }}>Public Test Cases</div>
                                  <div style={{ fontSize: "1.125rem", fontWeight: 600, color: "#60a5fa" }}>
                                      {qa.ai_feedback.test_breakdown?.public_passed ?? 0}/{qa.ai_feedback.test_breakdown?.public_total ?? 0}
                                    </div>
                                  </div>
                                <div style={{ backgroundColor: "#0f172a", borderRadius: "0.375rem", padding: "0.5rem" }}>
                                  <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.25rem" }}>Hidden Test Cases</div>
                                  <div style={{ fontSize: "1.125rem", fontWeight: 600, color: "#a78bfa" }}>
                                      {qa.ai_feedback.test_breakdown?.hidden_passed ?? 0}/{qa.ai_feedback.test_breakdown?.hidden_total ?? 0}
                                    </div>
                                  </div>
                                <div style={{ gridColumn: "span 2", backgroundColor: "#0f172a", borderRadius: "0.375rem", padding: "0.5rem" }}>
                                  <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.25rem" }}>Total</div>
                                  <div style={{ fontSize: "1.125rem", fontWeight: 600, color: "#34d399" }}>
                                      {(qa.ai_feedback.test_breakdown?.public_passed ?? 0) + (qa.ai_feedback.test_breakdown?.hidden_passed ?? 0)}/
                                      {(qa.ai_feedback.test_breakdown?.public_total ?? 0) + (qa.ai_feedback.test_breakdown?.hidden_total ?? 0)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Complexity */}
                            {qa.ai_feedback.efficiency && (
                            <div style={{ backgroundColor: "#1e293b", borderRadius: "0.5rem", padding: "0.75rem" }}>
                              <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <TrendingUp style={{ width: "12px", height: "12px" }} />
                                  Complexity
                                </h4>
                              <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.875rem" }}>
                                  <div>
                                  <span style={{ color: "#94a3b8" }}>Time: </span>
                                  <span style={{ fontWeight: 600, color: "#60a5fa" }}>
                                      {qa.ai_feedback.efficiency.time_complexity || 'N/A'}
                                    </span>
                                  </div>
                                  <div>
                                  <span style={{ color: "#94a3b8" }}>Space: </span>
                                  <span style={{ fontWeight: 600, color: "#a78bfa" }}>
                                      {qa.ai_feedback.efficiency.space_complexity || 'N/A'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* AI Feedback Summary */}
                            {qa.ai_feedback.feedback_summary && (
                            <div style={{ backgroundColor: "#1e293b", borderRadius: "0.5rem", padding: "0.75rem" }}>
                              <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <Lightbulb style={{ width: "12px", height: "12px" }} />
                                  AI Feedback
                                </h4>
                              <p style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: "1.6" }}>
                                  {qa.ai_feedback.feedback_summary}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Code Display */}
                    <details style={{ marginTop: "1rem" }}>
                      <summary style={{ cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, color: "#64748b" }}>
                          View Code
                        </summary>
                      <pre style={{ marginTop: "0.5rem", padding: "1rem", backgroundColor: "#1e293b", borderRadius: "0.5rem", overflowX: "auto", fontSize: "0.75rem", color: "#e2e8f0" }}>
                          <code>{qa.code}</code>
                        </pre>
                      </details>
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
            
            {/* Bulk Upload Section */}
            <div style={{ 
              marginBottom: "1.5rem", 
              padding: "1rem", 
              border: "1px solid #A8E8BC", 
              borderRadius: "0.5rem",
              backgroundColor: "#f8f9fa"
            }}>
              <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "#1a1625" }}>
                Bulk Upload (CSV)
              </h4>
              <p style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.75rem" }}>
                Upload a CSV file with 'name' and 'email' columns
              </p>
              <input
                type="file"
                accept=".csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  
                  if (!testId || typeof testId !== 'string') return
                  
                  const formData = new FormData()
                  formData.append('file', file)
                  
                  try {
                    const response = await dsaApi.post(
                      `/tests/${testId}/bulk-add-candidates`,
                      formData,
                      {
                        headers: {
                          'Content-Type': 'multipart/form-data',
                        },
                      }
                    )
                    
                    alert(
                      `Bulk upload completed!\n` +
                      `Success: ${response.data.success_count || 0}\n` +
                      `Failed: ${response.data.failed_count || 0}\n` +
                      `Duplicates: ${response.data.duplicate_count || 0}`
                    )
                    
                    // Refresh candidates list
                    const candidatesResponse = await dsaApi.get(`/tests/${testId}/candidates`)
                    setCandidates(candidatesResponse.data || [])
                    
                    // Reset file input
                    e.target.value = ''
                    
                    // Close modal if successful
                    if (response.data.success_count > 0) {
                      setShowAddCandidateModal(false)
                    }
                  } catch (error: any) {
                    alert(error.response?.data?.detail || error.response?.data?.message || 'Failed to upload CSV')
                    e.target.value = ''
                  }
                }}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #A8E8BC",
                  borderRadius: "0.375rem",
                  backgroundColor: "#ffffff",
                  cursor: "pointer",
                  fontSize: "0.875rem"
                }}
              />
            </div>
            
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "0.5rem", 
              marginBottom: "1rem",
              padding: "0.5rem 0"
            }}>
              <div style={{ flex: 1, height: "1px", backgroundColor: "#e2e8f0" }}></div>
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>OR</span>
              <div style={{ flex: 1, height: "1px", backgroundColor: "#e2e8f0" }}></div>
            </div>
            
            {/* Manual Add Section */}
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
                  placeholder="You have been invited to take a DSA test. Please click the link below to start."
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

      {/* Live Proctoring Dashboard */}
      {showLiveProctoring && testId && typeof testId === 'string' && session?.user && (
        <LiveProctoringDashboard
          isOpen={showLiveProctoring}
          onClose={() => setShowLiveProctoring(false)}
          assessmentId={testId}
          adminId={session.user.email || session.user.id || 'admin'}
        />
      )}
    </div>
  )
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth
