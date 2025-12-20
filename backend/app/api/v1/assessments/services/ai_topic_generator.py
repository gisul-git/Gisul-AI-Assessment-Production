"""
Module: ai_topic_generator.py
Purpose: Topic generation functions

This module generates assessment topics using OpenAI. It handles:
- Basic topic generation (generate_topics_v2)
- Unified topic generation from multiple skill sources (generate_topics_unified)
- Topic generation from CSV requirements (generate_topics_from_requirements_v2)
- Topic improvement (improve_topic)

Dependencies:
- External: openai (for topic generation)
- Internal: ai_utils (for OpenAI client, JSON parsing, classifiers)
- Internal: judge0_utils (for framework checks)
- Internal: ai_topic_helpers (for post-processing)
- Internal: prompt_templates (for constants)

Example usage:
    ```python
    from app.api.v1.assessments.services.ai_topic_generator import generate_topics_v2
    
    topics = await generate_topics_v2(
        assessment_title="Python Developer Assessment",
        job_designation="Python Developer",
        selected_skills=["Python", "Django", "PostgreSQL"],
        experience_min=2,
        experience_max=5,
        experience_mode="corporate"
    )
    ```

Note: This module uses helper functions from ai_topic_helpers.py for post-processing.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from .ai_utils import _get_experience_level_corporate, _get_experience_level_student
from .ai_utils import _get_openai_client, _parse_json_response, _v2_contains_any, _v2_is_aiml_execution_topic, _v2_is_sql_execution_topic
from .ai_topic_helpers import (
    _ensure_all_question_types_present,
    filter_topics_with_coding_unsupported,
)
from .judge0_utils import contains_unsupported_framework, is_judge0_supported
from .prompt_templates import V2_WEB_KEYWORDS

logger = logging.getLogger(__name__)


# ============================================================================
# TOPIC GENERATION
# ============================================================================

async def generate_topics_v2(
    assessment_title: Optional[str],
    job_designation: str,
    selected_skills: List[str],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics using OpenAI with multi-row data model.
    
    Returns list of topics following exact structure:
    {
        "id": str,
        "label": str,
        "locked": False,
        "questionRows": [
            {
                "rowId": str,
                "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding",
                "difficulty": "Easy" | "Medium" | "Hard",
                "questionsCount": int,
                "canUseJudge0": bool,
                "status": "pending",
                "locked": False,
                "questions": []
            }
        ]
    }
    Each topic starts with ONE auto-generated questionRow.
    
    Args:
        assessment_title: Optional assessment title
        job_designation: Job role/designation
        selected_skills: List of selected skills
        experience_min: Minimum experience years
        experience_max: Maximum experience years
        experience_mode: Experience mode (corporate/college)
        
    Returns:
        List of topic dictionaries
        
    Raises:
        HTTPException: If topic generation fails
    """
    # TODO: Move implementation from topic_service_v2.py line 943
    pass


