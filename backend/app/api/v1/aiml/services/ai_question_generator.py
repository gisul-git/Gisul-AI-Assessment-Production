"""
AI Question Generator for AIML Competency Assessment Platform
Generates complete AIML/Python competency questions with optional datasets.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from openai import OpenAI
from ..config import get_aiml_settings

logger = logging.getLogger("backend")


def _requires_dataset(skill: str, topic: Optional[str], difficulty: str) -> bool:
    """
    Determine if a dataset is REQUIRED based on skill, topic, and difficulty.
    
    DO NOT generate a dataset if the question is:
    - Basic Python
    - Basic NumPy operations
    - Simple array manipulation
    - Core library usage that can be solved with in-memory examples
    
    MUST generate a dataset if the question involves:
    - Pandas data analysis
    - Feature engineering
    - Machine Learning
    - Deep Learning
    - Model training or evaluation
    - AI-related data processing
    """
    skill_lower = skill.lower() if skill else ""
    topic_lower = topic.lower() if topic else ""
    difficulty_lower = difficulty.lower() if difficulty else ""
    
    # Skills that typically require datasets
    dataset_required_skills = [
        "machine learning", "ml", "deep learning", "dl", 
        "data science", "pandas", "data analysis"
    ]
    
    # Topics that require datasets
    dataset_required_topics = [
        "pandas", "data analysis", "feature engineering", 
        "model training", "model evaluation", "classification",
        "regression", "neural network", "deep learning",
        "data preprocessing", "data cleaning"
    ]
    
    # Check if skill requires dataset
    if any(ds_skill in skill_lower for ds_skill in dataset_required_skills):
        return True
    
    # Check if topic requires dataset
    if topic and any(ds_topic in topic_lower for ds_topic in dataset_required_topics):
        return True
    
    # Medium and Hard difficulty with ML/DL/AI skills typically need datasets
    if difficulty_lower in ["medium", "hard"]:
        if any(ml_term in skill_lower for ml_term in ["ml", "machine learning", "deep learning", "ai", "data science"]):
            return True
    
    # Basic Python, NumPy basics don't need datasets
    if skill_lower in ["python", "numpy"] and difficulty_lower == "easy":
        return False
    
    # Default: no dataset for basic operations
    return False


def _select_libraries(skill: str, topic: Optional[str], difficulty: str) -> List[str]:
    """
    Auto-select appropriate libraries based on skill, topic, and difficulty.
    """
    skill_lower = skill.lower() if skill else ""
    topic_lower = topic.lower() if topic else ""
    difficulty_lower = difficulty.lower() if difficulty else ""
    
    libraries = []
    
    # Always include Python for AIML questions
    if "python" not in [lib.lower() for lib in libraries]:
        libraries.append("Python")
    
    # Skill-based library selection
    if "numpy" in skill_lower or "array" in skill_lower:
        libraries.append("NumPy")
    
    if "pandas" in skill_lower or "data" in skill_lower:
        libraries.append("Pandas")
    
    if "matplotlib" in skill_lower or "seaborn" in skill_lower or "visualization" in skill_lower:
        libraries.append("Matplotlib")
        if "seaborn" in skill_lower:
            libraries.append("Seaborn")
    
    if "scikit" in skill_lower or "sklearn" in skill_lower or "machine learning" in skill_lower:
        libraries.append("Scikit-learn")
    
    if "tensorflow" in skill_lower or "keras" in skill_lower:
        libraries.append("TensorFlow")
        if "keras" in skill_lower:
            libraries.append("Keras")
    
    if "pytorch" in skill_lower:
        libraries.append("PyTorch")
    
    # Topic-based additions
    if topic:
        if "pandas" in topic_lower:
            libraries.append("Pandas")
        if "numpy" in topic_lower:
            libraries.append("NumPy")
        if "matplotlib" in topic_lower or "plotting" in topic_lower:
            libraries.append("Matplotlib")
        if "sklearn" in topic_lower or "scikit" in topic_lower:
            libraries.append("Scikit-learn")
        if "tensorflow" in topic_lower:
            libraries.append("TensorFlow")
        if "pytorch" in topic_lower:
            libraries.append("PyTorch")
    
    # Remove duplicates while preserving order
    seen = set()
    unique_libraries = []
    for lib in libraries:
        lib_lower = lib.lower()
        if lib_lower not in seen:
            seen.add(lib_lower)
            unique_libraries.append(lib)
    
    # Default libraries if none selected
    if not unique_libraries or len(unique_libraries) == 1:
        if difficulty_lower == "easy":
            unique_libraries = ["Python", "NumPy"]
        elif difficulty_lower == "medium":
            unique_libraries = ["Python", "NumPy", "Pandas", "Scikit-learn"]
        else:  # hard
            unique_libraries = ["Python", "NumPy", "Pandas", "Scikit-learn", "TensorFlow"]
    
    return unique_libraries


async def generate_aiml_question(
    title: str,
    skill: str,
    topic: Optional[str] = None,
    difficulty: str = "medium",
    dataset_format: str = "csv"
) -> Dict[str, Any]:
    """
    Generate a complete AIML competency question using OpenAI.
    
    Args:
        title: Assessment title
        skill: Skill area (Python, AI, Machine Learning, Deep Learning, Data Science)
        topic: Optional specific topic
        difficulty: easy, medium, or hard
        dataset_format: Desired dataset format (csv, json, pdf, parquet, avro) - for backend conversion only
    
    Returns:
        Complete question JSON with assessment, question, and optional dataset fields
    """
    settings = get_aiml_settings()
    
    # Determine if dataset is required
    requires_dataset = _requires_dataset(skill, topic, difficulty)
    
    # Auto-select libraries
    libraries = _select_libraries(skill, topic, difficulty)
    
    # Build difficulty-specific guidance
    difficulty_guidance = {
        "easy": """EASY difficulty:
