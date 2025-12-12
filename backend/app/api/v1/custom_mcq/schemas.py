from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, validator


class MCQQuestion(BaseModel):
    """
    Single MCQ question structure.
    
    IMPORTANT: MCQ questions support exactly 4 options (A, B, C, D) only.
    No additional options (E, F, etc.) are supported.
    """
    question: str = Field(..., description="Question text")
    optionA: str = Field(..., description="Option A (required - exactly 4 options supported)")
    optionB: str = Field(..., description="Option B (required - exactly 4 options supported)")
    optionC: str = Field(..., description="Option C (required - exactly 4 options supported)")
    optionD: str = Field(..., description="Option D (required - exactly 4 options supported)")
    correctAnswer: str = Field(..., description="Correct answer (must be exactly A, B, C, or D - only 4 options supported)")
    marks: int = Field(..., gt=0, description="Marks for this question")

    @validator("correctAnswer")
    def validate_correct_answer(cls, v):
        v_upper = v.upper().strip()
        if v_upper not in ["A", "B", "C", "D"]:
            raise ValueError("correctAnswer must be exactly A, B, C, or D (only 4 options are supported)")
        return v_upper


class Section(BaseModel):
    """Section containing multiple MCQ questions."""
    name: str = Field(..., description="Section name")
    timeLimit: Optional[int] = Field(None, description="Time limit in minutes (for per-section timer)")
    questions: List[MCQQuestion] = Field(default_factory=list, description="Questions in this section")


class CustomMCQTestSettings(BaseModel):
    """Test settings for custom MCQ test."""
    title: str = Field(..., description="Test title")
    description: Optional[str] = Field(None, description="Test description")
    instructions: Optional[str] = Field(None, description="Test instructions")
    passingPercentage: float = Field(50.0, ge=0, le=100, description="Passing percentage")
    shuffleQuestions: bool = Field(False, description="Shuffle questions within sections")
    shuffleOptions: bool = Field(False, description="Shuffle options for each question")
    allowNegativeMarking: bool = Field(False, description="Allow negative marking for wrong answers")
    attemptLimit: int = Field(1, ge=1, description="Maximum number of attempts allowed")


class TimerSettings(BaseModel):
    """Timer configuration."""
    timerMode: str = Field(..., description="'per-section' or 'single-exam'")
    examDuration: Optional[int] = Field(None, description="Total exam duration in minutes (for single-exam mode)")
    sectionTimes: Optional[Dict[str, int]] = Field(None, description="Time per section in minutes (for per-section mode)")


class ProctoringSettings(BaseModel):
    """Proctoring configuration."""
    enabled: bool = Field(False, description="Enable proctoring")
    multiFaceDetection: bool = Field(False, description="Multiple face detection")
    fullscreenMonitoring: bool = Field(False, description="Fullscreen monitoring")
    copyPasteBlocking: bool = Field(False, description="Copy-paste blocking")
    tabSwitchDetection: bool = Field(False, description="Tab switching detection")
    frameMatchRecognition: bool = Field(False, description="Frame capture + face matching")
    externalDeviceDetection: bool = Field(False, description="External device detection")
    browserExtensionMonitoring: bool = Field(False, description="Browser extension monitoring")
    concentrationTracking: bool = Field(False, description="User concentration tracking")
    liveCameraAndScreenMonitoring: bool = Field(False, description="Live camera + screen monitoring")


class CandidateInfo(BaseModel):
    """Candidate information."""
    name: str = Field(..., description="Candidate name")
    email: str = Field(..., description="Candidate email")
    phone: Optional[str] = Field(None, description="Candidate phone number")


class ScheduleSettings(BaseModel):
    """Schedule configuration."""
    startTime: datetime = Field(..., description="Test start time (IST)")
    endTime: datetime = Field(..., description="Test end time (IST)")
    candidateRequirements: Optional[Dict[str, bool]] = Field(None, description="Required candidate fields")


class CreateCustomMCQTestRequest(BaseModel):
    """Request to create a custom MCQ test."""
    settings: CustomMCQTestSettings
    sections: List[Section]
    timerSettings: TimerSettings
    proctoringSettings: ProctoringSettings
    schedule: ScheduleSettings
    accessMode: str = Field("private", description="'private' or 'public'")
    candidates: Optional[List[CandidateInfo]] = Field(None, description="List of candidates (for private mode)")


class CSVUploadRequest(BaseModel):
    """Request to upload and validate CSV."""
    csvContent: str = Field(..., description="CSV file content as string")


class CSVValidationResponse(BaseModel):
    """Response from CSV validation."""
    valid: bool
    errors: List[str] = Field(default_factory=list)
    questions: List[Dict[str, Any]] = Field(default_factory=list)
    sections: List[str] = Field(default_factory=list)


class DraftData(BaseModel):
    """Draft data structure for Custom MCQ Test."""
    csvRawData: Optional[str] = Field(None, description="Raw CSV content")
    parsedQuestions: List[Dict[str, Any]] = Field(default_factory=list, description="Parsed questions from CSV")
    sections: List[Dict[str, Any]] = Field(default_factory=list, description="Section structure")
    settings: Optional[Dict[str, Any]] = Field(None, description="Test settings")
    scheduling: Optional[Dict[str, Any]] = Field(None, description="Schedule settings")
    candidates: List[Dict[str, Any]] = Field(default_factory=list, description="Candidate list")
    proctoringSettings: Optional[Dict[str, Any]] = Field(None, description="Proctoring settings")


class CreateDraftRequest(BaseModel):
    """Request to create a new draft."""
    title: Optional[str] = Field(None, description="Optional title for the draft")


