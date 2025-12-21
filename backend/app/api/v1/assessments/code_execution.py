"""
Assessment code execution router for running and submitting code.
This is separate from DSA assessment routes and handles general assessment questions.
"""
import logging
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ....db.mongo import get_database
from ..dsa.utils.judge0 import run_all_test_cases, LANGUAGE_IDS

logger = logging.getLogger("backend")
router = APIRouter(prefix="/api/v1/assessment", tags=["assessment"])


# ============================================================================
# Request/Response Models
# ============================================================================

class RunCodeRequest(BaseModel):
    """Request for running code (public test cases only)"""
    question_id: str
    source_code: str
    language_id: int
    assessment_id: Optional[str] = None  # Optional: helps narrow down search


class SubmitCodeRequest(BaseModel):
    """Request for submitting code (all test cases)"""
    question_id: str
    source_code: str
    language_id: int
    assessment_id: Optional[str] = None  # Optional: helps narrow down search


class PublicTestResult(BaseModel):
    """Full details for public test case - visible to users"""
    id: str
    test_number: int
    input: str
    expected_output: str
    user_output: str
    status: str
    status_id: int
    time: Optional[float] = None
    memory: Optional[int] = None
    passed: bool
    stderr: Optional[str] = None
    compile_output: Optional[str] = None


