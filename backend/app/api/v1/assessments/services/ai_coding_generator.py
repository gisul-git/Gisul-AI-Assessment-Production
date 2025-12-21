"""
Module: ai_coding_generator.py
Purpose: Coding question generation with DSA module integration

This module generates coding questions that are compatible with Judge0.
It integrates with the DSA module for high-quality question generation,
with fallback to basic OpenAI generation if DSA module is unavailable.

Dependencies:
- External: openai (for fallback generation)
- Internal: ai_utils (for OpenAI client, JSON parsing)
- Internal: judge0_utils (for language mapping, starter code)
- External: DSA module (optional - dsa_generate_question)

Example usage:
    ```python
    from app.api.v1.assessments.services.ai_coding_generator import _generate_coding_questions
    
    questions = await _generate_coding_questions(
        topic="Binary Search",
        difficulty="Medium",
        count=1,
        can_use_judge0=True,
        coding_language="python"
    )
    ```

Note: DSA module integration is optional. If unavailable, falls back to basic generation.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

# DSA module integration (optional)
DSA_AVAILABLE = False
dsa_generate_question = None
generate_boilerplate = None

try:
    from ...dsa.services.ai_generator import generate_question as dsa_generate_question
    from ...dsa.services.code_wrapper import generate_boilerplate
    DSA_AVAILABLE = True
except (ImportError, ModuleNotFoundError) as e:
    logging.getLogger(__name__).warning(
        f"DSA module not available. Coding questions will use basic generation. Error: {e}"
    )

from .ai_utils import _get_openai_client, _parse_json_response
from .judge0_utils import (
    _get_judge0_language_id,
    _get_starter_code_template,
    _validate_and_fix_function_signature,
)

logger = logging.getLogger(__name__)


# ============================================================================
# CODING QUESTION GENERATION
# ============================================================================

async def _generate_coding_questions(
    topic: str,
    difficulty: str,
    count: int,
    can_use_judge0: bool,
    coding_language: str = "python",
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None,
    job_designation: Optional[str] = None,
    experience_min: Optional[int] = None,
    experience_max: Optional[int] = None,
    company_name: Optional[str] = None,
    assessment_requirements: Optional[str] = None,
    previous_question: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate Coding questions (Judge0-compatible) using DSA module architecture.
    Returns COMPLETE DSA-format questions with all test cases.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language (python, java, cpp, c, javascript, typescript, go, rust, kotlin, csharp)
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        job_designation: Job role for personalization
        experience_min: Minimum experience years
        experience_max: Maximum experience years
        company_name: Company name for personalization
        assessment_requirements: Global assessment requirements
        previous_question: For regeneration - avoid repeating
        
    Returns:
        List of COMPLETE coding question dictionaries with DSA format:
        - title: Problem title
        - description: Problem statement
        - examples: Array of {input, output, explanation}
        - constraints: Array of constraint strings
        - function_signature: {name, parameters, return_type}
        - stdin_format: Description of stdin format
        - public_testcases: Array of {input, is_hidden: false}
        - hidden_testcases: Array of {input, is_hidden: true}
        - starter_code: Object with language keys
        - reference_solution: Python reference solution
        - difficulty: Easy/Medium/Hard
        - type: "Coding"
        
    Raises:
        HTTPException: If can_use_judge0 is False or generation fails
    """
    logger.info(f"Generating {count} Coding question(s) for topic: {topic}, difficulty: {difficulty}, language: {coding_language}")
    
    if not can_use_judge0:
        raise HTTPException(
            status_code=400,
            detail="Coding questions require Judge0 support. Set can_use_judge0=True."
        )
    
    # Try DSA module first if available
    if DSA_AVAILABLE and dsa_generate_question is not None:
        try:
            logger.info("Using DSA module for coding question generation")
            questions = []
            for _ in range(count):
                # Generate question using DSA module
                question_data = await dsa_generate_question(
                    difficulty=difficulty.lower(),
                    topic=topic,
                    concepts=additional_requirements,
                    languages=[coding_language.lower()]
                )
                
                if question_data:
                    # ⭐ Return COMPLETE DSA format (no transformation)
                    # Keep ALL fields from DSA generator - this is what frontend expects!
                    question_data["type"] = "Coding"  # Add type field for frontend
                    question_data["difficulty"] = difficulty.capitalize()  # Normalize difficulty
                    
                    # Ensure test cases have is_hidden flag
                    if "public_testcases" in question_data:
                        for tc in question_data["public_testcases"]:
                            tc["is_hidden"] = False
                    
                    if "hidden_testcases" in question_data:
                        for tc in question_data["hidden_testcases"]:
                            tc["is_hidden"] = True
                    
                    questions.append(question_data)
            
            if questions:
                logger.info(f"Successfully generated {len(questions)} Coding questions using DSA module")
                return questions
            else:
                logger.warning("DSA module returned no questions, falling back to basic generation")
        except Exception as exc:
            logger.warning(f"DSA generator failed: {exc}. Falling back to basic generation")
    
    # Fallback: Basic coding question generation using OpenAI (matching DSA format)
    logger.info("Using basic Coding question generation (OpenAI) with DSA format")
    
    # Build personalization context
    context_parts = []
    if previous_question:
        context_parts.append(f"""🔥 REGENERATION: User is regenerating. OLD QUESTION: "{previous_question[:200]}..."
MUST generate COMPLETELY DIFFERENT question. DO NOT repeat similar concepts or phrasing.""")
    
    if assessment_requirements:
        context_parts.append(f"Assessment Requirements: {assessment_requirements}")
    if company_name:
        context_parts.append(f"Company: {company_name}")
    if job_designation:
        context_parts.append(f"Job Role: {job_designation}")
    
    personalization = "\n".join(context_parts) if context_parts else ""
    
    # Supported languages (10 Judge0 languages)
    all_supported_langs = ["python", "javascript", "typescript", "cpp", "java", "c", "go", "rust", "kotlin", "csharp"]
    
    prompt = f"""You are an expert coding problem generator. Generate a LeetCode-style coding question in JSON format.

Topic: {topic}
Difficulty: {difficulty}
Language for starter code: {coding_language}
{personalization}

⚠️ JUDGE0 PLATFORM REQUIREMENTS:
- stdin/stdout based execution ONLY
- NO external libraries/frameworks
- Algorithm/data structure problems only
- Standard library features only

Generate a JSON object with this EXACT structure (matching DSA module format):
{{
  "title": "Problem Title",
  "description": "Clear problem statement. NO examples, NO constraints here.",
  "examples": [
    {{
      "input": "nums = [2,7,11,15], target = 9",
      "output": "[0,1]",
      "explanation": "Because nums[0] + nums[1] == 9"
    }}
  ],
  "constraints": [
    "1 <= nums.length <= 10^4",
    "-10^9 <= nums[i] <= 10^9"
  ],
  "difficulty": "{difficulty.lower()}",
  "languages": {json.dumps(all_supported_langs)},
  "function_signature": {{
    "name": "functionName",
    "parameters": [
      {{"name": "nums", "type": "int[]"}},
      {{"name": "target", "type": "int"}}
    ],
    "return_type": "int[]"
  }},
  "stdin_format": "Line 1: N (array size)\\nLine 2: N space-separated integers (nums)\\nLine 3: target integer",
  "public_testcases": [
    {{"input": "4\\n2 7 11 15\\n9"}},
    {{"input": "3\\n3 2 4\\n6"}},
    {{"input": "2\\n3 3\\n6"}}
  ],
  "hidden_testcases": [
    {{"input": "1\\n5\\n5"}},
    {{"input": "2\\n-1 -2\\n-3"}},
    {{"input": "5\\n1 2 3 4 5\\n9"}}
  ],
  "starter_code": {{
    "python": "def functionName(nums, target):\\n    # Write your solution here\\n    pass",
    "{coding_language}": "starter code for {coding_language}"
  }},
  "reference_solution": "# Complete Python 3 program that reads stdin and prints output\\nimport sys\\n\\n# Read input\\n..."
}}

CRITICAL REQUIREMENTS:
1. EXAMPLES vs TESTCASES - COMPLETELY SEPARATE:
   - examples: Human-readable LeetCode style (e.g., "nums = [1,2,3]")
   - testcases: Raw stdin ONLY, NO variable names, NO JSON arrays

2. DO NOT include expected_output in testcases:
   - public_testcases: ONLY "input" field
   - hidden_testcases: ONLY "input" field

3. stdin_format: Describe your format in plain English

4. ALL testcases MUST follow EXACT same format

5. Generate at least 3 public_testcases and 3 hidden_testcases

6. starter_code: Generate for {coding_language} at minimum

7. reference_solution: Complete working Python 3 program

Return ONLY valid JSON, no markdown."""
    
    client = _get_openai_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            response_format={"type": "json_object"}
        )
    except Exception as exc:
        logger.error(f"OpenAI API error in _generate_coding_questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate Coding questions") from exc

    # Parse response
    content = response.choices[0].message.content.strip() if response.choices else ""
    data = _parse_json_response(content)
    
    # Handle response format - expecting single question object (DSA format)
    if isinstance(data, dict) and ("title" in data or "description" in data):
        # Single question object (expected format)
        question_data = data
    elif isinstance(data, dict) and "questions" in data:
        # Array wrapped in questions key
        questions_list = data["questions"]
        if questions_list and isinstance(questions_list, list):
            question_data = questions_list[0]
        else:
            raise HTTPException(status_code=500, detail="No valid questions in response")
    else:
        logger.error(f"Unexpected response format for Coding questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # ⭐ Return COMPLETE DSA format (no transformation!)
    # Validate and sanitize the question
    if not isinstance(question_data, dict):
        raise HTTPException(status_code=500, detail="Invalid question format")
    
    # Ensure required fields exist
    if "title" not in question_data:
        question_data["title"] = f"{topic} - Coding Challenge"
    if "description" not in question_data:
        raise HTTPException(status_code=500, detail="Question missing description")
    if "function_signature" not in question_data:
        question_data["function_signature"] = {
            "name": "solve",
            "parameters": [],
            "return_type": "int"
        }
    
    # Add type field
    question_data["type"] = "Coding"
    question_data["difficulty"] = difficulty.capitalize()
    
    # Ensure test cases have is_hidden flag
    if "public_testcases" not in question_data:
        question_data["public_testcases"] = []
    for tc in question_data["public_testcases"]:
        tc["is_hidden"] = False
        # Remove expected_output if present
        tc.pop("expected_output", None)
        tc.pop("output", None)
    
    if "hidden_testcases" not in question_data:
        question_data["hidden_testcases"] = []
    for tc in question_data["hidden_testcases"]:
        tc["is_hidden"] = True
        # Remove expected_output if present
        tc.pop("expected_output", None)
        tc.pop("output", None)
    
    # Ensure starter_code exists
    if "starter_code" not in question_data or not question_data["starter_code"]:
        question_data["starter_code"] = {}
    
    # Generate starter code for requested language if missing
    if coding_language not in question_data["starter_code"]:
        func_sig = question_data.get("function_signature", {})
        question_data["starter_code"][coding_language] = _get_starter_code_template(
            coding_language, func_sig
        )
    
    # Ensure other fields exist
    if "examples" not in question_data:
        question_data["examples"] = []
    if "constraints" not in question_data:
        question_data["constraints"] = []
    if "stdin_format" not in question_data:
        question_data["stdin_format"] = ""
    if "reference_solution" not in question_data:
        question_data["reference_solution"] = ""
    
    logger.info(f"Successfully generated Coding question using basic generation (DSA format)")
    logger.info(f"  - Title: {question_data.get('title')}")
    logger.info(f"  - Public testcases: {len(question_data.get('public_testcases', []))}")
    logger.info(f"  - Hidden testcases: {len(question_data.get('hidden_testcases', []))}")
    
    return [question_data]  # Return list with single question




