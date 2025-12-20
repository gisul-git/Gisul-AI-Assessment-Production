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
    
    # Fallback: Comprehensive AIML question generation using OpenAI
    logger.info("Using comprehensive AIML question generation (OpenAI)")
    
    # Determine if dataset is required based on topic and difficulty
    topic_lower = topic.lower()
    requires_dataset = any(keyword in topic_lower for keyword in [
        "pandas", "data", "feature", "model", "training", "evaluation",
        "classification", "regression", "neural", "machine learning", "deep learning"
    ]) or difficulty.lower() in ["medium", "hard"]
    
    # Auto-select appropriate libraries
    libraries = ["Python"]
    if any(kw in topic_lower for kw in ["numpy", "array"]):
        libraries.append("NumPy")
    if any(kw in topic_lower for kw in ["pandas", "data"]):
        libraries.append("Pandas")
    if any(kw in topic_lower for kw in ["scikit", "sklearn", "machine learning"]):
        libraries.append("Scikit-learn")
    if any(kw in topic_lower for kw in ["tensorflow", "keras"]):
        libraries.append("TensorFlow")
    if "pytorch" in topic_lower:
        libraries.append("PyTorch")
    
    # Default libraries based on difficulty if none selected
    if len(libraries) == 1:  # Only Python
        if difficulty.lower() == "easy":
            libraries = ["Python", "NumPy"]
        elif difficulty.lower() == "medium":
            libraries = ["Python", "NumPy", "Pandas", "Scikit-learn"]
        else:  # hard
            libraries = ["Python", "NumPy", "Pandas", "Scikit-learn", "TensorFlow"]
    
    prompt = f"""You are an expert AI/ML and Data Science assessment writer for a Jupyter-style IDE platform.
Generate {count} comprehensive AIML question(s) for the topic: {topic}.

Difficulty: {difficulty}
Experience Mode: {experience_mode}
Required Libraries: {', '.join(libraries)}
Dataset Required: {"YES - MUST include dataset" if requires_dataset else "Optional"}
{f"Additional Requirements: {additional_requirements}" if additional_requirements else ""}

CRITICAL STRUCTURE REQUIREMENTS:
Each question MUST include:
1. **description**: 2-3 paragraph problem statement (NO examples, NO constraints)
2. **tasks**: Array of 3-5 specific tasks to complete
3. **constraints**: Array of 2-3 technical constraints
4. **libraries**: {libraries}
5. **dataset** (if required): {{
     "schema": [{{"name": "col", "type": "int|float|string|bool"}}],
     "rows": [EXACTLY 30 rows of data as arrays]
   }}

DIFFICULTY GUIDELINES:
- Easy: Basic operations, simple models (no dataset OR optional dataset)
- Medium: Feature engineering, ML models (dataset REQUIRED, 30 rows)
- Hard: End-to-end pipeline, deep learning (dataset REQUIRED, 30 rows)

DATASET RULES (if required):
- EXACTLY 30 rows (mandatory)
- 4-7 columns
- Include target/label column for ML tasks
- Realistic, meaningful data
- Dataset MUST be in structured format (schema + rows arrays)

QUESTION COMPLEXITY BY DIFFICULTY:
- Easy: {{"description": "...", "tasks": [...], "constraints": [...], "dataset": null}}
- Medium: {{"description": "...", "tasks": [...], "constraints": [...], "dataset": {{"schema": [...], "rows": [[...]]}}}}
- Hard: {{"description": "...", "tasks": [...], "constraints": [...], "dataset": {{"schema": [...], "rows": [[...]]}}}}

Output format (JSON object with questions array):
{{
  "questions": [
    {{
      "description": "2-3 paragraph problem statement explaining what needs to be done. NO examples here, NO constraints here.",
      "tasks": [
        "Task 1: Specific action to perform",
        "Task 2: Another specific action",
        "Task 3: Final action"
      ],
      "constraints": [
        "Constraint 1: Technical requirement",
        "Constraint 2: Another requirement"
      ],
      "libraries": {json.dumps(libraries)},
      "dataset": {{"schema": [{{"name": "column1", "type": "int"}}, ...], "rows": [[1, 2.5, ...], ...]}} OR null
    }}
  ]
}}

CRITICAL: 
- If dataset is included, it MUST have EXACTLY 30 rows
- Schema must have 4-7 columns
- Tasks must be actionable and specific
- Description must be 2-3 paragraphs
- NO markdown, NO code blocks, ONLY JSON

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
    elif isinstance(data, dict) and "description" in data:
        # Single question object (new format)
        questions_list = [data]
    elif isinstance(data, dict) and "question" in data:
        # Single question object (old format)
        questions_list = [data]
    else:
        logger.error(f"Unexpected response format for AIML questions: {data}")
        raise HTTPException(status_code=500, detail="Invalid response format from AI")
    
    # Format questions with comprehensive structure
    result = []
    for q in questions_list[:count]:
        if not isinstance(q, dict):
            continue
        
        # Build question text from components
        description = q.get("description", q.get("question", ""))
        tasks = q.get("tasks", [])
        constraints = q.get("constraints", [])
        dataset = q.get("dataset")
        question_libraries = q.get("libraries", libraries)
        
        # Validate dataset if present
        if dataset and isinstance(dataset, dict):
            schema = dataset.get("schema", [])
            rows = dataset.get("rows", [])
            
            # Validate row count
            if len(rows) != 30:
                logger.warning(f"Dataset has {len(rows)} rows, expected 30. Adjusting...")
                if len(rows) > 30:
                    dataset["rows"] = rows[:30]
                elif len(rows) > 0:
                    # Repeat last row to reach 30
                    last_row = rows[-1] if rows else []
                    while len(dataset["rows"]) < 30:
                        dataset["rows"].append(last_row.copy() if isinstance(last_row, list) else last_row)
            
            # Validate column count
            if len(schema) < 4 or len(schema) > 7:
                logger.warning(f"Dataset has {len(schema)} columns, expected 4-7")
        
        # Format complete question
        question_text = description
        
        if tasks:
            question_text += "\n\n**Tasks:**\n" + "\n".join(f"{i+1}. {task}" for i, task in enumerate(tasks))
        
        if constraints:
            question_text += "\n\n**Constraints:**\n" + "\n".join(f"- {constraint}" for constraint in constraints)
        
        if dataset:
            schema = dataset.get("schema", [])
            rows = dataset.get("rows", [])[:5]  # Show first 5 rows as sample
            
            question_text += "\n\n**Dataset Schema:**\n"
            question_text += "| " + " | ".join(col.get("name", "") for col in schema) + " |\n"
            question_text += "|" + "|".join("---" for _ in schema) + "|\n"
            
            question_text += "\n**Sample Data (first 5 rows):**\n"
            for row in rows:
                question_text += "| " + " | ".join(str(val) for val in row) + " |\n"
            
            question_text += f"\n*(Full dataset contains 30 rows)*"
        
        if question_libraries:
            question_text += f"\n\n**Required Libraries:** {', '.join(question_libraries)}"
        
        # Create question object
        question_obj = {
            "question": question_text,
            "type": "AIML",
            "difficulty": difficulty,
            "aiml_data": {
                "description": description,
                "tasks": tasks,
                "constraints": constraints,
                "libraries": question_libraries,
                "dataset": dataset,
                "requires_dataset": dataset is not None,
                "execution_environment": "jupyter_notebook"
            }
        }
        
        result.append(question_obj)
    
    if not result:
        raise HTTPException(status_code=500, detail="No valid AIML questions generated")
    
    logger.info(f"Successfully generated {len(result)} AIML questions with comprehensive structure")
    return result



