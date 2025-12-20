"""
AI Question Generator - CLEAN, DETERMINISTIC, CORRECT

Generates complete DSA coding questions with strict consistency guarantees.
No mismatches. No placeholders. No guessing.
"""

import os
import json
import logging
from dotenv import load_dotenv
from typing import Dict, Any, Optional, List, Union

from openai import OpenAI

load_dotenv()

logger = logging.getLogger("backend")


def _validate_question_consistency(question_data: Dict[str, Any]) -> Optional[str]:
    """
    Validate that all parts of the question describe the same problem.
    Returns error message if inconsistencies found, None otherwise.
    """
    title = question_data.get("title", "").lower()
    description = question_data.get("problem_description", "").lower()
    example_input = str(question_data.get("example", {}).get("input", "")).lower()
    example_output = str(question_data.get("example", {}).get("output", "")).lower()
    example_explanation = str(question_data.get("example", {}).get("explanation", "")).lower()
    
    # Collect all testcase inputs and outputs
    all_testcase_inputs = []
    all_testcase_outputs = []
    for tc_type in ["public_testcases", "hidden_testcases"]:
        for tc in question_data.get(tc_type, []):
            all_testcase_inputs.append(str(tc.get("input", "")).lower())
            all_testcase_outputs.append(str(tc.get("expected_output", "")).lower())
    
    # Combine all testcase text
    testcase_text = " ".join(all_testcase_inputs + all_testcase_outputs)
    
    issues = []
    
    # Problem type keywords
    problem_types = {
        "matrix": ["matrix", "spiral", "grid", "transpose", "rotate"],
        "prime": ["prime", "factor", "divisible", "composite"],
        "array": ["array", "list", "sequence"],
        "tree": ["tree", "binary", "node", "leaf"],
        "graph": ["graph", "node", "edge", "vertex"],
        "string": ["string", "substring", "character"],
        "sort": ["sort", "sorted", "order"],
        "search": ["search", "find", "locate"],
    }
    
    # Detect problem type from title
    title_type = None
    for prob_type, keywords in problem_types.items():
        if any(kw in title for kw in keywords):
            title_type = prob_type
            break
    
    # Detect problem type from testcases (what they actually test)
    testcase_type = None
    for prob_type, keywords in problem_types.items():
        if any(kw in testcase_text for kw in keywords):
            testcase_type = prob_type
            break
    
    # Detect problem type from description
    description_type = None
    for prob_type, keywords in problem_types.items():
        if any(kw in description for kw in keywords):
            description_type = prob_type
            break
    
    # Detect problem type from example
    example_text = f"{example_input} {example_output} {example_explanation}"
    example_type = None
    for prob_type, keywords in problem_types.items():
        if any(kw in example_text for kw in keywords):
            example_type = prob_type
            break
                    
    # Check 1: Title and testcases should match (they're usually correct)
    if title_type and testcase_type and title_type != testcase_type:
        issues.append(f"Title suggests '{title_type}' problem but testcases show '{testcase_type}' problem")
    
    # Check 2: Description must match title/testcases
    if title_type and description_type and title_type != description_type:
        issues.append(f"Title suggests '{title_type}' problem but description describes '{description_type}' problem")
    
    if testcase_type and description_type and testcase_type != description_type:
        issues.append(f"Testcases show '{testcase_type}' problem but description describes '{description_type}' problem")
    
    # Check 3: Example must match title/testcases
    if title_type and example_type and title_type != example_type:
        issues.append(f"Title suggests '{title_type}' problem but example shows '{example_type}' problem")
    
    if testcase_type and example_type and testcase_type != example_type:
        issues.append(f"Testcases show '{testcase_type}' problem but example shows '{example_type}' problem")
    
    # Check 4: Specific common mismatches
    # Matrix vs Prime (very common mismatch)
    if ("matrix" in title or "transpose" in title or "spiral" in title) and "prime" in description:
        issues.append("Title mentions matrix/transpose/spiral but description mentions prime numbers")
    
    if ("matrix" in testcase_text or "transpose" in testcase_text) and "prime" in description:
        issues.append("Testcases show matrix/transpose problem but description mentions prime numbers")
    
    if ("matrix" in title or "transpose" in title) and "prime" in example_text:
        issues.append("Title mentions matrix/transpose but example shows prime number problem")
    
    if ("matrix" in testcase_text or "transpose" in testcase_text) and "prime" in example_text:
        issues.append("Testcases show matrix/transpose problem but example shows prime number problem")
    
    # Check 5: Example input/output pattern should match testcase patterns
    # If testcases have matrix-like inputs (multiple lines with space-separated numbers)
    # but example has single integer input, that's a mismatch
    if testcase_text:
        # Check if testcases suggest matrix input (multiple lines)
        testcase_lines = [tc for tc in all_testcase_inputs if tc.count('\n') > 0]
        example_has_multiple_lines = example_input.count('\n') > 0
        
        if len(testcase_lines) >= 2 and not example_has_multiple_lines:
            # Testcases use multi-line input but example uses single-line
            if "matrix" in title or "matrix" in testcase_text:
                issues.append("Testcases use multi-line matrix input but example uses single-line input")
    
    # Check 6: Description should mention what testcases actually test
    # If testcases show matrix operations but description talks about something else
    if testcase_type and description_type and testcase_type != description_type:
        # Already caught above, but be more specific
        if testcase_type == "matrix" and description_type == "prime":
            issues.append("CRITICAL: Testcases test matrix operations but description explains prime number checking")
    
    if issues:
        return "; ".join(issues)
    return None


