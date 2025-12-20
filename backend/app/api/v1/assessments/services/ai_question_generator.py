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

import importlib.util
import logging
from pathlib import Path
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

# Temporary bridge to old implementation
_legacy_generate_questions = None
try:
    _services_file = Path(__file__).parent.parent / "services.py"
    if _services_file.exists():
        spec = importlib.util.spec_from_file_location(
            "app.api.v1.assessments.services_legacy",
            _services_file,
            submodule_search_locations=[str(_services_file.parent)]
        )
        legacy_services = importlib.util.module_from_spec(spec)
        legacy_services.__package__ = "app.api.v1.assessments"
        legacy_services.__name__ = "app.api.v1.assessments.services_legacy"
        spec.loader.exec_module(legacy_services)
        _legacy_generate_questions = legacy_services.generate_questions_for_topic
except Exception as e:
    logger.warning(f"Could not load legacy services for fallback: {e}")


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
    company_context: Optional[Dict[str, Any]] = None,
    job_designation: Optional[str] = None,
    experience_min: Optional[int] = None,
    experience_max: Optional[int] = None,
    company_name: Optional[str] = None
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
        job_designation: Job role/designation (e.g., "Senior Software Engineer")
        experience_min: Minimum years of experience required
        experience_max: Maximum years of experience required
        company_name: Company name for personalization (e.g., "Gisul")
        
    Returns:
        List of question dictionaries in appropriate format for question type
        
    Raises:
        HTTPException: If question type is unsupported or generation fails
    """
    if not topic_label or not question_type or not difficulty or questions_count <= 0:
        raise HTTPException(
            status_code=400,
            detail="Invalid parameters: topic_label, question_type, difficulty are required and questions_count must be > 0"
        )
    
    # Normalize question type
    question_type_upper = question_type.upper()
    experience_mode = experience_mode or "corporate"
    
    # Route to appropriate generator based on question type
    if question_type_upper in ["CODING", "CODE"]:
        if not can_use_judge0:
            raise HTTPException(
                status_code=400,
                detail="Coding questions require Judge0 support (can_use_judge0 must be True)"
            )
        return await _generate_coding_questions(
            topic=topic_label,
            difficulty=difficulty,
            count=questions_count,
            can_use_judge0=can_use_judge0,
            coding_language=coding_language,
            experience_mode=experience_mode,
            additional_requirements=additional_requirements
        )
    
    elif question_type_upper in ["SQL"]:
        return await _generate_sql_questions(
            topic=topic_label,
            difficulty=difficulty,
            count=questions_count,
            experience_mode=experience_mode,
            additional_requirements=additional_requirements
        )
    
    elif question_type_upper in ["AIML", "AI/ML", "MACHINE LEARNING", "ML"]:
        return await _generate_aiml_questions(
            topic=topic_label,
            difficulty=difficulty,
            count=questions_count,
            experience_mode=experience_mode,
            additional_requirements=additional_requirements
        )
    
    elif question_type_upper in ["MCQ", "MULTIPLE CHOICE"]:
        return await _generate_mcq_questions(
            topic=topic_label,
            difficulty=difficulty,
            count=questions_count,
            experience_mode=experience_mode,
            additional_requirements=additional_requirements,
            job_designation=job_designation,
            experience_min=experience_min,
            experience_max=experience_max,
            company_name=company_name
        )
    
    elif question_type_upper in ["SUBJECTIVE", "DESCRIPTIVE"]:
        return await _generate_subjective_questions(
            topic=topic_label,
            difficulty=difficulty,
            count=questions_count,
            experience_mode=experience_mode,
            additional_requirements=additional_requirements,
            job_designation=job_designation,
            experience_min=experience_min,
            experience_max=experience_max,
            company_name=company_name
        )
    
    elif question_type_upper in ["PSEUDOCODE", "PSEUDO CODE", "PSEUDO-CODE"]:
        return await _generate_pseudocode_questions(
            topic=topic_label,
            difficulty=difficulty,
            count=questions_count,
            experience_mode=experience_mode,
            additional_requirements=additional_requirements,
            job_designation=job_designation,
            experience_min=experience_min,
            experience_max=experience_max,
            company_name=company_name
        )
    
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported question type: {question_type}. Supported types: MCQ, Subjective, PseudoCode, Coding, SQL, AIML"
        )


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
    additional_requirements: Optional[str] = None,
    job_designation: Optional[str] = None,
    experience_min: Optional[int] = None,
    experience_max: Optional[int] = None,
    company_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate MCQ questions - PRODUCTION-GRADE WITH PERSONALIZATION.
    
    Rules:
    - MCQ must include exactly 4 options
    - One correct answer
    - Should NOT be overly simple syntax questions unless topic requires it
    - Should match the difficulty level
    - Generate both question + options + correctAnswer
    - PERSONALIZED based on job role, experience level, and company
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        job_designation: Job role/designation (e.g., "Senior Software Engineer")
        experience_min: Minimum years of experience required
        experience_max: Maximum years of experience required
        company_name: Company name for personalization (e.g., "Gisul")
        
    Returns:
        List of MCQ question dictionaries with:
        - question: Question text
        - options: List of exactly 4 options
        - correctAnswer: The correct option (must match one of the options)
    """
    # Build personalization context
    context_parts = []
    
    if job_designation:
        context_parts.append(f"**Job Role**: {job_designation}")
    
    if experience_min is not None and experience_max is not None:
        years_text = f"{experience_min}-{experience_max} years"
        
        # Determine seniority level
        if experience_max <= 2:
            seniority = "Junior/Entry-level"
        elif experience_max <= 5:
            seniority = "Mid-level"
        elif experience_max <= 10:
            seniority = "Senior-level"
        else:
            seniority = "Principal/Lead-level"
        
        context_parts.append(f"**Experience Required**: {years_text} ({seniority})")
    
    if company_name:
        context_parts.append(f"**Company**: {company_name}")
    
    if additional_requirements:
        context_parts.append(f"**Additional Context**: {additional_requirements}")
    
    personalization_context = "\n".join(context_parts) if context_parts else ""
    
    # Build prompt with personalization
    prompt = f"""You are an expert technical assessment writer. Generate {count} Multiple Choice Question(s) for the topic: {topic}.

{'=' * 80}
CANDIDATE CONTEXT (USE THIS TO PERSONALIZE QUESTIONS):
{'=' * 80}
{personalization_context if personalization_context else "(No specific personalization context provided - generate generic professional questions)"}
{'=' * 80}

CRITICAL REQUIREMENTS:
1. Each question MUST have exactly 4 options (no more, no less)
2. One option must be the correct answer
3. Difficulty level: {difficulty}
4. Experience mode: {experience_mode}
5. **PERSONALIZE SCENARIOS** using job role and company context when relevant
   - For experience-based questions, frame scenarios appropriate to seniority level
   - For technical decisions, reference company context if applicable
   - Use job designation when creating scenario-based MCQs
6. Questions should match the difficulty level
7. All options must be plausible - avoid obviously wrong answers
8. Options should be similar in length and structure
9. Vary question types (conceptual, application, problem-solving)

PERSONALIZATION GUIDELINES:
- For Junior roles: Focus on foundational concepts, syntax, basic problem-solving
- For Mid-level roles: Include design patterns, best practices, trade-offs
- For Senior roles: Add architecture decisions, scalability, team implications
- For Lead roles: Strategic decisions, technology choices, business impact

Output format (JSON object with questions array):
{{
  "questions": [
    {{
      "question": "<question text>",
      "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
      "correctAnswer": "<option text that matches one of the options exactly>"
    }}
  ]
}}

Return ONLY a JSON object with questions array."""

    client = _get_openai_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            response_format={"type": "json_object"}
        )
    except Exception as exc:
        logger.error(f"OpenAI API error in _generate_mcq_questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate MCQ questions") from exc

    # Parse response
    content = response.choices[0].message.content.strip() if response.choices else ""
    data = _parse_json_response(content)
    
    # Handle response format
    if isinstance(data, dict) and "questions" in data:
        questions_list = data["questions"]
    elif isinstance(data, list):
        questions_list = data
    elif isinstance(data, dict) and "question" in data:
        # Single question object
        questions_list = [data]
    else:
        logger.error(f"Unexpected response format for MCQ questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Format and validate questions
    result = []
    for q in questions_list[:count]:
        if isinstance(q, dict) and "question" in q and "options" in q and "correctAnswer" in q:
            # Validate that we have exactly 4 options
            if len(q["options"]) == 4:
                result.append({
                    "question": q["question"],
                    "options": q["options"],
                    "correctAnswer": q["correctAnswer"],
                    "type": "MCQ",
                    "difficulty": difficulty
                })
    
    if not result:
        raise HTTPException(status_code=500, detail="No valid MCQ questions generated")
    
    return result


# ============================================================================
# SUBJECTIVE QUESTION GENERATION
# ============================================================================

async def _generate_subjective_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None,
    job_designation: Optional[str] = None,
    experience_min: Optional[int] = None,
    experience_max: Optional[int] = None,
    company_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate Subjective questions - PRODUCTION-GRADE WITH PERSONALIZATION.
    
    Rules:
    - ONLY scenario-based, real-world, case-study style questions
    - Minimum 2-4 sentences
    - Requires reasoning, explanation, trade-offs, evaluation
    - NO: MCQ-like phrasing, "which of the following", one-liners
    - Should reflect real-world usage of the topic
    - PERSONALIZED based on job role, experience level, and company
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements (can be URL)
        job_designation: Job role/designation (e.g., "Senior Software Engineer")
        experience_min: Minimum years of experience required
        experience_max: Maximum years of experience required
        company_name: Company name for personalization (e.g., "Gisul")
        
    Returns:
        List of Subjective question dictionaries with:
        - question: Scenario-based question text (2-4 sentences minimum)
    """
    # Build personalization context
    context_parts = []
    
    if job_designation:
        context_parts.append(f"**Job Role**: {job_designation}")
    
    if experience_min is not None and experience_max is not None:
        years_text = f"{experience_min}-{experience_max} years"
        
        # Determine seniority level
        if experience_max <= 2:
            seniority = "Junior/Entry-level"
        elif experience_max <= 5:
            seniority = "Mid-level"
        elif experience_max <= 10:
            seniority = "Senior-level"
        else:
            seniority = "Principal/Lead-level"
        
        context_parts.append(f"**Experience Required**: {years_text} ({seniority})")
    
    if company_name:
        context_parts.append(f"**Company**: {company_name}")
    
    if additional_requirements:
        context_parts.append(f"**Additional Context**: {additional_requirements}")
    
    personalization_context = "\n".join(context_parts) if context_parts else ""
    
    # Build prompt with personalization
    prompt = f"""You are an expert technical assessment writer. Generate {count} scenario-based subjective question(s) for the topic: {topic}.

{'=' * 80}
CANDIDATE CONTEXT (USE THIS TO PERSONALIZE QUESTIONS):
{'=' * 80}
{personalization_context if personalization_context else "(No specific personalization context provided - generate generic professional questions)"}
{'=' * 80}

CRITICAL PERSONALIZATION REQUIREMENTS:
1. **USE THE EXACT JOB ROLE** when framing scenarios (if provided)
   - ✅ CORRECT: "You are a {job_designation or 'professional'} at {company_name or 'your company'}..."
   - ❌ WRONG: "You are a developer..." (too generic)

2. **ALIGN COMPLEXITY WITH EXPERIENCE LEVEL**:
   - Junior (0-2 years): Focus on technical execution, learning, debugging, following best practices
   - Mid-level (3-5 years): Add system design basics, code reviews, mentoring junior developers
   - Senior (5-10 years): Include architecture decisions, team leadership, cross-team collaboration
   - Principal/Lead (10+ years): Strategic planning, stakeholder management, technical direction

3. **REFERENCE COMPANY NAME** when creating scenarios (if provided):
   - ✅ CORRECT: "As a {job_designation or 'developer'} at {company_name or 'the company'}, you need to..."
   - ❌ WRONG: "As a developer at a tech company..." (too vague)

4. **USE COMPANY CONTEXT** if available:
   - Reference company's tech stack, products, or challenges mentioned in context
   - Make scenarios realistic to the company's domain

5. **MATCH SCENARIO SCOPE TO EXPERIENCE**:
   - Junior: Small feature, specific bug, single component
   - Mid-level: Feature across multiple components, performance optimization
   - Senior: System architecture, team coordination, production incidents
   - Lead: Multi-team initiatives, technology decisions, strategic planning

STANDARD REQUIREMENTS:
6. Generate ONLY scenario-based, real-world, case-study style questions
7. Each question MUST be minimum 2-4 sentences
8. Questions MUST require reasoning, explanation, trade-offs, or evaluation
9. NO MCQ-like phrasing (no "which of the following", no multiple choice options)
10. NO one-liner questions
11. Difficulty level: {difficulty}
12. Experience mode: {experience_mode}
13. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others.

Output format (JSON object with topics array):
{{
  "questions": [
    {{
      "question": "<scenario-based question text, 2-4 sentences minimum>"
    }}
  ]
}}

DO NOT include idealAnswer, expectedAnswer, or any answer fields.
Return ONLY a JSON object with questions array."""

    client = _get_openai_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            response_format={"type": "json_object"}
        )
    except Exception as exc:
        logger.error(f"OpenAI API error in _generate_subjective_questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate subjective questions") from exc

    # Parse response
    content = response.choices[0].message.content.strip() if response.choices else ""
    data = _parse_json_response(content)
    
    # Handle response format
    if isinstance(data, dict) and "questions" in data:
        questions_list = data["questions"]
    elif isinstance(data, list):
        questions_list = data
    elif isinstance(data, dict) and "question" in data:
        # Single question object
        questions_list = [data]
    else:
        logger.error(f"Unexpected response format for subjective questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Format questions
    result = []
    for q in questions_list[:count]:
        if isinstance(q, dict) and "question" in q:
            result.append({
                "question": q["question"],
                "type": "Subjective",
                "difficulty": difficulty
            })
    
    if not result:
        raise HTTPException(status_code=500, detail="No valid subjective questions generated")
    
    return result


# ============================================================================
# PSEUDOCODE QUESTION GENERATION
# ============================================================================

async def _generate_pseudocode_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None,
    job_designation: Optional[str] = None,
    experience_min: Optional[int] = None,
    experience_max: Optional[int] = None,
    company_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate Pseudocode questions - WITH LIGHT PERSONALIZATION.
    
    Rules:
    - Generate a pseudocode-related question ONLY
    - Should require algorithmic thinking
    - Must be scenario-based, not trivial
    - DO NOT generate the answer
    - Answer will be evaluated by AI scoring model
    - LIGHTLY PERSONALIZED based on experience level
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        job_designation: Job role/designation (used for context framing)
        experience_min: Minimum years of experience required
        experience_max: Maximum years of experience required
        company_name: Company name for personalization (e.g., "Gisul")
        
    Returns:
        List of PseudoCode question dictionaries with:
        - questionText: Scenario-based pseudocode question with sample input/output
    """
    # Build light personalization context (for framing only)
    context_intro = ""
    if job_designation and company_name:
        context_intro = f"At {company_name}, you are a {job_designation} working on"
    elif company_name:
        context_intro = f"At {company_name}, you need to"
    elif job_designation:
        context_intro = f"You are a {job_designation} and need to"
    
    # Determine complexity level
    complexity_hint = ""
    if experience_max is not None:
        if experience_max <= 2:
            complexity_hint = "(Junior level: Focus on basic algorithms and simple data structures)"
        elif experience_max <= 5:
            complexity_hint = "(Mid level: Include optimizations and moderate complexity)"
        elif experience_max <= 10:
            complexity_hint = "(Senior level: Complex algorithms, efficiency considerations)"
        else:
            complexity_hint = "(Lead level: System-level algorithms, scalability focus)"
    
    # Use legacy implementation with context awareness
    if _legacy_generate_questions:
        config = {
            "numQuestions": count,
            "Q1type": "Pseudo Code",
            "Q1difficulty": difficulty
        }
        questions = await _legacy_generate_questions(topic, config, coding_supported=False, experience_mode=experience_mode)
        # Filter to only PseudoCode questions and ensure proper format
        pseudocode_questions = []
        for q in questions:
            if q.get("type", "").upper() in ["PSEUDO CODE", "PSEUDOCODE", "PSEUDO-CODE"]:
                pseudocode_questions.append(q)
        return pseudocode_questions[:count] if pseudocode_questions else questions[:count]
    
    logger.warning(f"Pseudocode question generation not yet implemented for topic: {topic}")
    raise HTTPException(
        status_code=501,
        detail="Pseudocode question generation is not yet implemented. Please use the legacy endpoint."
    )


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
    logger.warning(f"Question regeneration not yet implemented for type: {question_type}")
    raise HTTPException(
        status_code=501,
        detail="Question regeneration is not yet implemented. Please use the legacy endpoint."
    )



