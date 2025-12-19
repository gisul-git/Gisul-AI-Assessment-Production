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
    # TODO: Move implementation from topic_service_v2.py line 2601
    pass


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

