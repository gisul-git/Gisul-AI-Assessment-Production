"""
Custom MCQ Assessment API endpoints.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from ....core.dependencies import require_editor, get_current_user
from ....db.mongo import get_db
from ....utils.mongo import serialize_document, to_object_id
from ....utils.responses import success_response, error_response
from .schemas import (
    CreateCustomMCQTestRequest,
    CSVUploadRequest,
    CSVValidationResponse,
    ProctoringSettings,
    ScheduleSettings,
    TimerSettings,
    CreateDraftRequest,
    UpdateDraftRequest,
    PublishDraftRequest,
    DraftData,
)
from .services import (
    generate_csv_template,
    group_questions_by_section,
    parse_csv_content,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/custom-mcq", tags=["custom-mcq"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _generate_assessment_token() -> str:
    """Generate a secure token for assessment access"""
    return secrets.token_urlsafe(32)


def _parse_csv_to_questions(csv_data: List[Dict[str, Any]]) -> List[MCQQuestion]:
    """Parse CSV data to MCQQuestion objects"""
    questions = []
    
    for idx, row in enumerate(csv_data):
        try:
            # Extract section and question
            section = str(row.get("section", "")).strip()
            question_text = str(row.get("question", "")).strip()
            
            if not question_text:
                continue
            
            # Extract options dynamically (optionA, optionB, optionC, ...)
            options = []
            option_labels = []
            option_idx = 0
            option_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            
            # Find all option columns
            for key, value in row.items():
                if key.lower().startswith("option") and value:
                    label = option_letters[option_idx] if option_idx < len(option_letters) else str(option_idx + 1)
                    options.append({
                        "label": label,
                        "text": str(value).strip()
                    })
                    option_labels.append(label)
                    option_idx += 1
            
            if not options:
                logger.warning(f"Row {idx + 1}: No options found, skipping")
                continue
            
            # Extract correct answer
            correct_an = str(row.get("correctAn", "")).strip().upper()
            if not correct_an:
                logger.warning(f"Row {idx + 1}: No correct answer specified, skipping")
                continue
            
            # Extract answer type
            answer_type = str(row.get("answerType", "single")).strip().lower()
            if answer_type not in ["single", "multiple_all", "multiple_any"]:
                answer_type = "single"
            
            # Extract marks
            try:
                marks = int(row.get("marks", 1))
                if marks < 1:
                    marks = 1
            except (ValueError, TypeError):
                marks = 1
            
            # Validate correct answer(s) exist in options
            correct_answers = [a.strip() for a in correct_an.split(",")]
            invalid_answers = [a for a in correct_answers if a not in option_labels]
            if invalid_answers:
                logger.warning(f"Row {idx + 1}: Invalid correct answers {invalid_answers}, skipping")
                continue
            
            question = MCQQuestion(
                section=section,
                question=question_text,
                options=[{"label": opt["label"], "text": opt["text"]} for opt in options],
                correctAn=correct_an,
                answerType=answer_type,
                marks=marks,
            )
            questions.append(question)
            
        except Exception as e:
            logger.error(f"Error parsing row {idx + 1}: {e}")
            continue
    
    return questions


@router.post("/validate-csv")
async def validate_csv(
    request: ValidateCSVRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
) -> Dict[str, Any]:
    """Validate CSV data and parse it into questions"""
    try:
        questions = _parse_csv_to_questions(request.csvData)
        
        if not questions:
            return error_response("No valid questions found in CSV", status_code=400)
        
        # Return parsed questions for review
        questions_dict = [q.model_dump() for q in questions]
        
        return success_response(
            f"CSV validated successfully. Found {len(questions)} valid questions.",
            {"questions": questions_dict, "totalQuestions": len(questions)}
        )
        
    except Exception as e:
        logger.exception(f"Error validating CSV: {e}")
        return error_response(f"Failed to validate CSV: {str(e)}", status_code=500)


@router.post("/upload-csv", response_model=None)
async def upload_csv(
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(require_editor),
) -> Dict[str, Any]:
    """Upload and parse CSV file"""
    try:
        if not file.filename.endswith('.csv'):
            return error_response("File must be a CSV file", status_code=400)
        
        contents = await file.read()
        text = contents.decode('utf-8')
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(text))
        csv_data = list(csv_reader)
        
        if not csv_data:
            return error_response("CSV file is empty", status_code=400)
        
        # Validate and parse questions
        questions = _parse_csv_to_questions(csv_data)
        
        if not questions:
            return error_response("No valid questions found in CSV", status_code=400)
        
        questions_dict = [q.model_dump() for q in questions]
        
        return success_response(
            f"CSV uploaded successfully. Found {len(questions)} valid questions.",
            {"questions": questions_dict, "totalQuestions": len(questions)}
        )
        
    except Exception as e:
        logger.exception(f"Error uploading CSV: {e}")
        return error_response(f"Failed to upload CSV: {str(e)}", status_code=500)


@router.get("/sample-csv")
async def download_sample_csv(
    current_user: Dict[str, Any] = Depends(require_editor),
) -> Any:
    """Download sample CSV file"""
    from fastapi.responses import Response
    
    # Sample CSV content
    sample_csv = """section,question,optionA,optionB,optionC,optionD,optionE,optionF,correctAn,answerType,marks
