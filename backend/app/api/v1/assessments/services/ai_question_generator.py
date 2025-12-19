"""
Module: ai_question_generator.py
Purpose: Core question generation for MCQ, Subjective, and PseudoCode types

This module is the main entry point for question generation. It handles
MCQ, Subjective, and PseudoCode questions directly, and delegates
Coding, SQL, and AIML questions to specialized generators.

Dependencies:
- External: openai (for question generation)
- Internal: ai_utils (for OpenAI client, JSON parsing, URL processing)
- Internal: ai_coding_generator (_generate_coding_questions)
- Internal: ai_sql_generator (_generate_sql_questions)
- Internal: ai_aiml_generator (_generate_aiml_questions)

Example usage:
    ```python
    from app.api.v1.assessments.services.ai_question_generator import (
        generate_questions_for_row_v2
    )
    
    questions = await generate_questions_for_row_v2(
        topic_label="Python Functions",
        question_type="MCQ",
        difficulty="Medium",
        questions_count=5,
        can_use_judge0=False
    )
    ```

Note: This is the main entry point. All question generation flows through here.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from .ai_utils import (
    _get_openai_client,
    _parse_json_response,
    _process_requirements_for_subjective,
)
from .ai_coding_generator import _generate_coding_questions
from .ai_sql_generator import _generate_sql_questions
from .ai_aiml_generator import _generate_aiml_questions

logger = logging.getLogger(__name__)


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

async def generate_questions_for_row_v2(
    topic_label: str,
    question_type: str,
    difficulty: str,
    questions_count: int,
    can_use_judge0: bool,
    coding_language: str = "python",
    additional_requirements: Optional[str] = None,
    experience_mode: Optional[str] = None,
    website_summary: Optional[Dict[str, Any]] = None,
    company_context: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Generate questions for a single question row based on question type.
    Returns questions in appropriate format for each type.
    
    This is the main entry point for question generation. It routes to
    specialized generators based on question type.
    
    Args:
        topic_label: The topic label
        question_type: Type of question (MCQ, Subjective, PseudoCode, Coding, SQL, AIML)
        difficulty: Difficulty level (Easy, Medium, Hard)
        questions_count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used (for coding questions)
        coding_language: Programming language for coding questions
        additional_requirements: Optional additional requirements for question generation
        experience_mode: Experience mode (corporate/student/college)
        website_summary: Legacy website summary (deprecated, use company_context)
        company_context: Company context with name, type, summary, key_topics
        
    Returns:
        List of question dictionaries in appropriate format for question type
        
    Raises:
        HTTPException: If question type is unsupported or generation fails
    """
    # TODO: Move implementation from topic_service_v2.py line 1239
    pass


# Keep old function name for backward compatibility during transition
async def generate_questions_for_topic_v2(
    topic_label: str,
    question_type: str,
    difficulty: str,
    questions_count: int,
    can_use_judge0: bool,
    coding_language: str = "python"
) -> List[Dict[str, Any]]:
    """
    Alias for generate_questions_for_row_v2 for backward compatibility.
    
    Args:
        topic_label: The topic label
        question_type: Type of question
        difficulty: Difficulty level
        questions_count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language for coding questions
        
    Returns:
        List of question dictionaries
    """
    # TODO: Move implementation from topic_service_v2.py line 1343
    return await generate_questions_for_row_v2(
        topic_label, question_type, difficulty, questions_count, can_use_judge0, coding_language
    )


# ============================================================================
# MCQ QUESTION GENERATION
# ============================================================================

async def _generate_mcq_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate MCQ questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - MCQ must include exactly 4 options
    - One correct answer
    - Should NOT be overly simple syntax questions unless topic requires it
    - Should match the difficulty level
    - Generate both question + options + correctAnswer
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        
    Returns:
        List of MCQ question dictionaries with:
        - question: Question text
        - options: List of exactly 4 options
        - correctAnswer: The correct option (must match one of the options)
    """
    # TODO: Move implementation from topic_service_v2.py line 1355
    pass


# ============================================================================
# SUBJECTIVE QUESTION GENERATION
# ============================================================================

async def _generate_subjective_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate Subjective questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - ONLY scenario-based, real-world, case-study style questions
    - Minimum 2-4 sentences
    - Requires reasoning, explanation, trade-offs, evaluation
    - NO: MCQ-like phrasing, "which of the following", one-liners
    - Should reflect real-world usage of the topic
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements (can be URL)
        
    Returns:
        List of Subjective question dictionaries with:
        - question: Scenario-based question text (2-4 sentences minimum)
    """
    # TODO: Move implementation from topic_service_v2.py line 1967
    pass


# ============================================================================
# PSEUDOCODE QUESTION GENERATION
# ============================================================================

async def _generate_pseudocode_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate Pseudocode questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - Generate a pseudocode-related question ONLY
    - Should require algorithmic thinking
    - Must be scenario-based, not trivial
    - DO NOT generate the answer
    - Answer will be evaluated by AI scoring model
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        
    Returns:
        List of PseudoCode question dictionaries with:
        - questionText: Scenario-based pseudocode question with sample input/output
    """
    # TODO: Move implementation from topic_service_v2.py line 2097
    pass


# ============================================================================
# QUESTION REGENERATION
# ============================================================================

async def regenerate_question(
    old_question: str,
    question_type: str,
    difficulty: str,
    experience_mode: Optional[str] = "corporate",
    experience_min: Optional[int] = 0,
    experience_max: Optional[int] = 10,
    additional_requirements: Optional[str] = None,
    feedback: Optional[str] = None,
    topic_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Regenerate a single question based on the old question text and optional feedback.
    
    Args:
        old_question: Original question text
        question_type: Type of question (MCQ, Subjective, etc.)
        difficulty: Difficulty level
        experience_mode: Experience mode (corporate/college)
        experience_min: Minimum experience years
        experience_max: Maximum experience years
        additional_requirements: Optional additional requirements
        feedback: Optional user feedback for improvement
        topic_name: Optional topic name for context
        
    Returns:
        Regenerated question dictionary (format depends on question_type)
        
    Raises:
        HTTPException: If regeneration fails
    """
    # TODO: Move implementation from topic_service_v2.py line 3427
    pass



