"""
New Topic Generation and Question Generation Service (v2)
Completely redesigned from scratch following strict architecture rules.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

try:
    from openai import AsyncOpenAI, APIError, APIConnectionError, AuthenticationError, RateLimitError
except ImportError:
    AsyncOpenAI = None
    APIError = None
    APIConnectionError = None
    AuthenticationError = None
    RateLimitError = None

from ....core.config import get_settings
from .services import _get_experience_level_corporate, _get_experience_level_student

# Import DSA module utilities for coding questions
# Note: DSA module is in parallel directory at app/api/v1/dsa/
# From app/api/v1/assessments/ we go up one level (..) to v1, then into dsa
DSA_AVAILABLE = False
dsa_generate_question = None
generate_boilerplate = None

try:
    from ..dsa.services.ai_generator import generate_question as dsa_generate_question
    from ..dsa.services.code_wrapper import generate_boilerplate
    DSA_AVAILABLE = True
except (ImportError, ModuleNotFoundError) as e:
    import logging
    logging.getLogger(__name__).warning(f"DSA module not available. Coding questions will use basic generation. Error: {e}")

logger = logging.getLogger(__name__)


def _build_openai_payload(
    model: str,
    messages: List[Dict[str, str]],
    temperature: float = 0.7,
    top_p: float = 1.0,
    max_tokens: Optional[int] = None,
    max_completion_tokens: Optional[int] = None,
    frequency_penalty: float = 0.0,
    presence_penalty: float = 0.0,
    **kwargs
) -> Dict[str, Any]:
    """
    Build OpenAI API payload, excluding unsupported parameters for o3-mini and o1-mini models.
    
    o3-mini and o1-mini do NOT support:
    - temperature
    - top_p
    - frequency_penalty
    - presence_penalty
    
    They also require max_completion_tokens instead of max_tokens.
    
    Args:
        model: The model name (e.g., "o3-mini", "gpt-4o-mini")
        messages: List of message dicts
        temperature: Temperature parameter (ignored for o3-mini/o1-mini)
        top_p: Top-p parameter (ignored for o3-mini/o1-mini)
        max_tokens: Max tokens (converted to max_completion_tokens for o3-mini/o1-mini)
        max_completion_tokens: Max completion tokens (used directly for o3-mini/o1-mini)
        frequency_penalty: Frequency penalty (ignored for o3-mini/o1-mini)
        presence_penalty: Presence penalty (ignored for o3-mini/o1-mini)
        **kwargs: Additional parameters
    
    Returns:
        Dict with OpenAI API payload
    """
    payload = {
        "model": model,
        "messages": messages,
    }
    
    # o3-mini and o1-mini don't support sampling parameters
    if model not in ["o3-mini", "o1-mini"]:
        payload["temperature"] = temperature
        payload["top_p"] = top_p
        if frequency_penalty != 0.0:
            payload["frequency_penalty"] = frequency_penalty
        if presence_penalty != 0.0:
            payload["presence_penalty"] = presence_penalty
    
    # Handle max_tokens vs max_completion_tokens
    if model in ["o3-mini", "o1-mini"]:
        if max_completion_tokens is not None:
            payload["max_completion_tokens"] = max_completion_tokens
        elif max_tokens is not None:
            payload["max_completion_tokens"] = max_tokens
    else:
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
    
    # Add any additional kwargs
    payload.update(kwargs)
    
    # Debug logging to confirm temperature is removed for o3-mini/o1-mini
    if model in ["o3-mini", "o1-mini"]:
        logger.debug(f"Payload for model {model} (no sampling params): {payload}")
        # Verify temperature is NOT in payload
        if "temperature" in payload or "top_p" in payload or "frequency_penalty" in payload or "presence_penalty" in payload:
            logger.warning(f"WARNING: Sampling parameters found in payload for {model} - this should not happen!")
    else:
        logger.debug(f"Payload for model {model}: {payload}")
    
    return payload


def _parse_json_response(content: str, error_context: str = "JSON") -> Any:
    """
    Robustly parse JSON from OpenAI response, handling markdown code blocks and control characters.
    
    Args:
        content: Raw content from OpenAI response
        error_context: Context string for error messages
        
    Returns:
        Parsed JSON object (usually a list)
        
    Raises:
        HTTPException: If JSON parsing fails after all attempts
    """
    # Remove markdown code blocks if present
    if content.startswith("```"):
        parts = content.split("```")
        if len(parts) > 1:
            # Take the content between first ``` and last ```
            content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
            # Remove language identifier if present
            if content.startswith("json"):
                content = content[4:]
            elif content.startswith("JSON"):
                content = content[4:]
        content = content.strip()
    
    # First, try to parse as-is
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass  # Continue to cleaning steps
    
    # Clean control characters and escape unescaped newlines in string values
    # The issue is that OpenAI sometimes returns JSON with unescaped newlines in strings
    # We need to escape newlines within string values (between quotes)
    import string
    cleaned_content = ""
    i = 0
    in_string = False
    escape_next = False
    
    while i < len(content):
        char = content[i]
        char_code = ord(char)
        
        # Track if we're inside a string (between unescaped quotes)
        if not escape_next:
            if char == '"':
                # Check if this quote is escaped (count backslashes before it)
                backslash_count = 0
                j = i - 1
                while j >= 0 and content[j] == '\\':
                    backslash_count += 1
                    j -= 1
                # If even number of backslashes, quote is not escaped
                if backslash_count % 2 == 0:
                    in_string = not in_string
                cleaned_content += char
                i += 1
                continue
            elif char == '\\':
                escape_next = True
                cleaned_content += char
                i += 1
                continue
        
        # Reset escape flag after processing escaped character
        if escape_next:
            escape_next = False
            cleaned_content += char
            i += 1
            continue
        
        # If we're inside a string, escape unescaped newlines and control chars
        if in_string:
            # Check if this character is escaped
            is_escaped = False
            if i > 0:
                backslash_count = 0
                j = i - 1
                while j >= 0 and content[j] == '\\':
                    backslash_count += 1
                    j -= 1
                is_escaped = (backslash_count % 2 == 1)
            
            if not is_escaped:
                if char == '\n':
                    # Escape unescaped newline
                    cleaned_content += '\\n'
                elif char == '\r':
                    # Escape unescaped carriage return
                    cleaned_content += '\\r'
                elif char == '\t':
                    # Escape unescaped tab
                    cleaned_content += '\\t'
                elif char_code < 32:
                    # Replace other control characters with space
                    cleaned_content += ' '
                else:
                    cleaned_content += char
            else:
                # Character is already escaped, keep as-is
                cleaned_content += char
        else:
            # Outside strings, allow printable characters and whitespace
            if char in string.printable or char in '\n\r\t ':
                cleaned_content += char
            elif char_code < 32:
                cleaned_content += ' '
            else:
                cleaned_content += char
        
        i += 1
    
    # Try to parse cleaned JSON
    try:
        return json.loads(cleaned_content)
    except json.JSONDecodeError as json_err:
        # If still failing, try to extract JSON array using regex as fallback
        json_match = re.search(r'\[.*\]', cleaned_content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError as e2:
                logger.error(f"{error_context} parsing failed even after regex extraction. Error: {e2}")
                logger.error(f"Content preview (first 500 chars): {cleaned_content[:500]}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Failed to parse {error_context}. Please try regenerating."
                ) from e2
        else:
            logger.error(f"{error_context} parsing failed. Error: {json_err}")
            logger.error(f"Content preview (first 500 chars): {cleaned_content[:500]}")
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to parse {error_context}. Please try regenerating."
            ) from json_err


async def _find_semantically_suitable_topic(
    topics: List[Dict[str, Any]], 
    target_question_type: str
) -> Optional[int]:
    """
    Use OpenAI to find the most semantically suitable topic for a given question type.
    Returns the index of the best matching topic, or None if no suitable match found.
    """
    if not topics:
        return None
    
    # Build topic list for analysis
    topic_labels = [topic.get("label", "") for topic in topics]
    current_types = []
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            current_types.append(question_rows[0].get("questionType", "MCQ"))
        else:
            current_types.append("MCQ")
    
    # Define semantic criteria for each question type
    semantic_criteria = {
        "MCQ": "factual knowledge, terminology, syntax, basic recall, quick assessment",
        "Subjective": "conceptual understanding, theoretical explanation, architectural reasoning, describing principles, comparing concepts",
        "PseudoCode": "algorithm design, workflow, process flow, problem-solving steps, logic breakdown, structured thinking",
        "Coding": "implementation, writing executable code, building features, programming tasks"
    }
    
    criteria = semantic_criteria.get(target_question_type, "")
    
    prompt = f"""You are an expert at semantic topic analysis. Analyze these topics and identify which one is MOST SEMANTICALLY SUITABLE for a {target_question_type} question type.

Question Type: {target_question_type}
Semantic Criteria: {criteria}

Topics (with current question types):
{chr(10).join([f"{i+1}. \"{label}\" (currently: {current_types[i]})" for i, label in enumerate(topic_labels)])}

Rules:
- Do NOT use keyword matching
- Use semantic understanding of each topic's meaning and intent
- Consider which topic's purpose aligns best with the {target_question_type} criteria
- Work for ANY domain (programming, cloud, DevOps, AI/ML, cybersecurity, databases, etc.)
- Return ONLY the topic number (1-{len(topics)}) that is most suitable
- If multiple are equally suitable, return the first one

