from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services.ai_generator import generate_question
from ..services.ai_sql_generator import generate_sql_question
from typing import Optional
from ..services.expected_output import compute_expected_outputs_from_code
from ..utils.judge0 import LANGUAGE_IDS

router = APIRouter(prefix="/api/v1/dsa/admin", tags=["dsa"])


class GenerateQuestionRequest(BaseModel):
    difficulty: str = "medium"
    topic: Optional[str] = None
    concepts: Optional[str] = None


class GenerateSQLQuestionRequest(BaseModel):
    """Request model for SQL question generation"""
    difficulty: str = "medium"
    topic: Optional[str] = None  # e.g., "Joins", "Aggregation", "Window Functions"
    concepts: Optional[str] = None  # e.g., "LEFT JOIN, GROUP BY, HAVING"


@router.post("/generate-question")
async def generate_question_endpoint(
    request: GenerateQuestionRequest
):
    """
    Generate a complete coding question using AI (no auth required)
    
    Automatically generates:
    - Title and description
    - Starter code for all 10 DSA languages (Python, JavaScript, TypeScript, C++, Java, C, Go, Rust, Kotlin, C#)
    - Public testcases (at least 3) with inputs and expected outputs
    - Hidden testcases (at least 3) with inputs and expected outputs
    
    Provide topic and/or concepts to guide the generation.
    """
    # All supported DSA languages for question generation
    all_languages = ["python", "javascript", "typescript", "cpp", "java", "c", "go", "rust", "kotlin", "csharp"]
    
    try:
        question_data = await generate_question(
            difficulty=request.difficulty,
            topic=request.topic,
            concepts=request.concepts,
            languages=all_languages
        )
        # If AI generator returned stdin-only testcases, compute expected_output by executing
        # a trusted reference solution program (no AI guessing of outputs).
        public_tcs = question_data.get("public_testcases") or []
        hidden_tcs = question_data.get("hidden_testcases") or []

        # Detect stdin-only testcases (no expected_output anywhere)
        all_tcs = public_tcs + hidden_tcs
        has_any_expected = any(((tc or {}).get("expected_output") or "").strip() for tc in all_tcs)
        if not has_any_expected and all_tcs:
            # Prefer explicit python reference_solution (full working program) if provided by AI generator.
            ref_code = (question_data.get("reference_solution") or "").strip()
            ref_lang = "python"
            lang_id = LANGUAGE_IDS.get(ref_lang)
            if not ref_code:
                # Fallback to python starter_code only if it is a full runnable solution (rare).
                starter_code = question_data.get("starter_code") or {}
                ref_code = (starter_code.get("python") or "").strip()
                if not ref_code:
                    raise HTTPException(status_code=500, detail="Cannot compute expected outputs: missing reference_solution")
            if not lang_id:
                raise HTTPException(status_code=500, detail="Cannot compute expected outputs: python language_id missing")

            question_data["public_testcases"] = await compute_expected_outputs_from_code(ref_code, lang_id, public_tcs)
            question_data["hidden_testcases"] = await compute_expected_outputs_from_code(ref_code, lang_id, hidden_tcs)
            question_data["ai_generated"] = True

            # Never expose reference_solution to frontend
            if "reference_solution" in question_data:
                del question_data["reference_solution"]

        return question_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-sql-question")
async def generate_sql_question_endpoint(
    request: GenerateSQLQuestionRequest
):
    """
    Generate a complete SQL question using AI (no auth required)
    
    SQL questions are a separate question_type within DSA competency.
    They use result-set comparison instead of stdin/stdout testcases.
    
    Automatically generates:
    - Title and description
    - Table schemas with columns and data types
    - Sample data for each table
    - Query constraints and requirements
    - Starter query template
    
    Provide topic and/or concepts to guide the generation:
    - Topics: "Joins", "Aggregation", "Window Functions", "Subqueries"
    - Concepts: "LEFT JOIN", "GROUP BY", "HAVING", "ROW_NUMBER", "CTE"
    
    Returns question with:
    - competency: "DSA"
    - question_type: "SQL"
    - sql_category: select | join | aggregation | subquery | window
    """
    try:
        question_data = await generate_sql_question(
            difficulty=request.difficulty,
            topic=request.topic,
            concepts=request.concepts,
        )
        return question_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