class HiddenTestResult(BaseModel):
    """Limited details for hidden test case - only pass/fail"""
    id: str
    test_number: int
    passed: bool
    status: str


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/run")
async def run_code(request: RunCodeRequest):
    """
    RUN CODE - Execute only PUBLIC test cases.
    Returns full details for all public test cases.
    Used when user clicks "Run Code" button.
    """
    logger.info(f"Running code for assessment question {request.question_id} (public tests only)")
    logger.info(f"Request data: question_id={request.question_id}, language_id={request.language_id}, source_code_length={len(request.source_code)}")
    
    db = get_database()
    
    # Try to find question in assessments collection
    # Handle both ObjectId and string IDs
    question = None
    question_id = request.question_id
    
    # Try with ObjectId if valid
    if ObjectId.is_valid(question_id):
        question = await db.assessments.find_one(
            {"questions._id": ObjectId(question_id)},
            {"questions.$": 1}
        )
        
        # If not found in assessments, try topics_v2 collection
        if not question:
            question = await db.topics_v2.find_one(
                {"questions._id": ObjectId(question_id)},
                {"questions.$": 1}
            )
    
    # If not found with ObjectId, try searching by string ID or position
    if not question:
        logger.info(f"Searching for question by string ID: {question_id}")
        # If assessment_id is provided, search only in that assessment
        if request.assessment_id and ObjectId.is_valid(request.assessment_id):
            assessment = await db.assessments.find_one({"_id": ObjectId(request.assessment_id)})
            assessments = [assessment] if assessment else []
            logger.info(f"Searching in specific assessment: {request.assessment_id}")
        else:
            # Search in all assessments
            assessments = await db.assessments.find({}).to_list(length=None)
            logger.info(f"Searching through {len(assessments)} assessments")
        
        # Try to parse the generated ID format: topicId-rowId-questionIndex-counter
        # Example: "23563dea-0781-401f-9fac-cdcc266444d0-6bfc0428-d9e0-437f-9945-fe07004fd134-0-3"
        # Format: ${topicId}-${rowId}-${questionIndex}-${counter}
        id_parts = question_id.split("-")
        parsed_question_index = None
        
        # Try to extract questionIndex from the ID
        # The last part is usually the counter, second-to-last might be questionIndex
        if len(id_parts) >= 2:
            # Try the last few parts to find questionIndex
            for i in range(len(id_parts) - 1, max(0, len(id_parts) - 4), -1):
                try:
                    potential_index = int(id_parts[i])
                    # Question index is usually small (0-10), counter might be larger
                    if potential_index < 100:  # Reasonable upper bound for question index
                        parsed_question_index = potential_index
                        break
                except ValueError:
                    continue
        
        for assessment_idx, assessment in enumerate(assessments):
            if not assessment:
                continue
                
            assessment_id_str = str(assessment.get("_id", ""))
            
            topics_v2 = assessment.get("topics_v2", [])
            for topic_idx, topic in enumerate(topics_v2):
                topic_id = str(topic.get("id", "")) or str(topic.get("_id", ""))
                
                # Check if topic_id is in the question_id (since ID format is topicId-rowId-questionIndex-counter)
                if not topic_id or topic_id not in question_id:
                    continue
                
                question_rows = topic.get("questionRows", [])
                for row_idx, row in enumerate(question_rows):
                    row_id = str(row.get("rowId", "")) or str(row.get("id", ""))
                    
                    # Check if row_id is in the question_id
                    if not row_id or row_id not in question_id:
                        continue
                    
                    questions = row.get("questions", [])
                    for q_idx, q in enumerate(questions):
                        # Check multiple ID fields first
                        q_id = str(q.get("_id", ""))
                        q_id2 = str(q.get("id", ""))
                        
                        # Try exact match
                        if q_id == question_id or q_id2 == question_id:
                            logger.info(f"Found question by exact ID match in assessment {assessment_id_str[:8]}...")
                            question = q
                            break
                        
                        # Try to match by position if we parsed question_index and it matches
                        if parsed_question_index is not None and q_idx == parsed_question_index:
                            logger.info(f"Found question by position match: topic={topic_id[:8]}..., row={row_id[:8]}..., index={q_idx}")
                            question = q
                            break
                        
                        # Fallback: if we're at a position that matches any numeric part in the ID
                        # Check if any numeric part of question_id matches the question index
                        for part in id_parts:
                            try:
                                if int(part) == q_idx and q_idx < len(questions):
                                    logger.info(f"Found question by pattern match: index={q_idx}")
                                    question = q
                                    break
                            except ValueError:
                                continue
                        if question:
                            break
                    if question:
                        break
                if question:
                    break
            if question:
                break
            
            # Also check old topics structure
            if not question:
                topics = assessment.get("topics", [])
                for topic in topics:
                    questions = topic.get("questions", [])
                    for q in questions:
                        q_id = str(q.get("_id", ""))
                        q_id2 = str(q.get("id", ""))
                        if q_id == question_id or q_id2 == question_id:
                            logger.info(f"Found question in old topics structure")
                            question = q
                            break
                    if question:
                        break
                if question:
                    break
        
        if not question:
            logger.warning(f"Question not found after searching {len(assessments)} assessments. ID: {question_id}")
    
    # Extract the question from the result if it was found via ObjectId query
    if question and "questions" in question and len(question["questions"]) > 0:
        question = question["questions"][0]
    
    if not question:
        raise HTTPException(status_code=404, detail=f"Question not found with ID: {question_id}")
    
    # Build test cases array - PUBLIC ONLY
    test_cases = []
    public_testcases = question.get("public_testcases", []) or question.get("coding_data", {}).get("public_testcases", [])
    
    for i, tc in enumerate(public_testcases):
        test_cases.append({
            "id": f"public_{i}",
            "stdin": tc.get("input", ""),
            "expected_output": tc.get("expected_output", ""),
            "is_hidden": False,
            "points": tc.get("points", 1),
        })
    
    if not test_cases:
        raise HTTPException(status_code=400, detail="Question has no public test cases")
    
    # Get execution constraints (default values)
    cpu_time_limit = 2.0
    memory_limit = 128000
    
    # Run public test cases only
    try:
        result = await run_all_test_cases(
            source_code=request.source_code,
            language_id=request.language_id,
            test_cases=test_cases,
            cpu_time_limit=cpu_time_limit,
            memory_limit=memory_limit,
        )
    except Exception as e:
        logger.error(f"Error running test cases: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to execute code: {str(e)}")
    
    # Format results
    public_results = []
    for i, res in enumerate(result["results"]):
        tc = test_cases[i]
        passed = res.get("passed", False)
        
        public_results.append({
            "id": tc["id"],
            "test_number": i + 1,
            "input": tc["stdin"],
            "expected_output": tc["expected_output"],
            "user_output": res.get("stdout", ""),
            "status": res.get("status", {}).get("description", "Unknown"),
            "status_id": res.get("status", {}).get("id", 0),
            "time": res.get("time"),
            "memory": res.get("memory"),
            "passed": passed,
            "stderr": res.get("stderr"),
            "compile_output": res.get("compile_output"),
        })
    
    # Calculate summary
    passed_count = sum(1 for r in public_results if r["passed"])
    total_count = len(public_results)
    
    response = {
        "question_id": request.question_id,
        "public_results": public_results,
        "public_summary": {
            "total": total_count,
            "passed": passed_count,
        },
        "status": "completed" if passed_count == total_count else "partial",
        "compilation_error": any(r.get("compile_output") for r in public_results),
    }
    
    return response