Return ONLY a number between 1 and {len(topics)}, no explanations."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at semantic topic analysis. Always return only a number, no explanations."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,  # Lower temperature for more consistent results
            max_tokens=10,
        )
        
        content = response.choices[0].message.content.strip()
        # Extract number from response
        numbers = re.findall(r'\d+', content)
        if numbers:
            topic_idx = int(numbers[0]) - 1  # Convert to 0-based index
            if 0 <= topic_idx < len(topics):
                # Verify the topic doesn't already have this type
                question_rows = topics[topic_idx].get("questionRows", [])
                if question_rows:
                    current_type = question_rows[0].get("questionType", "MCQ")
                    if current_type != target_question_type:
                        return topic_idx
        
        return None
    except Exception as exc:
        logger.warning(f"Error in semantic topic matching: {exc}. Using fallback.")
        return None


async def _ensure_all_question_types_present(topics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Post-process topics to ensure all question types appear at least once.
    
    Rules:
    - MCQ, Subjective, PseudoCode must appear at least once
    - Coding must appear at least once ONLY if at least one topic supports it (canUseJudge0 = true)
    - Updates topics while maintaining topic-questionType relevance
    """
    if not topics:
        return topics
    
    # Collect existing question types from first row of each topic
    existing_types = set()
    coding_supported = False
    
    # First pass: check if ANY topic supports Coding
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            first_row = question_rows[0]
            if first_row.get("canUseJudge0", False):
                coding_supported = True
                break
    
    # Second pass: collect existing question types
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            first_row = question_rows[0]
            qtype = first_row.get("questionType", "MCQ")
            existing_types.add(qtype)
    
    # Required types
    required_types = {"MCQ", "Subjective", "PseudoCode"}
    if coding_supported:
        required_types.add("Coding")
    
    # Find missing types
    missing_types = required_types - existing_types
    
    if not missing_types:
        # All types already present
        return topics
    
    logger.info(f"Missing question types: {missing_types}. Ensuring all types appear at least once.")
    
    # For each missing type, find a suitable topic to update
    for missing_type in missing_types:
        topic_updated = False
        
        # Special handling for Coding: only assign if topic supports it
        if missing_type == "Coding":
            # Find a topic that supports Coding (canUseJudge0 = true)
            for topic in topics:
                question_rows = topic.get("questionRows", [])
                if question_rows:
                    first_row = question_rows[0]
                    # Check if this topic can support Coding
                    if first_row.get("canUseJudge0", False):
                        # Update the first row to Coding
                        first_row["questionType"] = "Coding"
                        topic_updated = True
                        logger.info(f"Updated topic '{topic.get('label')}' to Coding type")
                        break
            
            if not topic_updated:
                # No topic supports Coding, skip it
                logger.warning("Coding type required but no topic supports canUseJudge0. Skipping Coding requirement.")
                continue
        
        else:
            # For MCQ, Subjective, PseudoCode: use semantic matching
            # Find the most semantically suitable topic using OpenAI
            best_topic_idx = await _find_semantically_suitable_topic(
                topics, missing_type
            )
            
            if best_topic_idx is not None:
                topic = topics[best_topic_idx]
                question_rows = topic.get("questionRows", [])
                if question_rows:
                    first_row = question_rows[0]
                    first_row["questionType"] = missing_type
                    # Ensure canUseJudge0 is False for non-Coding types
                    if missing_type != "Coding":
                        first_row["canUseJudge0"] = False
                    topic_updated = True
                    logger.info(f"Semantically updated topic '{topic.get('label')}' to {missing_type} type")
            
            # Fallback: if semantic matching didn't work, use first available topic
            if not topic_updated:
                for topic in topics:
                    question_rows = topic.get("questionRows", [])
                    if question_rows:
                        first_row = question_rows[0]
                        if first_row.get("questionType", "MCQ") != missing_type:
                            first_row["questionType"] = missing_type
                            if missing_type != "Coding":
                                first_row["canUseJudge0"] = False
                            topic_updated = True
                            logger.info(f"Fallback: Updated topic '{topic.get('label')}' to {missing_type} type")
                            break
            
            if not topic_updated:
                # Fallback: update the first topic that doesn't have this type
                for topic in topics:
                    question_rows = topic.get("questionRows", [])
                    if question_rows:
                        first_row = question_rows[0]
                        if first_row.get("questionType", "MCQ") != missing_type:
                            first_row["questionType"] = missing_type
                            if missing_type != "Coding":
                                first_row["canUseJudge0"] = False
                            topic_updated = True
                            logger.info(f"Fallback: Updated topic '{topic.get('label')}' to {missing_type} type")
                            break
    
    # Verify all required types are now present
    final_types = set()
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            final_types.add(question_rows[0].get("questionType", "MCQ"))
    
    missing_after = required_types - final_types
    if missing_after:
        logger.warning(f"Still missing question types after post-processing: {missing_after}")
    else:
        logger.info(f"✅ All required question types are now present: {final_types}")
    
    return topics


def _get_openai_client() -> AsyncOpenAI:
    """Get OpenAI client instance."""
    settings = get_settings()
    api_key = getattr(settings, 'openai_api_key', None)
    if not api_key:
        raise ValueError("OpenAI API key not configured")
    return AsyncOpenAI(api_key=api_key)


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
    """
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    skills_text = ", ".join(selected_skills)
    title_text = assessment_title if assessment_title else "Not specified"
    
    prompt = f"""You are an expert assessment designer. Generate topics with UNIVERSAL, DOMAIN-AGNOSTIC question type assignment.

Generate a list of highly relevant assessment topics using:
- Job role/domain: {job_designation}
- Assessment title: {title_text}
- Selected skills: {skills_text}
- Experience mode: {experience_mode}
- Experience level: {experience_level}

For each topic, you must assign questionType based on SEMANTIC MEANING, not keywords:

1. SUBJECTIVE (explanation-oriented):
   Use for topics requiring:
   - Conceptual understanding, theoretical explanation
   - Architectural or design reasoning
   - Describing principles, rules, or ideas
   - Comparing and contrasting concepts
   - Topics where factual recall is insufficient
   
   Semantic intent: "explain", "describe", "why", "impact", "advantages", "concepts", "principles", "paradigms"

2. PSEUDOCODE (logic/algorithm-oriented):
   Use for topics involving:
   - Designing algorithms or workflows
   - Explaining process flow or problem-solving steps
   - Breaking down logic or structured thinking
   - Topics where logic and structured thinking are central
   
   Semantic intent: "algorithm", "workflow", "logic", "steps", "process", "how it works", "flow", "sequence"

3. CODING (implementation/execution-oriented):
   Use ONLY if the topic implies:
   - Writing functional, executable code
   - Implementation of features, modules, or algorithms
   - Tasks that can be executed with test cases
   
   Semantic intent: "implement", "build", "create", "write code", "solve", "program", "develop", "write function"
   Set canUseJudge0 = true ONLY for Coding topics.

4. MCQ (factual/basic/quick-assessment):
   Use for topics involving:
   - Terminology, facts, syntax-level understanding
   - Straightforward objective recall
   - Quick verification of knowledge
   
   Semantic intent: "basics", "fundamentals", "definition", "types", "components", "identify", "select", "choose"

CRITICAL RULES:
- Assign questionType based on SEMANTIC MEANING, not keyword matching
- Work for ANY domain: programming, cloud, DevOps, AI/ML, cybersecurity, databases, frameworks, etc.
- Do NOT hardcode technology-specific rules
- Ensure variety: aim for a balanced mix of question types across all topics

For each topic:
- Produce a topic label (specific, meaningful, assessment-ready)
- Select questionType using semantic understanding (MCQ | Subjective | PseudoCode | Coding)
- Assign difficulty: Easy | Medium | Hard
- Set canUseJudge0 = true ONLY for Coding topics

Return ONLY JSON:
[
  {{
    "label": "",
    "questionType": "",
    "difficulty": "",
    "canUseJudge0": true/false
  }}
]

Generate 8-12 topics. Return only the JSON array, no explanations."""

    try:
        client = _get_openai_client()
    except ValueError as exc:
        logger.error(f"OpenAI API key not configured: {exc}")
        raise HTTPException(status_code=500, detail="OpenAI API key not configured") from exc
    
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks or explanations outside the JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        topics_data = json.loads(content)
        
        # Transform to multi-row model format
        topics = []
        for idx, topic_data in enumerate(topics_data):
            question_type = topic_data.get("questionType", "MCQ")
            difficulty = topic_data.get("difficulty", "Medium")
            can_use_judge0 = topic_data.get("canUseJudge0", False)
            
            # Validate question type
            if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding"]:
                question_type = "MCQ"
            
            # Validate difficulty
            if difficulty not in ["Easy", "Medium", "Hard"]:
                difficulty = "Medium"
            
            # Ensure canUseJudge0 is only True for Coding
            if question_type != "Coding":
                can_use_judge0 = False
            
            # Create topic with first questionRow
            topic = {
                "id": str(uuid.uuid4()),
                "label": topic_data.get("label", ""),
                "locked": False,
                "questionRows": [
                    {
                        "rowId": str(uuid.uuid4()),
                        "questionType": question_type,
                        "difficulty": difficulty,
                        "questionsCount": 1,  # Default, can be updated by user
                        "canUseJudge0": can_use_judge0,
                        "status": "pending",
                        "locked": False,
                        "questions": []
                    }
                ]
            }
            
            topics.append(topic)
        
        # Post-process: Ensure all question types appear at least once
        topics = await _ensure_all_question_types_present(topics)
        
        return topics
        
    except json.JSONDecodeError as exc:
        logger.error(f"Failed to parse OpenAI response as JSON: {exc}")
        raise HTTPException(status_code=500, detail="Failed to parse topic generation response") from exc
    except Exception as exc:
        logger.error(f"Error generating topics: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate topics: {str(exc)}") from exc


async def generate_questions_for_row_v2(
    topic_label: str,
    question_type: str,
    difficulty: str,
    questions_count: int,
    can_use_judge0: bool,
    coding_language: str = "python",
    additional_requirements: Optional[str] = None,
    experience_mode: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate questions for a single question row based on question type.
    Returns questions in appropriate format for each type.
    
    Args:
        topic_label: The topic label
        question_type: Type of question (MCQ, Subjective, PseudoCode, Coding)
        difficulty: Difficulty level (Easy, Medium, Hard)
        questions_count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used (for coding questions)
        coding_language: Programming language for coding questions (python, java, cpp, c, javascript, typescript, go, ruby)
        additional_requirements: Optional additional requirements for question generation
        experience_mode: Experience mode (corporate/student/college)
    """
    # Normalize question type (case-insensitive)
    question_type_normalized = question_type.strip()
    if question_type_normalized.lower() == "mcq":
        question_type_normalized = "MCQ"
    elif question_type_normalized.lower() == "subjective":
        question_type_normalized = "Subjective"
    elif question_type_normalized.lower() == "pseudocode":
        question_type_normalized = "PseudoCode"
    elif question_type_normalized.lower() == "coding":
        question_type_normalized = "Coding"
    
    # Normalize experience mode
    if not experience_mode or experience_mode.lower() in ["student", "college"]:
        experience_mode = "college"
    else:
        experience_mode = "corporate"
    
    if question_type_normalized == "MCQ":
        return await _generate_mcq_questions(topic_label, difficulty, questions_count, experience_mode, additional_requirements)
    elif question_type_normalized == "Subjective":
        return await _generate_subjective_questions(topic_label, difficulty, questions_count, experience_mode, additional_requirements)
    elif question_type_normalized == "PseudoCode":
        return await _generate_pseudocode_questions(topic_label, difficulty, questions_count, experience_mode, additional_requirements)
    elif question_type_normalized == "Coding":
        return await _generate_coding_questions(topic_label, difficulty, questions_count, can_use_judge0, coding_language, experience_mode, additional_requirements)
    else:
        logger.error(f"Unsupported question type: {question_type} (normalized: {question_type_normalized})")
        raise HTTPException(status_code=400, detail=f"Unsupported question type: {question_type}. Supported types: MCQ, Subjective, PseudoCode, Coding")


# Keep old function name for backward compatibility during transition
async def generate_questions_for_topic_v2(
    topic_label: str,
    question_type: str,
    difficulty: str,
    questions_count: int,
    can_use_judge0: bool,
    coding_language: str = "python"
) -> List[Dict[str, Any]]:
    """Alias for generate_questions_for_row_v2 for backward compatibility."""
    return await generate_questions_for_row_v2(topic_label, question_type, difficulty, questions_count, can_use_judge0, coding_language)


async def _generate_mcq_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate MCQ questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - MCQ must include exactly 4 options
    - One correct answer
    - Should NOT be overly simple syntax questions unless topic requires it
    - Should match the difficulty level
    - Generate both question + options + correctAnswer
    """
    # Normalize experience mode
    if not experience_mode or experience_mode.lower() in ["student", "college"]:
        experience_mode = "college"
    else:
        experience_mode = "corporate"
    
    # Build experience mode rules
    experience_rules = ""
    if experience_mode == "college":
        experience_rules = "\nCOLLEGE MODE RULES:\n- Beginner/intermediate academic level\n- Avoid enterprise/production terminology\n- Use small academic examples\n- Focus on conceptual understanding\n- NO job-role context\n"
    else:
        experience_rules = "\nCORPORATE MODE RULES:\n- Realistic, industry-driven scenarios\n- Include production workflows, optimization, best practices\n- Use professional terminology\n- Expect deeper critical thinking\n"
    
    additional_req_text = ""
    if additional_requirements:
        additional_req_text = f"\nAdditional Requirements: {additional_requirements}\n"
    
    prompt = f"""You are an expert technical assessment writer. Generate {count} Multiple Choice Question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Each question MUST have exactly 4 options (no more, no less)
2. One option must be the correct answer
3. Difficulty level: {difficulty}
4. Questions should match the difficulty level - avoid overly simple syntax questions unless the topic specifically requires it
5. Options should be plausible and well-distributed (not obviously wrong)
6. The correct answer should be clearly correct but not trivial
7. Experience mode: {experience_mode}{experience_rules}{additional_req_text}
8. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, contexts, and problem types. If generating multiple questions, ensure they cover different aspects or applications of the topic.

Output format (JSON array):
[
  {{
    "question": "<the question text>",
    "options": ["<option 1>", "<option 2>", "<option 3>", "<option 4>"],
    "correctAnswer": "<the exact text of the correct option>"
  }}
]

IMPORTANT:
- The correctAnswer must match EXACTLY one of the options (case-sensitive)
- All 4 options must be distinct and meaningful
- Return ONLY a JSON array. No markdown, no explanations."""

    try:
        client = _get_openai_client()
        system_message = "You are an expert assessment writer. Always return valid JSON arrays. Never include markdown code blocks."
        if experience_mode == "college":
            system_message += " Generate questions appropriate for college/student level - avoid enterprise terminology and focus on academic concepts."
        else:
            system_message += " Generate questions appropriate for corporate/professional level - use industry terminology and real-world scenarios."
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_message
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "MCQ questions JSON")
        
        # Validate questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "question" in q and "options" in q and "correctAnswer" in q:
                options = q["options"]
                if isinstance(options, list) and len(options) == 4:
                    # Verify correctAnswer matches one of the options
                    correct_answer = q["correctAnswer"]
                    if correct_answer in options:
                        validated_questions.append(q)
                    else:
                        logger.warning(f"MCQ correctAnswer doesn't match any option, skipping question")
                else:
                    logger.warning(f"MCQ doesn't have exactly 4 options, skipping question")
            else:
                logger.warning(f"MCQ missing required fields, skipping question")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid MCQ questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating MCQ questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate MCQ questions: {str(exc)}") from exc


async def _generate_subjective_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate") -> List[Dict[str, Any]]:
    """
    Generate Subjective questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - ONLY scenario-based, real-world, case-study style questions
    - Minimum 2-4 sentences
    - Requires reasoning, explanation, trade-offs, evaluation
    - NO: MCQ-like phrasing, "which of the following", one-liners
    - Should reflect real-world usage of the topic
    - Must be context-aware (topic, category, difficulty, experience mode)
    
    Difficulty Mapping:
    - EASY → simple but meaningful real-life context
    - MEDIUM → multi-step reasoning with explanation
    - HARD → deep design decisions, constraints, trade-offs
    """
    # Context-aware scenario generation based on experience mode
    if experience_mode == "college":
        context_guidance = """
        Scenarios should relate to:
        - Academic projects
        - Mini-projects
        - Lab tasks
        - Internships
        - Programming assignments
        """
    else:  # corporate
        context_guidance = """
        Scenarios should relate to:
        - Production systems
        - Debugging real issues
        - Business workflows
        - System design choices
        - Team collaboration
        - Customer-facing problems
        """
    
    # Difficulty-specific requirements
    difficulty_requirements = {
        "Easy": "Simple but meaningful real-life context. Short scenario, simple decision or explanation needed.",
        "Medium": "Multi-step scenario with constraints or trade-offs. Requires reasoning and explanation.",
        "Hard": "Complex real-world scenario with multiple stakeholders or constraints. Deep design decisions, trade-offs, and evaluation required."
    }
    
    difficulty_req = difficulty_requirements.get(difficulty, difficulty_requirements["Medium"])
    
    prompt = f"""You are an expert technical assessment writer. Generate {count} scenario-based subjective question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based, real-world, case-study style questions
2. Each question MUST be minimum 2-4 sentences
3. Questions MUST require reasoning, explanation, trade-offs, or evaluation
4. NO MCQ-like phrasing (no "which of the following", no multiple choice options)
5. NO one-liner questions
6. Questions should reflect real-world usage of the topic: {topic}
7. Difficulty level: {difficulty}
8. {difficulty_req}
9. Experience mode: {experience_mode}
10. {context_guidance}
11. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, contexts, stakeholders, and problem types. If generating multiple questions, ensure they cover different aspects or applications of the topic.

EXAMPLES OF GOOD QUESTIONS:
- "You are working on a production e-commerce system that processes thousands of orders per minute. During peak hours, you notice the database connection pool is exhausted, causing transaction failures. Describe your approach to diagnose and resolve this issue, considering both immediate fixes and long-term scalability."
- "A team is building a mobile app that needs to sync data across devices. They're debating between using a local-first architecture with eventual consistency versus a server-authoritative approach. Explain the trade-offs of each approach and recommend which one to use for a collaborative note-taking app."
- "You're tasked with refactoring a legacy codebase that has tight coupling between components. The current system works but is difficult to test and extend. Outline your strategy for refactoring while maintaining system stability and minimizing downtime."

EXAMPLES OF BAD QUESTIONS (DO NOT GENERATE THESE):
- "What is {topic}?" (too simple, definition-level)
- "Explain {topic}." (no scenario, no context)
- "Which of the following is true about {topic}?" (MCQ-like phrasing)
- "List the benefits of {topic}." (too trivial)

Output format (JSON array):
[
  {{
    "question": "<scenario-based question text, 2-4 sentences minimum>"
  }}
]

DO NOT include idealAnswer, expectedAnswer, or any answer fields.
Return ONLY a JSON array with question text."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in scenario-based technical questions. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Subjective questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "question" in q:
                question_text = q["question"].strip()
                # Ensure minimum length (at least 2 sentences)
                if len(question_text) > 50 and question_text.count('.') >= 1:
                    validated_questions.append({"question": question_text})
                else:
                    logger.warning(f"Generated subjective question too short or invalid, skipping: {question_text[:50]}...")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid subjective questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Subjective questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Subjective questions: {str(exc)}") from exc


async def _generate_pseudocode_questions(topic: str, difficulty: str, count: int) -> List[Dict[str, Any]]:
    """
    Generate Pseudocode questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - Generate a pseudocode-related question ONLY
    - Should require algorithmic thinking
    - Must be scenario-based, not trivial
    - DO NOT generate the answer
    - Answer will be evaluated by AI scoring model
    """
    prompt = f"""You are an expert technical assessor. Generate {count} pseudocode question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based pseudocode questions (not trivial syntax questions)
2. Questions MUST require algorithmic thinking and problem-solving
3. Difficulty level: {difficulty}
4. Questions should describe a real-world problem that requires algorithmic logic
5. Include sample input/output scenarios in the question text
6. The question should ask for pseudocode, not executable code
7. Avoid syntax tied to any specific programming language
8. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, problem types, and algorithmic approaches.

DO NOT include:
- expectedAnswer
- explanation
- idealAnswer
- Any answer fields

The question text should:
- Describe a scenario or problem
- Include sample input/output examples
- Ask the candidate to write pseudocode to solve it
- Be suitable for evaluation in an interview or assessment

Output format (JSON array):
[
  {{
    "questionText": "<scenario-based pseudocode question text with sample input/output>"
  }}
]

Example good question:
{{
  "questionText": "You are designing an algorithm for a ride-sharing app to match drivers with passengers. Given a list of available drivers (each with their current location coordinates) and a list of ride requests (each with pickup location coordinates), write pseudocode to match each request to the nearest available driver. Include sample input: drivers = [(10, 20), (15, 25), (5, 10)], requests = [(12, 22), (8, 15)]. Expected output: request 1 → driver 1, request 2 → driver 3."
}}

Return ONLY valid JSON. No markdown, no explanations, NO answer fields."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in algorithmic problems. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "PseudoCode questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "questionText" in q:
                question_text = q["questionText"].strip()
                # Remove any answer fields if present
                clean_question = {"questionText": question_text}
                validated_questions.append(clean_question)
            elif isinstance(q, dict) and "question" in q:
                # Handle alternative field name
                question_text = q["question"].strip()
                validated_questions.append({"questionText": question_text})
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid pseudocode questions out of {count} requested")
        
        return validated_questions[:count]
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error generating PseudoCode questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate PseudoCode questions: {str(exc)}") from exc


def _get_starter_code_template(language: str) -> str:
    """
    Get starter code template for a given language.
    
    Args:
        language: Programming language (python, java, cpp, c, javascript, typescript, go, ruby)
        
    Returns:
        Starter code template string
    """
    templates = {
        "python": """def solve():
    # Write your logic here
    pass""",
        "java": """public class Solution {
    public static void solve() {
        // Write your logic here
    }
    public static void main(String[] args) {
        // Do not modify this method
    }
}""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

void solve() {
    // Write your logic here
}

int main() {
    // Locked main function
    return 0;
}""",
        "c": """#include <stdio.h>

void solve() {
    // Write your logic here
}

int main() {
    // Do not modify main, input/output handled here
    return 0;
}""",
        "javascript": """function solve(input) {
    // Write your logic here
}""",
        "typescript": """function solve(input: string): string {
    // Write your logic here
}""",
        "go": """package main

import "fmt"

func solve() {
    // Write your logic here
}

func main() {
    // Do not modify this method
}""",
        "ruby": """def solve
    # Write your logic here
end""",
    }
    return templates.get(language.lower(), templates["python"])


def _get_judge0_language_id(language: str) -> int:
    """
    Get Judge0 language ID for a given language.
    
    Args:
        language: Programming language name
        
    Returns:
        Judge0 language ID
    """
    language_id_map = {
        "python": 71,      # Python 3
        "java": 62,        # Java
        "cpp": 54,         # C++ (GCC)
        "c": 50,           # C (GCC)
        "javascript": 63,  # Node.js
        "typescript": 74,  # TypeScript
        "go": 60,          # Go
        "ruby": 72,        # Ruby
    }
    return language_id_map.get(language.lower(), 71)  # Default to Python


async def _generate_coding_questions(topic: str, difficulty: str, count: int, can_use_judge0: bool, coding_language: str = "python") -> List[Dict[str, Any]]:
    """
    Generate Coding questions (Judge0-compatible) using DSA module architecture.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language for coding questions (python, java, cpp, c, javascript, typescript, go, ruby)
    
    Returns questions in DSA-compatible format with:
    - questionText (description + examples + constraints)
    - starterCode (for specified language)
    - visibleTestCases (public test cases)
    - hiddenTestCases (hidden test cases)
    - constraints
    - functionSignature
    - explanation (optional)
    - language (Judge0 language ID)
    """
    if not can_use_judge0:
        raise HTTPException(status_code=400, detail="Coding questions require canUseJudge0 to be true")
    
    # Normalize language
    coding_language = coding_language.lower()
    if coding_language not in ["python", "java", "cpp", "c", "javascript", "typescript", "go", "ruby"]:
        logger.warning(f"Unknown language '{coding_language}', defaulting to 'python'")
        coding_language = "python"
    
    # Use DSA module's AI generator if available
    if DSA_AVAILABLE and dsa_generate_question is not None:
        try:
            # Generate questions using DSA module (one at a time for count > 1)
            questions = []
            for i in range(count):
                # Map difficulty: Easy -> easy, Medium -> medium, Hard -> hard
                dsa_difficulty = difficulty.lower()
                
                # Generate using DSA module with the specified language
                dsa_question = await dsa_generate_question(
                    difficulty=dsa_difficulty,
                    topic=topic,
                    concepts=None,
                    languages=[coding_language]  # Use the specified language
                )
                
                # Transform DSA format to assessment format
                # DSA format has: title, description, examples, constraints, public_testcases, hidden_testcases, starter_code, function_signature
                # Assessment format needs: questionText, starterCode, visibleTestCases, hiddenTestCases, constraints, functionSignature, explanation
                
                # Build questionText from description + examples
                question_text = dsa_question.get("description", "")
                
                # Add examples if available
                examples = dsa_question.get("examples", [])
                if examples:
                    question_text += "\n\nExamples:\n"
                    for idx, ex in enumerate(examples, 1):
                        question_text += f"\nExample {idx}:\n"
                        question_text += f"Input: {ex.get('input', '')}\n"
                        question_text += f"Output: {ex.get('output', '')}\n"
                        if ex.get("explanation"):
                            question_text += f"Explanation: {ex.get('explanation')}\n"
                
                # Get starter code for the specified language
                starter_code_dict = dsa_question.get("starter_code", {})
                starter_code = starter_code_dict.get(coding_language) if starter_code_dict else ""
                # Fallback to template if DSA didn't provide starter code for this language
                if not starter_code:
                    starter_code = _get_starter_code_template(coding_language)
                
                # Transform test cases
                visible_testcases = []
                for tc in dsa_question.get("public_testcases", []):
                    visible_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                hidden_testcases = []
                for tc in dsa_question.get("hidden_testcases", []):
                    hidden_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                # Get constraints
                constraints_list = dsa_question.get("constraints", [])
                constraints_text = "\n".join(f"- {c}" for c in constraints_list) if constraints_list else ""
                
                # Get function signature
                func_sig = dsa_question.get("function_signature", {})
                
                # Build assessment question object
                assessment_question = {
                    "questionText": question_text,
                    "starterCode": starter_code,
                    "visibleTestCases": visible_testcases,
                    "hiddenTestCases": hidden_testcases,
                    "constraints": constraints_text,
                    "functionSignature": func_sig,
                    "difficulty": difficulty,
                    "explanation": f"This problem tests understanding of {topic} at {difficulty} level.",
                    "language": str(_get_judge0_language_id(coding_language)),  # Store Judge0 language ID
                    "codingLanguage": coding_language,  # Store language name for frontend
                }
                
                questions.append(assessment_question)
            
            return questions
            
        except Exception as dsa_exc:
            logger.warning(f"DSA module generation failed, falling back to basic generation: {dsa_exc}")
            # Fall through to basic generation
    
    # Fallback: Basic generation if DSA module not available or failed
    starter_template = _get_starter_code_template(coding_language)
    prompt = f"""Generate {count} fully Judge0-compatible coding questions for: {topic}.

Difficulty: {difficulty}
Programming Language: {coding_language.upper()}

CRITICAL REQUIREMENTS:
1. You MUST generate the starter code and solution template in {coding_language.upper()}.
2. NEVER produce Python code unless language=python.
3. The template must follow standard function-signature patterns of {coding_language.upper()}.
4. Use the {coding_language.upper()} starter code template provided below.
5. DO NOT generate the final solution or answer code - only starter code with function signature
6. The system will evaluate using Judge0 test cases

Starter Code Template for {coding_language.upper()}:
{starter_template}

Each question must include:
- questionText (problem description with examples, constraints, and input/output format)
- starterCode ({coding_language.upper()} starter code with function signature matching the template above - incomplete, candidate must fill in logic)
- visibleTestCases (2-3 public test cases with input/output)
- hiddenTestCases (3-5 hidden test cases with input/output)
- constraints (list of constraints as string)
- functionSignature (name, parameters, return_type - must match {coding_language.upper()} syntax)

DO NOT include:
- solution
- answer
- complete implementation
- final code

Return ONLY a JSON array. Example format for {coding_language.upper()}:
[
  {{
    "questionText": "Problem description with examples, constraints, and input/output format...",
    "starterCode": "{starter_template.replace(chr(10), '\\n').replace('"', '\\"')}",
    "visibleTestCases": [
      {{"input": "5", "output": "10"}},
      {{"input": "10", "output": "20"}}
    ],
    "hiddenTestCases": [
      {{"input": "1", "output": "2"}},
      {{"input": "100", "output": "200"}}
    ],
    "constraints": "1 <= n <= 10^5",
    "functionSignature": {{
      "name": "solve",
      "parameters": [],
      "return_type": "void"
    }}
  }}
]

IMPORTANT: 
- All starter code MUST be in {coding_language.upper()}, NOT Python (unless language=python)
- Starter code should be incomplete - candidate must implement the logic
- DO NOT provide the solution or answer

Return ONLY valid JSON. No markdown, no explanations, NO solution code."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in coding problems. Always return valid JSON arrays. Never include markdown code blocks."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Coding questions JSON")
        
        # Ensure all questions have language information and remove any solution/answer fields
        validated_questions = []
        for question in questions:
            if not isinstance(question, dict):
                continue
            
            # Remove any solution/answer fields
            clean_question = {k: v for k, v in question.items() 
                            if k not in ["solution", "answer", "completeCode", "finalCode", "implementation"]}
            
            # Ensure required fields
            if not clean_question.get("language"):
                clean_question["language"] = str(_get_judge0_language_id(coding_language))
            if not clean_question.get("codingLanguage"):
                clean_question["codingLanguage"] = coding_language
            # Ensure starter code is in the correct language (fallback to template if missing)
            if not clean_question.get("starterCode"):
                clean_question["starterCode"] = _get_starter_code_template(coding_language)
            
            # Validate required fields
            if clean_question.get("questionText") and clean_question.get("starterCode"):
                validated_questions.append(clean_question)
            else:
                logger.warning(f"Coding question missing required fields, skipping")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid coding questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Coding questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Coding questions: {str(exc)}") from exc


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
    """
    if not combined_skills:
        return []
    
    # Group skills by source
    role_skills = [s for s in combined_skills if s.get("source") == "role"]
    manual_skills = [s for s in combined_skills if s.get("source") == "manual"]
    csv_skills = [s for s in combined_skills if s.get("source") == "csv"]
    
    all_topics = []
    
    # Generate topics for role-based skills
    if role_skills and job_designation:
        role_skill_names = [s.get("skill_name", "") for s in role_skills]
        role_topics = await generate_topics_v2(
            assessment_title=assessment_title,
            job_designation=job_designation,
            selected_skills=role_skill_names,
            experience_min=experience_min,
            experience_max=experience_max,
            experience_mode=experience_mode
        )
        for topic in role_topics:
            topic["source"] = "ai"
            topic["status"] = "pending"
        all_topics.extend(role_topics)
    
    # Generate topics for manual skills
    if manual_skills:
        for skill in manual_skills:
            skill_name = skill.get("skill_name", "")
            if skill_name:
                manual_topics = await generate_topics_v2(
                    assessment_title=assessment_title,
                    job_designation=skill_name,
                    selected_skills=[skill_name],
                    experience_min=experience_min,
                    experience_max=experience_max,
                    experience_mode=experience_mode
                )
                for topic in manual_topics:
                    topic["source"] = "manual"
                    topic["status"] = "pending"
                all_topics.extend(manual_topics)
    
    # Generate topics for CSV skills
    if csv_skills:
        csv_topics = await generate_topics_from_requirements_v2(
            requirements=csv_skills,
            experience_min=experience_min,
            experience_max=experience_max,
            experience_mode=experience_mode
        )
        all_topics.extend(csv_topics)
    
    # Deduplicate topics by label
    seen_labels = set()
    unique_topics = []
    for topic in all_topics:
        label = topic.get("label", "").lower().strip()
        if label and label not in seen_labels:
            seen_labels.add(label)
            unique_topics.append(topic)
    
    return unique_topics


async def generate_topics_from_requirements_v2(
    requirements: List[Dict[str, Any]],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics from CSV requirements.
    """
    if not requirements:
        return []
    
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    all_topics = []
    
    for req in requirements:
        skill_name = req.get("skill_name", "")
        skill_description = req.get("skill_description", "") or req.get("description", "")
        importance_level = req.get("importance_level", "Medium")
        
        if not skill_name:
            continue
        
        # Build prompt for CSV requirement
        prompt = f"""Generate 2-4 assessment topics for the following skill requirement:

Skill Name: {skill_name}
Skill Description: {skill_description}
Importance Level: {importance_level}
Experience Mode: {experience_mode}
Experience Level: {experience_level}

For each topic:
- Produce a topic label (specific, meaningful, assessment-ready)
- Select questionType using semantic understanding (MCQ | Subjective | PseudoCode | Coding)
- Assign difficulty: Easy | Medium | Hard
- Set canUseJudge0 = true ONLY for Coding topics

Return ONLY JSON array:
[
  {{
    "label": "",
    "questionType": "",
    "difficulty": "",
    "canUseJudge0": true/false
  }}
]

Generate 2-4 topics. Return only the JSON array, no explanations."""
        
        try:
            client = _get_openai_client()
            response = await client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks or explanations outside the JSON."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
            )
            
            content = response.choices[0].message.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()
            
            topics_data = json.loads(content)
            
            for topic_data in topics_data:
                question_type = topic_data.get("questionType", "MCQ")
                difficulty = topic_data.get("difficulty", "Medium")
                can_use_judge0 = topic_data.get("canUseJudge0", False)
                
                if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding"]:
                    question_type = "MCQ"
                if difficulty not in ["Easy", "Medium", "Hard"]:
                    difficulty = "Medium"
                if question_type != "Coding":
                    can_use_judge0 = False
                
                topic = {
                    "id": str(uuid.uuid4()),
                    "label": topic_data.get("label", ""),
                    "locked": False,
                    "source": "csv",
                    "status": "pending",
                    "questionRows": [
                        {
                            "rowId": str(uuid.uuid4()),
                            "questionType": question_type,
                            "difficulty": difficulty,
                            "questionsCount": 1,
                            "canUseJudge0": can_use_judge0,
                            "status": "pending",
                            "locked": False,
                            "questions": []
                        }
                    ]
                }
                all_topics.append(topic)
                
        except Exception as exc:
            logger.error(f"Error generating topics for requirement {skill_name}: {exc}", exc_info=True)
            continue
    
    return all_topics


async def improve_topic(
    previous_topic_label: str,
    skill_context: Optional[str] = None,
    skill_description: Optional[str] = None,
    importance_level: Optional[str] = None,
    experience_mode: str = "corporate",
    experience_min: int = 0,
    experience_max: int = 10
) -> str:
    """
    Improve a topic label while maintaining the same domain and purpose.
    """
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    system_message = """You are an expert assessment designer. Improve the provided topic so that it is clearer, deeper, more technically accurate, and more assessable. Maintain the same domain, same conceptual scope, and same purpose. DO NOT generate a different topic. DO NOT change the domain. Produce 1 improved topic only."""
    
    context_parts = []
    if skill_context:
        context_parts.append(f"Skill: {skill_context}")
    if skill_description:
        context_parts.append(f"Description: {skill_description}")
    if importance_level:
        context_parts.append(f"Importance: {importance_level}")
    
    context_text = "\n".join(context_parts) if context_parts else "N/A"
    
    user_message = f"""Improve the following topic while keeping the same domain and purpose. It must be a better version of the previous topic without repeating the same wording. DO NOT simplify it.

Experience mode: {experience_mode}
Experience level: {experience_level}
Context: {context_text}

Previous topic: {previous_topic_label}

Return ONLY the improved topic label as a single string, nothing else."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
        )
        
        improved_label = response.choices[0].message.content.strip()
        # Remove quotes if present
        improved_label = improved_label.strip('"').strip("'")
        return improved_label
        
    except Exception as exc:
        logger.error(f"Error improving topic: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to improve topic: {str(exc)}") from exc


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
    """
    try:
        if not experience_mode or experience_mode.lower() in ["student", "college"]:
            experience_mode = "college"
        else:
            experience_mode = "corporate"
        
        if experience_mode == "corporate":
            experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
        else:
            experience_level, _ = _get_experience_level_student(experience_min, experience_max)
        
        improvement_goals = [
            "increase clarity",
            "increase assessability",
            "ensure practical relevance if corporate",
            "ensure academic structure if student",
            "maintain conceptual integrity"
        ]
        
        if feedback:
            improvement_goals.append(f"User feedback: {feedback}")
        
        if additional_requirements:
            improvement_goals.append(f"Additional requirements: {additional_requirements}")
        
        system_message = """You are an expert assessment designer. Improve the provided question so that it is clearer, deeper, more technically accurate, and more assessable. Maintain the same domain, same conceptual scope, and same purpose. DO NOT generate a different topic. DO NOT change the domain. Produce 1 improved question only."""
        
        user_message = f"""Improve the following question while keeping the same topic and difficulty. It must be a better version of the previous question without repeating the same wording. DO NOT simplify it. Maintain the same question type.

Experience mode: {experience_mode}
Experience level: {experience_level}
Topic: {topic_name or "N/A"}
Difficulty: {difficulty}
Improvement goals: {', '.join(improvement_goals)}

Old question:
{old_question}

Output strictly in JSON format:
{{
    "question": "<new_question_text>",
    "options": [...],   // only for MCQ (exactly 4 options)
    "correctAnswer": "..." // only for MCQ (must match one of the options)
}}

For MCQ: Generate exactly 4 options and ensure correctAnswer matches one of them.
For Subjective: Generate a scenario-based question (3-5 sentences minimum).
For PseudoCode: Provide a scenario first, then ask for pseudocode.
For Coding: Generate a coding problem with clear description, examples, and constraints.
"""
        
        if experience_mode == "college":
            user_message += "\n\nCOLLEGE MODE RULES:\n- Beginner/intermediate academic level\n- Avoid enterprise/production terminology\n- Use small academic examples\n- Focus on conceptual understanding\n- NO job-role context\n"
        else:
            user_message += "\n\nCORPORATE MODE RULES:\n- Realistic, industry-driven scenarios\n- Include production workflows, optimization, best practices\n- Use professional terminology\n- Expect deeper critical thinking\n"
        
        try:
            client = _get_openai_client()
        except ValueError as exc:
            logger.error(f"OpenAI API key not configured: {exc}")
            raise HTTPException(status_code=500, detail="OpenAI API key not configured") from exc
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        result = _parse_json_response(content, "regenerated question JSON")
        
        if question_type == "MCQ":
            if not isinstance(result, dict) or "question" not in result or "options" not in result or "correctAnswer" not in result:
                raise HTTPException(status_code=500, detail="Invalid MCQ format returned")
            options = result["options"]
            if not isinstance(options, list) or len(options) != 4:
                raise HTTPException(status_code=500, detail="MCQ must have exactly 4 options")
            if result["correctAnswer"] not in options:
                raise HTTPException(status_code=500, detail="correctAnswer must match one of the options")
            return {
                "question": result["question"],
                "options": options,
                "correctAnswer": result["correctAnswer"],
            }
        else:
            if not isinstance(result, dict) or "question" not in result:
                raise HTTPException(status_code=500, detail="Invalid question format returned")
            return {
                "question": result["question"],
            }
            
    except Exception as exc:
        logger.error(f"Error regenerating question: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to regenerate question: {str(exc)}") from exc


async def _generate_subjective_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate") -> List[Dict[str, Any]]:
    """
    Generate Subjective questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - ONLY scenario-based, real-world, case-study style questions
    - Minimum 2-4 sentences
    - Requires reasoning, explanation, trade-offs, evaluation
    - NO: MCQ-like phrasing, "which of the following", one-liners
    - Should reflect real-world usage of the topic
    - Must be context-aware (topic, category, difficulty, experience mode)
    
    Difficulty Mapping:
    - EASY → simple but meaningful real-life context
    - MEDIUM → multi-step reasoning with explanation
    - HARD → deep design decisions, constraints, trade-offs
    """
    # Context-aware scenario generation based on experience mode
    if experience_mode == "college":
        context_guidance = """
        Scenarios should relate to:
        - Academic projects
        - Mini-projects
        - Lab tasks
        - Internships
        - Programming assignments
        """
    else:  # corporate
        context_guidance = """
        Scenarios should relate to:
        - Production systems
        - Debugging real issues
        - Business workflows
        - System design choices
        - Team collaboration
        - Customer-facing problems
        """
    
    # Difficulty-specific requirements
    difficulty_requirements = {
        "Easy": "Simple but meaningful real-life context. Short scenario, simple decision or explanation needed.",
        "Medium": "Multi-step scenario with constraints or trade-offs. Requires reasoning and explanation.",
        "Hard": "Complex real-world scenario with multiple stakeholders or constraints. Deep design decisions, trade-offs, and evaluation required."
    }
    
    difficulty_req = difficulty_requirements.get(difficulty, difficulty_requirements["Medium"])
    
    prompt = f"""You are an expert technical assessment writer. Generate {count} scenario-based subjective question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based, real-world, case-study style questions
2. Each question MUST be minimum 2-4 sentences
3. Questions MUST require reasoning, explanation, trade-offs, or evaluation
4. NO MCQ-like phrasing (no "which of the following", no multiple choice options)
5. NO one-liner questions
6. Questions should reflect real-world usage of the topic: {topic}
7. Difficulty level: {difficulty}
8. {difficulty_req}
9. Experience mode: {experience_mode}
10. {context_guidance}
11. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, contexts, stakeholders, and problem types. If generating multiple questions, ensure they cover different aspects or applications of the topic.

EXAMPLES OF GOOD QUESTIONS:
- "You are working on a production e-commerce system that processes thousands of orders per minute. During peak hours, you notice the database connection pool is exhausted, causing transaction failures. Describe your approach to diagnose and resolve this issue, considering both immediate fixes and long-term scalability."
- "A team is building a mobile app that needs to sync data across devices. They're debating between using a local-first architecture with eventual consistency versus a server-authoritative approach. Explain the trade-offs of each approach and recommend which one to use for a collaborative note-taking app."
- "You're tasked with refactoring a legacy codebase that has tight coupling between components. The current system works but is difficult to test and extend. Outline your strategy for refactoring while maintaining system stability and minimizing downtime."

EXAMPLES OF BAD QUESTIONS (DO NOT GENERATE THESE):
- "What is {topic}?" (too simple, definition-level)
- "Explain {topic}." (no scenario, no context)
- "Which of the following is true about {topic}?" (MCQ-like phrasing)
- "List the benefits of {topic}." (too trivial)

Output format (JSON array):
[
  {{
    "question": "<scenario-based question text, 2-4 sentences minimum>"
  }}
]

DO NOT include idealAnswer, expectedAnswer, or any answer fields.
Return ONLY a JSON array with question text."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in scenario-based technical questions. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Subjective questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "question" in q:
                question_text = q["question"].strip()
                # Ensure minimum length (at least 2 sentences)
                if len(question_text) > 50 and question_text.count('.') >= 1:
                    validated_questions.append({"question": question_text})
                else:
                    logger.warning(f"Generated subjective question too short or invalid, skipping: {question_text[:50]}...")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid subjective questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Subjective questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Subjective questions: {str(exc)}") from exc


async def _generate_pseudocode_questions(topic: str, difficulty: str, count: int) -> List[Dict[str, Any]]:
    """
    Generate Pseudocode questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - Generate a pseudocode-related question ONLY
    - Should require algorithmic thinking
    - Must be scenario-based, not trivial
    - DO NOT generate the answer
    - Answer will be evaluated by AI scoring model
    """
    prompt = f"""You are an expert technical assessor. Generate {count} pseudocode question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based pseudocode questions (not trivial syntax questions)
2. Questions MUST require algorithmic thinking and problem-solving
3. Difficulty level: {difficulty}
4. Questions should describe a real-world problem that requires algorithmic logic
5. Include sample input/output scenarios in the question text
6. The question should ask for pseudocode, not executable code
7. Avoid syntax tied to any specific programming language
8. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, problem types, and algorithmic approaches.

DO NOT include:
- expectedAnswer
- explanation
- idealAnswer
- Any answer fields

The question text should:
- Describe a scenario or problem
- Include sample input/output examples
- Ask the candidate to write pseudocode to solve it
- Be suitable for evaluation in an interview or assessment

Output format (JSON array):
[
  {{
    "questionText": "<scenario-based pseudocode question text with sample input/output>"
  }}
]

Example good question:
{{
  "questionText": "You are designing an algorithm for a ride-sharing app to match drivers with passengers. Given a list of available drivers (each with their current location coordinates) and a list of ride requests (each with pickup location coordinates), write pseudocode to match each request to the nearest available driver. Include sample input: drivers = [(10, 20), (15, 25), (5, 10)], requests = [(12, 22), (8, 15)]. Expected output: request 1 → driver 1, request 2 → driver 3."
}}

Return ONLY valid JSON. No markdown, no explanations, NO answer fields."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in algorithmic problems. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "PseudoCode questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "questionText" in q:
                question_text = q["questionText"].strip()
                # Remove any answer fields if present
                clean_question = {"questionText": question_text}
                validated_questions.append(clean_question)
            elif isinstance(q, dict) and "question" in q:
                # Handle alternative field name
                question_text = q["question"].strip()
                validated_questions.append({"questionText": question_text})
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid pseudocode questions out of {count} requested")
        
        return validated_questions[:count]
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error generating PseudoCode questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate PseudoCode questions: {str(exc)}") from exc


def _get_starter_code_template(language: str) -> str:
    """
    Get starter code template for a given language.
    
    Args:
        language: Programming language (python, java, cpp, c, javascript, typescript, go, ruby)
        
    Returns:
        Starter code template string
    """
    templates = {
        "python": """def solve():
    # Write your logic here
    pass""",
        "java": """public class Solution {
    public static void solve() {
        // Write your logic here
    }
    public static void main(String[] args) {
        // Do not modify this method
    }
}""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

void solve() {
    // Write your logic here
}

int main() {
    // Locked main function
    return 0;
}""",
        "c": """#include <stdio.h>

void solve() {
    // Write your logic here
}

int main() {
    // Do not modify main, input/output handled here
    return 0;
}""",
        "javascript": """function solve(input) {
    // Write your logic here
}""",
        "typescript": """function solve(input: string): string {
    // Write your logic here
}""",
        "go": """package main

import "fmt"

func solve() {
    // Write your logic here
}

func main() {
    // Do not modify this method
}""",
        "ruby": """def solve
    # Write your logic here
end""",
    }
    return templates.get(language.lower(), templates["python"])


def _get_judge0_language_id(language: str) -> int:
    """
    Get Judge0 language ID for a given language.
    
    Args:
        language: Programming language name
        
    Returns:
        Judge0 language ID
    """
    language_id_map = {
        "python": 71,      # Python 3
        "java": 62,        # Java
        "cpp": 54,         # C++ (GCC)
        "c": 50,           # C (GCC)
        "javascript": 63,  # Node.js
        "typescript": 74,  # TypeScript
        "go": 60,          # Go
        "ruby": 72,        # Ruby
    }
    return language_id_map.get(language.lower(), 71)  # Default to Python


async def _generate_coding_questions(topic: str, difficulty: str, count: int, can_use_judge0: bool, coding_language: str = "python") -> List[Dict[str, Any]]:
    """
    Generate Coding questions (Judge0-compatible) using DSA module architecture.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language for coding questions (python, java, cpp, c, javascript, typescript, go, ruby)
    
    Returns questions in DSA-compatible format with:
    - questionText (description + examples + constraints)
    - starterCode (for specified language)
    - visibleTestCases (public test cases)
    - hiddenTestCases (hidden test cases)
    - constraints
    - functionSignature
    - explanation (optional)
    - language (Judge0 language ID)
    """
    if not can_use_judge0:
        raise HTTPException(status_code=400, detail="Coding questions require canUseJudge0 to be true")
    
    # Normalize language
    coding_language = coding_language.lower()
    if coding_language not in ["python", "java", "cpp", "c", "javascript", "typescript", "go", "ruby"]:
        logger.warning(f"Unknown language '{coding_language}', defaulting to 'python'")
        coding_language = "python"
    
    # Use DSA module's AI generator if available
    if DSA_AVAILABLE and dsa_generate_question is not None:
        try:
            # Generate questions using DSA module (one at a time for count > 1)
            questions = []
            for i in range(count):
                # Map difficulty: Easy -> easy, Medium -> medium, Hard -> hard
                dsa_difficulty = difficulty.lower()
                
                # Generate using DSA module with the specified language
                dsa_question = await dsa_generate_question(
                    difficulty=dsa_difficulty,
                    topic=topic,
                    concepts=None,
                    languages=[coding_language]  # Use the specified language
                )
                
                # Transform DSA format to assessment format
                # DSA format has: title, description, examples, constraints, public_testcases, hidden_testcases, starter_code, function_signature
                # Assessment format needs: questionText, starterCode, visibleTestCases, hiddenTestCases, constraints, functionSignature, explanation
                
                # Build questionText from description + examples
                question_text = dsa_question.get("description", "")
                
                # Add examples if available
                examples = dsa_question.get("examples", [])
                if examples:
                    question_text += "\n\nExamples:\n"
                    for idx, ex in enumerate(examples, 1):
                        question_text += f"\nExample {idx}:\n"
                        question_text += f"Input: {ex.get('input', '')}\n"
                        question_text += f"Output: {ex.get('output', '')}\n"
                        if ex.get("explanation"):
                            question_text += f"Explanation: {ex.get('explanation')}\n"
                
                # Get starter code for the specified language
                starter_code_dict = dsa_question.get("starter_code", {})
                starter_code = starter_code_dict.get(coding_language) if starter_code_dict else ""
                # Fallback to template if DSA didn't provide starter code for this language
                if not starter_code:
                    starter_code = _get_starter_code_template(coding_language)
                
                # Transform test cases
                visible_testcases = []
                for tc in dsa_question.get("public_testcases", []):
                    visible_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                hidden_testcases = []
                for tc in dsa_question.get("hidden_testcases", []):
                    hidden_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                # Get constraints
                constraints_list = dsa_question.get("constraints", [])
                constraints_text = "\n".join(f"- {c}" for c in constraints_list) if constraints_list else ""
                
                # Get function signature
                func_sig = dsa_question.get("function_signature", {})
                
                # Build assessment question object
                assessment_question = {
                    "questionText": question_text,
                    "starterCode": starter_code,
                    "visibleTestCases": visible_testcases,
                    "hiddenTestCases": hidden_testcases,
                    "constraints": constraints_text,
                    "functionSignature": func_sig,
                    "difficulty": difficulty,
                    "explanation": f"This problem tests understanding of {topic} at {difficulty} level.",
                    "language": str(_get_judge0_language_id(coding_language)),  # Store Judge0 language ID
                    "codingLanguage": coding_language,  # Store language name for frontend
                }
                
                questions.append(assessment_question)
            
            return questions
            
        except Exception as dsa_exc:
            logger.warning(f"DSA module generation failed, falling back to basic generation: {dsa_exc}")
            # Fall through to basic generation
    
    # Fallback: Basic generation if DSA module not available or failed
    starter_template = _get_starter_code_template(coding_language)
    prompt = f"""Generate {count} fully Judge0-compatible coding questions for: {topic}.

Difficulty: {difficulty}
Programming Language: {coding_language.upper()}

CRITICAL REQUIREMENTS:
1. You MUST generate the starter code and solution template in {coding_language.upper()}.
2. NEVER produce Python code unless language=python.
3. The template must follow standard function-signature patterns of {coding_language.upper()}.
4. Use the {coding_language.upper()} starter code template provided below.
5. DO NOT generate the final solution or answer code - only starter code with function signature
6. The system will evaluate using Judge0 test cases

Starter Code Template for {coding_language.upper()}:
{starter_template}

Each question must include:
- questionText (problem description with examples, constraints, and input/output format)
- starterCode ({coding_language.upper()} starter code with function signature matching the template above - incomplete, candidate must fill in logic)
- visibleTestCases (2-3 public test cases with input/output)
- hiddenTestCases (3-5 hidden test cases with input/output)
- constraints (list of constraints as string)
- functionSignature (name, parameters, return_type - must match {coding_language.upper()} syntax)

DO NOT include:
- solution
- answer
- complete implementation
- final code

Return ONLY a JSON array. Example format for {coding_language.upper()}:
[
  {{
    "questionText": "Problem description with examples, constraints, and input/output format...",
    "starterCode": "{starter_template.replace(chr(10), '\\n').replace('"', '\\"')}",
    "visibleTestCases": [
      {{"input": "5", "output": "10"}},
      {{"input": "10", "output": "20"}}
    ],
    "hiddenTestCases": [
      {{"input": "1", "output": "2"}},
      {{"input": "100", "output": "200"}}
    ],
    "constraints": "1 <= n <= 10^5",
    "functionSignature": {{
      "name": "solve",
      "parameters": [],
      "return_type": "void"
    }}
  }}
]

IMPORTANT: 
- All starter code MUST be in {coding_language.upper()}, NOT Python (unless language=python)
- Starter code should be incomplete - candidate must implement the logic
- DO NOT provide the solution or answer

Return ONLY valid JSON. No markdown, no explanations, NO solution code."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in coding problems. Always return valid JSON arrays. Never include markdown code blocks."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Coding questions JSON")
        
        # Ensure all questions have language information and remove any solution/answer fields
        validated_questions = []
        for question in questions:
            if not isinstance(question, dict):
                continue
            
            # Remove any solution/answer fields
            clean_question = {k: v for k, v in question.items() 
                            if k not in ["solution", "answer", "completeCode", "finalCode", "implementation"]}
            
            # Ensure required fields
            if not clean_question.get("language"):
                clean_question["language"] = str(_get_judge0_language_id(coding_language))
            if not clean_question.get("codingLanguage"):
                clean_question["codingLanguage"] = coding_language
            # Ensure starter code is in the correct language (fallback to template if missing)
            if not clean_question.get("starterCode"):
                clean_question["starterCode"] = _get_starter_code_template(coding_language)
            
            # Validate required fields
            if clean_question.get("questionText") and clean_question.get("starterCode"):
                validated_questions.append(clean_question)
            else:
                logger.warning(f"Coding question missing required fields, skipping")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid coding questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Coding questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Coding questions: {str(exc)}") from exc


async def _is_technical_topic_ai(topic: str) -> bool:
    """
    Detect if a topic is technical/programming-related using OpenAI's models.
    Uses gpt-4o-mini (same as other functionality) for consistency.
    
    Returns True if the topic appears to be technical, False otherwise.
    """
    # Ultra-concise prompt to minimize token usage
    prompt = f"""Is '{topic}' a technical/programming topic? (programming languages, frameworks, software engineering, coding, APIs, databases, etc.)
Respond ONLY in JSON:
{{"isTechnical": true/false}}
"""
    
    models = ["gpt-4o-mini"]  # Same model as other functionality
    
    for model in models:
        try:
            client = _get_openai_client()
            api_params = _build_openai_payload(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a topic classifier. Return only JSON with isTechnical field."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                top_p=0.1,
                max_tokens=10,  # Very small for boolean response
            )
            
            logger.debug(f"Payload for model {model}: {api_params}")
            response = await client.chat.completions.create(**api_params)
            
            content = response.choices[0].message.content.strip()
            
            # Parse JSON response
            try:
                # Remove markdown code blocks if present
                if content.startswith("```"):
                    parts = content.split("```")
                    if len(parts) > 1:
                        content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                        if content.startswith("json"):
                            content = content[4:]
                        content = content.strip()
                
                result = json.loads(content)
                return result.get("isTechnical", False)
                    
            except json.JSONDecodeError as json_err:
                logger.warning(f"Failed to parse JSON from {model}: {json_err}. Content: {content}")
                # Retry with next model if JSON is malformed
                if model == models[0]:  # Only retry once on first model
                    continue
                # If retry also fails, default to False (allow topic, let backend validation catch it)
                return False
                
        except (APIError, APIConnectionError, AuthenticationError, RateLimitError) as api_err:
            logger.warning(f"API error with {model}: {api_err}. Trying fallback...")
            # Continue to next model (fallback)
            if model == models[-1]:  # Last model failed
                logger.error(f"All models failed for technical topic check: {api_err}")
                return False  # Default to False on complete failure
            continue
            
        except Exception as exc:
            logger.error(f"Unexpected error with {model}: {exc}", exc_info=True)
            # Try fallback model
            if model == models[-1]:  # Last model failed
                return False  # Default to False on complete failure
            continue
    
    # Should not reach here, but return False if it does
    return False


async def ai_topic_suggestion(category: str, user_input: str) -> Dict[str, Any]:
    """
    AI-powered topic validation and suggestions.
    
    Validates if the user input is relevant to the selected category and provides suggestions.
    Uses AI to determine relevance based on meaning, not keywords.
    
    Args:
        category: The category ("aptitude" | "communication" | "logical")
        user_input: The user's typed input
        
    Returns:
        {
            "isValid": bool,
            "reason": str,  # Explanation if invalid, or empty if valid
            "suggestions": List[str]  # Up to 5 relevant topic suggestions
        }
    """
    if not user_input or not user_input.strip():
        return {
            "isValid": False,
            "reason": "Input cannot be empty",
            "suggestions": []
        }
    
    category_lower = category.lower()
    if category_lower not in ["aptitude", "communication", "logical"]:
        return {
            "isValid": False,
            "reason": "Invalid category",
            "suggestions": []
        }
    
    # Map category to display name
    category_map = {
        "aptitude": "aptitude (mathematical, quantitative, problem-solving)",
        "communication": "communication (verbal, grammar, writing, language skills)",
        "logical": "logical reasoning (puzzles, patterns, deduction, analytical thinking)"
    }
    category_display = category_map.get(category_lower, category_lower)
    
    prompt = f"""Analyze the topic input: "{user_input}"

Category: {category_display}

Tasks:
1. Determine if this topic is relevant to {category_display}. 
   - REJECT if it's about programming, coding, software development, technical skills (Java, Python, SQL, React, Node, Spring, ML, DSA, APIs, databases, etc.)
   - ACCEPT if it's about {category_display} skills

2. If valid, suggest up to 5 relevant topic names for {category_display} that are similar or related.

Respond ONLY in JSON format:
{{
    "isValid": true/false,
    "reason": "Brief explanation (empty string if valid)",
    "suggestions": ["suggestion1", "suggestion2", ...] (max 5, empty array if invalid)
}}
"""
    
    try:
        client = _get_openai_client()
        api_params = _build_openai_payload(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert topic classifier. Analyze topics and provide validation and suggestions. Always return valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=300,
        )
        
        response = await client.chat.completions.create(**api_params)
        content = response.choices[0].message.content.strip()
        
        # Parse JSON response
        try:
            # Remove markdown code blocks if present
            if content.startswith("```"):
                parts = content.split("```")
                if len(parts) > 1:
                    content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                    if content.startswith("json"):
                        content = content[4:]
                    content = content.strip()
            
            result = json.loads(content)
            
            # Validate and sanitize response
            is_valid = result.get("isValid", False)
            reason = result.get("reason", "")
            suggestions = result.get("suggestions", [])
            
            # Ensure suggestions is a list and limit to 5
            if not isinstance(suggestions, list):
                suggestions = []
            suggestions = [s for s in suggestions[:5] if s and isinstance(s, str) and s.strip()]
            
            return {
                "isValid": bool(is_valid),
                "reason": str(reason) if reason else "",
                "suggestions": suggestions
            }
            
        except json.JSONDecodeError as json_err:
            logger.warning(f"Failed to parse JSON from AI topic suggestion: {json_err}. Content: {content}")
            # Fallback: check if input is technical
            is_technical = await _is_technical_topic_ai(user_input)
            if is_technical:
                return {
                    "isValid": False,
                    "reason": "This topic appears to be technical. Only soft-skill topics are allowed in this category.",
                    "suggestions": []
                }
            # If not technical, assume valid but no suggestions
            return {
                "isValid": True,
                "reason": "",
                "suggestions": []
            }
            
    except Exception as exc:
        logger.error(f"Error in AI topic suggestion: {exc}", exc_info=True)
        # Fallback: check if input is technical
        try:
            is_technical = await _is_technical_topic_ai(user_input)
            if is_technical:
                return {
                    "isValid": False,
                    "reason": "This topic appears to be technical. Only soft-skill topics are allowed in this category.",
                    "suggestions": []
                }
        except:
            pass
        
        # Default to valid on error to allow user to proceed
        return {
            "isValid": True,
            "reason": "",
            "suggestions": []
        }


def _is_technical_topic(topic: str) -> bool:
    """
    Detect if a topic is technical/programming-related (synchronous fallback).
    This is kept for backward compatibility but should use _is_technical_topic_ai for better accuracy.
    """
    topic_lower = topic.lower()
    
    # Technical keywords that should be blocked
    technical_keywords = [
        # Programming languages
        "java", "python", "javascript", "typescript", "c++", "c#", "cpp", "c ", "go ", "rust", "ruby", "php", "swift", "kotlin", "scala", "r ",
        # Frameworks and libraries
        "react", "angular", "vue", "node", "express", "django", "flask", "spring", "laravel", "rails", ".net",
        # Databases
        "sql", "mysql", "postgresql", "mongodb", "redis", "oracle", "database", "db ",
        # Technical concepts
        "api", "rest", "graphql", "microservice", "docker", "kubernetes", "aws", "azure", "gcp", "cloud",
        "algorithm", "data structure", "dsa", "leetcode", "coding", "programming", "software engineering",
        "system design", "architecture", "devops", "ci/cd", "git", "github", "gitlab",
        # Technical terms
        "function", "class", "object", "variable", "array", "list", "hash", "tree", "graph", "stack", "queue",
        "oop", "mvc", "mvp", "mvvm", "design pattern", "refactoring", "testing", "unit test", "integration test",
        "frontend", "backend", "full stack", "web development", "mobile development"
    ]
    
    # Check if topic contains any technical keywords
    for keyword in technical_keywords:
        if keyword in topic_lower:
            return True
    
    # Check if topic is a single programming language name
    programming_languages = ["java", "python", "javascript", "typescript", "c", "cpp", "c++", "go", "rust", "ruby", "php", "swift", "kotlin", "scala", "r"]
    if topic_lower.strip() in programming_languages:
        return True
    
    return False


async def validate_topic_category(topic: str, category: str) -> Dict[str, Any]:
    """
    Validate if a custom topic belongs to the selected non-technical category using OpenAI's models.
    
    Uses gpt-4o-mini (same as other functionality) for consistency.
    
    Args:
        topic: The custom topic entered by the user
        category: The selected category ("aptitude" | "communication" | "logical_reasoning")
    
    Returns:
        {
            "valid": bool,
            "error": Optional[str]  # Error message if validation fails
        }
    """
    # Normalize category
    category_lower = category.lower()
    if category_lower not in ["aptitude", "communication", "logical_reasoning"]:
        return {
            "valid": False,
            "error": "Invalid category. Must be one of: aptitude, communication, logical_reasoning"
        }
    
    # FIRST: Check if topic is technical - reject immediately if so (using AI)
    is_technical = await _is_technical_topic_ai(topic)
    if is_technical:
        return {
            "valid": False,
            "error": "This topic appears to be technical. Only soft-skill topics are allowed in this category."
        }
    
    # Map category to display name for prompt
    category_map = {
        "aptitude": "aptitude",
        "communication": "communication",
        "logical_reasoning": "logical reasoning"
    }
    category_display = category_map.get(category_lower, category_lower)
    
    # Ultra-concise prompt to minimize token usage
    prompt = f"""Check if the topic '{topic}' belongs to category '{category_display}'.
Categories:
aptitude = math/quant/problem solving (NO programming/coding)
communication = verbal/grammar/writing (NO technical topics)
logical = puzzles/patterns/deduction (NO coding/algorithms)
CRITICAL: Reject if topic is about programming, coding, software, or technology.
Respond ONLY in JSON:
{{"valid": true/false}}
"""
    
    models = ["gpt-4o-mini"]  # Same model as other functionality
    
    for model in models:
        try:
            client = _get_openai_client()
            api_params = _build_openai_payload(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a topic classifier. Return only JSON with valid field."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                top_p=0.1,
                frequency_penalty=0,
                presence_penalty=0,
                max_tokens=20,  # Extremely small for classification
            )
            
            logger.debug(f"Payload for model {model}: {api_params}")
            response = await client.chat.completions.create(**api_params)
            
            content = response.choices[0].message.content.strip()
            
            # Parse JSON response
            try:
                # Remove markdown code blocks if present
                if content.startswith("```"):
                    parts = content.split("```")
                    if len(parts) > 1:
                        content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                        if content.startswith("json"):
                            content = content[4:]
                        content = content.strip()
                
                result = json.loads(content)
                is_valid = result.get("valid", False)
                
                if is_valid:
                    return {"valid": True, "error": None}
                else:
                    return {
                        "valid": False,
                        "error": "❌ The entered topic does not match the selected category. Please enter a valid topic."
                    }
                    
            except json.JSONDecodeError as json_err:
                logger.warning(f"Failed to parse JSON from {model}: {json_err}. Content: {content}")
                # Retry once automatically if JSON is malformed
                if model == models[0]:  # Only retry once on first model
                    continue
                # If retry also fails, treat as invalid
                return {
                    "valid": False,
                    "error": "Unable to validate topic. Please try again."
                }
                
        except (APIError, APIConnectionError, AuthenticationError, RateLimitError) as api_err:
            logger.warning(f"API error with {model}: {api_err}. Trying fallback...")
            # Continue to next model (fallback)
            if model == models[-1]:  # Last model failed
                logger.error(f"All models failed for topic validation: {api_err}")
                return {
                    "valid": False,
                    "error": "Unable to validate topic. Please try again."
                }
            continue
            
        except Exception as exc:
            logger.error(f"Unexpected error with {model}: {exc}", exc_info=True)
            # Try fallback model
            if model == models[-1]:  # Last model failed
                return {
                    "valid": False,
                    "error": "Unable to validate topic. Please try again."
                }
            continue
    
    # Should not reach here, but return invalid if it does
    return {
        "valid": False,
        "error": "Unable to validate topic. Please try again."
    }