- Python basics or NumPy basics
- No dataset OR dataset not required
- No ML/DL models
- Simple operations that can be solved with in-memory examples""",
        
        "medium": """MEDIUM difficulty:
- Pandas + NumPy operations
- Dataset REQUIRED
- Feature preprocessing
- Scikit-learn models
- Train-test split
- Evaluation metrics""",
        
        "hard": """HARD difficulty:
- End-to-end ML or DL pipeline
- Dataset REQUIRED
- TensorFlow / PyTorch
- Model training + evaluation
- Overfitting awareness
- Metric interpretation"""
    }
    
    diff_guide = difficulty_guidance.get(difficulty.lower(), difficulty_guidance["medium"])
    
    # Build prompt
    topic_text = f"\nTopic: {topic}" if topic else ""
    
    prompt = f"""You are an AI assessment generator for an AIML competency assessment platform.

Your responsibility is to generate ONE complete AIML/Python competency question.
You may optionally generate a dataset depending on the complexity of the question.

==================================================
SYSTEM CONTEXT
==================================================

This platform evaluates candidates on:
- Python
- AI (Artificial Intelligence)
- Machine Learning
- Deep Learning
- Data Science libraries

All questions are solved in a JUPYTER-STYLE IDE (cell-based execution).

==================================================
CRITICAL DECISION RULE (MANDATORY)
==================================================

You MUST decide whether a dataset is REQUIRED.

DO NOT generate a dataset if the question is:
- Basic Python
- Basic NumPy operations
- Simple array manipulation
- Core library usage that can be solved with in-memory examples

MUST generate a dataset if the question involves:
- Pandas data analysis
- Feature engineering
- Machine Learning
- Deep Learning
- Model training or evaluation
- AI-related data processing

If a dataset is NOT required:
- Set "dataset": null

==================================================
DIFFICULTY-BASED LOGIC (STRICT)
==================================================

{diff_guide}

==================================================
QUESTION REQUIREMENTS
==================================================

You MUST generate:
- ONE AIML competency coding question

The question MUST:
- Be runnable in a Jupyter notebook
- Require writing executable Python code
- Clearly describe tasks to perform
- Match the selected difficulty
- NOT be multiple-choice
- NOT include solutions or hints

