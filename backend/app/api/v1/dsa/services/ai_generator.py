"""
AI Question Generator - LANGUAGE AGNOSTIC

Generates coding questions using OpenAI.
Creates LeetCode-style questions with 3 parts:
1. Description - Problem statement
2. Examples - Input/Output examples with explanations
3. Constraints - Input limits and requirements

The admin specifies which languages to generate starter code for.
"""

import os
import json
import logging
from dotenv import load_dotenv
from typing import Dict, Any, List, Optional

from openai import OpenAI

load_dotenv()

logger = logging.getLogger("backend")


def _generate_default_starter_code(
    lang: str, 
    func_name: str, 
    params: List[Dict[str, str]], 
    return_type: str
) -> str:
    """
    Generate default starter code for a language if AI didn't provide it.
    
    Args:
        lang: Programming language
        func_name: Function name from signature
        params: List of parameter dicts with 'name' and 'type'
        return_type: Return type string
    
    Returns:
        Default starter code string
    """
    param_names = [p.get("name", f"param{i}") for i, p in enumerate(params)]
    
    templates = {
        "python": f'''def {func_name}({", ".join(param_names)}):
    # Write your solution here
    pass

# Read input and call function
if __name__ == "__main__":
    # TODO: Parse stdin and call {func_name}
    pass
''',
        "javascript": f'''function {func_name}({", ".join(param_names)}) {{
    // Write your solution here
}}

// Read input from stdin
const readline = require('readline');
const rl = readline.createInterface({{ input: process.stdin }});
const lines = [];
rl.on('line', (line) => lines.push(line));
rl.on('close', () => {{
    // TODO: Parse input and call {func_name}
}});
''',
        "typescript": f'''function {func_name}({", ".join(param_names)}): {return_type} {{
    // Write your solution here
}}

// Read input from stdin
const readline = require('readline');
const rl = readline.createInterface({{ input: process.stdin }});
const lines: string[] = [];
rl.on('line', (line: string) => lines.push(line));
rl.on('close', () => {{
    // TODO: Parse input and call {func_name}
}});
''',
        "cpp": f'''#include <iostream>
#include <vector>
#include <string>
using namespace std;

// Write your solution here
{"void" if return_type == "void" else return_type} {func_name}({", ".join(param_names)}) {{
    // TODO: Implement solution
}}

int main() {{
    // TODO: Read input and call {func_name}
    return 0;
}}
''',
        "java": f'''import java.util.*;

public class Solution {{
    public static {"void" if return_type == "void" else return_type} {func_name}({", ".join(param_names)}) {{
        // Write your solution here
    }}
    
    public static void main(String[] args) {{
        Scanner scanner = new Scanner(System.in);
        // TODO: Read input and call {func_name}
    }}
}}
''',
        "c": f'''#include <stdio.h>
#include <stdlib.h>

// Write your solution here
{"void" if return_type == "void" else "int"} {func_name}({", ".join(param_names) if param_names else "void"}) {{
    // TODO: Implement solution
}}

int main() {{
    // TODO: Read input and call {func_name}
    return 0;
}}
''',
        "go": f'''package main

import "fmt"

func {func_name}({", ".join(param_names)}) {{
    // Write your solution here
}}

func main() {{
    // TODO: Read input and call {func_name}
    fmt.Println()
}}
''',
        "rust": f'''use std::io::{{self, BufRead}};

fn {func_name}({", ".join(param_names)}) {{
    // Write your solution here
}}

fn main() {{
    let stdin = io::stdin();
    // TODO: Read input and call {func_name}
}}
''',
        "kotlin": f'''fun {func_name}({", ".join(param_names)}) {{
    // Write your solution here
}}

fun main() {{
    // TODO: Read input and call {func_name}
}}
''',
        "csharp": f'''using System;

class Solution {{
    static {"void" if return_type == "void" else return_type} {func_name}({", ".join(param_names)}) {{
        // Write your solution here
    }}
    
    static void Main() {{
        // TODO: Read input and call {func_name}
    }}
}}
'''
    }
    
    return templates.get(lang, f"// TODO: Write your {func_name} solution for {lang}")


