from fastapi import APIRouter, HTTPException, Query, Body, Depends, status, UploadFile, File
from typing import List, Dict, Any, Optional
from bson import ObjectId
from datetime import datetime, timedelta
import logging
import secrets
import urllib.parse
import re
import csv
import io
from ..database import get_aiml_database as get_database
from ..models.test import TestCreate, Test, AddCandidateRequest
from .....core.dependencies import get_current_user, require_editor
from .....utils.email import get_email_service
from .....config.settings import get_settings
from ..utils.dataset_manager import get_dataset_manager

logger = logging.getLogger("backend")
router = APIRouter(tags=["aiml"])

@router.post("/", response_model=dict)
async def create_test(
    test: TestCreate,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Create a new AIML test (requires authentication)
    Validates that all question_ids belong to the current user
    """
    db = get_database()
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[create_test] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    logger.info(f"[create_test] Creating AIML test with user_id: '{user_id}'")
    
    # Validate that all questions belong to the current user
    if test.question_ids:
        question_ids = [ObjectId(qid) if ObjectId.is_valid(qid) else None for qid in test.question_ids]
        question_ids = [qid for qid in question_ids if qid is not None]
        
        if question_ids:
            questions = await db.questions.find({"_id": {"$in": question_ids}}).to_list(length=len(question_ids))
            # Check if all questions exist and belong to the user
            found_question_ids = {str(q["_id"]) for q in questions}
            requested_question_ids = {str(qid) for qid in question_ids}
            
            if found_question_ids != requested_question_ids:
                raise HTTPException(status_code=400, detail="Some questions not found")
            
            # Verify ownership
            for question in questions:
                q_created_by = question.get("created_by")
                if not q_created_by or str(q_created_by).strip() != user_id.strip():
                    raise HTTPException(status_code=403, detail=f"Question {question.get('title', 'Unknown')} does not belong to you")
    
    # -------------------------------
    # Exam window configuration (mirrors Custom MCQ)
    # -------------------------------
    def _coalesce(*vals):
        for v in vals:
            if v is not None:
                return v
        return None

    exam_mode = getattr(test, "examMode", None) or "strict"
    schedule_obj = getattr(test, "schedule", None)
    start_dt = _coalesce(
        getattr(schedule_obj, "startTime", None) if schedule_obj else None,
        getattr(test, "startTime", None),
        getattr(test, "start_time", None),
    )
    end_dt = _coalesce(
        getattr(schedule_obj, "endTime", None) if schedule_obj else None,
        getattr(test, "endTime", None),
        getattr(test, "end_time", None),
    )
    duration_minutes = _coalesce(
        getattr(schedule_obj, "duration", None) if schedule_obj else None,
        getattr(test, "duration", None),
        getattr(test, "duration_minutes", None),
    )

    if exam_mode not in ("strict", "flexible"):
        raise HTTPException(status_code=400, detail="Invalid examMode. Must be 'strict' or 'flexible'.")
    if not start_dt or not end_dt:
        raise HTTPException(status_code=400, detail="Start time and end time are required.")
    if start_dt >= end_dt:
        raise HTTPException(status_code=400, detail="End time must be after start time.")
    if exam_mode == "flexible":
        if not duration_minutes or int(duration_minutes) <= 0:
            raise HTTPException(status_code=400, detail="Duration is required for flexible exam mode.")

    schedule_payload = {
        "startTime": start_dt,
        "endTime": end_dt,
        "duration": int(duration_minutes) if (exam_mode == "flexible" and duration_minutes is not None) else None,
    }

    test_dict = test.model_dump()
    test_dict["examMode"] = exam_mode
    test_dict["schedule"] = schedule_payload
    # Ensure legacy fields are set (backward compatible)
    test_dict["start_time"] = start_dt
    test_dict["end_time"] = end_dt

    # -------------------------------
    # Timer configuration (mirrors DSA)
    # -------------------------------
    timer_mode = test_dict.get("timer_mode", "GLOBAL")
    if timer_mode not in ("GLOBAL", "PER_QUESTION"):
        raise HTTPException(status_code=400, detail="Invalid timer_mode. Must be 'GLOBAL' or 'PER_QUESTION'.")

    if timer_mode == "PER_QUESTION":
        qt = test_dict.get("question_timings") or []
        if not qt:
            raise HTTPException(status_code=400, detail="question_timings is required for PER_QUESTION timer_mode.")
        total = 0
        for item in qt:
            mins = int(item.get("duration_minutes", 0) or 0)
            if mins < 1:
                raise HTTPException(status_code=400, detail="All question timings must be at least 1 minute.")
            total += mins
        test_dict["duration_minutes"] = total
    else:
        # GLOBAL timer
        if exam_mode == "strict":
            window_minutes = int((end_dt - start_dt).total_seconds() // 60)
            test_dict["duration_minutes"] = max(window_minutes, 1)
        else:
            test_dict["duration_minutes"] = int(duration_minutes)
    test_dict["created_by"] = user_id
    test_dict["is_active"] = True
    test_dict["is_published"] = False
    test_dict["invited_users"] = []
    test_dict["created_at"] = datetime.utcnow()
    test_dict["test_type"] = "aiml"  # Mark as AIML test
    
    result = await db.tests.insert_one(test_dict)
    
    # Fetch the created test
    created_test = await db.tests.find_one({"_id": result.inserted_id})
    if created_test:
        test_dict = {
            "id": str(created_test["_id"]),
            "title": created_test.get("title", ""),
            "description": created_test.get("description", ""),
            "duration_minutes": created_test.get("duration_minutes", 0),
            "start_time": created_test.get("start_time").isoformat() if created_test.get("start_time") else None,
            "end_time": created_test.get("end_time").isoformat() if created_test.get("end_time") else None,
            "timer_mode": created_test.get("timer_mode", "GLOBAL"),
            "question_timings": created_test.get("question_timings"),
            "examMode": created_test.get("examMode", "strict"),
            "schedule": created_test.get("schedule"),
            "is_active": created_test.get("is_active", False),
            "is_published": created_test.get("is_published", False),
            "question_ids": [str(qid) for qid in created_test.get("question_ids", [])],
        }
        return test_dict
    
    test_dict["id"] = str(result.inserted_id)
    return test_dict

@router.get("/", response_model=List[dict])
async def get_tests(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all tests for the current user
    """
    db = get_database()
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    # Filter by both user and test_type to only get AIML tests
    tests = await db.tests.find({"created_by": user_id, "test_type": "aiml"}).sort("created_at", -1).to_list(length=1000)
    
    result = []
    for test in tests:
        test_dict = {
            "id": str(test["_id"]),
            "title": test.get("title", ""),
            "description": test.get("description", ""),
            "duration_minutes": test.get("duration_minutes", 0),
            "start_time": test.get("start_time").isoformat() if test.get("start_time") else None,
            "end_time": test.get("end_time").isoformat() if test.get("end_time") else None,
            "timer_mode": test.get("timer_mode", "GLOBAL"),
            "question_timings": test.get("question_timings"),
            "examMode": test.get("examMode", "strict"),
            "schedule": test.get("schedule"),
            "is_active": test.get("is_active", False),
            "is_published": test.get("is_published", False),
            "question_ids": [str(qid) for qid in test.get("question_ids", [])],
            "test_token": test.get("test_token"),
            "created_by": test.get("created_by"),
            "test_type": test.get("test_type", "aiml"),
            "created_at": test.get("created_at").isoformat() if test.get("created_at") else None,
        }
        # Add pausedAt if it exists
        if "pausedAt" in test and test.get("pausedAt"):
            test_dict["pausedAt"] = test.get("pausedAt").isoformat() if isinstance(test.get("pausedAt"), datetime) else test.get("pausedAt")
        result.append(test_dict)
    return result

@router.patch("/{test_id}/publish", response_model=dict)
async def publish_test(
    test_id: str,
    is_published: bool = Query(..., description="Set publish status"),
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Publish/unpublish a test
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to publish this test")
    
    update_data = {"is_published": is_published}
    
    # If publishing and no token exists, generate a shared test token
    if is_published:
        if not test.get("test_token"):
            update_data["test_token"] = secrets.token_urlsafe(32)
    
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": update_data}
    )
    
    updated_test = await db.tests.find_one({"_id": ObjectId(test_id)})
    return {
        "id": str(updated_test["_id"]),
        "is_published": updated_test.get("is_published", False),
        "test_token": updated_test.get("test_token"),
    }


@router.patch("/{test_id}", response_model=dict)
async def update_test(
    test_id: str,
    update_data: Dict[str, Any] = Body(...),
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Update a test (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to update this test")
    
    # Prepare update fields (only allow specific fields to be updated)
    allowed_fields = ["invitationTemplate", "title", "description", "duration_minutes", "question_ids"]
    update_fields = {}
    
    for field in allowed_fields:
        if field in update_data:
            update_fields[field] = update_data[field]
    
    # Validate and normalize question_ids (must belong to current user and be AIML questions)
    if "question_ids" in update_fields:
        question_ids = update_fields["question_ids"]
        if not isinstance(question_ids, list):
            raise HTTPException(status_code=400, detail="question_ids must be a list")
        
        normalized_ids = []
        for qid in question_ids:
            if not isinstance(qid, str) or not ObjectId.is_valid(qid):
                raise HTTPException(status_code=400, detail=f"Invalid question ID: {qid}")
            normalized_ids.append(ObjectId(qid))
        
        # Ensure questions belong to this user and are AIML module
        user_id_str = str(user_id).strip()
        for q_obj in normalized_ids:
            question = await db.questions.find_one({"_id": q_obj, "created_by": user_id_str, "module_type": "aiml"})
            if not question:
                raise HTTPException(status_code=403, detail=f"Question {str(q_obj)} not found or not owned by user")
        
        update_fields["question_ids"] = normalized_ids
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    
    update_fields["updated_at"] = datetime.utcnow()
    
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": update_fields}
    )
    
    updated_test = await db.tests.find_one({"_id": ObjectId(test_id)})
    
    return {
        "id": str(updated_test["_id"]),
        "title": updated_test.get("title"),
        "description": updated_test.get("description"),
        "duration_minutes": updated_test.get("duration_minutes"),
        "is_published": updated_test.get("is_published", False),
        "test_token": updated_test.get("test_token"),
        "invitationTemplate": updated_test.get("invitationTemplate"),
        "question_ids": [str(qid) for qid in updated_test.get("question_ids", [])],
    }


@router.get("/{test_id}", response_model=dict)
async def get_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Get a specific test by ID (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Verify ownership
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to access this test")
    
    return {
        "id": str(test["_id"]),
        "title": test.get("title", ""),
        "description": test.get("description", ""),
        "duration_minutes": test.get("duration_minutes", 0),
        "start_time": test.get("start_time").isoformat() if test.get("start_time") else None,
        "end_time": test.get("end_time").isoformat() if test.get("end_time") else None,
        "timer_mode": test.get("timer_mode", "GLOBAL"),
        "question_timings": test.get("question_timings"),
        "examMode": test.get("examMode", "strict"),
        "schedule": test.get("schedule"),
        "is_active": test.get("is_active", False),
        "is_published": test.get("is_published", False),
        "question_ids": [str(qid) for qid in test.get("question_ids", [])],
        "test_token": test.get("test_token"),
        "invitationTemplate": test.get("invitationTemplate"),
    }


@router.get("/{test_id}/verify-link")
async def verify_test_link(test_id: str, token: str = Query(...)):
    """
    Verify test link token (shared token for all candidates)
    Returns test info if token is valid
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if test.get("test_token") != token:
        raise HTTPException(status_code=404, detail="Invalid test link")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=403, detail="Test is not published")
    
    return {
        "test_id": test_id,
        "test_title": test.get("title", ""),
        "test_description": test.get("description", ""),
        "valid": True
    }


@router.post("/{test_id}/verify-candidate")
async def verify_candidate(
    test_id: str,
    email: str = Query(..., description="Candidate email"),
    name: str = Query(..., description="Candidate name")
):
    """
    Verify candidate email/name and return user_id
    Used with shared test link
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Find candidate by email (assuming test_candidates collection similar to DSA)
    candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "email": email.strip().lower()
    })
    
    if not candidate:
        raise HTTPException(status_code=404, detail="Email not found in candidate list for this test")
    
    # Verify name matches (case-insensitive)
    if candidate.get("name", "").lower() != name.strip().lower():
        raise HTTPException(status_code=400, detail="Name does not match the email")
    
    return {
        "user_id": candidate["user_id"],
        "name": candidate["name"],
        "email": candidate["email"],
        "test_id": test_id
    }


@router.post("/{test_id}/start")
async def start_test(test_id: str, user_id: str = Query(..., description="User ID from link token")):
    """
    Start a test (user_id provided via query parameter)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=403, detail="Test is not published")

    if not test.get("is_active", True):
        raise HTTPException(status_code=400, detail="Test is not active")

    # For test-taking platform, allow taking published tests regardless of time window.
    # The time window is informational, not restrictive (mirrors DSA behavior).

    # Resolve candidate email (email is unique identity)
    user_doc = await db.users.find_one({"_id": ObjectId(user_id)})
    candidate_email = (user_doc or {}).get("email")
    if not candidate_email:
        raise HTTPException(status_code=400, detail="Candidate email not found")
    candidate_email = str(candidate_email).strip().lower()

    # Enforce one attempt per email per test
    existing_completed_by_email = await db.test_submissions.find_one({
        "test_id": test_id,
        "candidate_email": candidate_email,
        "is_completed": True
    })
    if existing_completed_by_email:
        raise HTTPException(status_code=400, detail="Test already completed for this email. A candidate can attempt the test only once.")
    
    # Check if user already started
    existing = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if existing:
        return {
            "test_submission_id": str(existing["_id"]),
            "started_at": existing["started_at"].isoformat() if isinstance(existing.get("started_at"), datetime) else existing.get("started_at"),
            "is_completed": existing.get("is_completed", False)
        }

    # If paused, allow ONLY candidates who were added before the pause time.
    paused_at = test.get("pausedAt")
    if paused_at:
        candidate_doc = await db.test_candidates.find_one({
            "test_id": test_id,
            "email": {"$regex": f"^{re.escape(candidate_email)}$", "$options": "i"}
        })
        if not candidate_doc:
            raise HTTPException(status_code=403, detail="Test is currently paused")
        created_at = candidate_doc.get("created_at")
        if isinstance(paused_at, datetime) and isinstance(created_at, datetime) and created_at > paused_at:
            raise HTTPException(status_code=403, detail="Test is currently paused")
    
    # Create test submission
    test_submission = {
        "test_id": test_id,
        "user_id": user_id,
        "candidate_email": candidate_email,
        "submissions": [],
        "score": 0,
        "started_at": datetime.utcnow(),
        "is_completed": False,
    }
    
    result = await db.test_submissions.insert_one(test_submission)
    
    # Materialize datasets for all questions in this test
    try:
        dataset_manager = get_dataset_manager()
        materialized = await dataset_manager.materialize_test_datasets_async(db, test_id)
        if materialized:
            logger.info(f"✅ Materialized {len(materialized)} dataset(s) for test {test_id}")
        else:
            logger.info("No datasets to materialize for this test")
    except Exception as e:
        logger.error(f"⚠️  Failed to materialize datasets: {str(e)}")
        # Don't fail the test start if dataset materialization fails
        # The test can still proceed, just without dataset files
    
    return {
        "test_submission_id": str(result.inserted_id),
        "started_at": test_submission["started_at"].isoformat(),
        "is_completed": False
    }


@router.get("/{test_id}/candidate")
async def get_test_for_candidate(
    test_id: str,
    user_id: str = Query(..., description="User ID from link token")
):
    """
    Get test data for candidate (questions without answers)
    Returns started_at and time_remaining if test has been started
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=403, detail="Test is not published")
    
    # Check if test has been started
    test_submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    started_at = None
    time_remaining_seconds = None
    is_completed = False
    
    if test_submission:
        started_at = test_submission.get("started_at")
        is_completed = test_submission.get("is_completed", False)
        
        # Calculate remaining time for candidate timer.
        # We treat start/end window as informational (mirrors start_test behavior); timer is based on test duration.
        started_datetime = None
        if started_at and not is_completed:
            if isinstance(started_at, datetime):
                started_datetime = started_at
            elif isinstance(started_at, str):
                try:
                    if started_at.endswith('Z'):
                        started_datetime = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                    else:
                        started_datetime = datetime.fromisoformat(started_at)
                except Exception:
                    try:
                        from dateutil import parser  # type: ignore
                        started_datetime = parser.parse(started_at)
                    except Exception:
                        started_datetime = None

        if started_datetime and not is_completed:
            duration_seconds = int(test.get("duration_minutes", 0) or 0) * 60
            elapsed_seconds = (datetime.utcnow() - started_datetime).total_seconds()
            time_remaining_seconds = max(0, int(duration_seconds - elapsed_seconds))
    
    # Get questions (without hidden testcases for candidate view)
    question_ids = test.get("question_ids", [])
    questions = []
    
    # Get dataset manager to get real filesystem paths
    dataset_manager = get_dataset_manager()
    
    for qid in question_ids:
        if ObjectId.is_valid(qid):
            question = await db.questions.find_one({"_id": ObjectId(qid)})
            if question:
                # Remove hidden testcases for candidate
                question_dict = {
                    "id": str(question["_id"]),
                    "title": question.get("title", ""),
                    "description": question.get("description", ""),
                    "examples": question.get("examples", []),
                    "constraints": question.get("constraints", []),
                    "difficulty": question.get("difficulty", ""),
                    "languages": question.get("languages", []),
                    "public_testcases": question.get("public_testcases", []),
                    "starter_code": question.get("starter_code", {}),
                    "library": question.get("library", ""),
                    # Include dataset information for candidate
                    "requires_dataset": question.get("requires_dataset", False),
                    "dataset": question.get("dataset"),
                    # Include tasks for new format questions
                    "tasks": question.get("tasks", []),
                }
                
                # Provide dataset URL (API-based) instead of local filesystem path
                question_dict["dataset_path"] = None
                question_dict["dataset_url"] = None
                if question.get("dataset"):
                    dataset_format = question.get("dataset", {}).get("format", "csv")
                    # Use download endpoint for all formats (returns raw file content)
                    question_dict["dataset_url"] = f"/api/v1/aiml/questions/{question_dict['id']}/dataset-download?format={dataset_format}&test_id={test_id}&user_id={user_id}"
                elif question.get("dataset_path"):
                    # Backward compatibility: expose stored path as URL
                    question_dict["dataset_url"] = question.get("dataset_path")
                
                if "function_signature" in question:
                    question_dict["function_signature"] = question["function_signature"]
                questions.append(question_dict)
    
    result = {
        "test_id": test_id,
        "title": test.get("title", ""),
        "description": test.get("description", ""),
        "duration_minutes": test.get("duration_minutes", 0),
        "questions": questions,
        # Include proctoring settings for candidate runtime toggle (backward compatible)
        "proctoringSettings": test.get("proctoringSettings"),
    }
    
    # Add timing information if test has been started
    if started_at:
        result["started_at"] = started_at.isoformat() if isinstance(started_at, datetime) else str(started_at)
        result["is_completed"] = is_completed
        if time_remaining_seconds is not None:
            result["time_remaining_seconds"] = time_remaining_seconds
    
    return result