==================================================
DATASET REQUIREMENTS (ONLY IF GENERATED)
==================================================

If a dataset is generated:
- EXACTLY 30 rows
- 4 to 7 columns
- Realistic, meaningful data
- Include a label/target column for ML/DL tasks
- Dataset must directly support the question
- Dataset must be FORMAT-AGNOSTIC

You MUST provide:
- schema (array of {{"name": "...", "type": "int|float|string|bool"}})
- rows (array of arrays, where each inner array represents one row)

If dataset is NOT required:
- Set "dataset": null

==================================================
CRITICAL TECHNICAL RULES
==================================================

❌ DO NOT generate CSV, PDF, Parquet, Avro, or any file
❌ DO NOT format output as tables or markdown
❌ DO NOT include explanations outside JSON
❌ DO NOT mention answers or solutions
❌ DO NOT convert dataset into selected format

✅ Output MUST be STRICT JSON ONLY
✅ Dataset field MUST exist (object or null)
✅ Question text must remain unchanged for all users

==================================================
INPUT PROVIDED TO YOU
==================================================

Assessment Title: {title}
Skill: {skill}
Topic (optional): {topic if topic else "None"}
Difficulty: {difficulty}
Selected Dataset Format: {dataset_format} (for backend conversion only - you must NOT generate files in this format)

==================================================
MANDATORY JSON OUTPUT SCHEMA
==================================================

{{
  "assessment": {{
    "title": "{title}",
    "skill": "{skill}",
    "topic": "{topic if topic else ''}",
    "difficulty": "{difficulty}",
    "libraries": {json.dumps(libraries)},
    "selected_dataset_format": "{dataset_format}"
  }},
  "question": {{
    "type": "aiml_coding",
    "execution_environment": "jupyter_notebook",
    "description": "Clear problem statement explaining what needs to be done. Include what the code should accomplish. 2-3 paragraphs. NO examples here, NO constraints here. Just the problem description.",
    "tasks": [
      "Task 1: ...",
      "Task 2: ...",
      "Task 3: ..."
    ],
    "constraints": [
      "Constraint 1: ...",
      "Constraint 2: ..."
    ]
  }},
  "dataset": null
}}

OR (if dataset is required):

{{
  "assessment": {{
    "title": "{title}",
    "skill": "{skill}",
    "topic": "{topic if topic else ''}",
    "difficulty": "{difficulty}",
    "libraries": {json.dumps(libraries)},
    "selected_dataset_format": "{dataset_format}"
  }},
  "question": {{
    "type": "aiml_coding",
    "execution_environment": "jupyter_notebook",
    "description": "Clear problem statement explaining what needs to be done. Include what the code should accomplish. 2-3 paragraphs. NO examples here, NO constraints here. Just the problem description.",
    "tasks": [
      "Task 1: ...",
      "Task 2: ...",
      "Task 3: ..."
    ],
    "constraints": [
      "Constraint 1: ...",
      "Constraint 2: ..."
    ]
  }},
  "dataset": {{
    "schema": [
      {{"name": "column1", "type": "int"}},
      {{"name": "column2", "type": "float"}},
      {{"name": "column3", "type": "string"}},
      {{"name": "target", "type": "int"}}
    ],
    "rows": [
      [1, 2.5, "value1", 0],
      [2, 3.7, "value2", 1],
      ...
    ]
  }}
}}

==================================================
FINAL VALIDATION BEFORE RESPONSE
==================================================

Before responding, VERIFY:
✓ JSON is valid and parsable
✓ Question matches difficulty and skill
✓ Libraries are appropriate: {json.dumps(libraries)}
✓ Dataset included ONLY when required: {requires_dataset}
✓ Dataset has EXACTLY 30 rows if present
✓ No text outside JSON

==================================================
GENERATE THE RESPONSE NOW
==================================================