async def generate_question(
    difficulty: str = "medium", 
    topic: Optional[str] = None,
    concepts: Optional[str] = None,
    languages: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Generate a complete coding question using OpenAI.
    
    Creates LeetCode-style question with:
    - description: Problem statement
    - examples: Input/Output examples with explanations
    - constraints: Input limits
    
    Args:
        difficulty: easy, medium, or hard
        topic: Main topic (e.g., "arrays", "dynamic programming")
        concepts: Specific concepts to cover (e.g., "two pointers, sliding window")
        languages: List of languages to generate starter code for (optional)
    
    Returns:
        Complete question JSON with all fields populated
    """
    # Default to all supported DSA languages if none specified
    if not languages:
        languages = ["python", "javascript", "typescript", "cpp", "java", "c", "go", "rust", "kotlin", "csharp"]
    
    languages_str = json.dumps(languages)
    
    # Build topic/concept prompt
    topic_prompt = ""
    if topic:
        topic_prompt += f"Topic: {topic}. "
    if concepts:
        topic_prompt += f"Concepts to cover: {concepts}. "
    
    prompt = f"""You are an expert coding problem generator. Generate a LeetCode-style coding question in JSON format.

{topic_prompt}Difficulty: {difficulty}
Languages to support: {languages_str}

=== STEP 1: DESIGN THE PROBLEM ===
First, design the problem with:
- A clear title and description
- Function signature with parameters and return type
- Constraints that define input limits

=== STEP 2: DETERMINE STDIN FORMAT (CRITICAL) ===
Based on your function_signature parameters, decide ONE concrete stdin input format.
This format MUST be used consistently across ALL testcases (public + hidden).

Format rules based on parameter types:
- int → single integer on one line
- int, int → two integers space-separated OR on separate lines
- int[] → first line: array size N, second line: N space-separated integers
- int[], int → first line: array size N, second line: N space-separated integers, third line: the single int
- int[], int[] → size1, arr1 elements, size2, arr2 elements (each on separate lines)
- string → single line string
- string[] → first line: count N, next N lines: one string each
- int[][] (matrix) → first line: rows cols, next rows lines: space-separated integers

=== STEP 3: GENERATE JSON ===
Generate a JSON object with this structure:
{{
    "title": "Problem Title",
    
    "description": "Clear problem statement. NO examples, NO constraints here.",
    
    "examples": [
        {{
            "input": "nums = [2,7,11,15], target = 9",
            "output": "[0,1]",
            "explanation": "Explanation of why this is the answer."
        }}
    ],
    
    "constraints": [
        "1 <= nums.length <= 10^4",
        "-10^9 <= nums[i] <= 10^9"
    ],
    
    "difficulty": "{difficulty}",
    "languages": {languages_str},
    
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
        {{"input": "<dynamically generated based on stdin_format>"}},
        {{"input": "<dynamically generated based on stdin_format>"}},
        {{"input": "<dynamically generated based on stdin_format>"}}
    ],
    
    "hidden_testcases": [
        {{"input": "<edge case: minimum input>"}},
        {{"input": "<edge case: maximum boundary>"}},
        {{"input": "<edge case: special values>"}}
    ],
    
    "starter_code": {{
        "<language>": "complete starter code with stdin parsing"
    }}
}}

=== CRITICAL REQUIREMENTS (NON-NEGOTIABLE) ===

1. EXAMPLES vs TESTCASES - COMPLETELY SEPARATE:
   - "examples": LeetCode-style, human-readable (e.g., "nums = [1,2,3], target = 5")
   - "testcases": Raw stdin values ONLY, NO variable names, NO JSON syntax

2. DO NOT INCLUDE expected_output IN ANY TESTCASE:
   - public_testcases: ONLY "input" field
   - hidden_testcases: ONLY "input" field
   - NO "expected_output", NO "output" field
   - This is NON-NEGOTIABLE.

3. stdin_format FIELD (REQUIRED):
   - Describe your chosen stdin format in plain English
   - Example: "Line 1: N (array size)\\nLine 2: N space-separated integers"
   - ALL testcases MUST follow this EXACT format

4. TESTCASE FORMAT CONSISTENCY:
   - Every testcase input MUST have the same number of lines
   - Every testcase input MUST follow the same structure
   - Use \\n for newlines within the input string
   - NEVER use JSON arrays like [1,2,3] - use space-separated values
   - NEVER use variable names like "nums=" - just raw values

5. MINIMUM TESTCASES:
   - At least 3 public_testcases (basic cases)
   - At least 3 hidden_testcases (edge cases)

