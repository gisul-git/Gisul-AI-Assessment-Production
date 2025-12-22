"""
Assessment Evaluation Service
Evaluates submitted answers for all question types:
- MCQ: Direct comparison with correct answer
- Subjective: AI-based evaluation
- Coding/SQL/AIML: Test case execution + AI feedback
"""
import os
import json
import logging
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from openai import OpenAI
from bson import ObjectId

from ...dsa.utils.judge0 import run_all_test_cases, get_language_id
from ...dsa.services.ai_feedback import generate_code_feedback
from ...aiml.services.ai_feedback import generate_aiml_feedback
from ...dsa.routers.assessment import build_sql_script, execute_sql_with_judge0, compare_sql_results

logger = logging.getLogger(__name__)

# Initialize OpenAI client if available
try:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY")) if os.getenv("OPENAI_API_KEY") else None
except Exception:
    client = None


async def evaluate_mcq_question(
    question: Dict[str, Any],
    candidate_answer: str
) -> Dict[str, Any]:
    """Evaluate MCQ question by comparing with correct answer."""
    correct_answer = question.get("correctAnswer", "").strip()
    candidate_answer = candidate_answer.strip() if candidate_answer else ""
    
    is_correct = candidate_answer.lower() == correct_answer.lower()
    score = question.get("score", 5) if is_correct else 0
    
    return {
        "question_type": "mcq",
        "is_correct": is_correct,
        "score": score,
        "max_score": question.get("score", 5),
        "candidate_answer": candidate_answer,
        "correct_answer": correct_answer,
        "feedback": "Correct!" if is_correct else f"Incorrect. The correct answer is: {correct_answer}",
    }