Return ONLY valid JSON. No markdown code blocks, no explanations, just the JSON object."""

    try:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert AI assessment generator for AIML competency assessment. Always return valid JSON only. Never include markdown code blocks or explanations outside JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        if not response.choices or not response.choices[0].message.content:
            raise ValueError("OpenAI API returned empty response")
        
        content = response.choices[0].message.content.strip()
        logger.info(f"Raw AI response (first 500 chars): {content[:500]}")
        
        # Remove markdown code blocks if present
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        # Extract JSON object
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        
        if json_start >= 0 and json_end > json_start:
            content = content[json_start:json_end]
        
        if not content:
            raise ValueError("No JSON content found in AI response")
        
        # Parse JSON
        try:
            question_data = json.loads(content)
        except json.JSONDecodeError as json_err:
            logger.error(f"Failed to parse JSON. Content preview: {content[:200]}")
            raise ValueError(f"Failed to parse AI response as JSON: {json_err}")
        
        # Validate structure
        if "assessment" not in question_data:
            raise ValueError("Missing 'assessment' field in AI response")
        if "question" not in question_data:
            raise ValueError("Missing 'question' field in AI response")
        if "dataset" not in question_data:
            raise ValueError("Missing 'dataset' field in AI response")
        
        # Validate dataset if present
        if question_data.get("dataset") is not None:
            dataset = question_data["dataset"]
            if "schema" not in dataset:
                raise ValueError("Dataset missing 'schema' field")
            if "rows" not in dataset:
                raise ValueError("Dataset missing 'rows' field")
            
            # Validate row count
            if len(dataset["rows"]) != 30:
                logger.warning(f"Dataset has {len(dataset['rows'])} rows, expected 30. Adjusting...")
                # Adjust to exactly 30 rows
                if len(dataset["rows"]) > 30:
                    dataset["rows"] = dataset["rows"][:30]
                else:
                    # Repeat last row to reach 30
                    last_row = dataset["rows"][-1] if dataset["rows"] else []
                    while len(dataset["rows"]) < 30:
                        dataset["rows"].append(last_row.copy() if last_row else [])
            
            # Validate column count
            schema_cols = len(dataset["schema"])
            if schema_cols < 4 or schema_cols > 7:
                logger.warning(f"Dataset has {schema_cols} columns, expected 4-7")
        
        # Ensure question has required fields
        if "type" not in question_data["question"]:
            question_data["question"]["type"] = "aiml_coding"
        if "execution_environment" not in question_data["question"]:
            question_data["question"]["execution_environment"] = "jupyter_notebook"
        if "tasks" not in question_data["question"]:
            question_data["question"]["tasks"] = []
        if "constraints" not in question_data["question"]:
            question_data["question"]["constraints"] = []
        
        logger.info(f"Successfully generated AIML question: {title}, skill={skill}, dataset_required={requires_dataset}")
        return question_data
        
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse AI response as JSON: {e}")
    except Exception as e:
        logger.exception(f"Error generating AIML question: {e}")
        raise Exception(f"OpenAI API error: {e}")


async def generate_topic_suggestions(
    skill: str,
    difficulty: str
) -> List[str]:
    """
    Generate AI-suggested topics based on skill and difficulty level.
    
    Args:
        skill: Skill area (Python, AI, Machine Learning, Deep Learning, Data Science)
        difficulty: easy, medium, or hard
    
    Returns:
        List of suggested topics for the given skill and difficulty
    """
    settings = get_aiml_settings()
    
    prompt = f"""You are an expert AI/ML educator. Generate a list of relevant topics for creating competency assessment questions.

Skill: {skill}
Difficulty Level: {difficulty}

Generate 10-15 specific, actionable topics that are appropriate for {difficulty} level questions in {skill}.

Requirements:
- Topics should be specific and focused (e.g., "Array Operations" not just "Arrays")
- Topics should match the difficulty level ({difficulty})
- Topics should be relevant to {skill}
- Return ONLY a JSON array of topic strings
- No explanations, no markdown, just the JSON array

Example format:
["Topic 1", "Topic 2", "Topic 3", ...]

