from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


QUESTION_TYPES = {"MCQ", "Subjective", "Pseudo Code", "Descriptive", "Aptitude", "Reasoning", "coding"}
DIFFICULTY_LEVELS = {"Easy", "Medium", "Hard"}
STATUS_VALUES = {"draft", "ready", "scheduled", "active", "completed"}


class QuestionConfig(BaseModel):
    questionNumber: int = Field(..., ge=1)
    type: str = Field(...)
    difficulty: str = Field(default="Medium")

    def model_post_init(self, __context: dict[str, object]) -> None:
        if self.type not in QUESTION_TYPES:
            raise ValueError("Invalid question type")
        if self.difficulty not in DIFFICULTY_LEVELS:
            raise ValueError("Invalid difficulty level")


class Question(BaseModel):
    questionText: str
    type: str
    difficulty: str
    options: Optional[List[str]] = None
    correctAnswer: Optional[str] = None
    idealAnswer: Optional[str] = None
    expectedLogic: Optional[str] = None
    time: Optional[int] = None  # Time in minutes
    score: Optional[int] = None  # Score in points
    judge0_enabled: Optional[bool] = None  # For coding questions: whether Judge0 is enabled
    language: Optional[str] = None  # For coding questions: selected language ID (e.g., "50" for C)
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class TopicUpdate(BaseModel):
    topic: str
    numQuestions: Optional[int] = None
    questionTypes: Optional[List[str]] = None
    difficulty: Optional[str] = None
    questions: Optional[List[Question]] = None
    questionConfigs: Optional[List[QuestionConfig]] = None


class AptitudeCategoryConfig(BaseModel):
    enabled: bool = False
    difficulty: str = Field(default="Medium")
    numQuestions: int = Field(default=0, ge=0)

    def model_post_init(self, __context: dict[str, object]) -> None:
        if self.difficulty not in DIFFICULTY_LEVELS:
            raise ValueError("Invalid difficulty level")


class AptitudeConfig(BaseModel):
    quantitative: Optional[AptitudeCategoryConfig] = None
    logicalReasoning: Optional[AptitudeCategoryConfig] = None
    verbalAbility: Optional[AptitudeCategoryConfig] = None
    numericalReasoning: Optional[AptitudeCategoryConfig] = None


class GenerateTopicsRequestOld(BaseModel):
    """Old GenerateTopicsRequest - kept for backward compatibility."""
    assessmentType: List[str] = Field(..., min_length=1)  # ["aptitude"], ["technical"], or ["aptitude", "technical"]
    # Technical fields (required only if "technical" is in assessmentType)
    jobRole: Optional[str] = None
    experience: Optional[str] = None
    skills: Optional[List[str]] = None
    numTopics: Optional[int] = Field(default=None, gt=0)  # Number of topics to generate for technical assessment
    # Aptitude fields (required only if "aptitude" is in assessmentType)
    aptitudeConfig: Optional[AptitudeConfig] = None


class UpdateTopicSettingsRequest(BaseModel):
    assessmentId: str
    updatedTopics: List[TopicUpdate]


class AddCustomTopicsRequest(BaseModel):
    assessmentId: str
    newTopics: List[TopicUpdate | str]


class RemoveCustomTopicsRequest(BaseModel):
    assessmentId: str
    topicsToRemove: List[str]


class GenerateQuestionsRequest(BaseModel):
    assessmentId: str


class UpdateQuestionsRequest(BaseModel):
    assessmentId: str
    topic: str
    updatedQuestions: List[Question]


class UpdateSingleQuestionRequest(BaseModel):
    assessmentId: str
    topic: str
    questionIndex: int = Field(..., ge=0)
    updatedQuestion: Question


class AddNewQuestionRequest(BaseModel):
    assessmentId: str
    topic: str
    newQuestion: Question


class DeleteQuestionRequest(BaseModel):
    assessmentId: str
    topic: str
    questionIndex: int = Field(..., ge=0)


class DeleteTopicQuestionsRequest(BaseModel):
    assessmentId: str
    topic: Optional[str] = None  # If None, deletes questions for all topics


