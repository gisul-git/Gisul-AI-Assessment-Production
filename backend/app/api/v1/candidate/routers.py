"""
Candidate API endpoints for assessment taking.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

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
        
        # Check if assessment is paused
        assessment_status = assessment.get("status")
        if assessment_status == "paused":
            # Check if candidate has already started (has startedAt)
            candidates = assessment.get("candidates", [])
            candidate_entry = None
            for candidate in candidates:
                if (candidate.get("email", "").lower() == request.email.lower() and
                    candidate.get("name", "").strip().lower() == request.name.strip().lower()):
                    candidate_entry = candidate
                    break
            
            # If candidate has started before pause, allow them to continue
            if candidate_entry and candidate_entry.get("startedAt"):
                # Allow continuation
                pass
            else:
                # New entry attempt - block with user-friendly message
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="This assessment is currently paused. Please try again later."
                )
        
        # Check assessment start time validation (no access time window)
        from datetime import datetime
        schedule = assessment.get("schedule") or {}
        # Check examMode in both assessment root and schedule - be explicit
        exam_mode = assessment.get("examMode")
        if exam_mode is None and isinstance(schedule, dict):
            exam_mode = schedule.get("examMode")
        if exam_mode is None:
            exam_mode = "strict"  # Default to strict if not set
        # Ensure it's a string (handle case where it might be stored differently)
        exam_mode = str(exam_mode).lower() if exam_mode else "strict"
        
        start_time_str = schedule.get("startTime") if isinstance(schedule, dict) else None
        # Also check assessment root for startTime (some assessments might store it there)
        if not start_time_str:
            start_time_str = assessment.get("startTime")
        
        end_time_str = schedule.get("endTime") if isinstance(schedule, dict) else None
        if not end_time_str:
            end_time_str = assessment.get("endTime")
        
        # Use IST (Indian Standard Time) for AI assessments
        IST = ZoneInfo("Asia/Kolkata")
        now = datetime.now(IST).replace(tzinfo=None)  # Make naive for comparison
        
        # Log initial state for debugging
        logger.info(f"[Verify Candidate] ========== ACCESS VALIDATION START ==========")
        logger.info(f"[Verify Candidate] Assessment ID: {assessment_id}")
        logger.info(f"[Verify Candidate] Exam Mode: {exam_mode}")
        logger.info(f"[Verify Candidate] Start Time String: {start_time_str}")
        logger.info(f"[Verify Candidate] End Time String: {end_time_str}")
        logger.info(f"[Verify Candidate] Current Time (IST): {now}")
        logger.info(f"[Verify Candidate] ===============================================")
        
        # Validate access time based on exam mode
        if exam_mode == "strict":
            logger.info(f"[Verify Candidate] STRICT MODE - Validating start time...")
            if not start_time_str:
                logger.warning(f"[Verify Candidate] Strict mode but no startTime found. Assessment: {assessment_id}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Assessment schedule is not properly configured. Please contact the administrator."
                )
            else:
                try:
                    # Parse start time - handle various formats
                    # Times are stored in UTC, convert to IST for comparison
                    start_time_str_clean = start_time_str.replace('Z', '+00:00') if 'Z' in start_time_str else start_time_str
                    if '+' not in start_time_str_clean and '-' not in start_time_str_clean[10:]:
                        # No timezone info, assume UTC
                        start_time_str_clean = start_time_str_clean + '+00:00'
                    
                    # Parse as UTC time
                    start_time_utc = datetime.fromisoformat(start_time_str_clean)
                    if start_time_utc.tzinfo is None:
                        start_time_utc = start_time_utc.replace(tzinfo=timezone.utc)
                    
                    # Convert UTC to IST for comparison
                    IST = ZoneInfo("Asia/Kolkata")
                    start_time = start_time_utc.astimezone(IST).replace(tzinfo=None)
                    
                    logger.info(f"[Verify Candidate] Time check - Now (IST): {now}, Start Time (IST): {start_time}")
                    
                    # Block access if current time is before start time
                    if now < start_time:
                        start_time_formatted = start_time.strftime('%Y-%m-%d %H:%M:%S IST')
                        error_message = f"The assessment has not started yet. The assessment will begin at {start_time_formatted}."
                        logger.warning(f"[Verify Candidate] Access DENIED - before start time. Now: {now}, Start: {start_time_formatted}")
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail=error_message
                        )
                    else:
                        logger.info(f"[Verify Candidate] Access ALLOWED - start time has passed. Now: {now}, Start: {start_time}")
                except HTTPException:
                    # Re-raise HTTP exceptions (access denied) - this is critical
                    raise http_exc
                except (ValueError, AttributeError, TypeError) as e:
                    logger.error(f"[Verify Candidate] CRITICAL: Failed to parse start time for access validation: {e}, start_time_str: {start_time_str}, assessment_id: {assessment_id}")
                    # For strict mode, if we can't parse the time, BLOCK access (be strict)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Assessment schedule configuration error. Please contact the administrator. (Error: {str(e)})"
                    )
        elif exam_mode == "flexible":
            # For flexible mode, check if we're within the window (startTime to endTime)
            end_time_str = schedule.get("endTime") if isinstance(schedule, dict) else None
            # Also check assessment root for endTime
            if not end_time_str:
                end_time_str = assessment.get("endTime")
            
            if start_time_str and end_time_str:
                try:
                    # Parse start and end times - convert from UTC to IST
                    IST = ZoneInfo("Asia/Kolkata")
                    
                    start_time_str_clean = start_time_str.replace('Z', '+00:00') if 'Z' in start_time_str else start_time_str
                    end_time_str_clean = end_time_str.replace('Z', '+00:00') if 'Z' in end_time_str else end_time_str
                    
                    if '+' not in start_time_str_clean and '-' not in start_time_str_clean[10:]:
                        start_time_str_clean = start_time_str_clean + '+00:00'
                    if '+' not in end_time_str_clean and '-' not in end_time_str_clean[10:]:
                        end_time_str_clean = end_time_str_clean + '+00:00'
                    
                    # Parse as UTC times
                    start_time_utc = datetime.fromisoformat(start_time_str_clean)
                    end_time_utc = datetime.fromisoformat(end_time_str_clean)
                    if start_time_utc.tzinfo is None:
                        start_time_utc = start_time_utc.replace(tzinfo=timezone.utc)
                    if end_time_utc.tzinfo is None:
                        end_time_utc = end_time_utc.replace(tzinfo=timezone.utc)
                    
                    # Convert to IST for comparison
                    start_time = start_time_utc.astimezone(IST).replace(tzinfo=None)
                    end_time = end_time_utc.astimezone(IST).replace(tzinfo=None)
                    
                    logger.info(f"[Verify Candidate] FLEXIBLE MODE - Time check - Now (IST): {now}, Start (IST): {start_time}, End (IST): {end_time}")
                    
                    if now < start_time:
                        # Before window opens
                        start_time_formatted = start_time.strftime('%Y-%m-%d %H:%M:%S IST')
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"The assessment window has not opened yet. The assessment will be available from {start_time_formatted}."
                        )
                    elif now > end_time:
                        # After window closes
                        end_time_formatted = end_time.strftime('%Y-%m-%d %H:%M:%S IST')
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"The assessment window has closed. The assessment was available until {end_time_formatted}."
                        )
                    else:
                        logger.info(f"[Verify Candidate] Access ALLOWED - within flexible window")
                except HTTPException as http_exc:
                    raise http_exc
                except (ValueError, AttributeError, TypeError) as e:
                    logger.error(f"[Verify Candidate] Failed to parse times for flexible mode: {e}")
                    # Allow access if parsing fails (graceful degradation)
        
        # IMPORTANT: If we reach here, access time validation has passed (or was not required)
        # Now check token and access mode
        
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
        
    except HTTPException as http_exc:
        # Re-raise HTTPExceptions as-is (they have proper status codes)
        raise http_exc
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
                "email": request.email,
                "name": request.name,
            }
        else:
            # Update email and name if not already set
            if "email" not in assessment["candidateResponses"][candidate_key]:
                assessment["candidateResponses"][candidate_key]["email"] = request.email
            if "name" not in assessment["candidateResponses"][candidate_key]:
                assessment["candidateResponses"][candidate_key]["name"] = request.name
        
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
