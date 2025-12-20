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
from .prompt_templates import V2_WEB_KEYWORDS, CODING_LANGUAGES, JUDGE0_SUPPORTED_LANGUAGES

logger = logging.getLogger(__name__)


# ============================================================================
# TOPIC GENERATION HELPERS
# ============================================================================

def _validate_and_fix_question_types(
    topics: List[Dict[str, Any]], 
    skills: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Validate and auto-correct question types based on topic content and skills.
    
    CRITICAL: Ensures programming languages get Coding type, SQL gets SQL type, AIML gets AIML type.
    
    Args:
        topics: List of topic dictionaries
        skills: List of skill dictionaries with skill_name
    
    Returns:
        List of topics with corrected question types
    """
    from .ai_utils import _v2_is_sql_topic, _v2_is_aiml_execution_topic
    
    skill_names = [s.get("skill_name", "").lower() for s in skills]
    
    for topic in topics:
        label = topic.get("label", "").lower()
        
        # Handle both v1 (direct questionType) and v2 (questionRows) formats
        # V2 format: topic has questionRows array
        # V1 format: topic has questionType directly
        is_v2_format = "questionRows" in topic and isinstance(topic.get("questionRows"), list) and len(topic["questionRows"]) > 0
        
        if is_v2_format:
            # V2 format: get questionType from first row
            current_type = topic["questionRows"][0].get("questionType", "")
        else:
            # V1 format: get questionType from root
            current_type = topic.get("questionType", "")
        
        # ⭐ CHECK IF TOPIC SHOULD BE CODING
        # Rule 1: Topic label contains programming language name
        should_be_coding = False
        detected_lang = None
        
        for lang in CODING_LANGUAGES:
            if lang in label:
                # Make sure it doesn't contain unsupported frameworks
                if not contains_unsupported_framework(label):
                    should_be_coding = True
                    detected_lang = lang
                    break
        
        # Rule 2: Topic is for a programming language skill
        if not should_be_coding:
            for skill in skill_names:
                skill_clean = skill.strip()
                for lang in CODING_LANGUAGES:
                    if lang in skill_clean:
                        # Skill is a programming language
                        # Check if topic label contains words from this skill
                        skill_words = skill_clean.split()
                        if any(word in label for word in skill_words if len(word) > 2):
                            if not contains_unsupported_framework(label):
                                should_be_coding = True
                                detected_lang = lang
                                break
                if should_be_coding:
                    break
        
        # Auto-correct to Coding if needed
        if should_be_coding and current_type != "Coding":
            logger.warning(
                f"Auto-correcting topic '{topic['label']}': "
                f"{current_type} → Coding (detected: {detected_lang})"
            )
            if is_v2_format:
                topic["questionRows"][0]["questionType"] = "Coding"
                topic["questionRows"][0]["canUseJudge0"] = True
            else:
                topic["questionType"] = "Coding"
                topic["canUseJudge0"] = True
        
        # ⭐ CHECK IF TOPIC SHOULD BE SQL
        elif _v2_is_sql_topic(label):
            if current_type != "SQL":
                logger.warning(
                    f"Auto-correcting topic '{topic['label']}': "
                    f"{current_type} → SQL"
                )
                if is_v2_format:
                    topic["questionRows"][0]["questionType"] = "SQL"
                else:
                    topic["questionType"] = "SQL"
        
        # ⭐ CHECK IF TOPIC SHOULD BE AIML
        elif _v2_is_aiml_execution_topic(label):
            if current_type != "AIML":
                logger.warning(
                    f"Auto-correcting topic '{topic['label']}': "
                    f"{current_type} → AIML"
                )
                if is_v2_format:
                    topic["questionRows"][0]["questionType"] = "AIML"
                else:
                    topic["questionType"] = "AIML"
    
    # ⭐ VERIFY MINIMUM CODING TOPICS
    # Handle both v1 and v2 formats when checking
    coding_topics = []
    for t in topics:
        if "questionRows" in t and isinstance(t.get("questionRows"), list) and len(t["questionRows"]) > 0:
            # V2 format
            if t["questionRows"][0].get("questionType") == "Coding":
                coding_topics.append(t)
        elif t.get("questionType") == "Coding":
            # V1 format
            coding_topics.append(t)
    
    coding_skills = [s for s in skill_names if any(lang in s for lang in CODING_LANGUAGES)]
    
    # ⭐ CHANGED: Calculate minimum required and enforce it (not just check == 0)
    if len(coding_skills) > 0:
        min_required = min(3, max(2, len(coding_skills)))  # At least 2, up to 3
        
        if len(coding_topics) < min_required:
            shortage = min_required - len(coding_topics)
            logger.warning(
                f"⚠️ Only {len(coding_topics)} Coding topics, need {min_required}. "
                f"Converting {shortage} more topics to Coding."
            )
            
            # Find suitable topics to convert
            converted = 0
            for topic in topics:
                if converted >= shortage:
                    break
                
                is_v2 = "questionRows" in topic and isinstance(topic.get("questionRows"), list) and len(topic["questionRows"]) > 0
                
                if is_v2:
                    qt = topic["questionRows"][0].get("questionType", "")
                else:
                    qt = topic.get("questionType", "")
                
                # Only convert MCQ/Subjective/PseudoCode topics
                if qt in ["MCQ", "Subjective", "PseudoCode"]:
                    topic_label = topic["label"].lower()
                    
                    # Check if topic is suitable for Coding conversion
                    if not contains_unsupported_framework(topic_label):
                        is_suitable = False
                        
                        # Check 1: Topic mentions programming language
                        for lang in CODING_LANGUAGES:
                            if lang in topic_label:
                                is_suitable = True
                                break
                        
                        # Check 2: Topic mentions algorithm/data structure keywords
                        if not is_suitable:
                            algo_keywords = [
                                "algorithm", "sorting", "searching", "data structure",
                                "array", "linked list", "tree", "graph", "stack", "queue",
                                "recursion", "loop", "function", "implement", "hash"
                            ]
                            if any(kw in topic_label for kw in algo_keywords):
                                is_suitable = True
                        
                        if is_suitable:
                            logger.warning(
                                f"🔧 Force-converting '{topic['label']}' to Coding "
                                f"({qt} → Coding) to meet minimum requirement"
                            )
                            
                            if is_v2:
                                topic["questionRows"][0]["questionType"] = "Coding"
                                topic["questionRows"][0]["canUseJudge0"] = True
                            else:
                                topic["questionType"] = "Coding"
                                topic["canUseJudge0"] = True
                            
                            converted += 1
            
            if converted > 0:
                final_count = len(coding_topics) + converted
                logger.info(f"✅ Converted {converted} topics. Total Coding topics now: {final_count}")
            else:
                logger.error(
                    f"❌ Could not find suitable topics to convert. "
                    f"Still short {shortage} Coding topics."
                )
    
    return topics


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
    
    # Detect SQL, AIML, and CODING skills to enforce correct question types
    skill_names_lower = [s.lower() for s in skill_names]
    
    # Detect programming language skills for Coding questions
    coding_skills = []
    for skill in skill_names_lower:
        skill_clean = skill.strip()
        for lang in CODING_LANGUAGES:
            if lang in skill_clean:
                # Make sure it's not a framework (Django contains Python, etc.)
                if not contains_unsupported_framework(skill_clean):
                    coding_skills.append(skill)
                    break
    
    has_coding_skills = len(coding_skills) > 0
    
    # Detect SQL skills
    has_sql_skills = any(
        keyword in skill_str
        for skill_str in skill_names_lower
        for keyword in ["sql", "database", "postgresql", "mysql", "mongodb", "query", "rdbms"]
    )
    
    # Detect AIML skills
    has_aiml_skills = any(
        keyword in skill_str
        for skill_str in skill_names_lower
        for keyword in ["machine learning", "deep learning", "ai", "ml", "neural", 
                       "data science", "tensorflow", "pytorch", "model", "computer vision",
                       "nlp", "scikit", "keras", "artificial intelligence"]
    )
    
    # Build question type guidance
    question_type_guidance = f"""
CRITICAL QUESTION TYPE ASSIGNMENT RULES:

**Available Question Types**: MCQ, Subjective, PseudoCode, Coding, SQL, AIML

1. **CODING Topics** - MUST use questionType: "Coding"
   - ONLY for these 10 Judge0-supported languages: Python, JavaScript, C++, Java, C, Go, Rust, C#, Kotlin, TypeScript
   - Topics about: algorithms, data structures, problem-solving (Judge0-executable)
   - Must be stdin/stdout compatible (NO frameworks, NO libraries)
   - Must NOT contain: Django, Flask, React, Angular, Spring, Rails, TensorFlow, PyTorch, Pandas, NumPy, etc.
   
   Examples of VALID Coding topics:
   ✅ "Python Sorting Algorithms" - Algorithm implementation
   ✅ "Java Data Structures (Arrays, Lists)" - Core language features
   ✅ "JavaScript Recursion and Dynamic Programming" - Problem solving
   ✅ "C++ STL Algorithms" - Standard library (Judge0 compatible)
   ✅ "Go Concurrency with Goroutines" - Core language feature
   
   Examples of INVALID Coding topics (use MCQ/Subjective instead):
   ❌ "Django REST Framework" - Web framework, not Judge0 compatible
   ❌ "React Hooks and State Management" - Frontend framework
   ❌ "TensorFlow Model Training" - ML library, use AIML type
   ❌ "Pandas Data Analysis" - Data library, use AIML type
   ❌ "Spring Boot Microservices" - Framework
   
   - Set canUseJudge0: true ONLY for Coding topics

2. **SQL Topics** - MUST use questionType: "SQL"
   - Topics about: SQL, databases, queries, joins, PostgreSQL, MySQL, MongoDB, database design, query optimization
   - Examples: "Advanced SQL Join Techniques", "Database Indexing", "Query Performance Optimization"
   - ✅ CORRECT: {{"label": "Advanced SQL Techniques", "questionType": "SQL"}}
   - ❌ WRONG: {{"label": "Advanced SQL Techniques", "questionType": "Subjective"}}

3. **AIML Topics** - MUST use questionType: "AIML"
   - Topics about: Machine Learning, Deep Learning, Neural Networks, AI, Data Science, Model Training, Computer Vision, NLP, TensorFlow, PyTorch, Scikit-learn, Model Evaluation
   - Examples: "Model Evaluation Metrics", "Neural Network Architecture", "Feature Engineering", "Computer Vision Algorithms"
   - ✅ CORRECT: {{"label": "Model Evaluation", "questionType": "AIML"}}
   - ❌ WRONG: {{"label": "Model Evaluation", "questionType": "PseudoCode"}}

4. **Other Topics** - Use: MCQ, Subjective, PseudoCode
   - Theory, concepts, comparisons, best practices, frameworks
"""
    
    if has_coding_skills:
        coding_skills_str = ', '.join(set(coding_skills))
        min_coding_topics = min(3, len(coding_skills))
        question_type_guidance += f"\n🔥 **MANDATORY**: You MUST generate at least {min_coding_topics} CODING topics.\nProgramming languages detected: {coding_skills_str}\nEach language skill MUST have at least 1 Coding topic.\n"
    
    if has_sql_skills:
        question_type_guidance += "\n**YOU MUST GENERATE AT LEAST 1-2 SQL TOPICS** with questionType: \"SQL\""
    
    if has_aiml_skills:
        question_type_guidance += "\n**YOU MUST GENERATE AT LEAST 2-3 AIML TOPICS** with questionType: \"AIML\""
    
    prompt = f"""
You are an AI assistant that generates assessment topics with structured output.
Based on:{title_context}{job_context}
- Skills/Technologies:
{skill_context}
- Experience Range: {exp_range_text}
- Experience Level: {exp_level}
- Experience Mode: {experience_mode.upper()} ({mode_context})
- Programming Languages Detected: {', '.join(set(coding_skills)) if coding_skills else 'None'}
- Has SQL Skills: {"YES - MUST include SQL topics" if has_sql_skills else "NO"}
- Has AIML Skills: {"YES - MUST include AIML topics" if has_aiml_skills else "NO"}

{'=' * 80}
{question_type_guidance}
{'=' * 80}

Generate 8-12 relevant assessment topics covering all provided skills.
Each topic should be specific, testable, and appropriate for {mode_context} at {exp_level} level.

REQUIREMENTS:
1. **STRICTLY FOLLOW QUESTION TYPE RULES ABOVE** - This is CRITICAL
2. Topic distribution:
   - Coding topics: {min(3, len(coding_skills)) if has_coding_skills else 0} topics (for: {', '.join(set(coding_skills)) if coding_skills else 'N/A'})
   - SQL topics: {1 if has_sql_skills else 0}-2 topics
   - AIML topics: {2 if has_aiml_skills else 0}-3 topics
   - MCQ/Subjective/PseudoCode: Remaining topics
3. Ensure all skills are covered across the topics
4. Vary question types and difficulties
5. Set canUseJudge0 to true ONLY for Coding questions with executable languages

CRITICAL VALIDATION - ONLY 10 JUDGE0-SUPPORTED LANGUAGES:
- If skill is "Python" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "JavaScript" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "C++" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "Java" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "C" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "Go" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "Rust" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "C#" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "Kotlin" → MUST have at least 1 topic with questionType: "Coding"
- If skill is "TypeScript" → MUST have at least 1 topic with questionType: "Coding"

⚠️ ANY OTHER LANGUAGE/FRAMEWORK → MCQ or Subjective (NOT Coding)
Examples: Ruby, Swift, PHP, Perl, Scala, R, Bash → MCQ/Subjective
Examples: Django, Flask, React, Angular, Spring → MCQ/Subjective

Return ONLY a JSON object with a "topics" array. Use this exact structure:
{{
  "topics": [
    {{
      "label": "Topic name",
      "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding" | "SQL" | "AIML",
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
        
        # Auto-correct question type based on topic content (CRITICAL FIX)
        label_lower = label.lower()
        
        # Check if topic should be SQL
        if _v2_is_sql_execution_topic(label_lower):
            if question_type != "SQL":
                logger.warning(f"Auto-correcting topic '{label}': {question_type} → SQL")
                question_type = "SQL"
        
        # Check if topic should be AIML
        elif _v2_is_aiml_execution_topic(label_lower):
            if question_type != "AIML":
                logger.warning(f"Auto-correcting topic '{label}': {question_type} → AIML")
                question_type = "AIML"
        
        # Validate and sanitize
        if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding", "SQL", "AIML"]:
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
    
    # ⭐ Validate and fix question types (Coding, SQL, AIML)
    result_topics = _validate_and_fix_question_types(result_topics, combined_skills)
    
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

