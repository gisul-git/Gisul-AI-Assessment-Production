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
    additional_requirements: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate Coding questions (Judge0-compatible) using DSA module architecture.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language (python, java, cpp, c, javascript, typescript, go, ruby)
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        
    Returns:
        List of coding question dictionaries with:
        - questionText (description + examples + constraints)
        - starterCode (for specified language)
        - visibleTestCases (public test cases)
        - hiddenTestCases (hidden test cases)
        - constraints
        - functionSignature
        - explanation (optional)
        - language (Judge0 language ID)
        
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
                    # Extract the necessary fields
                    formatted_question = {
                        "questionText": question_data.get("description", ""),
                        "type": "Coding",
                        "difficulty": difficulty,
                        "language": coding_language,
                        "judge0_language_id": _get_judge0_language_id(coding_language),
                        "function_signature": question_data.get("function_signature", {}),
                        "examples": question_data.get("examples", []),
                        "constraints": question_data.get("constraints", []),
                        "starterCode": question_data.get("starter_code", {}).get(coding_language.lower(), ""),
                        "public_testcases": question_data.get("public_testcases", []),
                        "hidden_testcases": question_data.get("hidden_testcases", []),
                        "stdin_format": question_data.get("stdin_format", ""),
                        "reference_solution": question_data.get("reference_solution", "")
                    }
                    questions.append(formatted_question)
            
            if questions:
                logger.info(f"Successfully generated {len(questions)} Coding questions using DSA module")
                return questions
            else:
                logger.warning("DSA module returned no questions, falling back to basic generation")
        except Exception as exc:
            logger.warning(f"DSA generator failed: {exc}. Falling back to basic generation")
    
    # Fallback: Basic coding question generation using OpenAI
    logger.info("Using basic Coding question generation (OpenAI)")
    
    prompt = f"""You are an expert coding problem generator for Judge0 platform. Generate {count} coding question(s) for the topic: {topic}.

CRITICAL PLATFORM REQUIREMENTS:
- Platform: Judge0 (stdin/stdout based execution)
- Language: {coding_language}
- Difficulty: {difficulty}
- Experience Mode: {experience_mode}
{f"Additional Requirements: {additional_requirements}" if additional_requirements else ""}

⚠️ JUDGE0 COMPATIBILITY RULES (MANDATORY):
1. Questions MUST be executable via stdin/stdout
2. NO external libraries/frameworks (Django, Flask, React, TensorFlow, Pandas, etc.)
3. ONLY standard library features allowed
4. Algorithm/data structure problems (LeetCode-style)
5. Pure computational problems with clear input/output

VALID Judge0 Topics:
✅ Algorithms: sorting, searching, recursion, dynamic programming
✅ Data structures: arrays, lists, stacks, queues, trees, graphs
✅ String manipulation, math problems, bit manipulation
✅ Standard library usage (built-in functions, collections)

INVALID Topics (NOT Judge0-compatible):
❌ Web frameworks (Django, Flask, Express, Spring)
❌ Frontend frameworks (React, Angular, Vue)
❌ ML/Data libraries (TensorFlow, PyTorch, Pandas, NumPy)
❌ Database queries, API calls, file I/O operations
❌ GUI applications, network programming

REQUIREMENTS:
1. Each question must include:
   - Clear algorithmic problem statement (LeetCode-style)
   - Function signature with parameters and return type
   - Input/output examples with explanations
   - Constraints (input limits, time/space complexity)
   - Public test cases (3+) with ONLY stdin input
   - Hidden test cases (3+) with ONLY stdin input
   - Starter code for {coding_language}

2. Testcase format (stdin/stdout):
   - Use raw stdin format (e.g., "4\\n1 2 3 4\\n5")
   - NO variable names (e.g., "nums=")
   - NO JSON arrays (e.g., [1,2,3])
   - Just raw values matching stdin_format
   - Must be parseable from stdin

3. Question complexity should match {difficulty} level:
   - Easy: Basic algorithms, simple data structures (O(n) solutions)
   - Medium: Moderate algorithms, common patterns (two pointers, sliding window, O(n log n))
   - Hard: Complex algorithms, advanced data structures, optimization (O(n²) or better)

Output format (JSON object with questions array):
{{
  "questions": [
    {{
      "title": "Problem Title",
      "description": "Clear problem statement (NO examples here)",
      "examples": [
        {{
          "input": "nums = [1,2,3], target = 5",
          "output": "[0,1]",
          "explanation": "Why this is the answer"
        }}
      ],
      "constraints": [
        "1 <= n <= 10^4",
        "-10^9 <= nums[i] <= 10^9"
      ],
      "function_signature": {{
        "name": "functionName",
        "parameters": [{{"name": "nums", "type": "int[]"}}, {{"name": "target", "type": "int"}}],
        "return_type": "int[]"
      }},
      "stdin_format": "Line 1: N\\nLine 2: N space-separated integers\\nLine 3: target",
      "public_testcases": [
        {{"input": "4\\n1 2 3 4\\n5"}},
        {{"input": "5\\n2 7 11 15 9\\n9"}}
      ],
      "hidden_testcases": [
        {{"input": "1\\n5\\n5"}},
        {{"input": "2\\n-1 -2\\n-3"}}
      ],
      "starter_code": "def functionName(nums, target):\\n    # Write your solution here\\n    pass"
    }}
  ]
}}

CRITICAL: 
- DO NOT include expected_output in testcases
- Use consistent stdin format across all testcases
- Starter code should match the function_signature

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
        logger.error(f"OpenAI API error in _generate_coding_questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate Coding questions") from exc

    # Parse response
    content = response.choices[0].message.content.strip() if response.choices else ""
    data = _parse_json_response(content)
    
    # Handle response format
    if isinstance(data, dict) and "questions" in data:
        questions_list = data["questions"]
    elif isinstance(data, list):
        questions_list = data
    elif isinstance(data, dict) and ("title" in data or "description" in data):
        # Single question object
        questions_list = [data]
    else:
        logger.error(f"Unexpected response format for Coding questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Format questions
    result = []
    for q in questions_list[:count]:
        if not isinstance(q, dict):
            continue
        
        # Extract components
        title = q.get("title", "Coding Challenge")
        description = q.get("description", "")
        examples = q.get("examples", [])
        constraints = q.get("constraints", [])
        function_sig = q.get("function_signature", {})
        stdin_format = q.get("stdin_format", "")
        public_testcases = q.get("public_testcases", [])
        hidden_testcases = q.get("hidden_testcases", [])
        starter_code = q.get("starter_code", "")
        
        # Build formatted question text
        question_text = f"**{title}**\n\n{description}"
        
        if examples:
            question_text += "\n\n**Examples:**\n"
            for i, ex in enumerate(examples, 1):
                question_text += f"\nExample {i}:\n"
                question_text += f"Input: {ex.get('input', '')}\n"
                question_text += f"Output: {ex.get('output', '')}\n"
                if ex.get("explanation"):
                    question_text += f"Explanation: {ex.get('explanation')}\n"
        
        if constraints:
            question_text += "\n**Constraints:**\n"
            for constraint in constraints:
                question_text += f"- {constraint}\n"
        
        # Create question object
        question_obj = {
            "questionText": question_text,
            "type": "Coding",
            "difficulty": difficulty,
            "language": coding_language,
            "judge0_language_id": _get_judge0_language_id(coding_language),
            "function_signature": function_sig,
            "examples": examples,
            "constraints": constraints,
            "starterCode": starter_code or _get_starter_code_template(coding_language, function_sig),
            "public_testcases": public_testcases,
            "hidden_testcases": hidden_testcases,
            "stdin_format": stdin_format
        }
        
        result.append(question_obj)
    
    if not result:
        raise HTTPException(status_code=500, detail="No valid Coding questions generated")
    
    logger.info(f"Successfully generated {len(result)} Coding questions using basic generation")
    return result