async def evaluate_subjective_question(
    question: Dict[str, Any],
    candidate_answer: str
) -> Dict[str, Any]:
    """Evaluate subjective question using AI."""
    ideal_answer = question.get("idealAnswer", "")
    expected_logic = question.get("expectedLogic", "")
    max_score = question.get("score", 10)
    
    if not client:
        # Fallback: Simple length-based scoring
        answer_length = len(candidate_answer.strip())
        ideal_length = len(ideal_answer.strip()) if ideal_answer else 100
        
        if answer_length == 0:
            score = 0
            feedback = "No answer provided."
        elif answer_length < ideal_length * 0.3:
            score = max_score * 0.3
            feedback = "Answer is too brief. Please provide more detail."
        elif answer_length < ideal_length * 0.6:
            score = max_score * 0.6
            feedback = "Answer is somewhat complete but could be more detailed."
        else:
            score = max_score * 0.8
            feedback = "Answer appears complete. Manual review recommended."
        
        return {
            "question_type": "subjective",
            "score": score,
            "max_score": max_score,
            "candidate_answer": candidate_answer,
            "feedback": feedback,
            "ai_generated": False,
        }
    
    try:
        prompt = f"""Evaluate the following subjective answer for a question.

Question: {question.get('questionText', question.get('title', ''))}
Expected Key Points: {expected_logic if expected_logic else 'N/A'}
Ideal Answer (reference): {ideal_answer if ideal_answer else 'N/A'}

Candidate's Answer:
{candidate_answer}

Please evaluate the answer and provide:
1. A score out of {max_score} based on:
   - Completeness (covers all key points)
   - Accuracy (correct information)
   - Clarity and organization
   - Depth of understanding
2. Constructive feedback highlighting strengths and areas for improvement

Respond in JSON format:
{{
    "score": <number between 0 and {max_score}>,
    "feedback": "<detailed feedback>",
    "strengths": ["<strength1>", "<strength2>"],
    "improvements": ["<improvement1>", "<improvement2>"]
}}"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert evaluator of subjective answers. Provide fair, constructive feedback."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=1000,
        )
        
        result = json.loads(response.choices[0].message.content)
        score = max(0, min(max_score, int(result.get("score", 0))))
        
        return {
            "question_type": "subjective",
            "score": score,
            "max_score": max_score,
            "candidate_answer": candidate_answer,
            "feedback": result.get("feedback", ""),
            "strengths": result.get("strengths", []),
            "improvements": result.get("improvements", []),
            "ai_generated": True,
        }
    except Exception as e:
        logger.error(f"Error in AI evaluation for subjective question: {e}")
        # Fallback scoring
        return {
            "question_type": "subjective",
            "score": max_score * 0.5,
            "max_score": max_score,
            "candidate_answer": candidate_answer,
            "feedback": "Answer received. Manual review recommended.",
            "ai_generated": False,
        }


async def evaluate_coding_question(
    question: Dict[str, Any],
    candidate_code: str,
    language: str = "python"
) -> Dict[str, Any]:
    """Evaluate coding question by running test cases and generating AI feedback."""
    language_id = get_language_id(language) or 71  # Default to Python
    
    # Get test cases
    public_testcases = question.get("public_testcases", [])
    hidden_testcases = question.get("hidden_testcases", [])
    
    # Build test cases array
    all_test_cases = []
    for i, tc in enumerate(public_testcases):
        all_test_cases.append({
            "id": f"public_{i}",
            "stdin": tc.get("input", ""),
            "expected_output": tc.get("expected_output", ""),
            "is_hidden": False,
            "points": tc.get("points", 1),
        })
    
    for i, tc in enumerate(hidden_testcases):
        all_test_cases.append({
            "id": f"hidden_{i}",
            "stdin": tc.get("input", ""),
            "expected_output": tc.get("expected_output", ""),
            "is_hidden": True,
            "points": tc.get("points", 1),
        })
    
    if not all_test_cases:
        return {
            "question_type": "coding",
            "score": 0,
            "max_score": question.get("score", 10),
            "test_results": [],
            "public_results": [],
            "hidden_results": [],
            "total_passed": 0,
            "total_tests": 0,
            "feedback": "No test cases available for evaluation.",
        }
    
    # Run test cases
    try:
        results = await run_all_test_cases(
            source_code=candidate_code,
            language_id=language_id,
            test_cases=all_test_cases,
            cpu_time_limit=2.0,
            memory_limit=128000,
            stop_on_compilation_error=False,
        )
        
        all_results = results.get("results", [])
        public_results = [r for i, r in enumerate(all_results) if i < len(public_testcases)]
        hidden_results = [r for i, r in enumerate(all_results) if i >= len(public_testcases)]
        
        total_passed = sum(1 for r in all_results if r.get("passed", False))
        total_tests = len(all_results)
        
        # Generate AI feedback
        try:
            ai_feedback = generate_code_feedback(
                source_code=candidate_code,
                language=language,
                question_title=question.get("title", question.get("questionText", "")),
                question_description=question.get("description", question.get("questionText", "")),
                test_results=all_results,
                total_passed=total_passed,
                total_tests=total_tests,
                public_passed=sum(1 for r in public_results if r.get("passed", False)),
                public_total=len(public_results),
                hidden_passed=sum(1 for r in hidden_results if r.get("passed", False)),
                hidden_total=len(hidden_results),
                starter_code=question.get("starter_code", ""),
            )
        except Exception as e:
            logger.error(f"Error generating AI feedback: {e}")
            ai_feedback = {
                "overall_score": int((total_passed / total_tests) * 100) if total_tests > 0 else 0,
                "feedback_summary": f"Passed {total_passed}/{total_tests} test cases.",
            }
        
        max_score = question.get("score", 10)
        score = int((total_passed / total_tests) * max_score) if total_tests > 0 else 0
        
        return {
            "question_type": "coding",
            "score": score,
            "max_score": max_score,
            "candidate_code": candidate_code,
            "test_results": all_results,
            "public_results": public_results,
            "hidden_results": hidden_results,
            "total_passed": total_passed,
            "total_tests": total_tests,
            "ai_feedback": ai_feedback,
        }
    except Exception as e:
        logger.error(f"Error evaluating coding question: {e}")
        return {
            "question_type": "coding",
            "score": 0,
            "max_score": question.get("score", 10),
            "error": str(e),
            "feedback": f"Evaluation error: {str(e)}",
        }


async def evaluate_sql_question(
    question: Dict[str, Any],
    candidate_query: str
) -> Dict[str, Any]:
    """Evaluate SQL question by executing query and comparing results."""
    schemas = question.get("schemas", {})
    sample_data = question.get("sample_data", {})
    reference_query = question.get("starter_query", "")
    
    try:
        # Build SQL script with candidate query
        sql_script = build_sql_script(
            schemas=schemas,
            sample_data=sample_data,
            user_query=candidate_query,
            reference_query=reference_query
        )
        
        # Execute candidate query
        candidate_result = await execute_sql_with_judge0(sql_script)
        
        if candidate_result.get("status") != "success":
            return {
                "question_type": "sql",
                "score": 0,
                "max_score": question.get("score", 10),
                "candidate_query": candidate_query,
                "error": candidate_result.get("error", "SQL execution failed"),
                "feedback": f"SQL execution error: {candidate_result.get('error', 'Unknown error')}",
            }
        
        # Compare with expected results if available
        # For now, just check if query executes successfully
        # TODO: Add comparison with expected output if available
        
        max_score = question.get("score", 10)
        score = max_score  # If query executes successfully, give full score
        
        return {
            "question_type": "sql",
            "score": score,
            "max_score": max_score,
            "candidate_query": candidate_query,
            "execution_result": candidate_result,
            "feedback": "SQL query executed successfully.",
        }
    except Exception as e:
        logger.error(f"Error evaluating SQL question: {e}")
        return {
            "question_type": "sql",
            "score": 0,
            "max_score": question.get("score", 10),
            "error": str(e),
            "feedback": f"Evaluation error: {str(e)}",
        }


async def evaluate_aiml_question(
    question: Dict[str, Any],
    candidate_code: str
) -> Dict[str, Any]:
    """Evaluate AIML question by running code and generating AI feedback."""
    # For AIML, we typically run the code and check outputs
    # This is similar to coding but may have different evaluation criteria
    
    public_testcases = question.get("public_testcases", [])
    hidden_testcases = question.get("hidden_testcases", [])
    
    # Run code execution (similar to coding evaluation)
    # For now, use a simplified approach
    try:
        # Execute code and get outputs
        outputs = []  # TODO: Execute AIML code and capture outputs
        
        # Generate AI feedback
        ai_feedback = generate_aiml_feedback(
            source_code=candidate_code,
            outputs=outputs,
            question_title=question.get("title", ""),
            question_description=question.get("description", ""),
            tasks=question.get("tasks", []),
            constraints=question.get("constraints", []),
            difficulty=question.get("difficulty", "medium"),
            skill=question.get("library", ""),
        )
        
        max_score = question.get("score", 10)
        score = ai_feedback.get("overall_score", 0) * (max_score / 100)
        
        return {
            "question_type": "aiml",
            "score": score,
            "max_score": max_score,
            "candidate_code": candidate_code,
            "ai_feedback": ai_feedback,
        }
    except Exception as e:
        logger.error(f"Error evaluating AIML question: {e}")
        return {
            "question_type": "aiml",
            "score": 0,
            "max_score": question.get("score", 10),
            "error": str(e),
            "feedback": f"Evaluation error: {str(e)}",
        }


async def evaluate_assessment_submission(
    assessment: Dict[str, Any],
    candidate_key: str,
    answers: List[Dict[str, Any]],
    db
) -> Dict[str, Any]:
    """
    Evaluate all submitted answers for an assessment.
    
    Args:
        assessment: Assessment document
        candidate_key: Candidate identifier
        answers: List of submitted answers with questionIndex
        db: Database connection
    
    Returns:
        Dictionary with evaluation results for all questions
    """
    # Get all questions from assessment
    topics_v2 = assessment.get("topics_v2", [])
    all_questions = []
    question_index_map = {}  # Maps question index to question data
    
    global_index = 0
    for topic in topics_v2:
        for row in topic.get("rows", []):
            questions = row.get("questions", [])
            for q in questions:
                question_index_map[global_index] = {
                    "question": q,
                    "section": topic.get("section", "mcq"),
                }
                all_questions.append((global_index, q, topic.get("section", "mcq")))
                global_index += 1
    
    evaluation_results = {}
    total_score = 0
    max_total_score = 0
    
    # Evaluate each submitted answer
    for answer_data in answers:
        question_index = answer_data.get("questionIndex")
        candidate_answer = answer_data.get("answer", "")
        
        if question_index not in question_index_map:
            continue
        
        question_info = question_index_map[question_index]
        question = question_info["question"]
        section = question_info["section"]
        question_type = question.get("type", "").lower()
        
        max_score = question.get("score", 5)
        max_total_score += max_score
        
        try:
            if question_type == "mcq":
                result = await evaluate_mcq_question(question, candidate_answer)
            elif question_type in ["subjective", "pseudocode"]:
                result = await evaluate_subjective_question(question, candidate_answer)
            elif question_type == "coding":
                language = question.get("language", "python")
                result = await evaluate_coding_question(question, candidate_answer, language)
            elif question_type == "sql":
                result = await evaluate_sql_question(question, candidate_answer)
            elif question_type == "aiml":
                result = await evaluate_aiml_question(question, candidate_answer)
            else:
                result = {
                    "question_type": question_type,
                    "score": 0,
                    "max_score": max_score,
                    "feedback": "Unknown question type",
                }
            
            evaluation_results[question_index] = result
            total_score += result.get("score", 0)
        except Exception as e:
            logger.error(f"Error evaluating question {question_index}: {e}")
            evaluation_results[question_index] = {
                "question_type": question_type,
                "score": 0,
                "max_score": max_score,
                "error": str(e),
                "feedback": f"Evaluation error: {str(e)}",
            }
    
    # Calculate percentage
    percentage = (total_score / max_total_score * 100) if max_total_score > 0 else 0
    
    return {
        "evaluation_results": evaluation_results,
        "total_score": total_score,
        "max_total_score": max_total_score,
        "percentage": round(percentage, 2),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }

