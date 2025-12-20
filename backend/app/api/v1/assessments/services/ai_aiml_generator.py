"""
Module: ai_aiml_generator.py
Purpose: AIML question generation with AIML module integration

This module generates AI/ML questions with complete datasets (schema + rows),
tasks, constraints, and required libraries. It integrates with the AIML module
for high-quality question generation.

Dependencies:
- External: openai (for fallback generation)
- Internal: ai_utils (for OpenAI client, JSON parsing)
- External: AIML module (optional - aiml_generate_question)

Example usage:
    ```python
    from app.api.v1.assessments.services.ai_aiml_generator import _generate_aiml_questions
    
    questions = await _generate_aiml_questions(
        topic="Decision Tree Classifier",
        difficulty="Medium",
        count=1,
        experience_mode="corporate"
    )
    ```

Note: AIML module integration is optional. If unavailable, falls back to basic generation.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

# AIML module integration (optional)
AIML_AVAILABLE = False
aiml_generate_question = None

try:
    from ...aiml.services.ai_question_generator import generate_aiml_question as aiml_generate_question
    AIML_AVAILABLE = True
except (ImportError, ModuleNotFoundError) as e:
    logging.getLogger(__name__).warning(
        f"AIML module not available. AIML questions will use basic generation. Error: {e}"
    )

from .ai_utils import _get_openai_client, _parse_json_response

logger = logging.getLogger(__name__)


# ============================================================================
# AIML QUESTION GENERATION
# ============================================================================

async def _generate_aiml_questions(
    topic: str,
    difficulty: str,
    count: int,
    experience_mode: str = "corporate",
    additional_requirements: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate AIML (AI/ML + data science) questions using structured format from AIML generator.
    
    Returns questions with datasets (schema + rows), tasks, constraints, etc.
    Similar to how coding questions use DSA generator.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        experience_mode: Experience mode (corporate/college)
        additional_requirements: Optional additional requirements
        
    Returns:
        List of AIML question dictionaries with:
        - question/questionText (formatted with dataset schema and sample data)
        - type: "AIML"
        - difficulty
        - aiml_data: {
            - title, description, difficulty
            - skill, topic, libraries
            - type, execution_environment
            - tasks: [...]
            - constraints: [...]
            - dataset: {schema: [...], rows: [...]}
            - requires_dataset: bool
          }
    """
    logger.info(f"Generating {count} AIML question(s) for topic: {topic}, difficulty: {difficulty}")
    
    # Try AIML module first if available
    if AIML_AVAILABLE and aiml_generate_question is not None:
        try:
            logger.info("Using AIML module for question generation")
            questions = []
            for _ in range(count):
                question_data = await aiml_generate_question(
                    topic=topic,
                    difficulty=difficulty,
                    experience_mode=experience_mode
                )
                if question_data:
                    questions.append(question_data)
            
            if questions:
                logger.info(f"Successfully generated {len(questions)} AIML questions using AIML module")
                return questions
            else:
                logger.warning("AIML module returned no questions, falling back to basic generation")
        except Exception as exc:
            logger.warning(f"AIML generator failed: {exc}. Falling back to basic generation")
    
    # Fallback: Basic AIML question generation using OpenAI
    logger.info("Using basic AIML question generation (OpenAI)")
    
    prompt = f"""You are an expert AI/ML and Data Science assessment writer. Generate {count} AI/ML question(s) for the topic: {topic}.

Difficulty: {difficulty}
Experience Mode: {experience_mode}
{f"Additional Requirements: {additional_requirements}" if additional_requirements else ""}

REQUIREMENTS:
1. Each question must include:
   - Clear problem statement related to AI/ML or Data Science
   - Dataset schema (columns, data types) if applicable
   - Sample data rows (at least 5-10 rows) if applicable
   - Task description (what model/analysis to perform)
   - Expected approach or methodology
2. Question complexity should match {difficulty} level:
   - Easy: Basic data preprocessing, simple models (linear regression, decision tree)
   - Medium: Feature engineering, model comparison, hyperparameter tuning
   - Hard: Advanced models (ensemble, neural networks), optimization, production deployment
3. Include realistic scenarios and datasets
4. Specify required libraries (scikit-learn, pandas, numpy, etc.)
5. Make questions hands-on and practical

Output format (JSON object with questions array):
{{
  "questions": [
    {{
      "question": "<Complete question text with dataset schema, sample data, and task>",
      "type": "AIML",
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
        logger.error(f"OpenAI API error in _generate_aiml_questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate AIML questions") from exc

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
        logger.error(f"Unexpected response format for AIML questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Format questions
    result = []
    for q in questions_list[:count]:
        if isinstance(q, dict) and "question" in q:
            result.append({
                "question": q["question"],
                "type": "AIML",
                "difficulty": difficulty
            })
    
    if not result:
        raise HTTPException(status_code=500, detail="No valid AIML questions generated")
    
    logger.info(f"Successfully generated {len(result)} AIML questions using basic generation")
    return result