6. HIDDEN TESTCASES MUST COVER:
   - Minimum valid input (single element, empty if allowed)
   - Maximum boundary values from constraints
   - Negative numbers (if applicable)
   - Edge cases (duplicates, sorted, all same values)

7. FUNCTION SIGNATURE:
   - "name": camelCase (e.g., "twoSum", "findMax")
   - "parameters": array of {{"name": "...", "type": "..."}}
   - "return_type": string (e.g., "int", "int[]", "boolean")

8. STARTER CODE:
   - Generate for ALL languages in the languages list
   - Include stdin parsing that matches your stdin_format
   - Use the function_signature

IMPORTANT: Return ONLY valid JSON. No markdown, no explanations."""

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system", 
                    "content": """You are an expert coding problem generator. Generate LeetCode-style coding questions.

CRITICAL RULES:
1. First define function_signature, then derive stdin_format from it
2. ALL testcases MUST use the EXACT same stdin format (same number of lines, same structure)
3. NEVER include expected_output in testcases - only "input" field
4. Testcases use raw stdin values only - NO JSON arrays, NO variable names
5. Examples are human-readable (LeetCode style), testcases are machine-readable (raw stdin)
6. Return valid JSON only - no markdown, no explanations"""
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        # Get content from response
        if not response.choices or not response.choices[0].message.content:
            raise ValueError("OpenAI API returned empty response")
        
        content = response.choices[0].message.content.strip()
        
        # Log raw content for debugging (first 500 chars)
        logger.info(f"Raw AI response (first 500 chars): {content[:500]}")
        
        if not content:
            raise ValueError("OpenAI API returned empty content")
        
        # Remove markdown code blocks if present
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        # Try to extract JSON if there's extra text
        # Look for JSON object boundaries
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        
        if json_start >= 0 and json_end > json_start:
            content = content[json_start:json_end]
        
        if not content:
            raise ValueError("No JSON content found in AI response")
        
        # Try to parse JSON
        try:
            question_data = json.loads(content)
        except json.JSONDecodeError as json_err:
            # Log the problematic content for debugging
            logger.error(f"Failed to parse JSON. Content length: {len(content)}")
            logger.error(f"Content preview: {content[:200]}...")
            logger.error(f"JSON error: {json_err}")
            raise ValueError(f"Failed to parse AI response as JSON: {json_err}. Content preview: {content[:200]}")
        
        # Validate required fields
        required_fields = ["title", "description", "difficulty", "languages", "public_testcases", "hidden_testcases", "starter_code", "function_signature"]
        for field in required_fields:
            if field not in question_data:
                # For function_signature, try to create a default one
                if field == "function_signature":
                    logger.warning("function_signature missing, creating default...")
                    title = question_data.get("title", "solve")
                    func_name = title.lower().replace(" ", "").replace("-", "")[:20] or "solve"
                    question_data["function_signature"] = {
                        "name": func_name,
                        "parameters": [],
                        "return_type": "int"
                    }
                    logger.info(f"Created default function_signature: {question_data['function_signature']}")
                else:
                    raise ValueError(f"Generated question missing required field: {field}")
        
        # Validate and fix function_signature structure
        if "function_signature" in question_data:
            func_sig = question_data["function_signature"]
            if not isinstance(func_sig, dict):
                raise ValueError("function_signature must be an object")
            
            # Try to fix missing fields before validation
            fixed = False
            if "name" not in func_sig:
                # Try to infer from title or use default
                title = question_data.get("title", "solve")
                func_sig["name"] = title.lower().replace(" ", "").replace("-", "")[:20] or "solve"
                fixed = True
                logger.warning(f"function_signature missing 'name', inferred: {func_sig['name']}")
            
            if "parameters" not in func_sig:
                func_sig["parameters"] = []
                fixed = True
                logger.warning("function_signature missing 'parameters', using empty array")
            elif not isinstance(func_sig["parameters"], list):
                logger.warning(f"function_signature.parameters is not an array, converting...")
                func_sig["parameters"] = []
                fixed = True
            
            if "return_type" not in func_sig:
                # Try to infer from description or use default
                func_sig["return_type"] = "int"  # Default return type
                fixed = True
                logger.warning("function_signature missing 'return_type', using default: 'int'")
            
            if fixed:
                logger.info(f"Fixed function_signature: {func_sig}")
            
            # Validate parameters structure if present
            if func_sig["parameters"]:
                for i, param in enumerate(func_sig["parameters"]):
                    if not isinstance(param, dict):
                        logger.warning(f"Parameter {i} is not an object, converting to object...")
                        func_sig["parameters"][i] = {"name": f"param{i+1}", "type": "int"}
                        continue
                    
                    # Fix missing name or type in parameter
                    if "name" not in param:
                        param["name"] = f"param{i+1}"
                        logger.warning(f"Parameter {i} missing 'name', using: {param['name']}")
                    if "type" not in param:
                        param["type"] = "int"  # Default type
                        logger.warning(f"Parameter {i} missing 'type', using: {param['type']}")
        
        # Ensure examples exist
        if "examples" not in question_data:
            question_data["examples"] = []
        
        # Ensure constraints exist
        if "constraints" not in question_data:
            question_data["constraints"] = []
        
        # === CRITICAL: Sanitize testcases - remove expected_output ===
        # The AI should NOT generate expected_output, but if it does, remove it
        # Expected outputs will be computed programmatically by running reference solution
        
        def sanitize_testcase(testcase: dict, is_hidden: bool) -> dict:
            """Sanitize a testcase: remove expected_output, ensure is_hidden is set."""
            # Remove expected_output if present (AI should not generate this)
            if "expected_output" in testcase:
                del testcase["expected_output"]
            
            # Also remove output if present (alternative key AI might use)
            if "output" in testcase:
                del testcase["output"]
            
            # Ensure is_hidden flag is correctly set
            testcase["is_hidden"] = is_hidden
            
            # Ensure input exists and is a string
            if "input" not in testcase:
                testcase["input"] = ""
            elif not isinstance(testcase["input"], str):
                testcase["input"] = str(testcase["input"])
            
            return testcase
        
        # Sanitize public testcases
        public_testcases = question_data.get("public_testcases", [])
        question_data["public_testcases"] = [
            sanitize_testcase(tc, is_hidden=False) 
            for tc in public_testcases if isinstance(tc, dict)
        ]
        
        # Sanitize hidden testcases
        hidden_testcases = question_data.get("hidden_testcases", [])
        question_data["hidden_testcases"] = [
            sanitize_testcase(tc, is_hidden=True) 
            for tc in hidden_testcases if isinstance(tc, dict)
        ]
        
        # Ensure minimum testcase count
        if len(question_data["public_testcases"]) < 3:
            logger.warning(f"Only {len(question_data['public_testcases'])} public testcases generated, expected at least 3")
        
        if len(question_data["hidden_testcases"]) < 3:
            logger.warning(f"Only {len(question_data['hidden_testcases'])} hidden testcases generated, expected at least 3")
        
        # === FORMAT CONSISTENCY VALIDATION ===
        # Check that all testcases use the same newline structure
        def get_line_count(input_str: str) -> int:
            """Count number of lines in a testcase input."""
            if not input_str:
                return 0
            return input_str.count('\n') + 1
        
        all_testcases = question_data["public_testcases"] + question_data["hidden_testcases"]
        if all_testcases:
            line_counts = [get_line_count(tc.get("input", "")) for tc in all_testcases]
            unique_counts = set(line_counts)
            
            if len(unique_counts) > 1:
                logger.warning(
                    f"Testcase format inconsistency detected: line counts vary {unique_counts}. "
                    f"All testcases should have the same structure."
                )
            
            # Log the stdin_format if provided by AI
            stdin_format = question_data.get("stdin_format")
            if stdin_format:
                logger.info(f"AI-specified stdin format: {stdin_format}")
        
        # Ensure starter_code has all requested languages
        if "starter_code" not in question_data:
            question_data["starter_code"] = {}
        
        # Generate default starter code for missing languages
        func_sig = question_data.get("function_signature", {})
        func_name = func_sig.get("name", "solve")
        params = func_sig.get("parameters", [])
        return_type = func_sig.get("return_type", "int")
        
        for lang in languages:
            if lang not in question_data["starter_code"] or not question_data["starter_code"][lang]:
                question_data["starter_code"][lang] = _generate_default_starter_code(
                    lang, func_name, params, return_type
                )
        
        return question_data
        
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse AI response as JSON: {e}")
    except Exception as e:
        raise Exception(f"OpenAI API error: {e}")