aptitude,What is 2+2?,2,3,4,5,,,C,single,1
logical_re,Select all prime numbers,2,4,5,6,7,8,"A,C,E",multiple_all,1
verbal,Choose synonym (any one) ,happy,joyful,angry,sad,,,"A,B",multiple_any,1
technical,What does CPU stand for?,Computer,processing,Central Processing Unit,Computer Central Unit,,,B,single,1
quantitative,What is the square of 3?,6,9,12,15,,,B,single,1"""
    
    return Response(
        content=sample_csv,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sample_mcq.csv"}
    )


@router.post("/create")
async def create_custom_mcq_assessment(
    request: CreateCustomMCQAssessmentRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """Create a new custom MCQ assessment (supports draft and scheduled status)"""
    try:
        user_id = current_user.get("id") or current_user.get("_id")
        if not user_id:
            return error_response("User ID not found", status_code=401)
        user_id = str(user_id)
        
        # Determine status (default to draft)
        status = request.status or "draft"
        is_draft = status == "draft"
        
        # For scheduled assessments, validate all required fields
        if not is_draft:
            if not request.title or not request.title.strip():
                return error_response("Title is required for scheduled assessments", status_code=400)
            if not request.questions or len(request.questions) == 0:
                return error_response("At least one question is required for scheduled assessments", status_code=400)
            # Validate exam mode requirements
            if request.examMode == "flexible" and not request.duration:
                return error_response("Duration is required for flexible exam mode", status_code=400)
            if request.examMode == "strict" and (not request.startTime or not request.endTime):
                return error_response("Start time and end time are required for strict exam mode", status_code=400)
        
        # Generate assessment token (only for scheduled, or if not exists for draft)
        assessment_token = None
        assessment_url = None
        if not is_draft:
            assessment_token = _generate_assessment_token()
            # Generate assessment URL only for scheduled assessments
            # We'll generate it after insert for drafts
        
        # Prepare questions with IDs
        questions_with_ids = []
        if request.questions:
            for idx, q in enumerate(request.questions):
                q_dict = q.model_dump()
                q_dict["id"] = q_dict.get("id") or f"q_{idx + 1}"
                if "createdAt" not in q_dict or not q_dict.get("createdAt"):
                    q_dict["createdAt"] = _now_utc()
                q_dict["updatedAt"] = _now_utc()
                questions_with_ids.append(q_dict)
        
        # Prepare candidates
        candidates_list = []
        if request.candidates:
            candidates_list = [c.model_dump() for c in request.candidates]
        
        # Calculate total marks
        total_marks = sum(q["marks"] for q in questions_with_ids) if questions_with_ids else 0
        
        # Create assessment document
        assessment_doc = {
            "title": request.title or "",
            "description": request.description or "",
            "type": "custom_mcq",
            "status": status,
            "created_by": user_id,
            "created_at": _now_utc(),
            "updated_at": _now_utc(),
            "questions": questions_with_ids,
            "candidates": candidates_list,
            "accessMode": request.accessMode,
            "examMode": request.examMode,
            "schedule": {
                "startTime": request.startTime.isoformat() if request.startTime else None,
                "endTime": request.endTime.isoformat() if request.endTime else None,
                "duration": request.duration,  # In minutes
            },
            "passPercentage": request.passPercentage,
            "submissions": {},  # Store candidate submissions
            "totalMarks": total_marks,
            "currentStation": request.currentStation or 1,  # Track current station
        }
        
        # Only add token and URL for scheduled assessments
        if assessment_token:
            assessment_doc["assessmentToken"] = assessment_token
        
        # Insert into database
        result = await db.custom_mcq_assessments.insert_one(assessment_doc)
        assessment_id = str(result.inserted_id)
        
        # Generate assessment URL for scheduled assessments
        if assessment_token:
            assessment_url = f"/custom-mcq/entry/{assessment_id}?token={assessment_token}"
        
        return success_response(
            "Custom MCQ assessment created successfully",
            {
                "assessmentId": assessment_id,
                "assessmentToken": assessment_token,
                "assessmentUrl": assessment_url,
                "totalQuestions": len(questions_with_ids),
                "totalMarks": total_marks,
                "status": status,
                "currentStation": assessment_doc["currentStation"],
            }
        )
        
    except Exception as e:
        logger.exception(f"Error creating custom MCQ assessment: {e}")
        return error_response(f"Failed to create assessment: {str(e)}", status_code=500)


@router.get("/list")
async def list_custom_mcq_assessments(
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """List all custom MCQ assessments for the current user"""
    try:
        user_id = current_user.get("id") or current_user.get("_id")
        if not user_id:
            return error_response("User ID not found", status_code=401)
        user_id = str(user_id)
        
        assessments = []
        async for assessment in db.custom_mcq_assessments.find({"created_by": user_id}).sort("created_at", -1):
            assessment_serialized = serialize_document(assessment)
            if not assessment_serialized:
                continue
            # Count submissions
            submissions = assessment_serialized.get("submissions", {})
            submissions_count = len(submissions) if submissions else 0
            
            assessments.append({
                "id": assessment_serialized.get("id") or assessment_serialized.get("_id"),
                "title": assessment_serialized.get("title", ""),
                "description": assessment_serialized.get("description", ""),
                "status": assessment_serialized.get("status", "draft"),
                "totalQuestions": len(assessment_serialized.get("questions", [])),
                "totalMarks": assessment_serialized.get("totalMarks", 0),
                "submissionsCount": submissions_count,
                "createdAt": assessment_serialized.get("created_at"),
                "updatedAt": assessment_serialized.get("updated_at"),
                "currentStation": assessment_serialized.get("currentStation", 1),  # Include current station
            })
        
        return success_response(
            "Custom MCQ assessments fetched successfully",
            {"assessments": assessments, "total": len(assessments)}
        )
        
    except Exception as e:
        logger.exception(f"Error listing custom MCQ assessments: {e}")
        return error_response(f"Failed to list assessments: {str(e)}", status_code=500)


@router.get("/{assessment_id}")
async def get_custom_mcq_assessment(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """Get a specific custom MCQ assessment"""
    try:
        user_id = current_user.get("id") or current_user.get("_id")
        if not user_id:
            return error_response("User ID not found", status_code=401)
        user_id = str(user_id)
        assessment_oid = to_object_id(assessment_id)
        
        assessment = await db.custom_mcq_assessments.find_one({"_id": assessment_oid})
        
        if not assessment:
            return error_response("Assessment not found", status_code=404)
        
        # Check ownership
        if str(assessment["created_by"]) != user_id:
            return error_response("Access denied", status_code=403)
        
        assessment_serialized = serialize_document(assessment)
        
        # Get submissions summary
        submissions = assessment_serialized.get("submissions", {})
        submissions_list = []
        for key, submission_data in submissions.items():
            submissions_list.append({
                "candidateKey": key,
                "candidateInfo": submission_data.get("candidateInfo", {}),
                "score": submission_data.get("score", 0),
                "percentage": submission_data.get("percentage", 0),
                "status": submission_data.get("status", "pending"),
                "submittedAt": submission_data.get("submittedAt"),
                "startedAt": submission_data.get("startedAt"),
            })
        
        assessment_serialized["submissionsList"] = submissions_list
        assessment_serialized["submissionsCount"] = len(submissions_list)
        
        return success_response(
            "Assessment fetched successfully",
            assessment_serialized
        )
        
    except Exception as e:
        logger.exception(f"Error getting custom MCQ assessment: {e}")
        return error_response(f"Failed to get assessment: {str(e)}", status_code=500)


@router.put("/{assessment_id}")
async def update_custom_mcq_assessment(
    assessment_id: str,
    request: UpdateCustomMCQAssessmentRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """Update a custom MCQ assessment"""
    try:
        user_id = current_user.get("id") or current_user.get("_id")
        if not user_id:
            return error_response("User ID not found", status_code=401)
        user_id = str(user_id)
        assessment_oid = to_object_id(assessment_id)
        
        assessment = await db.custom_mcq_assessments.find_one({"_id": assessment_oid})
        
        if not assessment:
            return error_response("Assessment not found", status_code=404)
        
        # Check ownership
        if str(assessment["created_by"]) != user_id:
            return error_response("Access denied", status_code=403)
        
        # Build update document
        update_doc = {"updated_at": _now_utc()}
        
        if request.title is not None:
            update_doc["title"] = request.title
        
        if request.description is not None:
            update_doc["description"] = request.description
        
        if request.questions is not None:
            questions_with_ids = []
            for idx, q in enumerate(request.questions):
                q_dict = q.model_dump()
                q_dict["id"] = q_dict.get("id") or f"q_{idx + 1}"
                q_dict["updatedAt"] = _now_utc()
                if "createdAt" not in q_dict:
                    q_dict["createdAt"] = _now_utc()
                questions_with_ids.append(q_dict)
            update_doc["questions"] = questions_with_ids
            update_doc["totalMarks"] = sum(q["marks"] for q in questions_with_ids)
        
        if request.candidates is not None:
            update_doc["candidates"] = [c.model_dump() for c in request.candidates]
        
        if request.accessMode is not None:
            update_doc["accessMode"] = request.accessMode
        
        if request.examMode is not None:
            update_doc["examMode"] = request.examMode
        
        # Handle schedule updates - merge with existing schedule
        schedule_updated = False
        schedule = dict(assessment.get("schedule", {}))  # Copy existing schedule
        
        if request.startTime is not None:
            schedule["startTime"] = request.startTime.isoformat()
            schedule_updated = True
        if request.endTime is not None:
            schedule["endTime"] = request.endTime.isoformat()
            schedule_updated = True
        if request.duration is not None:
            schedule["duration"] = request.duration
            schedule_updated = True
        
        if schedule_updated:
            update_doc["schedule"] = schedule
        
        if request.passPercentage is not None:
            update_doc["passPercentage"] = request.passPercentage
        
        # Handle status update (draft -> scheduled)
        if request.status is not None:
            update_doc["status"] = request.status
            # If changing from draft to scheduled, validate and generate token if needed
            if request.status == "scheduled":
                # Validate required fields for scheduled
                current_title = update_doc.get("title") or assessment.get("title", "")
                current_questions = update_doc.get("questions") or assessment.get("questions", [])
                
                if not current_title or not current_title.strip():
                    return error_response("Title is required for scheduled assessments", status_code=400)
                if not current_questions or len(current_questions) == 0:
                    return error_response("At least one question is required for scheduled assessments", status_code=400)
                
                # Validate exam mode requirements
                current_exam_mode = update_doc.get("examMode") or assessment.get("examMode", "strict")
                current_schedule = update_doc.get("schedule") or assessment.get("schedule", {})
                
                if current_exam_mode == "flexible" and not current_schedule.get("duration"):
                    return error_response("Duration is required for flexible exam mode", status_code=400)
                if current_exam_mode == "strict" and (not current_schedule.get("startTime") or not current_schedule.get("endTime")):
                    return error_response("Start time and end time are required for strict exam mode", status_code=400)
                
                # Generate assessment token if not exists
                if not assessment.get("assessmentToken"):
                    assessment_token = _generate_assessment_token()
                    update_doc["assessmentToken"] = assessment_token
        
        # Update current station if provided
        if request.currentStation is not None:
            update_doc["currentStation"] = request.currentStation
        
        await db.custom_mcq_assessments.update_one(
            {"_id": assessment_oid},
            {"$set": update_doc}
        )
        
        # Get updated assessment to return token if it was generated
        updated_assessment = await db.custom_mcq_assessments.find_one({"_id": assessment_oid})
        response_data = {"message": "Assessment updated successfully"}
        
        # If status changed to scheduled and token was generated, include it
        if request.status == "scheduled" and updated_assessment and updated_assessment.get("assessmentToken"):
            assessment_id = str(updated_assessment["_id"])
            assessment_token = updated_assessment["assessmentToken"]
            response_data["assessmentToken"] = assessment_token
            response_data["assessmentUrl"] = f"/custom-mcq/entry/{assessment_id}?token={assessment_token}"
        
        return success_response("Assessment updated successfully", response_data)
        
    except Exception as e:
        logger.exception(f"Error updating custom MCQ assessment: {e}")
        return error_response(f"Failed to update assessment: {str(e)}", status_code=500)


@router.delete("/{assessment_id}")
async def delete_custom_mcq_assessment(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """Delete a custom MCQ assessment"""
    try:
        user_id = current_user.get("id") or current_user.get("_id")
        if not user_id:
            return error_response("User ID not found", status_code=401)
        user_id = str(user_id)
        assessment_oid = to_object_id(assessment_id)
        
        assessment = await db.custom_mcq_assessments.find_one({"_id": assessment_oid})
        
        if not assessment:
            return error_response("Assessment not found", status_code=404)
        
        # Check ownership
        if str(assessment["created_by"]) != user_id:
            return error_response("Access denied", status_code=403)
        
        await db.custom_mcq_assessments.delete_one({"_id": assessment_oid})
        
        return success_response("Assessment deleted successfully")
        
    except Exception as e:
        logger.exception(f"Error deleting custom MCQ assessment: {e}")
        return error_response(f"Failed to delete assessment: {str(e)}", status_code=500)


@router.post("/verify-candidate")
async def verify_custom_mcq_candidate(
    request: VerifyCustomMCQCandidateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """Verify candidate access to custom MCQ assessment"""
    try:
        oid = to_object_id(test_id)
        test = await db.custom_mcq_tests.find_one({"_id": oid, "testToken": token})
        
        if not assessment:
            return error_response("Assessment not found", status_code=404)
        
        # Check token (basic validation)
        assessment_token = assessment.get("assessmentToken")
        if not assessment_token:
            logger.error(f"Assessment {assessment_id} has no assessmentToken configured")
            return error_response("Assessment token not configured", status_code=500)
        if assessment_token != request.token:
            logger.warning(f"Token mismatch for assessment {assessment_id}. Expected: {assessment_token[:10]}..., Got: {request.token[:10] if request.token else 'None'}...")
            return error_response("Invalid or expired assessment token. Please use the correct assessment link.", status_code=403)
        
        # Check if candidate already submitted (BEFORE checking access mode)
        # This prevents retaking the assessment in both public and private modes
        submissions = assessment.get("submissions", {})
        candidate_key = f"{request.email.lower().strip()}_{request.name.strip().lower()}"
        existing_submission = submissions.get(candidate_key)
        
        # Log for debugging
        logger.info(f"Verifying candidate - Key: {candidate_key}, Has submission: {existing_submission is not None}")
        if existing_submission:
            logger.info(f"Existing submission - Status: {existing_submission.get('status')}, SubmittedAt: {existing_submission.get('submittedAt')}")
        
        # Check if candidate has already submitted OR is currently taking the assessment
        # If ANY submission record exists for this candidate_key, block access (prevents retaking or concurrent sessions)
        if existing_submission:
            submission_status = existing_submission.get("status")
            submitted_at = existing_submission.get("submittedAt")
            started_at = existing_submission.get("startedAt")
            score = existing_submission.get("score")
            submissions_list = existing_submission.get("submissions")
            
            # Check if they've completed the assessment
            has_completed = (
                submission_status == "completed" or 
                submitted_at or 
                (score is not None and submitted_at)
            )
            
            # Check if they're currently taking it (started but not submitted)
            is_in_progress = (
                started_at and 
                not submitted_at and
                submission_status != "completed"
            )
            
            if has_completed:
                logger.warning(f"Blocking access for {candidate_key} - already submitted (status: {submission_status}, submittedAt: {submitted_at}, score: {score})")
                return error_response("You have already submitted this assessment. You cannot take the test again.", status_code=400)
            elif is_in_progress:
                logger.warning(f"Blocking access for {candidate_key} - currently taking assessment (startedAt: {started_at}, submittedAt: {submitted_at})")
                return error_response("You are already taking this assessment in another tab or browser. Please complete it there first.", status_code=400)
        
        access_mode = assessment.get("accessMode", "private")
        
        # For public mode, anyone with the link can access (if not already submitted)
        if access_mode == "public":
            return success_response("Access granted", {
                "verified": True,
                "accessMode": "public",
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
            return error_response("You are not authorized to access this assessment", status_code=403)
        
        return success_response("Access granted", {
            "verified": True,
            "accessMode": "private",
        })
        
    except Exception as e:
        logger.exception(f"Error verifying candidate: {e}")
        return error_response(f"Failed to verify candidate: {str(e)}", status_code=500)


@router.get("/take/{assessment_id}")
async def get_custom_mcq_assessment_for_taking(
    assessment_id: str,
    token: str = Query(..., description="Access token"),
    email: str = Query(None, description="Candidate email"),
    name: str = Query(None, description="Candidate name"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    """Get assessment details for taking (candidate view)"""
    try:
        draft_doc = {
            "type": "custom_mcq",
            "isDraft": True,
            "title": payload.title or "Untitled Test",
            "status": "draft",
            "draftData": {
                "csvRawData": None,
                "parsedQuestions": [],
                "sections": [],
                "settings": None,
                "scheduling": None,
                "candidates": [],
                "proctoringSettings": None,
            },
            "progressStep": 1,
            "createdBy": to_object_id(current_user["id"]),
            "organization": current_user.get("organization"),
            "createdAt": _now_utc().isoformat(),
            "updatedAt": _now_utc().isoformat(),
        }
        
        result = await db.custom_mcq_tests.insert_one(draft_doc)
        draft_id = str(result.inserted_id)
        
        logger.info(f"Custom MCQ draft created: {draft_id} by user {current_user['id']}")
        
        return success_response(
            "Draft created successfully",
            {
                "draftId": draft_id,
            }
        )
    except Exception as exc:
        logger.exception(f"Error creating draft: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create draft: {str(exc)}"
        ) from exc


@router.post("/update-draft/{draft_id}")
async def update_draft(
    draft_id: str,
    payload: UpdateDraftRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update a draft with current progress."""
    try:
        oid = to_object_id(draft_id)
        draft = await db.custom_mcq_tests.find_one({"_id": oid})
        
        if not draft:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
        
        _check_test_access(draft, current_user)
        
        # Update only draftData and progressStep, keep isDraft = True
        update_doc = {
            "draftData": payload.draftData.dict(),
            "progressStep": payload.progressStep,
            "updatedAt": _now_utc().isoformat(),
        }
        
        # If title is provided in draftData.settings, update it
        if payload.draftData.settings and payload.draftData.settings.get("title"):
            update_doc["title"] = payload.draftData.settings.get("title")
        
        await db.custom_mcq_tests.update_one(
            {"_id": oid},
            {"$set": update_doc}
        )
        
        logger.info(f"Draft updated: {draft_id} at step {payload.progressStep}")
        
        return success_response("Draft updated successfully", {"draftId": draft_id})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error updating draft: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update draft: {str(exc)}"
        ) from exc


