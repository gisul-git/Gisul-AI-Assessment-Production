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
    # TODO: Move implementation from topic_service_v2.py line 2283
    pass




