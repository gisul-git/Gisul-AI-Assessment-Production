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
  
  // Use refs to always access the latest state values in callbacks
  const answersRef = useRef<Record<string, string[]>>({});
  const textAnswersRef = useRef<Record<string, string>>({});
  
  // Track previous answers to detect changes for logging
  const previousTextAnswersRef = useRef<Record<string, string>>({});
  
  // Keep refs in sync with state
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  
  useEffect(() => {
    textAnswersRef.current = textAnswers;
  }, [textAnswers]);
  
  // Sequential flow: MCQ first, then Subjective
  const [assessmentPhase, setAssessmentPhase] = useState<"mcq" | "subjective">("mcq");
  const [mcqSubmitted, setMcqSubmitted] = useState(false);
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

        // NEW IMPLEMENTATION: Use accessControl from backend
        const accessControl = assessmentData.accessControl;
        const schedule = assessmentData.schedule || {};
        const startTimeStr = schedule.startTime || assessmentData.startTime;
        
        if (accessControl) {
          if (!accessControl.canAccess) {
            // Cannot access - show error message
            setError(accessControl.errorMessage || "You cannot access this assessment at this time.");
            setWaitingForStart(false);
            setExamStarted(false);
            setTimeRemaining(null);
            return;
          }
          
          if (accessControl.waitingForStart) {
            // Can access but waiting for start (strict mode - pre-check phase)
            if (startTimeStr) {
              const startTime = new Date(startTimeStr);
              setWaitingForStart(true);
              setStartTime(startTime);
              setExamStarted(false);
              setTimeRemaining(null);
              setError(null); // Clear error, show waiting message in UI
            }
            return;
          }
          
          if (accessControl.examStarted) {
            // Exam has started (both strict and flexible mode now auto-start)
            setWaitingForStart(false);
            setExamStarted(true);
            setTimeRemaining(accessControl.timeRemaining || null);
            setStartedAt(new Date());
            setError(null);
          } else if (accessControl.canStart) {
            // Can start - this shouldn't happen now as flexible mode auto-starts
            // But keep as fallback
            setWaitingForStart(false);
            setExamStarted(true);
            setTimeRemaining(accessControl.timeRemaining || null);
            setStartedAt(new Date());
            setError(null);
          }
        } else {
          // Fallback if accessControl not available (shouldn't happen)
          setError("Assessment access information is not available.");
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

  // Auto-transition when exam time arrives (strict mode only - for pre-check to exam start)
  useEffect(() => {
    if (!waitingForStart || !startTime || !assessment || !candidateInfo || assessment.examMode !== "strict") return;

    const checkStartTime = async () => {
      const now = new Date();
      if (now >= startTime) {
        // Start time has arrived - reload assessment to get updated accessControl
        try {
          const updatedAssessment = await customMCQApi.getAssessmentForTaking(
            assessmentId as string,
            token as string,
            candidateInfo.email,
            candidateInfo.name
          );
          
          setAssessment(updatedAssessment);
          
          // Update state based on new accessControl
          const accessControl = updatedAssessment.accessControl;
          if (accessControl?.examStarted) {
            setWaitingForStart(false);
            setExamStarted(true);
            setTimeRemaining(accessControl.timeRemaining || null);
            setStartedAt(new Date());
            setError(null);
          }
        } catch (err: any) {
          setError(err.message || "Failed to start assessment");
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
      // Reload assessment to get latest accessControl
      const updatedAssessment = await customMCQApi.getAssessmentForTaking(
        assessmentId as string,
        token as string,
        candidateInfo.email,
        candidateInfo.name
      );
      
      setAssessment(updatedAssessment);
      
      // Start the timer based on duration
      const schedule = updatedAssessment.schedule || {};
      const duration = schedule.duration || updatedAssessment.duration;
      
      if (duration) {
        setTimeRemaining(duration * 60); // Convert minutes to seconds
        setStartedAt(new Date());
        setExamStarted(true);
        setError(null);
      } else {
        setError("Assessment duration is not configured.");
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
    console.log(`Updating text answer for question ${questionId}, length: ${text.length}`);
    setTextAnswers((prev) => {
      const updated = {
        ...prev,
        [questionId]: text,
      };
      console.log("Text answers state updated:", Object.keys(updated).length, "questions");
      return updated;
    });
  };

  // Save answer log for subjective questions
  const saveAnswerLog = async (questionId: string, answer: string, forceSave = false) => {
    if (!assessment || !candidateInfo || !assessmentId || !token) return;
    
    // Only save if answer has changed (unless forceSave is true)
    if (!forceSave) {
      const previousAnswer = previousTextAnswersRef.current[questionId] || "";
      if (previousAnswer.trim() === answer.trim()) {
        // Answer unchanged, don't save
        return;
      }
    }
    
    try {
      await customMCQApi.saveAnswerLog(
        assessmentId as string,
        token as string,
        candidateInfo.email,
        candidateInfo.name,
        questionId,
        answer
      );
      // Update previous answer after successful save
      previousTextAnswersRef.current[questionId] = answer;
    } catch (err) {
      console.error("Failed to save answer log:", err);
      // Don't show error to user, just log it
    }
  };

  // Save all current subjective answers as logs (for auto-save on timer end)
  const saveAllAnswerLogs = async () => {
    if (!assessment || !candidateInfo || !assessmentId || !token) return;
    
    const currentTextAnswers = textAnswersRef.current;
    const subjectiveQuestions = (assessment.questions || []).filter(q => {
      const qType = q.questionType || (!("options" in q && "correctAn" in q) ? "subjective" : "mcq");
      return qType === "subjective";
    });
    
    // Save logs for all subjective questions with answers
    // Always save if answer exists (even if same as previous) to ensure all answers are logged
    for (const question of subjectiveQuestions) {
      const questionId = question.id;
      if (questionId && currentTextAnswers[questionId]) {
        const answer = currentTextAnswers[questionId];
        if (answer && answer.trim()) {
          // Always try to save - backend will check for duplicates
          await saveAnswerLog(questionId, answer, true);
        }
      }
    }
  };

  const handleSubmit = useCallback(async (isAuto = false) => {
    if (!assessment || !candidateInfo || submitting) return;

    try {
      setSubmitting(true);
      setError(null);
      
      // Clear the timer to prevent multiple submissions
      setTimeRemaining(0);

      // Get latest values from refs to avoid closure issues
      const currentAnswers = answersRef.current;
      const currentTextAnswers = textAnswersRef.current;
      
      // Combine MCQ and subjective answers
      const submissions: Array<{ questionId: string; selectedAnswers?: string[]; textAnswer?: string }> = [];
      
      // Debug: Log current state before building submissions
      console.log("Pre-submission state:", {
        answersKeys: Object.keys(currentAnswers),
        textAnswersKeys: Object.keys(currentTextAnswers),
        textAnswersValues: Object.entries(currentTextAnswers).map(([id, text]) => ({ id, textLength: text?.length || 0, textPreview: text?.substring(0, 50) || "" })),
        assessmentQuestions: assessment.questions?.map(q => ({ id: q.id, type: q.questionType || ("options" in q ? "mcq" : "subjective") }))
      });
      
      // Add MCQ submissions
      for (const [questionId, selectedAnswers] of Object.entries(currentAnswers)) {
        if (selectedAnswers && selectedAnswers.length > 0) {
          submissions.push({
            questionId,
            selectedAnswers,
          });
        }
      }
      
      // Add subjective submissions - check all questions to ensure we don't miss any
      const subjectiveQuestionIds = assessment.questions
        ?.filter(q => {
          const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
          return qType === "subjective";
        })
        .map(q => q.id)
        .filter((id): id is string => Boolean(id)) || [];
      
      console.log("Subjective question IDs from assessment:", subjectiveQuestionIds);
      console.log("Text answers in state:", Object.keys(currentTextAnswers));
      console.log("All text answers:", Object.entries(currentTextAnswers).map(([id, text]) => ({ id, hasText: !!text, length: text?.length || 0 })));
      
      // Save all answer logs before final submission
      await saveAllAnswerLogs();
      
      // First, add from textAnswers state
      for (const [questionId, textAnswer] of Object.entries(currentTextAnswers)) {
        if (questionId && textAnswer && textAnswer.trim()) {
          submissions.push({
            questionId,
            textAnswer: textAnswer.trim(),
          });
        }
      }
      
      // Also check if there are subjective questions that might not be in textAnswers
      for (const questionId of subjectiveQuestionIds) {
        if (questionId && !submissions.some(s => s.questionId === questionId)) {
          const textAnswer = currentTextAnswers[questionId];
          if (textAnswer && textAnswer.trim()) {
            submissions.push({
              questionId,
              textAnswer: textAnswer.trim(),
            });
          }
        }
      }
      
      // Debug: Log submission details
      console.log("Submitting assessment:", {
        totalSubmissions: submissions.length,
        mcqSubmissions: submissions.filter(s => s.selectedAnswers).length,
        subjectiveSubmissions: submissions.filter(s => s.textAnswer).length,
        submissions: submissions,
        subjectiveQuestionIds: subjectiveQuestionIds
      });

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
      const mcqScore = result.mcqScore ?? 0;
      const mcqTotal = result.mcqTotal ?? 0;
      const subjectiveScore = result.subjectiveScore ?? 0;
      const subjectiveTotal = result.subjectiveTotal ?? 0;
      const showResult = result.showResultToCandidate !== false; // Default to true if not specified
      router.push(
        `/custom-mcq/result/${assessmentId}?score=${result.score}&total=${result.totalMarks}&percentage=${result.percentage}&passed=${result.passed}&token=${token}&gradingStatus=${result.gradingStatus || "completed"}&mcqScore=${mcqScore}&mcqTotal=${mcqTotal}&subjectiveScore=${subjectiveScore}&subjectiveTotal=${subjectiveTotal}&showResult=${showResult}`
      );
    } catch (err: any) {
      setError(err.message || "Failed to submit assessment");
      setSubmitting(false);
    }
  }, [assessment, candidateInfo, submitting, answers, assessmentId, token, startedAt, router]);

  // Auto-submit when timer reaches zero
  useEffect(() => {
    if (timeRemaining === 0 && !submitting && assessment && candidateInfo && !waitingForStart) {
      // Timer has reached zero - save all answer logs first, then auto-submit
      saveAllAnswerLogs().then(() => {
        handleSubmit(true);
      }).catch(() => {
        // Even if log save fails, still submit
        handleSubmit(true);
      });
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

  // Initialize assessment phase and load MCQ submitted status from session
  useEffect(() => {
    if (!assessment || !assessment.questions || assessment.questions.length === 0) return;
    
    const questions = assessment.questions || [];
    const hasMCQ = questions.some(q => q.questionType === "mcq" || ("options" in q && "correctAn" in q));
    const hasSubjective = questions.some(q => q.questionType === "subjective" || !("options" in q && "correctAn" in q));
    
    // Check if MCQ was already submitted (from session storage)
    const mcqSubmittedKey = `mcqSubmitted_${assessmentId}`;
    const savedMcqSubmitted = sessionStorage.getItem(mcqSubmittedKey) === "true";
    
    if (savedMcqSubmitted) {
      setMcqSubmitted(true);
      setAssessmentPhase("subjective");
      // Go to first subjective question
      const firstSubjective = questions.findIndex(q => {
        const qType = q.questionType || (!("options" in q && "correctAn" in q) ? "subjective" : "mcq");
        return qType === "subjective";
      });
      if (firstSubjective >= 0) {
        setCurrentQuestionIndex(firstSubjective);
      }
    } else if (hasMCQ) {
      // Start with MCQ phase
      setAssessmentPhase("mcq");
      setMcqSubmitted(false);
      // Go to first MCQ question
      const firstMCQ = questions.findIndex(q => {
        const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
        return qType === "mcq";
      });
      if (firstMCQ >= 0) {
        setCurrentQuestionIndex(firstMCQ);
      }
    } else if (hasSubjective) {
      // Only subjective questions, start with subjective
      setAssessmentPhase("subjective");
      setCurrentQuestionIndex(0);
    }
  }, [assessment, assessmentId]);

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

  // Show waiting screen for strict mode pre-check phase or access denied
  if (waitingForStart || (error && !examStarted)) {
    const isStrictMode = assessment?.examMode === "strict";
    const schedule = assessment?.schedule || {};
    const startTimeStr = schedule.startTime || assessment?.startTime;
    const startTimeDate = startTimeStr ? new Date(startTimeStr) : null;
    
    // If in strict mode pre-check phase, show pre-check screen
    if (waitingForStart && isStrictMode && startTimeDate) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", backgroundColor: "#E8FAF0" }}>
          <div style={{ textAlign: "center", maxWidth: "600px" }}>
            <h1 style={{ color: "#1E5A3B", marginBottom: "1rem" }}>Pre-Check Phase</h1>
            <p style={{ color: "#2D7A52", fontSize: "1.125rem", marginBottom: "2rem" }}>
              You can complete pre-checks now. The assessment will start automatically at the scheduled time.
            </p>
            <div style={{ padding: "1.5rem", backgroundColor: "#ffffff", borderRadius: "0.5rem", border: "2px solid #2D7A52", marginBottom: "2rem" }}>
              <p style={{ color: "#1E5A3B", fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Assessment starts at
              </p>
              <p style={{ color: "#2D7A52", fontSize: "1.5rem", fontWeight: 700 }}>
                {formatDateTime(startTimeDate)}
              </p>
            </div>
            <div style={{ padding: "1rem", backgroundColor: "#ffffff", borderRadius: "0.5rem", border: "1px solid #A8E8BC" }}>
              <p style={{ color: "#4A9A6A", fontSize: "0.875rem" }}>
                The assessment will automatically start when the scheduled time arrives. This page will refresh automatically.
              </p>
            </div>
          </div>
        </div>
      );
    }
    
    // Otherwise show error/access denied screen
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", backgroundColor: "#E8FAF0" }}>
        <div style={{ textAlign: "center", maxWidth: "600px" }}>
          <h1 style={{ color: "#1E5A3B", marginBottom: "1rem" }}>Access Denied</h1>
          <p style={{ color: "#2D7A52", fontSize: "1.125rem" }}>{error || "You cannot access this assessment at this time."}</p>
        </div>
      </div>
    );
  }

  // Flexible mode now auto-starts after pre-checks (no "Start Exam" button needed)
  // Access restrictions are handled at the entry/login page level

  const questions = assessment.questions || [];
  
  // Check if we have both types
  const hasMCQ = questions.some(q => q.questionType === "mcq" || ("options" in q && "correctAn" in q));
  const hasSubjective = questions.some(q => q.questionType === "subjective" || !("options" in q && "correctAn" in q));
  const hasBothTypes = hasMCQ && hasSubjective;
  
  // Filter questions by current phase (MCQ first, then Subjective)
  const filteredQuestions = hasBothTypes 
    ? questions.filter(q => {
        const qType = (q as any).questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
        if (assessmentPhase === "mcq") {
          return qType === "mcq";
        } else {
          return qType === "subjective";
        }
      })
    : questions;
  
  // Find current question index in filtered list
  const currentQuestionIndexInFiltered = filteredQuestions.findIndex(q => q.id === questions[currentQuestionIndex]?.id);
  
  // If current question is not in filtered list (phase changed), go to first question of current phase
  const currentQuestion = (currentQuestionIndexInFiltered >= 0 
    ? filteredQuestions[currentQuestionIndexInFiltered] 
    : filteredQuestions[0]) || filteredQuestions[0];
  
  const actualIndex = questions.findIndex(q => q.id === currentQuestion?.id);
  
  const isMCQ = currentQuestion && (currentQuestion.questionType === "mcq" || ("options" in currentQuestion && "correctAn" in currentQuestion));
  const currentAnswers = isMCQ ? (answers[currentQuestion?.id || ""] || []) : [];
  const currentTextAnswer = !isMCQ ? (textAnswers[currentQuestion?.id || ""] || "") : "";
  
  // Handle MCQ section submission
  const handleSubmitMCQSection = () => {
    if (!hasMCQ) return;
    setMcqSubmitted(true);
    setAssessmentPhase("subjective");
    // Save to session storage
    sessionStorage.setItem(`mcqSubmitted_${assessmentId}`, "true");
    // Go to first subjective question
    const firstSubjective = questions.findIndex(q => {
      const qType = q.questionType || (!("options" in q && "correctAn" in q) ? "subjective" : "mcq");
      return qType === "subjective";
    });
    if (firstSubjective >= 0) {
      setCurrentQuestionIndex(firstSubjective);
    }
  };

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
        {/* Phase Indicator (Left Panel) - Only show if both types exist */}
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
              <h3 style={{ marginBottom: "1rem", color: "#1E5A3B", fontSize: "1rem" }}>Section</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {hasMCQ && (
                  <div
                    style={{
                      padding: "0.75rem",
                      border: assessmentPhase === "mcq" ? "2px solid #2D7A52" : mcqSubmitted ? "1px solid #10b981" : "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      backgroundColor: assessmentPhase === "mcq" ? "#C9F4D4" : mcqSubmitted ? "#dcfce7" : "#ffffff",
                      color: "#1E5A3B",
                      fontWeight: assessmentPhase === "mcq" ? 600 : 400,
                      textAlign: "left",
                      opacity: mcqSubmitted && assessmentPhase !== "mcq" ? 0.7 : 1,
                    }}
                  >
                    <div>MCQ</div>
                    {mcqSubmitted && (
                      <div style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "0.25rem" }}>✓ Completed</div>
                    )}
                    {assessmentPhase === "mcq" && (
                      <div style={{ fontSize: "0.75rem", color: "#2D7A52", marginTop: "0.25rem" }}>Current</div>
                    )}
                  </div>
                )}
                {hasSubjective && (
                  <div
                    style={{
                      padding: "0.75rem",
                      border: assessmentPhase === "subjective" ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                      borderRadius: "0.5rem",
                      backgroundColor: assessmentPhase === "subjective" ? "#C9F4D4" : "#ffffff",
                      color: "#1E5A3B",
                      fontWeight: assessmentPhase === "subjective" ? 600 : 400,
                      textAlign: "left",
                      opacity: !mcqSubmitted && hasMCQ ? 0.5 : 1,
                    }}
                  >
                    <div>Subjective</div>
                    {assessmentPhase === "subjective" && (
                      <div style={{ fontSize: "0.75rem", color: "#2D7A52", marginTop: "0.25rem" }}>Current</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        <div style={{ flex: 1 }}>
        {/* Header with Timer and Submit Button */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
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
            {examStarted && (
              <button
                type="button"
                onClick={async () => {
                  // Save all answer logs before submitting
                  await saveAllAnswerLogs();
                  
                  if (confirm("Are you sure you want to submit the entire assessment? You cannot retake this assessment.")) {
                    handleSubmit();
                  }
                }}
                disabled={submitting}
                className="btn-primary"
                style={{
                  padding: "0.75rem 1.5rem",
                  fontSize: "1rem",
                  backgroundColor: "#10b981",
                  border: "none",
                  borderRadius: "0.5rem",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: submitting ? "not-allowed" : "pointer",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? "Submitting..." : "Submit All Answers"}
              </button>
            )}
          </div>
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
                {assessmentPhase === "mcq" 
                  ? `MCQ Question ${currentQuestionIndexInFiltered + 1} of ${filteredQuestions.length}`
                  : `Subjective Question ${currentQuestionIndexInFiltered + 1} of ${filteredQuestions.length}`
                }
              </span>
              <span style={{ color: "#4A9A6A", marginLeft: "1rem" }}>[{currentQuestion.section}]</span>
              {mcqSubmitted && isMCQ && (
                <span style={{ 
                  marginLeft: "1rem",
                  padding: "0.25rem 0.5rem", 
                  backgroundColor: "#fee2e2", 
                  color: "#991b1b",
                  borderRadius: "0.25rem",
                  fontSize: "0.875rem",
                  fontWeight: 600
                }}>
                  Locked
                </span>
              )}
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
                        cursor: mcqSubmitted && isMCQ ? "not-allowed" : "pointer",
                        backgroundColor: isSelected ? "#E8FAF0" : "#ffffff",
                        transition: "all 0.2s",
                        opacity: mcqSubmitted && isMCQ ? 0.6 : 1,
                      }}
                    >
                      <input
                        type={(currentQuestion as MCQQuestion).answerType === "single" ? "radio" : "checkbox"}
                        checked={isSelected}
                        onChange={() => handleAnswerChange(currentQuestion.id!, option.label, currentQuestion as MCQQuestion)}
                        disabled={mcqSubmitted && isMCQ}
                        style={{ 
                          marginRight: "1rem", 
                          width: "20px", 
                          height: "20px",
                          cursor: mcqSubmitted && isMCQ ? "not-allowed" : "pointer",
                          opacity: mcqSubmitted && isMCQ ? 0.5 : 1
                        }}
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
                  onChange={(e) => {
                    const questionId = currentQuestion?.id;
                    if (!questionId) {
                      console.error("Cannot save text answer: question ID is missing", currentQuestion);
                      return;
                    }
                    console.log(`Textarea onChange: questionId=${questionId}, text length=${e.target.value.length}`);
                    handleTextAnswerChange(questionId, e.target.value);
                  }}
                  placeholder="Type your answer here..."
                  rows={10}
                  disabled={assessmentPhase !== "subjective"}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    border: "2px solid #A8E8BC",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                    opacity: assessmentPhase !== "subjective" ? 0.6 : 1,
                    cursor: assessmentPhase !== "subjective" ? "not-allowed" : "text",
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
            onClick={async () => {
              // Save answer log for current subjective question before navigating
              if (currentQuestion && !isMCQ && currentQuestion.id) {
                const currentAnswer = textAnswersRef.current[currentQuestion.id] || "";
                if (currentAnswer.trim()) {
                  await saveAnswerLog(currentQuestion.id, currentAnswer);
                }
              }
              
              if (hasBothTypes) {
                // Find previous question of same phase
                for (let i = actualIndex - 1; i >= 0; i--) {
                  const q = questions[i];
                  const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
                  if (qType === assessmentPhase) {
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
            disabled={currentQuestionIndexInFiltered === 0}
            className="btn-secondary"
            style={{
              padding: "0.75rem 1.5rem",
              opacity: currentQuestionIndexInFiltered === 0 ? 0.5 : 1,
              cursor: currentQuestionIndexInFiltered === 0 ? "not-allowed" : "pointer",
            }}
          >
            ← Previous
          </button>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            {filteredQuestions.map((q, idx) => {
              const actualQIdx = questions.findIndex(q2 => q2.id === q.id);
              const isQMCQ = q.questionType === "mcq" || ("options" in q && "correctAn" in q);
              const hasAnswer = isQMCQ 
                ? (answers[q.id || ""]?.length > 0)
                : (textAnswers[q.id || ""]?.trim().length > 0);
              const isCurrent = actualQIdx === actualIndex;
              
              return (
                <button
                  key={q.id || idx}
                  type="button"
                  onClick={async () => {
                    // Save answer log for current subjective question before navigating
                    if (currentQuestion && !isMCQ && currentQuestion.id) {
                      const currentAnswer = textAnswersRef.current[currentQuestion.id] || "";
                      if (currentAnswer.trim()) {
                        await saveAnswerLog(currentQuestion.id, currentAnswer);
                      }
                    }
                    setCurrentQuestionIndex(actualQIdx);
                  }}
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    border: isCurrent ? "2px solid #2D7A52" : "1px solid #A8E8BC",
                    backgroundColor: hasAnswer ? "#C9F4D4" : isCurrent ? "#E8FAF0" : "#ffffff",
                    color: "#1E5A3B",
                    cursor: "pointer",
                    fontWeight: isCurrent ? 700 : 400,
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {currentQuestionIndexInFiltered < filteredQuestions.length - 1 ? (
            <button
              type="button"
              onClick={async () => {
                // Save answer log for current subjective question before navigating
                if (currentQuestion && !isMCQ && currentQuestion.id) {
                  const currentAnswer = textAnswersRef.current[currentQuestion.id] || "";
                  if (currentAnswer.trim()) {
                    await saveAnswerLog(currentQuestion.id, currentAnswer);
                  }
                }
                
                if (hasBothTypes) {
                  // Find next question of same phase
                  for (let i = actualIndex + 1; i < questions.length; i++) {
                    const q = questions[i];
                    const qType = q.questionType || (("options" in q && "correctAn" in q) ? "mcq" : "subjective");
                    if (qType === assessmentPhase) {
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
            // Last question of current phase
            assessmentPhase === "mcq" && hasMCQ ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to submit the MCQ section? You will not be able to change your answers.")) {
                    handleSubmitMCQSection();
                  }
                }}
                className="btn-primary"
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#10b981",
                }}
              >
                Submit MCQ Section
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to submit the entire assessment? You cannot retake this assessment.")) {
                    handleSubmit();
                  }
                }}
                disabled={submitting}
                className="btn-primary"
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#10b981",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? "Submitting..." : "Submit Whole Assessment"}
              </button>
            )
          )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
