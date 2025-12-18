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
import { normalizeProctorConfig, useProctorEngine } from '@/proctoring'
import WebcamPreview from '@/components/WebcamPreview'
import { ViolationToast, pushViolationToast } from '@/components/ViolationToast'
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
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [totalTime, setTotalTime] = useState(0)
  
  // Per-question timer state (for PER_QUESTION mode)
  const [questionTimeRemaining, setQuestionTimeRemaining] = useState<Record<string, number>>({})
  const [questionTotalTime, setQuestionTotalTime] = useState<Record<string, number>>({})
  const [activeQuestionTimer, setActiveQuestionTimer] = useState<string | null>(null)
  
  // Sequential question progression state
  const [submittedQuestions, setSubmittedQuestions] = useState<Record<string, boolean>>({})
  const [questionTimerStarted, setQuestionTimerStarted] = useState<Record<string, boolean>>({})
  
  const [testSubmission, setTestSubmission] = useState<any>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkingParams, setCheckingParams] = useState(true)
  const [running, setRunning] = useState(false)
  const [editorVisible, setEditorVisible] = useState(false)
  const [timerStarted, setTimerStarted] = useState(false)
  const [candidateEmail, setCandidateEmail] = useState<string | null>(null)
  const [candidateName, setCandidateName] = useState<string | null>(null)
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
  const fetchDataRef = useRef(false) // Prevent multiple fetches
  const pageLoadTimeRef = useRef<number | null>(null) // Track when page started loading

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
    if (test && questions.length > 0 && candidateEmail && !submitted) {
      unifiedProctor.start()
    }
    
    return () => {
      unifiedProctor.stop()
    }
  }, [test, questions.length, candidateEmail, submitted])

  // Start camera AFTER test data is loaded AND editor is visible (not immediately on mount)
  // This prevents blocking the initial page load with heavy TensorFlow.js model loading
  useEffect(() => {
    // Only start camera if:
    // 1. Camera proctoring is enabled (from admin flag)
    // 2. We have user info
    // 3. Questions are loaded
    // 4. Test is not submitted
    //
    // IMPORTANT: Start exactly once when conditions become true.
    // The old logic used a 2s timer and cleaned up on every re-render,
    // which repeatedly cancelled the timer before it fired (camera never started).
    const shouldRun =
      cameraProctorEnabled &&
      (candidateEmail || userId) &&
      !!testId &&
      questions.length > 0 &&
      !submitted

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
  }, [cameraProctorEnabled, candidateEmail, userId, testId, questions.length, submitted, startCamera, stopCamera])

  // Check if fullscreen was refused
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const fullscreenAccepted = sessionStorage.getItem('fullscreenAccepted')
      setShowFullscreenWarning(fullscreenAccepted === 'false')
    }
  }, [])

  // Auto-refresh once immediately when page loads, then show fullscreen prompt after refresh
  // Flow: Load page -> Auto-refresh immediately -> After refresh, show fullscreen prompt -> User clicks -> Enter fullscreen -> Start timer
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if we should be in fullscreen (coming from instructions page)
    const shouldBeFullscreen = sessionStorage.getItem('shouldStartTest') === 'true'
    const hasRefreshed = sessionStorage.getItem('fullscreenRefreshed') === 'true'
    
    if (shouldBeFullscreen && !hasRefreshed) {
      // Auto-refresh immediately without waiting for data to load
      console.log('[Fullscreen] Auto-refreshing immediately before showing fullscreen prompt...')
      // Mark that we've refreshed to prevent infinite refresh loop
      sessionStorage.setItem('fullscreenRefreshed', 'true')
      // Refresh immediately (or with minimal delay to ensure sessionStorage is set)
      setTimeout(() => {
        window.location.reload()
      }, 100)
      return
    } else if ((shouldBeFullscreen || hasRefreshed) && hasRefreshed) {
      // After refresh, show fullscreen prompt when test and questions are loaded
      // Use hasRefreshed as the primary indicator (backup to shouldBeFullscreen)
      // Use a small delay to ensure state is ready
      const checkAndShowPrompt = () => {
        if (test && questions.length > 0 && !submitted) {
          // Check if already in fullscreen (shouldn't be after refresh)
          const isFullscreen = !!document.fullscreenElement || 
                              !!(document as any).webkitFullscreenElement ||
                              !!(document as any).mozFullScreenElement ||
                              !!(document as any).msFullscreenElement
          
          if (!isFullscreen && !showFullscreenPrompt) {
            // Show fullscreen prompt immediately
            setShowFullscreenPrompt(true)
            console.log('[Fullscreen] Showing fullscreen prompt after refresh', { 
              hasTest: !!test, 
              questionsCount: questions.length,
              submitted,
              isFullscreen,
              shouldBeFullscreen,
              hasRefreshed
            })
          }
        }
      }
      
      // Check immediately and also after a short delay
      checkAndShowPrompt()
      setTimeout(checkAndShowPrompt, 200)
    }
  }, [submitted, test, questions.length, showFullscreenPrompt])

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
  useEffect(() => {
    if (submitted) return

    const shouldBeFullscreen = sessionStorage.getItem('shouldStartTest') === 'true'
    if (!shouldBeFullscreen) return

    const handleFullscreenExit = () => {
      const isFullscreen = !!document.fullscreenElement || 
                          !!(document as any).webkitFullscreenElement ||
                          !!(document as any).mozFullScreenElement ||
                          !!(document as any).msFullscreenElement
      
      // If fullscreen is exited and test hasn't been submitted, show warning
      if (!isFullscreen && !submitted) {
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
  }, [submitted])

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

  // Debug logging for timer values (must be before any early returns)
  useEffect(() => {
    if (timerStarted && test) {
      console.log('[Timer Debug] Current values:', {
        timeRemaining,
        totalTime,
        percentage: totalTime > 0 ? (timeRemaining / totalTime) * 100 : 0
      })
    }
  }, [timerStarted, timeRemaining, totalTime, test])

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

  useEffect(() => {
    console.log('[Test Load] useEffect triggered', { testId, token: token ? 'present' : 'missing', userId, fetchDataRef: fetchDataRef.current })
    
    if (!testId || typeof testId !== 'string' || !token || !userId) {
      console.log('[Test Load] Missing required params, setting checkingParams to false')
      setCheckingParams(false)
      return
    }
    if (fetchDataRef.current) {
      console.log('[Test Load] Fetch already in progress, skipping')
      return // Prevent multiple fetches
    }
    fetchDataRef.current = true
    console.log('[Test Load] Starting fetch...')
    
    // Record when page started loading to prevent premature auto-submit
    pageLoadTimeRef.current = Date.now()

    let isMounted = true

    const fetchTestData = async () => {
      try {
        console.log('[Test Load] Starting data fetch...', { testId, userId, token: token ? 'present' : 'missing' })
        
        // Set checkingParams to false once we start fetching (params are valid)
        // This allows the page to render while data is loading
        if (isMounted) {
          setCheckingParams(false)
          console.log('[Test Load] Params validated, starting data fetch')
        }
        
        // Check if we need to start the test (from instructions page)
        const shouldStartTest = sessionStorage.getItem("shouldStartTest") === "true"
        let submissionData = null

        const handleStartForbidden = (err: any) => {
          const detail =
            err?.response?.data?.detail ||
            err?.response?.data?.message ||
            'You are not allowed to start this test right now.'
          console.error('[Test Load] Start forbidden:', err?.response?.status, detail)
          // Prevent retry loop
          fetchDataRef.current = false
          sessionStorage.removeItem("shouldStartTest")
          if (isMounted) {
            setCheckingParams(false)
            alert(detail)
            // Go back to entry flow (precheck / instructions) with token
            router.replace(`/test/${testId}?token=${encodeURIComponent(String(token))}`)
          }
        }
        
        console.log('[Test Load] shouldStartTest:', shouldStartTest)
        
        if (shouldStartTest) {
          // Start the test now (this sets started_at in backend)
          // BUT timer will only start when fullscreen is entered and editor is visible
          try {
            console.log('[Test Load] Starting test session...')
            const startRes = await dsaApi.post(`/tests/${testId}/start?user_id=${userId}`)
            submissionData = {
              started_at: startRes.data.started_at,
              is_completed: false
            }
            // Don't remove shouldStartTest yet - need it for fullscreen prompt after refresh
            // It will be removed when fullscreen is entered
            console.log('[Test Load] Test session started - timer will begin when fullscreen is entered and editor is visible', submissionData)
          } catch (error: any) {
            console.error('[Test Load] Error starting test:', error)
            if (error?.response?.status === 403) {
              handleStartForbidden(error)
              return
            }
            // Try to get existing submission
            try {
              const subRes = await dsaApi.get(`/tests/${testId}/submission?user_id=${userId}`)
              submissionData = subRes.data
              console.log('[Test Load] Retrieved existing submission:', submissionData)
            } catch (e) {
              console.error('[Test Load] Error fetching submission:', e)
            }
          }
        } else {
          // Get existing submission
          try {
            console.log('[Test Load] Fetching existing submission...')
            const subRes = await dsaApi.get(`/tests/${testId}/submission?user_id=${userId}`)
            submissionData = subRes.data
            console.log('[Test Load] Retrieved existing submission:', submissionData)
            
            // Check if candidate has already submitted - prevent multiple attempts
            if (submissionData.is_completed) {
              if (isMounted) {
                alert('You have already submitted this test. You cannot attempt it again.')
                router.push('/dashboard')
              }
              return
            }
            
            // Check if candidate has already run code or submitted (has submissions)
            // If they have submissions, they've already started - allow continuation
            const hasSubmissions = submissionData.submissions && submissionData.submissions.length > 0
            if (hasSubmissions) {
              console.log('[Test Load] Candidate has existing submissions, allowing continuation')
            }
          } catch (error: any) {
            console.log('[Test Load] Submission fetch error:', error.response?.status, error.message)
            if (error.response?.status === 404) {
              // No submission exists - start the test
              try {
                console.log('[Test Load] No submission found, starting test...')
                const startRes = await dsaApi.post(`/tests/${testId}/start?user_id=${userId}`)
                submissionData = {
                  started_at: startRes.data.started_at,
                  is_completed: false,
                  submissions: []
                }
                console.log('[Test Load] Test started (no existing submission) - timer begins now', submissionData)
              } catch (e: any) {
                console.error('[Test Load] Error starting test:', e.response?.status, e.message)
                if (e?.response?.status === 403) {
                  handleStartForbidden(e)
                  return
                }
                if (isMounted) {
                  alert('Failed to start test. Please try again.')
                  router.push('/dashboard')
                }
              }
            } else {
              console.error('[Test Load] Unexpected error fetching submission:', error)
              if (isMounted) {
                alert('Error loading test. Please try again.')
                router.push('/dashboard')
              }
            }
          }
        }
        
        // Fetch test data (use public endpoint for candidates)
        console.log('[Test Load] Fetching test data...')
        const testRes = await dsaApi.get(`/tests/${testId}/public?user_id=${userId}`)
        const testData = testRes.data
        console.log('[Test Load] Test data fetched:', { 
          id: testData.id, 
          title: testData.title, 
          questionCount: testData.question_ids?.length 
        })
        
        if (!submissionData) {
          console.error('[Test Load] No submission data available')
          if (isMounted) {
            alert('Error: Could not start or retrieve test session. Please refresh the page.')
            setCheckingParams(false)
          }
          return
        }
        
        if (!testData) {
          console.error('[Test Load] No test data available')
          if (isMounted) {
            alert('Error: Could not load test data. Please refresh the page.')
            setCheckingParams(false)
          }
          return
        }

        if (isMounted) {
          setTest(testData)
          setTestSubmission(submissionData)

          // Apply runtime camera toggle based on admin proctoring setting:
          // Only explicit true enables camera/model; missing/false => OFF (per PROCTORING_AI_TOGGLE_NOTES.md)
          const aiEnabled = testData?.proctoringSettings?.aiProctoringEnabled === true
          setCameraProctorEnabled(aiEnabled)
        }

        // Check if candidate has already submitted - prevent multiple attempts
        if (submissionData.is_completed) {
          if (isMounted) {
            setSubmitted(true)
            alert('You have already submitted this test. You cannot attempt it again.')
            router.push('/dashboard')
          }
          return
        }
        
        // Check if candidate has already started the test (has submissions)
        // If they have submissions but haven't completed, allow them to continue
        // But prevent starting a new attempt if they've already run code or submitted
        const hasExistingSubmissions = submissionData.submissions && submissionData.submissions.length > 0
        if (hasExistingSubmissions && !submissionData.is_completed) {
          // Allow them to continue their existing attempt
          console.log('[Test Load] Candidate has existing submissions, allowing continuation')
        }

        // Calculate remaining time
        const startedAtStr = submissionData.started_at
        if (!startedAtStr) {
          console.error('[Timer] No started_at timestamp found')
          if (isMounted) {
            alert('Error: Test start time not found. Please refresh the page.')
          }
          return
        }
        
        const startedAt = new Date(startedAtStr)
        if (isNaN(startedAt.getTime())) {
          console.error('[Timer] Invalid started_at timestamp:', startedAtStr)
          if (isMounted) {
            alert('Error: Invalid test start time. Please contact support.')
          }
          return
        }
        
        // Calculate remaining time based on when test was started in backend
        const durationMs = testData.duration_minutes * 60 * 1000
        const endTime = new Date(startedAt.getTime() + durationMs)
        const now = new Date()
        const rawRemaining = Math.floor((endTime.getTime() - now.getTime()) / 1000)
        
        // Calculate remaining time (can be negative if expired)
        // We'll handle expired timers when editor becomes visible
        const remaining = Math.max(0, rawRemaining)
        const totalSeconds = testData.duration_minutes * 60
        
        // Log for debugging
        console.log('[Timer] Calculation:', {
          startedAt: startedAtStr,
          startedAtDate: startedAt.toISOString(),
          durationMinutes: testData.duration_minutes,
          durationSeconds: totalSeconds,
          endTime: endTime.toISOString(),
          now: now.toISOString(),
          rawRemaining,
          remaining,
          totalSeconds
        })
        
        if (rawRemaining < 0) {
          const expiredBy = Math.abs(rawRemaining)
          console.warn(`[Timer] Test expired ${expiredBy}s ago (${Math.round(expiredBy/60)} minutes). Will wait for editor to be visible before auto-submitting.`)
        } else {
          console.log(`[Timer] ${remaining}s (${Math.round(remaining/60)} minutes) remaining out of ${totalSeconds}s total`)
        }
        
        // Test window (start_time/end_time) is informational only - backend allows access regardless
        // Don't block page load based on test window - just log for reference
        const testEndTime = testData.end_time ? new Date(testData.end_time) : null
        const testStartTime = testData.start_time ? new Date(testData.start_time) : null
        
        // Log test window info (non-blocking)
        if (testEndTime && now > testEndTime) {
          console.info('Test end time window has passed, but access is still allowed')
        }
        if (testStartTime && now < testStartTime) {
          console.info('Test start time window has not yet arrived, but access is still allowed')
        }
        
        if (isMounted) {
          // Always set timer values, even if 0 (so UI can display correctly)
          setTimeRemaining(remaining)
          setTotalTime(totalSeconds)
          console.log(`[Timer] State updated: timeRemaining=${remaining}, totalTime=${totalSeconds}`)
          
          // Don't auto-submit here - wait until questions are loaded
          // The timer will handle auto-submission once questions are available
        }

        // Set test data immediately so UI can show test info while questions load
        if (isMounted) {
          setTest(testData)
        }
        
        // Fetch all questions in parallel for much faster loading
        // Preload Monaco Editor early (non-blocking) - start loading immediately
        if (typeof window !== 'undefined') {
          import('@monaco-editor/react').catch(() => {
            // Ignore errors - will load when needed
          })
        }
        
        // Set loading state for questions
        if (isMounted) {
          setQuestionsLoading(true)
        }
        
        // Fetch all questions in parallel with timeout (reduced to 3 seconds for faster failure)
        // Use the public test question endpoint (no auth required, uses user_id)
        const questionPromises = testData.question_ids.map(async (qId: string) => {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout per question
            
            try {
              // Use public endpoint for test questions (includes SQL-specific fields)
              const response = await dsaApi.get(`/tests/${testId}/question/${qId}?user_id=${userId}`, {
                signal: controller.signal
              })
              clearTimeout(timeoutId)
              return response.data
            } catch (fetchError: any) {
              clearTimeout(timeoutId)
              if (fetchError.name === 'AbortError' || fetchError.code === 'ECONNABORTED') {
                console.warn(`Question ${qId} request timed out after 5 seconds`)
                return null
              }
              if (fetchError.response?.status === 404) {
                console.warn(`Question ${qId} not found (404)`)
                return null
              }
              throw fetchError
            }
          } catch (error: any) {
            console.warn(`Question ${qId} fetch error:`, error.message)
            return null
          }
        })
        
        // Wait for all questions to load (or timeout) - this is much faster than sequential
        const questionResults = await Promise.all(questionPromises)
        const questionsData = questionResults.filter((q): q is Question => q !== null)
        
        // Clear loading state
        if (isMounted) {
          setQuestionsLoading(false)
        }
        
        // After all questions are loaded (or failed), update the full state
        // Check if we have any valid questions
        if (questionsData.length === 0) {
          if (isMounted) {
            alert('This test has no valid questions. Please contact the administrator.')
            router.push('/dashboard')
          }
          return
        }
        
        // Log if some questions were missing (for debugging)
        const missingCount = testData.question_ids.length - questionsData.length
        if (missingCount > 0 && isMounted) {
          console.warn(`${missingCount} question(s) were not found and have been skipped`)
        }
        
        // Update state with all loaded questions
        if (isMounted) {
          // Set questions immediately
          setQuestions(questionsData)
          
          // Initialize visible testcases for all questions
          const visibleMap: Record<string, VisibleTestcase[]> = {}
          questionsData.forEach((q) => {
            visibleMap[q.id] =
              q.public_testcases?.map((tc: { input: string; expected_output: string }, idx: number) => ({
                id: `${q.id}-public-${idx}`,
                input: tc.input,
                expected: tc.expected_output,
              })) || []
          })
          setVisibleTestcasesMap(visibleMap)
          
          // Initialize per-question timers if timer_mode is PER_QUESTION
          if (testData.timer_mode === 'PER_QUESTION' && testData.question_timings) {
            const qTimeRemaining: Record<string, number> = {}
            const qTotalTime: Record<string, number> = {}
            
            // Initialize all questions with their full duration (from admin settings)
            testData.question_timings.forEach((timing: QuestionTiming) => {
              const durationSeconds = timing.duration_minutes * 60
              qTimeRemaining[timing.question_id] = durationSeconds
              qTotalTime[timing.question_id] = durationSeconds
            })
            
            // Note: We don't load saved timers on initialization
            // Each question will start from full duration when entered
            // Timer state is saved as it counts down, but restored only for active questions
            
            setQuestionTimeRemaining(qTimeRemaining)
            setQuestionTotalTime(qTotalTime)
            
            // Set the first question as active and mark its timer as started
            // First question starts immediately with full duration
            if (questionsData.length > 0) {
              const firstQuestionId = questionsData[0].id
              setActiveQuestionTimer(firstQuestionId)
              setQuestionTimerStarted(prev => ({
                ...prev,
                [firstQuestionId]: true
              }))
              // Ensure first question has full duration
              if (qTotalTime[firstQuestionId] !== undefined) {
                setQuestionTimeRemaining(prev => ({
                  ...prev,
                  [firstQuestionId]: qTotalTime[firstQuestionId]
                }))
              }
            }
            
            console.log('[Timer] Initialized per-question timers with full durations:', qTimeRemaining)
            console.log('[Timer] Total times:', qTotalTime)
          }
          
          // Initialize code and language for all questions
          const initialCode: Record<string, string> = {}
          const initialLanguage: Record<string, string> = {}
          questionsData.forEach((q: Question) => {
            // Handle SQL questions differently (case-insensitive check)
            if (q.question_type?.toUpperCase() === 'SQL') {
              initialCode[q.id] = q.starter_query || '-- Write your SQL query here\n\nSELECT '
              initialLanguage[q.id] = 'sql'
            } else {
              // Coding questions
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
          
          // Use userId in localStorage key to ensure code isolation between candidates
          const storageKeyCode = userId ? `test_${testId}_${userId}_code` : `test_${testId}_code`
          const storageKeyLanguage = userId ? `test_${testId}_${userId}_language` : `test_${testId}_language`
          
          const savedCode = localStorage.getItem(storageKeyCode)
          const savedLanguage = localStorage.getItem(storageKeyLanguage)
          
          if (savedCode) {
            try {
              const parsedCode = JSON.parse(savedCode)
              setCode({ ...initialCode, ...parsedCode })
            } catch {
              setCode(initialCode)
            }
          } else {
            setCode(initialCode)
          }
          
          if (savedLanguage) {
            try {
              const parsedLanguage = JSON.parse(savedLanguage)
              setLanguage({ ...initialLanguage, ...parsedLanguage })
            } catch {
              setLanguage(initialLanguage)
            }
          } else {
            setLanguage(initialLanguage)
          }
        }
        
        if (isMounted) {
          const now = new Date().toISOString()
          setTestStartedAt(now)
          if (questionsData.length > 0) {
            setQuestionStartTimes({ [questionsData[0].id]: now })
          }
          
          // Now check if time has expired AFTER questions are loaded
          // Recalculate remaining time to ensure accuracy
          const startedAtStr = submissionData.started_at
          if (startedAtStr) {
            const startedAt = new Date(startedAtStr)
            
            // Validate started_at is a valid date
            if (isNaN(startedAt.getTime())) {
              console.error('Invalid started_at timestamp:', startedAtStr)
              if (isMounted) {
                alert('Error: Invalid test start time. Please contact support.')
              }
              return
            }
            
            const durationMs = testData.duration_minutes * 60 * 1000
            const endTime = new Date(startedAt.getTime() + durationMs)
            const currentTime = new Date()
            const timeRemaining = Math.max(0, Math.floor((endTime.getTime() - currentTime.getTime()) / 1000))
            
            // Test window (start_time/end_time) is informational only - don't block auto-submit based on it
            // Timer is based on when candidate started the test, not the test window
            // IMPORTANT: Don't auto-submit here - wait for editor to be visible
            // The timer will only start counting (and auto-submit) when editor becomes visible
            if (isMounted) {
              // Always update timer with calculated remaining time
              // Also update totalTime if not set
              setTimeRemaining(timeRemaining)
              if (!totalTime || totalTime === 0) {
                setTotalTime(testData.duration_minutes * 60)
                console.log(`[Timer] Total time set: ${testData.duration_minutes} minutes (${testData.duration_minutes * 60}s)`)
              }
              
              // Log for debugging
              console.log(`[Timer] After questions loaded - timeRemaining: ${timeRemaining}s, totalTime: ${totalTime || testData.duration_minutes * 60}s`)
              if (timeRemaining <= 0) {
                console.warn(`[Timer] Timer shows expired (${timeRemaining}s), but waiting for editor to be visible before auto-submitting`)
              } else {
                console.log(`[Timer] Timer initialized with ${timeRemaining}s remaining out of ${totalTime || testData.duration_minutes * 60}s total`)
              }
            }
          }
        }

        // Code and language initialization is now handled above for progressive loading
      } catch (error: any) {
        console.error('[Test Load] Error fetching test data:', error)
        console.error('[Test Load] Error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          message: error.message,
          url: error.config?.url,
          method: error.config?.method,
          data: error.response?.data
        })
        
        if (isMounted) {
          setCheckingParams(false) // Ensure we stop showing loading
        }
        
        // Only try to start test if submission doesn't exist (404 on submission)
        // Don't reload if it's just a question fetch error
        if (error.response?.status === 404 && error.config?.url?.includes('/submission')) {
          console.log('[Test Load] Submission 404, attempting to start test...')
          try {
            const startRes = await dsaApi.post(`/tests/${testId}/start?user_id=${userId}`)
            console.log('[Test Load] Test started after 404, reloading...')
            if (isMounted) {
              // Reset fetchDataRef to allow retry
              fetchDataRef.current = false
              // Reload only once, not in a loop
              setTimeout(() => {
                window.location.reload()
              }, 500)
            }
          } catch (err: any) {
            console.error('[Test Load] Error starting test:', err)
            if (isMounted) {
              setCheckingParams(false)
              alert(`Failed to start test: ${err.response?.data?.detail || err.message || 'Unknown error'}. Please contact support.`)
            }
          }
        } else if (error.response?.status === 404 && error.config?.url?.includes('/tests/')) {
          // Test not found
          console.error('[Test Load] Test not found (404)')
          if (isMounted) {
            setCheckingParams(false)
            alert('Test not found. Please check the test link.')
            router.push('/dashboard')
          }
        } else {
          // Other errors - show message but don't reload
          console.error('[Test Load] Unexpected error:', error)
          if (isMounted) {
            setCheckingParams(false)
            const errorMsg = error.response?.data?.detail || error.message || 'Error loading test data. Please refresh the page.'
            alert(errorMsg)
            // Reset fetchDataRef to allow retry on manual refresh
            fetchDataRef.current = false
          }
        }
      } finally {
        // Always ensure checkingParams is false after fetch completes
        if (isMounted) {
          setCheckingParams(false)
          console.log('[Test Load] Fetch completed (finally block), checkingParams set to false')
        }
      }
    }

    fetchTestData()
    
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, token, userId]) // Only run when these change, not on every render

  // Detect when editor becomes visible AND fullscreen is active - then start timer
  // Timer only starts when BOTH conditions are met: fullscreen is active AND editor is visible
  useEffect(() => {
    if (timerStarted || !editorRef.current || questions.length === 0) return
    
    const checkAndStartTimer = () => {
      // Check if we're in fullscreen (required before starting timer)
      const isFullscreen = !!document.fullscreenElement || 
                          !!(document as any).webkitFullscreenElement ||
                          !!(document as any).mozFullScreenElement ||
                          !!(document as any).msFullscreenElement
      
      if (!isFullscreen) {
        // Not in fullscreen yet - timer will not start
        console.log('[Timer] Waiting for fullscreen before starting timer')
        return
      }
      
      // Check if editor is visible
      if (!editorRef.current) return
      
      const rect = editorRef.current.getBoundingClientRect()
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0 && rect.width > 0 && rect.height > 0
      
      if (isVisible && !timerStarted) {
        setEditorVisible(true)
        setTimerStarted(true)
        console.log('[Timer] Fullscreen active and editor visible - starting timer now')
      }
    }
    
    // Use Intersection Observer to detect when editor becomes visible
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
            checkAndStartTimer()
          }
        })
      },
      { threshold: 0.1 }
    )
    
    observer.observe(editorRef.current)
    
    // Check immediately and periodically (in case fullscreen is entered after editor is visible)
    checkAndStartTimer()
    const intervalId = setInterval(checkAndStartTimer, 500)
    
    // Also listen for fullscreen changes
    const handleFullscreenChange = () => {
      setTimeout(checkAndStartTimer, 100)
    }
    
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)
    
    return () => {
      observer.disconnect()
      clearInterval(intervalId)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [timerStarted, questions.length])

  // Timer countdown - only runs after editor is visible and timer is started
  useEffect(() => {
    if (!timerStarted || submitted || !testSubmission || !test) {
      console.log('[Timer] Not starting countdown:', { timerStarted, submitted, hasSubmission: !!testSubmission, hasTest: !!test })
      return
    }
    
    console.log('[Timer] Starting countdown effect', { timeRemaining, testDuration: test.duration_minutes })
    
    // Recalculate remaining time when timer starts to ensure accuracy
    const startedAtStr = testSubmission.started_at
    let calculatedRemaining = timeRemaining
    
    if (startedAtStr) {
      const startedAt = new Date(startedAtStr)
      if (!isNaN(startedAt.getTime())) {
        const durationMs = test.duration_minutes * 60 * 1000
        const endTime = new Date(startedAt.getTime() + durationMs)
        const now = new Date()
        calculatedRemaining = Math.floor((endTime.getTime() - now.getTime()) / 1000)
        
        console.log('[Timer] Calculated remaining time:', {
          startedAt: startedAt.toISOString(),
          endTime: endTime.toISOString(),
          now: now.toISOString(),
          calculatedRemaining,
          currentTimeRemaining: timeRemaining
        })
        
        // ALWAYS update timeRemaining when timer starts to ensure it's set correctly
        // This is critical because the timer might start with timeRemaining = 0
        console.log(`[Timer] Setting remaining time: ${calculatedRemaining}s (was ${timeRemaining}s)`)
        setTimeRemaining(Math.max(0, calculatedRemaining))
        setTotalTime(test.duration_minutes * 60)
        // Update the local variable for immediate use
        calculatedRemaining = Math.max(0, calculatedRemaining)
      } else {
        console.warn('[Timer] Invalid started_at date:', startedAtStr)
      }
    } else {
      console.warn('[Timer] No started_at in testSubmission:', testSubmission)
    }
    
    // Use calculated value for checks (state update is async)
    const remainingToCheck = calculatedRemaining > 0 ? calculatedRemaining : timeRemaining
    
    // When timer starts (editor becomes visible), check if time has already expired
    // IMPORTANT: Don't auto-submit immediately - the test might have just started
    // Only auto-submit if time truly expired AND it's been a reasonable time since test start
    if (remainingToCheck <= 0) {
      const timeSincePageLoad = pageLoadTimeRef.current ? Date.now() - pageLoadTimeRef.current : Infinity
      const gracePeriod = 10000 // 10 seconds grace period for page loading
      
      // Get test start time from submission
      const testStartTime = testSubmission?.started_at ? new Date(testSubmission.started_at).getTime() : null
      const timeSinceTestStart = testStartTime ? Date.now() - testStartTime : Infinity
      const minTestDuration = 5000 // Minimum 5 seconds before considering auto-submit (prevents immediate auto-submit)
      
      console.log('[Timer] Checking auto-submit conditions:', {
        timeRemaining,
        timeSincePageLoad: Math.round(timeSincePageLoad / 1000),
        timeSinceTestStart: Math.round(timeSinceTestStart / 1000),
        gracePeriod: gracePeriod / 1000,
        minTestDuration: minTestDuration / 1000
      })
      
      // Only auto-submit if:
      // 1. Page has been loaded for at least grace period (to account for loading delays)
      // 2. Test has been running for at least minTestDuration (to prevent immediate auto-submit on fresh start)
      if (timeSincePageLoad < gracePeriod || timeSinceTestStart < minTestDuration) {
        const waitTime = Math.max(gracePeriod - timeSincePageLoad, minTestDuration - timeSinceTestStart, 1000)
        console.log(`[Timer] Timer expired but conditions not met - waiting ${Math.round(waitTime/1000)}s before checking again`)
        
        // Wait before checking again
        const graceTimer = setTimeout(() => {
          // Recalculate remaining time
          if (testStartTime && test) {
            const durationMs = test.duration_minutes * 60 * 1000
            const endTime = testStartTime + durationMs
            const now = Date.now()
            const newRemaining = Math.floor((endTime - now) / 1000)
            
            console.log('[Timer] Rechecking after grace period:', { newRemaining })
            
            if (newRemaining <= 0 && !submitted && timerStarted) {
              console.log('[Timer] Time truly expired after grace period - auto-submitting')
              // Trigger auto-submit by setting timeRemaining to 0, which will trigger the interval handler
              setTimeRemaining(0)
            } else if (newRemaining > 0) {
              // Update timer with correct remaining time
              setTimeRemaining(newRemaining)
              console.log(`[Timer] Timer updated to ${newRemaining}s remaining`)
            }
          }
        }, waitTime)
        
        return () => clearTimeout(graceTimer)
      } else {
        // Both conditions met - time truly expired
        console.log('[Timer] Timer expired and conditions met - auto-submitting')
        // Trigger auto-submit by setting timeRemaining to 0, which will trigger the interval handler
        setTimeRemaining(0)
        return
      }
    }

    // Only start countdown if we have valid remaining time
    if (remainingToCheck <= 0) {
      console.log('[Timer] No time remaining, skipping countdown interval')
      return
    }
    
    console.log('[Timer] Starting countdown interval with', remainingToCheck, 'seconds remaining')
    
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        const newValue = prev - 1
        if (newValue <= 0) {
          console.log('[Timer] Time expired, triggering auto-submit')
          // Trigger auto-submit
          handleAutoSubmit()
          return 0
        }
        return newValue
      })
    }, 1000)

    return () => {
      console.log('[Timer] Cleaning up countdown interval')
      clearInterval(timer)
    }
  }, [timerStarted, submitted, testSubmission, test]) // Don't include timeRemaining to avoid recreating interval

  // Per-question timer countdown - only runs in PER_QUESTION mode and when question timer is started
  useEffect(() => {
    if (!timerStarted || submitted || test?.timer_mode !== 'PER_QUESTION' || !activeQuestionTimer) {
      return
    }
    
    // Only run countdown if this question's timer has been started (on first entry)
    if (!questionTimerStarted[activeQuestionTimer]) {
      console.log(`[Timer] Timer not started yet for question ${activeQuestionTimer}`)
      return
    }
    
    const currentQuestionTime = questionTimeRemaining[activeQuestionTimer]
    if (currentQuestionTime === undefined || currentQuestionTime <= 0) {
      // Question time expired - auto-submit this question and move to next
      const currentIndex = questions.findIndex(q => q.id === activeQuestionTimer)
      
      // Mark current question as submitted (to unlock next)
      setSubmittedQuestions(prev => ({
        ...prev,
        [activeQuestionTimer]: true
      }))
      
      if (currentIndex < questions.length - 1) {
        // Move to next question
        console.log(`[Timer] Question ${activeQuestionTimer} time expired, moving to next question`)
        handleQuestionChange(currentIndex + 1)
      } else {
        // Last question - auto-submit the test
        console.log('[Timer] Last question time expired, auto-submitting')
        handleAutoSubmit()
      }
      return
    }
    
    console.log(`[Timer] Per-question countdown active for ${activeQuestionTimer}: ${currentQuestionTime}s remaining`)
    
    const timer = setInterval(() => {
      setQuestionTimeRemaining(prev => {
        const newTime = Math.max(0, (prev[activeQuestionTimer] || 0) - 1)
        const updated = { ...prev, [activeQuestionTimer]: newTime }
        
        // Save to localStorage for persistence
        if (userId && testId) {
          const storageKey = `test_${testId}_${userId}_questionTimers`
          localStorage.setItem(storageKey, JSON.stringify(updated))
        }
        
        // Check if time expired
        if (newTime <= 0) {
          console.log(`[Timer] Question ${activeQuestionTimer} time expired`)
          // The effect will handle auto-move/submit on next run
        }
        
        return updated
      })
    }, 1000)
    
    return () => {
      clearInterval(timer)
    }
  }, [timerStarted, submitted, test?.timer_mode, activeQuestionTimer, questions.length, questionTimerStarted])

  const handleAutoSubmit = async () => {
    if (submitted || submitting) return
    await handleSubmit(true)
  }

  const handleSubmit = async (isAuto: boolean = false) => {
    if (submitted || submitting) return

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

      await dsaApi.post(`/tests/${testId}/final-submit?user_id=${userId}`, {
        question_submissions: questionSubmissions,
        activity_logs: activityLogs,
      })

      setSubmitted(true)
      // Alerts removed - submission status is shown in the UI
    } catch (error: any) {
      console.error('Failed to submit test:', error.response?.data?.detail || error.message)
      // Don't show alert on error - just log it
      // Don't set submitted to true on error - let user retry
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuestionChange = (index: number) => {
    const previousQuestion = questions[currentQuestionIndex]
    const newQuestion = questions[index]
    
    // Check if navigation is allowed (sequential mode)
    // First question is always accessible, others require previous question to be submitted
    if (index > 0) {
      const previousQuestionId = questions[index - 1]?.id
      if (previousQuestionId && !submittedQuestions[previousQuestionId]) {
        // Previous question not submitted - block navigation
        alert(`Please submit Question ${index} before moving to Question ${index + 1}`)
        return
      }
    }
    
    // Handle per-question timer mode - pause previous, resume new
    if (test?.timer_mode === 'PER_QUESTION' && previousQuestion && newQuestion && previousQuestion.id !== newQuestion.id) {
      // Set the new question as the active timer
      setActiveQuestionTimer(newQuestion.id)
      console.log(`[Timer] Switched from question ${previousQuestion.id} to ${newQuestion.id}`)
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
      
      // Start per-question timer - reset to full duration when entering question for first time
      if (test?.timer_mode === 'PER_QUESTION') {
        const fullDuration = questionTotalTime[newQuestion.id]
        if (fullDuration !== undefined) {
          // If timer hasn't been started for this question, reset to full duration
          if (!questionTimerStarted[newQuestion.id]) {
            console.log(`[Timer] Starting timer for question ${newQuestion.id} with full duration: ${fullDuration}s`)
            setQuestionTimeRemaining(prev => {
              const updated = { ...prev, [newQuestion.id]: fullDuration }
              
              // Save to localStorage for persistence
              if (userId && testId) {
                const storageKey = `test_${testId}_${userId}_questionTimers`
                localStorage.setItem(storageKey, JSON.stringify(updated))
              }
              
              return updated
            })
            
            // Mark timer as started
            setQuestionTimerStarted(prev => ({
              ...prev,
              [newQuestion.id]: true
            }))
          } else {
            // Timer already started - preserve remaining time (user might be going back)
            const currentRemaining = questionTimeRemaining[newQuestion.id]
            if (currentRemaining === undefined || currentRemaining <= 0) {
              // If somehow timer is missing or expired, reset to full duration
              console.log(`[Timer] Timer was expired/missing for question ${newQuestion.id}, resetting to full duration`)
              setQuestionTimeRemaining(prev => {
                const updated = { ...prev, [newQuestion.id]: fullDuration }
                if (userId && testId) {
                  const storageKey = `test_${testId}_${userId}_questionTimers`
                  localStorage.setItem(storageKey, JSON.stringify(updated))
                }
                return updated
              })
            } else {
              console.log(`[Timer] Resuming timer for question ${newQuestion.id} with remaining time: ${currentRemaining}s`)
            }
          }
          
          setActiveQuestionTimer(newQuestion.id)
        }
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
    
    // Prevent running code if test is already submitted
    if (submitted) {
      alert('You have already submitted this test. You cannot run code anymore.')
      return
    }
    
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
    
    // Prevent submitting code if test is already submitted
    if (submitted) {
      alert('You have already submitted this test. You cannot submit code anymore.')
      return
    }
    
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

  // Timeout fallback - if loading takes too long, show error (must be before early returns)
  // Calculate isLoading inline to avoid dependency issues
  useEffect(() => {
    const isLoading = checkingParams || (token && userId && testId && !test)
    if (isLoading && token && userId && testId) {
      const timeout = setTimeout(() => {
        console.error('[Test Load] Loading timeout - taking too long')
        if (checkingParams || !test) {
          setCheckingParams(false)
          alert('Test is taking too long to load. Please refresh the page or contact support.')
          // Reset fetch ref to allow retry
          fetchDataRef.current = false
          // Auto-refresh after alert
          setTimeout(() => {
            window.location.reload()
          }, 2000)
        }
      }, 15000) // 15 second timeout (reduced from 30 for faster feedback)
      
      return () => clearTimeout(timeout)
    }
  }, [checkingParams, token, userId, testId, test])

  // Early returns must come AFTER all hooks
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <div className="mb-4">
              <AlertCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <h2 className="text-2xl font-bold mb-2 text-white">Test Submitted</h2>
              <p className="text-slate-400">Your test has been submitted successfully.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show loading only if we're checking params OR if we have valid params but no test data yet
  // Separate check for questions loading
  // Don't wait for camera to load - show UI as soon as questions are ready
  // Show editor immediately when first question loads (progressive loading)
  const isLoading = checkingParams || (token && userId && testId && !test)
  // questionsLoading is now a state variable, not computed
  const hasFirstQuestion = questions.length > 0 // Show editor as soon as first question is available
  
  // Show fullscreen prompt if needed (after refresh, before entering fullscreen)
  // This should appear before the loading/editor UI
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
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-slate-400">Loading test...</p>
          {!checkingParams && token && userId && (
            <p className="text-slate-500 text-sm mt-2">Please wait while we load your test...</p>
          )}
          <p className="text-slate-600 text-xs mt-4">If this takes too long, please refresh the page.</p>
        </div>
      </div>
    )
  }
  
  // Show partial UI while questions are loading (progressive loading)
  // Don't block the entire page - show what we have
  if (questionsLoading && test) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-slate-400">Loading questions...</p>
          <p className="text-slate-500 text-sm mt-2">This may take a few moments...</p>
        </div>
      </div>
    )
  }

  // Type guard: at this point, test and at least one question should be loaded
  if (!test || questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <p className="text-slate-400">No test data available. Please refresh the page.</p>
        </div>
      </div>
    )
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
          timeRemaining={timeRemaining} 
          totalTime={totalTime}
          timerMode={test?.timer_mode || 'GLOBAL'}
          currentQuestionTitle={currentQuestion?.title}
          questionTimeRemaining={currentQuestion ? questionTimeRemaining[currentQuestion.id] : undefined}
          questionTotalTime={currentQuestion ? questionTotalTime[currentQuestion.id] : undefined}
        />
        <div className="flex-1 overflow-y-auto">
          <QuestionSidebar
            testTitle={test.title}
            questions={questions}
            currentQuestionIndex={currentQuestionIndex}
            onQuestionChange={handleQuestionChange}
            onSubmit={() => handleSubmit(false)}
            submitting={submitting}
            questionStatus={questionStatus}
            submittedQuestions={submittedQuestions}
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
                  onClick={() => handleSubmit(false)}
                  disabled={submitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
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
        timeRemaining={timeRemaining} 
        totalTime={totalTime}
        timerMode={test?.timer_mode || 'GLOBAL'}
        currentQuestionTitle={currentQuestion?.title}
        questionTimeRemaining={currentQuestion ? questionTimeRemaining[currentQuestion.id] : undefined}
        questionTotalTime={currentQuestion ? questionTotalTime[currentQuestion.id] : undefined}
      />

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
              testTitle={test.title}
              questions={questions}
              currentQuestionIndex={currentQuestionIndex}
              onQuestionChange={handleQuestionChange}
              onSubmit={() => handleSubmit(false)}
              submitting={submitting}
              questionStatus={questionStatus}
              submittedQuestions={submittedQuestions}
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
                  onClick={() => handleSubmit(false)}
                  disabled={submitting}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
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

