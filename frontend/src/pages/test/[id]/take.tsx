'use client'

import { useEffect, useState, useRef } from 'react'
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
import { useProctor } from '../../../hooks/useProctor'
import { useCameraProctor } from '../../../hooks/useCameraProctor'
import { useLiveProctoring } from '../../../hooks/useLiveProctoring'
import { normalizeProctorConfig, useProctorEngine } from '@/proctoring'
import WebcamPreview from '@/components/WebcamPreview'
import { ViolationToast, pushViolationToast } from '@/components/ViolationToast'
import { useDSTimer } from '../../../hooks/useDSTimer'
import { 
  FullscreenWarningBanner, 
  ProctorDebugPanel,
  CameraProctorModal,
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
  // Default OFF; only explicit `proctoringSettings.aiProctoringEnabled === true` enables camera/model
  const [cameraProctorEnabled, setCameraProctorEnabled] = useState(false)
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false)
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false)
  const [tabSwitchCount, setTabSwitchCount] = useState(0)
  const [latestViolation, setLatestViolation] = useState<any>(null)
  const [debugMode, setDebugMode] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const cameraStartRequestedRef = useRef(false)
  const cameraStartedRef = useRef(false)

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
  
  // Proctoring settings (simplified - DSA tests may have different proctoring configs)
  const [proctoringSettings, setProctoringSettings] = useState<any>({
    enabled: true,
    multiFaceDetection: cameraProctorEnabled,
    fullscreenMonitoring: true,
    tabSwitchDetection: true,
  })

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

  // Enhanced proctoring with new hook
  // Use userId (from URL) as the primary identifier for proctoring
  // The backend expects userId to be the user_id (not email) for DSA tests
  // This ensures proctoring logs are correctly associated with the candidate
  const proctorUserId = userId || '' // Use userId from URL (user_id), not email
  const proctorAssessmentId = testId as string || ''
  
  // Debug logging for proctoring setup
  useEffect(() => {
    if (proctorUserId && proctorAssessmentId) {
      console.log('[Proctor Setup] Proctoring initialized:', {
        userId: proctorUserId,
        assessmentId: proctorAssessmentId,
        testId,
        candidateEmail
      })
    } else {
      console.warn('[Proctor Setup] Proctoring not initialized - missing userId or assessmentId:', {
        userId: proctorUserId,
        assessmentId: proctorAssessmentId,
        testId,
        candidateEmail
      })
    }
  }, [proctorUserId, proctorAssessmentId, testId, candidateEmail])
  
  const {
    isFullscreen,
    fullscreenRefused,
    violations,
    violationCount,
    recordViolation,
    requestFullscreen,
    exitFullscreen,
    setFullscreenRefused,
  } = useProctor({
    userId: proctorUserId,
    assessmentId: proctorAssessmentId,
    onViolation: (violation) => {
      setTabSwitchCount((prev) => prev + 1)
      setLatestViolation(violation)
      console.log('[Proctor] Violation recorded and will be sent to backend:', violation)

      // Candidate-side popup (same as AI take page)
      pushViolationToast({
        id: `${violation.eventType}-${Date.now()}`,
        eventType: violation.eventType,
        message: getViolationMessage(violation.eventType),
        timestamp: violation.timestamp || new Date().toISOString(),
      })
    },
    enableFullscreenDetection: true,
    enableDevToolsDetection: debugMode,
    debugMode,
  })

  // Camera-based proctoring hook
  const {
    isCameraOn,
    isModelLoaded,
    facesCount,
    lastViolation: lastCameraViolation,
    errors: cameraErrors,
    gazeDirection,
    isBlinking,
    startCamera,
    stopCamera,
    videoRef,
    canvasRef,
    debugInfo,
  } = useCameraProctor({
    userId: proctorUserId,
    assessmentId: proctorAssessmentId,
    onViolation: (violation) => {
      setTabSwitchCount((prev) => prev + 1)
      // Convert camera violation to proctor violation for unified display
      setLatestViolation({
        eventType: violation.eventType as any,
        timestamp: violation.timestamp,
        assessmentId: violation.assessmentId,
        userId: violation.userId,
        metadata: violation.metadata,
      })

      // Candidate-side popup (same as AI take page)
      pushViolationToast({
        id: `${violation.eventType}-${Date.now()}`,
        eventType: violation.eventType,
        message: getViolationMessage(violation.eventType),
        timestamp: violation.timestamp || new Date().toISOString(),
      })
    },
    enabled: cameraProctorEnabled,
    debugMode,
  })

  // Live Proctoring hook (webcam + screen streaming)
  const [liveProctorScreenStream, setLiveProctorScreenStream] = useState<MediaStream | null>(null);
  
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

  // Get webcam stream from useCameraProctor
  const webcamStreamForLiveProctor = isCameraOn && videoRef.current?.srcObject 
    ? (videoRef.current.srcObject as MediaStream)
    : null;

  const {
    isStreaming: isLiveProctoringStreaming,
    connectionState: liveProctoringConnectionState,
    error: liveProctoringError,
    sessionId: liveProctoringSessionId,
    startStreaming: startLiveProctoring,
    stopStreaming: stopLiveProctoring,
  } = useLiveProctoring({
    assessmentId: proctorAssessmentId,
    candidateId: candidateEmail || proctorUserId || '',
    enabled: proctoringSettings?.liveProctoringEnabled === true,
    preScreenStream: liveProctorScreenStream,
    onError: (error) => {
      console.error('[DSA Take] Live Proctoring error:', error);
    },
    debugMode,
  });

  // Start Live Proctoring when candidate clicks "Start Assessment" (when timer starts)
  useEffect(() => {
    if (timerStarted && proctoringSettings?.liveProctoringEnabled === true && liveProctorScreenStream && webcamStreamForLiveProctor) {
      console.log('[DSA Take] Starting Live Proctoring...');
      startLiveProctoring().catch(err => {
        console.error('[DSA Take] Failed to start Live Proctoring:', err);
      });
    }
  }, [timerStarted, proctoringSettings?.liveProctoringEnabled, liveProctorScreenStream, webcamStreamForLiveProctor, startLiveProctoring]);

  // Stop Live Proctoring when assessment ends
  useEffect(() => {
    if (submitted) {
      stopLiveProctoring();
    }
    return () => {
      if (submitted) {
        stopLiveProctoring();
      }
    };
  }, [submitted, stopLiveProctoring]);

  // Unified Proctoring Engine (works alongside existing hooks)
  const proctorConfig = normalizeProctorConfig(proctoringSettings)
  const referenceImageUrl = typeof window !== 'undefined' 
    ? sessionStorage.getItem(`referenceFace_${testId}`) || undefined
    : undefined
  
  const handleUnifiedViolation = (violationType: string, metadata?: Record<string, unknown>) => {
    setTabSwitchCount((prev) => prev + 1)
    console.log('[UnifiedProctor] Violation:', violationType, metadata)
    setLatestViolation({
      eventType: violationType as any,
      timestamp: new Date().toISOString(),
      assessmentId: proctorAssessmentId,
      userId: proctorUserId,
      metadata,
    })

    // Candidate-side popup (same as AI take page)
    pushViolationToast({
      id: `${violationType}-${Date.now()}`,
      eventType: violationType,
      message: getViolationMessage(violationType),
      timestamp: new Date().toISOString(),
    })
  }

  const unifiedProctor = useProctorEngine({
    assessmentId: proctorAssessmentId,
    candidateEmail: candidateEmail || proctorUserId || '',
    config: proctorConfig,
    referenceImageUrl: referenceImageUrl || undefined,
    onViolation: handleUnifiedViolation,
    videoElement: videoRef.current,
    canvasElement: canvasRef.current,
  })

  // Start unified proctor when test is ready
  useEffect(() => {
    if (test && questions.length > 0 && candidateEmail) {
      unifiedProctor.start()
      
    }
    
    return () => {
      unifiedProctor.stop()
    }
  }, [test, questions.length, candidateEmail, submitted, unifiedProctor])

  // Start camera AFTER test data is loaded AND editor is visible (not immediately on mount)
  // This prevents blocking the initial page load with heavy TensorFlow.js model loading
  useEffect(() => {
    // Only start camera if:
    // 1. Camera proctoring is enabled (from admin flag)
    // 2. We have user info
    // 3. Questions are loaded
    // 4. Test is in progress
    //
    // IMPORTANT: Start exactly once when conditions become true.
    // The old logic used a 2s timer and cleaned up on every re-render,
    // which repeatedly cancelled the timer before it fired (camera never started).
    const shouldRun = 
      cameraProctorEnabled &&
      (candidateEmail || userId) &&
      !!testId &&
      questions.length > 0

    if (shouldRun) {
      if (!cameraStartRequestedRef.current) {
        cameraStartRequestedRef.current = true
        console.log("[DSA Camera] startCamera() requested", { testId, candidateEmail, userId })
        startCamera()
          .then((ok) => {
            cameraStartedRef.current = ok
            console.log("[DSA Camera] startCamera() result", { ok })
          })
          .catch((e) => {
            cameraStartedRef.current = false
            console.error("[DSA Camera] startCamera() threw", e)
          })
      }
    } else {
      // If conditions are no longer true, stop camera once (if it was started/requested)
      if (cameraStartRequestedRef.current || cameraStartedRef.current) {
        console.log("[DSA Camera] stopping camera (conditions false)")
        stopCamera()
      }
      cameraStartRequestedRef.current = false
      cameraStartedRef.current = false
    }
  }, [cameraProctorEnabled, candidateEmail, userId, testId, questions.length, startCamera, stopCamera])

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

  // Handle fullscreen entry from prompt
  const handleEnterFullscreenFromPrompt = async () => {
    try {
      console.log('[Fullscreen] User clicked Enter Fullscreen button')
      let success = false
      
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
        success = true
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        await (document.documentElement as any).webkitRequestFullscreen()
        success = true
      } else if ((document.documentElement as any).mozRequestFullScreen) {
        await (document.documentElement as any).mozRequestFullScreen()
        success = true
      } else if ((document.documentElement as any).msRequestFullscreen) {
        await (document.documentElement as any).msRequestFullscreen()
        success = true
      }
      
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

          const aiEnabled = testData?.proctoringSettings?.aiProctoringEnabled === true
          setCameraProctorEnabled(aiEnabled)
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
        {/* Hidden canvas used by useCameraProctor to capture snapshots */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <FullscreenWarningBanner
          isVisible={showFullscreenWarning}
          onEnterFullscreen={handleEnterFullscreenFromBanner}
        />
        {cameraProctorEnabled && (
          <WebcamPreview
            ref={videoRef}
            cameraOn={isCameraOn}
            faceMeshStatus={cameraErrors?.length ? "error" : isModelLoaded ? "loaded" : "loading"}
            facesCount={facesCount}
          />
        )}
        
        {debugMode && (
          <ProctorDebugPanel
            isVisible={debugMode}
            violations={violations}
            isFullscreen={isFullscreen}
            fullscreenRefused={fullscreenRefused}
            onSimulateTabSwitch={() => {}}
            onSimulateFullscreenExit={() => {}}
            onRequestFullscreen={requestFullscreen}
            onExitFullscreen={exitFullscreen}
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
      {/* Hidden canvas used by useCameraProctor to capture snapshots */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <FullscreenWarningBanner
        isVisible={showFullscreenWarning}
        onEnterFullscreen={handleEnterFullscreenFromBanner}
      />
      {cameraProctorEnabled && (
        <>
          <WebcamPreview
            ref={videoRef}
            cameraOn={isCameraOn}
            faceMeshStatus={cameraErrors?.length ? "error" : isModelLoaded ? "loaded" : "loading"}
            facesCount={facesCount}
          />
          {/* If camera fails to start, surface the reason (permissions/device busy) */}
          {cameraErrors?.length ? (
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
              <div>{cameraErrors[cameraErrors.length - 1]}</div>
            </div>
          ) : null}
        </>
      )}
      
      {debugMode && (
        <ProctorDebugPanel
          isVisible={debugMode}
          violations={violations}
          isFullscreen={isFullscreen}
          fullscreenRefused={fullscreenRefused}
          onSimulateTabSwitch={() => {}}
          onSimulateFullscreenExit={() => {}}
          onRequestFullscreen={requestFullscreen}
          onExitFullscreen={exitFullscreen}
        />
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

