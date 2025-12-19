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
    # TODO: Move implementation from topic_service_v2.py line 1576
    pass