@router.post("/{test_id}/submit-answer")
async def submit_answer(
    test_id: str,
    user_id: str = Body(..., description="User ID from link token"),
    question_id: str = Body(..., description="Question ID"),
    source_code: str = Body(..., description="Source code"),
    outputs: List[str] = Body(default=[], description="Outputs from code execution")
):
    """
    Submit an answer for a question in a test (auto-save functionality)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    # Verify test exists and is published
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=403, detail="Test is not published")
    
    # Verify question belongs to test
    question_ids = test.get("question_ids", [])
    if question_id not in [str(qid) for qid in question_ids]:
        raise HTTPException(status_code=400, detail="Question does not belong to this test")
    
    # Find or create test submission
    test_submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not test_submission:
        # Create new submission if it doesn't exist
        test_submission = {
            "test_id": test_id,
            "user_id": user_id,
            "submissions": [],
            "score": 0,
            "started_at": datetime.utcnow(),
            "is_completed": False,
        }
        result = await db.test_submissions.insert_one(test_submission)
        test_submission["_id"] = result.inserted_id
    
    # Update or add submission for this question
    submissions = test_submission.get("submissions", [])
    existing_submission_idx = None
    for idx, sub in enumerate(submissions):
        if sub.get("question_id") == question_id:
            existing_submission_idx = idx
            break
    
    submission_data = {
        "question_id": question_id,
        "source_code": source_code,
        "outputs": outputs,
        "submitted_at": datetime.utcnow(),
        "status": "saved"  # saved, submitted, completed
    }
    
    if existing_submission_idx is not None:
        # Update existing submission
        submissions[existing_submission_idx] = submission_data
    else:
        # Add new submission
        submissions.append(submission_data)
    
    # Update test submission
    await db.test_submissions.update_one(
        {"_id": test_submission["_id"]},
        {
            "$set": {
                "submissions": submissions,
                "updated_at": datetime.utcnow()
            }
        }
    )
    
    return {
        "message": "Answer saved successfully",
        "question_id": question_id,
        "submitted_at": submission_data["submitted_at"].isoformat()
    }


@router.post("/{test_id}/submit")
async def submit_test(
    test_id: str,
    user_id: str = Body(..., description="User ID from link token"),
    answers: List[Dict[str, Any]] = Body(default=[], description="Final answers with question_id and source_code")
):
    """
    Final test submission - evaluates all code with AI and generates scores/feedback.
    
    This endpoint:
    1. Collects all submitted answers
    2. Sends each answer to AI for evaluation
    3. Calculates total score (out of 100)
    4. Stores AI feedback for each question
    5. Marks the test as completed
    """
    from ..services.ai_feedback import evaluate_aiml_submission
    import asyncio
    
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    # Verify test exists
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Find test submission
    test_submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not test_submission:
        # Create new submission if it doesn't exist
        test_submission = {
            "test_id": test_id,
            "user_id": user_id,
            "submissions": [],
            "score": 0,
            "started_at": datetime.utcnow(),
            "is_completed": False,
        }
        result = await db.test_submissions.insert_one(test_submission)
        test_submission["_id"] = result.inserted_id
    
    # Enforce one attempt per email per test (email is unique)
    candidate_email = (test_submission.get("candidate_email") or "").strip().lower()
    if not candidate_email:
        user_doc = await db.users.find_one({"_id": ObjectId(user_id)})
        candidate_email = str((user_doc or {}).get("email") or "").strip().lower()
    if candidate_email:
        existing_completed_by_email = await db.test_submissions.find_one({
            "test_id": test_id,
            "candidate_email": candidate_email,
            "is_completed": True
        })
        if existing_completed_by_email:
            raise HTTPException(status_code=400, detail="Test already submitted for this email. A candidate can attempt the test only once.")

    # Check if already completed for this user_id
    if test_submission.get("is_completed"):
        raise HTTPException(status_code=400, detail="Test already submitted. A candidate can attempt the test only once.")
    
    # Get existing submissions from database
    existing_submissions = {sub.get("question_id"): sub for sub in test_submission.get("submissions", [])}
    
    # Update with any new answers from this final submission
    for answer in answers:
        question_id = answer.get("question_id")
        if question_id:
            if question_id in existing_submissions:
                # Update existing submission with new code if provided
                if answer.get("source_code"):
                    existing_submissions[question_id]["source_code"] = answer["source_code"]
            else:
                # Add new submission
                existing_submissions[question_id] = {
                    "question_id": question_id,
                    "source_code": answer.get("source_code", ""),
                    "outputs": answer.get("outputs", []),
                    "submitted_at": datetime.utcnow(),
                    "status": "submitted"
                }
    
    # Get all questions for this test
    question_ids = test.get("question_ids", [])
    questions = {}
    for qid in question_ids:
        if ObjectId.is_valid(str(qid)):
            q = await db.questions.find_one({"_id": ObjectId(str(qid))})
            if q:
                questions[str(qid)] = q
    
    # Evaluate each submission with AI
    evaluations = []
    total_score = 0
    max_possible_score = len(questions) * 100 if questions else 100
    
    for question_id, question in questions.items():
        submission = existing_submissions.get(question_id, {})
        
        # Run AI evaluation
        try:
            evaluation = evaluate_aiml_submission(submission, question)
        except Exception as e:
            logger.error(f"AI evaluation failed for question {question_id}: {e}")
            evaluation = {
                "overall_score": 0,
                "feedback_summary": "Evaluation failed. Please contact support.",
                "one_liner": "Evaluation error",
                "ai_generated": False,
                "error": str(e)
            }
        
        question_score = evaluation.get("overall_score", 0)
        total_score += question_score
        
        # Store evaluation with submission
        submission_data = {
            "question_id": question_id,
            "source_code": submission.get("source_code", ""),
            "outputs": submission.get("outputs", []),
            "submitted_at": submission.get("submitted_at", datetime.utcnow()),
            "status": "evaluated",
            "ai_feedback": evaluation,
            "score": question_score
        }
        
        evaluations.append({
            "question_id": question_id,
            "question_title": question.get("title", "Unknown"),
            "score": question_score,
            "feedback": evaluation
        })
        
        # Update in existing_submissions
        existing_submissions[question_id] = submission_data
    
    # Calculate final score out of 100
    final_score = round((total_score / max_possible_score) * 100) if max_possible_score > 0 else 0
    
    # Update test submission
    await db.test_submissions.update_one(
        {"_id": test_submission["_id"]},
        {
            "$set": {
                "submissions": list(existing_submissions.values()),
                "score": final_score,
                "is_completed": True,
                "submitted_at": datetime.utcnow(),
                "evaluations": evaluations,
                "ai_feedback_status": "completed"
            }
        }
    )
    
    logger.info(f"AIML test {test_id} submitted by user {user_id}. Score: {final_score}/100")
    
    return {
        "message": "Test submitted successfully",
        "test_id": test_id,
        "user_id": user_id,
        "score": final_score,
        "total_questions": len(questions),
        "evaluations": evaluations,
        "is_completed": True,
        "submitted_at": datetime.utcnow().isoformat()
    }


@router.post("/{test_id}/pause")
async def pause_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Pause an AIML test.
    Keeps the test published (is_published stays as-is) but records pausedAt.
    Candidates can still be added; new test starts should be blocked while paused.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to pause this test")
    
    if test.get("pausedAt"):
        return {
            "message": "Test is already paused",
            "test_id": test_id,
            "is_published": test.get("is_published", False),
            "pausedAt": test.get("pausedAt").isoformat() if isinstance(test.get("pausedAt"), datetime) else test.get("pausedAt")
        }

    current_status = test.get("is_published", False)
    
    now = datetime.utcnow()
    
    # Update test to paused state (do NOT unpublish)
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {
            "$set": {
                "pausedAt": now,
                "statusBeforePause": "published" if current_status else "draft"
            }
        }
    )
    
    logger.info(f"Test {test_id} paused by user {user_id} at {now}")
    
    return {
        "message": "Test paused successfully",
        "test_id": test_id,
        "is_published": test.get("is_published", False),
        "pausedAt": now.isoformat()
    }


@router.post("/{test_id}/resume")
async def resume_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Resume a paused AIML test.
    Clears pausedAt and records resumeAt timestamp.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to resume this test")
    
    if not test.get("pausedAt"):
        return {
            "message": "Test is already active",
            "test_id": test_id,
            "is_published": test.get("is_published", False)
        }
    
    now = datetime.utcnow()
    previous_status = test.get("statusBeforePause", "published")
    
    # Update test to resumed state (do NOT force publish on)
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {
            "$set": {
                "resumeAt": now,
                "pausedAt": None,
                "statusBeforePause": None
            }
        }
    )
    
    logger.info(f"Test {test_id} resumed by user {user_id} at {now}")
    
    return {
        "message": "Test resumed successfully",
        "test_id": test_id,
        "is_published": test.get("is_published", False),
        "resumeAt": now.isoformat()
    }


@router.post("/{test_id}/clone")
async def clone_test(
    test_id: str,
    payload: Dict[str, Any] = Body(...),
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Clone an AIML test for the current editor (creates a new test document with a new ID).
    Payload:
      - newTitle: str (required)
      - keepSchedule: bool (optional, default False)
      - keepCandidates: bool (optional, default False)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    original = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not original:
        raise HTTPException(status_code=404, detail="Test not found")

    # Ensure AIML test
    if original.get("test_type") != "aiml":
        raise HTTPException(status_code=400, detail="Not an AIML test")
    
    if str(original.get("created_by", "")).strip() != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to clone this test")
    
    new_title = (payload.get("newTitle") or "").strip()
    if len(new_title) < 3:
        raise HTTPException(status_code=400, detail="newTitle must be at least 3 characters")

    keep_schedule = bool(payload.get("keepSchedule", False))
    keep_candidates = bool(payload.get("keepCandidates", False))

    now = datetime.utcnow()
    duration_minutes = int(original.get("duration_minutes") or 60)
    
    cloned = {k: v for k, v in original.items() if k != "_id"}
    cloned["title"] = new_title
    cloned["created_by"] = user_id
    cloned["created_at"] = now
    cloned["updated_at"] = now
    cloned["is_published"] = False
    cloned["is_active"] = False
    cloned["pausedAt"] = None
    cloned["statusBeforePause"] = None
    cloned["resumeAt"] = None
    cloned["test_token"] = None
    cloned["test_type"] = "aiml"

    if not keep_candidates:
        cloned["invited_users"] = []

    if keep_schedule:
        if not cloned.get("start_time"):
            cloned["start_time"] = now
        if not cloned.get("end_time"):
            cloned["end_time"] = now + timedelta(minutes=duration_minutes)
    else:
        cloned["examMode"] = "strict"
        cloned["schedule"] = None
        cloned["start_time"] = now
        cloned["end_time"] = now + timedelta(minutes=duration_minutes)

    res = await db.tests.insert_one(cloned)
    created = await db.tests.find_one({"_id": res.inserted_id})
    if not created:
        raise HTTPException(status_code=500, detail="Failed to clone test")

    return {
        "message": "Test cloned successfully",
        "data": {
            "id": str(created["_id"]),
            "title": created.get("title", ""),
            "description": created.get("description", ""),
            "duration_minutes": created.get("duration_minutes", 0),
            "start_time": created.get("start_time").isoformat() if created.get("start_time") else None,
            "end_time": created.get("end_time").isoformat() if created.get("end_time") else None,
            "examMode": created.get("examMode", "strict"),
            "schedule": created.get("schedule"),
            "is_active": created.get("is_active", False),
            "is_published": created.get("is_published", False),
            "invited_users": created.get("invited_users", []),
            "test_token": created.get("test_token"),
            "pausedAt": created.get("pausedAt"),
        }
    }


@router.delete("/{test_id}")
async def delete_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Delete a test (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this test")
    
    result = await db.tests.delete_one({"_id": ObjectId(test_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Test not found")
    
    return {"message": "Test deleted successfully"}


@router.post("/{test_id}/add-candidate")
async def add_candidate(
    test_id: str,
    candidate: AddCandidateRequest
):
    """
    Add a candidate to an AIML test (creates user account).
    IMPORTANT: Does NOT send invitation email. Emails are sent only from explicit "Send Email" actions.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before adding candidates")
    
    # Check if candidate already exists for this test
    existing_candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "email": candidate.email
    })
    if existing_candidate:
        raise HTTPException(status_code=400, detail="Candidate already added to this test")
    
    # Check if user already exists
    existing_user = await db.users.find_one({"email": candidate.email})
    if existing_user:
        user_id = str(existing_user["_id"])
    else:
        # Create new user account
        user_dict = {
            "username": candidate.name.lower().replace(" ", "_"),
            "email": candidate.email,
            "hashed_password": "",  # No password - candidates use shared link
            "is_admin": False,
            "total_score": 0,
            "questions_solved": 0,
        }
        result = await db.users.insert_one(user_dict)
        user_id = str(result.inserted_id)
    
    # Store candidate record
    candidate_record = {
        "test_id": test_id,
        "user_id": user_id,
        "name": candidate.name,
        "email": candidate.email,
        "status": "pending",  # pending -> invited -> started -> completed
        "invited": False,
        "invited_at": None,
        "created_at": datetime.utcnow(),
    }
    await db.test_candidates.insert_one(candidate_record)
    
    # Add email to invited_users if not already there
    current_invited = set(test.get("invited_users", []))
    current_invited.add(candidate.email)
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"invited_users": list(current_invited)}}
    )
    
    # Get the shared test link
    test_token = test.get("test_token")
    if not test_token:
        # Generate token if not exists (shouldn't happen if test is published)
        test_token = secrets.token_urlsafe(32)
        await db.tests.update_one(
            {"_id": ObjectId(test_id)},
            {"$set": {"test_token": test_token}}
        )
    
    # Build full test URL
    settings = get_settings()
    cors_origins = settings.cors_origins.split(",")[0].strip() if settings.cors_origins else "http://localhost:3000"
    test_link = f"{cors_origins}/aiml/test/{test_id}?token={test_token}"
    
    return {
        "candidate_id": user_id,
        "test_link": test_link,
        "name": candidate.name,
        "email": candidate.email,
    }