class UpdateDraftRequest(BaseModel):
    """Request to update a draft."""
    draftData: DraftData
    progressStep: int = Field(..., ge=1, le=7, description="Current step (1-7)")
    timestamp: Optional[str] = Field(None, description="Optional timestamp")


class PublishDraftRequest(BaseModel):
    """Request to publish a draft."""
    # All fields from CreateCustomMCQTestRequest are required for publishing
    settings: CustomMCQTestSettings
    sections: List[Section]
    timerSettings: TimerSettings
    proctoringSettings: ProctoringSettings
    schedule: ScheduleSettings
    accessMode: str = Field("private", description="'private' or 'public'")
    candidates: Optional[List[CandidateInfo]] = Field(None, description="List of candidates (for private mode)")


# =====================================================================
# Frontend-compatible schemas for Custom MCQ Assessment API
# =====================================================================

class MCQOption(BaseModel):
    """MCQ option with label and text."""
    label: str = Field(..., description="Option label (A, B, C, D, etc.)")
    text: str = Field(..., description="Option text")


class FrontendMCQQuestion(BaseModel):
    """Frontend MCQ question format."""
    id: Optional[str] = Field(None, description="Question ID")
    section: str = Field(..., description="Section name")
    question: str = Field(..., description="Question text")
    options: List[MCQOption] = Field(..., description="List of options")
    correctAn: str = Field(..., description="Correct answer(s) - single: 'A' or multiple: 'A,B'")
    answerType: str = Field("single", description="Answer type: 'single', 'multiple_all', or 'multiple_any'")
    marks: int = Field(..., gt=0, description="Marks for this question")
    createdAt: Optional[str] = Field(None, description="Creation timestamp")
    updatedAt: Optional[str] = Field(None, description="Update timestamp")


class Candidate(BaseModel):
    """Candidate information for frontend format."""
    name: str = Field(..., description="Candidate name")
    email: str = Field(..., description="Candidate email")


class CreateCustomMCQAssessmentRequest(BaseModel):
    """Request to create a custom MCQ assessment (frontend format)."""
    title: str = Field(..., description="Assessment title")
    description: Optional[str] = Field(None, description="Assessment description")
    questions: List[FrontendMCQQuestion] = Field(default_factory=list, description="List of questions")
    candidates: Optional[List[Candidate]] = Field(None, description="List of candidates")
    accessMode: str = Field("private", description="'private' or 'public'")
    examMode: str = Field("strict", description="'strict' or 'flexible'")
    startTime: Optional[datetime] = Field(None, description="Start time (for strict mode)")
    endTime: Optional[datetime] = Field(None, description="End time (for strict mode)")
    duration: Optional[int] = Field(None, description="Duration in minutes (for flexible mode)")
    passPercentage: float = Field(50.0, ge=0, le=100, description="Passing percentage")
    status: Optional[str] = Field("draft", description="Assessment status")
    currentStation: Optional[int] = Field(1, description="Current station/step")


class UpdateCustomMCQAssessmentRequest(BaseModel):
    """Request to update a custom MCQ assessment (frontend format)."""
    title: Optional[str] = Field(None, description="Assessment title")
    description: Optional[str] = Field(None, description="Assessment description")
    questions: Optional[List[FrontendMCQQuestion]] = Field(None, description="List of questions")
    candidates: Optional[List[Candidate]] = Field(None, description="List of candidates")
    accessMode: Optional[str] = Field(None, description="'private' or 'public'")
    examMode: Optional[str] = Field(None, description="'strict' or 'flexible'")
    startTime: Optional[datetime] = Field(None, description="Start time (for strict mode)")
    endTime: Optional[datetime] = Field(None, description="End time (for strict mode)")
    duration: Optional[int] = Field(None, description="Duration in minutes (for flexible mode)")
    passPercentage: Optional[float] = Field(None, ge=0, le=100, description="Passing percentage")
    status: Optional[str] = Field(None, description="Assessment status")
    currentStation: Optional[int] = Field(None, description="Current station/step")


class ValidateCSVRequest(BaseModel):
    """Request to validate CSV data."""
    csvData: List[Dict[str, Any]] = Field(..., description="CSV data as list of dictionaries")


class CandidateSubmission(BaseModel):
    """Candidate submission for a question."""
    questionId: str = Field(..., description="Question ID")
    selectedAnswers: List[str] = Field(..., description="Selected answer(s)")


class SubmitCustomMCQRequest(BaseModel):
    """Request to submit custom MCQ answers."""
    assessmentId: str = Field(..., description="Assessment ID")
    token: str = Field(..., description="Assessment token")
    email: str = Field(..., description="Candidate email")
    name: str = Field(..., description="Candidate name")
    submissions: List[CandidateSubmission] = Field(..., description="List of question submissions")
    startedAt: Optional[datetime] = Field(None, description="Start time")
    submittedAt: Optional[datetime] = Field(None, description="Submit time")


class VerifyCustomMCQCandidateRequest(BaseModel):
    """Request to verify candidate access."""
    assessmentId: str = Field(..., description="Assessment ID")
    token: str = Field(..., description="Assessment token")
    email: str = Field(..., description="Candidate email")
    name: str = Field(..., description="Candidate name")


class InvitationTemplate(BaseModel):
    """Email invitation template."""
    subject: Optional[str] = Field(None, description="Email subject template")
    message: Optional[str] = Field(None, description="Email message template")
    footer: Optional[str] = Field(None, description="Email footer")
    sentBy: Optional[str] = Field(None, description="Sender name")


class SendCustomMCQInvitationRequest(BaseModel):
    """Request to send invitation emails."""
    assessmentId: str = Field(..., description="Assessment ID")
    candidates: List[Candidate] = Field(..., description="List of candidates to invite")
    template: Optional[InvitationTemplate] = Field(None, description="Email template")
