"""
Routers for Custom MCQ Test module.
Completely independent from AI-based assessments.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ....core.dependencies import require_editor
from ....db.mongo import get_db
from ....utils.mongo import to_object_id
from ....utils.responses import success_response
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
    """Get current UTC datetime."""
    return datetime.now(timezone.utc)


def _check_test_access(test: Dict[str, Any], current_user: Dict[str, Any]) -> None:
    """Check if user has access to this test."""
    if current_user.get("role") == "super_admin":
        return
    
    # Check if user created this test
    test_created_by = test.get("createdBy")
    user_id = current_user.get("id")
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this test"
        )
    
    # Normalize IDs to strings for comparison (handle both ObjectId and string)
    if test_created_by is not None:
        test_created_by = str(test_created_by)
    user_id_str = str(user_id)
    
    # Allow access only if user created the test
    if test_created_by != user_id_str:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this test"
        )


@router.get("/csv-template")
async def download_csv_template():
    """Download CSV template for custom MCQ test."""
    template = generate_csv_template()
    return success_response("CSV template generated", {"template": template})


@router.post("/validate-csv")
async def validate_csv(
    payload: CSVUploadRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
):
    """Validate uploaded CSV file."""
    try:
        rows, errors = parse_csv_content(payload.csvContent)
        
        if errors:
            return success_response(
                "CSV validation failed",
                CSVValidationResponse(
                    valid=False,
                    errors=errors,
                    questions=[],
                    sections=[],
                ).dict()
            )
        
        # Group by sections
        sections_dict = group_questions_by_section(rows)
        sections = list(sections_dict.keys())
        
        # Flatten questions for preview
        all_questions = []
        for section_name, questions in sections_dict.items():
            for q in questions:
                all_questions.append({
                    **q,
                    "section": section_name,
                })
        
        return success_response(
            "CSV validation successful",
            CSVValidationResponse(
                valid=True,
                errors=[],
                questions=all_questions,
                sections=sections,
            ).dict()
        )
    except Exception as exc:
        logger.exception(f"Error validating CSV: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to validate CSV: {str(exc)}"
        ) from exc


@router.post("/create-test")
async def create_custom_mcq_test(
    payload: CreateCustomMCQTestRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create a new custom MCQ test from validated data."""
    try:
        # Calculate total marks
        total_marks = 0
        for section in payload.sections:
            for question in section.questions:
                total_marks += question.marks
        
        # Generate test token
        test_token = secrets.token_urlsafe(32)
        
        # Build test document
        test_doc = {
            "type": "custom_mcq",  # Distinguish from AI assessments
            "title": payload.settings.title,
            "description": payload.settings.description,
            "instructions": getattr(payload.settings, 'instructions', None),
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
            "createdBy": to_object_id(current_user["id"]),  # Store as ObjectId for consistency
            "organization": current_user.get("organization"),
            "createdAt": _now_utc().isoformat(),
            "updatedAt": _now_utc().isoformat(),
            "status": "draft",
        }
        
        # Insert into database
        result = await db.custom_mcq_tests.insert_one(test_doc)
        test_id = str(result.inserted_id)
        
        logger.info(f"Custom MCQ test created: {test_id} by user {current_user['id']}")
        
        # Generate test access URL
        from ....config.settings import get_settings
        settings = get_settings()
        base_url = getattr(settings, 'frontend_url', 'http://localhost:3000')
        test_url = f"{base_url}/custom-mcq/test/{test_id}/{test_token}"
        
        # Store the URL in the test document
        await db.custom_mcq_tests.update_one(
            {"_id": result.inserted_id},
            {"$set": {"examAccessUrl": test_url}}
        )
        
        return success_response(
            "Custom MCQ test created successfully",
            {
                "testId": test_id,
                "testToken": test_token,
                "testUrl": test_url,
            }
        )
    except Exception as exc:
        logger.exception(f"Error creating custom MCQ test: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create test: {str(exc)}"
        ) from exc