@router.post("/{test_id}/bulk-add-candidates")
async def bulk_add_candidates(
    test_id: str,
    file: UploadFile = File(...)
):
    """
    Bulk add candidates from CSV file
    CSV format: name,email (header row required)
    IMPORTANT: Does NOT send invitation emails.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before adding candidates")
    
    contents = await file.read()
    try:
        csv_text = contents.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Please use UTF-8 encoded CSV.")
    
    csv_reader = csv.DictReader(io.StringIO(csv_text))
    
    if not csv_reader.fieldnames or 'name' not in csv_reader.fieldnames or 'email' not in csv_reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must have 'name' and 'email' columns")
    
    results = {
        "success": [],
        "failed": [],
        "duplicates": []
    }
    
    current_invited = set([str(e).strip().lower() for e in test.get("invited_users", [])])
    
    for row in csv_reader:
        name = (row.get('name', '') or '').strip()
        email = (row.get('email', '') or '').strip().lower()
        
        if not name or not email:
            results["failed"].append({
                "name": name or "N/A",
                "email": email or "N/A",
                "reason": "Name or email is empty"
            })
            continue
        
        existing_candidate = await db.test_candidates.find_one({"test_id": test_id, "email": email})
        if existing_candidate:
            results["duplicates"].append({"name": name, "email": email})
            continue
        
        existing_user = await db.users.find_one({"email": email})
        if existing_user:
            user_id = str(existing_user["_id"])
        else:
            user_dict = {
                "username": name.lower().replace(" ", "_"),
                "email": email,
                "hashed_password": "",
                "is_admin": False,
                "total_score": 0,
                "questions_solved": 0,
            }
            result = await db.users.insert_one(user_dict)
            user_id = str(result.inserted_id)
        
        candidate_record = {
            "test_id": test_id,
            "user_id": user_id,
            "name": name,
            "email": email,
            "status": "pending",
            "invited": False,
            "invited_at": None,
            "created_at": datetime.utcnow(),
        }
        await db.test_candidates.insert_one(candidate_record)
        
        current_invited.add(email)
        results["success"].append({"name": name, "email": email})
    
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"invited_users": list(current_invited)}}
    )
    
    return {
        "success_count": len(results["success"]),
        "failed_count": len(results["failed"]),
        "duplicate_count": len(results["duplicates"]),
        "success": results["success"],
        "failed": results["failed"],
        "duplicates": results["duplicates"],
    }


@router.post("/{test_id}/send-invitation")
async def send_invitation(
    test_id: str,
    email: str = Body(..., embed=True),
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Send invitation email to a single candidate (explicit action only).
    Uses test.invitationTemplate if configured, otherwise system default template.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to send invitations for this test")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before sending invitations")
    
    candidate_email = str(email or "").strip().lower()
    if not candidate_email:
        raise HTTPException(status_code=400, detail="Email is required")
    
    candidate = await db.test_candidates.find_one({"test_id": test_id, "email": candidate_email})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found for this test")
    
    candidate_name = candidate.get("name") or "Candidate"
    
    # Ensure shared token exists
    test_token = test.get("test_token")
    if not test_token:
        test_token = secrets.token_urlsafe(32)
        await db.tests.update_one({"_id": ObjectId(test_id)}, {"$set": {"test_token": test_token}})
    
    settings = get_settings()
    cors_origins = settings.cors_origins.split(",")[0].strip() if settings.cors_origins else "http://localhost:3000"
    test_link = f"{cors_origins}/aiml/test/{test_id}?token={test_token}"
    
    stored_template = test.get("invitationTemplate", {})
    default_template = {
        "logoUrl": "",
        "companyName": "",
        "message": "You have been invited to take an AIML competency assessment. Please click the link below to start.",
        "footer": "",
        "sentBy": "AI Assessment Platform"
    }
    template_to_use = stored_template if stored_template else default_template
    
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        raise HTTPException(status_code=500, detail="Email service is not configured")
    
    email_service = get_email_service()
    
    encoded_email = urllib.parse.quote(candidate_email)
    encoded_name = urllib.parse.quote(candidate_name)
    exam_url_with_params = f"{test_link}&email={encoded_email}&name={encoded_name}"
    
    message = template_to_use.get("message", default_template["message"])
    email_body = message
    email_body = email_body.replace("{{candidate_name}}", candidate_name)
    email_body = email_body.replace("{{candidate_email}}", candidate_email)
    email_body = email_body.replace("{{exam_url}}", exam_url_with_params)
    email_body = email_body.replace("{{company_name}}", template_to_use.get("companyName", ""))
    
    logo_url = template_to_use.get("logoUrl", "")
    company_name = template_to_use.get("companyName", "")
    footer = template_to_use.get("footer", "")
    sent_by = template_to_use.get("sentBy", "AI Assessment Platform")
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ text-align: center; margin-bottom: 30px; }}
            .logo {{ max-width: 200px; margin-bottom: 20px; }}
            .content {{ background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #10b981; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #10b981; color: #ffffff; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
            .footer {{ text-align: center; color: #64748b; font-size: 0.875rem; margin-top: 30px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                {f'<img src="{logo_url}" alt="Logo" class="logo" />' if logo_url else ''}
                {f'<h1>{company_name}</h1>' if company_name else ''}
            </div>
            <div class="content">
                <p>Dear {candidate_name},</p>
                <p>{email_body}</p>
                <div style="text-align: center;">
                    <a href="{exam_url_with_params}" class="button">Start AIML Assessment</a>
                </div>
            </div>
            {f'<div class="footer"><p>{footer}</p></div>' if footer else ''}
            <div class="footer">
                <p>Sent by {sent_by}</p>
            </div>
        </div>
    </body>
    </html>
    """
    
    subject = f"AIML Assessment Invitation - {company_name if company_name else 'AI Assessment Platform'}"
    await email_service.send_email(candidate_email, subject, html_content)
    
    await db.test_candidates.update_one(
        {"test_id": test_id, "email": candidate_email},
        {"$set": {"status": "invited", "invited": True, "invited_at": datetime.utcnow()}}
    )
    
    return {"message": "Invitation sent", "email": candidate_email}


