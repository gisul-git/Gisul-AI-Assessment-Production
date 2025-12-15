import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import { customMCQApi } from "../../../lib/custom-mcq/api";
import { CustomMCQAssessment, MCQQuestion } from "../../../types/custom-mcq";

export default function CustomMCQTakePage() {
  const router = useRouter();
  const { assessmentId, token } = router.query;
  const [assessment, setAssessment] = useState<CustomMCQAssessment | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [candidateInfo, setCandidateInfo] = useState<{ name: string; email: string } | null>(null);
  const [waitingForStart, setWaitingForStart] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [examStarted, setExamStarted] = useState(false); // Track if exam has been manually started (for flexible mode)

  // Format date and time for display
  const formatDateTime = (date: Date) => {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Load assessment and candidate info
  useEffect(() => {
    const loadAssessment = async () => {
      if (!assessmentId || !token) return;

      try {
        // Load candidate info from sessionStorage
        const stored = sessionStorage.getItem(`custom_mcq_${assessmentId}`);
        if (!stored) {
          router.push(`/custom-mcq/entry/${assessmentId}?token=${token}`);
          return;
        }

        const info = JSON.parse(stored);
        setCandidateInfo(info);

        // Verify access
        await customMCQApi.verifyCandidate(assessmentId as string, token as string, info.email, info.name);

        // Load assessment (don't mark as started yet for flexible mode)
        const assessmentData = await customMCQApi.getAssessmentForTaking(assessmentId as string, token as string);
        setAssessment(assessmentData);

        // Calculate timer based on exam mode
        const now = new Date();
        const schedule = assessmentData.schedule || {};
        const startTimeStr = schedule.startTime || assessmentData.startTime;
        const endTimeStr = schedule.endTime || assessmentData.endTime;
        const duration = schedule.duration || assessmentData.duration;

        if (assessmentData.examMode === "flexible" && duration) {
          // Flexible mode: check if we're within the window
          if (startTimeStr && endTimeStr) {
            const startTime = new Date(startTimeStr);
            const endTime = new Date(endTimeStr);
            
            if (now < startTime) {
              // Exam window hasn't opened yet
              setWaitingForStart(true);
              setStartTime(startTime);
              setTimeRemaining(null);
              setError(`Assessment will be available from ${formatDateTime(startTime)}. Please wait until the scheduled start time.`);
              return;
            } else if (now > endTime) {
              // Exam window has ended
              setTimeRemaining(0);
              setError("The assessment window has ended. You cannot take this assessment.");
              return;
            }
          }
          // Within window - show Start Exam button, don't start timer yet
          setExamStarted(false);
          setTimeRemaining(null);
          setError(null);
        } else if (assessmentData.examMode === "strict") {
          // Strict mode: exam runs from start to end time
          if (!startTimeStr || !endTimeStr) {
            setError("Exam schedule is not properly configured.");
            return;
          }
          
          const startTime = new Date(startTimeStr);
          const endTime = new Date(endTimeStr);
          
          // Validate dates
          if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
            setError("Invalid exam schedule dates.");
            return;
          }
          
          if (now < startTime) {
            // Exam hasn't started yet
            setWaitingForStart(true);
            setStartTime(startTime);
            setTimeRemaining(null);
            setError(`Assessment has not started yet. It will begin at ${formatDateTime(startTime)}. Please wait until the scheduled start time.`);
            return;
          } else if (now > endTime) {
            // Exam has ended
            setTimeRemaining(0);
            setError("The assessment has ended. You cannot take this assessment.");
            return;
          }
          
          // Strict mode: auto-start when start time arrives
          // Mark session as started in backend to prevent concurrent access
          try {
            await customMCQApi.getAssessmentForTaking(assessmentId as string, token as string, info.email, info.name);
            
            const remaining = Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 1000));
            setTimeRemaining(remaining);
            setExamStarted(true);
            setStartedAt(new Date());
          } catch (err: any) {
            setError(err.message || "Failed to start assessment");
            setLoading(false);
            return;
          }
        }
      } catch (err: any) {
        setError(err.message || "Failed to load assessment");
      } finally {
        setLoading(false);
      }
    };

    loadAssessment();
  }, [assessmentId, token, router]);

  // Auto-transition when exam time arrives (for both strict and flexible modes)
  useEffect(() => {
    if (!waitingForStart || !startTime || !assessment || !candidateInfo) return;

    const checkStartTime = async () => {
      const now = new Date();
      if (now >= startTime) {
        // Time has arrived - handle based on exam mode
        setWaitingForStart(false);
        setError(null);
        
        if (assessment.examMode === "strict") {
          // Strict mode: auto-start the exam and timer
          try {
            // Mark session as started in backend to prevent concurrent access
            await customMCQApi.getAssessmentForTaking(assessmentId as string, token as string, candidateInfo.email, candidateInfo.name);
            
            setExamStarted(true);
            
            // Recalculate timer for strict mode
            const schedule = assessment.schedule || {};
            const endTimeStr = schedule.endTime || assessment.endTime;
            
            if (endTimeStr) {
              const endTime = new Date(endTimeStr);
              const remaining = Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 1000));
              setTimeRemaining(remaining);
              setStartedAt(new Date());
            }
          } catch (err: any) {
            setError(err.message || "Failed to start assessment");
          }
        } else if (assessment.examMode === "flexible") {
          // Flexible mode: just show the "Start Exam" button (don't auto-start)
          setExamStarted(false);
          setTimeRemaining(null);
          // Error is already cleared above
        }
      }
    };

    // Check immediately
    checkStartTime();

    // Check every second until exam time arrives
    const interval = setInterval(checkStartTime, 1000);

    return () => clearInterval(interval);
  }, [waitingForStart, startTime, assessment, candidateInfo, assessmentId, token]);

  // Handle Start Exam button click (for flexible mode)
  const handleStartExam = async () => {
    if (!assessment || !candidateInfo) return;

    try {
      // Mark session as started in backend
      await customMCQApi.getAssessmentForTaking(assessmentId as string, token as string, candidateInfo.email, candidateInfo.name);
      
      // Start the timer
      const schedule = assessment.schedule || {};
      const duration = schedule.duration || assessment.duration;
      
      if (duration) {
        setTimeRemaining(duration * 60); // Convert minutes to seconds
        setStartedAt(new Date());
        setExamStarted(true);
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to start assessment");
    }
  };

  const formatTime = (seconds: number) => {
    // Validate input
    if (!seconds || isNaN(seconds) || seconds < 0) {
      return "00:00:00";
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleAnswerChange = (questionId: string, optionLabel: string, question: MCQQuestion) => {
    setAnswers((prev) => {
      const current = prev[questionId] || [];
      const isSelected = current.includes(optionLabel);

      if (question.answerType === "single") {
        return { ...prev, [questionId]: isSelected ? [] : [optionLabel] };
      } else {
        // Multiple choice
        if (isSelected) {
          return { ...prev, [questionId]: current.filter((a) => a !== optionLabel) };
        } else {
          return { ...prev, [questionId]: [...current, optionLabel] };
        }
      }
    });
  };

  const handleSubmit = useCallback(async (isAuto = false) => {
    if (!assessment || !candidateInfo || submitting) return;

    try {
      setSubmitting(true);
      setError(null);
      
      // Clear the timer to prevent multiple submissions
      setTimeRemaining(0);

      const submissions = Object.entries(answers).map(([questionId, selectedAnswers]) => ({
        questionId,
        selectedAnswers,
      }));

      const result = await customMCQApi.submitAssessment(
        assessmentId as string,
        token as string,
        candidateInfo.email,
        candidateInfo.name,
        submissions,
        startedAt || new Date(),
        new Date()
      );

      // Clear session storage
      sessionStorage.removeItem(`custom_mcq_${assessmentId}`);

      // Redirect to results page
      router.push(
        `/custom-mcq/result/${assessmentId}?score=${result.score}&total=${result.totalMarks}&percentage=${result.percentage}&passed=${result.passed}&token=${token}`
      );
    } catch (err: any) {
      setError(err.message || "Failed to submit assessment");
      setSubmitting(false);
    }
  }, [assessment, candidateInfo, submitting, answers, assessmentId, token, startedAt, router]);

  // Auto-submit when timer reaches zero
  useEffect(() => {
    if (timeRemaining === 0 && !submitting && assessment && candidateInfo && !waitingForStart) {
      // Timer has reached zero - auto-submit
      handleSubmit(true);
    }
  }, [timeRemaining, submitting, assessment, candidateInfo, waitingForStart, handleSubmit]);

  // Timer countdown
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0 || isNaN(timeRemaining) || waitingForStart) {
      return;
    }

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1 || isNaN(prev || 0)) {
          // Set to 0 to trigger auto-submit
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining, waitingForStart]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div>Loading assessment...</div>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center" }}>
          <h1>Error</h1>
          <p>Assessment not found</p>
        </div>
      </div>
    );
  }

  // Show waiting screen if exam hasn't started yet (strict mode) or window hasn't opened (flexible mode)
  if (waitingForStart && error) {
    const isNotStartedError = error.includes("Assessment has not started") || error.includes("Assessment will be available");
    const isStrictMode = assessment?.examMode === "strict";
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", backgroundColor: "#E8FAF0" }}>
        <div style={{ textAlign: "center", maxWidth: "600px" }}>
          <h1 style={{ color: "#1E5A3B", marginBottom: "1rem" }}>
            {isNotStartedError ? "Assessment not started" : "Error"}
          </h1>
          <p style={{ color: "#2D7A52", fontSize: "1.125rem" }}>{error}</p>
          {startTime && isStrictMode && (
            <div style={{ marginTop: "2rem", padding: "1rem", backgroundColor: "#ffffff", borderRadius: "0.5rem", border: "1px solid #A8E8BC" }}>
              <p style={{ color: "#4A9A6A", fontSize: "0.875rem" }}>
                The assessment will automatically start when the scheduled time arrives. This page will refresh automatically.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show Start Exam screen for flexible mode (within window but not started)
  if (assessment?.examMode === "flexible" && !examStarted && !waitingForStart) {
    const schedule = assessment.schedule || {};
    const endTimeStr = schedule.endTime || assessment.endTime;
    const duration = schedule.duration || assessment.duration;
    const endTime = endTimeStr ? new Date(endTimeStr) : null;
    const now = new Date();
    
    // Check if window has ended
    if (endTime && now > endTime) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", backgroundColor: "#fee2e2" }}>
          <div style={{ textAlign: "center", maxWidth: "600px" }}>
            <h1 style={{ color: "#991b1b", marginBottom: "1rem" }}>Assessment Window Ended</h1>
            <p style={{ color: "#991b1b", fontSize: "1.125rem" }}>The assessment window has ended. You cannot start this assessment.</p>
          </div>
        </div>
      );
    }

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", backgroundColor: "#E8FAF0" }}>
        <div style={{ textAlign: "center", maxWidth: "600px", padding: "3rem", backgroundColor: "#ffffff", borderRadius: "1rem", border: "2px solid #A8E8BC" }}>
          <h1 style={{ color: "#1E5A3B", marginBottom: "1rem", fontSize: "2rem" }}>{assessment.title}</h1>
          {candidateInfo && (
            <p style={{ color: "#2D7A52", fontSize: "1rem", marginBottom: "2rem" }}>
              {candidateInfo.name} ({candidateInfo.email})
            </p>
          )}
          <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#E8FAF0", borderRadius: "0.5rem" }}>
            <p style={{ color: "#4A9A6A", fontSize: "1rem", marginBottom: "0.5rem" }}>
              <strong>Duration:</strong> {duration} minutes
            </p>
            {endTime && (
              <p style={{ color: "#4A9A6A", fontSize: "0.875rem" }}>
                You must complete the assessment before {formatDateTime(endTime)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleStartExam}
            className="btn-primary"
            style={{
              padding: "1rem 3rem",
              fontSize: "1.25rem",
              backgroundColor: "#10b981",
              border: "none",
              borderRadius: "0.5rem",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            }}
          >
            Start Assessment
          </button>
          <p style={{ color: "#6B7280", fontSize: "0.875rem", marginTop: "1.5rem" }}>
            Once you start, the timer will begin and you must complete the assessment within the allocated time.
          </p>
        </div>
      </div>
    );
  }

  const questions = assessment.questions || [];
  const currentQuestion = questions[currentQuestionIndex];
  const currentAnswers = answers[currentQuestion?.id || ""] || [];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#ffffff", padding: "2rem" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        {/* Header with Timer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "1rem 1.5rem",
            backgroundColor: "#E8FAF0",
            border: "1px solid #A8E8BC",
            borderRadius: "0.5rem",
            marginBottom: "2rem",
          }}
        >
          <div>
            <h1 style={{ margin: 0, color: "#1E5A3B", fontSize: "1.5rem" }}>{assessment.title}</h1>
            {candidateInfo && (
              <p style={{ margin: "0.5rem 0 0 0", color: "#2D7A52", fontSize: "0.875rem" }}>
                {candidateInfo.name} ({candidateInfo.email})
              </p>
            )}
          </div>
          {timeRemaining !== null && !isNaN(timeRemaining) && (
            <div
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: timeRemaining < 300 ? "#fee2e2" : "#ffffff",
                border: `2px solid ${timeRemaining < 300 ? "#ef4444" : "#2D7A52"}`,
                borderRadius: "0.5rem",
                fontSize: "1.5rem",
                fontWeight: 700,
                color: timeRemaining < 300 ? "#991b1b" : "#1E5A3B",
              }}
            >
              {formatTime(timeRemaining)}
            </div>
          )}
        </div>

        {error && !waitingForStart && (
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#fee2e2",
              border: "1px solid #ef4444",
              borderRadius: "0.5rem",
              color: "#991b1b",
              marginBottom: "1.5rem",
            }}
          >
            {error}
          </div>
        )}

        {/* Question */}
        {currentQuestion && examStarted && (
          <div
            style={{
              padding: "2rem",
              backgroundColor: "#ffffff",
              border: "1px solid #A8E8BC",
              borderRadius: "0.75rem",
              marginBottom: "2rem",
            }}
          >
            <div style={{ marginBottom: "1.5rem" }}>
              <span style={{ color: "#2D7A52", fontWeight: 600 }}>
                Question {currentQuestionIndex + 1} of {questions.length}
              </span>
              <span style={{ color: "#4A9A6A", marginLeft: "1rem" }}>[{currentQuestion.section}]</span>
            </div>

            <h2 style={{ marginBottom: "2rem", color: "#1E5A3B" }}>{currentQuestion.question}</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {currentQuestion.options.map((option) => {
                const isSelected = currentAnswers.includes(option.label);
                return (
                  <label
                    key={option.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "1rem",
                      border: isSelected ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      backgroundColor: isSelected ? "#E8FAF0" : "#ffffff",
                      transition: "all 0.2s",
                    }}
                  >
                    <input
                      type={currentQuestion.answerType === "single" ? "radio" : "checkbox"}
                      checked={isSelected}
                      onChange={() => handleAnswerChange(currentQuestion.id!, option.label, currentQuestion)}
                      style={{ marginRight: "1rem", width: "20px", height: "20px" }}
                    />
                    <div>
                      <strong style={{ color: "#1E5A3B", marginRight: "0.5rem" }}>{option.label}:</strong>
                      <span style={{ color: "#2D7A52" }}>{option.text}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Navigation */}
        {examStarted && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <button
            type="button"
            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
            disabled={currentQuestionIndex === 0}
            className="btn-secondary"
            style={{
              padding: "0.75rem 1.5rem",
              opacity: currentQuestionIndex === 0 ? 0.5 : 1,
              cursor: currentQuestionIndex === 0 ? "not-allowed" : "pointer",
            }}
          >
            ← Previous
          </button>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            {questions.map((_, idx) => {
              const hasAnswer = answers[questions[idx].id || ""]?.length > 0;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentQuestionIndex(idx)}
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    border: idx === currentQuestionIndex ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                    backgroundColor: hasAnswer ? "#C9F4D4" : idx === currentQuestionIndex ? "#E8FAF0" : "#ffffff",
                    color: "#1E5A3B",
                    cursor: "pointer",
                    fontWeight: idx === currentQuestionIndex ? 700 : 400,
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {currentQuestionIndex < questions.length - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentQuestionIndex(Math.min(questions.length - 1, currentQuestionIndex + 1))}
              className="btn-primary"
              style={{ padding: "0.75rem 1.5rem" }}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={submitting}
              className="btn-primary"
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#10b981",
                opacity: submitting ? 0.5 : 1,
              }}
            >
              {submitting ? "Submitting..." : "✓ Submit Assessment"}
            </button>
          )}
          </div>
        )}

        {/* Submit Button (always visible when exam started) */}
        {examStarted && (
          <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <button
            type="button"
            onClick={() => {
              if (confirm("Are you sure you want to submit? You cannot retake this assessment.")) {
                handleSubmit();
              }
            }}
            disabled={submitting}
            className="btn-primary"
            style={{
              padding: "1rem 2rem",
              fontSize: "1.125rem",
              backgroundColor: "#10b981",
              opacity: submitting ? 0.5 : 1,
            }}
          >
            {submitting ? "Submitting..." : "✓ Submit All Answers"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

