import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import axios from "axios";
import { ProctorToast, FullscreenWarningBanner } from "@/components/proctor";
import { EditorContainer } from "@/components/dsa/test/EditorContainer";
import { JUDGE0_ID_TO_LANG_NAME } from "@/lib/dsa/judge0";
import { useProctor, type ProctorViolation } from "@/hooks/useProctor";
import WebcamPreview from "@/components/WebcamPreview";
import { useFaceMesh, type FaceDetectionResult } from "@/hooks/useFaceMesh";
import { useProctorUpload } from "@/hooks/useProctorUpload";
import { showViolationToast } from "@/components/ViolationToast";

// Lazy load Monaco Editor
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "400px", backgroundColor: "#1e1e1e", color: "#fff" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "40px", height: "40px", border: "4px solid #3b82f6", borderTop: "4px solid transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 1rem" }} />
        <p>Loading code editor...</p>
      </div>
    </div>
  ),
});

// Judge0 Language ID to Monaco language mapping
const JUDGE0_TO_MONACO: { [key: string]: string } = {
  "50": "c",
  "54": "cpp",
  "62": "java",
  "71": "python",
  "70": "python",
  "63": "javascript",
  "74": "typescript",
  "68": "php",
  "72": "ruby",
  "83": "swift",
  "60": "go",
  "78": "kotlin",
  "73": "rust",
};

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Question {
  _id?: string;
  questionText: string;
  type: string;
  difficulty: string;
  options?: string[];
  correctAnswer?: string;
  idealAnswer?: string;
  expectedLogic?: string;
  time?: number;
  score?: number;
  topic?: string;
  language?: string;
  judge0_enabled?: boolean;
  coding_data?: {
    title?: string;
    description?: string;
    examples?: Array<{ input: string; output: string; explanation?: string | null }>;
    constraints?: string[];
    public_testcases?: Array<{ input: string; expected_output: string }>;
    hidden_testcases?: Array<{ input: string; expected_output: string }>;
    starter_code?: string | Record<string, string>;
    function_signature?: string;
  };
  starter_code?: string;
  public_testcases?: Array<{ input: string; expected_output: string }>;
  hidden_testcases?: Array<{ input: string; expected_output: string }>;
}

interface Sections {
  mcq: Question[];
  subjective: Question[];
  pseudocode: Question[];
  coding: Question[];
}

type AppState = "loading" | "ready" | "saving" | "submitting" | "finished";

type AnalyticsEventType =
  | "QUESTION_VIEW"
  | "ANSWER_UPDATE"
  | "CODE_RUN"
  | "CODE_RUN_RESULT"
  | "SECTION_SWITCH"
  | "NAVIGATION_NEXT"
  | "NAVIGATION_PREVIOUS"
  | "TAB_SWITCH"
  | "FULLSCREEN_EXIT"
  | "IDLE_WARNING"
  | "IDLE_RETURN"
  | "EXAM_SUBMIT";