class UpdateAssessmentDraftRequest(BaseModel):
    assessmentId: Optional[str] = None  # Optional: if not provided, backend will find existing draft
    title: Optional[str] = None
    description: Optional[str] = None
    jobDesignation: Optional[str] = None
    selectedSkills: Optional[List[str]] = None
    experienceMin: Optional[int] = None
    experienceMax: Optional[int] = None
    experienceMode: Optional[str] = Field(default=None, pattern=r"^(corporate|student)$")
    topics: Optional[List[Dict[str, Any]]] = None  # Old topics structure
    topics_v2: Optional[List[Dict[str, Any]]] = None  # New topics_v2 structure
    previewQuestions: Optional[List[Dict[str, Any]]] = None
    questions: Optional[List[Dict[str, Any]]] = None
    questionTypeTimes: Optional[Dict[str, int]] = None
    enablePerSectionTimers: Optional[bool] = None
    sectionTimers: Optional[Dict[str, int]] = None
    scoringRules: Optional[Dict[str, int]] = None
    passPercentage: Optional[float] = None
    schedule: Optional[Dict[str, Any]] = None
    candidates: Optional[List[Dict[str, Any]]] = None
    assessmentUrl: Optional[str] = None
    proctoringSettings: Optional[Dict[str, bool]] = None


class FinalizeAssessmentRequest(BaseModel):
    assessmentId: str
    title: Optional[str] = None
    description: Optional[str] = None
    questionTypeTimes: Optional[Dict[str, int]] = None  # Time in minutes per question type
    enablePerSectionTimers: Optional[bool] = True  # Whether to enable per-section timers
    passPercentage: Optional[float] = Field(default=None, ge=0, le=100)  # Pass percentage (0-100)


class LogAnswerRequest(BaseModel):
    assessmentId: str = Field(..., min_length=1, max_length=100)
    token: str = Field(..., min_length=1, max_length=200)
    email: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=200)
    questionIndex: int = Field(..., ge=0)
    answer: str = Field(..., max_length=50000)  # Max 50KB answer text
    questionType: str = Field(..., max_length=50)


# New flow schemas
class GenerateTopicsFromSkillRequest(BaseModel):
    skill: str = Field(..., min_length=1)
    experienceMin: str = Field(default="0")
    experienceMax: str = Field(default="10")
    experienceMode: Optional[str] = Field(default="corporate", pattern=r"^(corporate|student)$")


class RegenerateSingleTopicRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    assessmentId: Optional[str] = None  # If provided, regenerates topic based on assessment skills


class GenerateTopicCardsRequest(BaseModel):
    jobDesignation: str = Field(..., min_length=1)
    experienceMin: Optional[int] = Field(default=0, ge=0, le=20)
    experienceMax: Optional[int] = Field(default=10, ge=0, le=20)
    experienceMode: Optional[str] = Field(default="corporate", pattern=r"^(corporate|student)$")
    assessmentTitle: Optional[str] = Field(default=None, max_length=255)


class CreateAssessmentFromJobDesignationRequest(BaseModel):
    assessmentId: Optional[str] = Field(default=None, description="Optional: If provided, updates existing assessment instead of creating new one")
    jobDesignation: str = Field(..., min_length=1)
    selectedSkills: List[str] = Field(..., min_length=1)
    experienceMin: str = Field(default="0")
    experienceMax: str = Field(default="10")
    experienceMode: Optional[str] = Field(default="corporate", pattern=r"^(corporate|student)$")


class TopicConfigRow(BaseModel):
    topic: str
    questionType: str
    difficulty: str = Field(default="Medium")
    numQuestions: int = Field(default=1, ge=1)
    # Aptitude topic fields
    isAptitude: Optional[bool] = False
    subTopic: Optional[str] = None
    # Coding question fields
    judge0_enabled: Optional[bool] = None  # For coding questions: whether Judge0 is enabled
    language: Optional[str] = None  # For coding questions: selected language ID


# ============================================
# NEW MULTI-ROW TOPIC DATA MODEL (STRICT STRUCTURE)
# ============================================
class QuestionRowModel(BaseModel):
    """Question row within a topic - supports multiple question types per topic."""
    rowId: str = Field(..., description="Unique row identifier")
    questionType: str = Field(..., pattern=r"^(MCQ|Subjective|PseudoCode|Coding)$")
    difficulty: str = Field(..., pattern=r"^(Easy|Medium|Hard)$")
    questionsCount: int = Field(..., ge=1, le=20, description="Number of questions to generate")
    canUseJudge0: bool = Field(default=False, description="ONLY relevant for Coding type")
    status: str = Field(default="pending", pattern=r"^(pending|generated)$")
    locked: bool = Field(default=False, description="Whether this row is locked")
    questions: List[Dict] = Field(default_factory=list, description="Generated questions (filled after generation)")


