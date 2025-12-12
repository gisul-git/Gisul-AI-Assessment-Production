import { useState, useEffect } from "react";
import { CustomMCQAssessment } from "../../types/custom-mcq";
import { customMCQApi } from "../../lib/custom-mcq/api";
import EmailInvitationModal from "./EmailInvitationModal";

interface Station5Props {
  assessmentData: Partial<CustomMCQAssessment>;
  updateAssessmentData: (updates: Partial<CustomMCQAssessment>) => void;
  onCreateAssessment: () => void;
  loading: boolean;
  createdAssessmentUrl?: string | null;
  assessmentId?: string | null;
  router?: any;
}

export default function Station5Schedule({ assessmentData, updateAssessmentData, onCreateAssessment, loading, createdAssessmentUrl, assessmentId, router }: Station5Props) {
  const [accessMode, setAccessMode] = useState<"private" | "public">(assessmentData.accessMode || "private");
  const [examMode, setExamMode] = useState<"strict" | "flexible">(assessmentData.examMode || "strict");
  const [startTime, setStartTime] = useState(
    assessmentData.startTime ? new Date(assessmentData.startTime).toISOString().slice(0, 16) : ""
  );
  const [endTime, setEndTime] = useState(
    assessmentData.endTime ? new Date(assessmentData.endTime).toISOString().slice(0, 16) : ""
  );
  const [duration, setDuration] = useState(assessmentData.duration?.toString() || "");
  const [passPercentage, setPassPercentage] = useState(assessmentData.passPercentage?.toString() || "50");
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);

  useEffect(() => {
    updateAssessmentData({
      accessMode,
      examMode,
      startTime: startTime ? new Date(startTime).toISOString() : undefined,
      endTime: endTime ? new Date(endTime).toISOString() : undefined,
      duration: duration ? parseInt(duration) : undefined,
      passPercentage: passPercentage ? parseInt(passPercentage) : 50,
    });
  }, [accessMode, examMode, startTime, endTime, duration, passPercentage]);

  const handleSendInvitations = async (template: {
    subject: string;
    message: string;
    footer: string;
    sentBy: string;
  }) => {
    if (!assessmentId || !createdAssessmentUrl) {
      throw new Error("Assessment ID or URL is missing");
    }

    const candidates = assessmentData.candidates || [];
    if (candidates.length === 0) {
      throw new Error("No candidates found to send invitations to");
    }

    setSendingEmails(true);
    try {
      await customMCQApi.sendInvitations(assessmentId, candidates, createdAssessmentUrl, template);
    } finally {
      setSendingEmails(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: "1.5rem", color: "#1E5A3B" }}>📅 Schedule Assessment</h2>
      <p style={{ marginBottom: "2rem", color: "#2D7A52" }}>
        Configure access mode, exam timing, and pass percentage for your assessment.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {/* Access Mode */}
        <div style={{ padding: "1.5rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}>
          <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Access Mode</h3>
          <p style={{ marginBottom: "1rem", color: "#2D7A52", fontSize: "0.875rem" }}>
            Choose who can access this assessment.
          </p>
          <div style={{ display: "flex", gap: "1rem" }}>
            <label
              style={{
                flex: 1,
                padding: "1rem",
                border: accessMode === "private" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                borderRadius: "0.5rem",
                cursor: "pointer",
                backgroundColor: accessMode === "private" ? "#E8FAF0" : "#ffffff",
              }}
            >
              <input
                type="radio"
                name="accessMode"
                value="private"
                checked={accessMode === "private"}
                onChange={(e) => setAccessMode(e.target.value as "private" | "public")}
                style={{ marginRight: "0.5rem" }}
              />
              <strong style={{ color: "#1E5A3B" }}>Private</strong>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.875rem", color: "#2D7A52" }}>
                Only candidates you add can take the test
              </p>
            </label>
            <label
              style={{
                flex: 1,
                padding: "1rem",
                border: accessMode === "public" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                borderRadius: "0.5rem",
                cursor: "pointer",
                backgroundColor: accessMode === "public" ? "#E8FAF0" : "#ffffff",
              }}
            >
              <input
                type="radio"
                name="accessMode"
                value="public"
                checked={accessMode === "public"}
                onChange={(e) => setAccessMode(e.target.value as "private" | "public")}
                style={{ marginRight: "0.5rem" }}
              />
              <strong style={{ color: "#1E5A3B" }}>Public</strong>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.875rem", color: "#2D7A52" }}>
                Anyone with the assessment link can take the test
              </p>
            </label>
          </div>
        </div>

        {/* Exam Mode */}
        <div style={{ padding: "1.5rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}>
          <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Exam Mode</h3>
          <p style={{ marginBottom: "1rem", color: "#2D7A52", fontSize: "0.875rem" }}>
            Choose how the exam timing works.
          </p>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
            <label
              style={{
                flex: 1,
                padding: "1rem",
                border: examMode === "strict" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                borderRadius: "0.5rem",
                cursor: "pointer",
                backgroundColor: examMode === "strict" ? "#E8FAF0" : "#ffffff",
              }}
            >
              <input
                type="radio"
                name="examMode"
                value="strict"
                checked={examMode === "strict"}
                onChange={(e) => setExamMode(e.target.value as "strict" | "flexible")}
                style={{ marginRight: "0.5rem" }}
              />
              <strong style={{ color: "#1E5A3B" }}>Strict Window</strong>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.875rem", color: "#2D7A52" }}>
                Exam starts and ends at scheduled times
              </p>
            </label>
            <label
              style={{
                flex: 1,
                padding: "1rem",
                border: examMode === "flexible" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                borderRadius: "0.5rem",
                cursor: "pointer",
                backgroundColor: examMode === "flexible" ? "#E8FAF0" : "#ffffff",
              }}
            >
              <input
                type="radio"
                name="examMode"
                value="flexible"
                checked={examMode === "flexible"}
                onChange={(e) => setExamMode(e.target.value as "strict" | "flexible")}
                style={{ marginRight: "0.5rem" }}
              />
              <strong style={{ color: "#1E5A3B" }}>Flexible Window</strong>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.875rem", color: "#2D7A52" }}>
                Candidates can start anytime within the window, with a fixed duration
              </p>
            </label>
          </div>

          {/* Schedule Times */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                  Start Time <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                  End Time <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  style={{ width: "100%", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}
                />
              </div>
            </div>

            {/* Duration (for flexible mode) */}
            {examMode === "flexible" && (
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                  Duration (minutes) <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="e.g., 60"
                  min={1}
                  required
                  style={{ width: "100%", maxWidth: "300px", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}
                />
                <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#2D7A52" }}>
                  Candidates can start the test anytime between start and end time. Once started, they have this duration to complete.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Pass Percentage */}
        <div style={{ padding: "1.5rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}>
          <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Pass Percentage</h3>
          <p style={{ marginBottom: "1rem", color: "#2D7A52", fontSize: "0.875rem" }}>
            Set the minimum percentage required to pass the assessment.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <input
              type="number"
              value={passPercentage}
              onChange={(e) => setPassPercentage(e.target.value)}
              min={0}
              max={100}
              style={{ width: "150px", padding: "0.75rem", border: "1px solid #A8E8BC", borderRadius: "0.5rem" }}
            />
            <span style={{ fontSize: "1.25rem", color: "#1E5A3B" }}>%</span>
          </div>
        </div>

        {/* Create Button */}
        <div style={{ padding: "1.5rem", border: "2px solid #2D7A52", borderRadius: "0.5rem", backgroundColor: "#E8FAF0" }}>
          <h3 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>Ready to Create Assessment</h3>
          <p style={{ marginBottom: "1.5rem", color: "#2D7A52", fontSize: "0.875rem" }}>
            Review all settings above and click the button below to create your assessment. You'll receive a shareable link.
          </p>
          <button
            type="button"
            onClick={onCreateAssessment}
            disabled={loading}
            className="btn-primary"
            style={{ width: "100%", padding: "1rem", fontSize: "1.125rem", fontWeight: 600 }}
          >
            {loading ? "Creating Assessment..." : "✓ Create Assessment"}
          </button>
        </div>
        
        {/* Assessment URL Display - Passed from parent */}
        {createdAssessmentUrl && (
          <div id="assessment-url-section" style={{ marginTop: "2rem", padding: "1.5rem", backgroundColor: "#dcfce7", border: "2px solid #10b981", borderRadius: "0.75rem" }}>
            <h3 style={{ marginBottom: "1rem", color: "#166534" }}>✓ Assessment Created Successfully!</h3>
            <p style={{ marginBottom: "1rem", color: "#166534", fontSize: "0.875rem", fontWeight: 600 }}>
              Share this URL with your candidates:
            </p>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                value={createdAssessmentUrl}
                readOnly
                style={{
                  flex: 1,
                  minWidth: "300px",
                  padding: "0.75rem",
                  border: "1px solid #10b981",
                  borderRadius: "0.5rem",
                  backgroundColor: "#ffffff",
                  fontSize: "0.875rem",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(createdAssessmentUrl);
                  alert("URL copied to clipboard!");
                }}
                className="btn-primary"
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#10b981",
                  whiteSpace: "nowrap",
                }}
              >
                📋 Copy URL
              </button>
            </div>
            {/* Send Invitation Email Button */}
            {assessmentData.candidates && assessmentData.candidates.length > 0 && (
              <button
                type="button"
                onClick={() => setIsEmailModalOpen(true)}
                className="btn-primary"
                style={{
                  marginTop: "1rem",
                  width: "100%",
                  padding: "0.75rem",
                  backgroundColor: "#2D7A52",
                }}
                disabled={sendingEmails}
              >
                📧 Send Invitation Email
              </button>
            )}
            {router && (
              <button
                type="button"
                onClick={() => router.push("/dashboard?refresh=true")}
                className="btn-secondary"
                style={{
                  marginTop: "1rem",
                  width: "100%",
                  padding: "0.75rem",
                }}
              >
                Go to Dashboard
              </button>
            )}
          </div>
        )}
        
        {/* Email Invitation Modal */}
        {isEmailModalOpen && assessmentId && createdAssessmentUrl && (
          <EmailInvitationModal
            isOpen={isEmailModalOpen}
            onClose={() => setIsEmailModalOpen(false)}
            candidates={assessmentData.candidates || []}
            assessmentTitle={assessmentData.title || "Assessment"}
            assessmentUrl={createdAssessmentUrl}
            onSend={handleSendInvitations}
          />
        )}
      </div>
    </div>
  );
}

