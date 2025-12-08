import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import axios from "axios";
import { useProctor, type ProctorViolation } from "@/hooks/useProctor";
import { useCameraProctor, type CameraProctorViolation } from "@/hooks/useCameraProctor";
import { useLiveProctor } from "@/hooks/useLiveProctor";
import { ProctorToast, FullscreenWarningBanner } from "@/components/proctor";
import { EditorContainer, type SubmissionTestcaseResult } from "@/components/dsa/test/EditorContainer";
import { getLanguageId, JUDGE0_ID_TO_LANG_NAME } from "@/lib/dsa/judge0";
import Split from 'react-split';

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
  // QUESTION GROUPING
  // ============================================================================

  const groupQuestions = useCallback((questions: Question[]): Sections => {
    const grouped: Sections = {
      mcq: [],
      subjective: [],
      pseudocode: [],
      coding: [],
    };

    questions.forEach((q) => {
      const rawType = (q.type || "").toLowerCase().trim();
      let normalizedType: keyof Sections | null = null;

      switch (rawType) {
        case "mcq":
        case "multiple choice":
        case "multiple_choice":
          normalizedType = "mcq";
          break;
        case "subjective":
        case "subjective question":
          normalizedType = "subjective";
          break;
        case "pseudo":
        case "pseudocode":
        case "pseudo code":
          normalizedType = "pseudocode";
          break;
        case "coding":
        case "code":
        case "programming":
          normalizedType = "coding";
          break;
        default:
          // Skip unknown types
          return;
      }

      if (normalizedType) {
        grouped[normalizedType].push(q);
      }
    });

    return grouped;
  }, []);

  // ============================================================================
  // GET CURRENT QUESTION
  // ============================================================================

  const getCurrentQuestion = useCallback((): Question | null => {
    if (!currentSection || !sections[currentSection]) return null;
    const sectionQuestions = sections[currentSection];
    if (currentQuestionIndex >= 0 && currentQuestionIndex < sectionQuestions.length) {
      return sectionQuestions[currentQuestionIndex];
    }
    return null;
  }, [currentSection, sections, currentQuestionIndex]);

  const getQuestionId = useCallback((question: Question): string => {
    return question._id || `${currentSection}-${currentQuestionIndex}`;
  }, [currentSection, currentQuestionIndex]);

  // ============================================================================
  // TIMER LOGIC
  // ============================================================================

  const calculateTimer = useCallback((settings: ExamSettings, sections: Sections): number => {
    if (settings.timerMode === "section") {
      // Sum of all section time allocations
      let total = 0;
      if (settings.sectionTimes) {
        Object.keys(sections).forEach((sectionKey) => {
          const sectionTime = settings.sectionTimes?.[sectionKey] || 0;
          total += sectionTime * 60; // Convert minutes to seconds
        });
      }
      return total;
    } else if (settings.timerMode === "estimated") {
      // Use estimatedTotalTime
      return settings.estimatedTotalTime * 60; // Convert minutes to seconds
    } else if (settings.timerMode === "scheduleOnly") {
      // This should be calculated from schedule, but for now use estimated as fallback
      return settings.estimatedTotalTime * 60;
    }
    // Default to estimated
    return settings.estimatedTotalTime * 60;
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

    // Debounce: wait 500ms before saving
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const lastSaved = lastSavedAnswerRef.current.get(questionId);
        if (lastSaved === answer) {
          // Skip if answer hasn't changed
          return;
        }

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

  const navigateToQuestion = useCallback((section: keyof Sections, index: number) => {
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
  }, [sections, logAnalyticsEvent, getQuestionId]);

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
    if (!attemptId || !id || !token || !candidateEmail || !candidateName) return;

    setAppState("submitting");

    try {
      // Collect all answers
      const allAnswers: Array<{ questionIndex: number; answer: string; timeSpent: number }> = [];
      let globalIndex = 0;

      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
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

      // Submit to backend
      await axios.post("/api/assessment/submit-answers", {
        assessmentId: id,
        token,
        email: candidateEmail,
        name: candidateName,
        answers: allAnswers,
        skippedQuestions: [],
      });

      await logAnalyticsEvent("EXAM_SUBMIT", { totalAnswers: allAnswers.length });

      setAppState("finished");
      router.push(`/assessment/${id}/${token}/completed`);
    } catch (error: any) {
      console.error("[Submit] Failed to submit assessment:", error);
      setError(error.response?.data?.message || "Failed to submit assessment");
      setAppState("ready");
    }
  }, [attemptId, id, token, candidateEmail, candidateName, answers, codeAnswers, sections, logAnalyticsEvent, router]);

  // ============================================================================
  // DATA LOADING
  // ============================================================================

  useEffect(() => {
    if (!id || !token || typeof id !== "string" || typeof token !== "string") return;

    const loadAssessment = async () => {
      try {
        setAppState("loading");

        // Load candidate info from session
        const email = sessionStorage.getItem("candidateEmail") || "";
        const name = sessionStorage.getItem("candidateName") || "";
        setCandidateEmail(email);
        setCandidateName(name);

        // Fetch questions and settings
        const questionsResponse = await axios.get(`/api/assessment/get-questions?assessmentId=${id}&token=${token}`);
        
        if (!questionsResponse.data?.success) {
          throw new Error("Failed to load questions");
        }

        const fetchedQuestions = questionsResponse.data.data.questions || [];
        const fetchedSettings: ExamSettings = {
          timerMode: questionsResponse.data.data.timerMode || "estimated",
          estimatedTotalTime: questionsResponse.data.data.estimatedTotalTime || 60,
          sectionTimes: questionsResponse.data.data.questionTypeTimes || {},
        };
        const fetchedProctoring = questionsResponse.data.data.proctoring || {};
        const fetchedAttemptId = questionsResponse.data.data.attemptId || "";

        setQuestions(fetchedQuestions);
        setExamSettings(fetchedSettings);
        setProctoringSettings(fetchedProctoring);
        setAttemptId(fetchedAttemptId);

        // Group questions
        const grouped = groupQuestions(fetchedQuestions);
        setSections(grouped);

        // Set first non-empty section as current
        const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding"];
        const firstSection = sectionOrder.find((section) => grouped[section].length > 0);
        if (firstSection) {
          setCurrentSection(firstSection);
          setCurrentQuestionIndex(0);
        }

        // Calculate and set timer
        const calculatedTimer = calculateTimer(fetchedSettings, grouped);
        setTimerRemaining(calculatedTimer);

        setAppState("ready");
      } catch (error: any) {
        console.error("[Load] Failed to load assessment:", error);
        setError(error.response?.data?.message || "Failed to load assessment");
        setAppState("ready");
      }
    };

    loadAssessment();
  }, [id, token, groupQuestions, calculateTimer]);

  // ============================================================================
  // TIMER COUNTDOWN
  // ============================================================================

  useEffect(() => {
    if (appState !== "ready" || timerRemaining <= 0) return;

    timerIntervalRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        if (prev <= 1) {
          // Timer expired - auto-submit
          submitAssessment();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [appState, timerRemaining, submitAssessment]);

  // ============================================================================
  // PROCTORING INTEGRATION
  // ============================================================================

  const handleProctorViolation = useCallback((violation: ProctorViolation) => {
    logAnalyticsEvent("TAB_SWITCH", { violation: violation.eventType });
  }, [logAnalyticsEvent]);

  const handleCameraViolation = useCallback((violation: CameraProctorViolation) => {
    logAnalyticsEvent("TAB_SWITCH", { violation: violation.eventType });
  }, [logAnalyticsEvent]);

  // Initialize proctoring hooks
  const proctorEnabled = proctoringSettings.enabled || false;
  const { violations: proctorViolations } = useProctor({
    userId: candidateEmail,
    assessmentId: id as string,
    onViolation: handleProctorViolation,
    enableFullscreenDetection: proctoringSettings.fullscreenMonitoring || false,
    enableDevToolsDetection: proctoringSettings.browserExtensionMonitoring || false,
  });

  const { lastViolation: cameraViolation } = useCameraProctor({
    userId: candidateEmail,
    assessmentId: id as string,
    onViolation: handleCameraViolation,
    enabled: proctoringSettings.multiFaceDetection || false,
  });

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
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#1a1625", fontSize: "1.125rem" }}>No question available</p>
        </div>
      </div>
    );
  }

  const currentSectionQuestions = sections[currentSection];
  const questionId = getQuestionId(currentQuestion);
  const isFirstQuestion = currentQuestionIndex === 0 && currentSection === "mcq";
  const isLastQuestion = currentQuestionIndex === currentSectionQuestions.length - 1 && currentSection === "coding";

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem" }}>
      {/* Proctoring Overlays */}
      {proctorEnabled && (
        <>
          <ProctorToast violation={proctorViolations[0] || cameraViolation || null} />
          <FullscreenWarningBanner isVisible={!document.fullscreenElement && !(document as any).webkitFullscreenElement && !(document as any).msFullscreenElement} />
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
              {currentQuestion.type.toLowerCase() === "mcq" && currentQuestion.options && (
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

              {(currentQuestion.type.toLowerCase() === "subjective" || currentQuestion.type.toLowerCase() === "pseudocode") && (
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
                      fontFamily: currentQuestion.type.toLowerCase() === "pseudocode" ? "monospace" : "inherit",
                      resize: "vertical",
                    }}
                  />
                </div>
              )}

              {currentQuestion.type.toLowerCase() === "coding" && (
                <div style={{ marginBottom: "1.5rem" }}>
                  {currentQuestion.judge0_enabled ? (
                    <EditorContainer
                      code={codeAnswers.get(questionId) || currentQuestion.starter_code || ""}
                      language={currentQuestion.language || "71"}
                      languages={["71"]}
                      starterCode={{ [currentQuestion.language || "71"]: currentQuestion.starter_code || "" }}
                      onCodeChange={(code: string) => {
                        setCodeAnswers((prev) => {
                          const updated = new Map(prev);
                          updated.set(questionId, code);
                          return updated;
                        });
                        saveAnswer(questionId, code, currentSection);
                      }}
                      onLanguageChange={() => {}}
                      onRun={() => {
                        logAnalyticsEvent("CODE_RUN", { questionId, language: currentQuestion.language });
                      }}
                      onSubmit={() => {}}
                      onReset={() => {}}
                    />
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
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

              {isLastQuestion ? (
                <button
                  type="button"
                  onClick={submitAssessment}
                  disabled={appState === "submitting"}
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: appState === "submitting" ? "#94a3b8" : "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    cursor: appState === "submitting" ? "not-allowed" : "pointer",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                  }}
                >
                  {appState === "submitting" ? "Submitting..." : "Submit Assessment"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={navigateNext}
                  style={{
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
                  Save & Next
                </button>
              )}
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