class TopicModel(BaseModel):
    """Strict topic data model with multiple question rows - MUST follow exact structure."""
    id: str = Field(..., description="Unique topic identifier")
    label: str = Field(..., description="Topic name/label")
    locked: bool = Field(default=False, description="Whether topic is locked from regeneration")
    questionRows: List[QuestionRowModel] = Field(..., min_length=1, description="Array of question type rows")


class GenerateTopicsRequest(BaseModel):
    """Request to generate topics based on assessment context."""
    assessmentId: Optional[str] = None
    assessmentTitle: Optional[str] = None
    jobDesignation: str = Field(..., min_length=1)
    selectedSkills: List[str] = Field(..., min_length=1)
    experienceMin: int = Field(default=0, ge=0, le=20)
    experienceMax: int = Field(default=10, ge=0, le=20)
    experienceMode: str = Field(default="corporate", pattern=r"^(corporate|student)$")


class RegenerateTopicRequest(BaseModel):
    """Request to regenerate a single topic."""
    assessmentId: str
    topicId: str
    assessmentTitle: Optional[str] = None
    jobDesignation: str
    selectedSkills: List[str]
    experienceMin: int
    experienceMax: int
    experienceMode: str


class GenerateQuestionRequest(BaseModel):
    """Request to generate questions for a single question row."""
    assessmentId: str
    topicId: str
    rowId: str = Field(..., description="ID of the question row to generate questions for")
    topicLabel: str
    questionType: str = Field(..., pattern=r"^(MCQ|Subjective|PseudoCode|Coding)$")
    difficulty: str = Field(..., pattern=r"^(Easy|Medium|Hard)$")
    questionsCount: int = Field(..., ge=1, le=20)
    canUseJudge0: bool = Field(default=False)
    # Optional context fields for better question generation
    category: Optional[str] = None
    experienceMin: Optional[int] = None
    experienceMax: Optional[int] = None
    experienceMode: Optional[str] = None


class AddQuestionRowRequest(BaseModel):
    """Request to add a new question row to a topic."""
    assessmentId: str
    topicId: str


class RemoveQuestionRowRequest(BaseModel):
    """Request to remove a question row from a topic."""
    assessmentId: str
    topicId: str
    rowId: str


class RegenerateSingleQuestionRequest(BaseModel):
    """Request to regenerate a single question within a row."""
    assessmentId: str
    topicId: str
    rowId: str
    questionIndex: int = Field(..., ge=0)


class UpdateSingleQuestionRequestV2(BaseModel):
    """Request to update a single question within a row (topicsV2 structure)."""
    assessmentId: str
    topicId: str
    rowId: str
    questionIndex: int = Field(..., ge=0)
    question: Dict[str, Any]  # The updated question object


class GenerateAllQuestionsRequest(BaseModel):
    """Request to generate questions for all pending topics."""
    assessmentId: str
    topics: List[TopicModel]


class SuggestTopicsRequest(BaseModel):
    """Request for AI-powered topic suggestions."""
    category: str = Field(..., pattern=r"^(aptitude|communication|logical_reasoning|technical|auto)$")
    query: str = Field(..., min_length=0)


class ClassifyTechnicalTopicRequest(BaseModel):
    """Request to classify a technical topic."""
    topic: str = Field(..., min_length=1)


class GenerateQuestionsFromConfigRequest(BaseModel):
    assessmentId: str
    skill: str
    topics: List[TopicConfigRow]


class ScheduleCandidateQuestions(BaseModel):
    allowed: bool = True
    maxQuestions: int = 3
    timeLimit: int = 5
    questions: List[dict] = Field(default_factory=list)


class ProctoringOptions(BaseModel):
    enabled: bool = False
    webcamRequired: bool = False
    screenRecording: bool = False
    browserLock: bool = False
    fullScreenMode: bool = False


class ScheduleUpdateRequest(BaseModel):
    startTime: datetime
    endTime: datetime
    duration: int = Field(..., gt=0)
    durationUnit: Optional[str] = Field(default="hours")
    attemptCount: Optional[int] = Field(default=1, ge=1)
    proctoringOptions: Optional[ProctoringOptions] = None
    vpnRequired: Optional[bool] = False
    linkSharingEnabled: Optional[bool] = False
    mailFeedbackReport: Optional[bool] = False
    candidateQuestions: Optional[ScheduleCandidateQuestions] = None
    instructions: Optional[str] = None
    timezone: Optional[str] = Field(default="UTC")
    isActive: Optional[bool] = False


class AssessmentScheduleUpdateRequest(BaseModel):
    assessmentId: str
    schedule: ScheduleUpdateRequest


class ValidateQuestionTypeRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    questionType: str = Field(..., min_length=1)