@router.post("/submit")
async def submit_code(request: SubmitCodeRequest):
    """
    SUBMIT CODE - Execute ALL test cases (public + hidden).
    Returns:
    - Full details for public test cases
    - Only pass/fail for hidden test cases (NO input/output/stderr)
    Used when user clicks "Submit" button.
    """
    logger.info(f"Submitting code for assessment question {request.question_id} (all tests)")
    
    db = get_database()
    
    # Try to find question in assessments collection
    # Handle both ObjectId and string IDs
    question = None
    question_id = request.question_id
    
    # Try with ObjectId if valid
    if ObjectId.is_valid(question_id):
        question = await db.assessments.find_one(
            {"questions._id": ObjectId(question_id)},
            {"questions.$": 1}
        )
        
        # If not found in assessments, try topics_v2 collection
        if not question:
            question = await db.topics_v2.find_one(
                {"questions._id": ObjectId(question_id)},
                {"questions.$": 1}
            )
    
    # If not found with ObjectId, try searching by string ID or position
    if not question:
        logger.info(f"Searching for question by string ID: {question_id}")
        # If assessment_id is provided, search only in that assessment
        if request.assessment_id and ObjectId.is_valid(request.assessment_id):
            assessment = await db.assessments.find_one({"_id": ObjectId(request.assessment_id)})
            assessments = [assessment] if assessment else []
            logger.info(f"Searching in specific assessment: {request.assessment_id}")
        else:
            # Search in all assessments
            assessments = await db.assessments.find({}).to_list(length=None)
            logger.info(f"Searching through {len(assessments)} assessments")
        
        # Try to parse the generated ID format: topicId-rowId-questionIndex-counter
        id_parts = question_id.split("-")
        parsed_question_index = None
        
        # Try to extract questionIndex from the ID
        if len(id_parts) >= 2:
            for i in range(len(id_parts) - 1, max(0, len(id_parts) - 4), -1):
                try:
                    potential_index = int(id_parts[i])
                    if potential_index < 100:  # Reasonable upper bound for question index
                        parsed_question_index = potential_index
                        break
                except ValueError:
                    continue
        
        for assessment_idx, assessment in enumerate(assessments):
            if not assessment:
                continue
                
            assessment_id_str = str(assessment.get("_id", ""))
            
            topics_v2 = assessment.get("topics_v2", [])
            for topic_idx, topic in enumerate(topics_v2):
                topic_id = str(topic.get("id", "")) or str(topic.get("_id", ""))
                
                # Check if topic_id is in the question_id
                if not topic_id or topic_id not in question_id:
                    continue
                
                question_rows = topic.get("questionRows", [])
                for row_idx, row in enumerate(question_rows):
                    row_id = str(row.get("rowId", "")) or str(row.get("id", ""))
                    
                    # Check if row_id is in the question_id
                    if not row_id or row_id not in question_id:
                        continue
                    
                    questions = row.get("questions", [])
                    for q_idx, q in enumerate(questions):
                        # Check multiple ID fields first
                        q_id = str(q.get("_id", ""))
                        q_id2 = str(q.get("id", ""))
                        
                        # Try exact match
                        if q_id == question_id or q_id2 == question_id:
                            logger.info(f"Found question by exact ID match in assessment {assessment_id_str[:8]}...")
                            question = q
                            break
                        
                        # Try to match by position if we parsed question_index and it matches
                        if parsed_question_index is not None and q_idx == parsed_question_index:
                            logger.info(f"Found question by position match: topic={topic_id[:8]}..., row={row_id[:8]}..., index={q_idx}")
                            question = q
                            break
                        
                        # Fallback: if we're at a position that matches any numeric part in the ID
                        for part in id_parts:
                            try:
                                if int(part) == q_idx and q_idx < len(questions):
                                    logger.info(f"Found question by pattern match: index={q_idx}")
                                    question = q
                                    break
                            except ValueError:
                                continue
                        if question:
                            break
                    if question:
                        break
                if question:
                    break
            if question:
                break
            
            # Also check old topics structure
            if not question:
                topics = assessment.get("topics", [])
                for topic in topics:
                    questions = topic.get("questions", [])
                    for q in questions:
                        q_id = str(q.get("_id", ""))
                        q_id2 = str(q.get("id", ""))
                        if q_id == question_id or q_id2 == question_id:
                            logger.info(f"Found question in old topics structure")
                            question = q
                            break
                    if question:
                        break
                if question:
                    break
        
        if not question:
            logger.warning(f"Question not found after searching {len(assessments)} assessments. ID: {question_id}")
    
    # Extract the question from the result if it was found via ObjectId query
    if question and "questions" in question and len(question["questions"]) > 0:
        question = question["questions"][0]
    
    if not question:
        raise HTTPException(status_code=404, detail=f"Question not found with ID: {question_id}")
    
    # Build test cases array - PUBLIC + HIDDEN
    public_test_cases = []
    hidden_test_cases = []
    all_test_cases = []
    
    # Add public test cases
    public_testcases = question.get("public_testcases", []) or question.get("coding_data", {}).get("public_testcases", [])
    for i, tc in enumerate(public_testcases):
        test_case = {
            "id": f"public_{i}",
            "stdin": tc.get("input", ""),
            "expected_output": tc.get("expected_output", ""),
            "is_hidden": False,
            "points": tc.get("points", 1),
        }
        public_test_cases.append(test_case)
        all_test_cases.append(test_case)
    
    # Add hidden test cases
    hidden_testcases = question.get("hidden_testcases", []) or question.get("coding_data", {}).get("hidden_testcases", [])
    for i, tc in enumerate(hidden_testcases):
        test_case = {
            "id": f"hidden_{i}",
            "stdin": tc.get("input", ""),
            "expected_output": tc.get("expected_output", ""),
            "is_hidden": True,
            "points": tc.get("points", 1),
        }
        hidden_test_cases.append(test_case)
        all_test_cases.append(test_case)
    
    if not all_test_cases:
        raise HTTPException(status_code=400, detail="Question has no test cases")
    
    # Get execution constraints (default values)
    cpu_time_limit = 2.0
    memory_limit = 128000
    
    # Run all test cases
    try:
        result = await run_all_test_cases(
            source_code=request.source_code,
            language_id=request.language_id,
            test_cases=all_test_cases,
            cpu_time_limit=cpu_time_limit,
            memory_limit=memory_limit,
        )
    except Exception as e:
        logger.error(f"Error running test cases: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to execute code: {str(e)}")
    
    # Format public results (full details)
    public_results = []
    public_index = 0
    for i, res in enumerate(result["results"]):
        tc = all_test_cases[i]
        if not tc["is_hidden"]:
            passed = res.get("passed", False)
            public_results.append({
                "id": tc["id"],
                "test_number": public_index + 1,
                "input": tc["stdin"],
                "expected_output": tc["expected_output"],
                "user_output": res.get("stdout", ""),
                "status": res.get("status", {}).get("description", "Unknown"),
                "status_id": res.get("status", {}).get("id", 0),
                "time": res.get("time"),
                "memory": res.get("memory"),
                "passed": passed,
                "stderr": res.get("stderr"),
                "compile_output": res.get("compile_output"),
            })
            public_index += 1
    
    # Format hidden results (only pass/fail)
    hidden_results = []
    hidden_index = 0
    for i, res in enumerate(result["results"]):
        tc = all_test_cases[i]
        if tc["is_hidden"]:
            passed = res.get("passed", False)
            hidden_results.append({
                "id": tc["id"],
                "test_number": hidden_index + 1,
                "passed": passed,
                "status": res.get("status", {}).get("description", "Unknown"),
            })
            hidden_index += 1
    
    # Calculate summaries
    public_passed = sum(1 for r in public_results if r["passed"])
    hidden_passed = sum(1 for r in hidden_results if r["passed"])
    total_passed = public_passed + hidden_passed
    total_tests = len(all_test_cases)
    
    # Calculate score (simple: points for each passed test)
    score = total_passed
    max_score = total_tests
    
    response = {
        "question_id": request.question_id,
        "public_results": public_results,
        "hidden_results": hidden_results,
        "hidden_summary": {
            "total": len(hidden_test_cases),
            "passed": hidden_passed,
        },
        "total_passed": total_passed,
        "total_tests": total_tests,
        "score": score,
        "max_score": max_score,
        "status": "accepted" if total_passed == total_tests else "wrong_answer",
        "compilation_error": any(r.get("compile_output") for r in public_results),
    }
    
    return response

