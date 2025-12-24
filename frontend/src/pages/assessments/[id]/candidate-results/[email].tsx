'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../../../lib/auth'
import Link from 'next/link'
import axios from 'axios'
import { ArrowLeft, CheckCircle, XCircle, Code, FileText, Database, Brain } from 'lucide-react'

interface EvaluationResult {
  question_type: string
  score: number
  max_score: number
  feedback?: string
  is_correct?: boolean
  candidate_answer?: string
  correct_answer?: string
  test_results?: any[]
  public_results?: any[]
  hidden_results?: any[]
  total_passed?: number
  total_tests?: number
  ai_feedback?: any
  error?: string
  strengths?: string[]
  improvements?: string[]
  candidate_code?: string
}


interface CandidateResult {
  email: string
  name: string
  score: number
  maxScore: number
  percentageScored: number
  evaluation?: {
    evaluation_results: Record<string, EvaluationResult>
    total_score: number
    max_total_score: number
    percentage: number
  }
}

export default function CandidateResultsPage() {
  const router = useRouter()
  const { id: assessmentId, email: candidateEmail } = router.query
  const [loading, setLoading] = useState(true)
  const [assessment, setAssessment] = useState<any>(null)
  const [candidateResult, setCandidateResult] = useState<CandidateResult | null>(null)
  const [questions, setQuestions] = useState<any[]>([])

  useEffect(() => {
    if (!assessmentId || typeof assessmentId !== 'string' || !candidateEmail) return

    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch assessment details
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`)
        if (assessmentResponse.data?.success && assessmentResponse.data?.data) {
          const assessmentData = assessmentResponse.data.data
          setAssessment(assessmentData)
          
          // Extract all questions
          const allQuestions: any[] = []
          let globalIndex = 0
          if (assessmentData.topics_v2) {
            assessmentData.topics_v2.forEach((topic: any) => {
              topic.rows?.forEach((row: any) => {
                row.questions?.forEach((q: any) => {
                  allQuestions.push({
                    ...q,
                    index: globalIndex++,
                    section: topic.section || 'mcq',
                  })
                })
              })
            })
          }
          setQuestions(allQuestions)
        }
        
        // Fetch candidate results
        const resultsResponse = await axios.get(`/api/assessments/get-candidate-results?assessmentId=${assessmentId}`)
        if (resultsResponse.data?.success) {
          const candidates = resultsResponse.data.data || []
          const candidate = candidates.find((c: any) => 
            c.email.toLowerCase() === decodeURIComponent(candidateEmail as string).toLowerCase()
          )
          if (candidate) {
            setCandidateResult(candidate)
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        alert('Failed to load candidate results')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [assessmentId, candidateEmail])

  const getQuestionIcon = (type: string) => {
    const typeLower = type?.toLowerCase() || ''
    if (typeLower === 'mcq') return '📝'
    if (typeLower === 'subjective' || typeLower === 'pseudocode') return <FileText className="w-5 h-5" />
    if (typeLower === 'coding') return <Code className="w-5 h-5" />
    if (typeLower === 'sql') return <Database className="w-5 h-5" />
    if (typeLower === 'aiml') return <Brain className="w-5 h-5" />
    return '❓'
  }

  const getQuestionTypeName = (type: string) => {
    const typeLower = type?.toLowerCase() || ''
    if (typeLower === 'mcq') return 'Multiple Choice'
    if (typeLower === 'subjective') return 'Subjective'
    if (typeLower === 'pseudocode') return 'Pseudocode'
    if (typeLower === 'coding') return 'Coding'
    if (typeLower === 'sql') return 'SQL'
    if (typeLower === 'aiml') return 'AIML'
    return type || 'Unknown'
  }

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  if (!candidateResult) {
    return (
      <div className="container">
        <div className="card">
          <div className="text-center">
            <p>Candidate results not found.</p>
            <Link href={`/assessments/${assessmentId}/candidates`}>
              <button className="btn-primary" style={{ marginTop: '1rem' }}>
                Back to Candidates
              </button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const evaluation = candidateResult.evaluation
  const evaluationResults = evaluation?.evaluation_results || {}

  return (
    <div className="container">
      <div className="card">
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => router.push(`/assessments/${assessmentId}/candidates`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Candidates
            </button>
          </div>

          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              {candidateResult.name}
            </h1>
            <p style={{ color: "#64748b", margin: 0 }}>
              {candidateResult.email} - Detailed Results
            </p>
          </div>
        </div>

        {/* Overall Score Summary */}
        {evaluation && (
          <div style={{
            padding: "1.5rem",
            backgroundColor: "#f8fafc",
            borderRadius: "0.75rem",
            border: "1px solid #e2e8f0",
            marginBottom: "2rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Total Score</div>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b" }}>
                  {evaluation.total_score} / {evaluation.max_total_score}
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Percentage</div>
                <div style={{ 
                  fontSize: "2rem", 
                  fontWeight: 700, 
                  color: evaluation.percentage >= 70 ? "#059669" : evaluation.percentage >= 50 ? "#d97706" : "#dc2626"
                }}>
                  {evaluation.percentage.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Questions and Results */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {questions.map((question, idx) => {
            const evalResult = evaluationResults[question.index]
            if (!evalResult) return null

            return (
              <div
                key={idx}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}
              >
                {/* Question Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                      {getQuestionIcon(question.type)}
                      <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
                        Question {question.index + 1}: {getQuestionTypeName(question.type)}
                      </h3>
                      <span style={{
                        padding: "0.25rem 0.75rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        backgroundColor: evalResult.score === evalResult.max_score ? "#d1fae5" : "#fee2e2",
                        color: evalResult.score === evalResult.max_score ? "#065f46" : "#991b1b",
                      }}>
                        {evalResult.score} / {evalResult.max_score} pts
                      </span>
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
                      {question.questionText || question.title || question.description || 'No question text'}
                    </div>
                  </div>
                </div>

                {/* MCQ Results */}
                {evalResult.question_type === 'mcq' && (
                  <div style={{ marginTop: "1rem" }}>
                    <div style={{ 
                      padding: "1rem", 
                      backgroundColor: evalResult.is_correct ? "#d1fae5" : "#fee2e2",
                      borderRadius: "0.5rem",
                      marginBottom: "0.5rem"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        {evalResult.is_correct ? (
                          <CheckCircle className="w-5 h-5" style={{ color: "#059669" }} />
                        ) : (
                          <XCircle className="w-5 h-5" style={{ color: "#dc2626" }} />
                        )}
                        <span style={{ fontWeight: 600 }}>
                          {evalResult.is_correct ? 'Correct' : 'Incorrect'}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                        <strong>Candidate Answer:</strong> {evalResult.candidate_answer || 'No answer'}
                      </div>
                      {!evalResult.is_correct && (
                        <div style={{ fontSize: "0.875rem" }}>
                          <strong>Correct Answer:</strong> {evalResult.correct_answer}
                        </div>
                      )}
                    </div>
                    {evalResult.feedback && (
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                        {evalResult.feedback}
                      </div>
                    )}
                  </div>
                )}

                {/* Subjective/Pseudocode Results */}
                {(evalResult.question_type === 'subjective' || evalResult.question_type === 'pseudocode') && (
                  <div style={{ marginTop: "1rem" }}>
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Candidate Answer:</div>
                      <div style={{
                        padding: "1rem",
                        backgroundColor: "#f8fafc",
                        borderRadius: "0.5rem",
                        border: "1px solid #e2e8f0",
                        whiteSpace: "pre-wrap",
                        fontFamily: evalResult.question_type === 'pseudocode' ? 'monospace' : 'inherit',
                        fontSize: "0.875rem",
                      }}>
                        {evalResult.candidate_answer || 'No answer provided'}
                      </div>
                    </div>
                    {evalResult.feedback && (
                      <div style={{
                        padding: "1rem",
                        backgroundColor: "#fef3c7",
                        borderRadius: "0.5rem",
                        border: "1px solid #fde68a",
                      }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>AI Feedback:</div>
                        <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>
                          {evalResult.feedback}
                        </div>
                        {evalResult.strengths && evalResult.strengths.length > 0 && (
                          <div style={{ marginTop: "0.75rem" }}>
                            <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" }}>Strengths:</div>
                            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                              {evalResult.strengths.map((s: string, i: number) => (
                                <li key={i} style={{ fontSize: "0.875rem" }}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {evalResult.improvements && evalResult.improvements.length > 0 && (
                          <div style={{ marginTop: "0.75rem" }}>
                            <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" }}>Areas for Improvement:</div>
                            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                              {evalResult.improvements.map((s: string, i: number) => (
                                <li key={i} style={{ fontSize: "0.875rem" }}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Coding/SQL/AIML Results */}
                {(evalResult.question_type === 'coding' || evalResult.question_type === 'sql' || evalResult.question_type === 'aiml') && (
                  <div style={{ marginTop: "1rem" }}>
                    {/* Test Cases Summary */}
                    {evalResult.total_tests !== undefined && (
                      <div style={{
                        padding: "1rem",
                        backgroundColor: evalResult.total_passed === evalResult.total_tests ? "#d1fae5" : "#fee2e2",
                        borderRadius: "0.5rem",
                        marginBottom: "1rem",
                      }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                          Test Cases: {evalResult.total_passed} / {evalResult.total_tests} passed
                        </div>
                      </div>
                    )}

                    {/* Public Test Cases */}
                    {evalResult.public_results && evalResult.public_results.length > 0 && (
                      <div style={{ marginBottom: "1rem" }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                          Public Test Cases:
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {evalResult.public_results.map((result: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                padding: "0.75rem",
                                backgroundColor: result.passed ? "#d1fae5" : "#fee2e2",
                                borderRadius: "0.5rem",
                                border: "1px solid",
                                borderColor: result.passed ? "#a7f3d0" : "#fecaca",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                                {result.passed ? (
                                  <CheckCircle className="w-4 h-4" style={{ color: "#059669" }} />
                                ) : (
                                  <XCircle className="w-4 h-4" style={{ color: "#dc2626" }} />
                                )}
                                <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                                  Test Case {i + 1} - {result.passed ? 'Passed' : 'Failed'}
                                </span>
                              </div>
                              {result.input && (
                                <div style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                                  <strong>Input:</strong> <code style={{ backgroundColor: "#ffffff", padding: "0.125rem 0.25rem", borderRadius: "0.25rem" }}>{result.input}</code>
                                </div>
                              )}
                              {result.expected_output && (
                                <div style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                                  <strong>Expected:</strong> <code style={{ backgroundColor: "#ffffff", padding: "0.125rem 0.25rem", borderRadius: "0.25rem" }}>{result.expected_output}</code>
                                </div>
                              )}
                              {result.stdout && (
                                <div style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                                  <strong>Output:</strong> <code style={{ backgroundColor: "#ffffff", padding: "0.125rem 0.25rem", borderRadius: "0.25rem" }}>{result.stdout}</code>
                                </div>
                              )}
                              {result.stderr && (
                                <div style={{ fontSize: "0.75rem", color: "#dc2626" }}>
                                  <strong>Error:</strong> {result.stderr}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hidden Test Cases */}
                    {evalResult.hidden_results && evalResult.hidden_results.length > 0 && (
                      <div style={{ marginBottom: "1rem" }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                          Hidden Test Cases:
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {evalResult.hidden_results.map((result: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                padding: "0.75rem",
                                backgroundColor: result.passed ? "#d1fae5" : "#fee2e2",
                                borderRadius: "0.5rem",
                                border: "1px solid",
                                borderColor: result.passed ? "#a7f3d0" : "#fecaca",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                {result.passed ? (
                                  <CheckCircle className="w-4 h-4" style={{ color: "#059669" }} />
                                ) : (
                                  <XCircle className="w-4 h-4" style={{ color: "#dc2626" }} />
                                )}
                                <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                                  Hidden Test {i + 1} - {result.passed ? 'Passed' : 'Failed'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Candidate Code */}
                    {evalResult.candidate_code && (
                      <div style={{ marginBottom: "1rem" }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Candidate Code:</div>
                        <pre style={{
                          padding: "1rem",
                          backgroundColor: "#1e293b",
                          color: "#e2e8f0",
                          borderRadius: "0.5rem",
                          overflow: "auto",
                          fontSize: "0.75rem",
                          fontFamily: "monospace",
                        }}>
                          {evalResult.candidate_code}
                        </pre>
                      </div>
                    )}

                    {/* AI Feedback */}
                    {evalResult.ai_feedback && (
                      <div style={{
                        padding: "1rem",
                        backgroundColor: "#fef3c7",
                        borderRadius: "0.5rem",
                        border: "1px solid #fde68a",
                      }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>AI Feedback:</div>
                        {evalResult.ai_feedback.feedback_summary && (
                          <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap", marginBottom: "0.75rem" }}>
                            {evalResult.ai_feedback.feedback_summary}
                          </div>
                        )}
                        {evalResult.ai_feedback.code_quality && (
                          <div style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                            <strong>Code Quality:</strong> {evalResult.ai_feedback.code_quality.comments}
                          </div>
                        )}
                        {evalResult.ai_feedback.efficiency && (
                          <div style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                            <strong>Efficiency:</strong> {evalResult.ai_feedback.efficiency.comments}
                          </div>
                        )}
                        {evalResult.ai_feedback.correctness && (
                          <div style={{ fontSize: "0.875rem" }}>
                            <strong>Correctness:</strong> {evalResult.ai_feedback.correctness.comments}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Error Message */}
                    {evalResult.error && (
                      <div style={{
                        padding: "1rem",
                        backgroundColor: "#fee2e2",
                        borderRadius: "0.5rem",
                        border: "1px solid #fecaca",
                        color: "#991b1b",
                      }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>Error:</div>
                        <div style={{ fontSize: "0.875rem" }}>{evalResult.error}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;