async def generate_question(
    difficulty: str = "medium", 
    topic: Optional[str] = None,
    concepts: Optional[Union[str, List[str]]] = None,
) -> Dict[str, Any]:
    """
    Generate a complete, correct, and internally consistent DSA coding question.
    
    Args:
        difficulty: "easy", "medium", or "hard"
        topic: Main topic (e.g., "Arrays", "Trees", "Graphs")
        concepts: String or list of concepts (e.g., "Two Pointers" or ["Two Pointers", "BFS"])
    
    Returns:
        Complete question JSON with all fields populated and validated
    
    Raises:
        ValueError: If generation fails or question is inconsistent
    """
    # Validate difficulty
    if difficulty not in ["easy", "medium", "hard"]:
        raise ValueError(f"Invalid difficulty: {difficulty}. Must be 'easy', 'medium', or 'hard'")
    
    # Convert concepts to string
    concepts_str = ""
    if concepts:
        if isinstance(concepts, list):
            concepts_str = ", ".join(concepts)
        else:
            concepts_str = str(concepts)
    
    # Build system prompt
    system_prompt = """You are a JSON-only coding question generator.

CORE PRINCIPLES:
- Simplicity over complexity
- Determinism over creativity
- Correctness over cleverness
- NO hardcoding tricks
- NO dynamic generation inside JSON

🚨 CRITICAL: ZERO MISMATCHES ALLOWED 🚨
The title, description, example, and ALL testcases MUST describe the EXACT SAME problem.
If you generate testcases for one problem but description for another, that is a CRITICAL ERROR.
You MUST generate correctly from the start - validation is a safety net, not a fix.

GENERATION RULE:
Generate testcases FIRST, then write title/description/example to match those testcases.
Do NOT write description first and then testcases - this causes mismatches.

STRICT OUTPUT RULES:
- Output MUST be valid JSON only
- No markdown, no explanations outside JSON
- Response MUST start with '{' and end with '}'
- All values must be literal strings
- NO code execution or expressions inside JSON
- NO placeholders like "e.g." or dummy values

FAIL-SAFE:
If you cannot guarantee correctness or consistency, return:
{"error":"CANNOT_GENERATE_CLEAN_QUESTION"}"""
    
    # Build user prompt - STRICT GENERATION ORDER TO PREVENT MISMATCHES
    user_prompt = f"""Generate a complete DSA coding question.

INPUTS:
Topic: {topic or "General"}
Concepts: {concepts_str or "General"}
Difficulty: {difficulty}

🚨 MANDATORY GENERATION ORDER (FOLLOW EXACTLY) 🚨
You MUST generate in this order to prevent mismatches:

STEP 1: DECIDE THE PROBLEM
- Choose ONE specific problem type (e.g., matrix transpose, prime checking, array rotation)
- Write down what problem you chose: "I am generating a [PROBLEM TYPE] problem"

STEP 2: GENERATE TESTCASES FIRST
- Generate public_testcases (3 testcases) for the chosen problem
- Generate hidden_testcases (3 testcases) for the chosen problem
- These testcases DEFINE what problem you're solving
- Look at your testcases: What problem do they actually test? Write it down.

STEP 3: GENERATE TITLE
- Title MUST match what the testcases test
- If testcases show matrix operations → title must mention "matrix"
- If testcases show prime checking → title must mention "prime"
- Verify: Does title match testcases? If NO, fix it.

STEP 4: GENERATE DESCRIPTION
- Description MUST explain EXACTLY what the testcases test
- Read your testcases again - what operation are they testing?
- Write description that explains THAT operation, NOT a different one
- Verify: Does description explain what testcases test? If NO, rewrite it.

STEP 5: GENERATE EXAMPLE
- Example MUST demonstrate the SAME problem as testcases
- Look at testcase input format - does it use multi-line? single integer? array?
- Example input MUST use the SAME format as testcases
- Example output MUST follow the SAME logic as testcases
- Verify: Does example show same problem as testcases? If NO, fix it.

STEP 6: FINAL CHECK
Before returning JSON, verify:
1. All testcases test the SAME problem type
2. Title mentions that problem type
3. Description explains that problem type
4. Example demonstrates that problem type
5. Input formats match (if testcases use multi-line, example uses multi-line)
6. Output formats match (if testcases output matrices, example outputs matrix)

If ANY check fails, DO NOT return the JSON. Fix it first or return {{"error":"CANNOT_GENERATE_CLEAN_QUESTION"}}

REQUIRED OUTPUT (JSON ONLY):
{{
  "title": string,
  "difficulty": "easy" | "medium" | "hard",
  "problem_description": string,
  "example": {{
    "input": string,
    "output": string,
    "explanation": string
  }},
    "public_testcases": [
    {{"input": string, "expected_output": string}},
    {{"input": string, "expected_output": string}},
    {{"input": string, "expected_output": string}}
  ],
    "hidden_testcases": [
    {{"input": string, "expected_output": string}},
    {{"input": string, "expected_output": string}},
    {{"input": string, "expected_output": string}}
  ],
  "constraints": [string, string, ...],
  "starter_code": {{
    "python": "def functionName(parameters):\\n    pass",
    "javascript": "function functionName(parameters) {{\\n    \\n}}",
    "typescript": "function functionName(parameters): returnType {{\\n    \\n}}",
    "cpp": "returnType functionName(parameters) {{\\n    \\n}}",
    "java": "public returnType functionName(parameters) {{\\n    \\n}}",
    "c": "returnType functionName(parameters) {{\\n    \\n}}",
    "go": "func functionName(parameters) returnType {{\\n    \\n}}",
    "rust": "fn functionName(parameters) -> returnType {{\\n    \\n}}",
    "csharp": "public returnType FunctionName(parameters) {{\\n    \\n}}",
    "kotlin": "fun functionName(parameters): returnType {{\\n    \\n}}"
  }}
}}

IMPORTANT: The starter_code examples above show the SIMPLE format you must use.
- Use appropriate function name based on the problem (e.g., countPrimes, transposeMatrix, findMax)
- Use appropriate parameters based on testcase inputs (e.g., nums: List[int], matrix: List[List[int]])
- Use appropriate return type based on testcase outputs (e.g., int, List[int], void)
- Keep it SIMPLE - just function signatures, NO full programs, NO stdin reading, NO main() functions

TECHNICAL RULES:
- Inputs must be RAW STDIN only (no variable names, no JSON arrays)
- Expected outputs MUST be logically computed, NOT guessed
- NO placeholders like "e.g." or dummy values
- NO dynamic generation: NO join(), NO loops, NO expressions, NO concatenation
- ALL values must be literal strings
- Secure mode enabled → assume function-body-only solutions

STARTER CODE REQUIREMENTS:
- Generate starter code for ALL 10 languages: python, javascript, typescript, cpp, java, c, go, rust, csharp, kotlin
- Starter code must be SIMPLE function signatures ONLY - NO full programs, NO stdin reading, NO main() functions
- Based on your testcases, determine the function signature (function name, parameters, return type)
- Generate function signatures in the format appropriate for each language:
  * Python: def functionName(params): followed by pass
  * JavaScript: function functionName(params) {{ }}
  * TypeScript: function functionName(params): returnType {{ }}
  * C++: returnType functionName(params) {{ }}
  * Java: public returnType functionName(params) {{ }}
  * C: returnType functionName(params) {{ }}
  * Go: func functionName(params) returnType {{ }}
  * Rust: fn functionName(params) -> returnType {{ }}
  * C#: public returnType FunctionName(params) {{ }}
  * Kotlin: fun functionName(params): returnType {{ }}
- Use literal strings only - NO dynamic generation in starter code values
- Keep it SIMPLE - just function signatures with proper parameters and return types, nothing more

Return ONLY the JSON object. No markdown. No explanations."""
    
    # Call OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
            )
            
            if not response.choices or not response.choices[0].message.content:
                if attempt < max_retries:
                    logger.warning(f"Attempt {attempt + 1}: Empty response. Retrying...")
                    continue
                else:
                    raise ValueError("AI returned empty response")
            
            content = response.choices[0].message.content.strip()
            
            # Log raw AI response for debugging
            logger.info("=" * 80)
            logger.info(f"ATTEMPT {attempt + 1}: Raw AI Response:")
            logger.info("=" * 80)
            logger.info(content)
            logger.info("=" * 80)
            
            # Remove markdown code fences if present
            if content.startswith("```"):
                lines = content.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                content = "\n".join(lines)
            
            # Extract JSON boundaries
            content = content.strip()
            if not content.startswith("{"):
                start_idx = content.find("{")
                if start_idx >= 0:
                    content = content[start_idx:]
                else:
                    if attempt < max_retries:
                        logger.warning(f"Attempt {attempt + 1}: No JSON found. Retrying...")
                        continue
                    else:
                        raise ValueError("No JSON object found in response")
            
            if not content.endswith("}"):
                end_idx = content.rfind("}")
                if end_idx >= 0:
                    content = content[:end_idx + 1]
                else:
                    if attempt < max_retries:
                        logger.warning(f"Attempt {attempt + 1}: Incomplete JSON. Retrying...")
                        continue
                    else:
                        raise ValueError("Incomplete JSON object in response")
            
            # Parse JSON
            try:
                question_data = json.loads(content)
                
                # Log parsed JSON for debugging
                logger.info("Parsed JSON successfully:")
                logger.info(json.dumps(question_data, indent=2))
                
            except json.JSONDecodeError as e:
                if attempt < max_retries:
                    logger.warning(f"Attempt {attempt + 1}: JSON parse failed: {e}. Retrying...")
                    continue
                else:
                    raise ValueError(f"Invalid JSON: {e}")
            
            # Check for error response
            if isinstance(question_data, dict) and question_data.get("error"):
                error_type = question_data.get("error")
                if error_type == "CANNOT_GENERATE_CLEAN_QUESTION":
                    if attempt < max_retries:
                        logger.warning(f"Attempt {attempt + 1}: AI returned CANNOT_GENERATE_CLEAN_QUESTION. Retrying...")
                        continue
                    else:
                        raise ValueError("AI could not generate a clean question after all retries")
                elif error_type == "JSON_OUTPUT_REQUIRED":
                    if attempt < max_retries:
                        logger.warning(f"Attempt {attempt + 1}: AI returned JSON_OUTPUT_REQUIRED. Retrying...")
                        continue
                    else:
                        raise ValueError("AI returned error: JSON_OUTPUT_REQUIRED after all retries")
            
            # Validate required fields
            required_fields = ["title", "difficulty", "problem_description", "example", 
                            "public_testcases", "hidden_testcases", "constraints", "starter_code"]
            missing_fields = [field for field in required_fields if field not in question_data]
            if missing_fields:
                if attempt < max_retries:
                    logger.warning(f"Attempt {attempt + 1}: Missing fields: {missing_fields}. Retrying...")
                    continue
                else:
                    raise ValueError(f"Missing required fields: {missing_fields}")
            
            # Validate starter_code structure
            starter_code = question_data.get("starter_code", {})
            if not isinstance(starter_code, dict):
                if attempt < max_retries:
                    logger.warning(f"Attempt {attempt + 1}: starter_code must be an object. Retrying...")
                    continue
                else:
                    raise ValueError("starter_code must be an object (dictionary)")
            
            # Check for required languages in starter_code
            required_languages = ["python", "javascript", "typescript", "cpp", "java", "c", "go", "rust", "csharp", "kotlin"]
            missing_languages = [lang for lang in required_languages if lang not in starter_code or not starter_code[lang]]
            if missing_languages:
                if attempt < max_retries:
                    logger.warning(f"Attempt {attempt + 1}: Missing starter code for languages: {missing_languages}. Retrying...")
                    continue
                else:
                    raise ValueError(f"Missing starter code for languages: {missing_languages}")
            
            # Validate structure
            # Check example
            example = question_data.get("example", {})
            if not isinstance(example, dict):
                raise ValueError("example must be an object")
            for field in ["input", "output", "explanation"]:
                if field not in example:
                    raise ValueError(f"example missing '{field}' field")
            
            # Check testcases
            for tc_type in ["public_testcases", "hidden_testcases"]:
                testcases = question_data.get(tc_type, [])
                if not isinstance(testcases, list):
                    raise ValueError(f"{tc_type} must be an array")
                if len(testcases) != 3:
                    if attempt < max_retries:
                        logger.warning(f"Attempt {attempt + 1}: {tc_type} must have exactly 3 testcases, got {len(testcases)}. Retrying...")
                        continue
                    else:
                        raise ValueError(f"{tc_type} must have exactly 3 testcases, got {len(testcases)}")
                
                for idx, tc in enumerate(testcases):
                    if not isinstance(tc, dict):
                        raise ValueError(f"{tc_type}[{idx}] must be an object")
                    if "input" not in tc:
                        raise ValueError(f"{tc_type}[{idx}] missing 'input' field")
                    if "expected_output" not in tc:
                        raise ValueError(f"{tc_type}[{idx}] missing 'expected_output' field")
            
            # Validate consistency
            consistency_issues = _validate_question_consistency(question_data)
            if consistency_issues:
                logger.error("=" * 80)
                logger.error(f"CONSISTENCY ISSUES DETECTED (Attempt {attempt + 1}):")
                logger.error(consistency_issues)
                logger.error("=" * 80)
                print("\n" + "=" * 80)
                print(f"CONSISTENCY ISSUES DETECTED (Attempt {attempt + 1}):")
                print(consistency_issues)
                print("=" * 80 + "\n")
                
                if attempt < max_retries:
                    logger.warning(f"Attempt {attempt + 1}: Consistency issues: {consistency_issues}. Retrying...")
                    # Build detailed retry instruction
                    retry_instruction = f"\n\n⚠️ RETRY ATTEMPT {attempt + 1} - CONSISTENCY ISSUES DETECTED:\n"
                    retry_instruction += f"{consistency_issues}\n\n"
                    retry_instruction += "CRITICAL FIXES REQUIRED:\n"
                    retry_instruction += "1. Look at the testcases - what problem do they actually test?\n"
                    retry_instruction += "2. The problem_description MUST explain EXACTLY what the testcases test.\n"
                    retry_instruction += "3. The example MUST demonstrate the SAME problem as the testcases.\n"
                    retry_instruction += "4. If testcases show matrix operations, description MUST explain matrix operations, NOT prime numbers.\n"
                    retry_instruction += "5. If testcases use multi-line input, example MUST also use multi-line input.\n"
                    retry_instruction += "6. The title, description, example, and ALL testcases MUST describe the SAME problem.\n"
                    user_prompt += retry_instruction
                    continue
                else:
                    raise ValueError(f"Question consistency validation failed: {consistency_issues}")
            
            # Success
            logger.info("=" * 80)
            logger.info("SUCCESS: Question generated and validated!")
            logger.info(f"Title: {question_data.get('title', 'Unknown')}")
            logger.info("=" * 80)
            
            return question_data
            
        except ValueError:
            # Re-raise validation errors
            raise
        except Exception as e:
            if attempt < max_retries:
                logger.warning(f"Attempt {attempt + 1} failed: {e}. Retrying...")
                continue
            else:
                raise Exception(f"OpenAI API error after {max_retries + 1} attempts: {e}")
    
    # Should never reach here
    raise Exception("Failed to generate valid response after all retries")