@router.get("/draft/{draft_id}")
async def get_draft(
    draft_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get a draft with full draftData for editing."""
    try:
        oid = to_object_id(draft_id)
        draft = await db.custom_mcq_tests.find_one({"_id": oid})
        
        if not draft:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
        
        _check_test_access(draft, current_user)
        
        # Convert ObjectId to string
        draft["_id"] = str(draft["_id"])
        
        return success_response("Draft fetched successfully", draft)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error fetching draft: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch draft: {str(exc)}"
        ) from exc


@router.post("/publish/{draft_id}")
async def publish_draft(
    draft_id: str,
    payload: PublishDraftRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Convert draft into finalized CustomTest."""
    try:
        oid = to_object_id(draft_id)
        draft = await db.custom_mcq_tests.find_one({"_id": oid})
        
        if not draft:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
        
        _check_test_access(draft, current_user)
        
        # Calculate total marks
        total_marks = 0
        for section in payload.sections:
            for question in section.questions:
                total_marks += question.marks
        
        # Generate test token
        test_token = secrets.token_urlsafe(32)
        
        # Build finalized test document
        test_doc = {
            "type": "custom_mcq",
            "isDraft": False,
            "title": payload.settings.title,
            "description": payload.settings.description,
            "instructions": payload.settings.instructions if hasattr(payload.settings, 'instructions') else None,
            "passingPercentage": payload.settings.passingPercentage,
            "shuffleQuestions": payload.settings.shuffleQuestions,
            "shuffleOptions": payload.settings.shuffleOptions,
            "allowNegativeMarking": payload.settings.allowNegativeMarking,
            "attemptLimit": payload.settings.attemptLimit,
            "sections": [
                {
                    "name": section.name,
                    "timeLimit": section.timeLimit,
                    "questions": [
                        {
                            "question": q.question,
                            "options": {
                                "A": q.optionA,
                                "B": q.optionB,
                                "C": q.optionC,
                                "D": q.optionD,
                            },
                            "correctAnswer": q.correctAnswer,
                            "marks": q.marks,
                        }
                        for q in section.questions
                    ],
                }
                for section in payload.sections
            ],
            "totalMarks": total_marks,
            "timerMode": payload.timerSettings.timerMode,
            "examDuration": payload.timerSettings.examDuration,
            "sectionTimes": payload.timerSettings.sectionTimes or {},
            "proctoring": payload.proctoringSettings.dict(),
            "schedule": {
                "startTime": payload.schedule.startTime.isoformat(),
                "endTime": payload.schedule.endTime.isoformat(),
                "candidateRequirements": payload.schedule.candidateRequirements or {},
            },
            "accessMode": payload.accessMode,
            "testToken": test_token,
            "candidates": [
                {
                    "name": c.name,
                    "email": c.email.lower().strip(),
                    "phone": c.phone,
                    "invited": False,
                    "inviteSentAt": None,
                    "status": "pending",
                }
                for c in (payload.candidates or [])
            ],
            "candidateResponses": {},
            "answerLogs": {},
            "createdBy": to_object_id(current_user["id"]),
            "organization": current_user.get("organization"),
            "createdAt": draft.get("createdAt", _now_utc().isoformat()),
            "updatedAt": _now_utc().isoformat(),
            "status": "published",
            # Keep draftData for history (optional - can be removed)
            # "draftData": draft.get("draftData"),
        }
        
        # Generate test access URL
        from ....config.settings import get_settings
        settings = get_settings()
        base_url = getattr(settings, 'frontend_url', 'http://localhost:3000')
        test_url = f"{base_url}/custom-mcq/test/{draft_id}/{test_token}"
        
        test_doc["examAccessUrl"] = test_url
        
        # Update the draft to finalized test
        await db.custom_mcq_tests.update_one(
            {"_id": oid},
            {"$set": test_doc}
        )
        
        logger.info(f"Draft published: {draft_id} by user {current_user['id']}")
        
        return success_response(
            "Draft published successfully",
            {
                "testId": draft_id,
                "testToken": test_token,
                "testUrl": test_url,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error publishing draft: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to publish draft: {str(exc)}"
        ) from exc


@router.delete("/{test_id}")
async def delete_custom_mcq_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Delete a custom MCQ test. Only users with access to the test can delete it."""
    try:
        oid = to_object_id(test_id)
        test = await db.custom_mcq_tests.find_one({"_id": oid})
        
        if not test:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Test not found"
            )
        
        _check_test_access(test, current_user)
        
        # Delete the test
        result = await db.custom_mcq_tests.delete_one({"_id": oid})
        
        if result.deleted_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Test not found or already deleted",
            )
        
        logger.info(f"Custom MCQ test deleted: {test_id} by user {current_user['id']}")
        
        return success_response("Custom MCQ test deleted successfully", {"testId": test_id})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error deleting custom MCQ test: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete test: {str(exc)}",
        ) from exc

