'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import { Card, CardContent } from '../../../components/dsa/ui/card'
import dsaApi from '../../../lib/dsa/api'
import { AlertCircle } from 'lucide-react'
import { getLanguageId, LANGUAGE_IDS } from '../../../lib/dsa/judge0'
import Split from 'react-split'
import { TimerBar } from '../../../components/dsa/test/TimerBar'
import { QuestionSidebar } from '../../../components/dsa/test/QuestionSidebar'
import { QuestionTabs } from '../../../components/dsa/test/QuestionTabs'
import { EditorContainer, SubmissionTestcaseResult } from '../../../components/dsa/test/EditorContainer'
import type { SubmissionHistoryEntry } from '../../../components/dsa/test/EditorContainer'
import { SQLEditorContainer } from '../../../components/dsa/test/SQLEditorContainer'
import { OutputConsole } from '../../../components/dsa/test/OutputConsole'
// Proctoring imports
import { useFaceMesh, type DetectionResult } from "@/hooks/useFaceMesh";
import { useProctorUpload } from "@/hooks/useProctorUpload";
import WebcamPreview from "@/components/WebcamPreview";
import { ViolationToast, pushViolationToast } from "@/components/ViolationToast";
import { useLiveProctoring } from "@/hooks/useLiveProctoring";
import { useDSTimer } from '../../../hooks/useDSTimer'
import { 
  FullscreenWarningBanner, 
  FullscreenPrompt
} from '../../../components/proctor'

interface Example {
  input: string
  output: string
  explanation?: string | null
}

interface FunctionParameter {
  name: string
  type: string
}

interface FunctionSignature {
  name: string
  parameters: FunctionParameter[]
  return_type: string
}

// Table schema for SQL questions
interface TableSchema {
  columns: Record<string, string>
}

interface Question {
  id: string
  title: string
  description: string
  examples?: Example[]
  constraints?: string[]
  difficulty: string
  languages: string[]
  starter_code: Record<string, string>
  function_signature?: FunctionSignature
  public_testcases?: Array<{ input: string; expected_output: string }>
  hidden_testcases?: Array<{ input: string; expected_output: string }>
  // SQL-specific fields
  question_type?: 'coding' | 'SQL'
  sql_category?: string
  schemas?: Record<string, TableSchema>
  sample_data?: Record<string, any[][]>
  starter_query?: string
  hints?: string[]
}

// Timer mode types
type TimerMode = 'GLOBAL' | 'PER_QUESTION'

// Question timing for per-question mode
interface QuestionTiming {
  question_id: string
  duration_minutes: number
}

interface Test {
  id: string
  title: string
  description: string
  question_ids: string[]
  duration_minutes: number
  start_time: string
  end_time: string
  // Timer configuration
  timer_mode?: TimerMode
  question_timings?: QuestionTiming[]
}

interface VisibleTestcase {
  id: string
  input: string
  expected: string
}

