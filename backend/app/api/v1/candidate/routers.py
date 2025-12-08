"""
Candidate API endpoints for assessment taking.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from ....db.mongo import get_db
from ....utils.mongo import serialize_document, to_object_id
from ....utils.responses import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/candidate", tags=["candidate"])


class VerifyCandidateRequest(BaseModel):
    """Request to verify candidate access."""
    assessmentId: str
    token: str
    email: str
    name: str


class MarkPrecheckCompleteRequest(BaseModel):
    """Request to mark precheck as complete."""
    assessmentId: str
    token: str
    email: str
    name: str
    precheckResults: Optional[Dict[str, Any]] = None


class SubmitAnswersRequest(BaseModel):
    """Request to submit final answers."""
    assessmentId: str
    token: str
    email: str
    name: str
    answers: list[Dict[str, Any]] = Field(default_factory=list)
    skippedQuestions: list[int] = Field(default_factory=list)
    attemptId: Optional[str] = None
    timerRemaining: Optional[int] = None
    submissionMetadata: Optional[Dict[str, Any]] = None


@router.post("/verify-candidate")
async def verify_candidate(
    request: VerifyCandidateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Verify candidate access to an assessment.
    
    Checks if the candidate is allowed to access the assessment based on:
    - Assessment access mode (public/private)
    - Candidate list (for private mode)
    - Token validation
    """
    try:
        assessment_id = to_object_id(request.assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Check token (basic validation - you may want to enhance this)
        # For now, we'll just check if the assessment exists and is accessible
        
        access_mode = assessment.get("accessMode", "private")
        
        # For public mode, anyone with the link can access
        if access_mode == "public":
            return success_response({
                "verified": True,
                "accessMode": "public",
                "message": "Access granted"
            })
        
        # For private mode, check candidate list
        candidates = assessment.get("candidates", [])
        candidate_found = False
        
        for candidate in candidates:
            if (candidate.get("email", "").lower() == request.email.lower() and
                candidate.get("name", "").strip().lower() == request.name.strip().lower()):
                candidate_found = True
                break
        
        if not candidate_found:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to access this assessment"
            )
        
        return success_response({
            "verified": True,
            "accessMode": "private",
            "message": "Access granted"
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error verifying candidate: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to verify candidate: {str(e)}"
        )


@router.post("/mark-precheck-complete")
async def mark_precheck_complete(
    request: MarkPrecheckCompleteRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Mark precheck as complete for a candidate.
    """
    try:
        assessment_id = to_object_id(request.assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Store precheck completion in candidate responses
        candidate_key = f"{request.email.lower()}_{request.name.strip().lower()}"
        
        if "candidateResponses" not in assessment:
            assessment["candidateResponses"] = {}
        
        if candidate_key not in assessment["candidateResponses"]:
            assessment["candidateResponses"][candidate_key] = {}
        
        assessment["candidateResponses"][candidate_key]["precheckCompleted"] = True
        assessment["candidateResponses"][candidate_key]["precheckCompletedAt"] = datetime.now(timezone.utc)
        if request.precheckResults:
            assessment["candidateResponses"][candidate_key]["precheckResults"] = request.precheckResults
        
        await db.assessments.update_one(
            {"_id": assessment_id},
            {"$set": {"candidateResponses": assessment["candidateResponses"]}}
        )
        
        return success_response({
            "message": "Precheck marked as complete"
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error marking precheck complete: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to mark precheck complete: {str(e)}"
        )


@router.get("/get-assessment-full")
async def get_assessment_full(
    assessmentId: str = Query(..., description="Assessment ID"),
    token: str = Query(..., description="Access token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get full assessment details including topics_v2, timer settings, and proctoring config.
    """
    try:
        assessment_id = to_object_id(assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Serialize and return assessment
        assessment_serialized = serialize_document(assessment)
        
        return success_response({
            "assessment": assessment_serialized
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting assessment full: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get assessment: {str(e)}"
        )


@router.get("/get-assessment-questions")
async def get_assessment_questions(
    assessmentId: str = Query(..., description="Assessment ID"),
    token: str = Query(..., description="Access token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get all questions for an assessment.
    """
    try:
        assessment_id = to_object_id(assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Extract questions from topics_v2
        questions = []
        topics_v2 = assessment.get("topics_v2", [])
        
        for topic in topics_v2:
            question_rows = topic.get("questionRows", [])
            for row in question_rows:
                row_questions = row.get("questions", [])
                for q in row_questions:
                    question_obj = {
                        **q,
                        "topicId": topic.get("id"),
                        "topicLabel": topic.get("label"),
                        "rowId": row.get("rowId"),
                        "questionType": row.get("questionType"),
                        "difficulty": row.get("difficulty"),
                    }
                    questions.append(question_obj)
        
        # Fallback to old topics structure if topics_v2 is empty
        if not questions:
            old_topics = assessment.get("topics", [])
            for topic in old_topics:
                topic_questions = topic.get("questions", [])
                for q in topic_questions:
                    questions.append(q)
        
        return success_response({
            "questions": questions,
            "totalQuestions": len(questions)
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting assessment questions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get questions: {str(e)}"
        )


@router.get("/get-assessment-schedule")
async def get_assessment_schedule(
    assessmentId: str = Query(..., description="Assessment ID"),
    token: str = Query(..., description="Access token"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get assessment schedule and candidate requirements.
    """
    try:
        assessment_id = to_object_id(assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        schedule = assessment.get("schedule", {})
        candidate_requirements = schedule.get("candidateRequirements", {})
        
        return success_response({
            "schedule": schedule,
            "candidateRequirements": candidate_requirements
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting assessment schedule: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get schedule: {str(e)}"
        )


@router.post("/submit-answers")
async def submit_answers(
    request: SubmitAnswersRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Submit final answers for an assessment.
    """
    try:
        assessment_id = to_object_id(request.assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Store candidate responses
        candidate_key = f"{request.email.lower()}_{request.name.strip().lower()}"
        
        if "candidateResponses" not in assessment:
            assessment["candidateResponses"] = {}
        
        if candidate_key not in assessment["candidateResponses"]:
            assessment["candidateResponses"][candidate_key] = {
                "logs": [],
                "answers": {},
            }
        
        # Store answers
        assessment["candidateResponses"][candidate_key]["answers"] = {
            "submitted": request.answers,
            "skipped": request.skippedQuestions,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
            "timerRemaining": request.timerRemaining,
            "metadata": request.submissionMetadata or {},
        }
        
        # Mark as completed
        assessment["candidateResponses"][candidate_key]["status"] = "completed"
        assessment["candidateResponses"][candidate_key]["completedAt"] = datetime.now(timezone.utc)
        
        # Log submission event
        if "logs" not in assessment["candidateResponses"][candidate_key]:
            assessment["candidateResponses"][candidate_key]["logs"] = []
        
        assessment["candidateResponses"][candidate_key]["logs"].append({
            "eventType": "ASSESSMENT_SUBMITTED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "attemptId": request.attemptId,
                "answersCount": len(request.answers),
                "skippedCount": len(request.skippedQuestions),
                "timerRemaining": request.timerRemaining,
            }
        })
        
        await db.assessments.update_one(
            {"_id": assessment_id},
            {"$set": {"candidateResponses": assessment["candidateResponses"]}}
        )
        
        return success_response({
            "message": "Answers submitted successfully",
            "submittedAt": datetime.now(timezone.utc).isoformat()
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error submitting answers: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit answers: {str(e)}"
        )