interface AnalyticsLog {
  attemptId: string;
  questionId?: string;
  section: string;
  eventType: AnalyticsEventType;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ExamSettings {
  timerMode: "section" | "estimated" | "scheduleOnly";
  estimatedTotalTime: number; // in minutes
  sectionTimes?: { [key: string]: number }; // in minutes
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CandidateAssessmentPage() {
  const router = useRouter();
  const { id, token } = router.query;

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  const [appState, setAppState] = useState<AppState>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sections, setSections] = useState<Sections>({
    mcq: [],
    subjective: [],
    pseudocode: [],
    coding: [],
  });
  const [currentSection, setCurrentSection] = useState<keyof Sections | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Map<string, string>>(new Map());
  const [codeAnswers, setCodeAnswers] = useState<Map<string, string>>(new Map());
  const [timerRemaining, setTimerRemaining] = useState<number>(0); // in seconds
  const [examSettings, setExamSettings] = useState<ExamSettings>({
    timerMode: "estimated",
    estimatedTotalTime: 60,
  });
  const [attemptId, setAttemptId] = useState<string>("");
  const [candidateEmail, setCandidateEmail] = useState<string>("");
  const [candidateName, setCandidateName] = useState<string>("");
  const [proctoringSettings, setProctoringSettings] = useState<any>({});
  const [error, setError] = useState<string | null>(null);

  // Refs for debouncing and cleanup
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedAnswerRef = useRef<Map<string, string>>(new Map());

  // ============================================================================
  // TRANSFORM topics_v2 TO SECTIONS
  // ============================================================================

  const transformTopicsV2ToSections = useCallback((topics_v2: any[]): { sections: Sections; allQuestions: Question[] } => {
    const sections: Sections = {
      mcq: [],
      subjective: [],
      pseudocode: [],
      coding: [],
    };
    const allQuestions: Question[] = [];

    console.log("[take.tsx] Transforming topics_v2:", topics_v2.length, "topics");

    // Helper to compute points from difficulty
    const computePoints = (difficulty: string): number => {
      const difficultyLower = (difficulty || "").toLowerCase();
      if (difficultyLower === "hard") return 10;
      if (difficultyLower === "medium") return 7;
      return 5; // Easy or default
    };

    // Helper to generate stable question ID
    let questionCounter = 0;
    const generateQuestionId = (topicId: string, rowId: string, questionIndex: number): string => {
      return `${topicId}-${rowId}-${questionIndex}-${questionCounter++}`;
    };

    // Process each topic
    topics_v2.forEach((topic, topicIndex) => {
      if (!topic || typeof topic !== "object") {
        console.warn(`[take.tsx] Topic ${topicIndex} is not a valid object, skipping`);
        return;
      }

      const topicId = topic.id || topic._id || `topic-${topicIndex}`;
      const topicLabel = topic.label || topic.topic || `Topic ${topicIndex + 1}`;
      const questionRows = topic.questionRows || [];

      console.log(`[take.tsx] Processing topic ${topicIndex} (${topicLabel}):`, {
        topicId,
        topicLabel,
        questionRowsCount: questionRows.length,
      });

      // Process each question row
      questionRows.forEach((row: any, rowIndex: number) => {
        if (!row || typeof row !== "object") {
          console.warn(`[take.tsx] Row ${rowIndex} in topic ${topicIndex} is not a valid object, skipping`);
          return;
        }

        const rowId = row.rowId || row.id || `row-${rowIndex}`;
        const questionType = row.questionType || row.type || "";
        const difficulty = row.difficulty || "Easy";
        const questions = row.questions || [];

        console.log(`[take.tsx] Processing row ${rowIndex} (${questionType}):`, {
          rowId,
          questionType,
          difficulty,
          questionsCount: questions.length,
        });

        // Process each question in the row
        questions.forEach((question: any, questionIndex: number) => {
          if (!question || typeof question !== "object") {
            console.warn(`[take.tsx] Question ${questionIndex} in row ${rowIndex} is not a valid object, skipping`);
            return;
          }

          // Build question object with all metadata
          const questionObj: Question = {
            _id: question._id || question.id || generateQuestionId(topicId, rowId, questionIndex),
            questionText: question.questionText || question.question || question.text || "",
            type: questionType, // Use row's questionType
            difficulty: difficulty,
            score: computePoints(difficulty),
            topic: topicLabel,
            // Preserve all original question fields
            ...question,
            // Override with row-level metadata
            questionType: questionType,
            rowId: rowId,
            topicId: topicId,
            topicLabel: topicLabel,
          };

          // Map questionType to section
          const normalizedType = (questionType || "").toLowerCase().trim();
          let sectionKey: keyof Sections | null = null;

          if (normalizedType === "mcq" || normalizedType.includes("mcq") || normalizedType.includes("multiple")) {
            sectionKey = "mcq";
          } else if (normalizedType === "pseudocode" || normalizedType === "pseudo code" || normalizedType.includes("pseudo")) {
            sectionKey = "pseudocode";
          } else if (normalizedType === "subjective" || normalizedType.includes("subjective") || normalizedType === "descriptive") {
            sectionKey = "subjective";
          } else if (normalizedType === "coding" || normalizedType.includes("coding") || normalizedType.includes("code")) {
            sectionKey = "coding";
          } else {
            // Fallback inference
            if (question.options && Array.isArray(question.options) && question.options.length > 0) {
              sectionKey = "mcq";
            } else if (question.judge0_enabled || question.coding_data || question.starter_code || question.public_testcases) {
              sectionKey = "coding";
            } else {
              sectionKey = "subjective"; // Default fallback
            }
            console.warn(`[take.tsx] Unknown questionType "${questionType}", inferred as "${sectionKey}"`);
          }

          if (sectionKey) {
            sections[sectionKey].push(questionObj);
            allQuestions.push(questionObj);
            console.log(`[take.tsx] Added question to ${sectionKey} section`);
          }
        });
      });
    });

    console.log("[take.tsx] Transformation complete:", {
      mcq: sections.mcq.length,
      pseudocode: sections.pseudocode.length,
      subjective: sections.subjective.length,
      coding: sections.coding.length,
      total: allQuestions.length,
    });

    return { sections, allQuestions };
  }, []);

  // ============================================================================
  // GET CURRENT QUESTION
  // ============================================================================

  const getCurrentQuestion = useCallback((): Question | null => {
    console.log("[take.tsx] getCurrentQuestion:", {
      currentSection,
    currentQuestionIndex,
      sectionExists: currentSection ? !!sections[currentSection] : false,
      sectionLength: currentSection ? sections[currentSection]?.length : 0,
      sections,
    });
    
    if (!currentSection || !sections[currentSection]) {
      console.warn("[take.tsx] No current section or section doesn't exist");
      return null;
    }
    const sectionQuestions = sections[currentSection];
    if (currentQuestionIndex >= 0 && currentQuestionIndex < sectionQuestions.length) {
      return sectionQuestions[currentQuestionIndex];
    }
    console.warn("[take.tsx] Question index out of bounds:", currentQuestionIndex, "section length:", sectionQuestions.length);
    return null;
  }, [currentSection, sections, currentQuestionIndex]);

  const getQuestionId = useCallback((question: Question): string => {
    return question._id || `${currentSection}-${currentQuestionIndex}`;
  }, [currentSection, currentQuestionIndex]);

  // ============================================================================
  // TIMER LOGIC
  // ============================================================================

  const calculateTimer = useCallback((settings: ExamSettings, sections: Sections): number => {
    // PRODUCTION-GRADE TIMER LOGIC - PART 8
    // IF timerMode = "perSection" (or "section"): exam timer = SUM of all section timers
    // IF timerMode = "scheduleOnly": exam timer = AI Estimated Total Time (NOT schedule window duration)
    // IF timerMode = "estimated": exam timer = estimatedTotalTime
    
    console.log("[take.tsx] calculateTimer called with:", {
      timerMode: settings.timerMode,
      estimatedTotalTime: settings.estimatedTotalTime,
      sectionTimes: settings.sectionTimes,
      sectionsKeys: Object.keys(sections),
    });
    
    if (settings.timerMode === "section") {
      // Sum of all section time allocations
      let total = 0;
      if (settings.sectionTimes) {
        Object.keys(sections).forEach((sectionKey) => {
          // Map section keys to questionTypeTimes keys
          const timeKey = sectionKey === "mcq" ? "MCQ" : 
                         sectionKey === "pseudocode" ? "PseudoCode" :
                         sectionKey === "subjective" ? "Subjective" :
                         sectionKey === "coding" ? "Coding" : sectionKey;
          const sectionTime = settings.sectionTimes?.[timeKey] || settings.sectionTimes?.[sectionKey] || 0;
          total += sectionTime * 60; // Convert minutes to seconds
        });
      }
      console.log("[take.tsx] Timer mode: per-section, total:", total, "seconds");
      return total > 0 ? total : (settings.estimatedTotalTime || 60) * 60; // Fallback to estimated if section times sum to 0
    } else if (settings.timerMode === "estimated") {
      // Use estimatedTotalTime
      const estimatedMinutes = settings.estimatedTotalTime || 60; // Default to 60 minutes if not set
      const timerSeconds = estimatedMinutes * 60; // Convert minutes to seconds
      console.log("[take.tsx] Timer mode: estimated, total:", timerSeconds, "seconds");
      return timerSeconds;
    } else if (settings.timerMode === "scheduleOnly") {
      // CRITICAL: Use AI Estimated Total Time, NOT schedule window duration
      // Do NOT use (endTime - startTime) automatically
      const estimatedMinutes = settings.estimatedTotalTime || 60; // Default to 60 minutes if not set
      const timerSeconds = estimatedMinutes * 60; // Convert minutes to seconds
      console.log("[take.tsx] Timer mode: scheduleOnly, using estimatedTotalTime:", timerSeconds, "seconds (NOT schedule window)");
      return timerSeconds;
    }
    // Default to estimated
    const estimatedMinutes = settings.estimatedTotalTime || 60; // Default to 60 minutes if not set
    const defaultTimer = estimatedMinutes * 60;
    console.log("[take.tsx] Timer mode: default (estimated), total:", defaultTimer, "seconds");
    return defaultTimer;
  }, []);

  // ============================================================================
  // ANALYTICS LOGGING
  // ============================================================================

  const logAnalyticsEvent = useCallback(async (
    eventType: AnalyticsEventType,
    metadata?: Record<string, unknown>
  ) => {
    if (!attemptId) return;

    const question = getCurrentQuestion();
    const logEntry: AnalyticsLog = {
      attemptId,
      questionId: question ? getQuestionId(question) : undefined,
      section: currentSection || "unknown",
      eventType,
      timestamp: new Date().toISOString(),
      metadata,
    };

    try {
      await axios.post("/api/v1/analytics/log-event", logEntry);
    } catch (error) {
      console.error("[Analytics] Failed to log event:", error);
    }
  }, [attemptId, currentSection, getCurrentQuestion, getQuestionId]);

  // ============================================================================
  // AUTO-SAVE ANSWERS
  // ============================================================================

  const saveAnswer = useCallback(async (questionId: string, answer: string, section: string) => {
    if (!attemptId || !id || !token) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // PART 7: Answer Saving + Version History (500ms debounce)
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const lastSaved = lastSavedAnswerRef.current.get(questionId);
        if (lastSaved === answer) {
          // Skip if answer hasn't changed
          return;
        }

        // Log answer version history before saving
        try {
          await axios.post("/api/v1/analytics/log-event", {
            attemptId,
            questionId,
            section,
            eventType: "ANSWER_EDITED",
            timestamp: new Date().toISOString(),
            metadata: {
              oldAnswer: lastSaved || "",
              newAnswer: answer,
              action: "ANSWER_EDITED",
            },
          });
        } catch (logError) {
          console.warn("[Answer History] Failed to log version history:", logError);
          // Don't block saving if logging fails
        }

        // Save answer
        await axios.post("/api/v1/attempts/save-answer", {
          attemptId,
          questionId,
          answer,
          section,
          timeRemaining: timerRemaining,
        });

        lastSavedAnswerRef.current.set(questionId, answer);
        await logAnalyticsEvent("ANSWER_UPDATE", { questionId, section });
      } catch (error) {
        console.error("[Auto-save] Failed to save answer:", error);
      }
    }, 500);
  }, [attemptId, id, token, timerRemaining, logAnalyticsEvent]);

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  const navigateToQuestion = useCallback(async (section: keyof Sections, index: number) => {
    // PART 7: Auto-save current answer before switching questions
    const currentQuestion = getCurrentQuestion();
    if (currentQuestion && currentSection) {
      const questionId = getQuestionId(currentQuestion);
      const currentAnswer = answers.get(questionId) || codeAnswers.get(questionId) || "";
      if (currentAnswer) {
        // Force immediate save (clear debounce and save)
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        try {
          const lastSaved = lastSavedAnswerRef.current.get(questionId);
          if (lastSaved !== currentAnswer) {
            await axios.post("/api/v1/attempts/save-answer", {
              attemptId,
              questionId,
              answer: currentAnswer,
              section: currentSection,
              timeRemaining: timerRemaining,
            });
            lastSavedAnswerRef.current.set(questionId, currentAnswer);
          }
        } catch (error) {
          console.error("[Navigation] Failed to save answer before switching:", error);
        }
      }
      
      // Log question change
      await logAnalyticsEvent("SECTION_SWITCH", {
        fromQuestionId: questionId,
        fromSection: currentSection,
        toSection: section,
        toIndex: index,
      });
    }
    
    setCurrentSection(section);
    setCurrentQuestionIndex(index);
    const question = sections[section][index];
    if (question) {
      logAnalyticsEvent("QUESTION_VIEW", {
        section,
        questionIndex: index,
        questionId: getQuestionId(question),
      });
    }
  }, [sections, logAnalyticsEvent, getQuestionId, getCurrentQuestion, currentSection, answers, codeAnswers, attemptId, timerRemaining]);

  const navigateNext = useCallback(() => {
    if (!currentSection) return;

    const sectionQuestions = sections[currentSection];
    if (currentQuestionIndex < sectionQuestions.length - 1) {
      navigateToQuestion(currentSection, currentQuestionIndex + 1);
      logAnalyticsEvent("NAVIGATION_NEXT", { section: currentSection, index: currentQuestionIndex });
      } else {
      // Move to next section
      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex < sectionOrder.length - 1) {
        const nextSection = sectionOrder[currentIndex + 1];
        if (sections[nextSection].length > 0) {
          navigateToQuestion(nextSection, 0);
          logAnalyticsEvent("SECTION_SWITCH", { from: currentSection, to: nextSection });
        }
      }
    }
  }, [currentSection, currentQuestionIndex, sections, navigateToQuestion, logAnalyticsEvent]);

  const navigatePrevious = useCallback(() => {
    if (!currentSection) return;

    if (currentQuestionIndex > 0) {
      navigateToQuestion(currentSection, currentQuestionIndex - 1);
      logAnalyticsEvent("NAVIGATION_PREVIOUS", { section: currentSection, index: currentQuestionIndex });
      } else {
      // Move to previous section
      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex > 0) {
        const prevSection = sectionOrder[currentIndex - 1];
        if (sections[prevSection].length > 0) {
          const prevSectionLength = sections[prevSection].length;
          navigateToQuestion(prevSection, prevSectionLength - 1);
          logAnalyticsEvent("SECTION_SWITCH", { from: currentSection, to: prevSection });
        }
      }
    }
  }, [currentSection, currentQuestionIndex, sections, navigateToQuestion, logAnalyticsEvent]);

  // ============================================================================
  // FINAL SUBMISSION
  // ============================================================================

  const submitAssessment = useCallback(async () => {
    // PART 9: Final Submit Button Logic
    if (!id || !token || !candidateEmail || !candidateName) {
      console.error("[Submit] Missing required fields:", { id, token, candidateEmail, candidateName });
      setError("Missing required information. Please refresh the page and try again.");
      return;
    }

    // Create attemptId if it doesn't exist (generate a temporary one for analytics)
    let currentAttemptId = attemptId;
    if (!currentAttemptId) {
      // Generate a temporary attempt ID for analytics logging
      currentAttemptId = `attempt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.warn("[Submit] No attemptId found, generated temporary ID:", currentAttemptId);
    }

    setAppState("submitting");

    // Stop proctoring session if enabled
    if (proctorEnabled && candidateEmail) {
      try {
        await axios.post("/api/session/stop-session", {
          assessmentId: id,
          userId: candidateEmail,
          reason: "assessment_submitted",
        });
        console.log("[Take] Proctoring session stopped");
      } catch (err) {
        console.warn("[Take] Failed to stop proctoring session:", err);
      }

      // Stop all media streams
      if (typeof window !== "undefined") {
        const webcamStream = (window as any).__webcamStream as MediaStream | null;
        const screenStream = (window as any).__screenStream as MediaStream | null;
        
        if (webcamStream) {
          webcamStream.getTracks().forEach(track => track.stop());
          delete (window as any).__webcamStream;
        }
        if (screenStream) {
          screenStream.getTracks().forEach(track => track.stop());
          delete (window as any).__screenStream;
        }
      }
    }

    try {
      // Step 1: Save all answers (force immediate save, clear debounce)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Step 1: Save all answers (force immediate save, clear debounce)
      // Save all pending answers - log each save attempt
      const savePromises: Promise<void>[] = [];
      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
      sectionOrder.forEach((section) => {
        sections[section].forEach((question) => {
          const questionId = question._id || `${section}-${sections[section].indexOf(question)}`;
          const answer = answers.get(questionId) || codeAnswers.get(questionId) || "";
          const lastSaved = lastSavedAnswerRef.current.get(questionId);
          if (answer && answer !== lastSaved) {
            // Log answer save attempt
            savePromises.push(
              axios.post("/api/v1/analytics/log-event", {
                attemptId: currentAttemptId,
                questionId,
                section,
                eventType: "ANSWER_UPDATE",
                timestamp: new Date().toISOString(),
                metadata: {
                  action: "FINAL_SAVE",
                  answerLength: answer.length,
                },
              }).then(() => {}).catch((logErr) => {
                console.warn(`[Submit] Failed to log answer save for ${questionId}:`, logErr);
              })
            );
            
            // Save answer to backend
            savePromises.push(
              axios.post("/api/v1/attempts/save-answer", {
                attemptId: currentAttemptId,
                questionId,
                answer,
                section,
                timeRemaining: timerRemaining,
              }).then(() => {
                lastSavedAnswerRef.current.set(questionId, answer);
              }).catch((error) => {
                console.error(`[Submit] Failed to save answer for ${questionId}:`, error);
                // Log the error
                axios.post("/api/v1/analytics/log-event", {
                  attemptId: currentAttemptId,
                  questionId,
                  section,
                  eventType: "ANSWER_SAVE_ERROR",
                  timestamp: new Date().toISOString(),
                  metadata: { error: error.message },
                }).catch(() => {});
              })
            );
          }
        });
      });
      await Promise.all(savePromises);

      // Step 2: Lock whole assessment (mark as submitted)
      // Step 3: Stop proctoring (handled by redirect)
      
      // Step 4: Write submit log
      const answersSnapshot: Record<string, string> = {};
      sectionOrder.forEach((section) => {
        sections[section].forEach((question) => {
          const questionId = question._id || `${section}-${sections[section].indexOf(question)}`;
          const answer = answers.get(questionId) || codeAnswers.get(questionId) || "";
          if (answer) {
            answersSnapshot[questionId] = answer;
          }
        });
      });

      // Step 4: Write comprehensive submit log with all analytics data
      const submissionMetadata = {
        answersSnapshot,
        timerRemaining,
        totalQuestions: questions.length,
        answeredQuestions: Object.keys(answersSnapshot).length,
        sections: {
          mcq: sections.mcq.length,
          pseudocode: sections.pseudocode.length,
          subjective: sections.subjective.length,
          coding: sections.coding.length,
        },
        examSettings: {
          timerMode: examSettings.timerMode,
          estimatedTotalTime: examSettings.estimatedTotalTime,
        },
        submissionTime: new Date().toISOString(),
      };

      // Log comprehensive submission event
      try {
        await axios.post("/api/v1/analytics/log-event", {
          attemptId: currentAttemptId,
          eventType: "ASSESSMENT_SUBMITTED",
          timestamp: new Date().toISOString(),
          section: "all",
          metadata: submissionMetadata,
        });
        console.log("[Submit] Submission event logged successfully");
      } catch (logError) {
        console.error("[Submit] Failed to log submission event:", logError);
        // Try to log the error itself
        try {
          await axios.post("/api/v1/analytics/log-event", {
            attemptId: currentAttemptId,
            eventType: "SUBMISSION_LOG_ERROR",
            timestamp: new Date().toISOString(),
            section: "all",
            metadata: { error: logError instanceof Error ? logError.message : String(logError) },
          });
        } catch (doubleError) {
          console.error("[Submit] Failed to log error event:", doubleError);
        }
        // Don't block submission if logging fails
      }

      // Step 5: Mark attempt.status = "completed" and submit
      // Collect all answers for final submission
      const allAnswers: Array<{ questionIndex: number; answer: string; timeSpent: number }> = [];
      let globalIndex = 0;

      sectionOrder.forEach((section) => {
        sections[section].forEach((question) => {
          const questionId = question._id || `${section}-${globalIndex}`;
          const answer = answers.get(questionId) || codeAnswers.get(questionId) || "";
          if (answer.trim()) {
            allAnswers.push({
              questionIndex: globalIndex,
              answer,
              timeSpent: 0, // TODO: Track time spent per question
            });
          }
          globalIndex++;
        });
      });

      // Step 5: Submit to backend with comprehensive data
      console.log("[Submit] Submitting assessment with:", {
        assessmentId: id,
        totalAnswers: allAnswers.length,
        attemptId: currentAttemptId,
      });
      
      try {
        const submitResponse = await axios.post("/api/assessment/submit-answers", {
          assessmentId: id,
          token,
          email: candidateEmail,
          name: candidateName,
          answers: allAnswers,
          skippedQuestions: [],
          attemptId: currentAttemptId, // Include attemptId in submission
          timerRemaining,
          submissionMetadata, // Include all metadata
        });
        console.log("[Submit] Submission successful:", submitResponse.data);
      } catch (submitError: any) {
        console.error("[Submit] Backend submission failed:", submitError);
        // Log the submission error
        try {
          await axios.post("/api/v1/analytics/log-event", {
            attemptId: currentAttemptId,
            eventType: "SUBMISSION_BACKEND_ERROR",
            timestamp: new Date().toISOString(),
            section: "all",
            metadata: {
              error: submitError.response?.data?.message || submitError.message,
              statusCode: submitError.response?.status,
            },
          });
        } catch (logErr) {
          console.error("[Submit] Failed to log submission error:", logErr);
        }
        // Still proceed to redirect - answers are saved locally
      }

      // Log final exam submit event
      try {
        await axios.post("/api/v1/analytics/log-event", {
          attemptId: currentAttemptId,
          eventType: "EXAM_SUBMIT",
          timestamp: new Date().toISOString(),
          section: "all",
          metadata: {
            totalAnswers: allAnswers.length,
            totalQuestions: questions.length,
            submissionCompleted: true,
          },
        });
      } catch (logError) {
        console.warn("[Submit] Failed to log EXAM_SUBMIT event:", logError);
      }

      // Stop timer interval
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      setAppState("finished");
      router.push(`/assessment/${id}/${token}/completed`);
    } catch (error: any) {
      console.error("[Submit] Failed to submit assessment:", error);
      
      // Log the submission failure
      try {
        await axios.post("/api/v1/analytics/log-event", {
          attemptId: currentAttemptId,
          eventType: "SUBMISSION_FAILED",
          timestamp: new Date().toISOString(),
          section: "all",
          metadata: {
            error: error.response?.data?.message || error.message,
            statusCode: error.response?.status,
          },
        });
      } catch (logErr) {
        console.error("[Submit] Failed to log submission failure:", logErr);
      }
      
      setError(error.response?.data?.message || "Failed to submit assessment. Please try again.");
      setAppState("ready");
    }
  }, [attemptId, id, token, candidateEmail, candidateName, answers, codeAnswers, sections, questions, examSettings, timerRemaining, router]);

  // ============================================================================
  // DATA LOADING
  // ============================================================================

  useEffect(() => {
    if (!id || !token || typeof id !== "string" || typeof token !== "string") return;

    const loadAssessment = async () => {
      try {
        setAppState("loading");

        // Load candidate info from session (client-side only)
        const isClient = typeof window !== "undefined";
        if (isClient) {
          const email = sessionStorage.getItem("candidateEmail") || "";
          const name = sessionStorage.getItem("candidateName") || "";
          setCandidateEmail(email);
          setCandidateName(name);
        }

        // Fetch full assessment with topics_v2 structure
        const assessmentResponse = await axios.get(`/api/assessment/get-assessment-full?assessmentId=${id}&token=${token}`);
        
        console.log("[take.tsx] Assessment API response:", assessmentResponse.data);
        
        if (!assessmentResponse.data?.success) {
          throw new Error("Failed to load assessment");
        }

        const topics_v2 = assessmentResponse.data.data?.topics_v2 || [];
        const fetchedSettings: ExamSettings = {
          timerMode: assessmentResponse.data.data?.timerMode || "estimated",
          estimatedTotalTime: assessmentResponse.data.data?.estimatedTotalTime || 60,
          sectionTimes: assessmentResponse.data.data?.questionTypeTimes || {},
        };
        const fetchedProctoringRaw = assessmentResponse.data.data?.proctoringSettings || assessmentResponse.data.data?.proctoring || {};
        
        // Normalize proctoring settings to new format
        const fetchedProctoring = {
          ai_proctoring: !!(fetchedProctoringRaw.ai_proctoring || fetchedProctoringRaw.multiFaceDetection || fetchedProctoringRaw.tabSwitchDetection),
          live_proctoring: !!(fetchedProctoringRaw.live_proctoring || fetchedProctoringRaw.liveCameraAndScreenMonitoring),
        };

        console.log("[take.tsx] Topics_v2 structure:", topics_v2);

        // Transform topics_v2 into sections
        const transformed = transformTopicsV2ToSections(topics_v2);
        console.log("[take.tsx] Transformed sections:", {
          mcq: transformed.sections.mcq.length,
          subjective: transformed.sections.subjective.length,
          pseudocode: transformed.sections.pseudocode.length,
          coding: transformed.sections.coding.length,
          allQuestions: transformed.allQuestions.length,
        });

        if (transformed.allQuestions.length === 0) {
          throw new Error("Assessment has no generated questions. Please contact the administrator.");
        }

        setQuestions(transformed.allQuestions);
        setExamSettings(fetchedSettings);
        setProctoringSettings(fetchedProctoring);
        setAttemptId(""); // Will be set when attempt is created

        setSections(transformed.sections);

        // Set first non-empty section as current (order: MCQ → PseudoCode → Subjective → Coding)
        const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
        const firstSection = sectionOrder.find((section) => transformed.sections[section].length > 0);
        console.log("[take.tsx] First section:", firstSection);
        if (firstSection) {
          setCurrentSection(firstSection);
          setCurrentQuestionIndex(0);
        } else {
          console.warn("[take.tsx] No sections with questions found!");
        }

        // Calculate and set timer
        const calculatedTimer = calculateTimer(fetchedSettings, transformed.sections);
        console.log("[take.tsx] Timer calculation:", {
          timerMode: fetchedSettings.timerMode,
          estimatedTotalTime: fetchedSettings.estimatedTotalTime,
          sectionTimes: fetchedSettings.sectionTimes,
          calculatedTimer,
          sectionsCount: {
            mcq: transformed.sections.mcq.length,
            pseudocode: transformed.sections.pseudocode.length,
            subjective: transformed.sections.subjective.length,
            coding: transformed.sections.coding.length,
          },
        });
        
        if (calculatedTimer <= 0) {
          console.warn("[take.tsx] Calculated timer is 0 or negative, using default 60 minutes");
          setTimerRemaining(60 * 60); // Default to 60 minutes
        } else {
          setTimerRemaining(calculatedTimer);
        }

        setAppState("ready");
      } catch (error: any) {
        console.error("[Load] Failed to load assessment:", error);
        setError(error.response?.data?.message || "Failed to load assessment");
        setAppState("ready");
      }
    };

    loadAssessment();
  }, [id, token, transformTopicsV2ToSections, calculateTimer]);

  // ============================================================================
  // TIMER COUNTDOWN
  // ============================================================================

  useEffect(() => {
    // Only start timer when appState is ready AND timerRemaining is greater than 0
    if (appState !== "ready" || timerRemaining <= 0) {
      // Clear interval if timer is 0 or appState is not ready
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }

    // Clear any existing interval before starting a new one
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    timerIntervalRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        if (prev <= 1) {
          // Timer expired - auto-submit
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
          }
          submitAssessment();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [appState, timerRemaining, submitAssessment]);

  // ============================================================================
  // PROCTORING INTEGRATION
  // ============================================================================

  const handleProctorViolation = useCallback((violation: ProctorViolation) => {
    logAnalyticsEvent("TAB_SWITCH", { violation: violation.eventType });
  }, [logAnalyticsEvent]);


  // Normalize proctoring settings
  const aiProctoring = proctoringSettings.ai_proctoring || false;
  // Temporarily disable live proctoring
  const liveProctoring = false; // proctoringSettings.live_proctoring || false;
  const proctorEnabled = aiProctoring || liveProctoring;

  // Initialize proctoring hooks (legacy - for tab switching)
  const { lastViolation: proctorViolation } = useProctor({
    userId: candidateEmail,
    assessmentId: id as string,
    onViolation: handleProctorViolation,
    enableFullscreenDetection: false,
    enableDevToolsDetection: false,
  });

  // Video refs (client-only)
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const thumbVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  
  // Proctoring state
  const [webcamLive, setWebcamLive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [detectionStatus, setDetectionStatus] = useState<FaceDetectionResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [candidateEmailForProctor, setCandidateEmailForProctor] = useState<string>('');
  
  // Proctoring hooks
  const { uploadSnapshot, recordViolation: recordViolationToBackend } = useProctorUpload();
  const noFaceCheckCountRef = useRef<number>(0);
  
  // Cooldown tracking for MULTIPLE_FACES_DETECTED only to prevent spam
  const lastMultipleFacesTimeRef = useRef<number>(0);
  const MULTIPLE_FACES_COOLDOWN_MS = 15000; // 15 seconds between multiple face events
  
  // Capture snapshot helper - returns JPEG Blob
  const captureSnapshot = useCallback(async (): Promise<Blob | null> => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    
    const video = thumbVideoRef.current || mainVideoRef.current;
    if (!video || video.readyState < 2) {
      console.warn('[Proctor] Video not ready for snapshot (readyState:', video?.readyState, ')');
      return null;
    }
    
    let retries = 2;
    while (retries > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640; // Match media stream resolution
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          retries--;
          if (retries > 0) await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Convert to JPEG Blob
        return new Promise<Blob | null>((resolve) => {
          canvas.toBlob((blob) => {
            resolve(blob);
          }, 'image/jpeg', 0.7);
        });
      } catch (err) {
        console.warn('[Proctor] Failed to capture snapshot (retries left:', retries - 1, '):', err);
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    return null;
  }, []);
  
  // Handle violation: capture, upload, record, show toast
  const handleViolation = useCallback(async (eventType: string, metadata: any = {}) => {
    if (typeof window === 'undefined') return;
    
    // Apply cooldown ONLY for MULTIPLE_FACES_DETECTED to prevent spam
    if (eventType === 'MULTIPLE_FACES_DETECTED') {
      const now = Date.now();
      const lastTime = lastMultipleFacesTimeRef.current;
      
      if (now - lastTime < MULTIPLE_FACES_COOLDOWN_MS) {
        const timeRemaining = Math.ceil((MULTIPLE_FACES_COOLDOWN_MS - (now - lastTime)) / 1000);
        console.log(`[Proctor] ⏳ MULTIPLE_FACES_DETECTED event throttled (cooldown: ${timeRemaining}s remaining)`);
        return; // Skip this violation - still in cooldown
      }
      
      // Update last violation time
      lastMultipleFacesTimeRef.current = now;
    }
    
    const timestamp = new Date().toISOString();
    
    // Only capture and upload snapshots for specific events
    const snapshotEvents = ['GAZE_AWAY', 'MULTIPLE_FACES_DETECTED', 'NO_FACE_DETECTED'];
    let snapshotId: string | undefined;
    let snapshotUrl: string | undefined;
    
    // Upload snapshot and wait for result before recording violation (for snapshot events)
    if (snapshotEvents.includes(eventType)) {
      try {
        const blob = await captureSnapshot();
        if (blob) {
          const uploadResult = await uploadSnapshot({
            assessmentId: id as string,
            candidateId: candidateEmailForProctor,
            eventType,
            timestamp,
            snapshotBlob: blob,
            metadata,
          });
          
          if (uploadResult.success && uploadResult.id) {
            snapshotId = uploadResult.id;
            console.log(`[Proctor] Snapshot uploaded for ${eventType}:`, snapshotId);
          } else {
            console.warn(`[Proctor] Snapshot upload returned no ID for ${eventType}`);
          }
        }
      } catch (err) {
        console.error(`[Proctor] Snapshot capture/upload failed for ${eventType}:`, err);
        // Continue with violation recording even if snapshot fails
      }
    }
    
    // Record violation to backend (now includes snapshotId if upload was successful)
    await recordViolationToBackend({
      assessmentId: id as string,
      candidateId: candidateEmailForProctor,
      eventType,
      timestamp,
      snapshotId,
      metadata,
    });
    
    // Show toast (use dataURL for preview if available)
    showViolationToast({
      eventType,
      snapshotUrl,
      timestamp,
      candidateId: candidateEmailForProctor,
    });
  }, [captureSnapshot, uploadSnapshot, recordViolationToBackend, id, candidateEmailForProctor]);
  
  // Face detection callback
  const handleFaceDetection = useCallback((result: FaceDetectionResult) => {
    setDetectionStatus(result);
    
    // Handle violations with cooldown to prevent spam
    if (result.multiFace) {
      // Cooldown is handled inside handleViolation, but log for debugging
      handleViolation('MULTIPLE_FACES_DETECTED', { facesCount: result.facesCount });
    }
    
    // Increased debouncing to 5 frames to reduce false positives
    // Only trigger if facesCount is 0 for 5 consecutive frames
    if (result.facesCount === 0) {
      noFaceCheckCountRef.current++;
      if (noFaceCheckCountRef.current >= 5) {
        // Map IN_FRAME_LOST to NO_FACE_DETECTED for snapshot upload
        console.log(`[Take] 🚨 NO_FACE_DETECTED triggered after ${noFaceCheckCountRef.current} consecutive frames`);
        handleViolation('NO_FACE_DETECTED', { facesCount: 0 });
        noFaceCheckCountRef.current = 0;
      } else {
        if (noFaceCheckCountRef.current % 2 === 0) {
          console.log(`[Take] No face detected (count: ${noFaceCheckCountRef.current}/5)`);
        }
      }
    } else {
      if (noFaceCheckCountRef.current > 0) {
        console.log(`[Take] Face detected again, resetting no-face counter (was: ${noFaceCheckCountRef.current})`);
      }
      noFaceCheckCountRef.current = 0;
    }
    
    // DEBUG: Log when gazeAway is received
    if (result.gazeAway) {
      console.log('[Take] ✅ Received gazeAway=true from useFaceMesh, calling handleViolation');
    }
    
    // Gaze-away is now triggered directly from useFaceMesh after duration check
    // No need for 3-frame debouncing - trigger immediately when gazeAway is true
    if (result.gazeAway) {
      console.log('[Take] 🚨 Calling handleViolation for GAZE_AWAY');
      handleViolation('GAZE_AWAY', { facesCount: result.facesCount });
    }
  }, [handleViolation]);
  
  // Use FaceMesh hook - initialize asynchronously after camera starts
  const { isModelLoaded: modelLoaded } = useFaceMesh({
    videoRef: thumbVideoRef,
    onDetection: handleFaceDetection,
    enabled: webcamLive, // Only enable when camera is live (ensures async init after camera)
  });
  
  // Start webcam function (can be called from Start Assessment button)
  const startWebcam = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      console.warn('[Proctor] navigator.mediaDevices not available');
      return;
    }
    
    // Reuse existing stream if available and active
    if (webcamStreamRef.current && webcamStreamRef.current.active) {
      const tracks = webcamStreamRef.current.getVideoTracks();
      if (tracks.length > 0 && tracks[0].readyState === 'live') {
        console.log('[Proctor] webcam already started, reusing stream');
        // Ensure video element has the stream
        if (thumbVideoRef.current && !thumbVideoRef.current.srcObject) {
          thumbVideoRef.current.srcObject = webcamStreamRef.current;
          thumbVideoRef.current.play().catch(() => {});
        }
        setWebcamLive(true);
        return;
      }
    }
    
    try {
      // Use smaller resolution (640x480) for faster processing
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
        } 
      });
      webcamStreamRef.current = stream;
      console.log('[Webcam] started');
      
      // Wait for video element to exist (retry up to 10 times with 100ms delay)
      let retries = 0;
      while (!thumbVideoRef.current && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      // Attach to video elements and wait for playing event
      const attachStream = async (videoElement: HTMLVideoElement | null) => {
        if (!videoElement) return;
        videoElement.srcObject = stream;
        // Wait for video to be ready AND playing
        return new Promise<void>((resolve) => {
          const onPlaying = () => {
            console.log('[Webcam] playing');
            videoElement.removeEventListener('playing', onPlaying);
            resolve();
          };
          
          if (videoElement.readyState >= 2 && !videoElement.paused && videoElement.currentTime > 0) {
            console.log('[Webcam] playing (already ready)');
            resolve();
            return;
          }
          
          videoElement.addEventListener('playing', onPlaying, { once: true });
          videoElement.play().catch((err) => {
            console.warn('[Proctor] video play failed:', err);
            // Still resolve to continue
            resolve();
          });
        });
      };
      
      await attachStream(thumbVideoRef.current);
      await attachStream(mainVideoRef.current);
      
      setWebcamLive(true);
      setWebcamError(null);
      console.log('[Proctor] webcam started');
      
      // Diagnostics: Log on Start Assessment
      const assetUrls = (window as any).__faceMeshAssetUrls || [];
      const asset404s = assetUrls.filter((url: string) => {
        // Check if URL failed (this is a best-effort check; actual 404s will be in network panel)
        return false; // We can't reliably detect 404s here, but network panel will show them
      });
      
      console.log('[Proctor Diagnostics] Start Assessment:', {
        cameraStarted: true,
        faceMeshInit: 'pending',
        PROCTOR_UPLOAD_URL: '/api/proctor/upload',
        assetUrlsAttempted: assetUrls.length > 0 ? assetUrls : 'none yet',
      });
      
      // Update diagnostics when FaceMesh finishes initializing (after a delay)
      setTimeout(() => {
        const faceMeshStatus = modelLoaded 
          ? 'success' 
          : ((window as any).__faceMeshInitFailed ? 'failed' : 'loading');
        const finalAssetUrls = (window as any).__faceMeshAssetUrls || [];
        const diagnostics = {
          cameraStarted: true,
          faceMeshInit: faceMeshStatus,
          PROCTOR_UPLOAD_URL: '/api/proctor/upload',
          assetUrlsAttempted: finalAssetUrls,
          note: 'Check network panel for 404s on /mediapipe/face_mesh/* assets if FaceMesh init failed',
        };
        console.log('[Proctor Diagnostics] Updated:', JSON.stringify(diagnostics, null, 2));
      }, 2000);
    } catch (err: any) {
      console.error('[Proctor] Failed to start webcam:', err);
      setWebcamLive(false);
      if (err.name === 'NotAllowedError') {
        setWebcamError('Camera permission is required. Please allow camera access and refresh the page.');
      } else if (err.name === 'NotFoundError') {
        setWebcamError('No camera found. Please connect a camera and refresh the page.');
      } else {
        setWebcamError('Failed to start camera. Please check your camera settings.');
      }
    }
  }, []);
  
  // Restore sessionId and candidateEmail on mount (client-only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    console.log('[Take] mount, candidateEmail=', candidateEmail);
    
    const isClient = typeof window !== 'undefined';
    if (!isClient) return;
    
    // Restore sessionId
    const sid = sessionStorage.getItem('__proctorSessionId') || (window as any).__proctoringSessionId || null;
    setSessionId(sid);
    if (sid) console.log('[Take] restored sessionId:', sid);
    
    // Restore candidate email
    const email = sessionStorage.getItem('proctoringCandidateEmail') || candidateEmail || '';
    setCandidateEmailForProctor(email);
  }, [candidateEmail]);
  
  // Start webcam on mount (after component is mounted and video ref exists)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Small delay to ensure video element is rendered
    const timer = setTimeout(() => {
      startWebcam();
    }, 100);
    return () => clearTimeout(timer);
  }, [startWebcam]);
  
  // Ensure stream is attached to video element when it becomes available
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!webcamStreamRef.current || !thumbVideoRef.current) return;
    
    const video = thumbVideoRef.current;
    const stream = webcamStreamRef.current;
    
    // If video doesn't have the stream, attach it
    if (video.srcObject !== stream && stream.active) {
      video.srcObject = stream;
      if (video.readyState >= 2) {
        video.play().catch(() => {});
      } else {
        const handleLoaded = () => {
          video.play().catch(() => {});
        };
        video.addEventListener('loadeddata', handleLoaded, { once: true });
        video.addEventListener('canplay', handleLoaded, { once: true });
      }
    }
  }, [webcamLive]);
  
  // Event listeners for tab switch, focus, fullscreen (client-only)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    let tabSwitchDebounce: NodeJS.Timeout | null = null;
    let focusLostDebounce: NodeJS.Timeout | null = null;
    let fullscreenExitDebounce: NodeJS.Timeout | null = null;
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (tabSwitchDebounce) clearTimeout(tabSwitchDebounce);
        tabSwitchDebounce = setTimeout(() => {
          handleViolation('TAB_SWITCH', {
            pageHidden: true,
          });
        }, 100);
      }
    };
    
    const handleBlur = () => {
      if (focusLostDebounce) clearTimeout(focusLostDebounce);
      focusLostDebounce = setTimeout(() => {
        handleViolation('FOCUS_LOST', {
          windowFocused: false,
        });
      }, 100);
    };
    
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        if (fullscreenExitDebounce) clearTimeout(fullscreenExitDebounce);
        fullscreenExitDebounce = setTimeout(() => {
          handleViolation('FULLSCREEN_EXIT', {
            fullscreenActive: false,
          });
        }, 100);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      if (tabSwitchDebounce) clearTimeout(tabSwitchDebounce);
      if (focusLostDebounce) clearTimeout(focusLostDebounce);
      if (fullscreenExitDebounce) clearTimeout(fullscreenExitDebounce);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleViolation]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
    };
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(false);

  // ============================================================================
  // RENDERING
  // ============================================================================

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getSectionName = (section: keyof Sections): string => {
    const names: { [key: string]: string } = {
      mcq: "Multiple Choice",
      subjective: "Subjective",
      pseudocode: "Pseudocode",
      coding: "Coding",
    };
    return names[section] || section;
  };

  // Loading state
  if (appState === "loading") {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "50px", height: "50px", border: "4px solid #6953a3", borderTop: "4px solid transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 1rem" }} />
          <p style={{ color: "#1a1625", fontSize: "1.125rem" }}>Loading assessment...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && appState !== "ready") {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div className="card" style={{ maxWidth: "600px", width: "100%", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>Error</h1>
          <p style={{ color: "#64748b", marginBottom: "2rem" }}>{error}</p>
          <button
            onClick={() => router.back()}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#6953a3",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // No questions
  if (questions.length === 0) {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div className="card" style={{ maxWidth: "600px", width: "100%", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>No Questions Available</h1>
          <p style={{ color: "#64748b", marginBottom: "2rem" }}>This assessment does not have any questions configured.</p>
        </div>
      </div>
    );
  }

  const currentQuestion = getCurrentQuestion();
  if (!currentQuestion || !currentSection) {
    // Debug information
    console.error("[take.tsx] No question available:", {
      currentQuestion,
      currentSection,
      sections,
      questionsLength: questions.length,
      currentQuestionIndex,
    });

    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center", maxWidth: "600px" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>No Question Available</h1>
          <p style={{ color: "#64748b", marginBottom: "1rem" }}>
            {questions.length === 0 
              ? "No questions were loaded from the assessment." 
              : `Questions loaded: ${questions.length}, but no current question could be found.`}
          </p>
          {questions.length > 0 && (
            <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "#ffffff", borderRadius: "0.5rem", textAlign: "left" }}>
              <p style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>Debug Info:</p>
              <p style={{ fontSize: "0.75rem", color: "#64748b" }}>Current Section: {currentSection || "null"}</p>
              <p style={{ fontSize: "0.75rem", color: "#64748b" }}>Question Index: {currentQuestionIndex}</p>
              <p style={{ fontSize: "0.75rem", color: "#64748b" }}>Sections:</p>
              <ul style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "1rem" }}>
                <li>MCQ: {sections.mcq.length}</li>
                <li>Subjective: {sections.subjective.length}</li>
                <li>Pseudocode: {sections.pseudocode.length}</li>
                <li>Coding: {sections.coding.length}</li>
              </ul>
          </div>
          )}
          <button
            onClick={() => {
              console.log("[take.tsx] Full state:", {
                questions,
                sections,
                currentSection,
                currentQuestionIndex,
              });
              // Try to set first available section
              const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
              const firstSection = sectionOrder.find((section) => sections[section].length > 0);
              if (firstSection) {
                setCurrentSection(firstSection);
                setCurrentQuestionIndex(0);
              }
            }}
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#6953a3",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Retry Loading
          </button>
        </div>
      </div>
    );
  }

  const currentSectionQuestions = sections[currentSection] || [];
  const questionId = getQuestionId(currentQuestion);
  const isFirstQuestion = currentQuestionIndex === 0 && currentSection === "mcq";
  
  // Check if this is the last question across all sections
  const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
  
  // Find the last non-empty section
  let lastSectionWithQuestions: keyof Sections | null = null;
  for (let i = sectionOrder.length - 1; i >= 0; i--) {
    const section = sectionOrder[i];
    if (sections[section] && sections[section].length > 0) {
      lastSectionWithQuestions = section;
      break;
    }
  }
  
  // Check if current question is the last question in the last section
  const isLastQuestion = lastSectionWithQuestions !== null &&
                         currentSection === lastSectionWithQuestions &&
                         currentQuestionIndex === currentSectionQuestions.length - 1 &&
                         currentQuestionIndex >= 0;

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem", position: "relative" }}>
      {/* Proctoring Active Indicator */}
      {proctorEnabled && (
        <div
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            backgroundColor: "#10b981",
            color: "#ffffff",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: "#ffffff",
              borderRadius: "50%",
              animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          />
          Proctoring Active – Recording
        </div>
      )}

      {/* Webcam Preview - bottom right */}
      {typeof window !== 'undefined' && (
        <WebcamPreview
          videoRef={thumbVideoRef}
          modelLoaded={modelLoaded}
          facesCount={detectionStatus?.facesCount}
        />
      )}

      {/* Non-blocking FaceMesh failure message */}
      {typeof window !== 'undefined' && (window as any).__faceMeshInitFailed && (
        <div
          style={{
            position: "fixed",
            top: "60px",
            right: "1rem",
            backgroundColor: "#f59e0b",
            color: "#ffffff",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            zIndex: 1001,
            maxWidth: "300px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          }}
        >
          FaceMesh initialization failed — proctoring degraded
        </div>
      )}

      {/* Proctoring Overlays */}
      {proctorEnabled && (
        <>
          <ProctorToast violation={proctorViolation} />
          <FullscreenWarningBanner isVisible={isFullscreen} />
        </>
      )}

      <div className="container">
        <div style={{ display: "flex", gap: "1.5rem" }}>
          {/* Left Sidebar - Sections */}
          <div style={{ 
            width: "200px", 
            backgroundColor: "#ffffff", 
            borderRadius: "0.5rem", 
            padding: "1rem",
            border: "1px solid #e2e8f0",
            height: "fit-content",
            position: "sticky",
            top: "2rem",
          }}>
            <h3 style={{ marginBottom: "1rem", fontSize: "1rem", color: "#1a1625", fontWeight: 700 }}>
              Sections
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {(["mcq", "pseudocode", "subjective", "coding"] as (keyof Sections)[]).map((section) => {
                const sectionQuestions = sections[section];
                if (sectionQuestions.length === 0) return null;

                const isActive = section === currentSection;
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => navigateToQuestion(section, 0)}
                    style={{
                      padding: "0.75rem",
                      textAlign: "left",
                      backgroundColor: isActive ? "#6953a3" : "#f8fafc",
                      color: isActive ? "#ffffff" : "#64748b",
                      border: `2px solid ${isActive ? "#6953a3" : "#e2e8f0"}`,
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      fontWeight: isActive ? 700 : 500,
                      fontSize: "0.875rem",
                      transition: "all 0.2s",
                    }}
                  >
                    {getSectionName(section)} ({sectionQuestions.length})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Panel */}
          <div style={{ flex: 1, backgroundColor: "#ffffff", borderRadius: "0.5rem", padding: "2rem", border: "1px solid #e2e8f0" }}>
            {/* Timer */}
                <div style={{
              marginBottom: "1.5rem",
                  padding: "1rem",
              backgroundColor: timerRemaining < 300 ? "#fef2f2" : "#f0f9ff",
              border: `2px solid ${timerRemaining < 300 ? "#ef4444" : "#3b82f6"}`,
                  borderRadius: "0.5rem",
                    textAlign: "center",
                  }}>
                    <p style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                      Assessment ends in:
                    </p>
                    <p style={{ 
                fontSize: "1.5rem",
                      fontWeight: 700, 
                color: timerRemaining < 300 ? "#dc2626" : "#1e40af",
                    }}>
                {formatTime(timerRemaining)}
                    </p>
                  </div>

            {/* Question Navigator */}
              <div style={{ marginBottom: "1.5rem", padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
                {currentSectionQuestions.map((_, idx) => {
                  const qId = currentSectionQuestions[idx]._id || `${currentSection}-${idx}`;
                  const isAnswered = answers.has(qId) || codeAnswers.has(qId);
                  const isCurrent = idx === currentQuestionIndex;
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center" }}>
                        <div
                          style={{
                            width: isCurrent ? "36px" : "32px",
                            height: isCurrent ? "36px" : "32px",
                            borderRadius: "50%",
                            backgroundColor: isCurrent ? "#6953a3" : isAnswered ? "#3b82f6" : "#e2e8f0",
                            color: isCurrent || isAnswered ? "#ffffff" : "#64748b",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: isCurrent ? "0.875rem" : "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            border: isCurrent ? "3px solid #6953a3" : "2px solid transparent",
                            transition: "all 0.2s",
                          }}
                        onClick={() => navigateToQuestion(currentSection, idx)}
                        title={`Question ${idx + 1} of ${currentSectionQuestions.length}${isAnswered ? " (Answered)" : ""}`}
                        >
                          {idx + 1}
                        </div>
                      {idx < currentSectionQuestions.length - 1 && (
                          <div
                            style={{
                              width: "20px",
                              height: "2px",
                            backgroundColor: isCurrent || idx < currentQuestionIndex ? "#6953a3" : "#cbd5e1",
                              margin: "0 2px",
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ textAlign: "center", marginTop: "0.5rem", fontSize: "0.75rem", color: "#64748b" }}>
                Question {currentQuestionIndex + 1} of {currentSectionQuestions.length} ({getSectionName(currentSection)})
                </div>
              </div>

            {/* Question Content */}
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <span style={{
                  padding: "0.25rem 0.75rem",
                  backgroundColor: "#10b981",
                  color: "#ffffff",
                              borderRadius: "9999px",
                  fontSize: "0.75rem",
                              fontWeight: 600,
                }}>
                            {currentQuestion.score || 5} pts
                          </span>
                <span style={{
                  padding: "0.25rem 0.75rem",
                  backgroundColor: "#e0e7ff",
                  color: "#4338ca",
                    borderRadius: "9999px",
                  fontSize: "0.75rem",
                    fontWeight: 600,
                }}>
                  {currentQuestion.difficulty}
                </span>
              </div>

                <div style={{ 
                padding: "1.5rem",
                backgroundColor: "#f8fafc",
                  borderRadius: "0.5rem",
                border: "1px solid #e2e8f0",
                marginBottom: "1rem",
                }}>
                <p style={{ color: "#1a1625", fontSize: "1rem", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                  {currentQuestion.questionText}
                </p>
                </div>

              {/* Answer Input Area */}
              {currentQuestion.type && currentQuestion.type.toLowerCase() === "mcq" && currentQuestion.options && (
                <div style={{ marginBottom: "1.5rem" }}>
                  {currentQuestion.options.map((option, idx) => {
                    const currentAnswer = answers.get(questionId) || "";
                    const isSelected = currentAnswer === option;
                    return (
                    <label
                        key={idx}
                      style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "1rem",
                        marginBottom: "0.5rem",
                          backgroundColor: isSelected ? "#e0e7ff" : "#ffffff",
                          border: `2px solid ${isSelected ? "#6953a3" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                          cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      <input
                        type="radio"
                          name={`question-${questionId}`}
                          value={option}
                          checked={isSelected}
                          onChange={(e) => {
                            const newAnswer = e.target.value;
                            setAnswers((prev) => {
                              const updated = new Map(prev);
                              updated.set(questionId, newAnswer);
                              return updated;
                            });
                            saveAnswer(questionId, newAnswer, currentSection);
                          }}
                          style={{ width: "20px", height: "20px", cursor: "pointer" }}
                        />
                        <span style={{ color: "#1a1625", fontSize: "0.875rem" }}>{option}</span>
                    </label>
                    );
                  })}
                </div>
              )}

              {currentQuestion.type && (currentQuestion.type.toLowerCase() === "subjective" || currentQuestion.type.toLowerCase() === "pseudocode") && (
                <div style={{ marginBottom: "1.5rem" }}>
                <textarea
                    value={answers.get(questionId) || ""}
                    onChange={(e) => {
                      const newAnswer = e.target.value;
                      setAnswers((prev) => {
                        const updated = new Map(prev);
                        updated.set(questionId, newAnswer);
                        return updated;
                      });
                      saveAnswer(questionId, newAnswer, currentSection);
                    }}
                  placeholder="Enter your answer here..."
                  style={{
                    width: "100%",
                      minHeight: "200px",
                      padding: "1rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                      fontFamily: currentQuestion.type && currentQuestion.type.toLowerCase() === "pseudocode" ? "monospace" : "inherit",
                    resize: "vertical",
                    }}
                  />
                </div>
              )}

              {currentQuestion.type && currentQuestion.type.toLowerCase() === "coding" && (
                <div style={{ marginBottom: "1.5rem" }}>
                  {currentQuestion.judge0_enabled ? (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: "0.5rem", padding: "1rem" }}>
                      <p style={{ color: "#64748b", marginBottom: "1rem" }}>Coding question with Judge0 enabled - use Monaco editor below</p>
                      <MonacoEditor
                        height="400px"
                        language={JUDGE0_TO_MONACO[currentQuestion.language || "71"] || "python"}
                        value={codeAnswers.get(questionId) || currentQuestion.starter_code || ""}
                        onChange={(value) => {
                          const code = value || "";
                          setCodeAnswers((prev) => {
                            const updated = new Map(prev);
                            updated.set(questionId, code);
                            return updated;
                          });
                          saveAnswer(questionId, code, currentSection);
                        }}
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 14,
                          lineNumbers: "on",
                          scrollBeyondLastLine: false,
                        }}
                      />
            </div>
                  ) : (
                    <MonacoEditor
                      height="400px"
                      language={JUDGE0_TO_MONACO[currentQuestion.language || "71"] || "python"}
                      value={codeAnswers.get(questionId) || currentQuestion.starter_code || ""}
                      onChange={(value) => {
                        const code = value || "";
                        setCodeAnswers((prev) => {
                          const updated = new Map(prev);
                          updated.set(questionId, code);
                          return updated;
                        });
                        saveAnswer(questionId, code, currentSection);
                      }}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                      }}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <button
                type="button"
                onClick={navigatePrevious}
                disabled={isFirstQuestion || appState === "submitting"}
                style={{ 
                  padding: "0.75rem 1.5rem",
                  backgroundColor: isFirstQuestion ? "#e2e8f0" : "#f8fafc",
                  color: isFirstQuestion ? "#94a3b8" : "#1a1625",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  cursor: isFirstQuestion ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  opacity: isFirstQuestion ? 0.5 : 1,
                }}
              >
                Previous
              </button>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                {/* Submit Assessment Button - Only show on last question */}
                {isLastQuestion ? (
                  <button
                    type="button"
                    onClick={submitAssessment}
                    disabled={appState === "submitting" || appState === "finished"}
                    style={{ 
                      padding: "0.75rem 1.5rem",
                      backgroundColor: (appState === "submitting" || appState === "finished") ? "#94a3b8" : "#10b981",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "0.5rem",
                      cursor: (appState === "submitting" || appState === "finished") ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      boxShadow: (appState === "submitting" || appState === "finished") ? "none" : "0 2px 4px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    {appState === "submitting" ? "Submitting..." : appState === "finished" ? "Submitted" : "Submit Assessment"}
                  </button>
                ) : (
                  /* Save & Next Button - Show for all questions except last */
                  <button
                    type="button"
                    onClick={navigateNext}
                    disabled={appState === "submitting"}
                    style={{ 
                      padding: "0.75rem 1.5rem",
                      backgroundColor: appState === "submitting" ? "#e2e8f0" : "#6953a3",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "0.5rem",
                      cursor: appState === "submitting" ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                    }}
                  >
                    Save & Next
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
