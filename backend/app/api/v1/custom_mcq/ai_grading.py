"""
AI Grading Module for Subjective Questions
Uses OpenAI API to grade subjective answers
"""
from __future__ import annotations

import logging
from typing import Dict, Any, List, Optional
from openai import AsyncOpenAI

from ....config.settings import get_settings

logger = logging.getLogger(__name__)


def _get_openai_client() -> AsyncOpenAI:
    """Get OpenAI client instance."""
    settings = get_settings()
    api_key = getattr(settings, 'openai_api_key', None)
    if not api_key:
        raise ValueError("OpenAI API key not configured")
    return AsyncOpenAI(api_key=api_key)


async def grade_subjective_answer(
    question: str,
    answer: str,
    max_marks: int,
    section: Optional[str] = None
) -> Dict[str, Any]:
    """
    Grade a subjective answer using OpenAI.
    
    Args:
        question: The question text
        answer: The candidate's answer
        max_marks: Maximum marks for this question
        section: Optional section name for context
    
    Returns:
        Dict with:
            - score: float (marks awarded)
            - percentage: float (score as percentage of max_marks)
            - feedback: str (AI-generated feedback)
            - reasoning: str (AI's reasoning for the score)
    """
    try:
        client = _get_openai_client()
        
        # Construct prompt for grading
        section_context = f"Section: {section}\n" if section else ""
        prompt = f"""You are an expert evaluator grading a subjective answer. Please evaluate the following answer and provide a score.

{section_context}Question: {question}

Candidate's Answer: {answer}

Maximum Marks: {max_marks}

Please evaluate the answer based on:
1. Accuracy and correctness
2. Completeness
3. Clarity and coherence
4. Depth of understanding
5. Relevance to the question

Provide your evaluation in the following JSON format:
{{
    "score": <number between 0 and {max_marks}>,
    "feedback": "<constructive feedback for the candidate>",
    "reasoning": "<brief explanation of why this score was awarded>"
}}

Be fair but strict. Award full marks only if the answer is excellent and comprehensive. Deduct marks for:
- Incorrect information
- Incomplete answers
- Lack of clarity
- Missing key points
- Irrelevant content

Return ONLY valid JSON, no additional text."""

        response = await client.chat.completions.create(
            model="gpt-4o-mini",  # Using cost-effective model
            messages=[
                {"role": "system", "content": "You are an expert evaluator. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,  # Lower temperature for more consistent grading
            max_tokens=500,
        )
        
        # Parse response
        content = response.choices[0].message.content.strip()
        
        # Try to extract JSON from response (handle cases where there might be markdown code blocks)
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        import json
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            # Fallback: try to extract JSON object from text
            import re
            json_match = re.search(r'\{[^}]+\}', content)
            if json_match:
                result = json.loads(json_match.group())
            else:
                raise ValueError("Could not parse AI response as JSON")
        
        score = float(result.get("score", 0))
        # Ensure score is within valid range
        score = max(0, min(score, max_marks))
        
        percentage = (score / max_marks * 100) if max_marks > 0 else 0
        
        return {
            "score": score,
            "percentage": round(percentage, 2),
            "feedback": result.get("feedback", "No feedback provided"),
            "reasoning": result.get("reasoning", "No reasoning provided"),
        }
        
    except Exception as e:
        logger.exception(f"Error grading subjective answer: {e}")
        # Return default score on error (0 marks)
        return {
            "score": 0.0,
            "percentage": 0.0,
            "feedback": f"Error during AI grading: {str(e)}",
            "reasoning": "Could not evaluate answer due to technical error",
        }


async def grade_multiple_subjective_answers(
    questions_and_answers: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Grade multiple subjective answers in batch.
    
    Args:
        questions_and_answers: List of dicts with:
            - question: str
            - answer: str
            - max_marks: int
            - section: Optional[str]
            - questionId: str
    
    Returns:
        List of grading results with questionId included
    """
    results = []
    
    logger.info(f"Grading {len(questions_and_answers)} subjective answers")
    
    for item in questions_and_answers:
        try:
            question_id = item.get("questionId", "unknown")
            question_text = item.get("question", "")
            answer_text = item.get("answer", "")
            max_marks_raw = item.get("max_marks", 1)
            section = item.get("section", "")
            
            # Ensure max_marks is an integer
            if isinstance(max_marks_raw, str):
                try:
                    max_marks = int(float(max_marks_raw))
                except (ValueError, TypeError):
                    logger.warning(f"Invalid max_marks for question {question_id}: {max_marks_raw}, defaulting to 1")
                    max_marks = 1
            elif isinstance(max_marks_raw, float):
                max_marks = int(max_marks_raw)
            else:
                max_marks = int(max_marks_raw) if max_marks_raw else 1
            
            if max_marks < 1:
                max_marks = 1
            
            logger.info(f"Grading question {question_id}: max_marks={max_marks}, answer_length={len(answer_text)}")
            
            if not answer_text or not answer_text.strip():
                logger.warning(f"Question {question_id} has empty answer, awarding 0 marks")
                results.append({
                    "questionId": question_id,
                    "score": 0.0,
                    "percentage": 0.0,
                    "feedback": "No answer provided",
                    "reasoning": "Empty answer submitted",
                })
                continue
            
            grade_result = await grade_subjective_answer(
                question=question_text,
                answer=answer_text,
                max_marks=max_marks,
                section=section,
            )
            grade_result["questionId"] = question_id
            logger.info(f"Question {question_id} graded: {grade_result.get('score', 0)}/{max_marks}")
            results.append(grade_result)
        except Exception as e:
            logger.exception(f"Error grading question {item.get('questionId')}: {e}")
            results.append({
                "questionId": item.get("questionId", "unknown"),
                "score": 0.0,
                "percentage": 0.0,
                "feedback": f"Error: {str(e)}",
                "reasoning": "Could not evaluate answer",
            })
    
    logger.info(f"Completed grading {len(results)} answers")
    return results
