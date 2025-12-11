import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import { customMCQApi } from "../../lib/custom-mcq/api";
import { CustomMCQAssessment, AssessmentSubmission } from "../../types/custom-mcq";

interface CustomMCQDetailsPageProps {
  session: any;
}

export default function CustomMCQDetailsPage({ session }: CustomMCQDetailsPageProps) {
  const router = useRouter();
  const { assessmentId } = router.query;
  const [assessment, setAssessment] = useState<CustomMCQAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {submissions.map((submission: AssessmentSubmission & { candidateKey: string }, idx: number) => {
                const candidateInfo = submission.candidateInfo || {};
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "1.5rem",
                      border: "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      backgroundColor: "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "1rem" }}>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ marginBottom: "0.5rem", color: "#1E5A3B" }}>
                          {candidateInfo.name || "Unknown"}
                        </h3>
                        <p style={{ color: "#2D7A52", marginBottom: "0.5rem" }}>{candidateInfo.email || "N/A"}</p>
                        <div style={{ display: "flex", gap: "2rem", marginTop: "1rem", flexWrap: "wrap" }}>
                          <div>
                            <strong style={{ color: "#2D7A52" }}>Score:</strong> {submission.score || 0} / {submission.totalMarks || 0}
                          </div>
                          <div>
                            <strong style={{ color: "#2D7A52" }}>Percentage:</strong> {submission.percentage?.toFixed(2) || 0}%
                          </div>
                          <div>
                            <strong style={{ color: "#2D7A52" }}>Status:</strong>{" "}
                            <span
                              style={{
                                padding: "0.25rem 0.5rem",
                                borderRadius: "0.25rem",
                                backgroundColor: submission.passed ? "#dcfce7" : "#fee2e2",
                                color: submission.passed ? "#166534" : "#991b1b",
                                fontWeight: 600,
                              }}
                            >
                              {submission.passed ? "PASSED" : "FAILED"}
                            </span>
                          </div>
                        </div>
                        {submission.startedAt && (
                          <div style={{ marginTop: "0.5rem", color: "#4A9A6A", fontSize: "0.875rem" }}>
                            <strong>Started:</strong> {new Date(submission.startedAt).toLocaleString()}
                          </div>
                        )}
                        {submission.submittedAt && (
                          <div style={{ marginTop: "0.5rem", color: "#4A9A6A", fontSize: "0.875rem" }}>
                            <strong>Submitted:</strong> {new Date(submission.submittedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;