async def generate_topics_unified(
    assessment_title: Optional[str],
    job_designation: Optional[str],
    combined_skills: List[Dict[str, Any]],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics from combined skills from multiple sources (role-based, manual, CSV).
    ALL skills from all sources are combined with EQUAL PRIORITY and generate 8-12 topics total.
    Distribution is based on role and skills - ensures all skills are covered.
    
    Args:
        assessment_title: Optional assessment title
        job_designation: Optional job designation
        combined_skills: List of skill dictionaries with metadata (skill_name, description, importance_level, source)
        experience_min: Minimum experience years
        experience_max: Maximum experience years
        experience_mode: Experience mode (corporate/college)
        
    Returns:
        List of topic dictionaries (8-12 topics)
        
    Raises:
        HTTPException: If topic generation fails
    """
    if not combined_skills:
        raise HTTPException(status_code=400, detail="At least one skill must be provided")
    
    # Extract skill names and create context from metadata
    skill_names = [skill.get("skill_name") for skill in combined_skills if skill.get("skill_name")]
    skills_list = ", ".join(skill_names)
    
    # Build enhanced context from skill metadata
    skill_details = []
    for skill in combined_skills:
        skill_name = skill.get("skill_name", "")
        description = skill.get("description")
        importance = skill.get("importance_level")
        source = skill.get("source", "")
        
        detail = f"- {skill_name}"
        if importance:
            detail += f" (Priority: {importance})"
        if description:
            detail += f": {description}"
        skill_details.append(detail)
    
    skill_context = "\n".join(skill_details)
    
    # Get experience level context based on mode
    if experience_mode == "corporate":
        exp_level, _ = _get_experience_level_corporate(experience_min, experience_max)
        exp_range_text = f"{experience_min}-{experience_max} years"
        mode_context = "professional/corporate candidates with industry experience"
    else:  # student
        exp_level, _ = _get_experience_level_student(experience_min, experience_max)
        exp_range_text = f"{exp_level} level"
        mode_context = "college students with academic experience"
    
    # Build title context
    title_context = f"\nAssessment Title: {assessment_title}" if assessment_title else ""
    job_context = f"\nJob Role: {job_designation}" if job_designation else ""
    
    prompt = f"""
You are an AI assistant that generates assessment topics with structured output.
Based on:{title_context}{job_context}
- Skills/Technologies:
{skill_context}
- Experience Range: {exp_range_text}
- Experience Level: {exp_level}
- Experience Mode: {experience_mode.upper()} ({mode_context})

Generate 8-12 relevant assessment topics covering all provided skills.
Each topic should be specific, testable, and appropriate for {mode_context} at {exp_level} level.

For each topic, determine:
1. The most appropriate question type: MCQ, Subjective, PseudoCode, or Coding
2. Difficulty level: Easy, Medium, or Hard
3. Whether coding questions can use Judge0 execution (canUseJudge0: true/false)

IMPORTANT RULES:
- Assign "Coding" type only for programming/scripting languages that can be executed
- For frameworks, libraries, or concepts that cannot be directly executed, use MCQ, Subjective, or PseudoCode
- Set canUseJudge0 to true ONLY if questionType is "Coding" AND the language is executable (Python, JavaScript, Java, C++, etc.)
- Ensure all skills are covered across the topics
- Vary question types and difficulties

Return ONLY a JSON object with a "topics" array. Use this exact structure:
{{
  "topics": [
    {{
      "label": "Topic name",
      "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding",
      "difficulty": "Easy" | "Medium" | "Hard",
      "canUseJudge0": true | false
    }}
  ]
}}
"""

    client = _get_openai_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            response_format={"type": "json_object"}
        )
    except Exception as exc:
        logger.error(f"OpenAI API error in generate_topics_unified: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate topics") from exc

    # Parse response
    content = response.choices[0].message.content.strip() if response.choices else ""
    topics_data = _parse_json_response(content)
    
    # Handle multiple response formats
    if isinstance(topics_data, dict) and "topics" in topics_data:
        # Expected format: {"topics": [...]}
        topics_list = topics_data["topics"]
    elif isinstance(topics_data, list):
        # Array format: [...]
        topics_list = topics_data
    elif isinstance(topics_data, dict) and "label" in topics_data:
        # Single topic object: {...} - wrap it in a list
        logger.warning(f"Received single topic object instead of array, wrapping it: {topics_data}")
        topics_list = [topics_data]
    else:
        logger.error(f"Unexpected response format: {topics_data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Convert to v2 data model structure
    result_topics = []
    for topic in topics_list:
        if not isinstance(topic, dict) or "label" not in topic:
            continue
            
        label = topic.get("label", "").strip()
        question_type = topic.get("questionType", "MCQ")
        difficulty = topic.get("difficulty", "Medium")
        can_use_judge0 = topic.get("canUseJudge0", False)
        
        # Validate and sanitize
        if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding"]:
            question_type = "MCQ"
        if difficulty not in ["Easy", "Medium", "Hard"]:
            difficulty = "Medium"
        
        # Additional validation: canUseJudge0 should only be true for Coding
        if question_type != "Coding":
            can_use_judge0 = False
        
        # Check if topic contains unsupported frameworks
        if question_type == "Coding" and contains_unsupported_framework(label):
            can_use_judge0 = False
        
        # Create topic with v2 data model structure
        topic_dict = {
            "id": str(uuid.uuid4()),
            "label": label,
            "locked": False,
            "questionRows": [
                {
                    "rowId": str(uuid.uuid4()),
                    "questionType": question_type,
                    "difficulty": difficulty,
                    "questionsCount": 1,
                    "canUseJudge0": can_use_judge0 if question_type == "Coding" else False,
                    "status": "pending",
                    "locked": False,
                    "questions": []
                }
            ]
        }
        result_topics.append(topic_dict)
    
    if not result_topics:
        raise HTTPException(status_code=500, detail="No valid topics generated")
    
    # Filter out topics with unsupported coding frameworks
    result_topics = filter_topics_with_coding_unsupported(result_topics)
    
    # Ensure all question types are present
    result_topics = await _ensure_all_question_types_present(result_topics)
    
    logger.info(f"Generated {len(result_topics)} topics from {len(combined_skills)} combined skills")
    return result_topics


async def generate_topics_from_requirements_v2(
    requirements: List[Dict[str, Any]],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics from CSV requirements.
    
    Args:
        requirements: List of requirement dictionaries (skill_name, skill_description, importance_level)
        experience_min: Minimum experience years
        experience_max: Maximum experience years
        experience_mode: Experience mode (corporate/college)
        
    Returns:
        List of topic dictionaries
        
    Raises:
        HTTPException: If topic generation fails
    """
    # TODO: Move implementation from topic_service_v2.py line 3012
    pass


async def improve_topic(
    previous_topic_label: str,
    skill_context: Optional[str] = None,
    skill_description: Optional[str] = None,
    importance_level: Optional[str] = None,
    experience_mode: str = "corporate",
    experience_min: int = 0,
    experience_max: int = 10,
    combined_skills: Optional[List[Dict[str, Any]]] = None,
    job_designation: Optional[str] = None,
    assessment_title: Optional[str] = None
) -> Dict[str, Any]:
    """
    Improve a topic label and regenerate its question type using the same prompt logic as generate_topics_v2.
    Returns both the improved label and the question type with canUseJudge0 flag.
    
    Args:
        previous_topic_label: Current topic label to improve
        skill_context: Optional skill context
        skill_description: Optional skill description
        importance_level: Optional importance level
        experience_mode: Experience mode (corporate/college)
        experience_min: Minimum experience years
        experience_max: Maximum experience years
        combined_skills: Optional list of combined skills
        job_designation: Optional job designation
        assessment_title: Optional assessment title
        
    Returns:
        Dictionary with:
        - label: Improved topic label
        - questionType: Assigned question type
        - difficulty: Assigned difficulty
        - canUseJudge0: Whether Judge0 can be used
        
    Raises:
        HTTPException: If topic improvement fails
    """
    # TODO: Move implementation from topic_service_v2.py line 3177
    pass