export default function TestTakePage() {
  const router = useRouter()
  const { id: testId } = router.query
  
  // Get token and userId from URL
  const getTokenFromUrl = (): string | null => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      return urlParams.get('token')
    }
    return (router.query.token as string) || null
  }
  
  const getUserIdFromUrl = (): string | null => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      return urlParams.get('user_id')
    }
    return (router.query.user_id as string) || null
  }
  
  // Initialize state with values from URL
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      return urlParams.get('token')
    }
    return null
  })
  const [userId, setUserId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      return urlParams.get('user_id')
    }
    return null
  })

  const [test, setTest] = useState<Test | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [code, setCode] = useState<Record<string, string>>({})
  const [language, setLanguage] = useState<Record<string, string>>({})
  
  // Sequential question progression state (for PER_QUESTION mode only)
  const [submittedQuestions, setSubmittedQuestions] = useState<Record<string, boolean>>({})
  
  const [testSubmission, setTestSubmission] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkingParams, setCheckingParams] = useState(true)
  const [running, setRunning] = useState(false)
  const [candidateEmail, setCandidateEmail] = useState<string | null>(null)
  const [candidateName, setCandidateName] = useState<string | null>(null)
  const [precheckMode, setPrecheckMode] = useState<{start_time: string, message: string} | null>(null)
  // ============================================================================
  // PROCTORING STATE & REFS
  // ============================================================================

  const [webcamLive, setWebcamLive] = useState(false);
  const [faceMeshStatus, setFaceMeshStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [displayedFacesCount, setDisplayedFacesCount] = useState(0);
  const [proctoringEnabled, setProctoringEnabled] = useState(false);
  // AI (camera-based) proctoring toggle from schedule.proctoringSettings
  const [aiProctoringEnabled, setAiProctoringEnabled] = useState(false);
  const [liveProctoringEnabled, setLiveProctoringEnabled] = useState(false);
  const [liveProctorScreenStream, setLiveProctorScreenStream] = useState<MediaStream | null>(null);
  // Proctoring refs
  const thumbVideoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const noFaceCountRef = useRef(0);
  const multipleFacesCooldownRef = useRef(0);

  // Cooldown constants
  const NO_FACE_FRAMES_THRESHOLD = 5;
  const MULTIPLE_FACES_COOLDOWN_MS = 15000; // 15 seconds

  const editorRef = useRef<HTMLDivElement>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);

  const getViolationMessage = (eventType: string): string => {
    const messages: Record<string, string> = {
      GAZE_AWAY: 'Please keep your eyes on the screen',
      MULTIPLE_FACES_DETECTED: 'Multiple faces detected in frame',
      NO_FACE_DETECTED: 'Please stay in front of the camera',
      TAB_SWITCH: 'Tab switch detected',
      FOCUS_LOST: 'Window focus lost',
      FULLSCREEN_EXIT: 'Exited fullscreen mode',
    }
    return messages[eventType] || 'Violation detected'
  }


  // Enforce unified gate completion (deep-link safety)
  useEffect(() => {
    if (!router.isReady) return
    if (!testId) return
    const id = String(testId)
    const urlToken = getTokenFromUrl()
    if (!urlToken) return

    const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${id}`)
    const instructionsAcknowledged = sessionStorage.getItem(`instructionsAcknowledged_${id}`)
    const candidateRequirementsCompleted = sessionStorage.getItem(`candidateRequirementsCompleted_${id}`)
    const identityVerificationCompleted = sessionStorage.getItem(`identityVerificationCompleted_${id}`)

    if (!precheckCompleted || !instructionsAcknowledged || !candidateRequirementsCompleted || !identityVerificationCompleted) {
      router.replace(`/precheck/${id}/${encodeURIComponent(urlToken)}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, testId])
  
  // Proctoring settings - will be loaded from test data
  const [proctoringSettings, setProctoringSettings] = useState<any>({
    aiProctoringEnabled: false,
    liveProctoringEnabled: false,
  });

  // Generate boilerplate code when starter code is missing
  const generateBoilerplate = (lang: string, question?: Question): string => {
    const langLower = lang.toLowerCase()
    
    const funcSig = question?.function_signature
    const funcName = funcSig?.name || 'solution'
    const params = funcSig?.parameters || []
    const returnType = funcSig?.return_type || 'void'
    const returnTypeLower = returnType.toLowerCase()
    
    const mapType = (type: string, lang: string): string => {
      const typeLower = type.toLowerCase()
      const langLower = lang.toLowerCase()
      
      const typeMap: Record<string, Record<string, string>> = {
        'number': {
          'python': '',
          'javascript': '',
          'typescript': 'number',
          'cpp': 'int',
          'c++': 'int',
          'java': 'int',
          'c': 'int',
          'go': 'int',
          'rust': 'i32',
          'kotlin': 'Int',
          'csharp': 'int',
          'c#': 'int',
        },
        'string': {
          'python': '',
          'javascript': '',
          'typescript': 'string',
          'cpp': 'string',
          'c++': 'string',
          'java': 'String',
          'c': 'char*',
          'go': 'string',
          'rust': 'String',
          'kotlin': 'String',
          'csharp': 'string',
          'c#': 'string',
        },
        'boolean': {
          'python': '',
          'javascript': '',
          'typescript': 'boolean',
          'cpp': 'bool',
          'c++': 'bool',
          'java': 'boolean',
          'c': 'bool',
          'go': 'bool',
          'rust': 'bool',
          'kotlin': 'Boolean',
          'csharp': 'bool',
          'c#': 'bool',
        },
        'int[]': {
          'python': '',
          'javascript': '',
          'typescript': 'number[]',
          'cpp': 'vector<int>',
          'c++': 'vector<int>',
          'java': 'int[]',
          'c': 'int*',
          'go': '[]int',
          'rust': 'Vec<i32>',
          'kotlin': 'IntArray',
          'csharp': 'int[]',
          'c#': 'int[]',
        },
        'string[]': {
          'python': '',
          'javascript': '',
          'typescript': 'string[]',
          'cpp': 'vector<string>',
          'c++': 'vector<string>',
          'java': 'String[]',
          'c': 'char**',
          'go': '[]string',
          'rust': 'Vec<String>',
          'kotlin': 'Array<String>',
          'csharp': 'string[]',
          'c#': 'string[]',
        },
      }
      
      if (typeMap[typeLower] && typeMap[typeLower][langLower]) {
        return typeMap[typeLower][langLower]
      }
      return type
    }
    
    const formatParams = (lang: string): string => {
      if (params.length === 0) return ''
      const langLower = lang.toLowerCase()
      
      switch (langLower) {
        case 'python':
          return params.map(p => p.name).join(', ')
        case 'javascript':
          return params.map(p => p.name).join(', ')
        case 'typescript':
          return params.map(p => `${p.name}: ${mapType(p.type, lang)}`).join(', ')
        case 'cpp':
        case 'c++':
          return params.map(p => `${mapType(p.type, lang)} ${p.name}`).join(', ')
        case 'java':
          return params.map(p => `${mapType(p.type, lang)} ${p.name}`).join(', ')
        case 'c':
          return params.map(p => `${mapType(p.type, lang)} ${p.name}`).join(', ')
        case 'go':
          return params.map(p => `${p.name} ${mapType(p.type, lang)}`).join(', ')
        case 'rust':
          return params.map(p => `${p.name}: ${mapType(p.type, lang)}`).join(', ')
        case 'kotlin':
          return params.map(p => `${p.name}: ${mapType(p.type, lang)}`).join(', ')
        case 'csharp':
        case 'c#':
          return params.map(p => `${mapType(p.type, lang)} ${p.name}`).join(', ')
        default:
          return params.map(p => p.name).join(', ')
      }
    }
    
    const paramsStr = formatParams(langLower)
    const mappedReturnType = mapType(returnType, langLower)
    
    const getDefaultReturn = (rt: string, lang: string): string => {
      const rtLower = rt.toLowerCase()
      if (rtLower === 'void' || rtLower === '') return ''
      if (rtLower === 'int' || rtLower === 'integer' || rtLower === 'number') return '0'
      if (rtLower === 'string' || rtLower === 'str') return '""'
      if (rtLower === 'bool' || rtLower === 'boolean') return 'false'
      if (rtLower === 'float' || rtLower === 'double') return '0.0'
      if (rtLower.includes('[]') || rtLower.includes('array') || rtLower.includes('list')) {
        if (lang === 'java') return 'new int[0]'
        if (lang === 'python') return '[]'
        return '[]'
      }
      return 'null'
    }
    
    const defaultReturn = getDefaultReturn(returnType, langLower)
    const isVoid = returnTypeLower === 'void' || returnTypeLower === ''
    
    switch (langLower) {
      case 'python':
        return `def ${funcName}(${paramsStr}):\n    # Your code here\n    ${isVoid ? 'pass' : 'return None'}\n`
      case 'javascript':
        return `function ${funcName}(${paramsStr}) {\n    // Your code here\n    ${isVoid ? '' : `return ${defaultReturn}`}\n}\n`
      case 'typescript':
        return `function ${funcName}(${paramsStr}): ${mappedReturnType} {\n    // Your code here\n    ${isVoid ? '' : `return ${defaultReturn}`}\n}\n`
      case 'cpp':
      case 'c++':
        return `#include <iostream>\nusing namespace std;\n\n${mappedReturnType} ${funcName}(${paramsStr}) {\n    // Your code here\n    ${isVoid ? '' : `return ${defaultReturn}`}\n}\n`
      case 'java':
        return `public class Main {\n    public static ${mappedReturnType} ${funcName}(${paramsStr}) {\n        // Your code here\n        ${isVoid ? '' : `return ${defaultReturn}`}\n    }\n    public static void main(String[] args) {\n        // You can test your function here\n    }\n}\n`
      case 'c':
        return `#include <stdio.h>\n\n${mappedReturnType} ${funcName}(${paramsStr}) {\n    // Your code here\n    ${isVoid ? '' : `return ${defaultReturn}`}\n}\n`
      case 'go':
        return `package main\n\nfunc ${funcName}(${paramsStr})${isVoid ? '' : ` ${mappedReturnType}`} {\n    // Your code here\n    ${isVoid ? '' : `return ${defaultReturn}`}\n}\n`
      case 'rust':
        return `fn ${funcName}(${paramsStr})${isVoid ? '' : ` -> ${mappedReturnType}`} {\n    // Your code here\n    ${isVoid ? '' : defaultReturn}\n}\n`
      case 'kotlin':
        return `fun ${funcName}(${paramsStr})${isVoid ? '' : `: ${mappedReturnType}`} {\n    // Your code here\n    ${isVoid ? '' : `return ${defaultReturn}`}\n}\n`
      case 'csharp':
      case 'c#':
        return `using System;\n\npublic class Solution {\n    public static ${mappedReturnType} ${funcName}(${paramsStr}) {\n        // Your code here\n        ${isVoid ? '' : `return ${defaultReturn}`}\n    }\n}\n`
      default:
        return `// Your code here\n`
    }
  }

  const [output, setOutput] = useState<Record<string, {
    stdout?: string
    stderr?: string
    compileOutput?: string
    status?: string
    time?: number
    memory?: number
  }>>({})
  const [questionStatus, setQuestionStatus] = useState<Record<string, 'solved' | 'attempted' | 'not-attempted'>>({})
  const [isMobile, setIsMobile] = useState(false)
  const [submissionHistory, setSubmissionHistory] = useState<Record<string, SubmissionHistoryEntry[]>>({})
  const [visibleTestcasesMap, setVisibleTestcasesMap] = useState<Record<string, VisibleTestcase[]>>({})
  const [publicResults, setPublicResults] = useState<Record<string, SubmissionTestcaseResult[]>>({})
  const [hiddenSummary, setHiddenSummary] = useState<Record<string, { total: number; passed: number } | null>>({})
  const [questionStartTimes, setQuestionStartTimes] = useState<Record<string, string>>({})
  const [testStartedAt, setTestStartedAt] = useState<string | null>(null)

  // Check debug mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      setDebugMode(
        urlParams.get('cameraDebug') === 'true' || 
        urlParams.get('proctorDebug') === 'true' ||
        process.env.NEXT_PUBLIC_CAMERA_DEBUG === 'true'
      )
    }
  }, [])

  // Get client-side values safely
  const isClient = typeof window !== 'undefined';
  const assessmentIdStr = typeof testId === 'string' ? testId : '';
  
  // Try multiple sources for candidateId
  // Priority: candidateEmail > userId from URL > anonymous
  const getCandidateId = (): string => {
    if (candidateEmail && candidateEmail.trim() !== '') {
      return candidateEmail.trim();
    }
    if (userId && userId.trim() !== '') {
      return userId.trim();
    }
    return 'anonymous';
  };
  
  const candidateIdStr = getCandidateId();
  
  // Log the candidateId being used for debugging
  useEffect(() => {
    if (isClient && test && questions.length > 0) {
      console.log('[DSA Take] Proctoring Configuration:', {
        candidateId: candidateIdStr,
        candidateIdType: typeof candidateIdStr,
        candidateIdLength: candidateIdStr?.length,
        candidateEmail: candidateEmail,
        userIdFromUrl: userId,
        assessmentId: assessmentIdStr,
        aiProctoringEnabled: aiProctoringEnabled,
        liveProctoringEnabled: liveProctoringEnabled,
      });
    }
  }, [isClient, test, questions.length, candidateIdStr, candidateEmail, userId, assessmentIdStr, aiProctoringEnabled, liveProctoringEnabled]);

  // Proctor upload hook
  const { uploadSnapshot, recordViolation } = useProctorUpload({
    assessmentId: assessmentIdStr,
    candidateId: candidateIdStr,
  });

  // Get screen stream from window.__screenStream (set by identity-verify gate)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__screenStream) {
      const stream = (window as any).__screenStream as MediaStream;
      if (stream && stream.active && stream.getVideoTracks().length > 0) {
        setLiveProctorScreenStream(stream);
        console.log('[DSA Take] Found global screen stream for Live Proctoring');
      }
    }
  }, []);

  // Get webcam stream from webcamStreamRef
  const webcamStreamForLiveProctor = webcamLive && webcamStreamRef.current 
    ? webcamStreamRef.current
    : null;

  const {
    isStreaming: isLiveProctoringStreaming,
    connectionState: liveProctoringConnectionState,
    error: liveProctoringError,
    sessionId: liveProctoringSessionId,
    startStreaming: startLiveProctoring,
    stopStreaming: stopLiveProctoring,
  } = useLiveProctoring({
    assessmentId: assessmentIdStr,
    candidateId: candidateIdStr,
    enabled: liveProctoringEnabled,
    preScreenStream: liveProctorScreenStream,
    onError: (error) => {
      console.error('[DSA Take] Live Proctoring error:', error);
    },
    debugMode: true, // Temporarily enabled for debugging
  });

  // Start Live Proctoring when test starts (with guard to prevent loops)
  const liveProctoringStartedRef = useRef(false);
  useEffect(() => {
    const timerStarted = !!testSubmission?.started_at;
    if (timerStarted && liveProctoringEnabled && liveProctorScreenStream && webcamStreamForLiveProctor && !liveProctoringStartedRef.current) {
      liveProctoringStartedRef.current = true;
      console.log('[DSA Take] Starting Live Proctoring...');
      startLiveProctoring().catch(err => {
        console.error('[DSA Take] Failed to start Live Proctoring:', err);
        liveProctoringStartedRef.current = false; // Reset on error so it can retry
      });
    }
    // Reset guard if conditions are no longer met
    if (!timerStarted || !liveProctoringEnabled || !liveProctorScreenStream || !webcamStreamForLiveProctor) {
      liveProctoringStartedRef.current = false;
    }
  }, [testSubmission?.started_at, liveProctoringEnabled, liveProctorScreenStream, webcamStreamForLiveProctor, startLiveProctoring]);

  // Reset guard when streaming stops (allows restart on reconnection)
  useEffect(() => {
    if (!isLiveProctoringStreaming && liveProctoringStartedRef.current) {
      console.log('[DSA Take] Live Proctoring stopped, resetting guard for potential restart');
      liveProctoringStartedRef.current = false;
    }
  }, [isLiveProctoringStreaming]);

  // Stop Live Proctoring when assessment ends
  useEffect(() => {
    if (submitting || (testSubmission && testSubmission.ended_at)) {
      stopLiveProctoring();
    }
    return () => {
      if (submitting || (testSubmission && testSubmission.ended_at)) {
        stopLiveProctoring();
      }
    };
  }, [submitting, testSubmission, stopLiveProctoring]);

  // ============================================================================
  // PROCTORING FUNCTIONS
  // ============================================================================

  // Handle violation events
  const handleViolation = useCallback(async (eventType: string) => {
    const now = Date.now();
    const timestamp = new Date().toISOString();

    // Cooldown for multiple faces
    if (eventType === 'MULTIPLE_FACES_DETECTED') {
      if (now - multipleFacesCooldownRef.current < MULTIPLE_FACES_COOLDOWN_MS) {
        console.log('[Proctor] Multiple faces cooldown active, skipping');
        return;
      }
      multipleFacesCooldownRef.current = now;
    }

    console.log('[Proctor] Handling violation:', {
      eventType,
      assessmentId: assessmentIdStr,
      candidateId: candidateIdStr,
      webcamLive,
      hasVideoRef: !!thumbVideoRef.current,
    });

    // Determine which video element to use for snapshot
    // Snapshots disabled for TAB_SWITCH and FOCUS_LOST per request
    const isScreenEvent = false;
    let videoForSnapshot: HTMLVideoElement | null = null;
    
    if (isScreenEvent) {
      console.log('[Proctor] Screen capture requested for', eventType);
      // Screen capture logic would go here if needed
    } else if (webcamLive && thumbVideoRef.current) {
      videoForSnapshot = thumbVideoRef.current;
    }

    // Record violation with snapshot (snapshot captured inside recordViolation)
    const success = await recordViolation(
      {
        eventType,
        timestamp,
        assessmentId: assessmentIdStr,
        candidateId: candidateIdStr,
      },
      videoForSnapshot
    );

    console.log('[Proctor] Violation recorded:', { eventType, success });

    // Show toast
    pushViolationToast({
      id: `${eventType}-${now}`,
      eventType,
      message: getViolationMessage(eventType),
      timestamp,
    });
  }, [webcamLive, recordViolation, assessmentIdStr, candidateIdStr]);

  // Face detection callback
  const handleDetection = useCallback((result: DetectionResult) => {
    setDisplayedFacesCount(result.facesCount);

    // No face detection
    if (result.facesCount === 0) {
      noFaceCountRef.current++;
      if (noFaceCountRef.current >= NO_FACE_FRAMES_THRESHOLD) {
        handleViolation('NO_FACE_DETECTED');
        noFaceCountRef.current = 0; // Reset after triggering
      }
    } else {
      noFaceCountRef.current = 0;
    }

    // Multiple faces
    if (result.multiFace) {
      handleViolation('MULTIPLE_FACES_DETECTED');
    }

    // Gaze away
    if (result.gazeAway) {
      handleViolation('GAZE_AWAY');
    }
  }, [handleViolation]);

  // FaceMesh hook
  const { isModelLoaded, modelError, facesCount } = useFaceMesh({
    videoRef: thumbVideoRef,
    onDetection: handleDetection,
    // Camera-based AI proctoring only runs when the AI toggle is enabled
    enabled: aiProctoringEnabled && webcamLive,
  });

  // Update FaceMesh status
  useEffect(() => {
    if (modelError) {
      setFaceMeshStatus('error');
    } else if (isModelLoaded) {
      setFaceMeshStatus('loaded');
    } else {
      setFaceMeshStatus('loading');
    }
  }, [isModelLoaded, modelError]);

  // Start webcam
  const startWebcam = useCallback(async () => {
    if (!isClient) return;

    console.log('[Webcam] Starting webcam...');

    try {
      // Reuse existing stream if available
      if (webcamStreamRef.current && webcamStreamRef.current.active) {
        console.log('[Webcam] Reusing existing stream');
        if (thumbVideoRef.current) {
          thumbVideoRef.current.srcObject = webcamStreamRef.current;
          await thumbVideoRef.current.play();
        }
        setWebcamLive(true);
        return;
      }

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });

      webcamStreamRef.current = stream;
      console.log('[Webcam] Stream acquired');

      // Wait for video element
      let retries = 10;
      while (!thumbVideoRef.current && retries > 0) {
        await new Promise((r) => setTimeout(r, 100));
        retries--;
      }

      if (thumbVideoRef.current) {
        thumbVideoRef.current.srcObject = stream;

        // Wait for video to be ready
        await new Promise<void>((resolve) => {
          const video = thumbVideoRef.current!;
          if (video.readyState >= 2) {
            resolve();
          } else {
            video.onloadeddata = () => resolve();
          }
        });

        await thumbVideoRef.current.play();
        console.log('[Webcam] Video playing');
        setWebcamLive(true);
      }
    } catch (err) {
      console.error('[Webcam] Error starting webcam:', err);
      setWebcamLive(false);
    }
  }, [isClient]);

  // Stop webcam
  const stopWebcam = useCallback(() => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
    setWebcamLive(false);
    console.log('[Webcam] Stopped');
  }, []);

  // Start AI/tab proctoring when test is ready
  useEffect(() => {
    if (test && questions.length > 0 && !proctoringEnabled && isClient) {
      console.log('[Proctor] Starting proctoring...');
      // Always enable overall proctoring (TAB_SWITCH / FOCUS_LOST etc.)
      setProctoringEnabled(true);

      if (aiProctoringEnabled) {
        // Start webcam only when AI camera proctoring is enabled for this test
        startWebcam();
      } else {
        console.log(
          '[Proctor] AI proctoring disabled for this test; skipping webcam/FaceMesh'
        );
      }
    }
  }, [test, questions.length, proctoringEnabled, isClient, aiProctoringEnabled, startWebcam]);

  // Safety: if proctoring is already enabled and we later discover AI flag is ON,
  // ensure webcam starts as soon as possible.
  useEffect(() => {
    if (
      test &&
      questions.length > 0 &&
      proctoringEnabled &&
      aiProctoringEnabled &&
      !webcamLive &&
      isClient
    ) {
      console.log('[Proctor] AI flag enabled after proctor start; starting webcam now...');
      startWebcam();
    }
  }, [test, questions.length, proctoringEnabled, aiProctoringEnabled, webcamLive, isClient, startWebcam]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, [stopWebcam]);

  // Tab visibility detection
  useEffect(() => {
    if (!isClient || !proctoringEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleViolation('TAB_SWITCH');
      }
    };

    const handleBlur = () => {
      handleViolation('FOCUS_LOST');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isClient, proctoringEnabled, handleViolation]);

  // Check if fullscreen was refused
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const fullscreenAccepted = sessionStorage.getItem('fullscreenAccepted')
      setShowFullscreenWarning(fullscreenAccepted === 'false')
    }
  }, [])

  // Auto-enter fullscreen after test data loads if test was already in progress (refresh case)
  // Flow: Load page -> Load test data -> Auto-enter fullscreen if was already in progress -> Start timer
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if fullscreen was already accepted (test was already in progress - refresh case)
    const fullscreenAccepted = sessionStorage.getItem('fullscreenAccepted') === 'true'
    const shouldStartTest = sessionStorage.getItem('shouldStartTest') === 'true'
    
    // Only auto-enter fullscreen if test was already in progress (fullscreenAccepted is set)
    // For first time entry (shouldStartTest), show prompt instead
    if (!fullscreenAccepted && !shouldStartTest) return

    // Only proceed after test and questions are loaded
    if (test && questions.length > 0) {
      // Check if already in fullscreen
      const isFullscreen = !!document.fullscreenElement || 
                          !!(document as any).webkitFullscreenElement ||
                          !!(document as any).mozFullScreenElement ||
                          !!(document as any).msFullscreenElement
      
      if (!isFullscreen) {
        if (fullscreenAccepted) {
          // Auto-enter fullscreen if test was already in progress (refresh case)
          console.log('[Fullscreen] Auto-entering fullscreen after refresh (test was already in progress)')
          const enterFullscreen = async () => {
            try {
              if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen()
              } else if ((document.documentElement as any).webkitRequestFullscreen) {
                await (document.documentElement as any).webkitRequestFullscreen()
              } else if ((document.documentElement as any).mozRequestFullScreen) {
                await (document.documentElement as any).mozRequestFullScreen()
              } else if ((document.documentElement as any).msRequestFullscreen) {
                await (document.documentElement as any).msRequestFullscreen()
              }
            } catch (err) {
              console.warn('[Fullscreen] Auto-enter failed, showing prompt instead:', err)
              // If auto-enter fails, show prompt as fallback
              setShowFullscreenPrompt(true)
            }
          }
          enterFullscreen()
        } else if (shouldStartTest && !showFullscreenPrompt) {
          // Show prompt only for first time entry (from instructions page)
          setShowFullscreenPrompt(true)
          console.log('[Fullscreen] Showing fullscreen prompt for first time entry')
        }
      }
    }
  }, [test, questions.length, showFullscreenPrompt])

  // Request fullscreen (reusable function)
  const requestFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      const elem = document.documentElement
      
      if (elem.requestFullscreen) {
        await elem.requestFullscreen()
      } else if ((elem as any).webkitRequestFullscreen) {
        await (elem as any).webkitRequestFullscreen()
      } else if ((elem as any).mozRequestFullScreen) {
        await (elem as any).mozRequestFullScreen()
      } else if ((elem as any).msRequestFullscreen) {
        await (elem as any).msRequestFullscreen()
      }
      
      // Verify fullscreen was actually entered
      await new Promise(resolve => setTimeout(resolve, 100))
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      )
      
      return isFullscreen
    } catch (error) {
      console.error('[Fullscreen] Failed to enter fullscreen:', error)
      return false
    }
  }, [])

  // Handle fullscreen entry from prompt
  const handleEnterFullscreenFromPrompt = async () => {
    try {
      console.log('[Fullscreen] User clicked Enter Fullscreen button')
      const success = await requestFullscreen()
      
      if (success) {
        console.log('[Fullscreen] Successfully entered fullscreen - timer will start when editor is visible')
        setShowFullscreenPrompt(false)
        // Always set fullscreenAccepted flag (for both first entry and refresh re-entry)
        sessionStorage.setItem('fullscreenAccepted', 'true')
        // Now we can remove shouldStartTest since fullscreen is entered
        sessionStorage.removeItem('shouldStartTest')
      }
    } catch (err) {
      console.error('[Fullscreen] Error entering fullscreen:', err)
      // Error will be handled by FullscreenPrompt component
    }
  }

  // Listen for fullscreen exit and re-enter (to prevent accidental exits)
  // Check both shouldStartTest and fullscreenAccepted to handle cases after fullscreen is entered
  useEffect(() => {
    const shouldBeFullscreen = sessionStorage.getItem('shouldStartTest') === 'true' || 
                               sessionStorage.getItem('fullscreenAccepted') === 'true'
    if (!shouldBeFullscreen) return

    const handleFullscreenExit = () => {
      const isFullscreen = !!document.fullscreenElement || 
                          !!(document as any).webkitFullscreenElement ||
                          !!(document as any).mozFullScreenElement ||
                          !!(document as any).msFullscreenElement
      
      // If fullscreen is exited, show warning
      if (!isFullscreen) {
        setShowFullscreenWarning(true)
        console.log('[Fullscreen] Detected fullscreen exit')
      } else if (isFullscreen) {
        setShowFullscreenWarning(false)
      }
    }
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', handleFullscreenExit)
    document.addEventListener('webkitfullscreenchange', handleFullscreenExit)
    document.addEventListener('mozfullscreenchange', handleFullscreenExit)
    document.addEventListener('MSFullscreenChange', handleFullscreenExit)
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenExit)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenExit)
      document.removeEventListener('mozfullscreenchange', handleFullscreenExit)
      document.removeEventListener('MSFullscreenChange', handleFullscreenExit)
    }
  }, [])

  // Handle fullscreen request from warning banner
  const handleEnterFullscreenFromBanner = async () => {
    const success = await requestFullscreen()
    if (success) {
      setShowFullscreenWarning(false)
      sessionStorage.setItem('fullscreenAccepted', 'true')
    }
  }
  
  // Get candidate info from session storage or API (non-blocking)
  useEffect(() => {
    // First try session storage (set by verification page) - this is synchronous and fast
    const storedEmail = sessionStorage.getItem("candidateEmail")
    const storedName = sessionStorage.getItem("candidateName")
    
    if (storedEmail && storedName) {
      setCandidateEmail(storedEmail)
      setCandidateName(storedName)
    } else if (userId && testId) {
      // Fallback to API if session storage not available - do this asynchronously after initial render
      // Don't block the page load for this
      const fetchCandidateInfo = async () => {
        try {
          const response = await dsaApi.get(`/tests/${testId}/candidates`)
          const candidates = response.data
          const candidate = candidates.find((c: any) => c.user_id === userId)
          if (candidate) {
            setCandidateEmail(candidate.email)
            setCandidateName(candidate.name)
            // Store in session storage for consistency
            sessionStorage.setItem("candidateEmail", candidate.email)
            sessionStorage.setItem("candidateName", candidate.name)
          }
        } catch (error) {
          console.error('Error fetching candidate info:', error)
          // Don't block page load if this fails
        }
      }
      // Delay API call slightly to not block initial render
      setTimeout(() => {
        fetchCandidateInfo()
      }, 100)
    }
  }, [userId, testId])

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])


  useEffect(() => {
    const newToken = getTokenFromUrl()
    const newUserId = getUserIdFromUrl()
    if (newToken && newToken !== token) setToken(newToken)
    if (newUserId && newUserId !== userId) setUserId(newUserId)
  }, [router.query, token, userId])

  useEffect(() => {
    if (!testId || typeof testId !== 'string') return

    const checkParams = setTimeout(() => {
      const urlToken = getTokenFromUrl()
      const urlUserId = getUserIdFromUrl()
      
      const finalToken = token || urlToken
      const finalUserId = userId || urlUserId

      if (!finalToken || !finalUserId) {
        setCheckingParams(false)
        if (finalToken) {
          router.push(`/test/${testId}?token=${encodeURIComponent(finalToken)}`)
        } else {
          router.push(`/test/${testId}`)
        }
        return
      }

      if (urlToken && !token) setToken(urlToken)
      if (urlUserId && !userId) setUserId(urlUserId)
      // Don't set checkingParams to false here - let the data fetch useEffect handle it
    }, 200)

    return () => clearTimeout(checkParams)
  }, [testId, token, userId, router])

  // NEW: simple, from-scratch test + question loading flow
  // 1) Ensure submission (existing or start)
  // 2) Fetch public test data
  // 3) Fetch all questions in parallel (Promise.allSettled)
  useEffect(() => {
    if (!router.isReady) return

    const safeTestId =
      typeof testId === 'string'
        ? testId
        : Array.isArray(testId)
        ? testId[0]
        : undefined

    if (!safeTestId || !token || !userId) {
      console.warn('[Test Load] Missing required params, cannot load test', {
        testId: safeTestId,
        hasToken: !!token,
        userId,
      })
      setCheckingParams(false)
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        setCheckingParams(false)
        setQuestionsLoading(true)

        // --- Step 1: Ensure submission exists ---
        let submissionData: any = null

        try {
          const subRes = await dsaApi.get(`/tests/${testId}/submission?user_id=${userId}`)
          submissionData = subRes.data

          if (submissionData.is_completed) {
            if (!cancelled) {
              alert('You have already submitted this test. You cannot attempt it again.')
              router.push('/dashboard')
            }
            return
          }
        } catch (err: any) {
          if (err?.response?.status === 404) {
            // No submission yet -> start test
            try {
              const startRes = await dsaApi.post(`/tests/${testId}/start?user_id=${userId}`)
              const data = startRes.data

              if (data.precheck_mode === true) {
                if (!cancelled) {
                  setPrecheckMode({
                    start_time: data.start_time,
                    message:
                      data.message ||
                      'Test has not started yet. Please complete pre-checks and wait.',
                  })
                }

                submissionData = {
                  started_at: null,
                  is_completed: false,
                  precheck_mode: true,
                }
              } else {
                submissionData = {
                  started_at: data.started_at,
                  is_completed: false,
                  submissions: [],
                }
              }
            } catch (startErr: any) {
              if (!cancelled) {
                const detail =
                  startErr?.response?.data?.detail ||
                  startErr?.response?.data?.message ||
                  'Failed to start test. Please try again.'
                alert(detail)
                router.push('/dashboard')
              }
              return
            }
          } else {
            if (!cancelled) {
              console.error('[Test Load] Error fetching submission', err)
              alert('Error loading test. Please try again.')
              router.push('/dashboard')
            }
            return
          }
        }

        if (cancelled) return

        // --- Step 2: Fetch public test data ---
        const testRes = await dsaApi.get(`/tests/${testId}/public?user_id=${userId}`)
        const testData = testRes.data

        if (!testData) {
          if (!cancelled) {
            alert('Error: Could not load test data. Please refresh the page.')
          }
          return
        }

        if (!cancelled) {
          setTest(testData)
          setTestSubmission(submissionData)

          // Load proctoring settings from test data
          const proctoringSettingsFromTest = testData?.proctoringSettings || {};
          console.log('[DSA Take] Proctoring settings received from backend:', {
            proctoringSettingsFromTest,
            rawTestData: testData,
            aiProctoringEnabled: proctoringSettingsFromTest.aiProctoringEnabled,
            liveProctoringEnabled: proctoringSettingsFromTest.liveProctoringEnabled,
            aiProctoringEnabledType: typeof proctoringSettingsFromTest.aiProctoringEnabled,
            liveProctoringEnabledType: typeof proctoringSettingsFromTest.liveProctoringEnabled,
          });
          setProctoringSettings(proctoringSettingsFromTest);
          setAiProctoringEnabled(proctoringSettingsFromTest.aiProctoringEnabled === true);
          setLiveProctoringEnabled(proctoringSettingsFromTest.liveProctoringEnabled === true);
          console.log('[DSA Take] State updated:', {
            aiProctoringEnabled: proctoringSettingsFromTest.aiProctoringEnabled === true,
            liveProctoringEnabled: proctoringSettingsFromTest.liveProctoringEnabled === true,
          });
        }

        const isPrecheck = submissionData?.precheck_mode === true
        if (!isPrecheck && submissionData?.is_completed) {
          if (!cancelled) {
            alert('You have already submitted this test. You cannot attempt it again.')
            router.push('/dashboard')
          }
          return
        }

        // --- Step 3: Fetch all questions in parallel ---
        const questionIds: string[] = testData.question_ids || []
        if (questionIds.length === 0) {
          if (!cancelled) {
            alert('This test has no questions configured. Please contact the administrator.')
            router.push('/dashboard')
          }
          return
        }

        const questionPromises = questionIds.map((qId: string) =>
          dsaApi.get(`/tests/${testId}/question/${qId}?user_id=${userId}`).then((res) => res.data as Question)
        )

        const results = await Promise.allSettled(questionPromises)
        const questionsData: Question[] = []

        results.forEach((result, index) => {
          const qId = questionIds[index]
          if (result.status === 'fulfilled' && result.value) {
            questionsData.push(result.value)
          } else if (result.status === 'rejected') {
            const err: any = result.reason
            console.error('[Test Load] Question fetch failed', {
              questionId: qId,
              status: err?.response?.status,
              data: err?.response?.data,
              message: err?.message,
            })
          }
        })

        if (cancelled) return

        if (questionsData.length === 0) {
          alert('This test has no valid questions. Please contact the administrator.')
          router.push('/dashboard')
          return
        }

        // Initialize visible testcases
        const visibleMap: Record<string, VisibleTestcase[]> = {}
        questionsData.forEach((q) => {
          visibleMap[q.id] =
            q.public_testcases?.map((tc: { input: string; expected_output: string }, idx: number) => ({
              id: `${q.id}-public-${idx}`,
              input: tc.input,
              expected: tc.expected_output,
            })) || []
        })

        // Initialize code and language (no preloading/localStorage merging)
        const initialCode: Record<string, string> = {}
        const initialLanguage: Record<string, string> = {}
        questionsData.forEach((q) => {
          if (q.question_type?.toUpperCase() === 'SQL') {
            initialCode[q.id] = q.starter_query || '-- Write your SQL query here\n\nSELECT '
            initialLanguage[q.id] = 'sql'
          } else {
            const defaultLang = q.languages[0] || 'python'
            let starterCode = ''
            if (q.function_signature) {
              starterCode = generateBoilerplate(defaultLang, q)
            } else if (q.starter_code && q.starter_code[defaultLang]) {
              starterCode = q.starter_code[defaultLang]
            } else {
              starterCode = generateBoilerplate(defaultLang, q)
            }
            initialCode[q.id] = starterCode
            initialLanguage[q.id] = defaultLang
          }
        })

        if (!cancelled) {
          setQuestions(questionsData)
          setVisibleTestcasesMap(visibleMap)
          setCode(initialCode)
          setLanguage(initialLanguage)
          setQuestionsLoading(false)

          const now = new Date().toISOString()
          setTestStartedAt(now)
          setQuestionStartTimes({ [questionsData[0].id]: now })
        }
      } catch (err) {
        console.error('[Test Load] Fatal error while loading test', err)
        if (!cancelled) {
          alert('An error occurred while loading the test. Please try again.')
          router.push('/dashboard')
        }
      } finally {
        // nothing to reset; effect can safely re-run if params change
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [router, router.isReady, testId, token, userId])

  const handleAutoSubmit = async () => {
    // Extra safety: only auto-submit when the test is fully in-progress and UI is ready.
      if (submitting) return
    if (precheckMode) return
    if (!test || questions.length === 0) return

    await handleSubmit(true)
  }

  // ============================================
  // Timer hook - clean implementation
  const timerCurrentQuestion = questions[currentQuestionIndex] || null
  const timer = useDSTimer({
    test: test ? {
      timer_mode: test.timer_mode,
      duration_minutes: test.duration_minutes,
      question_timings: test.question_timings,
      start_time: test.start_time,
    } : null,
    testSubmission,
    questions,
    currentQuestionId: timerCurrentQuestion?.id || null,
    onExpire: handleAutoSubmit,
    onQuestionExpire: (questionId: string) => {
      // Mark question as submitted
      setSubmittedQuestions(prev => ({ ...prev, [questionId]: true }))
      
      // Move to next question or submit if last
      const currentIndex = questions.findIndex(q => q.id === questionId)
      if (currentIndex < questions.length - 1) {
        handleQuestionChange(currentIndex + 1)
      } else {
        handleAutoSubmit()
      }
    },
    enabled: !precheckMode && questions.length > 0,
  })

  const handleSubmit = async (isAuto: boolean = false) => {
    if (submitting) {
      console.log('[Submit] Already submitting, ignoring click')
      return
    }

    // Validate required data
    if (!testId || !userId) {
      alert('Missing test ID or user ID. Please refresh the page and try again.')
      console.error('[Submit] Missing testId or userId:', { testId, userId })
      return
    }

    if (!questions || questions.length === 0) {
      alert('No questions found. Please refresh the page and try again.')
      console.error('[Submit] No questions found')
      return
    }


    // Confirmation alert removed - submit directly
    setSubmitting(true)

    try {
      const questionSubmissions = questions.map((q) => ({
        question_id: q.id,
        code: code[q.id] || '',
        language: language[q.id] || 'python',
      }))

      const activityLogs: any[] = []
      
      questions.forEach((q) => {
        if (questionStartTimes[q.id]) {
          const startTime = new Date(questionStartTimes[q.id])
          const endTime = new Date()
          const timeSpent = Math.floor((endTime.getTime() - startTime.getTime()) / 1000)
          
          activityLogs.push({
            type: 'question_time',
            question_id: q.id,
            time_spent_seconds: timeSpent,
            timestamp: endTime.toISOString(),
          })
        }
      })

      questions.forEach((q) => {
        const runCount = publicResults[q.id]?.length || 0
        if (runCount > 0) {
          activityLogs.push({
            type: 'run_attempts',
            question_id: q.id,
            count: runCount,
            timestamp: new Date().toISOString(),
          })
        }
      })

      console.log('[Submit] Submitting test:', { testId, userId, questionCount: questionSubmissions.length })
      
      const response = await dsaApi.post(`/tests/${testId}/final-submit?user_id=${userId}`, {
        question_submissions: questionSubmissions,
        activity_logs: activityLogs,
      })

      console.log('[Submit] Submission successful:', response.data)

      // Redirect to completed page
      try {
        await router.push(`/test/${testId}/completed`)
      } catch (routerError: any) {
        console.error('[Submit] Router push failed:', routerError)
        // If router push fails, try window.location as fallback
        window.location.href = `/test/${testId}/completed`
      }
    } catch (error: any) {
      console.error('[Submit] Failed to submit test:', error)
      const errorMessage = error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to submit test. Please try again.'
      
      // Show user-friendly error message
      alert(`Submission failed: ${errorMessage}`)
      
      // Don't set submitted to true on error - let user retry
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuestionChange = (index: number) => {
    const previousQuestion = questions[currentQuestionIndex]
    const newQuestion = questions[index]
    
    // Check if navigation is allowed (sequential mode)
    // Only enforce sequential locking for PER_QUESTION mode
    // For GLOBAL mode, all questions are accessible
    if (test?.timer_mode === 'PER_QUESTION' && index > 0) {
      const previousQuestionId = questions[index - 1]?.id
      if (previousQuestionId && !submittedQuestions[previousQuestionId]) {
        // Previous question not submitted - block navigation
        alert(`Please submit Question ${index} before moving to Question ${index + 1}`)
        return
      }
    }
    
    setCurrentQuestionIndex(index)
    
    if (newQuestion) {
      // Track question start time
      if (!questionStartTimes[newQuestion.id]) {
        setQuestionStartTimes(prev => ({
          ...prev,
          [newQuestion.id]: new Date().toISOString()
        }))
      }
    
      // Handle SQL questions differently (case-insensitive check)
      if (newQuestion.question_type?.toUpperCase() === 'SQL') {
        if (!code[newQuestion.id] || code[newQuestion.id].trim() === '') {
          const starterQuery = newQuestion.starter_query || '-- Write your SQL query here\n\nSELECT '
          setCode({ ...code, [newQuestion.id]: starterQuery })
        }
        if (!language[newQuestion.id]) {
          setLanguage({ ...language, [newQuestion.id]: 'sql' })
        }
      } else {
        // Coding questions
        const currentLang = language[newQuestion.id] || newQuestion.languages[0] || 'python'
        if (!code[newQuestion.id] || code[newQuestion.id].trim() === '') {
          let starterCode = ''
          if (newQuestion.starter_code && newQuestion.starter_code[currentLang]) {
            starterCode = newQuestion.starter_code[currentLang]
          } else {
            starterCode = generateBoilerplate(currentLang, newQuestion)
          }
          setCode({ ...code, [newQuestion.id]: starterCode })
        }
        if (!language[newQuestion.id]) {
          setLanguage({ ...language, [newQuestion.id]: currentLang })
        }
      }
    }
  }

  const handleRun = async () => {
    if (!userId) return
    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    // Handle SQL questions - execute via Judge0 SQLite
    const isSQLQuestion = currentQuestion.question_type?.toUpperCase() === 'SQL'
    if (isSQLQuestion) {
      setRunning(true)
      setOutput(prev => ({
        ...prev,
        [currentQuestion.id]: {
          stdout: '⏳ Executing SQL query...',
          status: 'running'
        }
      }))

      try {
        const sqlQuery = code[currentQuestion.id] || currentQuestion.starter_query || ''
        
        const response = await dsaApi.post('/assessment/run-sql', {
          question_id: currentQuestion.id,
          sql_query: sqlQuery,
        })

        const result = response.data
        
        if (result.status === 'executed') {
          // Format output nicely
          const outputLines = result.output?.split('\n') || []
          const formattedOutput = outputLines.length > 0 
            ? `✅ Query executed successfully!\n\n📊 Results:\n${result.output}`
            : '✅ Query executed successfully (no output rows)'
          
          setOutput(prev => ({
            ...prev,
            [currentQuestion.id]: {
              stdout: formattedOutput,
              status: 'success'
            }
          }))
        } else {
          // Error occurred
          setOutput(prev => ({
            ...prev,
            [currentQuestion.id]: {
              stderr: `❌ ${result.message}\n\n${result.error || ''}`,
              status: 'error'
            }
          }))
        }

        setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'attempted' })
      } catch (error: any) {
        console.error('SQL Run error:', error)
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to execute SQL query'
        setOutput(prev => ({
          ...prev,
          [currentQuestion.id]: {
            stderr: `❌ Error: ${errorMessage}`,
            status: 'error'
          }
        }))
      } finally {
        setRunning(false)
      }
      return
    }

    setRunning(true)
    setOutput({})
    setPublicResults({})
    setHiddenSummary({})

    try {
      const currentCode = code[currentQuestion.id] || currentQuestion.starter_code[language[currentQuestion.id] || 'python'] || ''
      const currentLang = language[currentQuestion.id] || 'python'
      const languageId = getLanguageId(currentLang)
      
      if (!languageId) {
        alert(`Unsupported language: ${currentLang}`)
        setRunning(false)
        return
      }
      
      const response = await dsaApi.post('/assessment/run', {
        question_id: currentQuestion.id,
        source_code: currentCode,
        language_id: languageId,
      })
      
      const result = response.data
      
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
      }))
      
      setPublicResults(prev => ({ ...prev, [currentQuestion.id]: mappedResults }))
      
      const allPassed = result.public_summary?.passed === result.public_summary?.total
      setOutput(prev => ({
        ...prev,
        [currentQuestion.id]: {
          stdout: allPassed 
            ? `✅ All ${result.public_summary?.total || 0} public test cases passed!`
            : `❌ ${result.public_summary?.passed || 0}/${result.public_summary?.total || 0} public test cases passed`,
          status: result.status,
        }
      }))

      setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'attempted' })
    } catch (error: any) {
      console.error('Run error:', error)
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to run code'
      setOutput(prev => ({
        ...prev,
        [currentQuestion.id]: {
          stderr: errorMessage,
          status: 'error'
        }
      }))
    } finally {
      setRunning(false)
    }
  }

  const handleCodeSubmit = async () => {
    if (!userId) return
    
    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    // Handle SQL questions - submit via Judge0 SQLite
    const isSQLQuestion = currentQuestion.question_type?.toUpperCase() === 'SQL'
    if (isSQLQuestion) {
      setRunning(true)
      setOutput(prev => ({
        ...prev,
        [currentQuestion.id]: {
          stdout: '⏳ Submitting SQL query for evaluation...',
          status: 'running'
        }
      }))

      try {
        const sqlQuery = code[currentQuestion.id] || currentQuestion.starter_query || ''
        const startedAt = questionStartTimes[currentQuestion.id] || new Date().toISOString()
        const submittedAt = new Date().toISOString()
        const startTime = new Date(startedAt).getTime()
        const endTime = new Date(submittedAt).getTime()
        const timeSpentSeconds = Math.floor((endTime - startTime) / 1000)
        
        const response = await dsaApi.post('/assessment/submit-sql', {
          question_id: currentQuestion.id,
          sql_query: sqlQuery,
          started_at: startedAt,
          submitted_at: submittedAt,
          time_spent_seconds: timeSpentSeconds,
        }, {
          params: { user_id: userId },
        })

        const result = response.data
        
        if (result.passed) {
          setOutput(prev => ({
            ...prev,
            [currentQuestion.id]: {
              stdout: `✅ ${result.message}\n\n📊 Your Output:\n${result.user_output || '(empty)'}\n\n⏱️ Execution Time: ${result.time || 'N/A'}s\n💾 Memory: ${result.memory || 'N/A'} KB\n\n🏆 Score: ${result.score}/${result.max_score}`,
              status: 'accepted'
            }
          }))
          setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'solved' })
        } else {
          let outputMessage = `❌ ${result.message}\n\n📊 Your Output:\n${result.user_output || '(empty)'}`
          
          if (result.expected_output) {
            outputMessage += `\n\n📋 Expected Output:\n${result.expected_output}`
          }
          
          outputMessage += `\n\n🏆 Score: ${result.score}/${result.max_score}`
          
          setOutput(prev => ({
            ...prev,
            [currentQuestion.id]: {
              stdout: outputMessage,
              status: 'wrong_answer'
            }
          }))
          setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'attempted' })
        }

        // Add to submission history
        const historyEntry: SubmissionHistoryEntry = {
          id: result.submission_id || `sql-${currentQuestion.id}-${Date.now()}`,
          status: result.status,
          passed: result.passed ? 1 : 0,
          total: 1,
          score: result.score || 0,
          max_score: result.max_score || 100,
          created_at: new Date().toISOString(),
          results: [],
        }
        
        setSubmissionHistory((prev) => {
          const existing = prev[currentQuestion.id] || []
          const updated = [historyEntry, ...existing].slice(0, 5)
          return { ...prev, [currentQuestion.id]: updated }
        })
        
        // Mark question as submitted (unlock next question)
        setSubmittedQuestions(prev => ({
          ...prev,
          [currentQuestion.id]: true
        }))

      } catch (error: any) {
        console.error('SQL Submit error:', error)
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to submit SQL query'
        setOutput(prev => ({
          ...prev,
          [currentQuestion.id]: {
            stderr: `❌ Error: ${errorMessage}`,
            status: 'error'
          }
        }))
        setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'attempted' })
      } finally {
        setRunning(false)
      }
      return
    }

    setRunning(true)
    setOutput({})
    setPublicResults({})
    setHiddenSummary({})

    try {
      const currentLang = language[currentQuestion.id] || 'python'
      const currentCode = code[currentQuestion.id] || ''
      const languageId = getLanguageId(currentLang)

      if (!languageId) {
        alert(`Unsupported language: ${currentLang}`)
        setRunning(false)
        return
      }

      const startedAt = questionStartTimes[currentQuestion.id] || new Date().toISOString()
      const submittedAt = new Date().toISOString()
      const startTime = new Date(startedAt).getTime()
      const endTime = new Date(submittedAt).getTime()
      const timeSpentSeconds = Math.floor((endTime - startTime) / 1000)
      
      const response = await dsaApi.post('/assessment/submit', {
        question_id: currentQuestion.id,
        source_code: currentCode,
        language_id: languageId,
        started_at: startedAt,
        submitted_at: submittedAt,
        time_spent_seconds: timeSpentSeconds,
      }, {
        params: { user_id: userId },
      })

      const result = response.data
      
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
      }))
      
      setPublicResults(prev => ({ ...prev, [currentQuestion.id]: mappedResults }))
      setHiddenSummary(prev => ({ ...prev, [currentQuestion.id]: result.hidden_summary || null }))

      if (result.compilation_error) {
        const compileOutput = result.public_results?.find((r: any) => r.compile_output)?.compile_output
        setOutput(prev => ({
          ...prev,
          [currentQuestion.id]: {
            stderr: compileOutput || 'Compilation failed',
            compileOutput: compileOutput,
            status: 'Compilation Error',
          }
        }))
      } else {
        const hiddenInfo = result.hidden_summary?.total > 0 
          ? ` (Hidden: ${result.hidden_summary.passed}/${result.hidden_summary.total})`
          : ''
        setOutput(prev => ({
          ...prev,
          [currentQuestion.id]: {
            stdout: `Passed ${result.total_passed}/${result.total_tests} test cases${hiddenInfo}\nScore: ${result.score}/${result.max_score}`,
            status: result.status,
          }
        }))
      }

      if (result.status === 'accepted') {
        setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'solved' })
      } else {
        setQuestionStatus({ ...questionStatus, [currentQuestion.id]: 'attempted' })
      }

      const historyEntry: SubmissionHistoryEntry = {
        id: result.submission_id || `${currentQuestion.id}-${Date.now()}`,
        status: result.status,
        passed: result.total_passed,
        total: result.total_tests,
        score: result.score,
        max_score: result.max_score,
        created_at: new Date().toISOString(),
        results: [],
        public_results: result.public_results,
        hidden_results: result.hidden_results,
        hidden_summary: result.hidden_summary,
      }

      setSubmissionHistory((prev) => {
        const questionId = currentQuestion.id
        const existing = prev[questionId] || []
        const updated = [historyEntry, ...existing].slice(0, 5)
        return { ...prev, [questionId]: updated }
      })
      
      // Mark question as submitted (unlock next question)
      setSubmittedQuestions(prev => ({
        ...prev,
        [currentQuestion.id]: true
      }))
    } catch (error: any) {
      console.error('Submit error:', error)
      setOutput(prev => ({
        ...prev,
        [currentQuestion.id]: {
          stderr: error.response?.data?.detail || 'Failed to submit code',
          status: 'error'
        }
      }))
    } finally {
      setRunning(false)
    }
  }

  const handleReset = () => {
    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    // Handle SQL questions differently (case-insensitive check)
    if (currentQuestion.question_type?.toUpperCase() === 'SQL') {
      const starterQuery = currentQuestion.starter_query || '-- Write your SQL query here\n\nSELECT '
      setCode({ ...code, [currentQuestion.id]: starterQuery })
    } else {
      // Coding questions
      const currentLang = language[currentQuestion.id] || currentQuestion.languages[0] || 'python'
      let starterCode = ''
      if (currentQuestion.function_signature) {
        starterCode = generateBoilerplate(currentLang, currentQuestion)
      } else if (currentQuestion.starter_code && currentQuestion.starter_code[currentLang]) {
        starterCode = currentQuestion.starter_code[currentLang]
      } else {
        starterCode = generateBoilerplate(currentLang, currentQuestion)
      }
      setCode({ ...code, [currentQuestion.id]: starterCode })
    }
  }

  const handleLanguageChange = (newLang: string) => {
    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    const newLanguage = { ...language, [currentQuestion.id]: newLang }
    setLanguage(newLanguage)
    
    // Use userId in localStorage key to ensure code isolation between candidates
    if (testId && typeof testId === 'string' && userId) {
      const storageKey = `test_${testId}_${userId}_language`
      localStorage.setItem(storageKey, JSON.stringify(newLanguage))
    }
    
    let newStarterCode = ''
    if (currentQuestion.function_signature) {
      newStarterCode = generateBoilerplate(newLang, currentQuestion)
    } else if (currentQuestion.starter_code && currentQuestion.starter_code[newLang]) {
      newStarterCode = currentQuestion.starter_code[newLang]
    } else {
      newStarterCode = generateBoilerplate(newLang, currentQuestion)
    }
    
    const newCode = { ...code, [currentQuestion.id]: newStarterCode }
    setCode(newCode)
    
    // Use userId in localStorage key to ensure code isolation between candidates
    if (testId && typeof testId === 'string' && userId) {
      const storageKey = `test_${testId}_${userId}_code`
      localStorage.setItem(storageKey, JSON.stringify(newCode))
    }
  }

  // Auto-save code to localStorage (must be before early returns to follow Rules of Hooks)
  // Use userId in localStorage key to ensure code isolation between candidates
  useEffect(() => {
    if (testId && typeof testId === 'string' && userId && code && Object.keys(code).length > 0) {
      const timeoutId = setTimeout(() => {
        const storageKey = `test_${testId}_${userId}_code`
        localStorage.setItem(storageKey, JSON.stringify(code))
      }, 1000)
      
      return () => clearTimeout(timeoutId)
    }
  }, [code, testId, userId])

  // Early returns must come AFTER all hooks

  // Loading is based ONLY on questions length — as soon as we have any questions,
  // we render the main UI (test metadata can finish loading in the background).
  const isLoading = questions.length === 0
  
  // Show fullscreen prompt if needed (after refresh, before entering fullscreen)
  // This should appear before the editor UI
  if (showFullscreenPrompt && test && questions.length > 0) {
    return (
      <FullscreenPrompt
        isOpen={showFullscreenPrompt}
        onEnterFullscreen={handleEnterFullscreenFromPrompt}
        onFullscreenFailed={() => {
          console.error('[Fullscreen] Failed to enter fullscreen')
        }}
        candidateName={candidateName || undefined}
        isLoading={false}
      />
    )
  }
  
  // Debug logging
  if (typeof window !== 'undefined' && isLoading) {
    console.log('[Test Load] Loading state:', {
      checkingParams,
      hasToken: !!token,
      hasUserId: !!userId,
      hasTestId: !!testId,
      hasTest: !!test,
      isLoading,
      questionsLoading
    })
  }

  // Show pre-check mode message if applicable
  if (precheckMode && test) {
    const startTime = new Date(precheckMode.start_time)
    const now = new Date()
    const timeUntilStart = Math.max(0, Math.floor((startTime.getTime() - now.getTime()) / 1000))
    const minutes = Math.floor(timeUntilStart / 60)
    const seconds = timeUntilStart % 60
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="mb-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-slate-200 mb-2">Pre-Check Mode</h2>
            <p className="text-slate-400 mb-4">{precheckMode.message}</p>
            {timeUntilStart > 0 && (
              <div className="text-2xl font-bold text-blue-400 mb-2">
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </div>
            )}
            <p className="text-slate-500 text-sm">
              Please complete pre-checks (screen sharing, camera access) while waiting for the test to start.
            </p>
          </div>
          <p className="text-slate-600 text-xs mt-4">
            The test will automatically start when the start time is reached.
          </p>
        </div>
      </div>
    )
  }

  // If we have no questions yet, show loading screen
  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-slate-400">Loading questions...</p>
        </div>
      </div>
    )
  }
  
  // Create fallback test object if test data hasn't loaded yet (allows progressive rendering)
  const testForRender = test || {
    title: 'Test',
    description: '',
    timer_mode: 'GLOBAL' as const,
    duration_minutes: 60,
    question_ids: questions.map(q => q.id)
  }

  const currentQuestion = questions[currentQuestionIndex]
  const currentCode = code[currentQuestion.id] || currentQuestion.starter_code[language[currentQuestion.id] || 'python'] || ''
  const currentLang = language[currentQuestion.id] || currentQuestion.languages[0] || 'python'
  
  const availableLanguages = Object.keys(LANGUAGE_IDS) as string[]


  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-slate-950 overflow-hidden">
        {/* Proctoring Components */}
        <ViolationToast />
        <FullscreenWarningBanner
          isVisible={showFullscreenWarning}
          onEnterFullscreen={handleEnterFullscreenFromBanner}
        />
        {aiProctoringEnabled && (
          <WebcamPreview
            ref={thumbVideoRef}
            cameraOn={webcamLive}
            faceMeshStatus={faceMeshStatus}
            facesCount={displayedFacesCount}
          />
        )}
        

        <TimerBar
          timeRemaining={timer.timeRemaining} 
          totalTime={timer.totalTime}
          timerMode={testForRender?.timer_mode || 'GLOBAL'}
          currentQuestionTitle={currentQuestion?.title}
          questionTimeRemaining={currentQuestion ? timer.questionTimeRemaining[currentQuestion.id] : undefined}
          questionTotalTime={currentQuestion ? timer.questionTotalTime[currentQuestion.id] : undefined}
        />
        <div className="flex-1 overflow-y-auto">
          <QuestionSidebar
            testTitle={testForRender.title}
            questions={questions}
            currentQuestionIndex={currentQuestionIndex}
            onQuestionChange={handleQuestionChange}
            onSubmit={() => handleSubmit(false)}
            submitting={submitting}
            questionStatus={questionStatus}
            submittedQuestions={submittedQuestions}
            timerMode={testForRender?.timer_mode || 'GLOBAL'}
          />
          <div className="border-t border-slate-700">
            <QuestionTabs question={currentQuestion} />
          </div>
          <div className="border-t border-slate-700" style={{ minHeight: '400px' }} ref={editorRef}>
            {/* Conditionally render SQL or Coding editor based on question_type */}
            {currentQuestion.question_type?.toUpperCase() === 'SQL' ? (
              <SQLEditorContainer
                code={currentCode}
                question={currentQuestion as any}
                onCodeChange={(newCode) => setCode({ ...code, [currentQuestion.id]: newCode })}
                onRun={handleRun}
                onSubmit={handleCodeSubmit}
                onReset={handleReset}
                running={running}
                submitting={submitting}
                output={output[currentQuestion.id] || {}}
              />
            ) : (
              <EditorContainer
                code={currentCode}
                language={currentLang}
                languages={availableLanguages}
                starterCode={currentQuestion.starter_code}
                onCodeChange={(newCode) => setCode({ ...code, [currentQuestion.id]: newCode })}
                onLanguageChange={handleLanguageChange}
                onRun={handleRun}
                onSubmit={handleCodeSubmit}
                onReset={handleReset}
                running={running}
                submitting={submitting}
                submissions={submissionHistory[currentQuestion.id] || []}
                visibleTestcases={visibleTestcasesMap[currentQuestion.id] || []}
                output={output[currentQuestion.id] || {}}
                publicResults={publicResults[currentQuestion.id] || []}
                hiddenSummary={hiddenSummary?.[currentQuestion.id] || null}
              />
            )}
            {/* Next Question Banner - shows after question is submitted */}
            {submittedQuestions[currentQuestion.id] && currentQuestionIndex < questions.length - 1 && (
              <div className="bg-green-600/20 border-t border-green-500 p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-green-400">
                  <span className="text-lg">✅</span>
                  <span className="font-medium">Question submitted successfully!</span>
                </div>
                <button
                  onClick={() => handleQuestionChange(currentQuestionIndex + 1)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  Next Question →
                </button>
              </div>
            )}
            {/* Last Question Submitted Banner */}
            {submittedQuestions[currentQuestion.id] && currentQuestionIndex === questions.length - 1 && (
              <div className="bg-blue-600/20 border-t border-blue-500 p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-blue-400">
                  <span className="text-lg">🎉</span>
                  <span className="font-medium">All questions submitted! Ready to finish the test.</span>
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    console.log('[Submit] Button clicked')
                    handleSubmit(false)
                  }}
                  disabled={submitting || !testId || !userId}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  {submitting ? 'Submitting...' : 'Submit Test'}
                </button>
              </div>
            )}
          </div>
          {/* Output Console - only shown for coding questions (SQL has it integrated) */}
          {currentQuestion.question_type?.toUpperCase() !== 'SQL' && (
            <div className="border-t border-slate-700">
              <OutputConsole
                stdout={output[currentQuestion.id]?.stdout}
                stderr={output[currentQuestion.id]?.stderr}
                compileOutput={output[currentQuestion.id]?.compileOutput}
                status={output[currentQuestion.id]?.status}
                time={output[currentQuestion.id]?.time}
                memory={output[currentQuestion.id]?.memory}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 overflow-hidden">
      {/* Proctoring Components */}
      <ViolationToast />
      <FullscreenWarningBanner
        isVisible={showFullscreenWarning}
        onEnterFullscreen={handleEnterFullscreenFromBanner}
      />
      {aiProctoringEnabled && (
        <>
          <WebcamPreview
            ref={thumbVideoRef}
            cameraOn={webcamLive}
            faceMeshStatus={faceMeshStatus}
            facesCount={displayedFacesCount}
          />
          {/* If camera fails to start, surface the reason (permissions/device busy) */}
          {faceMeshStatus === 'error' ? (
            <div
              style={{
                position: "fixed",
                bottom: 148,
                right: 16,
                width: 260,
                background: "rgba(0,0,0,0.75)",
                color: "#fff",
                padding: "8px 10px",
                borderRadius: 8,
                zIndex: 9999,
                fontSize: 12,
                lineHeight: 1.3,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Camera error</div>
              <div>FaceMesh model failed to load</div>
            </div>
          ) : null}
        </>
      )}
      

      <TimerBar 
        timeRemaining={timer.timeRemaining} 
        totalTime={timer.totalTime}
        timerMode={test?.timer_mode || 'GLOBAL'}
        currentQuestionTitle={currentQuestion?.title}
        questionTimeRemaining={currentQuestion ? timer.questionTimeRemaining[currentQuestion.id] : undefined}
        questionTotalTime={currentQuestion ? timer.questionTotalTime[currentQuestion.id] : undefined}
      />

      {/* Expired Test Message */}
      {timer.isExpired && 
       test?.timer_mode === 'GLOBAL' && 
       testSubmission?.started_at && 
       timer.timeRemaining === 0 &&
       timer.totalTime > 0 && (
        <div className="bg-red-900/50 border-b border-red-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-red-300 font-semibold">Test Time Has Expired</p>
              <p className="text-red-400 text-sm">The allocated time for this test has ended. Please submit your test now.</p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              console.log('[Submit] Button clicked (expired timer)')
              handleSubmit(false)
            }}
            disabled={submitting || !testId || !userId}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
          >
            {submitting ? 'Submitting...' : 'Submit Test'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <Split
          className="flex h-full"
          direction="horizontal"
          minSize={[200, 300, 400]}
          sizes={[20, 35, 45]}
          gutterSize={4}
          gutterStyle={() => ({
            backgroundColor: '#1e293b',
            cursor: 'col-resize',
          })}
        >
          <div className="h-full overflow-hidden">
            <QuestionSidebar
              testTitle={testForRender.title}
              questions={questions}
              currentQuestionIndex={currentQuestionIndex}
              onQuestionChange={handleQuestionChange}
              onSubmit={() => handleSubmit(false)}
              submitting={submitting}
              questionStatus={questionStatus}
              submittedQuestions={submittedQuestions}
              timerMode={testForRender?.timer_mode || 'GLOBAL'}
            />
          </div>

          <div className="h-full overflow-hidden">
            <QuestionTabs question={currentQuestion} />
          </div>

          <div className="h-full overflow-hidden bg-slate-950 flex flex-col" ref={editorRef}>
            {/* Conditionally render SQL or Coding editor based on question_type */}
            <div className="flex-1 overflow-hidden">
              {currentQuestion.question_type?.toUpperCase() === 'SQL' ? (
                <SQLEditorContainer
                  code={currentCode}
                  question={currentQuestion as any}
                  onCodeChange={(newCode) => {
                    const updatedCode = { ...code, [currentQuestion.id]: newCode }
                    setCode(updatedCode)
                  }}
                  onRun={handleRun}
                  onSubmit={handleCodeSubmit}
                  onReset={handleReset}
                  running={running}
                  submitting={submitting}
                  output={output[currentQuestion.id] || {}}
                />
              ) : (
                <EditorContainer
                  code={currentCode}
                  language={currentLang}
                  languages={availableLanguages}
                  starterCode={currentQuestion.starter_code}
                  onCodeChange={(newCode) => {
                    const updatedCode = { ...code, [currentQuestion.id]: newCode }
                    setCode(updatedCode)
                  }}
                  onLanguageChange={handleLanguageChange}
                  onRun={handleRun}
                  onSubmit={handleCodeSubmit}
                  onReset={handleReset}
                  running={running}
                  submitting={submitting}
                  submissions={submissionHistory[currentQuestion.id] || []}
                  visibleTestcases={visibleTestcasesMap[currentQuestion.id] || []}
                  output={output[currentQuestion.id] || {}}
                  publicResults={publicResults[currentQuestion.id] || []}
                  hiddenSummary={hiddenSummary?.[currentQuestion.id] || null}
                />
              )}
            </div>
            {/* Next Question Banner - shows after question is submitted */}
            {submittedQuestions[currentQuestion.id] && currentQuestionIndex < questions.length - 1 && (
              <div className="bg-green-600/20 border-t border-green-500 p-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 text-green-400">
                  <span>✅</span>
                  <span className="font-medium text-sm">Question submitted!</span>
                </div>
                <button
                  onClick={() => handleQuestionChange(currentQuestionIndex + 1)}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded transition-colors"
                >
                  Next Question →
                </button>
              </div>
            )}
            {submittedQuestions[currentQuestion.id] && currentQuestionIndex === questions.length - 1 && (
              <div className="bg-blue-600/20 border-t border-blue-500 p-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 text-blue-400">
                  <span>🎉</span>
                  <span className="font-medium text-sm">All done!</span>
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    console.log('[Submit] Button clicked (mobile)')
                    handleSubmit(false)
                  }}
                  disabled={submitting || !testId || !userId}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  {submitting ? 'Submitting...' : 'Submit Test'}
                </button>
              </div>
            )}
          </div>
        </Split>
      </div>
    </div>
  )
}

