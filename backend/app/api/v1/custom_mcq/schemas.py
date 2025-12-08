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

