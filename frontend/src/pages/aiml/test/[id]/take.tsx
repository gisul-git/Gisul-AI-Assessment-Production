'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import axios from 'axios'

const AIMLCompetencyNotebook = dynamic(
  () => import('../../../../components/aiml/competency/AIMLCompetencyNotebook'),
  { ssr: false, loading: () => <div className="h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-500">Loading IDE...</div></div> }
)

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface Task {
  id: string
  title: string
  description: string
}

interface Question {
  id: string
  title: string
  description: string
  difficulty: string
  library?: string
  starter_code?: Record<string, string>
  tasks?: Array<string | Task>  // Support both string and object format
  public_testcases?: Array<{ input: string; expected_output: string }>
  dataset?: {
    schema: Array<{ name: string; type: string }>
    rows: any[]
    format?: string
  }
  dataset_path?: string
  dataset_url?: string
  requires_dataset?: boolean
}

interface Test {
  test_id: string
  title: string
  description: string
  duration_minutes: number
  questions: Question[]
}

export default function AIMLTestTakePage() {
  const router = useRouter()
  const { id: testId } = router.query
  
  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [test, setTest] = useState<Test | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [codeAnswers, setCodeAnswers] = useState<Record<string, string>>({})
  const [outputAnswers, setOutputAnswers] = useState<Record<string, string[]>>({})
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!testId) return
    
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    const urlUserId = urlParams.get('user_id')
    
    if (!urlToken || !urlUserId) {
      alert('Invalid test link')
      router.push('/dashboard')
      return
    }
    
    setToken(urlToken)
    setUserId(urlUserId)
    
    fetchTestData(urlToken, urlUserId)
  }, [testId])

  // Timer
  useEffect(() => {
    if (timeRemaining <= 0 || submitted) return

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleSubmitTest()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [timeRemaining, submitted])

  const fetchTestData = async (urlToken: string, urlUserId: string) => {
    try {
      setLoading(true)
      const response = await axios.get(
        `${apiUrl}/api/v1/aiml/tests/${testId}/candidate?user_id=${urlUserId}`,
        { headers: { Authorization: `Bearer ${urlToken}` } }
      )
      
      const testData = response.data
      setTest(testData)
      setQuestions(testData.questions || [])
      
      // Use time_remaining_seconds from backend if available (test already started)
      // Otherwise, auto-start the test and use full duration
      if (testData.is_completed) {
        // Test already completed, set time to 0 and mark as submitted
        setTimeRemaining(0)
        setSubmitted(true)
      } else if (testData.time_remaining_seconds !== undefined && testData.time_remaining_seconds >= 0) {
        // Test already started, use remaining time from backend
        setTimeRemaining(Math.max(0, testData.time_remaining_seconds))
        // If time has expired, it will be handled by the timer effect
      } else {
        // Test hasn't been started yet, auto-start it
        try {
          await axios.post(
            `${apiUrl}/api/v1/aiml/tests/${testId}/start?user_id=${urlUserId}`,
            {},
            { headers: { Authorization: `Bearer ${urlToken}` } }
          )
          // After starting, use full duration (timer will count down from here)
          setTimeRemaining(testData.duration_minutes * 60)
        } catch (startErr) {
          console.error('Failed to auto-start test:', startErr)
          // If start fails, still use full duration as fallback
          setTimeRemaining(testData.duration_minutes * 60)
        }
      }
      
      // Initialize code answers
      const initialCodes: Record<string, string> = {}
      testData.questions.forEach((q: Question) => {
        initialCodes[q.id] = q.starter_code?.python3 || q.starter_code?.python || ''
      })
      setCodeAnswers(initialCodes)
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.detail || 'Failed to load test')
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  const currentQuestion = questions[currentQuestionIndex]

  const autoSaveAnswer = useCallback(async (questionId: string, code: string) => {
    if (!token || !userId || !testId) return
    
    try {
      await axios.post(
        `${apiUrl}/api/v1/aiml/tests/${testId}/submit-answer`,
        {
          user_id: userId,
          question_id: questionId,
          source_code: code,
          outputs: [],
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setLastSaved(new Date())
    } catch (err) {
      console.error('Auto-save failed:', err)
    }
  }, [token, userId, testId, apiUrl])

  const handleCodeChange = useCallback((code: string) => {
    if (currentQuestion) {
      setCodeAnswers(prev => ({
        ...prev,
        [currentQuestion.id]: code
      }))
      
      // Debounced auto-save (save 2 seconds after user stops typing)
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
      autoSaveRef.current = setTimeout(() => {
        autoSaveAnswer(currentQuestion.id, code)
      }, 2000)
    }
  }, [currentQuestion, autoSaveAnswer])

  const handleSubmitQuestion = async (code: string, outputs: string[]) => {
    if (!currentQuestion || submitting) return

    setSubmitting(true)
    try {
      // Store outputs locally for final submission
      setOutputAnswers(prev => ({
        ...prev,
        [currentQuestion.id]: outputs
      }))

      await axios.post(
        `${apiUrl}/api/v1/aiml/tests/${testId}/submit-answer`,
        {
          user_id: userId,
          question_id: currentQuestion.id,
          source_code: code,
          outputs: outputs,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      // Auto-save successful - show toast notification
      const toast = document.createElement('div')
      toast.className = 'fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg z-50'
      toast.textContent = '✓ Answer auto-saved'
      document.body.appendChild(toast)
      setTimeout(() => document.body.removeChild(toast), 2000)
      
      // Move to next question if requested
      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1)
      }
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.detail || 'Failed to save answer')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitTest = async () => {
    if (submitted || submitting) return

    // Confirm submission
    const confirmSubmit = window.confirm(
      'Are you sure you want to submit the test?\n\n' +
      'Your answers will be evaluated by AI and you will receive a score and feedback.\n\n' +
      'This action cannot be undone.'
    )
    if (!confirmSubmit) return

    setSubmitting(true)
    try {
      const response = await axios.post(
        `${apiUrl}/api/v1/aiml/tests/${testId}/submit`,
        {
          user_id: userId,
          answers: Object.entries(codeAnswers).map(([questionId, code]) => ({
            question_id: questionId,
            source_code: code,
            outputs: outputAnswers[questionId] || []
          }))
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      // Log the result for debugging
      console.log('Submission result:', response.data)
      
      setSubmitted(true)
      if (timerRef.current) clearInterval(timerRef.current)
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.detail || 'Failed to submit test')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading test...</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50">
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg max-w-md">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Test Submitted!</h1>
          <p className="text-gray-600 mb-4">Your answers have been recorded and are being evaluated by AI.</p>
          
          <div className="bg-emerald-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-emerald-700">
              🤖 AI is analyzing your code and outputs...
            </p>
            <p className="text-xs text-emerald-600 mt-2">
              You will receive a detailed score (out of 100) and feedback from the test administrator.
            </p>
          </div>
          
          <p className="text-sm text-gray-500">You may close this window now.</p>
        </div>
      </div>
    )
  }

  if (!test || questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-600">
          <p className="text-xl mb-2">Test not found</p>
          <p className="text-sm">Please check the link and try again.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header with Timer and Navigation */}
      <header className="bg-white border-b border-emerald-200 shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-gray-800">{test.title}</h1>
            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
              AIML Assessment
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Auto-save Indicator */}
            {lastSaved && (
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <svg className="w-3 h-3 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Saved {Math.floor((Date.now() - lastSaved.getTime()) / 1000)}s ago
              </div>
            )}
            
            {/* Timer */}
            <div className={`px-4 py-2 rounded-lg font-mono text-lg font-semibold ${
              timeRemaining < 300 
                ? 'bg-red-100 text-red-700' 
                : timeRemaining < 600 
                  ? 'bg-amber-100 text-amber-700' 
                  : 'bg-emerald-100 text-emerald-700'
            }`}>
              ⏱️ {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </div>
            
            <button
              onClick={() => {
                if (confirm('Are you sure you want to submit the test? This action cannot be undone.')) {
                  handleSubmitTest()
                }
              }}
              disabled={submitting}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 shadow-md hover:shadow-lg"
            >
              {submitting ? 'Submitting...' : 'Submit Test'}
            </button>
          </div>
        </div>
        
        {/* Question Navigation */}
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          {/* Previous Button */}
          <button
            onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
            disabled={currentQuestionIndex === 0}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          
          {/* Question Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto flex-1">
            {questions.map((q, idx) => (
              <button
                key={q.id}
                onClick={() => setCurrentQuestionIndex(idx)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  idx === currentQuestionIndex
                    ? 'bg-emerald-600 text-white'
                    : codeAnswers[q.id] && codeAnswers[q.id].trim() !== ''
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                Q{idx + 1}
              </button>
            ))}
          </div>
          
          {/* Next Button */}
          <button
            onClick={() => setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1))}
            disabled={currentQuestionIndex === questions.length - 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </header>

      {/* Main Content - Competency Notebook IDE */}
      <main className="flex-1 overflow-hidden">
        {currentQuestion && (
          <AIMLCompetencyNotebook
            key={currentQuestion.id}
            question={currentQuestion}
            sessionId={`test_${testId}_user_${userId}_q_${currentQuestion.id}`}
            onCodeChange={handleCodeChange}
            onSubmit={handleSubmitQuestion}
            showSubmit={currentQuestionIndex === questions.length - 1}
          />
        )}
      </main>
    </div>
  )
}
