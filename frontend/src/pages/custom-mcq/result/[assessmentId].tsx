import { useRouter } from "next/router";
import { useState, useEffect } from "react";

export default function CustomMCQResultPage() {
  const router = useRouter();
  const { score, total, percentage, passed, token, gradingStatus } = router.query;

  const scoreNum = parseFloat(score as string) || 0;
  const totalNum = parseFloat(total as string) || 0;
  const percentageNum = parseFloat(percentage as string) || 0;
  const passedBool = passed === "true";
  const gradingStatusStr = gradingStatus as string || "completed";

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", backgroundColor: "#E8FAF0" }}>
      <div
        style={{
          maxWidth: "600px",
          width: "100%",
          padding: "3rem",
          backgroundColor: "#ffffff",
          borderRadius: "0.75rem",
          border: "1px solid #A8E8BC",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "100px",
            height: "100px",
            borderRadius: "50%",
            backgroundColor: passedBool ? "#dcfce7" : "#fee2e2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 2rem",
            fontSize: "3rem",
          }}
        >
          {passedBool ? "✓" : "✗"}
        </div>

        <h1 style={{ marginBottom: "1rem", color: "#1E5A3B" }}>
          {passedBool ? "Congratulations!" : "Assessment Completed"}
        </h1>

        <p style={{ marginBottom: "2rem", color: "#2D7A52", fontSize: "1.125rem" }}>
          {passedBool
            ? "You have successfully passed the assessment!"
            : "Thank you for taking the assessment. Better luck next time!"}
        </p>

        <div
          style={{
            padding: "2rem",
            backgroundColor: "#E8FAF0",
            borderRadius: "0.5rem",
            marginBottom: "2rem",
            border: "1px solid #A8E8BC",
          }}
        >
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.875rem", color: "#4A9A6A", marginBottom: "0.5rem" }}>Your Score</div>
            <div style={{ fontSize: "3rem", fontWeight: 700, color: "#1E5A3B" }}>
              {scoreNum} / {totalNum}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", color: "#4A9A6A", marginBottom: "0.5rem" }}>Percentage</div>
            <div style={{ fontSize: "2rem", fontWeight: 600, color: "#2D7A52" }}>{percentageNum.toFixed(2)}%</div>
          </div>
        </div>

        <div
          style={{
            padding: "1rem",
            backgroundColor: passedBool ? "#dcfce7" : "#fee2e2",
            border: `1px solid ${passedBool ? "#10b981" : "#ef4444"}`,
            borderRadius: "0.5rem",
            color: passedBool ? "#166534" : "#991b1b",
            marginBottom: "2rem",
          }}
        >
          <strong>Status: {passedBool ? "PASSED" : "FAILED"}</strong>
        </div>

        {gradingStatusStr === "grading" && (
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#FEF3C7",
              border: "1px solid #FCD34D",
              borderRadius: "0.5rem",
              color: "#92400E",
              marginBottom: "1.5rem",
            }}
          >
            <strong>⏳ AI Grading in Progress</strong>
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
              Your subjective answers are being graded by AI. Results will be available shortly.
            </p>
          </div>
        )}

        {gradingStatusStr === "error" && (
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#FEE2E2",
              border: "1px solid #FCA5A5",
              borderRadius: "0.5rem",
              color: "#991B1B",
              marginBottom: "1.5rem",
            }}
          >
            <strong>⚠️ Grading Error</strong>
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
              There was an error during AI grading. Please contact the administrator.
            </p>
          </div>
        )}

        <p style={{ color: "#4A9A6A", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          {gradingStatusStr === "completed"
            ? "Your assessment has been submitted and graded successfully. You can close this page."
            : "Your assessment has been submitted successfully. You can close this page."}
        </p>

        <button
          type="button"
          onClick={() => window.close()}
          className="btn-secondary"
          style={{ padding: "0.75rem 2rem" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