@router.get("/{test_id}/candidates")
async def get_test_candidates(
    test_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all candidates for an AIML test (requires authentication and ownership)
    Only test creators can view candidates
    """
    db = get_database()
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_test_candidates] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Verify test ownership
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to view candidates for this test")
    
    # Get all candidates for this test
    candidates = await db.test_candidates.find({"test_id": test_id}).to_list(length=1000)
    
    # Get submission status for each candidate
    result = []
    for candidate in candidates:
        user_id_cand = candidate.get("user_id")
        
        # Check if candidate has submitted
        submission = await db.test_submissions.find_one({
            "test_id": test_id,
            "user_id": user_id_cand,
            "is_completed": True
        })
        
        has_submitted = submission is not None
        submission_score = submission.get("score", 0) if submission else 0
        submitted_at = submission.get("submitted_at") if submission else None
        
        result.append({
            "user_id": user_id_cand,
            "name": candidate.get("name"),
            "email": candidate.get("email"),
            "status": candidate.get("status", "pending"),
            "invited": candidate.get("invited", False),
            "invited_at": candidate.get("invited_at").isoformat() if candidate.get("invited_at") else None,
            "created_at": candidate.get("created_at").isoformat() if candidate.get("created_at") else None,
            "has_submitted": has_submitted,
            "submission_score": submission_score,
            "submitted_at": submitted_at.isoformat() if submitted_at else None,
        })
    
    return result


@router.post("/{test_id}/send-invitations-to-all")
async def send_invitations_to_all(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Send invitation emails to all candidates for an AIML test
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Check if test exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to send invitations for this test")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before sending invitations")
    
    # Get all candidates for this test
    candidates = await db.test_candidates.find({"test_id": test_id}).to_list(length=1000)
    
    if not candidates:
        return {
            "message": "No candidates to send invitations to",
            "success_count": 0,
            "failed_count": 0,
            "failed_emails": []
        }
    
    # Get the shared test link
    test_token = test.get("test_token")
    if not test_token:
        # Generate token if not exists
        test_token = secrets.token_urlsafe(32)
        await db.tests.update_one(
            {"_id": ObjectId(test_id)},
            {"$set": {"test_token": test_token}}
        )
    
    # Build full test URL
    settings = get_settings()
    cors_origins = settings.cors_origins.split(",")[0].strip() if settings.cors_origins else "http://localhost:3000"
    test_link = f"{cors_origins}/aiml/test/{test_id}?token={test_token}"
    
    # Get email template
    stored_template = test.get("invitationTemplate", {})
    default_template = {
        "logoUrl": "",
        "companyName": "",
        "message": "You have been invited to take an AIML competency assessment. Please click the link below to start.",
        "footer": "",
        "sentBy": "AI Assessment Platform"
    }
    template_to_use = stored_template if stored_template else default_template
    
    success_count = 0
    failed_count = 0
    failed_emails = []
    
    # Send emails to all candidates
    for candidate in candidates:
        try:
            if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
                logger.warning("SendGrid is not configured. Skipping email send.")
                failed_count += 1
                failed_emails.append(candidate.get("email"))
                continue
            
            email_service = get_email_service()
            
            # Build exam URL with candidate params
            encoded_email = urllib.parse.quote(candidate.get("email"))
            encoded_name = urllib.parse.quote(candidate.get("name"))
            exam_url_with_params = f"{test_link}&email={encoded_email}&name={encoded_name}"
            
            # Replace placeholders
            message = template_to_use.get("message", default_template["message"])
            email_body = message
            email_body = email_body.replace("{{candidate_name}}", candidate.get("name"))
            email_body = email_body.replace("{{candidate_email}}", candidate.get("email"))
            email_body = email_body.replace("{{exam_url}}", exam_url_with_params)
            email_body = email_body.replace("{{company_name}}", template_to_use.get("companyName", ""))
            
            # Build HTML email
            logo_url = template_to_use.get("logoUrl", "")
            company_name = template_to_use.get("companyName", "")
            footer = template_to_use.get("footer", "")
            sent_by = template_to_use.get("sentBy", "AI Assessment Platform")
            
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                    .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                    .header {{ text-align: center; margin-bottom: 30px; }}
                    .logo {{ max-width: 200px; margin-bottom: 20px; }}
                    .content {{ background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #10b981; }}
                    .button {{ display: inline-block; padding: 12px 24px; background-color: #10b981; color: #ffffff; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                    .footer {{ text-align: center; color: #64748b; font-size: 0.875rem; margin-top: 30px; }}
                    .candidate-info {{ background-color: #ffffff; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #10b981; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        {f'<img src="{logo_url}" alt="Logo" class="logo" />' if logo_url else ''}
                        {f'<h1>{company_name}</h1>' if company_name else ''}
                    </div>
                    <div class="content">
                        <p>Dear {candidate.get("name")},</p>
                        <p>{email_body}</p>
                        <div class="candidate-info">
                            <p><strong>Your Details:</strong></p>
                            <p><strong>Name:</strong> {candidate.get("name")}</p>
                            <p><strong>Email:</strong> {candidate.get("email")}</p>
                        </div>
                        <div style="text-align: center;">
                            <a href="{exam_url_with_params}" class="button">Start AIML Assessment</a>
                        </div>
                    </div>
                    {f'<div class="footer"><p>{footer}</p></div>' if footer else ''}
                    <div class="footer">
                        <p>Sent by {sent_by}</p>
                    </div>
                </div>
            </body>
            </html>
            """
            
            subject = f"AIML Assessment Invitation - {company_name if company_name else 'AI Assessment Platform'}"
            
            await email_service.send_email(candidate.get("email"), subject, html_content)
            
            # Update candidate status to "invited"
            await db.test_candidates.update_one(
                {"test_id": test_id, "email": candidate.get("email")},
                {"$set": {
                    "status": "invited",
                    "invited": True,
                    "invited_at": datetime.utcnow()
                }}
            )
            
            success_count += 1
            logger.info(f"Invitation email sent successfully to {candidate.get('email')}")
        except Exception as e:
            failed_count += 1
            failed_emails.append(candidate.get("email"))
            logger.error(f"Failed to send invitation email to {candidate.get('email')}: {str(e)}")
    
    return {
        "message": f"Invitations sent. Success: {success_count}, Failed: {failed_count}",
        "success_count": success_count,
        "failed_count": failed_count,
        "failed_emails": failed_emails
    }


@router.get("/{test_id}/candidates/{user_id}/analytics")
async def get_candidate_analytics(
    test_id: str,
    user_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get detailed analytics for a specific candidate (requires authentication and ownership)
    """
    db = get_database()
    admin_user_id = current_user.get("id") or current_user.get("_id")
    if not admin_user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    admin_user_id = str(admin_user_id).strip()
    
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    # Verify test ownership
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != admin_user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to view analytics for this test")
    
    # Get candidate info
    candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    # Get test submission
    submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not submission:
        return {
            "candidate": {
                "name": candidate.get("name"),
                "email": candidate.get("email")
            },
            "submission": None,
            "question_analytics": [],
            "activity_logs": []
        }
    
    # Get question IDs from test
    question_ids = test.get("question_ids", [])
    
    # Get submissions for each question
    question_analytics = []
    submissions_list = submission.get("submissions", [])
    
    for qid in question_ids:
        question = await db.questions.find_one({"_id": ObjectId(qid)})
        if not question:
            continue
        
        # Find submission for this question
        question_submission = None
        for sub in submissions_list:
            if sub.get("question_id") == str(qid):
                question_submission = sub
                break
        
        # Get AI feedback from submission if available
        ai_feedback = question_submission.get("ai_feedback") if question_submission else None
        question_score = question_submission.get("score", 0) if question_submission else 0
        
        question_analytics.append({
            "question_id": str(qid),
            "question_title": question.get("title", ""),
            "description": question.get("description", ""),
            "tasks": question.get("tasks", []),
            "difficulty": question.get("difficulty", "medium"),
            "language": "python3",
            "status": question_submission.get("status", "submitted") if question_submission else "not_submitted",
            "code": question_submission.get("source_code", "") if question_submission else "",
            "outputs": question_submission.get("outputs", []) if question_submission else [],
            "submitted_at": question_submission.get("submitted_at").isoformat() if question_submission and question_submission.get("submitted_at") else None,
            "created_at": question_submission.get("submitted_at").isoformat() if question_submission and question_submission.get("submitted_at") else None,
            # AI Feedback fields
            "score": question_score,
            "ai_feedback": ai_feedback,
        })
    
    return {
        "candidate": {
            "name": candidate.get("name"),
            "email": candidate.get("email")
        },
        "submission": {
            "score": submission.get("score", 0),
            "started_at": submission.get("started_at").isoformat() if submission.get("started_at") else None,
            "submitted_at": submission.get("submitted_at").isoformat() if submission.get("submitted_at") else None,
            "is_completed": submission.get("is_completed", False),
            "ai_feedback_status": submission.get("ai_feedback_status", "pending"),
            "evaluations": submission.get("evaluations", [])
        },
        "question_analytics": question_analytics,
        "activity_logs": []  # AIML doesn't have proctoring logs yet
    }


@router.delete("/{test_id}/candidates/{user_id}")
async def remove_candidate(
    test_id: str,
    user_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Remove a candidate from an AIML test (requires authentication and ownership)
    """
    db = get_database()
    admin_user_id = current_user.get("id") or current_user.get("_id")
    if not admin_user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    admin_user_id = str(admin_user_id).strip()
    
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    # Verify test ownership
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if str(test.get("created_by")) != admin_user_id:
        raise HTTPException(status_code=403, detail="You don't have permission to remove candidates from this test")
    
    # Get candidate info
    candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    # Remove candidate record
    await db.test_candidates.delete_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    # Remove from invited_users list
    current_invited = set(test.get("invited_users", []))
    current_invited.discard(candidate.get("email"))
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"invited_users": list(current_invited)}}
    )
    
    return {"message": "Candidate removed successfully"}

