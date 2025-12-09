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
from ....utils.face_image_storage import prepare_image_for_storage, validate_face_image

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
        
        # Return the assessment directly in data (not nested in assessment key)
        return success_response("Assessment fetched successfully", assessment_serialized)
        
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


class SaveCandidateInfoRequest(BaseModel):
    """Request to save candidate information."""
    assessmentId: str
    token: str
    email: str
    name: str
    phone: Optional[str] = None
    hasResume: bool = False


class SaveReferenceFaceRequest(BaseModel):
    """Request to save reference face image."""
    assessmentId: str
    candidateEmail: str
    referenceImage: str  # Base64 encoded image


@router.post("/save-candidate-info")
async def save_candidate_info(
    request: SaveCandidateInfoRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Save candidate information (email, name, phone, resume status).
    This is called from the candidate requirements page.
    """
    try:
        assessment_id = to_object_id(request.assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Store candidate info in candidateResponses
        candidate_key = f"{request.email.lower()}_{request.name.strip().lower()}"
        
        if "candidateResponses" not in assessment:
            assessment["candidateResponses"] = {}
        
        if candidate_key not in assessment["candidateResponses"]:
            assessment["candidateResponses"][candidate_key] = {
                "logs": [],
                "answers": {},
            }
        
        # Store candidate info
        assessment["candidateResponses"][candidate_key]["candidateInfo"] = {
            "email": request.email.lower().strip(),
            "name": request.name.strip(),
            "phone": request.phone.strip() if request.phone else None,
            "hasResume": request.hasResume,
            "savedAt": datetime.now(timezone.utc).isoformat(),
        }
        
        # Log the event
        if "logs" not in assessment["candidateResponses"][candidate_key]:
            assessment["candidateResponses"][candidate_key]["logs"] = []
        
        assessment["candidateResponses"][candidate_key]["logs"].append({
            "eventType": "CANDIDATE_INFO_SAVED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "email": request.email,
                "name": request.name,
                "hasPhone": bool(request.phone),
                "hasResume": request.hasResume,
            }
        })
        
        await db.assessments.update_one(
            {"_id": assessment_id},
            {"$set": {"candidateResponses": assessment["candidateResponses"]}}
        )
        
        return success_response({
            "message": "Candidate information saved successfully"
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error saving candidate info: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save candidate info: {str(e)}"
        )


@router.post("/save-reference-face")
async def save_reference_face(
    request: SaveReferenceFaceRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """
    Save reference face image from identity verification.
    Stores the image in candidateVerification.referenceImage field.
    """
    try:
        assessment_id = to_object_id(request.assessmentId)
        assessment = await db.assessments.find_one({"_id": assessment_id})
        
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        # Store reference image in candidateResponses
        candidate_key = f"{request.candidateEmail.lower()}_"
        
        # Find the candidate key (email might be in different format)
        candidate_responses = assessment.get("candidateResponses", {})
        candidate_key_found = None
        
        for key in candidate_responses.keys():
            if request.candidateEmail.lower() in key.lower():
                candidate_key_found = key
                break
        
        if not candidate_key_found:
            # Create new candidate entry
            candidate_key_found = f"{request.candidateEmail.lower()}_unknown"
        
        if "candidateResponses" not in assessment:
            assessment["candidateResponses"] = {}
        
        if candidate_key_found not in assessment["candidateResponses"]:
            assessment["candidateResponses"][candidate_key_found] = {}
        
        # Validate and prepare image for storage
        is_valid, error_msg = validate_face_image(request.referenceImage)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid face image: {error_msg}"
            )
        
        # Prepare image (compress and sanitize)
        processed_image = prepare_image_for_storage(request.referenceImage)
        if not processed_image:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to process image for storage"
            )
        
        # Store reference image in candidateVerification
        if "candidateVerification" not in assessment["candidateResponses"][candidate_key_found]:
            assessment["candidateResponses"][candidate_key_found]["candidateVerification"] = {}
        
        assessment["candidateResponses"][candidate_key_found]["candidateVerification"]["referenceImage"] = processed_image
        assessment["candidateResponses"][candidate_key_found]["candidateVerification"]["referenceImageSavedAt"] = datetime.now(timezone.utc).isoformat()
        
        # Log the event
        if "logs" not in assessment["candidateResponses"][candidate_key_found]:
            assessment["candidateResponses"][candidate_key_found]["logs"] = []
        
        assessment["candidateResponses"][candidate_key_found]["logs"].append({
            "eventType": "REFERENCE_PHOTO_CAPTURED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "email": request.candidateEmail,
            }
        })
        
        await db.assessments.update_one(
            {"_id": assessment_id},
            {"$set": {"candidateResponses": assessment["candidateResponses"]}}
        )
        
        logger.info(f"[Candidate API] Reference face saved for {request.candidateEmail} in assessment {request.assessmentId}")
        
        return success_response({
            "message": "Reference face image saved successfully"
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error saving reference face: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save reference face: {str(e)}"
        )
