"""
Module: ai_sql_generator.py
Purpose: SQL question generation with DSA SQL module integration

This module generates SQL questions with complete database schemas,
sample data, and test cases. It integrates with the DSA SQL module
for high-quality question generation.

Dependencies:
- External: openai (for fallback generation)
- Internal: ai_utils (for OpenAI client, JSON parsing)
- External: DSA SQL module (optional - dsa_generate_sql_question)

Example usage:
    ```python
    from app.api.v1.assessments.services.ai_sql_generator import _generate_sql_questions
    
    questions = await _generate_sql_questions(
        topic="JOIN Operations",
        difficulty="Medium",
        count=1,
        experience_mode="corporate"
    )
    ```

Note: DSA SQL module integration is optional. If unavailable, falls back to basic generation.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

# DSA SQL module integration (optional)
DSA_AVAILABLE = False
dsa_generate_sql_question = None

try:
    from ...dsa.services.ai_sql_generator import generate_sql_question as dsa_generate_sql_question
    DSA_AVAILABLE = True
except (ImportError, ModuleNotFoundError) as e:
    logging.getLogger(__name__).warning(
        f"DSA SQL module not available. SQL questions will use basic generation. Error: {e}"
    )

from .ai_utils import _get_openai_client, _parse_json_response

logger = logging.getLogger(__name__)


# ============================================================================
# SQL QUESTION GENERATION
# ============================================================================

async def _generate_sql_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate SQL questions using structured format from DSA SQL generator.
    
    Returns questions with schemas, sample_data, constraints, starter_query, etc.
    Similar to how coding questions use DSA generator.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        
    Returns:
        List of SQL question dictionaries with:
        - question/questionText (formatted with schema and sample data)
        - type: "SQL"
        - difficulty
        - sql_data: {
            - title, description, difficulty
            - schemas: {table_name: {columns: {...}}}
            - sample_data: {table_name: [rows]}
            - constraints: [...]
            - starter_query: "..."
            - hints: [...]
            - evaluation: {...}
          }
    """
    logger.info(f"Generating {count} SQL question(s) for topic: {topic}, difficulty: {difficulty}")
    
    # Try DSA SQL module first if available
    if DSA_AVAILABLE and dsa_generate_sql_question is not None:
        try:
            logger.info("Using DSA SQL module for question generation")
            questions = []
            for _ in range(count):
                question_data = await dsa_generate_sql_question(
                    topic=topic,
                    difficulty=difficulty,
                    experience_mode=experience_mode
                )
                if question_data:
                    questions.append(question_data)
            
            if questions:
                logger.info(f"Successfully generated {len(questions)} SQL questions using DSA module")
                return questions
            else:
                logger.warning("DSA SQL module returned no questions, falling back to basic generation")
        except Exception as exc:
            logger.warning(f"DSA SQL generator failed: {exc}. Falling back to basic generation")
    
    # Fallback: Basic SQL question generation using OpenAI
    logger.info("Using basic SQL question generation (OpenAI)")
    
    prompt = f"""You are an expert SQL assessment writer. Generate {count} SQL question(s) for the topic: {topic}.

Difficulty: {difficulty}
Experience Mode: {experience_mode}
{f"Additional Requirements: {additional_requirements}" if additional_requirements else ""}

REQUIREMENTS:
1. Each question must include:
   - Clear problem statement
   - Database schema (table names, columns, data types)
   - Sample data (at least 3-5 rows per table)
   - Expected query task
2. Question complexity should match {difficulty} level:
   - Easy: Single table SELECT with WHERE/ORDER BY
   - Medium: JOIN operations, GROUP BY, subqueries
   - Hard: Complex JOINs, window functions, CTEs, optimization
3. Make questions realistic and practical
4. Include sample data that demonstrates the expected result

Output format (JSON object with questions array):
{{
  "questions": [
    {{
      "question": "<Complete question text with schema and sample data>",
      "type": "SQL",
      "difficulty": "{difficulty}"
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
        logger.error(f"OpenAI API error in _generate_sql_questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate SQL questions") from exc

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
        logger.error(f"Unexpected response format for SQL questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Format questions
    result = []
    for q in questions_list[:count]:
        if isinstance(q, dict) and "question" in q:
            result.append({
                "question": q["question"],
                "type": "SQL",
                "difficulty": difficulty
            })
    
    if not result:
        raise HTTPException(status_code=500, detail="No valid SQL questions generated")
    
    logger.info(f"Successfully generated {len(result)} SQL questions using basic generation")
    return result