@router.get("/list")
async def list_custom_mcq_tests(
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
):
    """List all custom MCQ tests for the current user."""
    try:
        # Build query based on user role
        query: Dict[str, Any] = {}
        if current_user.get("role") == "super_admin":
            # For super_admin: only show tests created by super_admins (any super_admin)
            # Query users collection to get all super_admin user IDs
            super_admin_cursor = db.users.find(
                {"role": "super_admin"},
                {"_id": 1}
            )
            super_admin_ids = [doc["_id"] async for doc in super_admin_cursor]
            
            if super_admin_ids:
                # Filter tests where createdBy is in the list of super_admin IDs
                # Convert to ObjectId for proper matching (createdBy is stored as ObjectId)
                try:
                    query["createdBy"] = {"$in": [to_object_id(str(sid)) for sid in super_admin_ids]}
                except (ValueError, TypeError):
                    # If conversion fails, try as strings (for backward compatibility)
                    query["createdBy"] = {"$in": [str(sid) for sid in super_admin_ids]}
            else:
                # No super_admins found - return empty result
                query["createdBy"] = {"$in": []}
        else:
            # Filter by createdBy to ensure users only see their own tests
            user_id = current_user.get("id")
            if user_id:
                try:
                    # Try to convert to ObjectId if it's a valid ObjectId string
                    query["createdBy"] = to_object_id(user_id)
                except (ValueError, TypeError):
                    # If conversion fails, use as string (for backward compatibility)
                    query["createdBy"] = str(user_id)
        
        # Fetch tests
        cursor = db.custom_mcq_tests.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        tests = await cursor.to_list(length=limit)
        
        # Serialize
        test_list = []
        for test in tests:
            test_list.append({
                "id": str(test["_id"]),
                "title": test.get("title"),
                "description": test.get("description"),
                "totalMarks": test.get("totalMarks", 0),
                "status": test.get("status", "draft"),
                "isDraft": test.get("isDraft", False),
                "progressStep": test.get("progressStep", 1),
                "createdAt": test.get("createdAt"),
                "sectionsCount": len(test.get("sections", [])),
                "type": test.get("type", "custom_mcq"),
            })
        
        return success_response("Tests fetched successfully", test_list)
    except Exception as exc:
        logger.exception(f"Error listing custom MCQ tests: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list tests: {str(exc)}"
        ) from exc


