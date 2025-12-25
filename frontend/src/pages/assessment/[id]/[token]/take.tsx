import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/router";


import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import axios from "axios";
import { EditorContainer, SubmissionTestcaseResult } from "@/components/dsa/test/EditorContainer";
import type { SubmissionHistoryEntry } from "@/components/dsa/test/EditorContainer";
import { SQLEditorContainer } from "@/components/assessment/editors/SQLEditorContainer";
import AIMLCompetencyNotebook from "@/components/assessment/editors/AIMLCompetencyNotebook";
import { QuestionSidebar } from "@/components/dsa/test/QuestionSidebar";
import { QuestionTabs } from "@/components/dsa/test/QuestionTabs";
import { JUDGE0_ID_TO_LANG_NAME, getLanguageId, LANGUAGE_IDS } from "@/lib/dsa/judge0";
import dsaApi from "@/lib/dsa/api";
import assessmentApi from "@/lib/assessment/api";
import Split from 'react-split';  

// Universal Proctoring imports
import {
  useUniversalProctoring,
  CandidateLiveService,
  resolveUserIdForProctoring,
  type ProctoringViolation,
} from "@/universal-proctoring";
import WebcamPreview from "@/components/WebcamPreview";
import { ViolationToast, pushViolationToast } from "@/components/ViolationToast";

// Fullscreen Lock imports
import { FullscreenLockOverlay } from "@/components/FullscreenLockOverlay";
import { useFullscreenLock } from "@/hooks/useFullscreenLock";

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

// Table schema for SQL questions
interface TableSchema {
  columns: Record<string, string>; // column_name: data_type
}

interface Question {
  _id?: string;
  id?: string; // Alternative ID field
  questionText?: string;
  title?: string; // For AIML/SQL questions
  description?: string; // For AIML/SQL questions
  type: string;
  question_type?: string; // Alternative type field (for SQL/AIML)
  difficulty: string;
  options?: string[];
  correctAnswer?: string;
  idealAnswer?: string;
  expectedLogic?: string;
  time?: number;
  score?: number;
  topic?: string;
  language?: string;
  languages?: string[]; // For coding questions with multiple language support
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
  starter_code?: string | Record<string, string>; // Can be string or object for multi-language
  starter_query?: string; // For SQL questions
  public_testcases?: Array<{ input: string; expected_output: string }>;
  hidden_testcases?: Array<{ input: string; expected_output: string }>;
  // SQL-specific fields
  sql_category?: string;
  schemas?: Record<string, TableSchema>;
  sample_data?: Record<string, any[][]>;
  hints?: string[];
  constraints?: string[];
  // AIML-specific fields
  library?: string;
  tasks?: Array<string | { id: string; title: string; description: string }>;
  dataset?: {
    schema: Array<{ name: string; type: string }>;
    rows: any[];
    format?: string;
  };
  dataset_path?: string;
  dataset_url?: string;
  requires_dataset?: boolean;
  function_signature?: {
    name: string;
    parameters: Array<{ name: string; type: string }>;
    return_type: string;
  };
}