Return the JSON array now:"""

    try:
        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert AI/ML educator. Always return valid JSON arrays only. Never include markdown code blocks or explanations outside JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        if not response.choices or not response.choices[0].message.content:
            raise ValueError("OpenAI API returned empty response")
        
        content = response.choices[0].message.content.strip()
        logger.info(f"Raw AI topic suggestions response (first 200 chars): {content[:200]}")
        
        # Remove markdown code blocks if present
        if content.startswith("```json"):
            content = content[7:]
        elif content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        # Extract JSON array
        json_start = content.find("[")
        json_end = content.rfind("]") + 1
        
        if json_start >= 0 and json_end > json_start:
            content = content[json_start:json_end]
        
        if not content:
            raise ValueError("No JSON array found in AI response")
        
        # Parse JSON
        try:
            topics = json.loads(content)
            if not isinstance(topics, list):
                raise ValueError("AI response is not a list")
            
            # Validate and clean topics
            valid_topics = []
            for topic in topics:
                if isinstance(topic, str) and topic.strip():
                    valid_topics.append(topic.strip())
            
            if not valid_topics:
                # Fallback to default topics if AI returns empty
                logger.warning(f"AI returned no valid topics, using fallback for skill={skill}, difficulty={difficulty}")
                return _get_fallback_topics(skill, difficulty)
            
            logger.info(f"Successfully generated {len(valid_topics)} topic suggestions for skill={skill}, difficulty={difficulty}")
            return valid_topics
            
        except json.JSONDecodeError as json_err:
            logger.error(f"Failed to parse JSON. Content preview: {content[:200]}")
            # Fallback to default topics
            return _get_fallback_topics(skill, difficulty)
        
    except Exception as e:
        logger.exception(f"Error generating topic suggestions: {e}")
        # Fallback to default topics
        return _get_fallback_topics(skill, difficulty)


def _get_fallback_topics(skill: str, difficulty: str) -> List[str]:
    """Fallback topics if AI generation fails"""
    fallback_topics = {
        "Python": {
            "easy": ["Basic Python", "Data Types", "Control Flow", "Functions", "Lists and Tuples"],
            "medium": ["NumPy Basics", "Object-Oriented Programming", "File Handling", "Error Handling", "List Comprehensions"],
            "hard": ["Advanced NumPy", "Decorators", "Generators", "Context Managers", "Multithreading"]
        },
        "AI": {
            "easy": ["AI Basics", "Search Algorithms", "Problem Solving", "Heuristics"],
            "medium": ["Natural Language Processing Basics", "Computer Vision Basics", "Knowledge Representation"],
            "hard": ["Advanced NLP", "Advanced Computer Vision", "Expert Systems", "Planning and Reasoning"]
        },
        "Machine Learning": {
            "easy": ["ML Basics", "Supervised Learning", "Linear Regression", "Classification Basics"],
            "medium": ["Feature Engineering", "Model Evaluation", "Cross-Validation", "Hyperparameter Tuning"],
            "hard": ["Ensemble Methods", "Advanced Algorithms", "Model Optimization", "Bias-Variance Tradeoff"]
        },
        "Deep Learning": {
            "easy": ["Neural Networks Basics", "Forward Propagation", "Backpropagation Basics"],
            "medium": ["CNNs", "RNNs", "Transfer Learning", "Regularization"],
            "hard": ["Transformers", "GANs", "Advanced Architectures", "Optimization Techniques"]
        },
        "Data Science": {
            "easy": ["Data Analysis Basics", "Data Visualization", "Pandas Basics", "Statistical Basics"],
            "medium": ["Data Preprocessing", "Exploratory Data Analysis", "Feature Selection"],
            "hard": ["Advanced Data Analysis", "Time Series Analysis", "Hypothesis Testing", "Advanced Statistics"]
        }
    }
    
    skill_topics = fallback_topics.get(skill, {})
    difficulty_topics = skill_topics.get(difficulty.lower(), skill_topics.get("medium", ["General Topics"]))
    return difficulty_topics
