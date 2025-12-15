import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import { customMCQApi } from "../../lib/custom-mcq/api";
import { CustomMCQAssessment, MCQQuestion, Candidate } from "../../types/custom-mcq";
import {
  Station1AssessmentInfo,
  Station2UploadCSV,
  Station3ReviewEdit,
  Station4AddCandidates,
  Station5Schedule,
} from "../../components/custom-mcq";

interface CreateCustomMCQPageProps {
  session: any;
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
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh", padding: "2rem" }}>
      <div className="container" style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 style={{ margin: 0, color: "#1E5A3B" }}>Create Custom MCQ Assessment</h1>
          {isSaving && (
            <span style={{ fontSize: "0.875rem", color: "#2D7A52", fontStyle: "italic" }}>
              💾 Saving draft...
            </span>
          )}
        </div>

        {/* Metro Station Navigation */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "3rem",
            padding: "1.5rem",
            backgroundColor: "#E8FAF0",
            borderRadius: "0.75rem",
            border: "1px solid #A8E8BC",
            position: "relative",
          }}
        >
          {/* Connection Line */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "5%",
              right: "5%",
              height: "3px",
              backgroundColor: currentStation > 1 ? "#2D7A52" : "#A8E8BC",
              zIndex: 0,
            }}
          />

          {stations.map((station, idx) => {
            const isActive = currentStation === station.id;
            const isCompleted = currentStation > station.id;
            const isAccessible = currentStation >= station.id || isCompleted;

            return (
              <div
                key={station.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  position: "relative",
                  zIndex: 1,
                  cursor: isAccessible ? "pointer" : "not-allowed",
                  flex: 1,
                }}
                onClick={() => {
                  if (isAccessible) {
                    setCurrentStation(station.id);
                  }
                }}
              >
                <div
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    backgroundColor: isActive
                      ? "#2D7A52"
                      : isCompleted
                      ? "#10b981"
                      : "#A8E8BC",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.5rem",
                    color: "#ffffff",
                    marginBottom: "0.5rem",
                    border: "3px solid #ffffff",
                    boxShadow: isActive ? "0 0 0 3px #C9F4D4" : "none",
                    transition: "all 0.3s ease",
                  }}
                >
                  {isCompleted && !isActive ? "✓" : station.icon}
                </div>
                <div
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#1E5A3B" : isCompleted ? "#2D7A52" : "#4A9A6A",
                    textAlign: "center",
                  }}
                >
                  {station.name}
                </div>
                {isActive && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#2D7A52",
                      marginTop: "0.25rem",
                      fontWeight: 500,
                    }}
                  >
                    Current
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error Message */}
        {error && (
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

        {/* Station Content */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #A8E8BC",
            borderRadius: "0.75rem",
            padding: "2rem",
            marginBottom: "2rem",
            minHeight: "400px",
          }}
        >
          {currentStation === 1 && (
            <Station1AssessmentInfo
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 2 && (
            <Station2UploadCSV
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 3 && (
            <Station3ReviewEdit
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 4 && (
            <Station4AddCandidates
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 5 && (
            <Station5Schedule
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
              onCreateAssessment={handleCreateAssessment}
              loading={loading}
              createdAssessmentUrl={createdAssessmentUrl}
              assessmentId={assessmentId}
              router={router}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentStation === 1}
            className="btn-secondary"
            style={{
              padding: "0.75rem 1.5rem",
              opacity: currentStation === 1 ? 0.5 : 1,
              cursor: currentStation === 1 ? "not-allowed" : "pointer",
            }}
          >
            ← Previous
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

          {currentStation < 5 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={!canProceedToNext()}
              className="btn-primary"
              style={{
                padding: "0.75rem 1.5rem",
                opacity: canProceedToNext() ? 1 : 0.5,
                cursor: canProceedToNext() ? "pointer" : "not-allowed",
              }}
            >
              Next →
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;

