from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class MCQOption(BaseModel):
    """MCQ Option model"""
    label: str  # A, B, C, D, E, etc.
    text: str


class MCQQuestion(BaseModel):
    """MCQ Question model"""
    id: Optional[str] = None
    section: str
    question: str
    options: List[MCQOption]  # Dynamic options (A, B, C, D, E, ...)
    correctAn: str  # Single: "A" or Multiple: "A,B" or "A,B,C"
    answerType: str = Field(default="single", pattern=r"^(single|multiple_all|multiple_any)$")
    marks: int = Field(default=1, ge=1)
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class Candidate(BaseModel):
    """Candidate model"""
    name: str
    email: str


class CreateCustomMCQAssessmentRequest(BaseModel):
    """Request to create a custom MCQ assessment"""
    title: str
    description: Optional[str] = None
    questions: List[MCQQuestion]
    candidates: Optional[List[Candidate]] = None
    accessMode: str = Field(default="private", pattern=r"^(private|public)$")
    examMode: str = Field(default="strict", pattern=r"^(strict|flexible)$")
    startTime: Optional[datetime] = None
    endTime: Optional[datetime] = None
    duration: Optional[int] = None  # In minutes, for flexible mode
    passPercentage: int = Field(default=50, ge=0, le=100)


class UpdateCustomMCQAssessmentRequest(BaseModel):
    """Request to update a custom MCQ assessment"""
    title: Optional[str] = None
    description: Optional[str] = None
    questions: Optional[List[MCQQuestion]] = None
    candidates: Optional[List[Candidate]] = None
    accessMode: Optional[str] = Field(default=None, pattern=r"^(private|public)$")
    examMode: Optional[str] = Field(default=None, pattern=r"^(strict|flexible)$")
    startTime: Optional[datetime] = None
    endTime: Optional[datetime] = None
    duration: Optional[int] = None
    passPercentage: Optional[int] = Field(default=None, ge=0, le=100)


class ValidateCSVRequest(BaseModel):
    """Request to validate CSV file"""
    csvData: List[Dict[str, Any]]


class CandidateSubmission(BaseModel):
    """Candidate submission model"""
    questionId: str
    selectedAnswers: List[str]  # List of selected option labels (e.g., ["A", "B"])


class SubmitCustomMCQRequest(BaseModel):
    """Request to submit custom MCQ answers"""
    assessmentId: str
    token: str
    email: str
    name: str
    submissions: List[CandidateSubmission]
    startedAt: Optional[datetime] = None
    submittedAt: Optional[datetime] = None


class VerifyCustomMCQCandidateRequest(BaseModel):
    """Request to verify candidate access to custom MCQ"""
    assessmentId: str
    token: str
    email: str
    name: str