interface Sections {
  mcq: Question[];
  subjective: Question[];
  pseudocode: Question[];
  coding: Question[];
  sql: Question[];
  aiml: Question[];
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
  duration: number; // in minutes
  examMode?: "strict" | "flexible";
  enablePerSectionTimers?: boolean;
  sectionTimers?: {
    MCQ: number;
    Subjective: number;
    PseudoCode: number;
    Coding: number;
    SQL: number;
    AIML: number;
  };
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
    sql: [],
    aiml: [],
  });
  const [currentSection, setCurrentSection] = useState<keyof Sections | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Map<string, string>>(new Map());
  const [codeAnswers, setCodeAnswers] = useState<Map<string, string>>(new Map());
  // Additional state for EditorContainer components
  const [code, setCode] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [output, setOutput] = useState<Record<string, {
    stdout?: string;
    stderr?: string;
    compileOutput?: string;
    status?: string;
    time?: number;
    memory?: number;
    error?: string;
  }>>({});
  // State for test case results (matching DSA interface)
  const [publicResults, setPublicResults] = useState<Record<string, SubmissionTestcaseResult[]>>({});
  const [hiddenSummary, setHiddenSummary] = useState<Record<string, { total: number; passed: number } | null>>({});
  const [submissionHistory, setSubmissionHistory] = useState<Record<string, SubmissionHistoryEntry[]>>({});
  const [questionStatus, setQuestionStatus] = useState<Record<string, 'not_attempted' | 'attempted' | 'solved'>>({});
  const [timerRemaining, setTimerRemaining] = useState<number>(0); // in seconds (for overall timer)
  const [sectionTimers, setSectionTimers] = useState<Record<string, number>>({}); // per-section timers in seconds
  const [lockedSections, setLockedSections] = useState<Set<string>>(new Set()); // locked section keys
  const [examSettings, setExamSettings] = useState<ExamSettings>({
    duration: 60,
  });
  const [attemptId, setAttemptId] = useState<string>("");
  const [candidateEmail, setCandidateEmail] = useState<string>("");
  const [candidateName, setCandidateName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [waitingForStart, setWaitingForStart] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [timeUntilStart, setTimeUntilStart] = useState<number>(0);

  // Refs for debouncing and cleanup
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sectionTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedAnswerRef = useRef<Map<string, string>>(new Map());

  // ============================================================================
  // PROCTORING STATE & REFS (Universal Proctoring System)
  // ============================================================================

  // AI (camera-based) proctoring toggle from schedule.proctoringSettings
  const [aiProctoringEnabled, setAiProctoringEnabled] = useState(false);
  const [liveProctoringEnabled, setLiveProctoringEnabled] = useState(false);
  const [liveProctorScreenStream, setLiveProctorScreenStream] = useState<MediaStream | null>(null);
  
  // Universal proctoring hook
  const thumbVideoRef = useRef<HTMLVideoElement>(null);
  const liveProctoringServiceRef = useRef<CandidateLiveService | null>(null);
  const liveProctoringStartedRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);

  // Get client-side values safely
  const isClient = typeof window !== 'undefined';
  const assessmentIdStr = typeof id === 'string' ? id : '';
  const tokenStr = typeof token === 'string' ? token : '';
  
  // Resolve userId with priority: email > token > anonymous
  // Note: session.user.id would be ideal but requires SessionProvider context
  // For token-based public access, this fallback pattern works correctly
  const fallbackEmail = candidateEmail || 
    (isClient ? sessionStorage.getItem('candidateEmail') : null) ||
    (isClient ? sessionStorage.getItem('candidateName') : null);
  
  const candidateIdStr = resolveUserIdForProctoring(null, {
    email: fallbackEmail,
    token: tokenStr,
  });

  // Get violation message
  const getViolationMessage = (eventType: string): string => {
    const messages: Record<string, string> = {
      GAZE_AWAY: 'Please keep your eyes on the screen',
      MULTIPLE_FACES_DETECTED: 'Multiple faces detected in frame',
      NO_FACE_DETECTED: 'Please stay in front of the camera',
      TAB_SWITCH: 'Tab switch detected',
      FOCUS_LOST: 'Window focus lost',
      FULLSCREEN_EXIT: 'Exited fullscreen mode',
    };
    return messages[eventType] || 'Violation detected';
  };

  // ============================================================================
  // FULLSCREEN LOCK - Violation-driven lock state (SIMPLIFIED)
  // ============================================================================
  const {
    isLocked: isFullscreenLocked,
    setIsLocked: setFullscreenLocked,
    exitCount: fullscreenExitCount,
    incrementExitCount: incrementFullscreenExitCount,
    requestFullscreen: requestFullscreenLock,
  } = useFullscreenLock();

  // Handle violation callback from universal proctoring
  // THIS IS THE SINGLE SOURCE OF TRUTH for fullscreen lock triggering
  const handleUniversalViolation = useCallback((violation: ProctoringViolation) => {
    console.log('[Assessment Take] Universal proctoring violation:', violation);
    
    // Show toast for all violations
    pushViolationToast({
      id: `${violation.eventType}-${Date.now()}`,
      eventType: violation.eventType,
      message: getViolationMessage(violation.eventType),
      timestamp: violation.timestamp,
    });

    // FULLSCREEN_EXIT violation triggers the fullscreen lock overlay
    if (violation.eventType === 'FULLSCREEN_EXIT') {
      console.log('[Assessment Take] FULLSCREEN_EXIT violation - locking screen');
      setFullscreenLocked(true);
      incrementFullscreenExitCount();
    }
  }, [setFullscreenLocked, incrementFullscreenExitCount]);

  // Handle fullscreen re-entry - unlock the screen
  const handleRequestFullscreen = useCallback(async (): Promise<boolean> => {
    console.log('[Assessment Take] Requesting fullscreen re-entry...');
    const success = await requestFullscreenLock();
    if (success) {
      console.log('[Assessment Take] Fullscreen re-entered - unlocking screen');
      setFullscreenLocked(false);
    }
    return success;
  }, [requestFullscreenLock, setFullscreenLocked]);

  // Universal proctoring hook - handles AI proctoring, tab switch, fullscreen
  const {
    state: proctoringState,
    isRunning: isProctoringRunning,
    violations,
    startProctoring: startUniversalProctoring,
    stopProctoring: stopUniversalProctoring,
    requestFullscreen: requestUniversalFullscreen,
    isFullscreen,
  } = useUniversalProctoring({
    onViolation: handleUniversalViolation,
    debug: debugMode,
  });

  // Unlock fullscreen when assessment is submitted/finished
  useEffect(() => {
    if (appState === 'finished' || appState === 'submitting') {
      console.log('[Assessment Take] Assessment finished - unlocking fullscreen');
      setFullscreenLocked(false);
    }
  }, [appState, setFullscreenLocked]);

  // Get screen stream from window.__screenStream (set by identity-verify gate)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__screenStream) {
      const stream = (window as any).__screenStream as MediaStream;
      if (stream && stream.active && stream.getVideoTracks().length > 0) {
        setLiveProctorScreenStream(stream);
        console.log('[Assessment Take] Found global screen stream for Live Proctoring');
      }
    }
  }, []);

  // Start proctoring when assessment is ready (AI proctoring + tab switch + fullscreen)
  useEffect(() => {
    if (appState === 'ready' && !isProctoringRunning && isClient && thumbVideoRef.current) {
      console.log('[Assessment Take] Starting Universal Proctoring...');
      
      startUniversalProctoring({
        settings: {
          aiProctoringEnabled: aiProctoringEnabled,
          liveProctoringEnabled: liveProctoringEnabled,
        },
        session: {
          userId: candidateIdStr,
          assessmentId: assessmentIdStr,
        },
        videoElement: aiProctoringEnabled ? thumbVideoRef.current : null,
      }).then((success) => {
        if (success) {
          console.log('[Assessment Take] ✅ Universal Proctoring started');
        } else {
          console.error('[Assessment Take] ❌ Failed to start Universal Proctoring');
        }
      });
    }
  }, [appState, isProctoringRunning, isClient, aiProctoringEnabled, liveProctoringEnabled, candidateIdStr, assessmentIdStr, startUniversalProctoring]);

  // Start Live Proctoring (separate from AI proctoring)
  useEffect(() => {
    if (!liveProctoringEnabled || !liveProctorScreenStream || liveProctoringStartedRef.current) {
      return;
    }

    // Only start when assessment is ready
    if (appState !== 'ready') {
      return;
    }

    console.log('[Assessment Take] Starting Live Proctoring service...');
    liveProctoringStartedRef.current = true;

    // Create and start the live proctoring service
    const liveService = new CandidateLiveService({
      assessmentId: assessmentIdStr,
      candidateId: candidateIdStr,
      debugMode: debugMode,
    });

    liveService.start(
      {
        onStateChange: (state) => {
          console.log('[Assessment Take] Live proctoring state:', state);
        },
        onError: (error) => {
          console.error('[Assessment Take] Live Proctoring error:', error);
        },
      },
      liveProctorScreenStream
    ).then((success) => {
      if (success) {
        console.log('[Assessment Take] ✅ Live Proctoring started');
        liveProctoringServiceRef.current = liveService;
      } else {
        console.error('[Assessment Take] ❌ Failed to start Live Proctoring');
        liveProctoringStartedRef.current = false;
      }
    });
  }, [liveProctoringEnabled, liveProctorScreenStream, appState, assessmentIdStr, candidateIdStr, debugMode]);

  // Stop proctoring when assessment ends
  useEffect(() => {
    if (appState === 'finished') {
      console.log('[Assessment Take] Assessment finished, stopping proctoring');
      stopUniversalProctoring();
      
      if (liveProctoringServiceRef.current) {
        liveProctoringServiceRef.current.stop();
        liveProctoringServiceRef.current = null;
      }
    }
  }, [appState, stopUniversalProctoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopUniversalProctoring();
      if (liveProctoringServiceRef.current) {
        liveProctoringServiceRef.current.stop();
        liveProctoringServiceRef.current = null;
      }
    };
  }, [stopUniversalProctoring]);

  // ============================================================================
  // TRANSFORM topics_v2 TO SECTIONS
  // ============================================================================

  const transformTopicsV2ToSections = useCallback((topics_v2: any[]): { sections: Sections; allQuestions: Question[] } => {
    const sections: Sections = {
      mcq: [],
      subjective: [],
      pseudocode: [],
      coding: [],
      sql: [],
      aiml: [],
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
    if (!Array.isArray(topics_v2) || topics_v2.length === 0) {
      console.warn("[take.tsx] topics_v2 is not a valid array or is empty");
      return { sections, allQuestions };
    }
    
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
        const rowStatus = row.status;
        
        // Get questions array - check multiple possible locations
        let questions = Array.isArray(row.questions) ? row.questions : [];
        
        // If questions array is empty, check if questions are stored elsewhere
        if (questions.length === 0) {
          // Check if questions are in a different format or location
          if (row.question && typeof row.question === "object") {
            questions = [row.question];
          } else if (Array.isArray(row.question)) {
            questions = row.question;
          }
        }
        
        // Only process rows with "generated" or "completed" status, or if status is missing (for backward compatibility)
        const isGeneratedOrCompleted = !rowStatus || rowStatus === "generated" || rowStatus === "completed";
        
        if (!isGeneratedOrCompleted) {
          console.log(`[take.tsx] Row ${rowIndex} (${questionType}) in topic ${topicIndex} has status "${rowStatus}", skipping (not generated/completed)`);
          return;
        }
        
        if (questions.length === 0) {
          console.warn(`[take.tsx] Row ${rowIndex} (${questionType}) in topic ${topicIndex} has no questions array or it's empty. Row data:`, {
            rowId,
            questionType,
            difficulty,
            rowStatus,
            hasQuestionsProperty: 'questions' in row,
            hasQuestionProperty: 'question' in row,
            rowKeys: Object.keys(row),
          });
          return;
        }

        console.log(`[take.tsx] Processing row ${rowIndex} (${questionType}):`, {
          rowId,
          questionType,
          difficulty,
          questionsCount: questions.length,
          questionsArray: questions, // Show actual questions array
          rowStatus: row.status,
          rowKeys: Object.keys(row),
          hasQuestionsProperty: 'questions' in row,
          questionsIsArray: Array.isArray(questions),
        });
        
        // Log first question if exists
        if (questions.length > 0) {
          console.log(`[take.tsx] First question in row ${rowIndex}:`, JSON.stringify(questions[0], null, 2));
        } else {
          console.warn(`[take.tsx] Row ${rowIndex} has no questions! Row data:`, JSON.stringify(row, null, 2));
        }

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

          // Check for SQL or AIML in question_type field first
          const questionTypeField = (question.question_type || "").toLowerCase().trim();
          if (questionTypeField === "sql" || normalizedType === "sql") {
            // SQL questions go into their own section
            sectionKey = "sql";
          } else if (questionTypeField === "aiml" || normalizedType === "aiml") {
            // AIML questions go into their own section
            sectionKey = "aiml";
          } else if (normalizedType === "mcq" || normalizedType.includes("mcq") || normalizedType.includes("multiple")) {
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
            } else if (question.judge0_enabled || question.coding_data || question.starter_code || question.public_testcases || question.starter_query || question.schemas || question.library || question.dataset) {
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
      sql: sections.sql.length,
      aiml: sections.aiml.length,
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

  const calculateTimer = useCallback((settings: ExamSettings): number => {
    // Simple duration-based timer (Custom-MCQ style)
    // Use duration from schedule (in minutes), convert to seconds
    const durationMinutes = settings.duration || 60; // Default to 60 minutes if not set
    const timerSeconds = durationMinutes * 60; // Convert minutes to seconds
    console.log("[take.tsx] Timer calculation: duration =", durationMinutes, "minutes =", timerSeconds, "seconds");
    return timerSeconds;
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
  // CODE EXECUTION (DSA-style)
  // ============================================================================

  const handleRunCode = async (questionId: string, question: Question) => {
    setRunning(true);
    setOutput(prev => ({ ...prev, [questionId]: {} }));
    setPublicResults(prev => ({ ...prev, [questionId]: [] }));

    try {
      const currentCode = code[questionId] || codeAnswers.get(questionId) || '';
      const currentLang = language[questionId] || 'python';
      const languageId = getLanguageId(currentLang);

      if (!languageId) {
        alert(`Unsupported language: ${currentLang}`);
        setRunning(false);
        return;
      }

      // Get question ID - prefer actual MongoDB _id from question object
      // The question object should have _id from the database, not the generated frontend ID
      let qId = question._id || question.id;
      
      // If the question doesn't have a MongoDB _id, we need to use the generated ID
      // but we should also pass additional context to help the backend find it
      if (!qId || (typeof qId === 'string' && !/^[0-9a-fA-F]{24}$/.test(qId))) {
        // This is a generated ID, use it but the backend will need to search by pattern
        qId = questionId;
      }
      
      // Convert ObjectId to string if it's an object
      const questionIdStr = (typeof qId === 'object' && qId !== null && 'toString' in qId) 
        ? (qId as any).toString() 
        : String(qId);
      
      // Get assessment ID from router - this is critical for finding the question
      const assessmentId = router.query.id as string;
      
      if (!assessmentId) {
        throw new Error('Assessment ID is missing');
      }
      
      // Verify question has testcases before attempting to run
      const publicTestCases = question.public_testcases || (question as any).coding_data?.public_testcases || [];
      if (!publicTestCases || publicTestCases.length === 0) {
        throw new Error('Question has no public test cases to run');
      }
      
      // Use Next.js API route as proxy to handle CORS and errors better
      const response = await fetch('/api/assessment/run-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assessmentId: assessmentId,
          questionId: questionIdStr,
          sourceCode: currentCode,
          languageId: languageId,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || errorData.detail || `HTTP ${response.status}`);
      }
      
      const result = await response.json();

      const mappedResults: SubmissionTestcaseResult[] = (result.public_results || []).map((r: any) => ({
        visible: true,
        input: r.input,
        expected: r.expected_output,
        output: r.user_output || r.stdout || '',
        stdout: r.user_output || r.stdout || '',
        stderr: r.stderr || '',
        compile_output: r.compile_output || '',
        time: r.time,
        memory: r.memory,
        status: r.status,
        passed: r.passed,
      }));

      setPublicResults(prev => ({ ...prev, [questionId]: mappedResults }));

      const allPassed = result.public_summary?.passed === result.public_summary?.total;
      setOutput(prev => ({
        ...prev,
        [questionId]: {
          stdout: allPassed
            ? `✅ All ${result.public_summary?.total || 0} public test cases passed!`
            : `❌ ${result.public_summary?.passed || 0}/${result.public_summary?.total || 0} public test cases passed`,
          status: result.status,
        }
      }));

      setQuestionStatus(prev => ({ ...prev, [questionId]: 'attempted' }));
    } catch (error: any) {
      console.error('Run error:', error);
      
      // Handle network errors more gracefully
      let errorMessage = 'Failed to run code';
      
      if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        // Check if it's a CORS error (which often shows as Network Error)
        if (error.message?.includes('CORS') || error.code === 'ERR_FAILED') {
          errorMessage = 'CORS error: Backend may not be running or CORS is not configured. Please check backend logs.';
        } else {
          errorMessage = 'Unable to connect to code execution service. Please check your connection and try again.';
        }
      } else if (error.response) {
        // Server responded with error status
        const status = error.response?.status;
        const detail = error.response?.data?.detail || error.response?.data?.message;
        
        if (status === 404) {
          errorMessage = `Question not found. The question ID might be incorrect.`;
        } else if (status === 400) {
          errorMessage = detail || 'Invalid request. Please check if the question has test cases.';
        } else if (status === 500) {
          errorMessage = detail || 'Server error while executing code. Please check backend logs for details.';
        } else {
          errorMessage = detail || error.response?.statusText || `Server error: ${status}`;
        }
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = 'No response from server. Please check if the backend service is running on port 8000.';
      } else {
        // Something else happened (like validation error)
        errorMessage = error.message || 'Failed to run code';
      }
      
      setOutput(prev => ({
        ...prev,
        [questionId]: {
          stderr: errorMessage,
          status: 'error'
        }
      }));
    } finally {
      setRunning(false);
    }
  };

  const handleSubmitCode = async (questionId: string, question: Question) => {
    setSubmitting(true);
    setOutput(prev => ({ ...prev, [questionId]: {} }));
    setPublicResults(prev => ({ ...prev, [questionId]: [] }));
    setHiddenSummary(prev => ({ ...prev, [questionId]: null }));

    try {
      const currentLang = language[questionId] || 'python';
      const currentCode = code[questionId] || codeAnswers.get(questionId) || '';
      const languageId = getLanguageId(currentLang);

      if (!languageId) {
        alert(`Unsupported language: ${currentLang}`);
        setSubmitting(false);
        return;
      }

      // Get question ID - prefer actual MongoDB _id from question object
      // The question object should have _id from the database, not the generated frontend ID
      let qId = question._id || question.id;
      
      // If the question doesn't have a MongoDB _id, we need to use the generated ID
      // but we should also pass additional context to help the backend find it
      if (!qId || (typeof qId === 'string' && !/^[0-9a-fA-F]{24}$/.test(qId))) {
        // This is a generated ID, use it but the backend will need to search by pattern
        qId = questionId;
      }
      
      // Convert ObjectId to string if it's an object
      const questionIdStr = (typeof qId === 'object' && qId !== null && 'toString' in qId) 
        ? (qId as any).toString() 
        : String(qId);
      
      // Get assessment ID from router
      const assessmentId = router.query.id as string;

      const response = await assessmentApi.post('/submit', {
        question_id: questionIdStr,
        source_code: currentCode,
        language_id: languageId,
        assessment_id: assessmentId,
      });

      const result = response.data;

      const mappedResults: SubmissionTestcaseResult[] = (result.public_results || []).map((r: any) => ({
        visible: true,
        input: r.input,
        expected: r.expected_output,
        output: r.user_output || r.stdout || '',
        stdout: r.user_output || r.stdout || '',
        stderr: r.stderr || '',
        compile_output: r.compile_output || '',
        time: r.time,
        memory: r.memory,
        status: r.status,
        passed: r.passed,
      }));

      setPublicResults(prev => ({ ...prev, [questionId]: mappedResults }));

      if (result.hidden_summary) {
        setHiddenSummary(prev => ({
          ...prev,
          [questionId]: {
            total: result.hidden_summary.total,
            passed: result.hidden_summary.passed,
          }
        }));
      }

      const allPublicPassed = result.public_summary?.passed === result.public_summary?.total;
      const allHiddenPassed = result.hidden_summary?.passed === result.hidden_summary?.total;
      const allPassed = allPublicPassed && allHiddenPassed;

      let outputMessage = '';
      if (allPassed) {
        outputMessage = `✅ All test cases passed!\n\nPublic: ${result.public_summary?.passed || 0}/${result.public_summary?.total || 0}\nHidden: ${result.hidden_summary?.passed || 0}/${result.hidden_summary?.total || 0}`;
      } else {
        outputMessage = `❌ Some test cases failed\n\nPublic: ${result.public_summary?.passed || 0}/${result.public_summary?.total || 0}\nHidden: ${result.hidden_summary?.passed || 0}/${result.hidden_summary?.total || 0}`;
      }

      setOutput(prev => ({
        ...prev,
        [questionId]: {
          stdout: outputMessage,
          status: allPassed ? 'accepted' : 'wrong_answer',
        }
      }));

      setQuestionStatus(prev => ({ ...prev, [questionId]: allPassed ? 'solved' : 'attempted' }));

      // Add to submission history
      const historyEntry: SubmissionHistoryEntry = {
        id: result.submission_id || `submission-${questionId}-${Date.now()}`,
        status: result.status || (allPassed ? 'accepted' : 'wrong_answer'),
        passed: (result.public_summary?.passed || 0) + (result.hidden_summary?.passed || 0),
        total: (result.public_summary?.total || 0) + (result.hidden_summary?.total || 0),
        score: result.score || 0,
        max_score: result.max_score || 100,
        created_at: new Date().toISOString(),
        results: mappedResults,
        public_results: mappedResults,
        hidden_summary: result.hidden_summary,
      };

      setSubmissionHistory(prev => {
        const existing = prev[questionId] || [];
        const updated = [historyEntry, ...existing].slice(0, 5);
        return { ...prev, [questionId]: updated };
      });

      // Save the submitted code as answer
      await saveAnswer(questionId, currentCode, currentSection || 'coding');
    } catch (error: any) {
      console.error('Submit error:', error);
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to submit code';
      setOutput(prev => ({
        ...prev,
        [questionId]: {
          stderr: errorMessage,
          status: 'error'
        }
      }));
    } finally {
      setSubmitting(false);
    }
  };

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
    
    // Check if section is locked (only for per-section timers)
    if (examSettings?.enablePerSectionTimers && lockedSections.has(section)) {
      alert(`This section has been locked because its timer expired. You cannot access questions in this section.`);
      return;
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
  }, [sections, logAnalyticsEvent, getQuestionId, getCurrentQuestion, currentSection, answers, codeAnswers, attemptId, timerRemaining, lockedSections, examSettings]);

  const navigateNext = useCallback(() => {
    if (!currentSection) return;

    const sectionQuestions = sections[currentSection];
    if (currentQuestionIndex < sectionQuestions.length - 1) {
      navigateToQuestion(currentSection, currentQuestionIndex + 1);
      logAnalyticsEvent("NAVIGATION_NEXT", { section: currentSection, index: currentQuestionIndex });
      } else {
      // Move to next section
      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"];
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex < sectionOrder.length - 1) {
        const nextSection = sectionOrder[currentIndex + 1];
        
        // Check if next section is locked (for per-section timers)
        if (examSettings.enablePerSectionTimers && lockedSections.has(nextSection)) {
          alert(`The ${getSectionName(nextSection)} section is locked because its timer expired. You cannot access questions in this section.`);
          return;
        }
        
        if (sections[nextSection].length > 0) {
          navigateToQuestion(nextSection, 0);
          logAnalyticsEvent("SECTION_SWITCH", { from: currentSection, to: nextSection });
        }
      }
    }
  }, [currentSection, currentQuestionIndex, sections, navigateToQuestion, logAnalyticsEvent, examSettings.enablePerSectionTimers, lockedSections]);

  const navigatePrevious = useCallback(() => {
    if (!currentSection) return;

    if (currentQuestionIndex > 0) {
      navigateToQuestion(currentSection, currentQuestionIndex - 1);
      logAnalyticsEvent("NAVIGATION_PREVIOUS", { section: currentSection, index: currentQuestionIndex });
      } else {
      // Move to previous section
      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"];
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex > 0) {
        const prevSection = sectionOrder[currentIndex - 1];
        
        // Check if previous section is locked (for per-section timers)
        if (examSettings.enablePerSectionTimers && lockedSections.has(prevSection)) {
          alert(`The ${getSectionName(prevSection)} section is locked because its timer expired. You cannot access questions in this section.`);
          return;
        }
        
        if (sections[prevSection].length > 0) {
          const prevSectionLength = sections[prevSection].length;
          navigateToQuestion(prevSection, prevSectionLength - 1);
          logAnalyticsEvent("SECTION_SWITCH", { from: currentSection, to: prevSection });
        }
      }
    }
  }, [currentSection, currentQuestionIndex, sections, navigateToQuestion, logAnalyticsEvent, examSettings.enablePerSectionTimers, lockedSections]);

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


    try {
      // Step 1: Save all answers (force immediate save, clear debounce)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Step 1: Save all answers (force immediate save, clear debounce)
      // Save all pending answers - log each save attempt
      const savePromises: Promise<void>[] = [];
      const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"];
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
          sql: sections.sql.length,
          aiml: sections.aiml.length,
        },
        examSettings: {
          duration: examSettings.duration,
          examMode: examSettings.examMode,
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

        // Load candidate info from session
        const email = sessionStorage.getItem("candidateEmail") || "";
        const name = sessionStorage.getItem("candidateName") || "";
        setCandidateEmail(email);
        setCandidateName(name);

        // Fetch full assessment with topics_v2 structure
        const assessmentResponse = await axios.get(
          `/api/assessment/get-assessment-full?assessmentId=${id}&token=${token}`
        );

        console.log("[take.tsx] Assessment API response:", assessmentResponse.data);

        if (!assessmentResponse.data?.success) {
          throw new Error("Failed to load assessment");
        }

        const assessment = assessmentResponse.data.data;
        const topics_v2 = assessment?.topics_v2 || [];
        
        // Enhanced logging for debugging - EXPAND OBJECTS
        console.log("[take.tsx] Full assessment data:", JSON.stringify({
          hasTopicsV2: !!assessment?.topics_v2,
          topicsV2Type: Array.isArray(assessment?.topics_v2) ? "array" : typeof assessment?.topics_v2,
          topicsV2Length: Array.isArray(assessment?.topics_v2) ? assessment.topics_v2.length : "N/A",
          assessmentKeys: assessment ? Object.keys(assessment) : [],
          assessmentStatus: assessment?.status,
          allQuestionsGenerated: assessment?.allQuestionsGenerated,
        }, null, 2));
        
        // Check if topics_v2 exists but is empty or has no questions
        if (Array.isArray(topics_v2) && topics_v2.length > 0) {
          const detailedAnalysis = topics_v2.map((topic, topicIdx) => {
            const questionRows = topic?.questionRows || [];
            const rowsAnalysis = questionRows.map((row: any, rowIdx: number) => {
              const questions = row?.questions || [];
              return {
                rowIndex: rowIdx,
                rowId: row?.rowId,
                questionType: row?.questionType,
                difficulty: row?.difficulty,
                questionsCount: row?.questionsCount,
                actualQuestionsArrayLength: questions.length,
                hasQuestions: questions.length > 0,
                firstQuestionPreview: questions.length > 0 ? {
                  id: questions[0]?._id || questions[0]?.id,
                  hasQuestionText: !!questions[0]?.questionText || !!questions[0]?.question,
                } : null,
              };
            });
            return {
              topicIndex: topicIdx,
              topicId: topic?.id,
              topicLabel: topic?.label,
              questionRowsCount: questionRows.length,
              rowsAnalysis: rowsAnalysis,
            };
          });
          
          const totalQuestions = topics_v2.reduce((count, topic) => {
            const questionRows = topic?.questionRows || [];
            return count + questionRows.reduce((rowCount: number, row: any) => {
              const questions = row?.questions || [];
              return rowCount + questions.length;
            }, 0);
          }, 0);
          
          console.log("[take.tsx] Topics_v2 detailed analysis:", JSON.stringify({
            topicsCount: topics_v2.length,
            totalQuestionsInTopics: totalQuestions,
            topicsWithQuestions: topics_v2.filter(t => {
              const rows = t?.questionRows || [];
              return rows.some((r: any) => (r?.questions || []).length > 0);
            }).length,
            detailedTopics: detailedAnalysis,
          }, null, 2));
          
          if (totalQuestions === 0) {
            console.error("[take.tsx] Topics_v2 exists but has no questions. Full structure:", 
              JSON.stringify(topics_v2.map(t => ({
                id: t?.id,
                label: t?.label,
                questionRowsCount: (t?.questionRows || []).length,
                questionRows: (t?.questionRows || []).map((r: any) => ({
                  rowId: r?.rowId,
                  questionType: r?.questionType,
                  questionsCount: r?.questionsCount,
                  actualQuestionsLength: (r?.questions || []).length,
                  hasQuestionsArray: Array.isArray(r?.questions),
                  questionsArray: r?.questions, // Show actual questions array
                })),
              })), null, 2)
            );
          }
        } else {
          console.error("[take.tsx] Topics_v2 is missing or empty:", JSON.stringify({
            topics_v2,
            topics_v2Type: typeof topics_v2,
            topics_v2IsArray: Array.isArray(topics_v2),
            assessmentHasTopics: !!assessment?.topics,
            assessmentHasTopicsV2: !!assessment?.topics_v2,
            assessmentKeys: assessment ? Object.keys(assessment) : [],
          }, null, 2));
        }
        
        // Get duration from schedule (new Custom-MCQ style) or fallback to assessment duration
        const schedule = assessment?.schedule || {};
        const duration = schedule.duration || assessment?.duration || 60; // Default to 60 minutes
        const examMode = schedule.examMode || assessment?.examMode || "strict";
        const enablePerSectionTimers = assessment?.enablePerSectionTimers || false;
        const sectionTimersFromDB = assessment?.sectionTimers || {};
        const startTimeStr = schedule.startTime;
        const accessTimeBeforeStart = assessment?.accessTimeBeforeStart || schedule?.accessTimeBeforeStart || 15;
        
        // Check if assessment has started (for strict mode)
        if (examMode === "strict" && startTimeStr) {
          try {
            // Parse start time (handle both ISO string and other formats)
            let startTime: Date;
            if (startTimeStr.includes('Z') || startTimeStr.includes('+') || startTimeStr.includes('-', 10)) {
              startTime = new Date(startTimeStr);
            } else {
              startTime = new Date(startTimeStr + 'Z'); // Assume UTC if no timezone
            }
            
            const now = new Date();
            const accessStartTime = new Date(startTime.getTime() - accessTimeBeforeStart * 60000);
            
            console.log("[take.tsx] Time check:", {
              now: now.toISOString(),
              startTime: startTime.toISOString(),
              accessStartTime: accessStartTime.toISOString(),
              accessTimeBeforeStart,
              examMode,
              nowTime: now.getTime(),
              startTimeTime: startTime.getTime(),
              isBeforeStart: now < startTime,
            });
            
            if (now < accessStartTime) {
              // Too early - show error
              const errorMsg = `You cannot access this assessment yet. Access will be available ${accessTimeBeforeStart} minutes before the start time. Access opens at ${accessStartTime.toLocaleString()}.`;
              console.log("[take.tsx] Too early to access:", errorMsg);
              setError(errorMsg);
              setAppState("ready");
              return;
            } else if (now < startTime) {
              // Within access window but before start time - show waiting page
              console.log("[take.tsx] Within access window but before start time, showing waiting page. Now:", now.toISOString(), "Start:", startTime.toISOString());
              setWaitingForStart(true);
              setStartTime(startTime);
              setAppState("ready");
              return; // CRITICAL: Don't load questions if before start time
            }
            // If we reach here, start time has passed - continue loading questions
            console.log("[take.tsx] Start time has passed, loading questions");
          } catch (timeError) {
            console.error("[take.tsx] Error parsing start time:", timeError);
            // Continue if time parsing fails
          }
        }
        
        const fetchedSettings: ExamSettings = {
          duration: duration,
          examMode: examMode,
          enablePerSectionTimers: enablePerSectionTimers,
          sectionTimers: sectionTimersFromDB,
        };
        
        // Initialize per-section timers if enabled
        if (enablePerSectionTimers && sectionTimersFromDB) {
          const sectionTimerMap: Record<string, number> = {};
          // Map section names to keys
          const sectionKeyMap: Record<string, string> = {
            "MCQ": "mcq",
            "Subjective": "subjective",
            "PseudoCode": "pseudocode",
            "Coding": "coding",
            "SQL": "sql",
            "AIML": "aiml",
          };
          
          Object.entries(sectionTimersFromDB).forEach(([sectionName, minutes]) => {
            const sectionKey = sectionKeyMap[sectionName];
            if (sectionKey && typeof minutes === "number" && minutes > 0) {
              sectionTimerMap[sectionKey] = minutes * 60; // Convert to seconds
            }
          });
          console.log("[take.tsx] Per-section timers initialized:", {
            enablePerSectionTimers,
            sectionTimersFromDB,
            sectionTimerMap,
            hasTimers: Object.keys(sectionTimerMap).length > 0,
          });
          if (Object.keys(sectionTimerMap).length > 0) {
            setSectionTimers(sectionTimerMap);
          } else {
            console.warn("[take.tsx] Per-section timers enabled but no valid timers found in sectionTimersFromDB");
          }
        } else {
          console.log("[take.tsx] Per-section timers not enabled or missing:", {
            enablePerSectionTimers,
            hasSectionTimersFromDB: !!sectionTimersFromDB,
            sectionTimersFromDB,
          });
        }
        
        console.log("[take.tsx] Exam settings:", {
          enablePerSectionTimers,
          sectionTimersFromDB,
          fetchedSettings,
        });
        console.log("[take.tsx] Topics_v2 structure (raw):", JSON.stringify(topics_v2, null, 2));

        // Read proctoring flags from schedule.proctoringSettings (if present)
        const proctoringSettings = assessment?.schedule?.proctoringSettings;
        const aiFlagFromSchedule = proctoringSettings?.aiProctoringEnabled;
        const liveFlagFromSchedule = proctoringSettings?.liveProctoringEnabled;
        // Only explicit true enables proctoring; missing/false => OFF
        setAiProctoringEnabled(aiFlagFromSchedule === true);
        setLiveProctoringEnabled(liveFlagFromSchedule === true);

        // Transform topics_v2 into sections
        console.log("[take.tsx] About to transform topics_v2, input length:", topics_v2.length);
        console.log("[take.tsx] First topic sample:", JSON.stringify(topics_v2[0], null, 2)); // Log first topic as sample
        const transformed = transformTopicsV2ToSections(topics_v2);
        console.log("[take.tsx] Transformed sections:", {
          mcq: transformed.sections.mcq.length,
          subjective: transformed.sections.subjective.length,
          pseudocode: transformed.sections.pseudocode.length,
          coding: transformed.sections.coding.length,
          sql: transformed.sections.sql.length,
          aiml: transformed.sections.aiml.length,
          allQuestions: transformed.allQuestions.length,
        });
        
        // Debug: Check if transformation actually processed questions
        if (transformed.allQuestions.length === 0) {
          console.error("[take.tsx] TRANSFORMATION FAILED - No questions in result but questions exist in input!");
          console.error("[take.tsx] Input topics_v2 structure:", JSON.stringify(topics_v2.map((t: any) => ({
            id: t?.id,
            label: t?.label,
            questionRows: t?.questionRows?.map((r: any) => ({
              rowId: r?.rowId,
              questionType: r?.questionType,
              questionsCount: r?.questions?.length || 0,
              questions: r?.questions,
            })),
          })), null, 2));
        } else {
          console.log("[take.tsx] Transformation successful! Questions by section:", {
            mcq: transformed.sections.mcq.map(q => ({ id: q._id, type: q.type })),
            subjective: transformed.sections.subjective.map(q => ({ id: q._id, type: q.type })),
            coding: transformed.sections.coding.map(q => ({ id: q._id, type: q.type })),
            aiml: transformed.sections.aiml.map(q => ({ id: q._id, type: q.type })),
          });
        }

        if (transformed.allQuestions.length === 0) {
          // Provide more detailed error message
          const hasTopicsV2 = Array.isArray(topics_v2) && topics_v2.length > 0;
          const hasTopics = Array.isArray(assessment?.topics) && assessment.topics.length > 0;
          const assessmentStatus = assessment?.status;
          const allQuestionsGenerated = assessment?.allQuestionsGenerated;
          
          let errorMessage = "Assessment has no generated questions.";
          
          if (!hasTopicsV2 && !hasTopics) {
            errorMessage += " No topics or questions have been configured for this assessment.";
          } else if (hasTopicsV2) {
            const topicsWithQuestions = topics_v2.filter(t => {
              const rows = t?.questionRows || [];
              return rows.some((r: any) => (r?.questions || []).length > 0);
            });
            if (topicsWithQuestions.length === 0) {
              errorMessage += ` Topics are configured but no questions have been generated yet.`;
            } else {
              errorMessage += ` Found ${topicsWithQuestions.length} topic(s) with questions, but they could not be processed.`;
            }
          } else if (hasTopics) {
            errorMessage += " Assessment uses old topics format. Please regenerate questions.";
          }
          
          if (assessmentStatus === "draft") {
            errorMessage += " The assessment is still in draft mode. Please complete question generation and schedule the assessment.";
          } else if (!allQuestionsGenerated) {
            errorMessage += " Question generation may not be complete. Please check the assessment configuration.";
          }
          
          errorMessage += " Please contact the administrator.";
          
          console.error("[take.tsx] No questions available:", {
            hasTopicsV2,
            hasTopics,
            assessmentStatus,
            allQuestionsGenerated,
            topicsV2Length: Array.isArray(topics_v2) ? topics_v2.length : 0,
            errorMessage,
          });
          
          throw new Error(errorMessage);
        }

        setQuestions(transformed.allQuestions);
        setExamSettings(fetchedSettings);
        setAttemptId(""); // Will be set when attempt is created

        setSections(transformed.sections);

        // Set first non-empty section as current (order: MCQ → PseudoCode → Subjective → Coding → SQL → AIML)
        const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"];
        const firstSection = sectionOrder.find((section) => transformed.sections[section].length > 0);
        console.log("[take.tsx] First section:", firstSection);
        if (firstSection) {
          setCurrentSection(firstSection);
          setCurrentQuestionIndex(0);
        } else {
          console.warn("[take.tsx] No sections with questions found!");
        }

        // Calculate and set timer
        const calculatedTimer = calculateTimer(fetchedSettings);
        console.log("[take.tsx] Timer calculation:", {
          duration: fetchedSettings.duration,
          examMode: fetchedSettings.examMode,
          calculatedTimer,
          sectionsCount: {
            mcq: transformed.sections.mcq.length,
            pseudocode: transformed.sections.pseudocode.length,
            subjective: transformed.sections.subjective.length,
            coding: transformed.sections.coding.length,
            sql: transformed.sections.sql.length,
            aiml: transformed.sections.aiml.length,
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

  // Countdown timer for waiting page - MUST be before any conditional returns
  useEffect(() => {
    if (!waitingForStart || !startTime) return;
    
    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((startTime.getTime() - new Date().getTime()) / 1000));
      setTimeUntilStart(remaining);
      if (remaining <= 0) {
        setWaitingForStart(false);
        window.location.reload(); // Reload to start assessment
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [waitingForStart, startTime]);

  // ============================================================================
  // TIMER COUNTDOWN
  // ============================================================================

  // Overall timer countdown (when per-section timers are disabled)
  useEffect(() => {
    // Skip if per-section timers are enabled
    if (examSettings.enablePerSectionTimers) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }
    
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
  }, [appState, timerRemaining, submitAssessment, examSettings.enablePerSectionTimers]);

  // Per-section timer countdown (when per-section timers are enabled)
  useEffect(() => {
    if (!examSettings.enablePerSectionTimers || appState !== "ready" || !currentSection) {
      return;
    }

    // Check if section is already locked
    if (lockedSections.has(currentSection)) {
      return;
    }

    const currentSectionTimer = sectionTimers[currentSection];
    if (!currentSectionTimer || currentSectionTimer <= 0) {
      return;
    }

    // Clear any existing interval before starting a new one
    if (sectionTimerIntervalRef.current) {
      clearInterval(sectionTimerIntervalRef.current);
      sectionTimerIntervalRef.current = null;
    }
    
    // Start countdown for current section
    sectionTimerIntervalRef.current = setInterval(() => {
      setSectionTimers((prev) => {
        const currentTimer = prev[currentSection];
        if (!currentTimer || currentTimer <= 1) {
          // Clear interval first
          if (sectionTimerIntervalRef.current) {
            clearInterval(sectionTimerIntervalRef.current);
            sectionTimerIntervalRef.current = null;
          }
          
          // Section timer expired - lock this section and handle navigation
          setLockedSections((currentLocked) => {
            const newLockedSet = new Set(currentLocked);
            newLockedSet.add(currentSection);
            
            // If current section is locked, try to move to next unlocked section
            const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"];
            const currentIndex = sectionOrder.indexOf(currentSection as keyof Sections);
            
            // Find next unlocked section
            let foundNext = false;
            for (let i = currentIndex + 1; i < sectionOrder.length; i++) {
              const nextSection = sectionOrder[i];
              const isLocked = newLockedSet.has(nextSection);
              if (sections[nextSection]?.length > 0 && !isLocked) {
                // Use setTimeout to avoid state update conflicts
                setTimeout(() => {
                  setCurrentSection(nextSection);
                  setCurrentQuestionIndex(0);
                }, 0);
                foundNext = true;
                break;
              }
            }
            
            // If all sections are locked, auto-submit
            if (!foundNext) {
              const allSectionsLocked = sectionOrder.every(section => {
                const isLocked = newLockedSet.has(section);
                return isLocked || sections[section]?.length === 0;
              });
              if (allSectionsLocked) {
                setTimeout(() => submitAssessment(), 0);
              }
            }
            
            return newLockedSet;
          });
          
          return { ...prev, [currentSection]: 0 };
        }
        return { ...prev, [currentSection]: currentTimer - 1 };
      });
    }, 1000);

    return () => {
      if (sectionTimerIntervalRef.current) {
        clearInterval(sectionTimerIntervalRef.current);
        sectionTimerIntervalRef.current = null;
      }
    };
  }, [appState, currentSection, examSettings.enablePerSectionTimers, sections, submitAssessment, lockedSections, sectionTimers]);

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
      sql: "SQL",
      aiml: "AIML",
    };
    return names[section] || section;
  };

  // Loading state
  if (appState === "loading") {
    return (
      <>
        <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: "50px", height: "50px", border: "4px solid #6953a3", borderTop: "4px solid transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 1rem" }} />
            <p style={{ color: "#1a1625", fontSize: "1.125rem" }}>Loading assessment...</p>
          </div>
        </div>
        <FullscreenLockOverlay
          isLocked={isFullscreenLocked}
          onRequestFullscreen={handleRequestFullscreen}
          exitCount={fullscreenExitCount}
          message="You must be in fullscreen mode to continue the assessment."
          warningText={fullscreenExitCount > 0 ? "Exiting fullscreen is recorded as a violation." : undefined}
        />
      </>
    );
  }

  // Error state
  if (error && appState !== "ready") {
    return (
      <>
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
        <FullscreenLockOverlay
          isLocked={isFullscreenLocked}
          onRequestFullscreen={handleRequestFullscreen}
          exitCount={fullscreenExitCount}
          message="You must be in fullscreen mode to continue the assessment."
          warningText={fullscreenExitCount > 0 ? "Exiting fullscreen is recorded as a violation." : undefined}
        />
      </>
    );
  }

  // No questions
  if (questions.length === 0) {
    return (
      <>
        <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div className="card" style={{ maxWidth: "600px", width: "100%", textAlign: "center" }}>
            <h1 style={{ marginBottom: "1rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>No Questions Available</h1>
            <p style={{ color: "#64748b", marginBottom: "2rem" }}>This assessment does not have any questions configured.</p>
          </div>
        </div>
        <FullscreenLockOverlay
          isLocked={isFullscreenLocked}
          onRequestFullscreen={handleRequestFullscreen}
          exitCount={fullscreenExitCount}
          message="You must be in fullscreen mode to continue the assessment."
          warningText={fullscreenExitCount > 0 ? "Exiting fullscreen is recorded as a violation." : undefined}
        />
      </>
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
              const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "aiml"];
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
  const sectionOrder: (keyof Sections)[] = ["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"];
  
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

  // ============================================================================
  // RENDERING
  // ============================================================================

  // Show waiting page if assessment hasn't started (strict mode)
  if (waitingForStart && startTime) {
    return (
      <div style={{ 
        backgroundColor: "#f1dcba", 
        minHeight: "100vh", 
        padding: "2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "0.75rem",
          padding: "3rem",
          maxWidth: "600px",
          textAlign: "center",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        }}>
          <h1 style={{ fontSize: "2rem", color: "#1a1625", marginBottom: "1rem", fontWeight: 700 }}>
            Assessment Will Start Soon
          </h1>
          <p style={{ fontSize: "1.125rem", color: "#64748b", marginBottom: "2rem" }}>
            The assessment will begin at:
          </p>
          <div style={{
            fontSize: "1.5rem",
            color: "#6953a3",
            fontWeight: 700,
            marginBottom: "2rem",
            padding: "1rem",
            backgroundColor: "#f8fafc",
            borderRadius: "0.5rem",
          }}>
            {startTime.toLocaleString()}
          </div>
          <div style={{
            fontSize: "1.25rem",
            color: "#1e293b",
            marginBottom: "1rem",
          }}>
            Time remaining:
          </div>
          <div style={{
            fontSize: "2rem",
            color: "#3b82f6",
            fontWeight: 700,
            marginBottom: "2rem",
          }}>
            {formatTime(timeUntilStart)}
          </div>
          <p style={{ fontSize: "0.875rem", color: "#64748b" }}>
            Please wait. The assessment will start automatically when the time arrives.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      backgroundColor: "#f1dcba", 
      height: isFullscreen ? "100vh" : "auto",
      minHeight: "100vh", 
      padding: isFullscreen ? "0" : "2rem",
      display: "flex",
      flexDirection: "column",
      overflow: isFullscreen ? "hidden" : "auto",
    }}>
      <div style={{ 
        flex: 1,
        display: "flex",
        gap: isFullscreen ? "0" : "1.5rem",
        height: isFullscreen ? "100%" : "auto",
        padding: isFullscreen ? "1rem" : "0",
      }}>
        {/* Left Sidebar - Sections */}
        <div style={{ 
          width: isFullscreen ? "200px" : "200px", 
          backgroundColor: "#ffffff", 
          borderRadius: "0.5rem", 
          padding: "1rem",
          border: "1px solid #e2e8f0",
          height: isFullscreen ? "100%" : "fit-content",
          position: isFullscreen ? "relative" : "sticky",
          top: isFullscreen ? "0" : "2rem",
          overflowY: isFullscreen ? "auto" : "visible",
        }}>
            <h3 style={{ marginBottom: "1rem", fontSize: "1rem", color: "#1a1625", fontWeight: 700 }}>
              Sections
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {(["mcq", "pseudocode", "subjective", "coding", "sql", "aiml"] as (keyof Sections)[]).map((section) => {
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
          <div style={{ 
            flex: 1, 
            backgroundColor: "#ffffff", 
            borderRadius: "0.5rem", 
            padding: isFullscreen ? "1rem" : "2rem", 
            border: "1px solid #e2e8f0",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            height: isFullscreen ? "100%" : "auto",
          }}>
            {/* Timer */}
            {examSettings?.enablePerSectionTimers && currentSection && sectionTimers[currentSection] !== undefined && sectionTimers[currentSection] >= 0 ? (
              // Per-section timer display
              <div style={{
                marginBottom: "1.5rem",
                padding: "1rem",
                backgroundColor: (sectionTimers[currentSection] || 0) < 300 ? "#fef2f2" : "#f0f9ff",
                border: `2px solid ${(sectionTimers[currentSection] || 0) < 300 ? "#ef4444" : "#3b82f6"}`,
                borderRadius: "0.5rem",
                textAlign: "center",
              }}>
                <p style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                  {getSectionName(currentSection)} Section Timer:
                </p>
                <p style={{ 
                  fontSize: "1.5rem",
                  fontWeight: 700, 
                  color: (sectionTimers[currentSection] || 0) < 300 ? "#dc2626" : "#1e40af",
                }}>
                  {formatTime(sectionTimers[currentSection] || 0)}
                </p>
                {lockedSections.has(currentSection) && (
                  <p style={{ color: "#dc2626", fontSize: "0.875rem", marginTop: "0.5rem", fontWeight: 600 }}>
                    ⚠️ This section is locked
                  </p>
                )}
              </div>
            ) : (
              // Overall timer display
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
            )}

            {/* Question Navigator - Hide for coding, sql and aiml sections (they have their own navigation) */}
            {currentSection !== "coding" && currentSection !== "sql" && currentSection !== "aiml" && (
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
            )}

            {/* Question Content */}
            {currentSection === "aiml" ? (
              /* AIML Interface - Direct notebook rendering */
              <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
                {(() => {
                  const questionIdStr = questionId;
                  // Extract AIML data - check both root level and aiml_data nested structure
                  const aimlData = (currentQuestion as any).aiml_data || {};
                  const questionTitle = currentQuestion.title || aimlData.title || currentQuestion.questionText || "Question";
                  // Use questionText if available (contains full formatted content), otherwise use description
                  // questionText typically contains the full question with Tasks, Constraints, Dataset Schema, etc.
                  // Also check for 'question' field which might contain the full formatted text
                  const questionDescription = (currentQuestion as any).question || currentQuestion.questionText || currentQuestion.description || aimlData.description || "";
                  
                  console.log('[Assessment Take] AIML Question fields:', {
                    hasQuestion: !!(currentQuestion as any).question,
                    hasQuestionText: !!currentQuestion.questionText,
                    hasDescription: !!currentQuestion.description,
                    questionLength: ((currentQuestion as any).question || '').length,
                    questionTextLength: (currentQuestion.questionText || '').length,
                    descriptionLength: (currentQuestion.description || '').length,
                  });
                  const library = currentQuestion.library || aimlData.libraries?.[0] || aimlData.library || "numpy";
                  const tasks = currentQuestion.tasks || aimlData.tasks || [];
                  const publicTestcases = currentQuestion.public_testcases || aimlData.public_testcases || [];
                  const dataset = currentQuestion.dataset || aimlData.dataset || null;
                  const datasetPath = currentQuestion.dataset_path || aimlData.dataset_path || null;
                  const datasetUrl = currentQuestion.dataset_url || aimlData.dataset_url || null;
                  const requiresDataset = currentQuestion.requires_dataset !== undefined 
                    ? currentQuestion.requires_dataset 
                    : (aimlData.requires_dataset !== undefined ? aimlData.requires_dataset : false);
                  
                  // Handle starter_code - check both locations and formats
                  let starterCode: Record<string, string> = {};
                  if (currentQuestion.starter_code) {
                    starterCode = typeof currentQuestion.starter_code === 'object' 
                      ? currentQuestion.starter_code 
                      : { python3: currentQuestion.starter_code || '', python: currentQuestion.starter_code || '' };
                  } else if (aimlData.starter_code) {
                    starterCode = typeof aimlData.starter_code === 'object'
                      ? aimlData.starter_code
                      : { python3: aimlData.starter_code || '', python: aimlData.starter_code || '' };
                  } else {
                    starterCode = { python3: '', python: '' };
                  }

                  const aimlQuestion = {
                    id: questionIdStr,
                    title: questionTitle,
                    description: questionDescription,
                    library: library,
                    starter_code: starterCode,
                    tasks: tasks,
                    public_testcases: publicTestcases,
                    dataset: dataset,
                    dataset_path: datasetPath,
                    dataset_url: datasetUrl,
                    requires_dataset: requiresDataset,
                  };

                  return (
                    <AIMLCompetencyNotebook
                      question={aimlQuestion}
                      sessionId={`assessment_${id}_question_${questionIdStr}`}
                      testId={id as string}
                      userId={candidateEmail}
                      onCodeChange={(allCode) => {
                        setCode({ ...code, [questionIdStr]: allCode });
                        setCodeAnswers((prev) => {
                          const updated = new Map(prev);
                          updated.set(questionIdStr, allCode);
                          return updated;
                        });
                        saveAnswer(questionIdStr, allCode, currentSection);
                      }}
                      onSubmit={(allCode, outputs) => {
                        saveAnswer(questionIdStr, allCode, currentSection);
                      }}
                      showSubmit={false}
                    />
                  );
                })()}
              </div>
            ) : currentSection === "sql" ? (
              /* SQL Interface - Description and SQL Editor side by side */
              <div style={{ flex: 1, minHeight: "600px", overflow: "hidden", display: "flex", height: "100%" }}>
                <Split
                  className="flex h-full w-full"
                  sizes={[40, 60]}
                  minSize={[300, 400]}
                  gutterSize={8}
                  gutterStyle={() => ({ backgroundColor: "#334155" })}
                >
                  {/* Left Panel - Question Description */}
                  <div className="h-full overflow-hidden bg-slate-900">
                    {(() => {
                      // Extract only the problem statement part from description
                      // Backend stores full formatted text in 'question' field: "**{title}**\n\n{description}\n\n**Database Schema:**\n...\n**Sample Data:**\n...\n**Requirements:**\n...\n**Hints:**\n..."
                      // Check all possible fields: question (backend stores here), questionText, description
                      let problemDescription = (currentQuestion as any).question || currentQuestion.questionText || currentQuestion.description || "";
                      
                      // Extract title from the question text (format: **{title}**\n\n{description}...)
                      // The title field might contain the full question text, so extract just the title part
                      let questionTitle = "SQL Question";
                      if (problemDescription) {
                        // Extract title from markdown format: **Title** at the start
                        const titleMatch = problemDescription.match(/^\*\*([^*]+)\*\*\s*\n\n/i);
                        if (titleMatch && titleMatch[1]) {
                          questionTitle = titleMatch[1].trim();
                        } else if (currentQuestion.title) {
                          // If title field exists, check if it's just the title or full text
                          // If it contains newlines or is very long, it's probably the full text
                          if (currentQuestion.title.length < 200 && !currentQuestion.title.includes('\n\n')) {
                            questionTitle = currentQuestion.title;
                          } else {
                            // Extract title from the title field itself
                            const titleFromTitleField = currentQuestion.title.match(/^\*\*([^*]+)\*\*/i);
                            if (titleFromTitleField && titleFromTitleField[1]) {
                              questionTitle = titleFromTitleField[1].trim();
                            }
                          }
                        }
                      } else if (currentQuestion.title && currentQuestion.title.length < 200 && !currentQuestion.title.includes('\n\n')) {
                        questionTitle = currentQuestion.title;
                      }
                      
                      // ALWAYS extract if we have any description - don't skip extraction
                      if (problemDescription && problemDescription.trim().length > 0) {
                        // Step 1: Remove title from description if it's included (backend format: **{title}**\n\n{description})
                        // Try flexible pattern first - remove any markdown title at the start
                        const flexibleTitlePattern = /^\*\*[^*]+\*\*\s*\n\n/i;
                        if (flexibleTitlePattern.test(problemDescription)) {
                          problemDescription = problemDescription.replace(flexibleTitlePattern, '').trim();
                        }
                        
                        // Step 2: Find the first occurrence of any section marker and extract only text before it
                        // Backend format (from ai_sql_generator.py):
                        // - "\n\n**Database Schema:**\n" (double newline before Database Schema)
                        // - "\n**Sample Data:**\n" (single newline before Sample Data)
                        // - "\n**Requirements:**\n" (single newline before Requirements)
                        // - "\n**Hints:**\n" (single newline before Hints)
                        const sectionPatterns = [
                          // Database Schema patterns (most common first - backend uses double newline)
                          /\n\n\*\*Database\s+Schema\*\*:?\s*\n/i,
                          /\n\*\*Database\s+Schema\*\*:?\s*\n/i,
                          /\*\*Database\s+Schema\*\*:?\s*\n/i,
                          /Database\s+Schema:?\s*\n/i,
                          // Sample Data patterns (backend uses single newline)
                          /\n\*\*Sample\s+Data\*\*:?\s*\n/i,
                          /\n\n\*\*Sample\s+Data\*\*:?\s*\n/i,
                          /\*\*Sample\s+Data\*\*:?\s*\n/i,
                          /Sample\s+Data:?\s*\n/i,
                          // Requirements patterns (backend uses single newline)
                          /\n\*\*Requirements?\*\*:?\s*\n/i,
                          /\n\n\*\*Requirements?\*\*:?\s*\n/i,
                          /\*\*Requirements?\*\*:?\s*\n/i,
                          /Requirements?:?\s*\n/i,
                          // Hints patterns (backend uses single newline)
                          /\n\*\*Hints?\*\*:?\s*\n/i,
                          /\n\n\*\*Hints?\*\*:?\s*\n/i,
                          /\*\*Hints?\*\*:?\s*\n/i,
                          /Hints?:?\s*\n/i,
                        ];
                        
                        // Find the first occurrence of any section marker
                        let minIndex = problemDescription.length;
                        for (const pattern of sectionPatterns) {
                          const match = problemDescription.search(pattern);
                          if (match !== -1) {
                            minIndex = Math.min(minIndex, match);
                          }
                        }
                        
                        // Also check for table name patterns that might appear in schema/data sections
                        // These appear as: \n**Table: `table_name`**\n (in schema section)
                        // But only match if they appear after a reasonable description length (to avoid matching titles)
                        if (problemDescription.length > 100) {
                          const tablePattern = /\n\*\*Table:\s*`[^`]+`\*\*\s*\n/i;
                          const tableMatch = problemDescription.search(tablePattern);
                          if (tableMatch !== -1 && tableMatch > 50) {
                            minIndex = Math.min(minIndex, tableMatch);
                          }
                        }
                        
                        // If we found a section marker, extract only text before it
                        if (minIndex < problemDescription.length && minIndex > 0) {
                          problemDescription = problemDescription.substring(0, minIndex).trim();
                        }
                        
                        // Step 3: Final cleanup pass - remove any remaining section markers or content
                        // This handles cases where patterns might have been missed
                        problemDescription = problemDescription
                          .replace(/\*\*Database\s+Schema\*\*:?[\s\S]*$/i, '')
                          .replace(/\*\*Sample\s+Data\*\*:?[\s\S]*$/i, '')
                          .replace(/\*\*Requirements?\*\*:?[\s\S]*$/i, '')
                          .replace(/\*\*Hints?\*\*:?[\s\S]*$/i, '')
                          .replace(/Database\s+Schema:?[\s\S]*$/i, '')
                          .replace(/Sample\s+Data:?[\s\S]*$/i, '')
                          .replace(/Requirements?:?[\s\S]*$/i, '')
                          .replace(/Hints?:?[\s\S]*$/i, '')
                          .trim();
                        
                        // Step 4: Remove duplicate paragraphs (if the same text appears twice)
                        // Split by double newlines to get paragraphs
                        const paragraphs = problemDescription.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
                        const uniqueParagraphs: string[] = [];
                        const seenNormalized = new Set<string>();
                        
                        for (const para of paragraphs) {
                          // Normalize: lowercase, remove extra spaces, remove markdown formatting
                          const normalized = para
                            .trim()
                            .toLowerCase()
                            .replace(/\*\*/g, '') // Remove bold markdown
                            .replace(/`/g, '') // Remove code markdown
                            .replace(/\s+/g, ' ') // Normalize whitespace
                            .substring(0, 200); // Only compare first 200 chars for performance
                          
                          // Check if this normalized paragraph is very similar to any we've seen
                          let isDuplicate = false;
                          const seenArray = Array.from(seenNormalized);
                          for (const seen of seenArray) {
                            // Simple similarity check: if one contains the other (80% overlap), consider it duplicate
                            const shorter = normalized.length < seen.length ? normalized : seen;
                            const longer = normalized.length >= seen.length ? normalized : seen;
                            if (longer.includes(shorter) && shorter.length / longer.length > 0.8) {
                              isDuplicate = true;
                              break;
                            }
                            // Also check if they're very similar in length and content
                            if (Math.abs(normalized.length - seen.length) < 10 && 
                                normalized.substring(0, Math.min(50, normalized.length)) === seen.substring(0, Math.min(50, seen.length))) {
                              isDuplicate = true;
                              break;
                            }
                          }
                          
                          if (!isDuplicate) {
                            uniqueParagraphs.push(para.trim());
                            seenNormalized.add(normalized);
                          }
                        }
                        
                        problemDescription = uniqueParagraphs.join('\n\n');
                        
                        // Step 5: Clean up any trailing markdown or formatting
                        problemDescription = problemDescription.replace(/\*\*+$/, '').trim();
                        problemDescription = problemDescription.replace(/\n{3,}/g, '\n\n'); // Normalize multiple newlines
                        problemDescription = problemDescription.replace(/[-=]{3,}$/, '').trim();
                        // Remove any trailing bullet points or list markers that might be from removed sections
                        problemDescription = problemDescription.replace(/\n[-*]\s+[^\n]*$/gm, '').trim();
                      }
                      
                      // Get constraints from structured data, but don't pass them to QuestionTabs if they're already in description
                      // The SQLEditorContainer will display constraints separately
                      const sqlData = (currentQuestion as any).sql_data || {};
                      const structuredConstraints = currentQuestion.constraints || sqlData.constraints || [];
                      
                      // If we have structured constraints, don't pass them to QuestionTabs to avoid duplication
                      // QuestionTabs will only show constraints if they're not already in the description
                      const constraintsForTabs = structuredConstraints.length > 0 ? [] : (currentQuestion.constraints || []);
                      
                      return (
                        <QuestionTabs question={{
                          id: questionId,
                          title: questionTitle,
                          description: problemDescription,
                          difficulty: currentQuestion.difficulty || "Medium",
                          examples: [],
                          constraints: constraintsForTabs,
                          public_testcases: currentQuestion.public_testcases || [],
                          hidden_testcases: currentQuestion.hidden_testcases || [],
                        }} />
                      );
                    })()}
                  </div>

                  {/* Right Panel - SQL Editor */}
                  <div className="h-full overflow-hidden bg-slate-950 flex flex-col" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                      {(() => {
                        const questionIdStr = questionId;
                        const currentCode = code[questionIdStr] || codeAnswers.get(questionIdStr) || currentQuestion.starter_query || '-- Write your SQL query here\n\nSELECT ';
                        
                        // Prepare SQL question data with schemas and sample_data
                        // SQLEditorContainer expects: id, title, description, schemas, sample_data, sql_category, constraints, starter_query
                        // SQL data can be in sql_data nested object or at root level
                        const sqlData = (currentQuestion as any).sql_data || {};
                        const sqlQuestion: any = {
                          id: questionIdStr,
                          title: currentQuestion.title || currentQuestion.questionText || "SQL Question",
                          description: currentQuestion.description || currentQuestion.questionText || "",
                          difficulty: currentQuestion.difficulty || "Medium",
                          question_type: 'SQL' as const,
                          schemas: currentQuestion.schemas || sqlData.schemas || {},
                          sample_data: currentQuestion.sample_data || sqlData.sample_data || {},
                          sql_category: currentQuestion.sql_category || sqlData.sql_category,
                          constraints: currentQuestion.constraints || sqlData.constraints || [],
                          starter_query: currentQuestion.starter_query || sqlData.starter_query || '-- Write your SQL query here\n\nSELECT ',
                          hints: currentQuestion.hints || sqlData.hints || [],
                        };

                        return (
                          <SQLEditorContainer
                            code={currentCode}
                            question={sqlQuestion}
                            onCodeChange={(newCode) => {
                              const updatedCode = { ...code, [questionIdStr]: newCode };
                              setCode(updatedCode);
                              setCodeAnswers((prev) => {
                                const updated = new Map(prev);
                                updated.set(questionIdStr, newCode);
                                return updated;
                              });
                              saveAnswer(questionIdStr, newCode, currentSection);
                            }}
                            onRun={async () => {
                              const questionId = questionIdStr;
                              const currentCode = code[questionId] || codeAnswers.get(questionId) || '';
                              
                              if (!currentCode || currentCode.trim() === '') {
                                setOutput(prev => ({
                                  ...prev,
                                  [questionId]: {
                                    stderr: 'Please write a SQL query before running.',
                                    status: 'error'
                                  }
                                }));
                                return;
                              }
                              
                              setRunning(true);
                              setOutput(prev => ({ ...prev, [questionId]: {} }));
                              
                              try {
                                // Get assessment ID from router
                                const assessmentId = router.query.id as string;
                                
                                if (!assessmentId) {
                                  throw new Error('Assessment ID is missing');
                                }
                                
                                // Call SQL run endpoint via Next.js API route
                                const response = await fetch('/api/assessment/run-sql', {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    assessmentId: assessmentId,
                                    questionId: questionIdStr,
                                    sqlQuery: currentCode,
                                  }),
                                });
                                
                                if (!response.ok) {
                                  const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
                                  throw new Error(errorData.message || errorData.detail || `HTTP ${response.status}`);
                                }
                                
                                const result = await response.json();
                                
                                // Format output based on result
                                if (result.status === 'executed') {
                                  setOutput(prev => ({
                                    ...prev,
                                    [questionId]: {
                                      stdout: result.output || 'Query executed successfully',
                                      status: 'success'
                                    }
                                  }));
                                } else if (result.status === 'syntax_error') {
                                  setOutput(prev => ({
                                    ...prev,
                                    [questionId]: {
                                      stderr: result.error || result.message || 'SQL syntax error',
                                      status: 'error'
                                    }
                                  }));
                                } else {
                                  setOutput(prev => ({
                                    ...prev,
                                    [questionId]: {
                                      stderr: result.error || result.message || 'Execution failed',
                                      status: 'error'
                                    }
                                  }));
                                }
                              } catch (error: any) {
                                console.error('SQL run error:', error);
                                setOutput(prev => ({
                                  ...prev,
                                  [questionId]: {
                                    stderr: error.message || 'Failed to run SQL query',
                                    status: 'error'
                                  }
                                }));
                              } finally {
                                setRunning(false);
                              }
                            }}
                            onSubmit={async () => {
                              const currentCode = code[questionIdStr] || codeAnswers.get(questionIdStr) || '';
                              if (currentCode) {
                                await saveAnswer(questionIdStr, currentCode, currentSection);
                              }
                            }}
                            onReset={() => {
                              const starterQuery = currentQuestion.starter_query || '-- Write your SQL query here\n\nSELECT ';
                              setCode({ ...code, [questionIdStr]: starterQuery });
                              setCodeAnswers((prev) => {
                                const updated = new Map(prev);
                                updated.set(questionIdStr, starterQuery);
                                return updated;
                              });
                            }}
                            running={running}
                            submitting={submitting}
                            output={output[questionIdStr] || {}}
                          />
                        );
                      })()}
                    </div>
                  </div>
                </Split>
              </div>
            ) : currentSection === "coding" ? (
              /* DSA-style layout for coding questions - Description and Editor side by side */
              <div style={{ flex: 1, minHeight: "600px", overflow: "hidden", display: "flex", height: "100%" }}>
                <Split
                  className="flex h-full w-full"
                  sizes={[40, 60]}
                  minSize={[300, 400]}
                  gutterSize={8}
                  gutterStyle={() => ({ backgroundColor: "#334155" })}
                >
                  {/* Left Panel - Question Description */}
                  <div className="h-full overflow-hidden bg-slate-900">
                    <QuestionTabs question={{
                      id: questionId,
                      title: currentQuestion.title || currentQuestion.questionText || currentQuestion.coding_data?.title || "Question",
                      description: currentQuestion.description || currentQuestion.questionText || currentQuestion.coding_data?.description || "",
                      difficulty: currentQuestion.difficulty || "Medium",
                      examples: currentQuestion.coding_data?.examples || [],
                      constraints: currentQuestion.coding_data?.constraints || [],
                      public_testcases: currentQuestion.coding_data?.public_testcases || currentQuestion.public_testcases,
                      hidden_testcases: currentQuestion.coding_data?.hidden_testcases || currentQuestion.hidden_testcases,
                    }} />
                  </div>

                  {/* Right Panel - Code Editor */}
                  <div className="h-full overflow-hidden bg-slate-950 flex flex-col" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                      {(() => {
                        const questionType = (currentQuestion.question_type || currentQuestion.type || "").toLowerCase();
                        const questionIdStr = questionId;

                        // SQL Questions
                        if (questionType === "sql") {
                          const currentCode = code[questionIdStr] || codeAnswers.get(questionIdStr) || currentQuestion.starter_query || '-- Write your SQL query here\n\nSELECT ';
                          
                          return (
                            <SQLEditorContainer
                              code={currentCode}
                              question={currentQuestion as any}
                              onCodeChange={(newCode) => {
                                const updatedCode = { ...code, [questionIdStr]: newCode };
                                setCode(updatedCode);
                                setCodeAnswers((prev) => {
                                  const updated = new Map(prev);
                                  updated.set(questionIdStr, newCode);
                                  return updated;
                                });
                                saveAnswer(questionIdStr, newCode, currentSection);
                              }}
                              onRun={async () => {
                                console.log("SQL run not yet implemented");
                              }}
                              onSubmit={async () => {
                                const currentCode = code[questionIdStr] || codeAnswers.get(questionIdStr) || '';
                                if (currentCode) {
                                  await saveAnswer(questionIdStr, currentCode, currentSection);
                                }
                              }}
                              onReset={() => {
                                const starterQuery = currentQuestion.starter_query || '-- Write your SQL query here\n\nSELECT ';
                                setCode({ ...code, [questionIdStr]: starterQuery });
                                setCodeAnswers((prev) => {
                                  const updated = new Map(prev);
                                  updated.set(questionIdStr, starterQuery);
                                  return updated;
                                });
                              }}
                              running={running}
                              submitting={submitting}
                              output={output[questionIdStr] || {}}
                            />
                          );
                        }

                        // Coding Questions - Use DSA EditorContainer
                        const availableLanguages = currentQuestion.languages || (currentQuestion.language ? [currentQuestion.language] : ['python']);
                        const currentLang = language[questionIdStr] || availableLanguages[0] || 'python';
                        
                        let starterCodeObj: Record<string, string> = {};
                        if (typeof currentQuestion.starter_code === 'object' && currentQuestion.starter_code !== null) {
                          starterCodeObj = currentQuestion.starter_code;
                        } else if (typeof currentQuestion.starter_code === 'string') {
                          starterCodeObj = { python: currentQuestion.starter_code };
                        }

                        const currentCode = code[questionIdStr] || codeAnswers.get(questionIdStr) || starterCodeObj[currentLang] || '';

                        // Extract test cases from either coding_data or direct property
                        const publicTestCases = currentQuestion.coding_data?.public_testcases || currentQuestion.public_testcases || [];
                        const visibleTestcases = publicTestCases.map((tc: any, idx: number) => ({
                          id: `tc-${idx}`,
                          input: tc.input || tc.stdin || '',
                          expected: tc.expected_output || tc.expected || '',
                        }));
                        
                        // Debug: Log test cases for troubleshooting
                        console.log(`[Assessment] Test cases extraction for question ${questionIdStr}:`, {
                          'publicTestCases.length': publicTestCases.length,
                          'visibleTestcases.length': visibleTestcases.length,
                          'publicTestCases': publicTestCases,
                          'visibleTestcases': visibleTestcases,
                          'coding_data': currentQuestion.coding_data,
                          'direct_public_testcases': currentQuestion.public_testcases,
                        });

                        return (
                          <EditorContainer
                            code={currentCode}
                            language={currentLang}
                            languages={availableLanguages}
                            starterCode={starterCodeObj}
                            onCodeChange={(newCode) => {
                              const updatedCode = { ...code, [questionIdStr]: newCode };
                              setCode(updatedCode);
                              setCodeAnswers((prev) => {
                                const updated = new Map(prev);
                                updated.set(questionIdStr, newCode);
                                return updated;
                              });
                              saveAnswer(questionIdStr, newCode, currentSection);
                            }}
                            onLanguageChange={(newLang) => {
                              setLanguage({ ...language, [questionIdStr]: newLang });
                              const newStarterCode = starterCodeObj[newLang] || '';
                              if (newStarterCode && (!code[questionIdStr] || code[questionIdStr] === starterCodeObj[currentLang])) {
                                setCode({ ...code, [questionIdStr]: newStarterCode });
                              }
                            }}
                            onRun={async () => {
                              await handleRunCode(questionIdStr, currentQuestion);
                            }}
                            onSubmit={async () => {
                              await handleSubmitCode(questionIdStr, currentQuestion);
                            }}
                            onReset={() => {
                              const resetCode = starterCodeObj[currentLang] || '';
                              setCode({ ...code, [questionIdStr]: resetCode });
                              setCodeAnswers((prev) => {
                                const updated = new Map(prev);
                                updated.set(questionIdStr, resetCode);
                                return updated;
                              });
                            }}
                            running={running}
                            submitting={submitting}
                            output={output[questionIdStr] || {}}
                            submissions={submissionHistory[questionIdStr] || []}
                            visibleTestcases={visibleTestcases}
                            publicResults={publicResults[questionIdStr] || []}
                            hiddenSummary={hiddenSummary[questionIdStr] || null}
                          />
                        );
                      })()}
                      </div>
                    {/* Navigation Buttons - For coding questions */}
                    {currentSection === "coding" && (
                      <div style={{ 
                        padding: "1rem", 
                        borderTop: "1px solid #334155",
                        backgroundColor: "#1e293b",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexShrink: 0,
                      }}>
                        <button
                          type="button"
                          onClick={navigatePrevious}
                          disabled={currentQuestionIndex === 0 || appState === "submitting"}
                          style={{ 
                            padding: "0.75rem 1.5rem",
                            backgroundColor: currentQuestionIndex === 0 ? "#334155" : "#4a5568",
                            color: currentQuestionIndex === 0 ? "#64748b" : "#ffffff",
                            border: "none",
                            borderRadius: "0.5rem",
                            cursor: currentQuestionIndex === 0 || appState === "submitting" ? "not-allowed" : "pointer",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            opacity: currentQuestionIndex === 0 ? 0.5 : 1,
                          }}
                        >
                          Previous
                        </button>

                        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                          <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
                            Question {currentQuestionIndex + 1} of {currentSectionQuestions.length}
                          </span>
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
                    )}
                  </div>
                </Split>
              </div>
            ) : (
              /* Original layout for non-coding questions */
              /* Original layout for non-coding questions */
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

              {((currentQuestion.type && (currentQuestion.type.toLowerCase() === "subjective" || currentQuestion.type.toLowerCase() === "pseudocode" || currentQuestion.type.toLowerCase() === "pseudo code")) || currentSection === "subjective" || currentSection === "pseudocode") && (
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
                      fontFamily: (currentQuestion.type && (currentQuestion.type.toLowerCase() === "pseudocode" || currentQuestion.type.toLowerCase() === "pseudo code")) || currentSection === "pseudocode" ? "monospace" : "inherit",
                    resize: "vertical",
                    }}
                  />
                </div>
              )}
            </div>
            )}

            {/* Navigation Buttons - Show for all non-coding sections (including AIML) */}
            {currentSection !== "coding" && (
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
            )}
          </div>
        </div>
        
        {/* Proctoring Components */}
        <WebcamPreview
          ref={thumbVideoRef}
          cameraOn={proctoringState.isCameraOn}
          faceMeshStatus={proctoringState.isModelLoaded ? 'loaded' : proctoringState.modelError ? 'error' : 'loading'}
          facesCount={proctoringState.facesCount}
        />
        <ViolationToast />

        {/* Fullscreen Lock Overlay - Blocks ALL interaction when not in fullscreen */}
        <FullscreenLockOverlay
          isLocked={isFullscreenLocked}
          onRequestFullscreen={handleRequestFullscreen}
          exitCount={fullscreenExitCount}
          message="You must be in fullscreen mode to continue the assessment. All your progress is saved."
          warningText={fullscreenExitCount > 0 ? "Exiting fullscreen is recorded as a violation." : undefined}
        />
      </div>
  );
}
