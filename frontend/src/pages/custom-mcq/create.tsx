'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../lib/auth'
import axios from 'axios'
import { ArrowLeft, Download, Upload, CheckCircle, XCircle, Edit2, Trash2, Plus } from 'lucide-react'

interface MCQQuestion {
  section: string
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
  marks: number
}

interface Section {
  name: string
  timeLimit?: number
  questions: MCQQuestion[]
}

interface DashboardPageProps {
  session: any
}

export default function CreateCustomMCQTest({ session: serverSession }: DashboardPageProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const activeSession = serverSession || session
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [currentStep, setCurrentStep] = useState(1)
  const [csvContent, setCsvContent] = useState<string>('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [validatedQuestions, setValidatedQuestions] = useState<MCQQuestion[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [isValidating, setIsValidating] = useState(false)
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false)

  // Assessment Information (Step 1)
  const [assessmentInfo, setAssessmentInfo] = useState({
    title: '',
    description: '',
    instructions: '',
  })

  // Test Settings
  const [testSettings, setTestSettings] = useState({
    passingPercentage: 50,
    shuffleQuestions: false,
    shuffleOptions: false,
    allowNegativeMarking: false,
    attemptLimit: 1,
  })

  // Timer Settings
  const [timerMode, setTimerMode] = useState<'per-section' | 'single-exam'>('single-exam')
  const [examDuration, setExamDuration] = useState<number>(60)
  const [sectionTimes, setSectionTimes] = useState<Record<string, number>>({})

  // Proctoring Settings
  const [proctoringSettings, setProctoringSettings] = useState({
    enabled: false,
    multiFaceDetection: false,
    fullscreenMonitoring: false,
    copyPasteBlocking: false,
    tabSwitchDetection: false,
    frameMatchRecognition: false,
    externalDeviceDetection: false,
    browserExtensionMonitoring: false,
    concentrationTracking: false,
    liveCameraAndScreenMonitoring: false,
  })

  // Schedule Settings
  const [schedule, setSchedule] = useState({
    startTime: '',
    endTime: '',
  })

  // Access Mode
  const [accessMode, setAccessMode] = useState<'private' | 'public'>('private')
  const [candidates, setCandidates] = useState<Array<{ name: string; email: string; phone?: string }>>([])
  
  // Candidate input fields (for adding new candidate)
  const [newCandidateName, setNewCandidateName] = useState('')
  const [newCandidateEmail, setNewCandidateEmail] = useState('')
  
  // Test URL display state
  const [testUrl, setTestUrl] = useState<string | null>(null)
  const [showTestUrl, setShowTestUrl] = useState(false)
  
  // Edit mode state
  const [testId, setTestId] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [isLoadingTest, setIsLoadingTest] = useState(false)
  const [isDraft, setIsDraft] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Create draft on mount if not editing
  useEffect(() => {
    const { testId: queryTestId } = router.query
    if (!queryTestId && !draftId) {
      createDraft()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load existing test/draft data when testId is in query params
  useEffect(() => {
    const { testId: queryTestId } = router.query
    if (queryTestId && typeof queryTestId === 'string' && !testId) {
      setTestId(queryTestId)
      loadExistingTest(queryTestId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query])

  const createDraft = async () => {
    try {
      const response = await axios.post('/api/custom-mcq/create-draft', {
        title: assessmentInfo.title || null,
      })
      if (response.data?.success && response.data?.data?.draftId) {
        setDraftId(response.data.data.draftId)
        setIsDraft(true)
      }
    } catch (error: any) {
      console.error('Error creating draft:', error)
    }
  }

  const loadExistingTest = async (id: string) => {
    setIsLoadingTest(true)
    try {
      // First try to load as draft
      let response
      try {
        response = await axios.get(`/api/custom-mcq/get-draft?testId=${id}`)
        if (response.data?.success && response.data?.data) {
          const draft = response.data.data
          setIsDraft(draft.isDraft || false)
          setDraftId(id)
          
          // Load from draftData
          const draftData = draft.draftData || {}
          
          // Load assessment info
          if (draftData.settings) {
            setAssessmentInfo({
              title: draftData.settings.title || draft.title || '',
              description: draftData.settings.description || '',
              instructions: draftData.settings.instructions || '',
            })
            
            setTestSettings({
              passingPercentage: draftData.settings.passingPercentage || 50,
              shuffleQuestions: draftData.settings.shuffleQuestions || false,
              shuffleOptions: draftData.settings.shuffleOptions || false,
              allowNegativeMarking: draftData.settings.allowNegativeMarking || false,
              attemptLimit: draftData.settings.attemptLimit || 1,
            })
          } else {
            setAssessmentInfo({
              title: draft.title || '',
              description: draft.description || '',
              instructions: draft.instructions || '',
            })
          }
          
          // Load CSV raw data
          if (draftData.csvRawData) {
            setCsvContent(draftData.csvRawData)
          }
          
          // Load parsed questions
          if (draftData.parsedQuestions && draftData.parsedQuestions.length > 0) {
            setValidatedQuestions(draftData.parsedQuestions)
          }
          
          // Load sections
          if (draftData.sections && draftData.sections.length > 0) {
            setSections(draftData.sections)
          }
          
          // Load scheduling
          if (draftData.scheduling) {
            const startTime = draftData.scheduling.startTime ? new Date(draftData.scheduling.startTime).toISOString().slice(0, 16) : ''
            const endTime = draftData.scheduling.endTime ? new Date(draftData.scheduling.endTime).toISOString().slice(0, 16) : ''
            setSchedule({ startTime, endTime })
          }
          
          // Load candidates
          if (draftData.candidates && Array.isArray(draftData.candidates)) {
            setCandidates(draftData.candidates)
          }
          
          // Load proctoring settings
          if (draftData.proctoringSettings) {
            setProctoringSettings(draftData.proctoringSettings)
          }
          
          // Load timer settings
          if (draftData.settings?.timerMode) {
            setTimerMode(draftData.settings.timerMode)
            setExamDuration(draftData.settings.examDuration || 60)
            setSectionTimes(draftData.settings.sectionTimes || {})
          }
          
          // Navigate to correct step
          if (draft.progressStep) {
            setCurrentStep(draft.progressStep)
          }
          
          setIsLoadingTest(false)
          return
        }
      } catch (draftError) {
        // If draft load fails, try loading as regular test
        console.log('Not a draft, loading as regular test')
      }
      
      // Load as regular test
      response = await axios.get(`/api/custom-mcq/${id}`)
      if (response.data?.success && response.data?.data) {
        const test = response.data.data
        setIsDraft(test.isDraft || false)
        if (test.isDraft) {
          setDraftId(id)
        } else {
          setTestId(id)
        }
        
        // Load assessment info
        setAssessmentInfo({
          title: test.title || '',
          description: test.description || '',
          instructions: test.instructions || '',
        })
        
        // Load test settings
        setTestSettings({
          passingPercentage: test.passingPercentage || 50,
          shuffleQuestions: test.shuffleQuestions || false,
          shuffleOptions: test.shuffleOptions || false,
          allowNegativeMarking: test.allowNegativeMarking || false,
          attemptLimit: test.attemptLimit || 1,
        })
        
        // Load timer settings
        setTimerMode(test.timerMode || 'single-exam')
        setExamDuration(test.examDuration || 60)
        setSectionTimes(test.sectionTimes || {})
        
        // Load proctoring settings
        if (test.proctoring) {
          setProctoringSettings({
            enabled: test.proctoring.enabled || false,
            multiFaceDetection: test.proctoring.multiFaceDetection || false,
            fullscreenMonitoring: test.proctoring.fullscreenMonitoring || false,
            copyPasteBlocking: test.proctoring.copyPasteBlocking || false,
            tabSwitchDetection: test.proctoring.tabSwitchDetection || false,
            frameMatchRecognition: test.proctoring.frameMatchRecognition || false,
            externalDeviceDetection: test.proctoring.externalDeviceDetection || false,
            browserExtensionMonitoring: test.proctoring.browserExtensionMonitoring || false,
            concentrationTracking: test.proctoring.concentrationTracking || false,
            liveCameraAndScreenMonitoring: test.proctoring.liveCameraAndScreenMonitoring || false,
          })
        }
        
        // Load schedule
        if (test.schedule) {
          const startTime = test.schedule.startTime ? new Date(test.schedule.startTime).toISOString().slice(0, 16) : ''
          const endTime = test.schedule.endTime ? new Date(test.schedule.endTime).toISOString().slice(0, 16) : ''
          setSchedule({ startTime, endTime })
        }
        
        // Load access mode and candidates
        setAccessMode(test.accessMode || 'private')
        if (test.candidates && Array.isArray(test.candidates)) {
          setCandidates(test.candidates.map((c: any) => ({
            name: c.name || '',
            email: c.email || '',
            phone: c.phone || '',
          })))
        }
        
        // Load sections and questions
        if (test.sections && Array.isArray(test.sections)) {
          const loadedSections: Section[] = test.sections.map((section: any) => ({
            name: section.name || '',
            timeLimit: section.timeLimit,
            questions: section.questions.map((q: any) => ({
              section: section.name || '',
              question: q.question || '',
              optionA: q.options?.A || '',
              optionB: q.options?.B || '',
              optionC: q.options?.C || '',
              optionD: q.options?.D || '',
              correctAnswer: q.correctAnswer || 'A',
              marks: q.marks || 1,
            })),
          }))
          
          setSections(loadedSections)
          
          // Flatten questions for validatedQuestions
          const allQuestions: MCQQuestion[] = []
          loadedSections.forEach(section => {
            section.questions.forEach(q => {
              allQuestions.push(q)
            })
          })
          setValidatedQuestions(allQuestions)
          
          // Determine which step to show based on what's configured
          if (loadedSections.length > 0) {
            setCurrentStep(3) // Show preview/edit step
          } else if (assessmentInfo.title) {
            setCurrentStep(2) // Show CSV upload step
          }
        }
      }
    } catch (error: any) {
      console.error('Error loading test:', error)
      alert(error.response?.data?.message || 'Failed to load test')
    } finally {
      setIsLoadingTest(false)
    }
  }

  // Autosave draft function
  const saveDraft = async () => {
    const currentDraftId = draftId || testId
    if (!currentDraftId || !isDraft) return

    setSavingDraft(true)
    setDraftSaved(false)

    try {
      const draftData = {
        csvRawData: csvContent,
        parsedQuestions: validatedQuestions,
        sections: sections,
        settings: {
          ...assessmentInfo,
          ...testSettings,
          timerMode,
          examDuration,
          sectionTimes,
        },
        scheduling: schedule,
        candidates: candidates,
        proctoringSettings: proctoringSettings,
      }

      await axios.post(`/api/custom-mcq/update-draft?draftId=${currentDraftId}`, {
        draftData,
        progressStep: currentStep,
        timestamp: new Date().toISOString(),
      })

      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    } catch (error: any) {
      console.error('Error saving draft:', error)
    } finally {
      setSavingDraft(false)
    }
  }

  // Debounced autosave
  const debouncedSaveDraft = () => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }
    autosaveTimeoutRef.current = setTimeout(() => {
      saveDraft()
    }, 800)
  }

  // Autosave on any change
  useEffect(() => {
    if (draftId || (testId && isDraft)) {
      debouncedSaveDraft()
    }
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    csvContent,
    validatedQuestions,
    sections,
    assessmentInfo,
    testSettings,
    timerMode,
    examDuration,
    sectionTimes,
    schedule,
    candidates,
    proctoringSettings,
    currentStep,
  ])

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true)
    try {
      const response = await axios.get('/api/custom-mcq/csv-template')
      if (response.data?.success && response.data?.data?.template) {
        const template = response.data.data.template
        const blob = new Blob([template], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'custom_mcq_template.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      }
    } catch (error: any) {
      console.error('Error downloading template:', error)
      alert('Failed to download template')
    } finally {
      setIsDownloadingTemplate(false)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      alert('Please select a CSV file')
      return
    }

    setCsvFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setCsvContent(content)
    }
    reader.readAsText(file)
  }

  const handleValidateCSV = async () => {
    if (!csvContent.trim()) {
      alert('Please upload a CSV file first')
      return
    }

    setIsValidating(true)
    setValidationErrors([])
    setValidatedQuestions([])

    try {
      const response = await axios.post('/api/custom-mcq/validate-csv', {
        csvContent,
      })

      if (response.data?.success) {
        const data = response.data.data
        if (data.valid) {
          // Group questions by section
          const sectionsMap: Record<string, MCQQuestion[]> = {}
          data.questions.forEach((q: any) => {
            if (!sectionsMap[q.section]) {
              sectionsMap[q.section] = []
            }
            sectionsMap[q.section].push(q)
          })

          const sectionsList: Section[] = Object.entries(sectionsMap).map(([name, questions]) => ({
            name,
            questions,
          }))

          setSections(sectionsList)
          setValidatedQuestions(data.questions)
          setCurrentStep(3) // Move to preview/edit step
        } else {
          setValidationErrors(data.errors || ['Validation failed'])
        }
      }
    } catch (error: any) {
      console.error('Error validating CSV:', error)
      setValidationErrors([error.response?.data?.message || 'Failed to validate CSV'])
    } finally {
      setIsValidating(false)
    }
  }

  const handleEditQuestion = (index: number, field: string, value: any) => {
    const updated = [...validatedQuestions]
    updated[index] = { ...updated[index], [field]: value }
    setValidatedQuestions(updated)

    // Update sections
    const sectionsMap: Record<string, MCQQuestion[]> = {}
    updated.forEach((q) => {
      if (!sectionsMap[q.section]) {
        sectionsMap[q.section] = []
      }
      sectionsMap[q.section].push(q)
    })

    const sectionsList: Section[] = Object.entries(sectionsMap).map(([name, questions]) => ({
      name,
      questions,
    }))

    setSections(sectionsList)
  }

  const handleDeleteQuestion = (index: number) => {
    const updated = validatedQuestions.filter((_, i) => i !== index)
    setValidatedQuestions(updated)

    // Update sections
    const sectionsMap: Record<string, MCQQuestion[]> = {}
    updated.forEach((q) => {
      if (!sectionsMap[q.section]) {
        sectionsMap[q.section] = []
      }
      sectionsMap[q.section].push(q)
    })

    const sectionsList: Section[] = Object.entries(sectionsMap).map(([name, questions]) => ({
      name,
      questions,
    }))

    setSections(sectionsList)
  }

  const handleAddQuestion = () => {
    const newQuestion: MCQQuestion = {
      section: sections[0]?.name || 'section1',
      question: '',
      optionA: '',
      optionB: '',
      optionC: '',
      optionD: '',
      correctAnswer: 'A',
      marks: 1,
    }
    setValidatedQuestions([...validatedQuestions, newQuestion])
  }

  const handleAddCandidate = () => {
    if (!newCandidateName.trim() || !newCandidateEmail.trim()) {
      return
    }

    // Check for duplicate email
    const emailExists = candidates.some(
      c => c.email.toLowerCase().trim() === newCandidateEmail.toLowerCase().trim()
    )
    
    if (emailExists) {
      alert('A candidate with this email already exists')
      return
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(newCandidateEmail.trim())) {
      alert('Please enter a valid email address')
      return
    }

    setCandidates([
      ...candidates,
      {
        name: newCandidateName.trim(),
        email: newCandidateEmail.trim().toLowerCase(),
      }
    ])

    // Clear input fields
    setNewCandidateName('')
    setNewCandidateEmail('')
  }

  const handleCreateTest = async () => {
    // Validate all required fields
    if (!assessmentInfo.title.trim()) {
      alert('Please enter a test title')
      return
    }

    if (sections.length === 0 || validatedQuestions.length === 0) {
      alert('Please add at least one question')
      return
    }

    if (!schedule.startTime || !schedule.endTime) {
      alert('Please set the test schedule')
      return
    }

    if (accessMode === 'private' && candidates.length === 0) {
      alert('Please add at least one candidate for private mode')
      return
    }

    try {
      const payload = {
        settings: {
          title: assessmentInfo.title,
          description: assessmentInfo.description,
          instructions: assessmentInfo.instructions,
          ...testSettings,
        },
        sections: sections.map((section) => ({
          name: section.name,
          timeLimit: timerMode === 'per-section' ? sectionTimes[section.name] : undefined,
          questions: section.questions.map((q) => ({
            question: q.question,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            correctAnswer: q.correctAnswer,
            marks: q.marks,
          })),
        })),
        timerSettings: {
          timerMode,
          examDuration: timerMode === 'single-exam' ? examDuration : undefined,
          sectionTimes: timerMode === 'per-section' ? sectionTimes : undefined,
        },
        proctoringSettings,
        schedule: {
          startTime: new Date(schedule.startTime).toISOString(),
          endTime: new Date(schedule.endTime).toISOString(),
          candidateRequirements: {},
        },
        accessMode,
        candidates: accessMode === 'private' ? candidates : undefined,
      }

      let response
      if (testId) {
        // Update existing test
        response = await axios.put(`/api/custom-mcq/${testId}`, payload)
      } else {
        // Create new test
        response = await axios.post('/api/custom-mcq/create-test', payload)
      }

      if (response.data?.success) {
        const url = response.data.data.testUrl || response.data.data.test?.examAccessUrl
        const createdTestId = response.data.data.testId || testId
        
        if (url) {
          setTestUrl(url)
          setShowTestUrl(true)
          
          // Copy URL to clipboard
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).catch(console.error)
          }
        }
        
        // Show success message (without URL in alert)
        const message = testId 
          ? 'Custom MCQ Test updated successfully!'
          : 'Custom MCQ Test created successfully!'
        alert(message)
        
        // Don't redirect immediately - let user see the URL
        // router.push('/dashboard')
      }
    } catch (error: any) {
      console.error('Error creating test:', error)
      alert(error.response?.data?.message || 'Failed to create test')
    }
  }

  const totalSteps = 7
  const stepTitles = [
    'Assessment Information',
    'Upload CSV',
    'Preview & Edit Questions',
    'Test Settings',
    'Proctoring Settings',
    'Add Candidates',
    'Schedule Test',
  ]

  if (isLoadingTest) {
    return (
      <div style={{ backgroundColor: '#f8fafc', minHeight: '100vh', padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            border: '4px solid #e2e8f0',
            borderTopColor: '#6953a3',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem'
          }} />
          <p style={{ color: '#64748b' }}>Loading test data...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: '#f8fafc', minHeight: '100vh', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              padding: '0.5rem',
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1625', fontWeight: 700 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span>
                {testId || draftId ? (isDraft ? 'Edit Draft - Custom MCQ Test' : 'Edit Custom MCQ Test') : 'Create Custom MCQ Test (CSV)'}
              </span>
              {(savingDraft || draftSaved) && (
                <span style={{ fontSize: '0.875rem', color: savingDraft ? '#3b82f6' : '#10b981' }}>
                  {savingDraft ? 'Saving draft...' : draftSaved ? '✓ Draft saved' : ''}
                </span>
              )}
            </div>
          </h1>
        </div>

        {/* Progress Steps */}
        <div style={{ marginBottom: '2rem', backgroundColor: '#ffffff', padding: '1.5rem', borderRadius: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {stepTitles.map((title, index) => (
              <div key={index} style={{ flex: 1, textAlign: 'center' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    backgroundColor: currentStep > index + 1 ? '#10b981' : currentStep === index + 1 ? '#6953a3' : '#e2e8f0',
                    color: currentStep > index + 1 || currentStep === index + 1 ? '#ffffff' : '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 0.5rem',
                    fontWeight: 600,
                  }}
                >
                  {currentStep > index + 1 ? <CheckCircle size={20} /> : index + 1}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{title}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div style={{ backgroundColor: '#ffffff', padding: '2rem', borderRadius: '0.5rem', marginBottom: '2rem' }}>
          {/* Step 1: Assessment Information */}
          {currentStep === 1 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Assessment Information</h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#1a1625' }}>
                    Assessment Title *
                  </label>
                  <input
                    type="text"
                    value={assessmentInfo.title}
                    onChange={(e) => setAssessmentInfo({ ...assessmentInfo, title: e.target.value })}
                    placeholder="Enter assessment title"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                      fontSize: '1rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#1a1625' }}>
                    Description
                  </label>
                  <textarea
                    value={assessmentInfo.description}
                    onChange={(e) => setAssessmentInfo({ ...assessmentInfo, description: e.target.value })}
                    placeholder="Enter assessment description"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                      minHeight: '100px',
                      fontSize: '1rem',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#1a1625' }}>
                    Instructions
                  </label>
                  <textarea
                    value={assessmentInfo.instructions}
                    onChange={(e) => setAssessmentInfo({ ...assessmentInfo, instructions: e.target.value })}
                    placeholder="Enter assessment instructions for candidates (e.g., rules, guidelines, time limits, etc.)"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                      minHeight: '150px',
                      fontSize: '1rem',
                      fontFamily: 'inherit',
                    }}
                  />
                  <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#64748b' }}>
                    These instructions will be shown to candidates before they start the test.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Upload CSV */}
          {currentStep === 2 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Upload CSV File</h2>
              
              <div style={{ 
                marginBottom: '1.5rem', 
                padding: '1.5rem', 
                backgroundColor: '#f0f9ff', 
                border: '1px solid #bae6fd', 
                borderRadius: '0.5rem' 
              }}>
                <h3 style={{ margin: '0 0 1rem 0', color: '#0369a1', fontSize: '1rem', fontWeight: 600 }}>
                  📋 CSV Format Requirements
                </h3>
                <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#0369a1', fontSize: '0.875rem', lineHeight: '1.8' }}>
                  <li><strong>Required Columns:</strong> section, question, optionA, optionB, optionC, optionD, correctAnswer, marks</li>
                  <li><strong>Exactly 4 Options:</strong> Each MCQ question must have exactly 4 options (A, B, C, D) only. No additional options (E, F, etc.) are supported.</li>
                  <li><strong>Correct Answer:</strong> Must be exactly A, B, C, or D (case-insensitive)</li>
                  <li><strong>Marks:</strong> Must be a positive integer (e.g., 1, 2, 5)</li>
                  <li><strong>Section:</strong> Cannot be empty. Use descriptive names (e.g., aptitude, logical_reasoning, technical_mcq)</li>
                  <li><strong>Maximum Questions:</strong> 2000 questions per test</li>
                  <li><strong>Empty Rows:</strong> Empty rows will be automatically skipped</li>
                </ul>
              </div>
              
              <div style={{ marginBottom: '2rem' }}>
                <button
                  onClick={handleDownloadTemplate}
                  disabled={isDownloadingTemplate}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: '#6953a3',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '1rem',
                  }}
                >
                  <Download size={20} />
                  {isDownloadingTemplate ? 'Downloading...' : 'Download CSV Template'}
                </button>
                <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.5rem', lineHeight: '1.6' }}>
                  The CSV template includes sample questions with the correct format. 
                  <strong> Each question must have exactly 4 options (optionA, optionB, optionC, optionD).</strong> 
                  The correctAnswer must be one of: A, B, C, or D.
                </p>
              </div>

              <div
                style={{
                  border: '2px dashed #e2e8f0',
                  borderRadius: '0.5rem',
                  padding: '3rem',
                  textAlign: 'center',
                  marginBottom: '1rem',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <Upload size={48} style={{ color: '#64748b', marginBottom: '1rem' }} />
                <p style={{ color: '#64748b', marginBottom: '1rem' }}>
                  {csvFile ? csvFile.name : 'Click to upload or drag and drop CSV file'}
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  Select File
                </button>
              </div>

              {csvContent && (
                <div style={{ marginTop: '1rem' }}>
                  <button
                    onClick={handleValidateCSV}
                    disabled={isValidating}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    {isValidating ? 'Validating...' : 'Validate CSV'}
                  </button>
                </div>
              )}

              {validationErrors.length > 0 && (
                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fef2f2', borderRadius: '0.5rem' }}>
                  <h3 style={{ color: '#dc2626', marginBottom: '0.5rem' }}>Validation Errors:</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                    {validationErrors.map((error, index) => (
                      <li key={index} style={{ color: '#dc2626' }}>
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview & Edit Questions */}
          {currentStep === 3 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Preview & Edit Questions</h2>
              
              <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ color: '#64748b' }}>
                  Total Questions: {validatedQuestions.length} | Sections: {sections.length}
                </p>
                <button
                  onClick={handleAddQuestion}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Plus size={16} />
                  Add Question
                </button>
              </div>

              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {validatedQuestions.map((question, index) => (
                  <div
                    key={index}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                      padding: '1rem',
                      marginBottom: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong>Question {index + 1}</strong>
                      <button
                        onClick={() => handleDeleteQuestion(index)}
                        style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          border: 'none',
                          borderRadius: '0.25rem',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#64748b' }}>
                          Section
                        </label>
                        <input
                          type="text"
                          value={question.section}
                          onChange={(e) => handleEditQuestion(index, 'section', e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #e2e8f0',
                            borderRadius: '0.25rem',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#64748b' }}>
                          Marks
                        </label>
                        <input
                          type="number"
                          value={question.marks}
                          onChange={(e) => handleEditQuestion(index, 'marks', parseInt(e.target.value) || 1)}
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #e2e8f0',
                            borderRadius: '0.25rem',
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#64748b' }}>
                        Question
                      </label>
                      <textarea
                        value={question.question}
                        onChange={(e) => handleEditQuestion(index, 'question', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          border: '1px solid #e2e8f0',
                          borderRadius: '0.25rem',
                          minHeight: '60px',
                        }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                      {['A', 'B', 'C', 'D'].map((option) => (
                        <div key={option}>
                          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#64748b' }}>
                            Option {option}
                          </label>
                          <input
                            type="text"
                            value={question[`option${option}` as keyof MCQQuestion] as string}
                            onChange={(e) => handleEditQuestion(index, `option${option}`, e.target.value)}
                            style={{
                              width: '100%',
                              padding: '0.5rem',
                              border: '1px solid #e2e8f0',
                              borderRadius: '0.25rem',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#64748b' }}>
                        Correct Answer
                      </label>
                      <select
                        value={question.correctAnswer}
                        onChange={(e) => handleEditQuestion(index, 'correctAnswer', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          border: '1px solid #e2e8f0',
                          borderRadius: '0.25rem',
                        }}
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Test Settings */}
          {currentStep === 4 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Test Settings</h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Passing Percentage</label>
                  <input
                    type="number"
                    value={testSettings.passingPercentage}
                    onChange={(e) => setTestSettings({ ...testSettings, passingPercentage: parseFloat(e.target.value) || 50 })}
                    min="0"
                    max="100"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={testSettings.shuffleQuestions}
                      onChange={(e) => setTestSettings({ ...testSettings, shuffleQuestions: e.target.checked })}
                    />
                    Shuffle Questions
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={testSettings.shuffleOptions}
                      onChange={(e) => setTestSettings({ ...testSettings, shuffleOptions: e.target.checked })}
                    />
                    Shuffle Options
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={testSettings.allowNegativeMarking}
                      onChange={(e) => setTestSettings({ ...testSettings, allowNegativeMarking: e.target.checked })}
                    />
                    Allow Negative Marking
                  </label>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Attempt Limit</label>
                  <input
                    type="number"
                    value={testSettings.attemptLimit}
                    onChange={(e) => setTestSettings({ ...testSettings, attemptLimit: parseInt(e.target.value) || 1 })}
                    min="1"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Timer Mode</label>
                  <select
                    value={timerMode}
                    onChange={(e) => setTimerMode(e.target.value as 'per-section' | 'single-exam')}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                    }}
                  >
                    <option value="single-exam">Single Exam Timer</option>
                    <option value="per-section">Per-Section Timer</option>
                  </select>
                </div>

                {timerMode === 'single-exam' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Exam Duration (minutes)</label>
                    <input
                      type="number"
                      value={examDuration}
                      onChange={(e) => setExamDuration(parseInt(e.target.value) || 60)}
                      min="1"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                      }}
                    />
                  </div>
                )}

                {timerMode === 'per-section' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Section Times (minutes)</label>
                    {sections.map((section) => (
                      <div key={section.name} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ minWidth: '150px' }}>{section.name}:</span>
                        <input
                          type="number"
                          value={sectionTimes[section.name] || 0}
                          onChange={(e) => setSectionTimes({ ...sectionTimes, [section.name]: parseInt(e.target.value) || 0 })}
                          min="1"
                          style={{
                            flex: 1,
                            padding: '0.5rem',
                            border: '1px solid #e2e8f0',
                            borderRadius: '0.25rem',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 5: Proctoring Settings */}
          {currentStep === 5 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Proctoring Settings</h2>
              
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={proctoringSettings.enabled}
                    onChange={(e) => setProctoringSettings({ ...proctoringSettings, enabled: e.target.checked })}
                  />
                  Enable Proctoring
                </label>
              </div>

              {proctoringSettings.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {Object.entries(proctoringSettings)
                    .filter(([key]) => key !== 'enabled')
                    .map(([key, value]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={value as boolean}
                          onChange={(e) => setProctoringSettings({ ...proctoringSettings, [key]: e.target.checked })}
                        />
                        {key
                          .replace(/([A-Z])/g, ' $1')
                          .replace(/^./, (str) => str.toUpperCase())
                          .replace(/Mcq/g, 'MCQ')
                          .replace(/Id/g, 'ID')}
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Step 6: Add Candidates */}
          {currentStep === 6 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Add Candidates</h2>
              
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Access Mode</label>
                <select
                  value={accessMode}
                  onChange={(e) => setAccessMode(e.target.value as 'private' | 'public')}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.5rem',
                  }}
                >
                  <option value="private">Private (Email invitation required)</option>
                  <option value="public">Public (Anyone with link can take test)</option>
                </select>
              </div>

              {accessMode === 'private' && (
                <div>
                  {/* Add Candidate Input Section */}
                  <div style={{ 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '0.5rem', 
                    padding: '1rem', 
                    marginBottom: '1.5rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr auto',
                    gap: '1rem',
                    alignItems: 'center',
                  }}>
                    <input
                      type="text"
                      placeholder="Candidate Name"
                      value={newCandidateName}
                      onChange={(e) => setNewCandidateName(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && newCandidateName.trim() && newCandidateEmail.trim()) {
                          handleAddCandidate()
                        }
                      }}
                      style={{
                        padding: '0.75rem',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                        fontSize: '0.95rem',
                      }}
                    />
                    <input
                      type="email"
                      placeholder="Candidate Email"
                      value={newCandidateEmail}
                      onChange={(e) => setNewCandidateEmail(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && newCandidateName.trim() && newCandidateEmail.trim()) {
                          handleAddCandidate()
                        }
                      }}
                      style={{
                        padding: '0.75rem',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                        fontSize: '0.95rem',
                      }}
                    />
                    <button
                      onClick={handleAddCandidate}
                      disabled={!newCandidateName.trim() || !newCandidateEmail.trim()}
                      style={{
                        padding: '0.75rem 1.5rem',
                        backgroundColor: newCandidateName.trim() && newCandidateEmail.trim() ? '#10b981' : '#9ca3af',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '0.5rem',
                        cursor: newCandidateName.trim() && newCandidateEmail.trim() ? 'pointer' : 'not-allowed',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Candidates List */}
                  {candidates.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600, color: '#1a1625' }}>
                        Added Candidates ({candidates.length})
                      </h3>
                      {candidates.map((candidate, index) => (
                        <div
                          key={index}
                          style={{
                            border: '1px solid #e2e8f0',
                            borderRadius: '0.5rem',
                            padding: '1rem',
                            marginBottom: '0.75rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            backgroundColor: '#f8fafc',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: '#1a1625', marginBottom: '0.25rem' }}>
                              {candidate.name}
                            </div>
                            <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                              {candidate.email}
                            </div>
                          </div>
                          <button
                            onClick={() => setCandidates(candidates.filter((_, i) => i !== index))}
                            style={{
                              padding: '0.5rem',
                              backgroundColor: '#fef2f2',
                              color: '#dc2626',
                              border: 'none',
                              borderRadius: '0.25rem',
                              cursor: 'pointer',
                            }}
                            title="Remove candidate"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 7: Schedule Test */}
          {currentStep === 7 && (
            <div>
              <h2 style={{ marginBottom: '1.5rem', color: '#1a1625' }}>Schedule Test</h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Start Time (IST) *</label>
                  <input
                    type="datetime-local"
                    value={schedule.startTime}
                    onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>End Time (IST) *</label>
                  <input
                    type="datetime-local"
                    value={schedule.endTime}
                    onChange={(e) => setSchedule({ ...schedule, endTime: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Test URL Display (shown after creation) */}
        {showTestUrl && testUrl && (
          <div style={{
            marginBottom: '2rem',
            padding: '1.5rem',
            backgroundColor: '#f0fdf4',
            border: '2px solid #10b981',
            borderRadius: '0.75rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: '0.5rem', fontSize: '1.125rem', fontWeight: 600, color: '#065f46' }}>
                  ✓ Test {testId ? 'Updated' : 'Created'} Successfully!
                </h3>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#047857' }}>
                  Test URL has been copied to your clipboard
                </p>
              </div>
              <button
                onClick={() => {
                  setShowTestUrl(false)
                  router.push('/dashboard')
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#10b981',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}
              >
                Go to Dashboard
              </button>
            </div>
            <div style={{
              padding: '1rem',
              backgroundColor: '#ffffff',
              border: '1px solid #10b981',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                  Test URL:
                </label>
                <input
                  type="text"
                  value={testUrl}
                  readOnly
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    backgroundColor: '#f9fafb',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              <button
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(testUrl)
                    alert('URL copied to clipboard!')
                  }
                }}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#6953a3',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Copy URL
              </button>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: currentStep === 1 ? '#e2e8f0' : '#f8fafc',
              color: currentStep === 1 ? '#94a3b8' : '#1a1625',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
              cursor: currentStep === 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>

          {currentStep === 1 && (
            <button
              onClick={() => {
                if (!assessmentInfo.title.trim()) {
                  alert('Please enter an assessment title')
                  return
                }
                setCurrentStep(2)
              }}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#6953a3',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              Next
            </button>
          )}

          {currentStep > 1 && currentStep < totalSteps && (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#6953a3',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              Next
            </button>
          )}

          {currentStep === totalSteps && (
            <button
              onClick={handleCreateTest}
              disabled={isLoadingTest}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: isLoadingTest ? 'not-allowed' : 'pointer',
                opacity: isLoadingTest ? 0.6 : 1,
              }}
            >
              {isLoadingTest ? 'Loading...' : testId ? 'Update Test' : 'Create Test'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export const getServerSideProps: GetServerSideProps = requireAuth

