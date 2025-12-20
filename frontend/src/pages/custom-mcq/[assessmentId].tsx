import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import { customMCQApi } from "../../lib/custom-mcq/api";
import { CustomMCQAssessment, AssessmentSubmission } from "../../types/custom-mcq";
import ProctorSummaryCard from "../../components/admin/ProctorSummaryCard";
import LiveProctoringDashboard from "../../components/proctor/LiveProctoringDashboard";
import { useSession } from "next-auth/react";
import { Eye } from "lucide-react";

interface CustomMCQDetailsPageProps {
  session: any;
}

export default function CustomMCQDetailsPage({ session }: CustomMCQDetailsPageProps) {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const { assessmentId } = router.query;
  const [assessment, setAssessment] = useState<CustomMCQAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proctorLogsByUser, setProctorLogsByUser] = useState<Record<string, any[]>>({});
  const [proctorLabelsByUser, setProctorLabelsByUser] = useState<Record<string, Record<string, string>>>({});
  const [proctorSummaryByUser, setProctorSummaryByUser] = useState<Record<string, { summary: Record<string, number>; totalViolations: number }>>({});
  const [loadingProctorForUser, setLoadingProctorForUser] = useState<Record<string, boolean>>({});
  const [expandedProctorUser, setExpandedProctorUser] = useState<string | null>(null);
  const [expandedAnswerLogsUser, setExpandedAnswerLogsUser] = useState<string | null>(null);
  const [showLiveProctoring, setShowLiveProctoring] = useState(false);

  useEffect(() => {
    if (assessmentId) {
      loadAssessment();
    }
  }, [assessmentId]);

  const loadAssessment = async () => {
    try {
      setLoading(true);
      const data = await customMCQApi.getAssessment(assessmentId as string);
      setAssessment(data);
    } catch (err: any) {
      setError(err.message || "Failed to load assessment");
    } finally {
      setLoading(false);
    }
  };

  const fetchProctorForUser = async (userEmail: string) => {
    if (!assessmentId || typeof assessmentId !== "string") return;
    if (!userEmail) return;

    setLoadingProctorForUser((prev) => ({ ...prev, [userEmail]: true }));
    try {
      // Logs (includes eventTypeLabels)
      const logsResp = await fetch(
        `/api/proctor/logs?assessmentId=${encodeURIComponent(assessmentId)}&userId=${encodeURIComponent(userEmail)}`
      );
      const logsJson = await logsResp.json();
      if (logsJson?.success && logsJson?.data) {
        setProctorLogsByUser((prev) => ({ ...prev, [userEmail]: logsJson.data.logs || [] }));
        setProctorLabelsByUser((prev) => ({ ...prev, [userEmail]: logsJson.data.eventTypeLabels || {} }));
      }

      // Summary (for counts)
      const summaryResp = await fetch(
        `/api/proctor/summary?assessmentId=${encodeURIComponent(assessmentId)}&userId=${encodeURIComponent(userEmail)}`
      );
      const summaryJson = await summaryResp.json();
      if (summaryJson?.success && summaryJson?.data) {
        setProctorSummaryByUser((prev) => ({
          ...prev,
          [userEmail]: {
            summary: summaryJson.data.summary || {},
            totalViolations: summaryJson.data.totalViolations || 0,
          },
        }));
      }
    } catch (e) {
      console.error("Failed to fetch proctor logs for user:", userEmail, e);
    } finally {
      setLoadingProctorForUser((prev) => ({ ...prev, [userEmail]: false }));
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this assessment? This action cannot be undone.")) {
      return;
    }

    try {
      await customMCQApi.deleteAssessment(assessmentId as string);
      router.push("/dashboard?refresh=true");
    } catch (err: any) {
      alert(err.message || "Failed to delete assessment");
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center" }}>
          <h1>Error</h1>
          <p>{error || "Assessment not found"}</p>
        </div>
      </div>
    );
  }

  const submissions = (assessment as any).submissionsList || [];
  const assessmentUrl = `${window.location.origin}/custom-mcq/entry/${assessmentId}?token=${(assessment as any).assessmentToken}`;
  
  // Calculate attempted and not attempted questions for each submission
  const totalQuestions = assessment.totalQuestions || assessment.questions?.length || 0;
  
  // Calculate overall attempted/not attempted stats
  const calculateAttemptedStats = () => {
    if (submissions.length === 0) {
      return { 
        totalAttempted: 0, 
        totalNotAttempted: 0,
        avgAttempted: 0, 
        avgNotAttempted: 0 
      };
    }
    
    let totalAttempted = 0;
    let totalNotAttempted = 0;
    
    submissions.forEach((submission: any) => {
      const submissionEntries = submission.submissions || [];
      const attemptedCount = submissionEntries.length;
      const notAttemptedCount = Math.max(0, totalQuestions - attemptedCount);
      totalAttempted += attemptedCount;
      totalNotAttempted += notAttemptedCount;
    });
    
    const avgAttempted = Math.round((totalAttempted / submissions.length) * 10) / 10;
    const avgNotAttempted = Math.round((totalNotAttempted / submissions.length) * 10) / 10;
    
    return { 
      totalAttempted, 
      totalNotAttempted,
      avgAttempted, 
      avgNotAttempted 
    };
  };
  
  const overallStats = calculateAttemptedStats();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#ffffff", padding: "2rem" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ marginBottom: "0.5rem", color: "#1E5A3B" }}>{assessment.title}</h1>
            {assessment.description && (
              <p style={{ color: "#2D7A52", margin: 0 }}>{assessment.description}</p>
            )}
          </div>
          <button type="button" onClick={() => router.push("/dashboard")} className="btn-secondary">
            ← Back to Dashboard
          </button>
        </div>

        {/* Live Proctoring Section */}
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Eye style={{ width: "20px", height: "20px", color: "#3b82f6" }} />
              <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Live Proctoring</h2>
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
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
            Monitor candidates in real-time via webcam and screen sharing
          </p>
        </div>

        {/* Assessment Info */}
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#E8FAF0",
            border: "1px solid #A8E8BC",
            borderRadius: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <h2 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Assessment Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            <div>
              <strong style={{ color: "#2D7A52" }}>Total Questions:</strong> {assessment.totalQuestions || 0}
            </div>
            <div>
              <strong style={{ color: "#2D7A52" }}>Total Marks:</strong> {assessment.totalMarks || 0}
            </div>
            <div>
              <strong style={{ color: "#2D7A52" }}>Access Mode:</strong> {assessment.accessMode}
            </div>
            <div>
              <strong style={{ color: "#2D7A52" }}>Exam Mode:</strong> {assessment.examMode}
            </div>
            <div>
              <strong style={{ color: "#2D7A52" }}>Pass Percentage:</strong> {assessment.passPercentage}%
            </div>
            <div>
              <strong style={{ color: "#2D7A52" }}>Submissions:</strong> {submissions.length}
            </div>
            {submissions.length > 0 && (
              <div>
                <strong style={{ color: "#2D7A52" }}>Total Attempted Questions:</strong>{" "}
                <span style={{ color: "#059669", fontWeight: 600, fontSize: "1.1rem" }}>
                  {overallStats.totalAttempted}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Assessment URL */}
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#ffffff",
            border: "2px solid #2D7A52",
            borderRadius: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Assessment URL</h3>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              value={assessmentUrl}
              readOnly
              style={{
                flex: 1,
                minWidth: "300px",
                padding: "0.75rem",
                border: "1px solid #A8E8BC",
                borderRadius: "0.5rem",
                backgroundColor: "#f9fafb",
              }}
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(assessmentUrl);
                alert("URL copied to clipboard!");
              }}
              className="btn-primary"
            >
              Copy URL
            </button>
          </div>
        </div>

        {/* Submissions */}
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#ffffff",
            border: "1px solid #A8E8BC",
            borderRadius: "0.75rem",
          }}
        >
          <h2 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Student Submissions</h2>
          {submissions.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#4A9A6A" }}>
              No submissions yet.
            </div>
          ) : (
            <div style={{ width: "100%", overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  borderRadius: "0.5rem",
                  overflow: "hidden",
                  border: "1px solid #A8E8BC",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#E8FAF0" }}>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      Name
                    </th>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      Email
                    </th>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      Status
                    </th>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      Score / Percentage
                    </th>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      Questions Attempted
                    </th>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "center", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      View Proctoring Logs
                    </th>
                    <th style={{ padding: "0.75rem 0.75rem", textAlign: "center", fontSize: "0.85rem", color: "#1E5A3B" }}>
                      View Answer Logs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission: AssessmentSubmission & { candidateKey: string }, idx: number) => {
                    const candidateInfo = submission.candidateInfo || {};
                    const userEmail = String(candidateInfo.email || "").trim();
                    const isProctorExpanded = expandedProctorUser === userEmail && !!userEmail;
                    const isAnswerExpanded = expandedAnswerLogsUser === userEmail && !!userEmail;
                    const proctorLogs = (userEmail && proctorLogsByUser[userEmail]) ? proctorLogsByUser[userEmail] : [];
                    const proctorLabels = (userEmail && proctorLabelsByUser[userEmail]) ? proctorLabelsByUser[userEmail] : {};
                    const proctorSummary = (userEmail && proctorSummaryByUser[userEmail]) ? proctorSummaryByUser[userEmail] : null;
                    const isLoadingProctor = !!(userEmail && loadingProctorForUser[userEmail]);
                    const hasAnswerLogs = (submission as any).answerLogs && Object.keys((submission as any).answerLogs).length > 0;
                    
                    // Calculate attempted and not attempted questions for this submission
                    const submissionEntries = (submission as any).submissions || [];
                    const attemptedCount = submissionEntries.length;
                    const notAttemptedCount = Math.max(0, totalQuestions - attemptedCount);

                    return (
                      <>
                        <tr
                          key={idx}
                          style={{
                            borderTop: "1px solid #A8E8BC",
                            backgroundColor: idx % 2 === 0 ? "#ffffff" : "#F9FFFB",
                          }}
                        >
                          <td style={{ padding: "0.75rem 0.75rem", fontSize: "0.9rem", color: "#1E5A3B" }}>
                            {candidateInfo.name || "Unknown"}
                          </td>
                          <td style={{ padding: "0.75rem 0.75rem", fontSize: "0.85rem", color: "#2D7A52" }}>
                            {candidateInfo.email || "N/A"}
                          </td>
                          <td style={{ padding: "0.75rem 0.75rem", fontSize: "0.85rem" }}>
                            <span
                              style={{
                                padding: "0.2rem 0.45rem",
                                borderRadius: "0.25rem",
                                backgroundColor: submission.passed ? "#dcfce7" : "#fee2e2",
                                color: submission.passed ? "#166534" : "#991b1b",
                                fontWeight: 600,
                                fontSize: "0.8rem",
                              }}
                            >
                              {submission.passed ? "PASSED" : "FAILED"}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem 0.75rem", fontSize: "0.85rem", color: "#1E5A3B" }}>
                            <div>
                              <strong style={{ color: "#2D7A52" }}>Score:</strong> {submission.score || 0} /{" "}
                              {submission.totalMarks || 0}
                            </div>
                            <div>
                              <strong style={{ color: "#2D7A52" }}>Percentage:</strong>{" "}
                              {submission.percentage?.toFixed(2) || 0}%
                            </div>
                          </td>
                          <td style={{ padding: "0.75rem 0.75rem", fontSize: "0.85rem", color: "#1E5A3B" }}>
                            <div>
                              <strong style={{ color: "#059669" }}>Attempted:</strong>{" "}
                              <span style={{ fontWeight: 600 }}>{attemptedCount}</span>
                            </div>
                            <div>
                              <strong style={{ color: "#dc2626" }}>Not Attempted:</strong>{" "}
                              <span style={{ fontWeight: 600 }}>{notAttemptedCount}</span>
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                              ({attemptedCount} / {totalQuestions})
                            </div>
                          </td>
                          <td style={{ padding: "0.75rem 0.75rem", textAlign: "center" }}>
                            <button
                              type="button"
                              disabled={!userEmail}
                              onClick={async () => {
                                if (!userEmail) return;
                                const nextExpanded = isProctorExpanded ? null : userEmail;
                                setExpandedProctorUser(nextExpanded);
                                if (!isProctorExpanded) {
                                  await fetchProctorForUser(userEmail);
                                }
                              }}
                              style={{
                                padding: "0.45rem 0.75rem",
                                borderRadius: "0.5rem",
                                border: "1px solid #2D7A52",
                                backgroundColor: isProctorExpanded ? "#ffffff" : "#E8FAF0",
                                color: "#1E5A3B",
                                cursor: userEmail ? "pointer" : "not-allowed",
                                fontWeight: 600,
                                fontSize: "0.8rem",
                              }}
                            >
                              {isProctorExpanded ? "Hide Logs" : "View Logs"}
                            </button>
                          </td>
                          <td style={{ padding: "0.75rem 0.75rem", textAlign: "center" }}>
                            <button
                              type="button"
                              disabled={!hasAnswerLogs}
                              onClick={() => {
                                if (!hasAnswerLogs) return;
                                const nextExpanded = isAnswerExpanded ? null : userEmail;
                                setExpandedAnswerLogsUser(nextExpanded);
                              }}
                              style={{
                                padding: "0.45rem 0.75rem",
                                borderRadius: "0.5rem",
                                border: "1px solid #F59E0B",
                                backgroundColor: isAnswerExpanded ? "#FFF7ED" : "#FFFBEB",
                                color: hasAnswerLogs ? "#92400E" : "#D1D5DB",
                                cursor: hasAnswerLogs ? "pointer" : "not-allowed",
                                fontWeight: 600,
                                fontSize: "0.8rem",
                              }}
                            >
                              {isAnswerExpanded ? "Hide Logs" : "View Logs"}
                            </button>
                          </td>
                        </tr>

                        {(isProctorExpanded || isAnswerExpanded) && (
                          <tr
                            style={{
                              backgroundColor: "#F9FFFB",
                              borderTop: "1px solid #E5E7EB",
                            }}
                          >
                            <td colSpan={6} style={{ padding: "0.75rem 1rem" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.75rem",
                                }}
                              >
                                {/* Times + breakdown line */}
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "1.5rem",
                                    fontSize: "0.8rem",
                                    color: "#4A9A6A",
                                  }}
                                >
                                  {submission.startedAt && (
                                    <div>
                                      <strong>Started:</strong>{" "}
                                      {new Date(submission.startedAt).toLocaleString()}
                                    </div>
                                  )}
                                  {submission.submittedAt && (
                                    <div>
                                      <strong>Submitted:</strong>{" "}
                                      {new Date(submission.submittedAt).toLocaleString()}
                                    </div>
                                  )}

                                  {(submission.mcqTotal && submission.mcqTotal > 0) ||
                                  (submission.subjectiveTotal && submission.subjectiveTotal > 0) ? (
                                    <div>
                                      <strong style={{ color: "#2D7A52" }}>MCQ:</strong>{" "}
                                      {submission.mcqScore || 0} / {submission.mcqTotal || 0}{" "}
                                      <span style={{ marginLeft: "0.5rem", color: "#4A9A6A" }}>
                                        (
                                        {submission.mcqTotal
                                          ? (((submission.mcqScore || 0) / submission.mcqTotal) * 100).toFixed(1)
                                          : 0}
                                        %)
                                      </span>
                                      {"  |  "}
                                      <strong style={{ color: "#2D7A52", marginLeft: "0.5rem" }}>
                                        Subjective:
                                      </strong>{" "}
                                      {submission.subjectiveScore || 0} / {submission.subjectiveTotal || 0}{" "}
                                      <span style={{ marginLeft: "0.5rem", color: "#4A9A6A" }}>
                                        (
                                        {submission.subjectiveTotal
                                          ? (
                                              ((submission.subjectiveScore || 0) /
                                                submission.subjectiveTotal) *
                                              100
                                            ).toFixed(1)
                                          : 0}
                                        %)
                                      </span>
                                    </div>
                                  ) : null}
                                </div>

                                {/* Answer Logs */}
                                {isAnswerExpanded && hasAnswerLogs && (
                                  <div
                                    style={{
                                      padding: "0.75rem",
                                      backgroundColor: "#FFF4E6",
                                      borderRadius: "0.5rem",
                                      border: "1px solid #FCD34D",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "0.85rem",
                                        color: "#B45309",
                                        marginBottom: "0.5rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Answer Change Logs (Subjective Questions)
                                    </div>
                                    {Object.entries((submission as any).answerLogs).map(
                                      ([questionId, logs]: [string, any]) => {
                                        const question = assessment.questions?.find(
                                          (q) => q.id === questionId
                                        );
                                        const questionText =
                                          question?.question || `Question ${questionId}`;
                                        
                                        // Find the graded submission for this question to get AI evaluated marks
                                        const gradedSubmission = (submission as any).submissions?.find(
                                          (s: any) => s.questionId === questionId
                                        );
                                        const marksAwarded = gradedSubmission?.marksAwarded;
                                        const maxMarks = gradedSubmission?.maxMarks;
                                        
                                        return (
                                          <div
                                            key={questionId}
                                            style={{
                                              marginBottom: "0.75rem",
                                              paddingBottom: "0.75rem",
                                              borderBottom: "1px solid #FCD34D",
                                            }}
                                          >
                                            <div
                                              style={{
                                                fontWeight: 600,
                                                color: "#92400E",
                                                marginBottom: "0.4rem",
                                              }}
                                            >
                                              {questionText}
                                            </div>
                                            {/* AI Evaluated Marks */}
                                            {marksAwarded !== undefined && maxMarks !== undefined && (
                                              <div
                                                style={{
                                                  marginBottom: "0.5rem",
                                                  padding: "0.5rem",
                                                  backgroundColor: "#f0fdf4",
                                                  borderRadius: "0.25rem",
                                                  border: "1px solid #86efac",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    fontSize: "0.85rem",
                                                    color: "#166534",
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  AI Evaluated Marks:{" "}
                                                  <span style={{ color: "#059669" }}>
                                                    {marksAwarded} / {maxMarks}
                                                  </span>
                                                </div>
                                              </div>
                                            )}
                                            <div
                                              style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "0.4rem",
                                              }}
                                            >
                                              {Array.isArray(logs) &&
                                                logs.map((log: any, logIdx: number) => (
                                                  <div
                                                    key={logIdx}
                                                    style={{
                                                      padding: "0.45rem",
                                                      backgroundColor: "#ffffff",
                                                      borderRadius: "0.25rem",
                                                      border: "1px solid #FCD34D",
                                                    }}
                                                  >
                                                    <div
                                                      style={{
                                                        fontSize: "0.83rem",
                                                        color: "#92400E",
                                                        marginBottom: "0.2rem",
                                                      }}
                                                    >
                                                      <strong>Answer {logIdx + 1}:</strong>{" "}
                                                      {log.answer || ""}
                                                    </div>
                                                    {log.timestamp && (
                                                      <div
                                                        style={{
                                                          fontSize: "0.75rem",
                                                          color: "#B45309",
                                                        }}
                                                      >
                                                        {new Date(
                                                          log.timestamp
                                                        ).toLocaleString()}
                                                      </div>
                                                    )}
                                                  </div>
                                                ))}
                                            </div>
                                          </div>
                                        );
                                      }
                                    )}
                                  </div>
                                )}

                                {/* Proctoring Logs */}
                                {isProctorExpanded && (
                                  <div
                                    style={{
                                      padding: "0.75rem",
                                      backgroundColor: "#Fef2f2",
                                      borderRadius: "0.5rem",
                                      border: "1px solid #fecaca",
                                    }}
                                  >
                                    <div
                                      style={{
                                        marginBottom: "0.5rem",
                                        color: "#1E5A3B",
                                        fontWeight: 600,
                                        fontSize: "0.9rem",
                                      }}
                                    >
                                      Proctoring Logs
                                    </div>

                                    {isLoadingProctor ? (
                                      <div
                                        style={{
                                          padding: "0.5rem",
                                          color: "#4A9A6A",
                                          fontSize: "0.85rem",
                                        }}
                                      >
                                        Loading proctoring logs...
                                      </div>
                                    ) : (
                                      <>
                                        {proctorSummary && (
                                          <ProctorSummaryCard
                                            summary={proctorSummary.summary}
                                            totalViolations={proctorSummary.totalViolations}
                                            eventTypeLabels={proctorLabels}
                                          />
                                        )}

                                        {proctorLogs.length === 0 ? (
                                          <div
                                            style={{
                                              padding: "0.75rem",
                                              color: "#4A9A6A",
                                              backgroundColor: "#E8FAF0",
                                              borderRadius: "0.5rem",
                                              border: "1px solid #A8E8BC",
                                              marginTop: "0.5rem",
                                              fontSize: "0.85rem",
                                            }}
                                          >
                                            No proctoring violations found for this candidate.
                                          </div>
                                        ) : (
                                          <div
                                            style={{
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: "0.75rem",
                                              maxHeight: "420px",
                                              overflowY: "auto",
                                              marginTop: "0.5rem",
                                            }}
                                          >
                                            {proctorLogs.map(
                                              (log: any, index2: number) => (
                                                <div
                                                  key={log._id || index2}
                                                  style={{
                                                    border: "1px solid #fecaca",
                                                    borderRadius: "0.5rem",
                                                    padding: "0.75rem",
                                                    backgroundColor: "#fef2f2",
                                                  }}
                                                >
                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      justifyContent: "space-between",
                                                      gap: "1rem",
                                                      flexWrap: "wrap",
                                                    }}
                                                  >
                                                    <div
                                                      style={{
                                                        fontWeight: 700,
                                                        color: "#dc2626",
                                                      }}
                                                    >
                                                      {proctorLabels[log.eventType] ||
                                                        log.eventType ||
                                                        "Violation"}
                                                    </div>
                                                    <div
                                                      style={{
                                                        fontSize: "0.8rem",
                                                        color: "#64748b",
                                                      }}
                                                    >
                                                      {log.timestamp
                                                        ? new Date(
                                                            log.timestamp
                                                          ).toLocaleString()
                                                        : ""}
                                                    </div>
                                                  </div>

                                                  {log.metadata &&
                                                    Object.keys(
                                                      log.metadata
                                                    ).length > 0 && (
                                                      <div
                                                        style={{
                                                          marginTop: "0.5rem",
                                                          fontSize: "0.8rem",
                                                        }}
                                                      >
                                                        <div
                                                          style={{
                                                            fontSize: "0.75rem",
                                                            color: "#64748b",
                                                            marginBottom:
                                                              "0.25rem",
                                                          }}
                                                        >
                                                          Details:
                                                        </div>
                                                        <div
                                                          style={{
                                                            backgroundColor:
                                                              "#f8fafc",
                                                            borderRadius:
                                                              "0.375rem",
                                                            padding: "0.5rem",
                                                            fontFamily:
                                                              "monospace",
                                                            fontSize: "0.75rem",
                                                          }}
                                                        >
                                                          {Object.entries(
                                                            log.metadata
                                                          ).map(
                                                            ([
                                                              key,
                                                              value,
                                                            ]) => (
                                                              <div
                                                                key={key}
                                                                style={{
                                                                  marginBottom:
                                                                    "0.25rem",
                                                                }}
                                                              >
                                                                <span
                                                                  style={{
                                                                    color:
                                                                      "#64748b",
                                                                  }}
                                                                >
                                                                  {key}:
                                                                </span>{" "}
                                                                <span
                                                                  style={{
                                                                    color:
                                                                      "#1e293b",
                                                                  }}
                                                                >
                                                                  {typeof value ===
                                                                  "object"
                                                                    ? JSON.stringify(
                                                                        value
                                                                      )
                                                                    : String(
                                                                        value
                                                                      )}
                                                                </span>
                                                              </div>
                                                            )
                                                          )}
                                                        </div>
                                                      </div>
                                                    )}

                                                  {log.snapshotBase64 && (
                                                    <div
                                                      style={{
                                                        marginTop: "0.75rem",
                                                      }}
                                                    >
                                                      <div
                                                        style={{
                                                          fontSize: "0.75rem",
                                                          color: "#64748b",
                                                          marginBottom:
                                                            "0.5rem",
                                                        }}
                                                      >
                                                        Evidence Snapshot:
                                                      </div>
                                                      <img
                                                        src={
                                                          String(
                                                            log.snapshotBase64
                                                          ).startsWith("data:")
                                                            ? log.snapshotBase64
                                                            : `data:image/png;base64,${log.snapshotBase64}`
                                                        }
                                                        alt="Violation snapshot"
                                                        style={{
                                                          maxWidth: "100%",
                                                          height: "auto",
                                                          borderRadius:
                                                            "0.375rem",
                                                          border:
                                                            "1px solid #e2e8f0",
                                                          maxHeight: "220px",
                                                        }}
                                                        onError={(e) => {
                                                          console.error(
                                                            "Error loading snapshot image:",
                                                            e
                                                          );
                                                          (e.target as HTMLImageElement).style.display =
                                                            "none";
                                                        }}
                                                      />
                                                    </div>
                                                  )}
                                                </div>
                                              )
                                            )}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
          <button type="button" onClick={() => router.push("/dashboard")} className="btn-secondary">
            ← Back to Dashboard
          </button>
          <button
            type="button"
            onClick={handleDelete}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#ef4444",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Delete Assessment
          </button>
        </div>
      </div>

      {/* Live Proctoring Dashboard */}
      {showLiveProctoring && assessmentId && typeof assessmentId === 'string' && sessionData?.user && (
        <LiveProctoringDashboard
          isOpen={showLiveProctoring}
          onClose={() => setShowLiveProctoring(false)}
          assessmentId={assessmentId}
          adminId={sessionData.user.email || sessionData.user.id || 'admin'}
        />
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;

