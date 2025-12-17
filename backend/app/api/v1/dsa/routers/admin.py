from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services.ai_generator import generate_question
from ..services.ai_sql_generator import generate_sql_question
from typing import Optional

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

