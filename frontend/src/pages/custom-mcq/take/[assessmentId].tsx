import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import { customMCQApi } from "../../../lib/custom-mcq/api";
import { CustomMCQAssessment, MCQQuestion, SubjectiveQuestion, Question } from "../../../types/custom-mcq";
import { useCameraProctor } from "../../../hooks/useCameraProctor";
import WebcamPreview from "../../../components/WebcamPreview";
import { ViolationToast, pushViolationToast } from "@/components/ViolationToast";
import { useProctorUpload } from "@/hooks/useProctorUpload";
// (import kept intentionally for future gateContext-based routing; currently enforced via sessionStorage flags)

export default function CustomMCQTakePage() {
  const router = useRouter();
  const { assessmentId, token } = router.query;
  const [assessment, setAssessment] = useState<CustomMCQAssessment | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({}); // For MCQ answers
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({}); // For subjective answers
  const [selectedQuestionType, setSelectedQuestionType] = useState<"mcq" | "subjective">("mcq");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [candidateInfo, setCandidateInfo] = useState<{ name: string; email: string } | null>(null);
  const [waitingForStart, setWaitingForStart] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [examStarted, setExamStarted] = useState(false); // Track if exam has been manually started (for flexible mode)
  const [cameraProctorEnabled, setCameraProctorEnabled] = useState(true);
  const [proctoringEnabled, setProctoringEnabled] = useState(false);
  const cameraStartRequestedRef = useRef(false);

  const getViolationMessage = (eventType: string): string => {
    const messages: Record<string, string> = {
      GAZE_AWAY: "Please keep your eyes on the screen",
      MULTIPLE_FACES_DETECTED: "Multiple faces detected in frame",
      NO_FACE_DETECTED: "Please stay in front of the camera",
      TAB_SWITCH: "Tab switch detected",
      FOCUS_LOST: "Window focus lost",
      FULLSCREEN_EXIT: "Exited fullscreen mode",
    };
    return messages[eventType] || "Violation detected";
  };

  const { recordViolation: recordProctorViolation } = useProctorUpload({
    assessmentId: String(assessmentId || ""),
    candidateId: candidateInfo?.email || "",
  });

  const {
    isCameraOn,
    isModelLoaded,
    facesCount,
    errors: cameraErrors,
    startCamera,
    stopCamera,
    videoRef,
    canvasRef,
  } = useCameraProctor({
    userId: candidateInfo?.email || "",
    assessmentId: String(assessmentId || ""),
    enabled: cameraProctorEnabled,
    debugMode: false,
    onViolation: (violation) => {
      pushViolationToast({
        id: `${violation.eventType}-${Date.now()}`,
        eventType: violation.eventType,
        message: getViolationMessage(violation.eventType),
        timestamp: violation.timestamp || new Date().toISOString(),
      });
    },
  });

  // Enable proctoring (tab switch / focus lost) only once exam has started
  useEffect(() => {
    if (!assessmentId) return;
    if (candidateInfo && examStarted && !submitting) {
      setProctoringEnabled(true);
    }
  }, [assessmentId, candidateInfo, examStarted, submitting]);

  // Tab visibility + focus detection (same as AI take page)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!proctoringEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        recordProctorViolation(
          {
            eventType: "TAB_SWITCH",
            timestamp: new Date().toISOString(),
            assessmentId: String(assessmentId || ""),
            candidateId: candidateInfo?.email || "",
          },
          null
        );
        pushViolationToast({
          id: `TAB_SWITCH-${Date.now()}`,
          eventType: "TAB_SWITCH",
          message: getViolationMessage("TAB_SWITCH"),
          timestamp: new Date().toISOString(),
        });
      }
    };

    const handleBlur = () => {
      recordProctorViolation(
        {
          eventType: "FOCUS_LOST",
          timestamp: new Date().toISOString(),
          assessmentId: String(assessmentId || ""),
          candidateId: candidateInfo?.email || "",
        },
        null
      );
      pushViolationToast({
        id: `FOCUS_LOST-${Date.now()}`,
        eventType: "FOCUS_LOST",
        message: getViolationMessage("FOCUS_LOST"),
        timestamp: new Date().toISOString(),
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, [proctoringEnabled, recordProctorViolation, assessmentId, candidateInfo?.email]);

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
        // Enforce unified gate completion (deep-link safety)
        const id = String(assessmentId);
        const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${id}`);
        const instructionsAcknowledged = sessionStorage.getItem(`instructionsAcknowledged_${id}`);
        const candidateRequirementsCompleted = sessionStorage.getItem(`candidateRequirementsCompleted_${id}`);
        const identityVerificationCompleted = sessionStorage.getItem(`identityVerificationCompleted_${id}`);

        if (!precheckCompleted || !instructionsAcknowledged || !candidateRequirementsCompleted || !identityVerificationCompleted) {
          router.replace(`/precheck/${id}/${encodeURIComponent(String(token))}`);
          return;
        }

        // Load candidate info from sessionStorage
        const stored = sessionStorage.getItem(`custom_mcq_${assessmentId}`);
        if (!stored) {
          router.push(`/custom-mcq/entry/${assessmentId}?token=${token}`);
          return;
        }

        const info = JSON.parse(stored);
        setCandidateInfo(info);

        // Ensure shared gate pages have access to candidate info (if user refreshes mid-flow)
        if (info?.email) sessionStorage.setItem("candidateEmail", String(info.email));
        if (info?.name) sessionStorage.setItem("candidateName", String(info.name));

        // Verify access
        await customMCQApi.verifyCandidate(assessmentId as string, token as string, info.email, info.name);

        // Load assessment (don't mark as started yet for flexible mode)
        const assessmentData = await customMCQApi.getAssessmentForTaking(assessmentId as string, token as string);
        setAssessment(assessmentData);

        // Apply runtime camera toggle based on admin proctoring setting:
        // Only explicit true enables camera/model; missing/false => OFF (per PROCTORING_AI_TOGGLE_NOTES.md)
        const aiEnabled = (assessmentData as any)?.proctoringSettings?.aiProctoringEnabled === true;
        setCameraProctorEnabled(aiEnabled);

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

  // Start/stop camera only after the exam actually starts (avoids "Camera OFF" pre-start states)
  useEffect(() => {
    if (!assessmentId) return;
    if (!cameraProctorEnabled) {
      stopCamera();
      cameraStartRequestedRef.current = false;
      return;
    }
    if (assessment && candidateInfo && examStarted && !submitting) {
      if (!cameraStartRequestedRef.current) {
        cameraStartRequestedRef.current = true;
        setTimeout(() => startCamera(), 200);
      }
      return;
    }
  }, [assessmentId, cameraProctorEnabled, assessment, candidateInfo, examStarted, submitting, startCamera, stopCamera]);

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

  const handleTextAnswerChange = (questionId: string, text: string) => {
    setTextAnswers((prev) => ({
      ...prev,
      [questionId]: text,
    }));
  };

  const handleSubmit = useCallback(async (isAuto = false) => {
    if (!assessment || !candidateInfo || submitting) return;

    try {
      setSubmitting(true);
      setError(null);
      
      // Clear the timer to prevent multiple submissions
      setTimeRemaining(0);

      // Combine MCQ and subjective answers
      const submissions = [];
      
      // Add MCQ submissions
      for (const [questionId, selectedAnswers] of Object.entries(answers)) {
        if (selectedAnswers && selectedAnswers.length > 0) {
          submissions.push({
            questionId,
            selectedAnswers,
          });
        }
      }
      
      // Add subjective submissions
      for (const [questionId, textAnswer] of Object.entries(textAnswers)) {
        if (textAnswer && textAnswer.trim()) {
          submissions.push({
            questionId,
            textAnswer: textAnswer.trim(),
          });
        }
      }

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
        `/custom-mcq/result/${assessmentId}?score=${result.score}&total=${result.totalMarks}&percentage=${result.percentage}&passed=${result.passed}&token=${token}&gradingStatus=${result.gradingStatus || "completed"}`
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

  // Set initial question type based on available questions
  useEffect(() => {
    if (!assessment || !assessment.questions || assessment.questions.length === 0) return;
    
    const questions = assessment.questions || [];
    const hasMCQ = questions.some(q => q.questionType === "mcq" || ("options" in q && "correctAn" in q));
    const hasSubjective = questions.some(q => q.questionType === "subjective" || !("options" in q && "correctAn" in q));
    const hasBothTypes = hasMCQ && hasSubjective;
    
    if (hasBothTypes) {
      // When type changes, find first question of that type
      const firstOfType = questions.findIndex(q => {
        const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
        return qType === selectedQuestionType;
      });
      if (firstOfType >= 0) {
        const currentQ = questions[currentQuestionIndex];
        const currentQType = currentQ ? (currentQ.questionType || (("options" in currentQ && "correctAn" in currentQ) ? "mcq" : "subjective")) : null;
        // Only update if current question doesn't match selected type
        if (currentQType !== selectedQuestionType) {
          setCurrentQuestionIndex(firstOfType);
        }
      }
    } else if (hasMCQ && selectedQuestionType !== "mcq") {
      setSelectedQuestionType("mcq");
    } else if (hasSubjective && !hasMCQ && selectedQuestionType !== "subjective") {
      setSelectedQuestionType("subjective");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment, selectedQuestionType]);

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
  
  // Check if we have both types
  const hasMCQ = questions.some(q => q.questionType === "mcq" || ("options" in q && "correctAn" in q));
  const hasSubjective = questions.some(q => q.questionType === "subjective" || !("options" in q && "correctAn" in q));
  const hasBothTypes = hasMCQ && hasSubjective;
  
  // Filter questions by selected type when both types exist
  const filteredQuestions = hasBothTypes 
    ? questions.filter(q => {
        const qType = (q as any).questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
        return qType === selectedQuestionType;
      })
    : questions;
  
  // Find current question index in filtered list
  const currentQuestionIndexInFiltered = filteredQuestions.findIndex(q => q.id === questions[currentQuestionIndex]?.id);
  
  // If current question is not in filtered list (type changed), go to first question of filtered type
  const currentQuestion = (currentQuestionIndexInFiltered >= 0 
    ? filteredQuestions[currentQuestionIndexInFiltered] 
    : filteredQuestions[0]) || filteredQuestions[0];
  
  const actualIndex = questions.findIndex(q => q.id === currentQuestion?.id);
  
  const isMCQ = currentQuestion && (currentQuestion.questionType === "mcq" || ("options" in currentQuestion && "correctAn" in currentQuestion));
  const currentAnswers = isMCQ ? (answers[currentQuestion?.id || ""] || []) : [];
  const currentTextAnswer = !isMCQ ? (textAnswers[currentQuestion?.id || ""] || "") : "";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#ffffff", padding: "2rem" }}>
      <ViolationToast />
      {/* Hidden canvas used by useCameraProctor to capture snapshots */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {cameraProctorEnabled && (
        <WebcamPreview
          ref={videoRef}
          cameraOn={isCameraOn}
          faceMeshStatus={cameraErrors?.length ? "error" : isModelLoaded ? "loaded" : "loading"}
          facesCount={facesCount}
        />
      )}
      <div style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", gap: "2rem" }}>
        {/* Question Type Selector (Left Panel) - Only show if both types exist */}
        {hasBothTypes && examStarted && (
          <div style={{ width: "200px", flexShrink: 0 }}>
            <div
              style={{
                padding: "1rem",
                backgroundColor: "#E8FAF0",
                border: "2px solid #A8E8BC",
                borderRadius: "0.5rem",
                position: "sticky",
                top: "2rem",
              }}
            >
              <h3 style={{ marginBottom: "1rem", color: "#1E5A3B", fontSize: "1rem" }}>Question Type</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {hasMCQ && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedQuestionType("mcq");
                      const firstMCQ = questions.findIndex(q => q.questionType === "mcq" || ("options" in q && "correctAn" in q));
                      setCurrentQuestionIndex(firstMCQ >= 0 ? firstMCQ : 0);
                    }}
                    style={{
                      padding: "0.75rem",
                      border: selectedQuestionType === "mcq" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      backgroundColor: selectedQuestionType === "mcq" ? "#C9F4D4" : "#ffffff",
                      color: "#1E5A3B",
                      fontWeight: selectedQuestionType === "mcq" ? 600 : 400,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    MCQ
                  </button>
                )}
                {hasSubjective && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedQuestionType("subjective");
                      const firstSubjective = questions.findIndex(q => q.questionType === "subjective" || !("options" in q && "correctAn" in q));
                      setCurrentQuestionIndex(firstSubjective >= 0 ? firstSubjective : 0);
                    }}
                    style={{
                      padding: "0.75rem",
                      border: selectedQuestionType === "subjective" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      backgroundColor: selectedQuestionType === "subjective" ? "#C9F4D4" : "#ffffff",
                      color: "#1E5A3B",
                      fontWeight: selectedQuestionType === "subjective" ? 600 : 400,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    Subjective
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        <div style={{ flex: 1 }}>
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
                Question {currentQuestionIndexInFiltered + 1} of {filteredQuestions.length}
                {hasBothTypes && ` (Total: ${questions.length})`}
              </span>
              <span style={{ color: "#4A9A6A", marginLeft: "1rem" }}>[{currentQuestion.section}]</span>
              <span style={{ 
                marginLeft: "1rem",
                padding: "0.25rem 0.5rem", 
                backgroundColor: isMCQ ? "#E8FAF0" : "#FFF4E6", 
                color: isMCQ ? "#1E5A3B" : "#B45309",
                borderRadius: "0.25rem",
                fontSize: "0.875rem",
                fontWeight: 600
              }}>
                {isMCQ ? "MCQ" : "Subjective"}
              </span>
            </div>

            <h2 style={{ marginBottom: "2rem", color: "#1E5A3B" }}>{currentQuestion.question}</h2>

            {isMCQ && (currentQuestion as MCQQuestion).options ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {(currentQuestion as MCQQuestion).options.map((option) => {
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
                        type={(currentQuestion as MCQQuestion).answerType === "single" ? "radio" : "checkbox"}
                        checked={isSelected}
                        onChange={() => handleAnswerChange(currentQuestion.id!, option.label, currentQuestion as MCQQuestion)}
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
            ) : (
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1E5A3B" }}>
                  Your Answer
                </label>
                <textarea
                  value={currentTextAnswer}
                  onChange={(e) => handleTextAnswerChange(currentQuestion.id!, e.target.value)}
                  placeholder="Type your answer here..."
                  rows={10}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    border: "2px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        {examStarted && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <button
            type="button"
                  onClick={() => {
                    if (hasBothTypes) {
                      // Find previous question of same type
                      for (let i = actualIndex - 1; i >= 0; i--) {
                        const q = questions[i];
                        const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
                        if (qType === selectedQuestionType) {
                          setCurrentQuestionIndex(i);
                          break;
                        }
                      }
                    } else {
                      const prevIndex = actualIndex - 1;
                      if (prevIndex >= 0) {
                        setCurrentQuestionIndex(prevIndex);
                      }
                    }
                  }}
            disabled={actualIndex === 0}
            className="btn-secondary"
            style={{
              padding: "0.75rem 1.5rem",
              opacity: actualIndex === 0 ? 0.5 : 1,
              cursor: actualIndex === 0 ? "not-allowed" : "pointer",
            }}
          >
            ← Previous
          </button>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            {questions.map((q, idx) => {
              const isQMCQ = q.questionType === "mcq" || ("options" in q && "correctAn" in q);
              const hasAnswer = isQMCQ 
                ? (answers[q.id || ""]?.length > 0)
                : (textAnswers[q.id || ""]?.trim().length > 0);
              const isCurrent = idx === actualIndex;
              const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
              const isInCurrentFilter = !hasBothTypes || qType === selectedQuestionType;
              
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (hasBothTypes) {
                      if (qType === selectedQuestionType) {
                        setCurrentQuestionIndex(idx);
                      } else {
                        // Switch to the correct type and go to this question
                        setSelectedQuestionType(qType as "mcq" | "subjective");
                        setCurrentQuestionIndex(idx);
                      }
                    } else {
                      setCurrentQuestionIndex(idx);
                    }
                  }}
                  disabled={hasBothTypes && !isInCurrentFilter}
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    border: isCurrent ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                    backgroundColor: hasAnswer ? "#C9F4D4" : isCurrent ? "#E8FAF0" : (hasBothTypes && !isInCurrentFilter ? "#f0f0f0" : "#ffffff"),
                    color: hasBothTypes && !isInCurrentFilter ? "#999" : "#1E5A3B",
                    cursor: hasBothTypes && !isInCurrentFilter ? "not-allowed" : "pointer",
                    fontWeight: isCurrent ? 700 : 400,
                    opacity: hasBothTypes && !isInCurrentFilter ? 0.5 : 1,
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {(hasBothTypes 
            ? filteredQuestions.findIndex((q, idx) => idx > currentQuestionIndexInFiltered) >= 0
            : actualIndex < questions.length - 1) ? (
            <button
              type="button"
              onClick={() => {
                if (hasBothTypes) {
                  // Find next question of same type
                  for (let i = actualIndex + 1; i < questions.length; i++) {
                    const q = questions[i];
                    const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
                    if (qType === selectedQuestionType) {
                      setCurrentQuestionIndex(i);
                      break;
                    }
                  }
                } else {
                  const nextIndex = actualIndex + 1;
                  if (nextIndex < questions.length) {
                    setCurrentQuestionIndex(nextIndex);
                  }
                }
              }}
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
    </div>
  );
}