@router.get("/{test_id}")
async def get_custom_mcq_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get a specific custom MCQ test."""
    try:
        oid = to_object_id(test_id)
        test = await db.custom_mcq_tests.find_one({"_id": oid})
        
        if not test:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")
        
        _check_test_access(test, current_user)
        
        # Convert ObjectId to string
        test["_id"] = str(test["_id"])
        
        return success_response("Test fetched successfully", test)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error fetching custom MCQ test: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch test: {str(exc)}"
        ) from exc


@router.put("/{test_id}")
async def update_custom_mcq_test(
    test_id: str,
    payload: CreateCustomMCQTestRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update an existing custom MCQ test."""
    try:
        oid = to_object_id(test_id)
        test = await db.custom_mcq_tests.find_one({"_id": oid})
        
        if not test:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")
        
        _check_test_access(test, current_user)
        
        # Calculate total marks
        total_marks = 0
        for section in payload.sections:
            for question in section.questions:
                total_marks += question.marks
        
        # Build update document
        update_doc = {
            "title": payload.settings.title,
            "description": payload.settings.description,
            "instructions": payload.settings.instructions,
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
            "candidates": [
                {
                    "name": c.name,
                    "email": c.email.lower().strip(),
                    "phone": c.phone,
                    "invited": c.email.lower().strip() in [existing.get("email", "").lower() for existing in test.get("candidates", [])],
                    "inviteSentAt": next((existing.get("inviteSentAt") for existing in test.get("candidates", []) if existing.get("email", "").lower() == c.email.lower().strip()), None),
                    "status": next((existing.get("status", "pending") for existing in test.get("candidates", []) if existing.get("email", "").lower() == c.email.lower().strip()), "pending"),
                }
                for c in (payload.candidates or [])
            ],
            "updatedAt": _now_utc().isoformat(),
        }
        
        # Update test document
        await db.custom_mcq_tests.update_one(
            {"_id": oid},
            {"$set": update_doc}
        )
        
        logger.info(f"Custom MCQ test updated: {test_id} by user {current_user['id']}")
        
        # Get updated test to return
        updated_test = await db.custom_mcq_tests.find_one({"_id": oid})
        updated_test["_id"] = str(updated_test["_id"])
        
        return success_response(
            "Custom MCQ test updated successfully",
            {
                "testId": test_id,
                "test": updated_test,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error updating custom MCQ test: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update test: {str(exc)}"
        ) from exc


@router.get("/test/{test_id}/{token}")
async def get_test_for_candidate(
    test_id: str,
    token: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get test details for candidate (no auth required, uses token)."""
    try:
        oid = to_object_id(test_id)
        test = await db.custom_mcq_tests.find_one({"_id": oid, "testToken": token})
        
        if not test:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found or invalid token")
        
        # Don't expose sensitive data to candidates
        test_data = {
            "_id": str(test["_id"]),
            "title": test.get("title"),
            "description": test.get("description"),
            "instructions": test.get("instructions"),
            "sections": test.get("sections", []),
            "totalMarks": test.get("totalMarks", 0),
            "timerMode": test.get("timerMode"),
            "examDuration": test.get("examDuration"),
            "sectionTimes": test.get("sectionTimes", {}),
            "schedule": test.get("schedule", {}),
            "accessMode": test.get("accessMode", "private"),
        }
        
        return success_response("Test fetched successfully", test_data)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error fetching custom MCQ test: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch test: {str(exc)}"
        ) from exc


@router.post("/test/{test_id}/{token}/submit")
async def submit_test_answers(
    test_id: str,
    token: str,
    payload: Dict[str, Any] = Body(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Submit test answers from candidate."""
    try:
        oid = to_object_id(test_id)
        test = await db.custom_mcq_tests.find_one({"_id": oid, "testToken": token})
        
        if not test:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found or invalid token")
        
        candidate_email = payload.get("email", "").lower().strip()
        candidate_name = payload.get("name", "").strip()
        answers = payload.get("answers", {})  # {questionId: selectedOption}
        logs = payload.get("logs", [])  # Array of log events
        
        if not candidate_email or not candidate_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email and name are required")
        
        # Store candidate response
        candidate_key = f"{candidate_email}_{candidate_name.lower()}"
        
        if "candidateResponses" not in test:
            test["candidateResponses"] = {}
        
        # Calculate score
        total_score = 0
        total_marks = 0
        correct_count = 0
        wrong_count = 0
        
        for section in test.get("sections", []):
            for question in section.get("questions", []):
                question_id = f"{section['name']}_{question.get('question', '')}"
                total_marks += question.get("marks", 0)
                
                if question_id in answers:
                    selected = answers[question_id]
                    correct = question.get("correctAnswer", "").upper()
                    
                    if selected.upper() == correct:
                        total_score += question.get("marks", 0)
                        correct_count += 1
                    else:
                        if test.get("allowNegativeMarking", False):
                            total_score -= question.get("marks", 0) * 0.25  # -25% for wrong
                        wrong_count += 1
        
        # Store response
        test["candidateResponses"][candidate_key] = {
            "email": candidate_email,
            "name": candidate_name,
            "answers": answers,
            "score": max(0, total_score),  # Don't allow negative scores
            "totalMarks": total_marks,
            "correctCount": correct_count,
            "wrongCount": wrong_count,
            "percentage": (max(0, total_score) / total_marks * 100) if total_marks > 0 else 0,
            "submittedAt": _now_utc().isoformat(),
            "status": "completed",
            "logs": logs,
        }
        
        # Update test document
        await db.custom_mcq_tests.update_one(
            {"_id": oid},
            {"$set": {"candidateResponses": test["candidateResponses"]}}
        )
        
        return success_response("Test submitted successfully", {
            "score": max(0, total_score),
            "totalMarks": total_marks,
            "percentage": (max(0, total_score) / total_marks * 100) if total_marks > 0 else 0,
        })
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error submitting test: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
              detail=f"Failed to submit test: {str(exc)}"
              ) from exc


# =====================================================================
# DRAFT MANAGEMENT ENDPOINTS
# =====================================================================

@router.post("/create-draft")
async def create_draft(
    payload: CreateDraftRequest = Body(default=CreateDraftRequest(title=None)),
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create a new empty draft for Custom MCQ Test."""
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

