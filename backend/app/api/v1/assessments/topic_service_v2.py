"""
New Topic Generation and Question Generation Service (v2)
Completely redesigned from scratch following strict architecture rules.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import HTTPException

try:
    import httpx
except ImportError:
    httpx = None

try:
    from openai import AsyncOpenAI, APIError, APIConnectionError, AuthenticationError, RateLimitError
except ImportError:
    AsyncOpenAI = None
    APIError = None
    APIConnectionError = None
    AuthenticationError = None
    RateLimitError = None

from ....core.config import get_settings
from .services import _get_experience_level_corporate, _get_experience_level_student

# Import DSA module utilities for coding questions
# Note: DSA module is in parallel directory at app/api/v1/dsa/
# From app/api/v1/assessments/ we go up one level (..) to v1, then into dsa
DSA_AVAILABLE = False
dsa_generate_question = None
dsa_generate_sql_question = None
generate_boilerplate = None

try:
    from ..dsa.services.ai_generator import generate_question as dsa_generate_question
    from ..dsa.services.ai_sql_generator import generate_sql_question as dsa_generate_sql_question
    from ..dsa.services.code_wrapper import generate_boilerplate
    DSA_AVAILABLE = True
except (ImportError, ModuleNotFoundError) as e:
    import logging
    logging.getLogger(__name__).warning(f"DSA module not available. Coding/SQL questions will use basic generation. Error: {e}")

# Import AIML module utilities for AIML questions
AIML_AVAILABLE = False
aiml_generate_question = None

try:
    from ..aiml.services.ai_question_generator import generate_aiml_question as aiml_generate_question
    AIML_AVAILABLE = True
except (ImportError, ModuleNotFoundError) as e:
    import logging
    logging.getLogger(__name__).warning(f"AIML module not available. AIML questions will use basic generation. Error: {e}")

logger = logging.getLogger(__name__)


# List of frameworks/libraries not supported by Judge0
JUDGE0_UNSUPPORTED_FRAMEWORKS = [
    "django",
    "flask",
    "fastapi",
    "react",
    "angular",
    "vue",
    "next",
    "nextjs",
    "express",
    "spring",
    "hibernate",
    "laravel",
    "symfony",
    "rails",
    "ruby on rails",
    "asp.net",
    "dotnet",
    ".net",
    "tensorflow",
    "pytorch",
    "keras",
    "scikit-learn",
    "scikit",
    "pandas",
    "numpy",
    "matplotlib",
    "seaborn",
    "jupyter",
    "jupyter notebook",
    "selenium",
    "cypress",
    "jest",
    "mocha",
    "junit",
    "pytest",
    "unittest",
    "maven",
    "gradle",
    "npm",
    "yarn",
    "webpack",
    "babel",
    "gulp",
    "grunt",
    # Treat SQL/database topics as non-Judge0-coding to prevent auto-conversion to Coding
    "sql",
    "database",
    "mysql",
    "postgresql",
    "sqlite",
    "oracle",
    "mssql",
    # Web technologies / browser APIs (platform doesn't support web execution)
    "html",
    "css",
    "scss",
    "sass",
    "less",
    "tailwind",
    "bootstrap",
    "dom",
    "document",
    "window",
    "browser",
    "fetch",
    "localstorage",
    "sessionstorage",
    "cookie",
    "vite",
    "rollup",
    "parcel",
    "jquery",
    "d3",
    "chart.js",
    "three.js",
]

# Additional deterministic classifiers for v2 topic flows (keeps UI consistent with backend restrictions)
V2_AIML_KEYWORDS = [
    "pandas", "numpy", "matplotlib", "seaborn", "plotly", "scipy",
    "tensorflow", "keras", "pytorch", "torch", "scikit-learn", "sklearn",
    "machine learning", "deep learning", "neural network", "random forest", "decision tree",
    "regression", "classification", "clustering", "supervised learning", "unsupervised learning",
    "gradient descent", "backpropagation",
    "jupyter", "notebook", "colab", "anaconda",
    "data preprocessing", "feature engineering", "model training", "dataframe", "series",
    "model evaluation", "cross validation",
]

V2_SQL_THEORY_KEYWORDS = [
    " vs ", " versus ", "compare", "comparison", "difference", "differences",
    "advantages", "disadvantages", "benefits", "drawbacks",
    "concept", "concepts", "principle", "principles", "fundamental", "fundamentals", "basic", "basics",
    "explained", "explain", "explanation", "understanding", "overview", "introduction",
    "types of", "what is", "why", "when",
    "strategy", "strategies", "approach", "approaches", "technique", "techniques", "best practice", "best practices",
    "design", "architecture", "modeling", "modelling",
    "vulnerability", "vulnerabilities", "security", "prevention", "mitigation",
    "injection",
]

V2_SQL_EXECUTION_KEYWORDS = [
    "write sql", "write a sql", "write query", "write a query", "construct query", "create query",
    "sql query to", "query to", "using sql to",
    "implement stored procedure", "write stored procedure", "create stored procedure", "stored procedure implementation",
    "create procedure", "write procedure", "implement procedure",
    "create trigger", "write trigger", "trigger implementation",
    "optimize query", "optimizing query", "query optimization", "rewrite query", "improve query performance",
    "recursive query", "writing recursive",
]

V2_AIML_THEORY_KEYWORDS = [
    " vs ", " versus ", "compare", "comparison", "difference", "differences",
    "advantages", "disadvantages", "benefits", "drawbacks",
    "concept", "concepts", "principle", "principles", "fundamental", "fundamentals", "basic", "basics",
    "theory", "explained", "explain", "explanation", "understanding", "overview", "introduction",
    "what is", "why", "when", "how does",
    "architecture", "design", "workflow", "process",
]

V2_AIML_EXECUTION_KEYWORDS = [
    "implement", "implementation", "build", "train", "fit", "predict",
    "write code", "coding", "notebook", "jupyter", "colab",
    "using pandas", "with pandas", "using numpy", "with numpy",
    "using sklearn", "with sklearn", "using scikit-learn", "with scikit-learn",
    "using tensorflow", "with tensorflow", "using pytorch", "with pytorch",
    "data preprocessing", "feature engineering", "model training",
]

V2_SQL_INDICATOR_PATTERNS = [
    # DB indicators must be word-boundary based to avoid substring false positives (e.g., "overview" contains "view")
    r"\bsql\b",
    r"\bmysql\b",
    r"\bpostgresql\b",
    r"\bsqlite\b",
    r"\boracle\b",
    r"\bmssql\b",
    r"\bdatabase\b",
    r"\bdb\b",
    r"\bschema\b",
    r"\btable\b",
    r"\btables\b",
    r"\bquery\b",
    r"\bqueries\b",
    r"\bstored\s+procedure\b",
    r"\btrigger\b",
    r"\bview\b",
    r"\bindex\b",
    r"\bindexes\b",
    r"\bindexing\b",
    r"\btransaction\b",
    r"\btransactions\b",
    r"\bacid\b",
    r"\bprimary\s+key\b",
    r"\bforeign\s+key\b",
    r"\bnormalization\b",
    r"\bdenormalization\b",
]

V2_WEB_KEYWORDS = [
    "react", "angular", "vue", "svelte", "nextjs", "next.js", "nuxt", "gatsby", "ember",
    "html", "css", "scss", "sass", "less", "tailwind", "bootstrap", "material ui", "chakra ui", "ant design",
    "dom", "browser", "document", "window", "event listener", "fetch api", "localstorage", "sessionstorage",
    "cookie", "webstorage",
    "express", "koa", "fastify", "nest", "nestjs", "meteor",
    "webpack", "vite", "rollup", "parcel", "babel",
    "jquery", "d3", "chart.js", "three.js", "gsap", "anime.js",
    "frontend", "web development", "responsive design", "web page", "website", "web app", "web application",
    "spa", "single page", "ssr", "server side rendering", "csr", "client side rendering",
    "node server", "express server", "api endpoint", "http server", "rest api in node",
]

def _v2_contains_any(haystack: str, needles: List[str]) -> bool:
    return any(n in haystack for n in needles)

def _v2_is_sql_topic(text: str) -> bool:
    for pat in V2_SQL_INDICATOR_PATTERNS:
        if re.search(pat, text):
            return True
    sql_op_patterns = [
        r"\bselect\b.*\bfrom\b",
        r"\bjoin\b.*\bon\b",
        r"\bgroup\s+by\b",
        r"\border\s+by\b",
        r"\bwhere\b",
        r"\bhaving\b",
        r"\binsert\b.*\binto\b",
        r"\bupdate\b.*\bset\b",
        r"\bdelete\b.*\bfrom\b",
        r"\bsubquery\b",
        r"\bsubqueries\b",
    ]
    hits = 0
    for pat in sql_op_patterns:
        if re.search(pat, text):
            hits += 1
            if hits >= 2:
                return True
    return False

def _v2_is_sql_execution_topic(text: str) -> bool:
    if not _v2_is_sql_topic(text):
        return False
    if _v2_contains_any(text, V2_SQL_THEORY_KEYWORDS):
        return False
    if _v2_contains_any(text, V2_SQL_EXECUTION_KEYWORDS):
        return True
    # If it contains strong SQL op context (e.g., SELECT...FROM) treat as execution
    sql_op_patterns = [
        r"\bselect\b.*\bfrom\b",
        r"\bjoin\b.*\bon\b",
        r"\bgroup\s+by\b",
        r"\border\s+by\b",
        r"\bwhere\b",
        r"\bhaving\b",
        r"\binsert\b.*\binto\b",
        r"\bupdate\b.*\bset\b",
        r"\bdelete\b.*\bfrom\b",
        r"\bsubquery\b",
        r"\bsubqueries\b",
    ]
    return any(re.search(pat, text) for pat in sql_op_patterns)

def _v2_is_aiml_execution_topic(text: str) -> bool:
    if not _v2_contains_any(text, V2_AIML_KEYWORDS):
        return False
    if _v2_contains_any(text, V2_AIML_THEORY_KEYWORDS):
        return False
    return _v2_contains_any(text, V2_AIML_EXECUTION_KEYWORDS)


def is_judge0_supported(skill_name: str) -> bool:
    """
    Check if a skill/topic name is supported by Judge0.
    Judge0 only supports pure programming languages, not frameworks
    that require additional setup.
    """
    if not skill_name:
        return True
    
    skill_lower = skill_name.lower().strip()
    
    # Check if the skill matches any unsupported framework
    # Check for exact match, prefix match, or if framework appears as a word in the string
    for framework in JUDGE0_UNSUPPORTED_FRAMEWORKS:
        framework_lower = framework.lower()
        # Exact match
        if skill_lower == framework_lower:
            return False
        # Starts with framework followed by space
        if skill_lower.startswith(framework_lower + " "):
            return False
        # Framework appears as a whole word in the string (using word boundaries)
        # Check if framework is surrounded by non-word characters or at start/end
        pattern = r'\b' + re.escape(framework_lower) + r'\b'
        if re.search(pattern, skill_lower):
            return False
    
    return True


def filter_judge0_unsupported_skills(skills: List[str]) -> List[str]:
    """
    Filter out skills that are not supported by Judge0.
    """
    return [skill for skill in skills if is_judge0_supported(skill)]


def contains_unsupported_framework(text: str, skills: Optional[List[str]] = None) -> tuple[bool, Optional[str]]:
    """
    Check if a text (topic label) contains any framework that's not supported by Judge0.
    Returns (is_framework, framework_name) tuple.
    """
    if not text:
        return (False, None)
    
    text_lower = text.lower()
    
    # First, check if the text itself contains any framework name
    for framework in JUDGE0_UNSUPPORTED_FRAMEWORKS:
        framework_lower = framework.lower()
        # Check if framework appears as a whole word in the text
        pattern = r'\b' + re.escape(framework_lower) + r'\b'
        if re.search(pattern, text_lower):
            return (True, framework)
    
    # Second, check if any skill from the provided list is a framework and appears in the text
    if skills:
        for skill in skills:
            if not is_judge0_supported(skill):
                skill_lower = skill.lower().strip()
                # Check if this framework skill appears in the topic label
                pattern = r'\b' + re.escape(skill_lower) + r'\b'
                if re.search(pattern, text_lower):
                    return (True, skill)
    
    return (False, None)


def _validate_and_fix_function_signature(
    func_sig_raw: Any,
    topic: Optional[str] = None,
    title: Optional[str] = None,
    context: str = "validation"
) -> Optional[Dict[str, Any]]:
    """
    Validate and fix function signature structure.
    Ensures the function signature has required fields: name, parameters, return_type.
    
    Args:
        func_sig_raw: Raw function signature (dict, str, or None)
        topic: Topic name for inference
        title: Title for inference
        context: Context string for logging
    
    Returns:
        Validated and fixed function signature dict, or None if invalid
    """
    if func_sig_raw is None:
        return None
    
    # If it's a string, try to parse it or return None
    if isinstance(func_sig_raw, str):
        # If it's an empty string, return None
        if not func_sig_raw.strip():
            return None
        # Could try to parse string format like "functionName(param1: type1, param2: type2): returnType"
        # For now, return None and let the caller handle it
        logger.warning(f"[{context}] Function signature is a string, cannot validate structure: {func_sig_raw[:50]}")
        return None
    
    # Must be a dict
    if not isinstance(func_sig_raw, dict):
        logger.warning(f"[{context}] Function signature is not a dict, got {type(func_sig_raw)}")
        return None
    
    func_sig = func_sig_raw.copy()  # Work with a copy
    fixed = False
    
    # Ensure 'name' field exists
    if "name" not in func_sig or not func_sig.get("name"):
        # Try to infer from title or topic
        if title:
            inferred_name = title.lower().replace(" ", "_").replace("-", "_")
            # Remove special characters, keep only alphanumeric and underscore
            inferred_name = re.sub(r'[^a-z0-9_]', '', inferred_name)
            inferred_name = inferred_name[:20] or "solve"
        elif topic:
            inferred_name = topic.lower().replace(" ", "_").replace("-", "_")
            inferred_name = re.sub(r'[^a-z0-9_]', '', inferred_name)
            inferred_name = inferred_name[:20] or "solve"
        else:
            inferred_name = "solve"
        
        func_sig["name"] = inferred_name
        fixed = True
        logger.debug(f"[{context}] Function signature missing 'name', inferred: {inferred_name}")
    
    # Ensure 'parameters' field exists and is a list
    if "parameters" not in func_sig:
        func_sig["parameters"] = []
        fixed = True
        logger.debug(f"[{context}] Function signature missing 'parameters', using empty array")
    elif not isinstance(func_sig["parameters"], list):
        logger.warning(f"[{context}] Function signature.parameters is not an array, converting...")
        func_sig["parameters"] = []
        fixed = True
    
    # Validate parameters structure if present
    if func_sig["parameters"]:
        validated_params = []
        for param in func_sig["parameters"]:
            if isinstance(param, dict):
                # Ensure param has name and type
                if "name" not in param or not param.get("name"):
                    continue  # Skip invalid params
                if "type" not in param:
                    param["type"] = "any"  # Default type
                validated_params.append(param)
            elif isinstance(param, str):
                # Try to parse string format like "name: type" or just "name"
                parts = param.split(":", 1)
                param_name = parts[0].strip()
                param_type = parts[1].strip() if len(parts) > 1 else "any"
                validated_params.append({"name": param_name, "type": param_type})
        
        if len(validated_params) != len(func_sig["parameters"]):
            fixed = True
        func_sig["parameters"] = validated_params
    
    # Ensure 'return_type' field exists
    if "return_type" not in func_sig or not func_sig.get("return_type"):
        func_sig["return_type"] = "int"  # Default return type
        fixed = True
        logger.debug(f"[{context}] Function signature missing 'return_type', using default: 'int'")
    
    if fixed:
        logger.debug(f"[{context}] Fixed function signature: {func_sig}")
    
    return func_sig


def filter_topics_with_coding_unsupported(topics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter out topics that have coding questions but are not supported by Judge0.
    """
    filtered_topics = []
    for topic in topics:
        # Check if topic has any coding question rows
        question_rows = topic.get("questionRows", [])
        has_coding_questions = any(
            row.get("questionType") == "Coding" for row in question_rows
        )
        
        # If topic has coding questions, check if it's supported by Judge0
        if has_coding_questions:
            topic_label = topic.get("label", "")
            if is_judge0_supported(topic_label):
                filtered_topics.append(topic)
            else:
                logger.warning(
                    f"Filtered out topic '{topic_label}' - has coding questions but not supported by Judge0"
                )
        else:
            # If no coding questions, keep the topic
            filtered_topics.append(topic)
    
    return filtered_topics


def _build_openai_payload(
    model: str,
    messages: List[Dict[str, str]],
    temperature: float = 0.7,
    top_p: float = 1.0,
    max_tokens: Optional[int] = None,
    max_completion_tokens: Optional[int] = None,
    frequency_penalty: float = 0.0,
    presence_penalty: float = 0.0,
    **kwargs
) -> Dict[str, Any]:
    """
    Build OpenAI API payload, excluding unsupported parameters for o3-mini and o1-mini models.
    
    o3-mini and o1-mini do NOT support:
    - temperature
    - top_p
    - frequency_penalty
    - presence_penalty
    
    They also require max_completion_tokens instead of max_tokens.
    
    Args:
        model: The model name (e.g., "o3-mini", "gpt-4o-mini")
        messages: List of message dicts
        temperature: Temperature parameter (ignored for o3-mini/o1-mini)
        top_p: Top-p parameter (ignored for o3-mini/o1-mini)
        max_tokens: Max tokens (converted to max_completion_tokens for o3-mini/o1-mini)
        max_completion_tokens: Max completion tokens (used directly for o3-mini/o1-mini)
        frequency_penalty: Frequency penalty (ignored for o3-mini/o1-mini)
        presence_penalty: Presence penalty (ignored for o3-mini/o1-mini)
        **kwargs: Additional parameters
    
    Returns:
        Dict with OpenAI API payload
    """
    payload = {
        "model": model,
        "messages": messages,
    }
    
    # o3-mini and o1-mini don't support sampling parameters
    if model not in ["o3-mini", "o1-mini"]:
        payload["temperature"] = temperature
        payload["top_p"] = top_p
        if frequency_penalty != 0.0:
            payload["frequency_penalty"] = frequency_penalty
        if presence_penalty != 0.0:
            payload["presence_penalty"] = presence_penalty
    
    # Handle max_tokens vs max_completion_tokens
    if model in ["o3-mini", "o1-mini"]:
        if max_completion_tokens is not None:
            payload["max_completion_tokens"] = max_completion_tokens
        elif max_tokens is not None:
            payload["max_completion_tokens"] = max_tokens
    else:
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
    
    # Add any additional kwargs
    payload.update(kwargs)
    
    # Debug logging to confirm temperature is removed for o3-mini/o1-mini
    if model in ["o3-mini", "o1-mini"]:
        logger.debug(f"Payload for model {model} (no sampling params): {payload}")
        # Verify temperature is NOT in payload
        if "temperature" in payload or "top_p" in payload or "frequency_penalty" in payload or "presence_penalty" in payload:
            logger.warning(f"WARNING: Sampling parameters found in payload for {model} - this should not happen!")
    else:
        logger.debug(f"Payload for model {model}: {payload}")
    
    return payload


def _parse_json_response(content: str, error_context: str = "JSON") -> Any:
    """
    Robustly parse JSON from OpenAI response, handling markdown code blocks and control characters.
    
    Args:
        content: Raw content from OpenAI response
        error_context: Context string for error messages
        
    Returns:
        Parsed JSON object (usually a list)
        
    Raises:
        HTTPException: If JSON parsing fails after all attempts
    """
    # Remove markdown code blocks if present
    if content.startswith("```"):
        parts = content.split("```")
        if len(parts) > 1:
            # Take the content between first ``` and last ```
            content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
            # Remove language identifier if present
            if content.startswith("json"):
                content = content[4:]
            elif content.startswith("JSON"):
                content = content[4:]
        content = content.strip()
    
    # First, try to parse as-is
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass  # Continue to cleaning steps
    
    # Clean control characters and escape unescaped newlines in string values
    # The issue is that OpenAI sometimes returns JSON with unescaped newlines in strings
    # We need to escape newlines within string values (between quotes)
    import string
    cleaned_content = ""
    i = 0
    in_string = False
    escape_next = False
    
    while i < len(content):
        char = content[i]
        char_code = ord(char)
        
        # Track if we're inside a string (between unescaped quotes)
        if not escape_next:
            if char == '"':
                # Check if this quote is escaped (count backslashes before it)
                backslash_count = 0
                j = i - 1
                while j >= 0 and content[j] == '\\':
                    backslash_count += 1
                    j -= 1
                # If even number of backslashes, quote is not escaped
                if backslash_count % 2 == 0:
                    in_string = not in_string
                cleaned_content += char
                i += 1
                continue
            elif char == '\\':
                escape_next = True
                cleaned_content += char
                i += 1
                continue
        
        # Reset escape flag after processing escaped character
        if escape_next:
            escape_next = False
            cleaned_content += char
            i += 1
            continue
        
        # If we're inside a string, escape unescaped newlines and control chars
        if in_string:
            # Check if this character is escaped
            is_escaped = False
            if i > 0:
                backslash_count = 0
                j = i - 1
                while j >= 0 and content[j] == '\\':
                    backslash_count += 1
                    j -= 1
                is_escaped = (backslash_count % 2 == 1)
            
            if not is_escaped:
                if char == '\n':
                    # Escape unescaped newline
                    cleaned_content += '\\n'
                elif char == '\r':
                    # Escape unescaped carriage return
                    cleaned_content += '\\r'
                elif char == '\t':
                    # Escape unescaped tab
                    cleaned_content += '\\t'
                elif char_code < 32:
                    # Replace other control characters with space
                    cleaned_content += ' '
                else:
                    cleaned_content += char
            else:
                # Character is already escaped, keep as-is
                cleaned_content += char
        else:
            # Outside strings, allow printable characters and whitespace
            if char in string.printable or char in '\n\r\t ':
                cleaned_content += char
            elif char_code < 32:
                cleaned_content += ' '
            else:
                cleaned_content += char
        
        i += 1
    
    # Try to parse cleaned JSON
    try:
        return json.loads(cleaned_content)
    except json.JSONDecodeError as json_err:
        # If still failing, try to extract JSON array using regex as fallback
        json_match = re.search(r'\[.*\]', cleaned_content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError as e2:
                logger.error(f"{error_context} parsing failed even after regex extraction. Error: {e2}")
                logger.error(f"Content preview (first 500 chars): {cleaned_content[:500]}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Failed to parse {error_context}. Please try regenerating."
                ) from e2
        else:
            logger.error(f"{error_context} parsing failed. Error: {json_err}")
            logger.error(f"Content preview (first 500 chars): {cleaned_content[:500]}")
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to parse {error_context}. Please try regenerating."
            ) from json_err


async def _find_semantically_suitable_topic(
    topics: List[Dict[str, Any]], 
    target_question_type: str
) -> Optional[int]:
    """
    Use OpenAI to find the most semantically suitable topic for a given question type.
    Returns the index of the best matching topic, or None if no suitable match found.
    """
    if not topics:
        return None
    
    # Build topic list for analysis
    topic_labels = [topic.get("label", "") for topic in topics]
    current_types = []
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            current_types.append(question_rows[0].get("questionType", "MCQ"))
        else:
            current_types.append("MCQ")
    
    # Define semantic criteria for each question type
    semantic_criteria = {
        "MCQ": "factual knowledge, terminology, syntax, basic recall, quick assessment",
        "Subjective": "conceptual understanding, theoretical explanation, architectural reasoning, describing principles, comparing concepts",
        "PseudoCode": "algorithm design, workflow, process flow, problem-solving steps, logic breakdown, structured thinking",
        "Coding": "implementation, writing executable code, building features, programming tasks"
    }
    
    criteria = semantic_criteria.get(target_question_type, "")
    
    prompt = f"""You are an expert at semantic topic analysis. Analyze these topics and identify which one is MOST SEMANTICALLY SUITABLE for a {target_question_type} question type.

Question Type: {target_question_type}
Semantic Criteria: {criteria}

Topics (with current question types):
{chr(10).join([f"{i+1}. \"{label}\" (currently: {current_types[i]})" for i, label in enumerate(topic_labels)])}

Rules:
- Do NOT use keyword matching
- Use semantic understanding of each topic's meaning and intent
- Consider which topic's purpose aligns best with the {target_question_type} criteria
- Work for ANY domain (programming, cloud, DevOps, AI/ML, cybersecurity, databases, etc.)
- Return ONLY the topic number (1-{len(topics)}) that is most suitable
- If multiple are equally suitable, return the first one

Return ONLY a number between 1 and {len(topics)}, no explanations."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at semantic topic analysis. Always return only a number, no explanations."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,  # Lower temperature for more consistent results
            max_tokens=10,
        )
        
        content = response.choices[0].message.content.strip()
        # Extract number from response
        numbers = re.findall(r'\d+', content)
        if numbers:
            topic_idx = int(numbers[0]) - 1  # Convert to 0-based index
            if 0 <= topic_idx < len(topics):
                # Verify the topic doesn't already have this type
                question_rows = topics[topic_idx].get("questionRows", [])
                if question_rows:
                    current_type = question_rows[0].get("questionType", "MCQ")
                    if current_type != target_question_type:
                        return topic_idx
        
        return None
    except Exception as exc:
        logger.warning(f"Error in semantic topic matching: {exc}. Using fallback.")
        return None


async def _ensure_all_question_types_present(topics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Post-process topics to ensure all question types appear at least once.
    
    Rules:
    - MCQ, Subjective, PseudoCode must appear at least once
    - Coding must appear at least once ONLY if at least one topic supports it (canUseJudge0 = true)
    - Updates topics while maintaining topic-questionType relevance
    """
    if not topics:
        return topics
    
    # Collect existing question types from first row of each topic
    existing_types = set()
    coding_supported = False
    
    # First pass: check if ANY topic supports Coding
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            first_row = question_rows[0]
            if first_row.get("canUseJudge0", False):
                coding_supported = True
                break
    
    # Second pass: collect existing question types
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            first_row = question_rows[0]
            qtype = first_row.get("questionType", "MCQ")
            existing_types.add(qtype)
    
    # Required types
    required_types = {"MCQ", "Subjective", "PseudoCode"}
    if coding_supported:
        required_types.add("Coding")
    
    # Find missing types
    missing_types = required_types - existing_types
    
    if not missing_types:
        # All types already present
        return topics
    
    logger.info(f"Missing question types: {missing_types}. Ensuring all types appear at least once.")
    
    # For each missing type, find a suitable topic to update
    for missing_type in missing_types:
        topic_updated = False
        
        # Special handling for Coding: only assign if topic supports it
        if missing_type == "Coding":
            # Find a topic that supports Coding (canUseJudge0 = true)
            for topic in topics:
                question_rows = topic.get("questionRows", [])
                if question_rows:
                    first_row = question_rows[0]
                    topic_label = topic.get("label", "")
                    # Check if this topic can support Coding
                    if first_row.get("canUseJudge0", False):
                        # Additional safety check: verify topic doesn't contain frameworks
                        is_framework, framework_name = contains_unsupported_framework(topic_label, None)
                        if is_framework:
                            logger.warning(f"Topic '{topic_label}' has canUseJudge0=True but contains framework '{framework_name}'. Skipping Coding assignment.")
                            continue
                        # Update the first row to Coding
                        first_row["questionType"] = "Coding"
                        topic_updated = True
                        logger.info(f"Updated topic '{topic.get('label')}' to Coding type")
                        break
            
            if not topic_updated:
                # No topic supports Coding, skip it
                logger.warning("Coding type required but no topic supports canUseJudge0. Skipping Coding requirement.")
                continue
        
        else:
            # For MCQ, Subjective, PseudoCode: use semantic matching
            # Find the most semantically suitable topic using OpenAI
            best_topic_idx = await _find_semantically_suitable_topic(
                topics, missing_type
            )
            
            if best_topic_idx is not None:
                topic = topics[best_topic_idx]
                question_rows = topic.get("questionRows", [])
                if question_rows:
                    first_row = question_rows[0]
                    first_row["questionType"] = missing_type
                    # Ensure canUseJudge0 is False for non-Coding types
                    if missing_type != "Coding":
                        first_row["canUseJudge0"] = False
                    topic_updated = True
                    logger.info(f"Semantically updated topic '{topic.get('label')}' to {missing_type} type")
            
            # Fallback: if semantic matching didn't work, use first available topic
            if not topic_updated:
                for topic in topics:
                    question_rows = topic.get("questionRows", [])
                    if question_rows:
                        first_row = question_rows[0]
                        if first_row.get("questionType", "MCQ") != missing_type:
                            first_row["questionType"] = missing_type
                            if missing_type != "Coding":
                                first_row["canUseJudge0"] = False
                            topic_updated = True
                            logger.info(f"Fallback: Updated topic '{topic.get('label')}' to {missing_type} type")
                            break
            
            if not topic_updated:
                # Fallback: update the first topic that doesn't have this type
                for topic in topics:
                    question_rows = topic.get("questionRows", [])
                    if question_rows:
                        first_row = question_rows[0]
                        if first_row.get("questionType", "MCQ") != missing_type:
                            first_row["questionType"] = missing_type
                            if missing_type != "Coding":
                                first_row["canUseJudge0"] = False
                            topic_updated = True
                            logger.info(f"Fallback: Updated topic '{topic.get('label')}' to {missing_type} type")
                            break
    
    # Verify all required types are now present
    final_types = set()
    for topic in topics:
        question_rows = topic.get("questionRows", [])
        if question_rows:
            final_types.add(question_rows[0].get("questionType", "MCQ"))
    
    missing_after = required_types - final_types
    if missing_after:
        logger.warning(f"Still missing question types after post-processing: {missing_after}")
    else:
        logger.info(f"✅ All required question types are now present: {final_types}")
    
    return topics


def _get_openai_client() -> AsyncOpenAI:
    """Get OpenAI client instance."""
    settings = get_settings()
    api_key = getattr(settings, 'openai_api_key', None)
    if not api_key:
        raise ValueError("OpenAI API key not configured")
    return AsyncOpenAI(api_key=api_key)


async def generate_topics_v2(
    assessment_title: Optional[str],
    job_designation: str,
    selected_skills: List[str],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics using OpenAI with multi-row data model.
    Returns list of topics following exact structure:
    {
        "id": str,
        "label": str,
        "locked": False,
        "questionRows": [
            {
                "rowId": str,
                "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding",
                "difficulty": "Easy" | "Medium" | "Hard",
                "questionsCount": int,
                "canUseJudge0": bool,
                "status": "pending",
                "locked": False,
                "questions": []
            }
        ]
    }
    Each topic starts with ONE auto-generated questionRow.
    """
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    # Filter out unsupported frameworks from skills (since coding questions might be generated)
    # This ensures that topics with coding questions will only use Judge0-supported technologies
    filtered_skills = filter_judge0_unsupported_skills(selected_skills)
    
    # Check if any skills are Judge0-compatible programming languages
    # BUT exclude if the skill is a framework/library
    judge0_languages = ["python", "java", "javascript", "typescript", "c", "c++", "cpp", "go", "ruby", "php", "rust", "kotlin", "swift", "bash", "csharp", "cs"]
    has_judge0_compatible_skill = False
    has_framework_skill = False
    
    for skill in selected_skills:
        skill_lower = skill.lower().strip()
        # Check if skill is a framework/library (not supported by Judge0)
        if not is_judge0_supported(skill):
            has_framework_skill = True
            continue
        # Check if skill is a pure programming language
        if any(lang in skill_lower for lang in judge0_languages):
            has_judge0_compatible_skill = True
    
    # If we have framework skills, we should NOT require Coding topics
    # Only require Coding if we have pure programming languages (not frameworks)
    if has_framework_skill and not has_judge0_compatible_skill:
        has_judge0_compatible_skill = False
    
    if not filtered_skills:
        logger.warning("All skills were filtered out as unsupported by Judge0. Using original skills list.")
        filtered_skills = selected_skills
    
    skills_text = ", ".join(filtered_skills)
    title_text = assessment_title if assessment_title else "Not specified"
    
    prompt = f"""You are an expert assessment designer. Generate topics with UNIVERSAL, DOMAIN-AGNOSTIC question type assignment.

Generate a list of highly relevant assessment topics using:
- Job role/domain: {job_designation}
- Assessment title: {title_text}
- Selected skills: {skills_text}
- Experience mode: {experience_mode}
- Experience level: {experience_level}

For each topic, you must assign questionType based on SEMANTIC MEANING, not keywords:

1. SUBJECTIVE (explanation-oriented):
   Use for topics requiring:
   - Conceptual understanding, theoretical explanation
   - Architectural or design reasoning
   - Describing principles, rules, or ideas
   - Comparing and contrasting concepts
   - Topics where factual recall is insufficient
   
   Semantic intent: "explain", "describe", "why", "impact", "advantages", "concepts", "principles", "paradigms"

2. PSEUDOCODE (logic/algorithm-oriented):
   Use for topics involving:
   - Designing algorithms or workflows
   - Explaining process flow or problem-solving steps
   - Breaking down logic or structured thinking
   - Topics where logic and structured thinking are central
   
   Semantic intent: "algorithm", "workflow", "logic", "steps", "process", "how it works", "flow", "sequence"

3. CODING (implementation/execution-oriented):
   Use ONLY if the topic implies:
   - Writing functional, executable code
   - Implementation of features, modules, or algorithms
   - Tasks that can be executed with test cases
   
   Semantic intent: "implement", "build", "create", "write code", "solve", "program", "develop", "write function"
   Set canUseJudge0 = true ONLY for Coding topics.

4. MCQ (factual/basic/quick-assessment):
   Use for topics involving:
   - Terminology, facts, syntax-level understanding
   - Straightforward objective recall
   - Quick verification of knowledge
   
   Semantic intent: "basics", "fundamentals", "definition", "types", "components", "identify", "select", "choose"

CRITICAL RULES:
- Assign questionType based on SEMANTIC MEANING, not keyword matching
- Work for ANY domain: programming, cloud, DevOps, AI/ML, cybersecurity, databases, frameworks, etc.
- Do NOT hardcode technology-specific rules
- Ensure variety: aim for a balanced mix of question types across all topics

For each topic:
- Produce a topic label (specific, meaningful, assessment-ready)
- Select questionType using semantic understanding (MCQ | Subjective | PseudoCode | Coding)
- Assign difficulty: Easy | Medium | Hard
- Set canUseJudge0 = true ONLY for Coding topics

Return ONLY JSON:
[
  {{
    "label": "",
    "questionType": "",
    "difficulty": "",
    "canUseJudge0": true/false
  }}
]

Generate 8-12 topics. Return only the JSON array, no explanations."""

    try:
        client = _get_openai_client()
    except ValueError as exc:
        logger.error(f"OpenAI API key not configured: {exc}")
        raise HTTPException(status_code=500, detail="OpenAI API key not configured") from exc
    
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks or explanations outside the JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        topics_data = json.loads(content)
        
        # Transform to multi-row model format
        topics = []
        for idx, topic_data in enumerate(topics_data):
            question_type = topic_data.get("questionType", "MCQ")
            difficulty = topic_data.get("difficulty", "Medium")
            can_use_judge0 = topic_data.get("canUseJudge0", False)
            topic_label = topic_data.get("label", "")
            topic_label_lower = (topic_label or "").lower()
            
            # Validate question type
            if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding", "SQL", "AIML"]:
                question_type = "MCQ"
            
            # Validate difficulty
            if difficulty not in ["Easy", "Medium", "Hard"]:
                difficulty = "Medium"
            
            # Deterministic overrides for AIML/SQL/web topics (SQL/AIML ONLY for execution topics)
            if _v2_is_aiml_execution_topic(topic_label_lower):
                question_type = "AIML"
                can_use_judge0 = False
            elif _v2_is_sql_execution_topic(topic_label_lower):
                question_type = "SQL"
                can_use_judge0 = False
            elif _v2_contains_any(topic_label_lower, V2_WEB_KEYWORDS):
                impl_keywords = ["build", "create", "implement", "design", "develop", "write"]
                question_type = "Subjective" if _v2_contains_any(topic_label_lower, impl_keywords) else "MCQ"
                can_use_judge0 = False

            # If model returned SQL but it's not an execution SQL topic, downgrade
            if question_type == "SQL" and not _v2_is_sql_execution_topic(topic_label_lower):
                question_type = "Subjective" if any(k in topic_label_lower for k in ["vs", "versus", "difference", "compare", "comparison", "overview", "explained", "explain", "injection", "security"]) else "MCQ"
                can_use_judge0 = False
            # If model returned AIML but it's not an execution AIML topic, downgrade
            if question_type == "AIML" and not _v2_is_aiml_execution_topic(topic_label_lower):
                question_type = "Subjective"
                can_use_judge0 = False

            # CRITICAL: If question type is Coding, validate it's supported by Judge0
            # Check both the topic label and the skills list
            if question_type == "Coding":
                # Use comprehensive framework detection
                is_framework, framework_name = contains_unsupported_framework(topic_label, selected_skills)
                if is_framework:
                    logger.warning(f"Topic '{topic_label}' was assigned Coding but contains framework '{framework_name}'. Converting to PseudoCode.")
                    question_type = "PseudoCode"
                    can_use_judge0 = False
            
            # Ensure canUseJudge0 is only True for Coding
            if question_type != "Coding":
                can_use_judge0 = False
            
            # Create topic with first questionRow
            topic = {
                "id": str(uuid.uuid4()),
                "label": topic_data.get("label", ""),
                "locked": False,
                "questionRows": [
                    {
                        "rowId": str(uuid.uuid4()),
                        "questionType": question_type,
                        "difficulty": difficulty,
                        "questionsCount": 1,  # Default, can be updated by user
                        "canUseJudge0": can_use_judge0,
                        "status": "pending",
                        "locked": False,
                        "questions": []
                    }
                ]
            }
            
            topics.append(topic)
        
        # Don't force question types - let AI decide based on semantic meaning
        # Only filter out topics that have coding questions but are not supported by Judge0
        topics = filter_topics_with_coding_unsupported(topics)
        
        # Post-process: If programming languages are detected but no Coding topic exists, 
        # try to convert one appropriate topic to Coding
        if has_judge0_compatible_skill:
            has_coding_topic = any(
                topic.get("questionRows", [{}])[0].get("questionType") == "Coding"
                for topic in topics
            )
            
            if not has_coding_topic and topics:
                # Find the most suitable topic to convert to Coding
                # Prefer topics that mention algorithms, functions, or implementation
                coding_keywords = ["algorithm", "function", "implement", "code", "program", "solve", "write", "create", "build", "develop"]
                best_topic_idx = None
                best_score = 0
                
                for idx, topic in enumerate(topics):
                    label = topic.get("label", "").lower()
                    score = sum(1 for keyword in coding_keywords if keyword in label)
                    if score > best_score:
                        best_score = score
                        best_topic_idx = idx
                
                # If no good match found, use the first topic
                if best_topic_idx is None:
                    best_topic_idx = 0
                
                # Convert the selected topic to Coding
                if best_topic_idx < len(topics):
                    topic = topics[best_topic_idx]
                    topic_label = topic.get("label", "")
                    question_rows = topic.get("questionRows", [])
                    if question_rows:
                        # Validate that topic doesn't contain frameworks before converting
                        is_framework, framework_name = contains_unsupported_framework(topic_label, selected_skills)
                        if is_framework:
                            logger.warning(f"Cannot convert topic '{topic_label}' to Coding - contains framework '{framework_name}'. Keeping original type.")
                        else:
                            question_rows[0]["questionType"] = "Coding"
                            question_rows[0]["canUseJudge0"] = True
                            logger.info(f"Converted topic '{topic.get('label')}' to Coding type to meet requirement")
        
        return topics
        
    except json.JSONDecodeError as exc:
        logger.error(f"Failed to parse OpenAI response as JSON: {exc}")
        raise HTTPException(status_code=500, detail="Failed to parse topic generation response") from exc
    except Exception as exc:
        logger.error(f"Error generating topics: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate topics: {str(exc)}") from exc


async def generate_questions_for_row_v2(
    topic_label: str,
    question_type: str,
    difficulty: str,
    questions_count: int,
    can_use_judge0: bool,
    coding_language: str = "python",
    additional_requirements: Optional[str] = None,
    experience_mode: Optional[str] = None,
    website_summary: Optional[Dict[str, Any]] = None,
    company_context: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Generate questions for a single question row based on question type.
    Returns questions in appropriate format for each type.
    
    Args:
        topic_label: The topic label
        question_type: Type of question (MCQ, Subjective, PseudoCode, Coding)
        difficulty: Difficulty level (Easy, Medium, Hard)
        questions_count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used (for coding questions)
        coding_language: Programming language for coding questions (python, java, cpp, c, javascript, typescript, go, ruby)
        additional_requirements: Optional additional requirements for question generation
        experience_mode: Experience mode (corporate/student/college)
    """
    # Normalize question type (case-insensitive)
    question_type_normalized = question_type.strip()
    if question_type_normalized.lower() == "mcq":
        question_type_normalized = "MCQ"
    elif question_type_normalized.lower() == "subjective":
        question_type_normalized = "Subjective"
    elif question_type_normalized.lower() == "pseudocode":
        question_type_normalized = "PseudoCode"
    elif question_type_normalized.lower() == "coding":
        question_type_normalized = "Coding"
    elif question_type_normalized.lower() == "sql":
        question_type_normalized = "SQL"
    elif question_type_normalized.lower() in ["aiml", "ai/ml", "ai-ml", "ml", "machinelearning", "machine learning"]:
        question_type_normalized = "AIML"
    
    # Normalize experience mode
    if not experience_mode or experience_mode.lower() in ["student", "college"]:
        experience_mode = "college"
    else:
        experience_mode = "corporate"
    
    # Priority order for additional requirements/context:
    # 1. Topic/row-level additional_requirements (passed as parameter - highest priority)
    # 2. Company context (from textarea - text or URL summary)
    # 3. Website summary (legacy, only if no company_context)
    
    # Build context from company_context (new unified field) or website_summary (legacy)
    context_text = ""
    if company_context:
        # Use company context (from new textarea field)
        context_parts = []
        if company_context.get("company_name"):
            context_parts.append(f"Company: {company_context['company_name']}")
        if company_context.get("company_type"):
            context_parts.append(f"Industry: {company_context['company_type']}")
        if company_context.get("short_summary"):
            context_parts.append(f"Context: {company_context['short_summary']}")
        if company_context.get("key_topics") and len(company_context.get("key_topics", [])) > 0:
            context_parts.append(f"Key Topics: {', '.join(company_context['key_topics'])}")
        if context_parts:
            context_text = "\n".join(context_parts)
    elif website_summary and website_summary.get("useForQuestions"):
        # Legacy: use website summary if company_context not available
        context_parts = []
        if website_summary.get("company_name"):
            context_parts.append(f"Company: {website_summary['company_name']}")
        if website_summary.get("company_type"):
            context_parts.append(f"Industry: {website_summary['company_type']}")
        if website_summary.get("short_summary"):
            context_parts.append(f"Context: {website_summary['short_summary']}")
        if website_summary.get("key_topics"):
            context_parts.append(f"Key Topics: {', '.join(website_summary['key_topics'])}")
        if context_parts:
            context_text = "\n".join(context_parts)
    
    # final_additional_requirements: prioritize topic/row-level, then company context
    final_additional_requirements = additional_requirements
    if context_text and not additional_requirements:
        final_additional_requirements = context_text
    
    if question_type_normalized == "MCQ":
        return await _generate_mcq_questions(topic_label, difficulty, questions_count, experience_mode, final_additional_requirements)
    elif question_type_normalized == "Subjective":
        return await _generate_subjective_questions(topic_label, difficulty, questions_count, experience_mode, final_additional_requirements)
    elif question_type_normalized == "PseudoCode":
        return await _generate_pseudocode_questions(topic_label, difficulty, questions_count, experience_mode, final_additional_requirements)
    elif question_type_normalized == "Coding":
        return await _generate_coding_questions(topic_label, difficulty, questions_count, can_use_judge0, coding_language, experience_mode, final_additional_requirements)
    elif question_type_normalized == "SQL":
        return await _generate_sql_questions(topic_label, difficulty, questions_count, experience_mode, final_additional_requirements)
    elif question_type_normalized == "AIML":
        return await _generate_aiml_questions(topic_label, difficulty, questions_count, experience_mode, final_additional_requirements)
    else:
        logger.error(f"Unsupported question type: {question_type} (normalized: {question_type_normalized})")
        raise HTTPException(status_code=400, detail=f"Unsupported question type: {question_type}. Supported types: MCQ, Subjective, PseudoCode, Coding, SQL, AIML")


# Keep old function name for backward compatibility during transition
async def generate_questions_for_topic_v2(
    topic_label: str,
    question_type: str,
    difficulty: str,
    questions_count: int,
    can_use_judge0: bool,
    coding_language: str = "python"
) -> List[Dict[str, Any]]:
    """Alias for generate_questions_for_row_v2 for backward compatibility."""
    return await generate_questions_for_row_v2(topic_label, question_type, difficulty, questions_count, can_use_judge0, coding_language)


async def _generate_mcq_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate MCQ questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - MCQ must include exactly 4 options
    - One correct answer
    - Should NOT be overly simple syntax questions unless topic requires it
    - Should match the difficulty level
    - Generate both question + options + correctAnswer
    """
    # Normalize experience mode
    if not experience_mode or experience_mode.lower() in ["student", "college"]:
        experience_mode = "college"
    else:
        experience_mode = "corporate"
    
    # Build experience mode rules
    experience_rules = ""
    if experience_mode == "college":
        experience_rules = "\nCOLLEGE MODE RULES:\n- Beginner/intermediate academic level\n- Avoid enterprise/production terminology\n- Use small academic examples\n- Focus on conceptual understanding\n- NO job-role context\n"
    else:
        experience_rules = "\nCORPORATE MODE RULES:\n- Realistic, industry-driven scenarios\n- Include production workflows, optimization, best practices\n- Use professional terminology\n- Expect deeper critical thinking\n"
    
    additional_req_text = ""
    if additional_requirements:
        additional_req_text = f"\nAdditional Requirements: {additional_requirements}\n"
    
    prompt = f"""You are an expert technical assessment writer. Generate {count} Multiple Choice Question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Each question MUST have exactly 4 options (no more, no less)
2. One option must be the correct answer
3. Difficulty level: {difficulty}
4. Questions should match the difficulty level - avoid overly simple syntax questions unless the topic specifically requires it
5. Options should be plausible and well-distributed (not obviously wrong)
6. The correct answer should be clearly correct but not trivial
7. Experience mode: {experience_mode}{experience_rules}{additional_req_text}
8. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, contexts, and problem types. If generating multiple questions, ensure they cover different aspects or applications of the topic.

Output format (JSON array):
[
  {{
    "question": "<the question text>",
    "options": ["<option 1>", "<option 2>", "<option 3>", "<option 4>"],
    "correctAnswer": "<the exact text of the correct option>"
  }}
]

IMPORTANT:
- The correctAnswer must match EXACTLY one of the options (case-sensitive)
- All 4 options must be distinct and meaningful
- Return ONLY a JSON array. No markdown, no explanations."""

    try:
        client = _get_openai_client()
        system_message = "You are an expert assessment writer. Always return valid JSON arrays. Never include markdown code blocks."
        if experience_mode == "college":
            system_message += " Generate questions appropriate for college/student level - avoid enterprise terminology and focus on academic concepts."
        else:
            system_message += " Generate questions appropriate for corporate/professional level - use industry terminology and real-world scenarios."
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_message
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "MCQ questions JSON")
        
        # Validate questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "question" in q and "options" in q and "correctAnswer" in q:
                options = q["options"]
                if isinstance(options, list) and len(options) == 4:
                    # Verify correctAnswer matches one of the options
                    correct_answer = q["correctAnswer"]
                    if correct_answer in options:
                        validated_questions.append(q)
                    else:
                        logger.warning(f"MCQ correctAnswer doesn't match any option, skipping question")
                else:
                    logger.warning(f"MCQ doesn't have exactly 4 options, skipping question")
            else:
                logger.warning(f"MCQ missing required fields, skipping question")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid MCQ questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating MCQ questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate MCQ questions: {str(exc)}") from exc


def _is_url(text: str) -> bool:
    """
    Check if the given text is a URL.
    
    Args:
        text: Text to check
        
    Returns:
        True if text is a URL, False otherwise
    """
    if not text or not isinstance(text, str):
        return False
    
    text = text.strip()
    if not text:
        return False
    
    # Check if it starts with http:// or https://
    if text.startswith(("http://", "https://")):
        try:
            result = urlparse(text)
            return all([result.scheme, result.netloc])
        except Exception:
            return False
    
    return False


async def _fetch_and_summarize_url(url: str) -> str:
    """
    Fetch content from URL and summarize it using OpenAI.
    
    Args:
        url: URL to fetch and summarize
        
    Returns:
        Summarized text from the URL
    """
    if not httpx:
        logger.error("httpx not available, cannot fetch URL")
        raise HTTPException(status_code=500, detail="URL fetching not available")
    
    try:
        # Fetch URL content
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, max_redirects=5) as client:
            response = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            response.raise_for_status()
            content = response.text
        
        # Limit content length to avoid token limits (first 10000 characters)
        content_preview = content[:10000] if len(content) > 10000 else content
        
        # Summarize using OpenAI
        client = _get_openai_client()
        summarize_prompt = f"""Please summarize the following content from a webpage. 
Extract the key information, main points, and important details that would be useful for generating technical assessment questions.

Content:
{content_preview}

Provide a concise but comprehensive summary (200-500 words) that captures the essential information:"""

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at summarizing technical content. Provide clear, concise summaries that capture key information."
                },
                {"role": "user", "content": summarize_prompt}
            ],
            temperature=0.3,
        )
        
        summary = response.choices[0].message.content.strip()
        logger.info(f"Successfully fetched and summarized URL: {url[:50]}...")
        return summary
        
    except Exception as exc:
        logger.error(f"Error fetching or summarizing URL {url}: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch or summarize URL: {str(exc)}") from exc


async def _process_requirements_for_subjective(requirements: Optional[str]) -> Optional[str]:
    """
    Process requirements text for subjective question generation.
    - If it's a URL, fetch and summarize it
    - If it's plain text, use it directly
    
    Args:
        requirements: Requirements text or URL
        
    Returns:
        Processed requirements text (summarized if URL, original if text, None if empty)
    """
    if not requirements or not requirements.strip():
        return None
    
    requirements = requirements.strip()
    
    # Check if it's a URL
    if _is_url(requirements):
        logger.info(f"Detected URL in requirements, fetching and summarizing: {requirements[:50]}...")
        try:
            summarized = await _fetch_and_summarize_url(requirements)
            return summarized
        except Exception as exc:
            logger.warning(f"Failed to fetch/summarize URL, using URL as-is: {exc}")
            # Fallback: return a note about the URL
            return f"Reference URL: {requirements}"
    
    # It's plain text, use it directly
    return requirements


async def _generate_sql_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate SQL questions using structured format from DSA SQL generator.
    Returns questions with schemas, sample_data, constraints, starter_query, etc.
    Similar to how coding questions use DSA generator.
    """
    # Normalize difficulty format (Easy/Medium/Hard to easy/medium/hard)
    difficulty_map = {
        "Easy": "easy",
        "Medium": "medium",
        "Hard": "hard"
    }
    difficulty_lower = difficulty_map.get(difficulty, difficulty.lower())

    # Use DSA SQL generator if available
    if DSA_AVAILABLE and dsa_generate_sql_question is not None:
        try:
            questions = []
            for i in range(count):
                # Generate using DSA SQL generator
                sql_question_data = await dsa_generate_sql_question(
                    difficulty=difficulty_lower,
                    topic=topic,
                    concepts=additional_requirements  # Pass additional requirements as concepts
                )
                
                # Validate that we got valid data
                if not sql_question_data or not isinstance(sql_question_data, dict):
                    logger.warning(f"Invalid SQL question data returned from DSA generator: {type(sql_question_data)}")
                    continue
                
                # Build questionText from description, schemas, and sample_data
                question_text_parts = [sql_question_data.get("description", "")]
                
                # Add schemas section
                schemas = sql_question_data.get("schemas", {})
                if schemas:
                    question_text_parts.append("\n\nDatabase Schema:")
                    for table_name, table_info in schemas.items():
                        columns = table_info.get("columns", {})
                        if columns:
                            question_text_parts.append(f"\n{table_name}:")
                            for col_name, col_type in columns.items():
                                question_text_parts.append(f"  - {col_name}: {col_type}")
                
                # Add sample data section
                sample_data = sql_question_data.get("sample_data", {})
                if sample_data:
                    question_text_parts.append("\n\nSample Data:")
                    for table_name, rows in sample_data.items():
                        if rows:
                            question_text_parts.append(f"\n{table_name}:")
                            # Show first few rows as examples
                            for row_idx, row in enumerate(rows[:3], 1):
                                question_text_parts.append(f"  Row {row_idx}: {row}")
                            if len(rows) > 3:
                                question_text_parts.append(f"  ... ({len(rows) - 3} more rows)")
                
                # Add constraints
                constraints = sql_question_data.get("constraints", [])
                if constraints:
                    question_text_parts.append("\n\nRequirements:")
                    for constraint in constraints:
                        question_text_parts.append(f"- {constraint}")
                
                question_text = "\n".join(question_text_parts)
                
                # Build the question object in assessment format
                question = {
                    "question": question_text,  # For backward compatibility with existing UI
                    "questionText": question_text,  # Alternative field name
                    "type": "SQL",
                    "difficulty": difficulty,
                    # Store full SQL-specific structured data for later use
                    "sql_data": {
                        "title": sql_question_data.get("title", ""),
                        "description": sql_question_data.get("description", ""),
                        "difficulty": sql_question_data.get("difficulty", difficulty_lower),
                        "sql_category": sql_question_data.get("sql_category", "select"),
                        "schemas": schemas,
                        "sample_data": sample_data,
                        "constraints": constraints,
                        "starter_query": sql_question_data.get("starter_query", "-- Write your SQL query here\n\nSELECT "),
                        "hints": sql_question_data.get("hints", []),
                        "evaluation": sql_question_data.get("evaluation", {
                            "engine": "postgres",
                            "comparison": "result_set",
                            "order_sensitive": False
                        })
                    }
                }
                
                questions.append(question)
            
            if not questions:
                raise HTTPException(status_code=500, detail="Failed to generate any SQL questions")
            
            return questions
            
        except Exception as exc:
            logger.error(f"Error generating SQL questions using DSA generator: {exc}", exc_info=True)
            # Fall through to basic generation if DSA generator fails
    
    # Fallback to basic generation if DSA SQL generator not available
    logger.warning("DSA SQL generator not available, using basic SQL question generation")
    # Normalize experience mode
    if not experience_mode or experience_mode.lower() in ["student", "college"]:
        experience_mode = "college"
    else:
        experience_mode = "corporate"

    additional_req_text = ""
    if additional_requirements:
        additional_req_text = f"\nAdditional Requirements: {additional_requirements}\n"

    prompt = f"""You are an expert SQL assessor. Generate {count} SQL question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Each question MUST be practical and test SQL competency (queries, joins, aggregations, schema reasoning, indexes, transactions).
2. Difficulty level: {difficulty}
3. Each question MUST include a small schema description (tables + key columns) inside the question text.
4. The question MUST ask the candidate to write a SQL query (or multiple queries) to solve the task.
5. Do NOT include answers or expected output.
6. Experience mode: {experience_mode}{additional_req_text}
7. Keep it runnable in a typical SQL sandbox (avoid vendor-specific features unless required by the topic).
8. **CRITICAL DIVERSITY REQUIREMENT**: questions must be different from each other.

Output format (JSON array):
[
  {{
    "question": "<SQL scenario + schema + task>"
  }}
]

Return ONLY the JSON array. No markdown, no explanations."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert SQL assessment writer. Always return valid JSON arrays. Never include markdown code blocks or any answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )

        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "SQL questions JSON")

        validated_questions: List[Dict[str, Any]] = []
        for q in questions:
            if isinstance(q, dict) and "question" in q and isinstance(q["question"], str):
                qt = q["question"].strip()
                if len(qt) > 40:
                    validated_questions.append({"question": qt})
        return validated_questions[:count]
    except Exception as exc:
        logger.error(f"Error generating SQL questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate SQL questions: {str(exc)}") from exc


async def _generate_aiml_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate AIML (AI/ML + data science) questions using structured format from AIML generator.
    Returns questions with datasets (schema + rows), tasks, constraints, etc.
    Similar to how coding questions use DSA generator.
    """
    # Normalize difficulty format (Easy/Medium/Hard to easy/medium/hard)
    difficulty_map = {
        "Easy": "easy",
        "Medium": "medium",
        "Hard": "hard"
    }
    difficulty_lower = difficulty_map.get(difficulty, difficulty.lower())

    # Use AIML generator if available
    if AIML_AVAILABLE and aiml_generate_question is not None:
        try:
            questions = []
            for i in range(count):
                # Generate using AIML generator
                # Build a title from the topic
                title = f"AIML Assessment - {topic}"
                
                # Determine skill from topic (default to Machine Learning)
                skill = "Machine Learning"
                topic_lower = topic.lower()
                if "python" in topic_lower or "numpy" in topic_lower:
                    skill = "Python"
                elif "deep learning" in topic_lower or "neural" in topic_lower or "tensorflow" in topic_lower or "pytorch" in topic_lower:
                    skill = "Deep Learning"
                elif "data science" in topic_lower or "pandas" in topic_lower or "data analysis" in topic_lower:
                    skill = "Data Science"
                elif "ai" in topic_lower and "machine learning" not in topic_lower:
                    skill = "AI"
                
                aiml_question_data = await aiml_generate_question(
                    title=title,
                    skill=skill,
                    topic=topic if topic else None,
                    difficulty=difficulty_lower,
                    dataset_format="csv"  # Default format, backend will handle conversion
                )
                
                # Validate that we got valid data
                if not aiml_question_data or not isinstance(aiml_question_data, dict):
                    logger.warning(f"Invalid AIML question data returned from AIML generator: {type(aiml_question_data)}")
                    continue
                
                # Extract question and dataset from response
                question_info = aiml_question_data.get("question", {})
                dataset_info = aiml_question_data.get("dataset")
                
                # Build questionText from description, tasks, constraints, and dataset info with formatted tables
                question_text_parts = [question_info.get("description", "")]
                
                # Add tasks
                tasks = question_info.get("tasks", [])
                if tasks:
                    question_text_parts.append("\n\n### 📝 Tasks")
                    for task_idx, task in enumerate(tasks, 1):
                        question_text_parts.append(f"{task_idx}. {task}")
                
                # Add dataset info if present with formatted tables
                if dataset_info:
                    schema = dataset_info.get("schema", [])
                    rows = dataset_info.get("rows", [])
                    
                    if schema:
                        question_text_parts.append("\n\n### 📊 Dataset Schema")
                        question_text_parts.append("\n| Column | Type |")
                        question_text_parts.append("|--------|------|")
                        for col in schema:
                            col_name = col.get("name", "")
                            col_type = col.get("type", "")
                            question_text_parts.append(f"| `{col_name}` | `{col_type}` |")
                    
                    if rows and len(rows) > 0:
                        question_text_parts.append(f"\n\n### 📋 Sample Data ({len(rows)} rows)")
                        
                        # Get column names from schema
                        column_names = [col.get("name", f"Column_{i+1}") for i, col in enumerate(schema)] if schema else []
                        if not column_names and len(rows) > 0:
                            # Infer column names from first row length
                            column_names = [f"Column_{i+1}" for i in range(len(rows[0]))]
                        
                        if column_names:
                            # Create table header
                            header_row = "| " + " | ".join([f"`{col}`" for col in column_names]) + " |"
                            separator = "| " + " | ".join(["---" for _ in column_names]) + " |"
                            question_text_parts.append(header_row)
                            question_text_parts.append(separator)
                            
                            # Add data rows (show ALL rows for AIML questions - full dataset)
                            for row in rows:
                                if isinstance(row, list):
                                    # Format values for display
                                    formatted_values = []
                                    for val in row:
                                        val_str = str(val).strip()
                                        if val_str == "None" or val_str == "" or val_str.lower() == "null":
                                            formatted_values.append("*NULL*")
                                        elif len(val_str) > 30:
                                            # Truncate long values
                                            formatted_values.append(f"`{val_str[:27]}...`")
                                        else:
                                            formatted_values.append(f"`{val_str}`")
                                    
                                    question_text_parts.append("| " + " | ".join(formatted_values) + " |")
                        else:
                            # Fallback: simple list format
                            for row_idx, row in enumerate(rows[:3], 1):
                                row_str = str(row) if not isinstance(row, list) else json.dumps(row)
                                question_text_parts.append(f"  Row {row_idx}: `{row_str}`")
                            if len(rows) > 3:
                                question_text_parts.append(f"  *... ({len(rows) - 3} more rows)*")
                
                # Add constraints/requirements
                constraints = question_info.get("constraints", [])
                if constraints:
                    question_text_parts.append("\n\n### ✅ Constraints")
                    for constraint in constraints:
                        question_text_parts.append(f"- {constraint}")
                
                # Add libraries info
                libraries = aiml_question_data.get("assessment", {}).get("libraries", [])
                if libraries:
                    question_text_parts.append(f"\n\n### 📚 Required Libraries")
                    question_text_parts.append(f"{', '.join(libraries)}")
                
                question_text = "\n".join(question_text_parts)
                
                # Build the question object in assessment format
                question = {
                    "question": question_text,  # For backward compatibility with existing UI
                    "questionText": question_text,  # Alternative field name
                    "type": "AIML",
                    "difficulty": difficulty,
                    # Store full AIML-specific structured data for later use
                    "aiml_data": {
                        "title": aiml_question_data.get("assessment", {}).get("title", title),
                        "description": question_info.get("description", ""),
                        "difficulty": difficulty_lower,
                        "skill": aiml_question_data.get("assessment", {}).get("skill", skill),
                        "topic": aiml_question_data.get("assessment", {}).get("topic", topic),
                        "libraries": aiml_question_data.get("assessment", {}).get("libraries", []),
                        "type": question_info.get("type", "aiml_coding"),
                        "execution_environment": question_info.get("execution_environment", "jupyter_notebook"),
                        "tasks": tasks,
                        "constraints": constraints,
                        "dataset": dataset_info,  # Full dataset with schema and rows
                        "requires_dataset": dataset_info is not None
                    }
                }
                
                questions.append(question)
            
            if not questions:
                raise HTTPException(status_code=500, detail="Failed to generate any AIML questions")
            
            return questions
            
        except Exception as exc:
            logger.error(f"Error generating AIML questions using AIML generator: {exc}", exc_info=True)
            # Fall through to basic generation if AIML generator fails
    
    # Fallback to basic generation if AIML generator not available
    logger.warning("AIML generator not available, using basic AIML question generation")
    # Normalize experience mode
    if not experience_mode or experience_mode.lower() in ["student", "college"]:
        experience_mode = "college"
    else:
        experience_mode = "corporate"

    additional_req_text = ""
    if additional_requirements:
        additional_req_text = f"\nAdditional Requirements: {additional_requirements}\n"

    prompt = f"""You are an expert AI/ML assessor. Generate {count} notebook-style AIML question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Questions MUST test practical data science / ML competency (pandas/numpy/sklearn concepts, evaluation, preprocessing, feature engineering, model selection).
2. Difficulty level: {difficulty}
3. Each question MUST be self-contained: include a small dataset description (columns + meaning) or a toy sample table in the question text.
4. Ask for steps/code as if in a Jupyter notebook, but do NOT require execution here and do NOT include answers.
5. Do NOT ask for web/framework work (no React/DOM/Express).
6. Experience mode: {experience_mode}{additional_req_text}
7. **CRITICAL DIVERSITY REQUIREMENT**: questions must be different from each other.

Output format (JSON array):
[
  {{
    "question": "<AIML scenario + dataset description + tasks>"
  }}
]

Return ONLY the JSON array. No markdown, no explanations."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert AI/ML assessment writer. Always return valid JSON arrays. Never include markdown code blocks or any answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.75,
        )

        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "AIML questions JSON")

        validated_questions: List[Dict[str, Any]] = []
        for q in questions:
            if isinstance(q, dict) and "question" in q and isinstance(q["question"], str):
                qt = q["question"].strip()
                if len(qt) > 40:
                    validated_questions.append({"question": qt})
        return validated_questions[:count]
    except Exception as exc:
        logger.error(f"Error generating AIML questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate AIML questions: {str(exc)}") from exc


async def _generate_subjective_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate Subjective questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - ONLY scenario-based, real-world, case-study style questions
    - Minimum 2-4 sentences
    - Requires reasoning, explanation, trade-offs, evaluation
    - NO: MCQ-like phrasing, "which of the following", one-liners
    - Should reflect real-world usage of the topic
    - Must be context-aware (topic, category, difficulty, experience mode)
    
    Difficulty Mapping:
    - EASY → simple but meaningful real-life context
    - MEDIUM → multi-step reasoning with explanation
    - HARD → deep design decisions, constraints, trade-offs
    """
    # Context-aware scenario generation based on experience mode
    if experience_mode == "college":
        context_guidance = """
        Scenarios should relate to:
        - Academic projects
        - Mini-projects
        - Lab tasks
        - Internships
        - Programming assignments
        """
    else:  # corporate
        context_guidance = """
        Scenarios should relate to:
        - Production systems
        - Debugging real issues
        - Business workflows
        - System design choices
        - Team collaboration
        - Customer-facing problems
        """
    
    # Difficulty-specific requirements
    difficulty_requirements = {
        "Easy": "Simple but meaningful real-life context. Short scenario, simple decision or explanation needed.",
        "Medium": "Multi-step scenario with constraints or trade-offs. Requires reasoning and explanation.",
        "Hard": "Complex real-world scenario with multiple stakeholders or constraints. Deep design decisions, trade-offs, and evaluation required."
    }
    
    difficulty_req = difficulty_requirements.get(difficulty, difficulty_requirements["Medium"])
    
    # Process requirements: if URL, fetch and summarize; if text, use directly
    processed_requirements = None
    if additional_requirements:
        processed_requirements = await _process_requirements_for_subjective(additional_requirements)
    
    additional_req_text = ""
    if processed_requirements:
        additional_req_text = f"\n11. Additional Requirements: {processed_requirements}\n"
    
    prompt = f"""You are an expert technical assessment writer. Generate {count} scenario-based subjective question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based, real-world, case-study style questions
2. Each question MUST be minimum 2-4 sentences
3. Questions MUST require reasoning, explanation, trade-offs, or evaluation
4. NO MCQ-like phrasing (no "which of the following", no multiple choice options)
5. NO one-liner questions
6. Questions should reflect real-world usage of the topic: {topic}
7. Difficulty level: {difficulty}
8. {difficulty_req}
9. Experience mode: {experience_mode}
10. {context_guidance}{additional_req_text}
12. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, contexts, stakeholders, and problem types. If generating multiple questions, ensure they cover different aspects or applications of the topic.

EXAMPLES OF GOOD QUESTIONS:
- "You are working on a production e-commerce system that processes thousands of orders per minute. During peak hours, you notice the database connection pool is exhausted, causing transaction failures. Describe your approach to diagnose and resolve this issue, considering both immediate fixes and long-term scalability."
- "A team is building a mobile app that needs to sync data across devices. They're debating between using a local-first architecture with eventual consistency versus a server-authoritative approach. Explain the trade-offs of each approach and recommend which one to use for a collaborative note-taking app."
- "You're tasked with refactoring a legacy codebase that has tight coupling between components. The current system works but is difficult to test and extend. Outline your strategy for refactoring while maintaining system stability and minimizing downtime."

EXAMPLES OF BAD QUESTIONS (DO NOT GENERATE THESE):
- "What is {topic}?" (too simple, definition-level)
- "Explain {topic}." (no scenario, no context)
- "Which of the following is true about {topic}?" (MCQ-like phrasing)
- "List the benefits of {topic}." (too trivial)

Output format (JSON array):
[
  {{
    "question": "<scenario-based question text, 2-4 sentences minimum>"
  }}
]

DO NOT include idealAnswer, expectedAnswer, or any answer fields.
Return ONLY a JSON array with question text."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in scenario-based technical questions. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Subjective questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "question" in q:
                question_text = q["question"].strip()
                # Ensure minimum length (at least 2 sentences)
                if len(question_text) > 50 and question_text.count('.') >= 1:
                    validated_questions.append({"question": question_text})
                else:
                    logger.warning(f"Generated subjective question too short or invalid, skipping: {question_text[:50]}...")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid subjective questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Subjective questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Subjective questions: {str(exc)}") from exc


async def _generate_pseudocode_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate Pseudocode questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - Generate a pseudocode-related question ONLY
    - Should require algorithmic thinking
    - Must be scenario-based, not trivial
    - DO NOT generate the answer
    - Answer will be evaluated by AI scoring model
    """
    additional_req_text = ""
    if additional_requirements:
        additional_req_text = f"\n9. Additional Requirements: {additional_requirements}\n"
    
    prompt = f"""You are an expert technical assessor. Generate {count} pseudocode question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based pseudocode questions (not trivial syntax questions)
2. Questions MUST require algorithmic thinking and problem-solving
3. Difficulty level: {difficulty}
4. Questions should describe a real-world problem that requires algorithmic logic
5. Include sample input/output scenarios in the question text
6. The question should ask for pseudocode, not executable code
7. Avoid syntax tied to any specific programming language
8. Experience mode: {experience_mode}{additional_req_text}
10. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, problem types, and algorithmic approaches.

DO NOT include:
- expectedAnswer
- explanation
- idealAnswer
- Any answer fields

The question text should:
- Describe a scenario or problem
- Include sample input/output examples
- Ask the candidate to write pseudocode to solve it
- Be suitable for evaluation in an interview or assessment

Output format (JSON array):
[
  {{
    "questionText": "<scenario-based pseudocode question text with sample input/output>"
  }}
]

Example good question:
{{
  "questionText": "You are designing an algorithm for a ride-sharing app to match drivers with passengers. Given a list of available drivers (each with their current location coordinates) and a list of ride requests (each with pickup location coordinates), write pseudocode to match each request to the nearest available driver. Include sample input: drivers = [(10, 20), (15, 25), (5, 10)], requests = [(12, 22), (8, 15)]. Expected output: request 1 → driver 1, request 2 → driver 3."
}}

Return ONLY valid JSON. No markdown, no explanations, NO answer fields."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in algorithmic problems. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "PseudoCode questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "questionText" in q:
                question_text = q["questionText"].strip()
                # Remove any answer fields if present
                clean_question = {"questionText": question_text}
                validated_questions.append(clean_question)
            elif isinstance(q, dict) and "question" in q:
                # Handle alternative field name
                question_text = q["question"].strip()
                validated_questions.append({"questionText": question_text})
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid pseudocode questions out of {count} requested")
        
        return validated_questions[:count]
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error generating PseudoCode questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate PseudoCode questions: {str(exc)}") from exc


def _get_starter_code_template(language: str) -> str:
    """
    Get starter code template for a given language.
    
    Args:
        language: Programming language (python, java, cpp, c, javascript, typescript, go, ruby)
        
    Returns:
        Starter code template string
    """
    templates = {
        "python": """def solve():
    # Write your logic here
    pass""",
        "java": """public class Solution {
    public static void solve() {
        // Write your logic here
    }
    public static void main(String[] args) {
        // Do not modify this method
    }
}""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

void solve() {
    // Write your logic here
}

int main() {
    // Locked main function
    return 0;
}""",
        "c": """#include <stdio.h>

void solve() {
    // Write your logic here
}

int main() {
    // Do not modify main, input/output handled here
    return 0;
}""",
        "javascript": """function solve(input) {
    // Write your logic here
}""",
        "typescript": """function solve(input: string): string {
    // Write your logic here
}""",
        "go": """package main

import "fmt"

func solve() {
    // Write your logic here
}

func main() {
    // Do not modify this method
}""",
        "ruby": """def solve
    # Write your logic here
end""",
    }
    return templates.get(language.lower(), templates["python"])


def _get_judge0_language_id(language: str) -> int:
    """
    Get Judge0 language ID for a given language.
    
    Args:
        language: Programming language name
        
    Returns:
        Judge0 language ID
    """
    language_id_map = {
        "python": 71,      # Python 3
        "java": 62,        # Java
        "cpp": 54,         # C++ (GCC)
        "c": 50,           # C (GCC)
        "javascript": 63,  # Node.js
        "typescript": 74,  # TypeScript
        "go": 60,          # Go
        "ruby": 72,        # Ruby
    }
    return language_id_map.get(language.lower(), 71)  # Default to Python


async def _generate_coding_questions(topic: str, difficulty: str, count: int, can_use_judge0: bool, coding_language: str = "python", experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate Coding questions (Judge0-compatible) using DSA module architecture.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language for coding questions (python, java, cpp, c, javascript, typescript, go, ruby)
    
    Returns questions in DSA-compatible format with:
    - questionText (description + examples + constraints)
    - starterCode (for specified language)
    - visibleTestCases (public test cases)
    - hiddenTestCases (hidden test cases)
    - constraints
    - functionSignature
    - explanation (optional)
    - language (Judge0 language ID)
    """
    if not can_use_judge0:
        raise HTTPException(status_code=400, detail="Coding questions require canUseJudge0 to be true")
    
    # Normalize language
    coding_language = coding_language.lower()
    if coding_language not in ["python", "java", "cpp", "c", "javascript", "typescript", "go", "ruby"]:
        logger.warning(f"Unknown language '{coding_language}', defaulting to 'python'")
        coding_language = "python"
    
    # Use DSA module's AI generator if available
    if DSA_AVAILABLE and dsa_generate_question is not None:
        try:
            # Generate questions using DSA module (one at a time for count > 1)
            questions = []
            for i in range(count):
                # Map difficulty: Easy -> easy, Medium -> medium, Hard -> hard
                dsa_difficulty = difficulty.lower()
                
                # Generate using DSA module with the specified language
                dsa_question = await dsa_generate_question(
                    difficulty=dsa_difficulty,
                    topic=topic,
                    concepts=None,
                    languages=[coding_language]  # Use the specified language
                )
                
                # Transform DSA format to assessment format
                # DSA format has: title, description, examples, constraints, public_testcases, hidden_testcases, starter_code, function_signature
                # Assessment format needs: questionText, starterCode, visibleTestCases, hiddenTestCases, constraints, functionSignature, explanation
                
                # Build questionText from description + examples
                question_text = dsa_question.get("description", "")
                
                # Add examples if available
                examples = dsa_question.get("examples", [])
                if examples:
                    question_text += "\n\nExamples:\n"
                    for idx, ex in enumerate(examples, 1):
                        question_text += f"\nExample {idx}:\n"
                        question_text += f"Input: {ex.get('input', '')}\n"
                        question_text += f"Output: {ex.get('output', '')}\n"
                        if ex.get("explanation"):
                            question_text += f"Explanation: {ex.get('explanation')}\n"
                
                # Get starter code for the specified language
                starter_code_dict = dsa_question.get("starter_code", {})
                starter_code = starter_code_dict.get(coding_language) if starter_code_dict else ""
                # Fallback to template if DSA didn't provide starter code for this language
                if not starter_code:
                    starter_code = _get_starter_code_template(coding_language)
                
                # Transform test cases
                visible_testcases = []
                for tc in dsa_question.get("public_testcases", []):
                    visible_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                hidden_testcases = []
                for tc in dsa_question.get("hidden_testcases", []):
                    hidden_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                # Get constraints
                constraints_list = dsa_question.get("constraints", [])
                constraints_text = "\n".join(f"- {c}" for c in constraints_list) if constraints_list else ""
                
                # Get function signature and validate/fix it
                func_sig_raw = dsa_question.get("function_signature", {})
                title = dsa_question.get("title", topic)
                func_sig = _validate_and_fix_function_signature(func_sig_raw, topic=topic, title=title, context="DSA module")
                
                # Format function signature as string for frontend editing
                func_sig_string = ""
                if func_sig and isinstance(func_sig, dict):
                    func_name = func_sig.get("name", "function")
                    params = func_sig.get("parameters", [])
                    return_type = func_sig.get("return_type", "void")
                    if params:
                        param_str = ", ".join([f"{p.get('name', '')}: {p.get('type', '')}" for p in params if isinstance(p, dict)])
                    else:
                        param_str = ""
                    func_sig_string = f"{func_name}({param_str}): {return_type}"
                
                # Extract title and problem statement for legacy format
                title = dsa_question.get("title", topic)
                problem_statement = dsa_question.get("description", question_text)
                
                # Extract input/output format and sample input/output from first example
                input_format = ""
                output_format = ""
                sample_input = ""
                sample_output = ""
                if examples and len(examples) > 0:
                    first_example = examples[0]
                    sample_input = first_example.get("input", "")
                    sample_output = first_example.get("output", "")
                    # Try to infer format from examples
                    if sample_input:
                        input_format = "See sample input format below"
                    if sample_output:
                        output_format = "See sample output format below"
                
                # Build assessment question object with both new and legacy formats
                assessment_question = {
                    # New format (DSA-compatible)
                    "questionText": question_text,
                    "starterCode": starter_code,
                    "visibleTestCases": visible_testcases,
                    "hiddenTestCases": hidden_testcases,
                    "constraints": constraints_text,
                    "functionSignature": func_sig,  # Keep as object for display
                    "difficulty": difficulty,
                    "explanation": f"This problem tests understanding of {topic} at {difficulty} level.",
                    "language": str(_get_judge0_language_id(coding_language)),  # Store Judge0 language ID
                    "codingLanguage": coding_language,  # Store language name for frontend
                    # Legacy format (for frontend editing compatibility)
                    "title": title,
                    "problemStatement": problem_statement,
                    "inputFormat": input_format,
                    "outputFormat": output_format,
                    "sampleInput": sample_input,
                    "sampleOutput": sample_output,
                    # Function signature as string for textarea editing (frontend expects string, not object)
                    "functionSignatureString": func_sig_string,
                }
                
                questions.append(assessment_question)
            
            return questions
            
        except Exception as dsa_exc:
            logger.warning(f"DSA module generation failed, falling back to basic generation: {dsa_exc}")
            # Fall through to basic generation
    
    # Fallback: Basic generation if DSA module not available or failed
    starter_template = _get_starter_code_template(coding_language)
    prompt = f"""Generate {count} fully Judge0-compatible coding questions for: {topic}.

Difficulty: {difficulty}
Programming Language: {coding_language.upper()}

CRITICAL REQUIREMENTS:
1. You MUST generate the starter code and solution template in {coding_language.upper()}.
2. NEVER produce Python code unless language=python.
3. The template must follow standard function-signature patterns of {coding_language.upper()}.
4. Use the {coding_language.upper()} starter code template provided below.
5. DO NOT generate the final solution or answer code - only starter code with function signature
6. The system will evaluate using Judge0 test cases

Starter Code Template for {coding_language.upper()}:
{starter_template}

Each question must include:
- questionText (problem description with examples, constraints, and input/output format)
- starterCode ({coding_language.upper()} starter code with function signature matching the template above - incomplete, candidate must fill in logic)
- visibleTestCases (2-3 public test cases with input/output)
- hiddenTestCases (3-5 hidden test cases with input/output)
- constraints (list of constraints as string)
- functionSignature (name, parameters, return_type - must match {coding_language.upper()} syntax)

DO NOT include:
- solution
- answer
- complete implementation
- final code

Return ONLY a JSON array. Example format for {coding_language.upper()}:
[
  {{
    "questionText": "Problem description with examples, constraints, and input/output format...",
    "starterCode": "{starter_template.replace(chr(10), '\\n').replace('"', '\\"')}",
    "visibleTestCases": [
      {{"input": "5", "output": "10"}},
      {{"input": "10", "output": "20"}}
    ],
    "hiddenTestCases": [
      {{"input": "1", "output": "2"}},
      {{"input": "100", "output": "200"}}
    ],
    "constraints": "1 <= n <= 10^5",
    "functionSignature": {{
      "name": "solve",
      "parameters": [],
      "return_type": "void"
    }}
  }}
]

IMPORTANT: 
- All starter code MUST be in {coding_language.upper()}, NOT Python (unless language=python)
- Starter code should be incomplete - candidate must implement the logic
- DO NOT provide the solution or answer

Return ONLY valid JSON. No markdown, no explanations, NO solution code."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in coding problems. Always return valid JSON arrays. Never include markdown code blocks."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Coding questions JSON")
        
        # Ensure all questions have language information and remove any solution/answer fields
        validated_questions = []
        for question in questions:
            if not isinstance(question, dict):
                continue
            
            # Remove any solution/answer fields
            clean_question = {k: v for k, v in question.items() 
                            if k not in ["solution", "answer", "completeCode", "finalCode", "implementation"]}
            
            # Ensure required fields
            if not clean_question.get("language"):
                clean_question["language"] = str(_get_judge0_language_id(coding_language))
            if not clean_question.get("codingLanguage"):
                clean_question["codingLanguage"] = coding_language
            # Ensure starter code is in the correct language (fallback to template if missing)
            if not clean_question.get("starterCode"):
                clean_question["starterCode"] = _get_starter_code_template(coding_language)
            
            # Add legacy format fields for frontend compatibility
            if not clean_question.get("title"):
                # Extract title from questionText if available, or use topic
                question_text = clean_question.get("questionText", "")
                if question_text:
                    # Try to extract first line as title
                    first_line = question_text.split("\n")[0].strip()
                    clean_question["title"] = first_line[:100] if len(first_line) > 100 else first_line or topic
                else:
                    clean_question["title"] = topic
            
            if not clean_question.get("problemStatement"):
                clean_question["problemStatement"] = clean_question.get("questionText", "")
            
            # Validate and fix function signature (same logic as DSA module)
            func_sig_raw = clean_question.get("functionSignature")
            title = clean_question.get("title", topic)
            func_sig = _validate_and_fix_function_signature(func_sig_raw, topic=topic, title=title, context="fallback generation")
            clean_question["functionSignature"] = func_sig  # Update with validated/fixed version
            
            # Format function signature as string for frontend editing
            if func_sig and isinstance(func_sig, dict):
                func_name = func_sig.get("name", "function")
                params = func_sig.get("parameters", [])
                return_type = func_sig.get("return_type", "void")
                if params:
                    param_str = ", ".join([f"{p.get('name', '')}: {p.get('type', '')}" for p in params if isinstance(p, dict)])
                else:
                    param_str = ""
                clean_question["functionSignatureString"] = f"{func_name}({param_str}): {return_type}"
            elif func_sig and isinstance(func_sig, str):
                clean_question["functionSignatureString"] = func_sig
            
            # Extract sample input/output from visible test cases
            visible_tcs = clean_question.get("visibleTestCases", [])
            if visible_tcs and len(visible_tcs) > 0:
                first_tc = visible_tcs[0]
                if not clean_question.get("sampleInput"):
                    clean_question["sampleInput"] = first_tc.get("input", "")
                if not clean_question.get("sampleOutput"):
                    clean_question["sampleOutput"] = first_tc.get("output", first_tc.get("expected_output", ""))
                if not clean_question.get("inputFormat"):
                    clean_question["inputFormat"] = "See sample input format below"
                if not clean_question.get("outputFormat"):
                    clean_question["outputFormat"] = "See sample output format below"
            
            # Validate required fields
            if clean_question.get("questionText") and clean_question.get("starterCode"):
                validated_questions.append(clean_question)
            else:
                logger.warning(f"Coding question missing required fields, skipping")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid coding questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Coding questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Coding questions: {str(exc)}") from exc


async def generate_topics_unified(
    assessment_title: Optional[str],
    job_designation: Optional[str],
    combined_skills: List[Dict[str, Any]],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics from combined skills from multiple sources (role-based, manual, CSV).
    ALL skills from all sources are combined with EQUAL PRIORITY and generate 8-12 topics total.
    Distribution is based on role and skills - ensures all skills are covered.
    """
    if not combined_skills:
        return []
    
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    # Build comprehensive skills list with metadata for unified generation
    # Combine ALL skills (role + manual + CSV) with equal priority
    skills_with_metadata = []
    all_skill_names = []
    
    for skill in combined_skills:
        skill_name = skill.get("skill_name", "").strip()
        if not skill_name:
            continue
        
        skill_description = skill.get("skill_description") or skill.get("description", "")
        importance_level = skill.get("importance_level", "Medium")
        source = skill.get("source", "unknown")
        
        # Add to simple list for backward compatibility
        all_skill_names.append(skill_name)
        
        # Build skill entry with metadata
        skill_entry = {
            "name": skill_name,
            "description": skill_description,
            "importance": importance_level,
            "source": source
        }
        skills_with_metadata.append(skill_entry)
    
    if not all_skill_names:
        return []
    
    # Build comprehensive prompt that includes all skills with their metadata
    skills_text_list = []
    has_sql_skill = False
    has_aiml_skill = False
    
    for skill_entry in skills_with_metadata:
        skill_line = f"- {skill_entry['name']}"
        skill_name_lower = skill_entry['name'].lower()
        
        # Check for SQL skill
        if "sql" in skill_name_lower:
            has_sql_skill = True
        # Check for AIML skill
        if any(keyword in skill_name_lower for keyword in ["aiml", "ai/ml", "ai-ml", "machine learning", "ml", "data science", "ds"]):
            has_aiml_skill = True
        
        if skill_entry.get("description"):
            skill_line += f" ({skill_entry['description']})"
            # Also check description for SQL/AIML keywords
            desc_lower = skill_entry.get("description", "").lower()
            if "sql" in desc_lower or "query" in desc_lower or "join" in desc_lower:
                has_sql_skill = True
            if any(keyword in desc_lower for keyword in ["machine learning", "ml", "pandas", "numpy", "sklearn", "tensorflow", "pytorch"]):
                has_aiml_skill = True
        if skill_entry.get("importance") and skill_entry.get("importance") != "Medium":
            skill_line += f" [Importance: {skill_entry['importance']}]"
        skills_text_list.append(skill_line)
    
    skills_text = "\n".join(skills_text_list)
    skills_simple_text = ", ".join(all_skill_names)
    title_text = assessment_title if assessment_title else "Not specified"
    
    # Use job_designation if available, otherwise use first skill or "General"
    effective_job_designation = job_designation or all_skill_names[0] if all_skill_names else "General"
    
    # Build SQL/AIML requirement section
    sql_aiml_requirements = ""
    if has_sql_skill:
        sql_aiml_requirements += f"""
- **CRITICAL FOR SQL SKILL**: You MUST include at least ONE SQL execution topic (questionType='SQL') that requires WRITING/EXECUTING SQL queries or procedures. 
  * SQL skills can have topics with ANY question type (MCQ, Subjective, PseudoCode, etc.) - that's allowed and encouraged.
  * BUT you MUST have at least ONE topic with questionType='SQL' for query execution.
  * Examples of SQL execution topics: "Write SQL Query to Join Multiple Tables", "Optimize SQL Query for Performance", "Implement Stored Procedure in SQL", "Create Complex SQL Query with Subqueries"
  * SQL theory/conceptual topics (like "SQL vs NoSQL Comparison", "Indexing Strategies", "JOIN Types Explained") should use questionType='Subjective' or 'MCQ', NOT 'SQL'."""
    if has_aiml_skill:
        sql_aiml_requirements += f"""
- **CRITICAL FOR AIML SKILL**: You MUST include at least ONE AIML execution topic (questionType='AIML') that requires WRITING/EXECUTING ML/DS code.
  * AIML skills can have topics with ANY question type (MCQ, Subjective, PseudoCode, etc.) - that's allowed and encouraged.
  * BUT you MUST have at least ONE topic with questionType='AIML' for ML/DS code execution.
  * Examples of AIML execution topics: "Implement RandomForest Classifier", "Train Neural Network Model with TensorFlow", "Data Preprocessing with Pandas", "Model Training Using Scikit-learn"
  * AIML theory/conceptual topics (like "Machine Learning Concepts", "Comparing ML Algorithms", "ML Advantages", "Neural Network Architecture Theory") should use questionType='Subjective' or 'MCQ', NOT 'AIML'."""
    
    # Build unified prompt that emphasizes covering ALL skills
    prompt = f"""You are an expert assessment designer. Generate topics with UNIVERSAL, DOMAIN-AGNOSTIC question type assignment.

CRITICAL CONSTRAINT: You MUST generate EXACTLY 8-12 topics. NO MORE, NO LESS. Count carefully before responding.

Generate a list of highly relevant assessment topics using:
- Job role/domain: {effective_job_designation}
- Assessment title: {title_text}
- Experience mode: {experience_mode}
- Experience level: {experience_level}

CRITICAL REQUIREMENTS:
- You MUST generate EXACTLY 8-12 topics TOTAL (count: 8, 9, 10, 11, or 12 - no more, no less)
- You must generate topics that cover ALL the following skills (do NOT skip any skill):
{skills_text}

- Distribution should be based on the role and the complexity/importance of each skill
- Ensure that topics are distributed across all skills listed above
- All skills have EQUAL PRIORITY - do not favor one source over another{sql_aiml_requirements}

IMPORTANT NOTES:
- SQL and AIML skills can have topics with ANY question type (MCQ, Subjective, PseudoCode, Coding, SQL, AIML)
- However, when SQL or AIML skills are present, you MUST include at least ONE execution topic:
  * For SQL: At least one topic with questionType='SQL' (for query execution)
  * For AIML: At least one topic with questionType='AIML' (for ML/DS code execution)
- All other topics for SQL/AIML skills can use any appropriate question type (MCQ for SQL basics, Subjective for SQL theory, etc.)

For each topic, you must assign questionType based on SEMANTIC MEANING, not keywords:

1. SUBJECTIVE (explanation-oriented):
   Use for topics requiring:
   - Conceptual understanding, theoretical explanation
   - Architectural or design reasoning
   - Describing principles, rules, or ideas
   - Comparing and contrasting concepts
   - Topics where factual recall is insufficient
   
   Semantic intent: "explain", "describe", "why", "impact", "advantages", "concepts", "principles", "paradigms"

2. PSEUDOCODE (logic/algorithm-oriented):
   Use for topics involving:
   - Designing algorithms or workflows
   - Explaining process flow or problem-solving steps
   - Breaking down logic or structured thinking
   - Topics where logic and structured thinking are central
   
   Semantic intent: "algorithm", "workflow", "logic", "steps", "process", "how it works", "flow", "sequence"

3. CODING (implementation/execution-oriented):
   Use ONLY if the topic implies:
   - Writing functional, executable code
   - Implementation of features, modules, or algorithms
   - Tasks that can be executed with test cases
   
   Semantic intent: "implement", "build", "create", "write code", "solve", "program", "develop", "write function"
   Set canUseJudge0 = true ONLY for Coding topics.

4. MCQ (factual/basic/quick-assessment):
   Use for topics involving:
   - Terminology, facts, syntax-level understanding
   - Straightforward objective recall
   - Quick verification of knowledge
   
   Semantic intent: "basics", "fundamentals", "definition", "types", "components", "identify", "select", "choose"

5. SQL (query execution-oriented):
   Use ONLY for topics requiring writing/executing SQL queries or procedures in a sandbox environment.
   ✅ CORRECT SQL execution topics: "Write SQL Query to Join Tables", "Optimize SQL Query for Performance", "Implement Stored Procedure", "Create Complex SQL Query with Subqueries"
   ❌ WRONG - Use Subjective/MCQ instead: "SQL vs NoSQL Comparison", "Indexing Strategies", "JOIN Types Explained", "SQL Injection Prevention", "Normalization in Database Design"
   Note: SQL-related topics can use ANY question type (MCQ, Subjective, PseudoCode), but SQL execution topics (query writing) MUST use questionType='SQL'
   Semantic intent for SQL type: "write query", "implement procedure", "optimize query", "sql to", "query to", "create query", "write sql"

6. AIML (ML/DS code execution-oriented):
   Use ONLY for topics requiring writing/executing ML/DS code using pandas, numpy, sklearn, etc. in a Jupyter notebook.
   ✅ CORRECT AIML execution topics: "Implement RandomForest Classifier", "Train Neural Network Model", "Data Preprocessing with Pandas", "Model Training Using Scikit-learn"
   ❌ WRONG - Use Subjective/MCQ instead: "Machine Learning Concepts", "Comparing ML Algorithms", "ML Advantages", "Neural Network Architecture Theory"
   Note: AIML-related topics can use ANY question type (MCQ, Subjective, PseudoCode), but AIML execution topics (ML code writing) MUST use questionType='AIML'
   Semantic intent for AIML type: "implement", "train model", "using pandas", "ml implementation", "notebook", "build model", "data preprocessing code"

CRITICAL RULES:
- Assign questionType based on SEMANTIC MEANING, not keyword matching
- Work for ANY domain: programming, cloud, DevOps, AI/ML, cybersecurity, databases, frameworks, etc.
- Do NOT hardcode technology-specific rules
- Ensure variety: aim for a balanced mix of question types across all topics
- COVER ALL SKILLS: Make sure topics are distributed across all skills listed above

For each topic:
- Produce a topic label (specific, meaningful, assessment-ready)
- Select questionType using semantic understanding (MCQ | Subjective | PseudoCode | Coding | SQL | AIML)
- Assign difficulty: Easy | Medium | Hard
- Set canUseJudge0 = true ONLY for Coding topics

Return ONLY JSON:
[
  {{
    "label": "",
    "questionType": "",
    "difficulty": "",
    "canUseJudge0": true/false
  }}
]

CRITICAL: Generate EXACTLY 8-12 topics (count: 8, 9, 10, 11, or 12). Count them before responding. Return only the JSON array, no explanations."""
    
    try:
        client = _get_openai_client()
    except ValueError as exc:
        logger.error(f"OpenAI API key not configured: {exc}")
        raise HTTPException(status_code=500, detail="OpenAI API key not configured") from exc
    
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks or explanations outside the JSON. Ensure all provided skills are covered in the topics. For SQL and AIML skills, you can generate topics with ANY question type (MCQ, Subjective, PseudoCode), but you MUST include at least ONE execution topic with questionType='SQL' or 'AIML' respectively."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        topics_data = json.loads(content)
        
        # ENFORCE 8-12 TOPIC LIMIT - truncate if more than 12
        if len(topics_data) > 12:
            logger.warning(f"OpenAI generated {len(topics_data)} topics, truncating to 12")
            topics_data = topics_data[:12]
        elif len(topics_data) < 8:
            logger.warning(f"OpenAI generated only {len(topics_data)} topics (expected 8-12)")
        
        # Validate SQL/AIML execution topics are present (warn but don't hardcode)
        has_sql_execution_topic = False
        has_aiml_execution_topic = False
        
        # Check existing topics for SQL/AIML execution topics
        for topic_data in topics_data:
            topic_label = (topic_data.get("label", "") or "").lower()
            question_type = topic_data.get("questionType", "").upper()
            if question_type == "SQL" and _v2_is_sql_execution_topic(topic_label):
                has_sql_execution_topic = True
            if question_type == "AIML" and _v2_is_aiml_execution_topic(topic_label):
                has_aiml_execution_topic = True
        
        # Log warnings if required execution topics are missing (but don't hardcode - let AI decide)
        if has_sql_skill and not has_sql_execution_topic:
            logger.warning(f"SQL skill detected but no SQL execution topic found. Expected at least one topic with questionType='SQL' for query execution.")
        if has_aiml_skill and not has_aiml_execution_topic:
            logger.warning(f"AIML skill detected but no AIML execution topic found. Expected at least one topic with questionType='AIML' for ML/DS code execution.")
        
        # Note: We trust the AI prompt to generate the required execution topics.
        # If missing, the prompt should be strong enough to ensure they're included on regeneration.
        
        # Transform to multi-row model format
        topics = []
        for idx, topic_data in enumerate(topics_data):
            question_type = topic_data.get("questionType", "MCQ")
            difficulty = topic_data.get("difficulty", "Medium")
            can_use_judge0 = topic_data.get("canUseJudge0", False)
            topic_label = topic_data.get("label", "")
            topic_label_lower = (topic_label or "").lower()
            
            # Validate question type
            if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding", "SQL", "AIML"]:
                question_type = "MCQ"
            
            # Validate difficulty
            if difficulty not in ["Easy", "Medium", "Hard"]:
                difficulty = "Medium"
            
            # Deterministic overrides for AIML/SQL/web topics (SQL/AIML ONLY for execution topics)
            if _v2_is_aiml_execution_topic(topic_label_lower):
                question_type = "AIML"
                can_use_judge0 = False
            elif _v2_is_sql_execution_topic(topic_label_lower):
                question_type = "SQL"
                can_use_judge0 = False
            elif _v2_contains_any(topic_label_lower, V2_WEB_KEYWORDS):
                impl_keywords = ["build", "create", "implement", "design", "develop", "write"]
                question_type = "Subjective" if _v2_contains_any(topic_label_lower, impl_keywords) else "MCQ"
                can_use_judge0 = False
            
            # If model returned SQL but it's not an execution SQL topic, downgrade
            if question_type == "SQL" and not _v2_is_sql_execution_topic(topic_label_lower):
                question_type = "Subjective" if any(k in topic_label_lower for k in ["vs", "versus", "difference", "compare", "comparison", "overview", "explained", "explain", "injection", "security"]) else "MCQ"
                can_use_judge0 = False
            # If model returned AIML but it's not an execution AIML topic, downgrade
            if question_type == "AIML" and not _v2_is_aiml_execution_topic(topic_label_lower):
                question_type = "Subjective"
                can_use_judge0 = False
            
            # CRITICAL: If question type is Coding, validate it's supported by Judge0
            # Check both the topic label and the skills list
            if question_type == "Coding":
                # Use comprehensive framework detection
                is_framework, framework_name = contains_unsupported_framework(topic_label, all_skill_names)
                if is_framework:
                    logger.warning(f"Topic '{topic_label}' was assigned Coding but contains framework '{framework_name}'. Converting to PseudoCode.")
                    question_type = "PseudoCode"
                    can_use_judge0 = False
            
            # Ensure canUseJudge0 is only True for Coding
            if question_type != "Coding":
                can_use_judge0 = False
            
            # Determine source based on which skill the topic most closely relates to
            # Try to match topic label to skill names
            source = "ai"  # Default
            for skill_entry in skills_with_metadata:
                skill_name_lower = skill_entry["name"].lower()
                if skill_name_lower in topic_label_lower or topic_label_lower in skill_name_lower:
                    source = skill_entry["source"]
                    break
            
            # Create topic with first questionRow
            topic = {
                "id": str(uuid.uuid4()),
                "label": topic_data.get("label", ""),
                "locked": False,
                "source": source,
                "status": "pending",
                "questionRows": [
                    {
                        "rowId": str(uuid.uuid4()),
                        "questionType": question_type,
                        "difficulty": difficulty,
                        "questionsCount": 1,  # Default, can be updated by user
                        "canUseJudge0": can_use_judge0,
                        "status": "pending",
                        "locked": False,
                        "questions": []
                    }
                ]
            }
            
            topics.append(topic)
        
        # Filter topics to ensure Judge0 compatibility
        topics = filter_topics_with_coding_unsupported(topics)
        
        # Check if we need to ensure Coding topic exists (if Judge0-compatible skills present)
        judge0_languages = ["python", "java", "javascript", "typescript", "c", "c++", "cpp", "go", "ruby", "php", "rust", "kotlin", "swift", "bash", "csharp", "cs"]
        has_judge0_compatible_skill = False
        for skill_name in all_skill_names:
            skill_lower = skill_name.lower().strip()
            if any(lang in skill_lower for lang in judge0_languages):
                # Check if it's not a framework
                if is_judge0_supported(skill_name):
                    has_judge0_compatible_skill = True
                    break
        
        if has_judge0_compatible_skill:
            has_coding_topic = any(
                topic.get("questionRows", [{}])[0].get("questionType") == "Coding"
                for topic in topics
            )
            
            if not has_coding_topic and topics:
                # Find the most suitable topic to convert to Coding
                coding_keywords = ["algorithm", "function", "implement", "code", "program", "solve", "write", "create", "build", "develop"]
                best_topic_idx = None
                best_score = 0
                
                for idx, topic in enumerate(topics):
                    label = topic.get("label", "").lower()
                    score = sum(1 for keyword in coding_keywords if keyword in label)
                    if score > best_score:
                        best_score = score
                        best_topic_idx = idx
                
                # If no good match found, use the first topic
                if best_topic_idx is None:
                    best_topic_idx = 0
                
                # Convert the selected topic to Coding
                if best_topic_idx < len(topics):
                    topic = topics[best_topic_idx]
                    topic_label = topic.get("label", "")
                    question_rows = topic.get("questionRows", [])
                    if question_rows:
                        # Validate that topic doesn't contain frameworks before converting
                        is_framework, framework_name = contains_unsupported_framework(topic_label, all_skill_names)
                        if is_framework:
                            logger.warning(f"Cannot convert topic '{topic_label}' to Coding - contains framework '{framework_name}'. Keeping original type.")
                        else:
                            question_rows[0]["questionType"] = "Coding"
                            question_rows[0]["canUseJudge0"] = True
                            logger.info(f"Converted topic '{topic.get('label')}' to Coding type to meet requirement")
        
        return topics
        
    except json.JSONDecodeError as exc:
        logger.error(f"Failed to parse OpenAI response as JSON: {exc}")
        raise HTTPException(status_code=500, detail="Failed to parse topic generation response") from exc
    except Exception as exc:
        logger.error(f"Error generating topics: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate topics: {str(exc)}") from exc


async def generate_topics_from_requirements_v2(
    requirements: List[Dict[str, Any]],
    experience_min: int,
    experience_max: int,
    experience_mode: str
) -> List[Dict[str, Any]]:
    """
    Generate topics from CSV requirements.
    """
    if not requirements:
        return []
    
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    all_topics = []
    
    for req in requirements:
        skill_name = req.get("skill_name", "")
        skill_description = req.get("skill_description", "") or req.get("description", "")
        importance_level = req.get("importance_level", "Medium")
        
        if not skill_name:
            continue
        
        # Check if skill is a Judge0-compatible programming language
        # BUT exclude if the skill is a framework/library
        judge0_languages = ["python", "java", "javascript", "typescript", "c", "c++", "cpp", "go", "ruby", "php", "rust", "kotlin", "swift", "bash", "csharp", "cs"]
        skill_lower = skill_name.lower()
        is_framework = not is_judge0_supported(skill_name)
        has_judge0_compatible = False
        
        # Only consider it compatible if it's a pure language AND not a framework
        if not is_framework:
            has_judge0_compatible = any(lang in skill_lower for lang in judge0_languages)
        
        # Build prompt for CSV requirement
        prompt = f"""Generate 2-4 assessment topics for the following skill requirement:

Skill Name: {skill_name}
Skill Description: {skill_description}
Importance Level: {importance_level}
Experience Mode: {experience_mode}
Experience Level: {experience_level}

For each topic:
- Produce a topic label (specific, meaningful, assessment-ready)
- Select questionType using semantic understanding (MCQ | Subjective | PseudoCode | Coding)
- Assign difficulty: Easy | Medium | Hard
- Set canUseJudge0 = true ONLY for Coding topics

Return ONLY JSON array:
[
  {{
    "label": "",
    "questionType": "",
    "difficulty": "",
    "canUseJudge0": true/false
  }}
]

Generate 2-4 topics. Return only the JSON array, no explanations."""
        
        try:
            client = _get_openai_client()
            response = await client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks or explanations outside the JSON."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
            )
            
            content = response.choices[0].message.content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()
            
            topics_data = json.loads(content)
            
            for topic_data in topics_data:
                question_type = topic_data.get("questionType", "MCQ")
                difficulty = topic_data.get("difficulty", "Medium")
                can_use_judge0 = topic_data.get("canUseJudge0", False)
                topic_label = topic_data.get("label", "")
                topic_label_lower = (topic_label or "").lower()
                
                if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding", "SQL", "AIML"]:
                    question_type = "MCQ"
                if difficulty not in ["Easy", "Medium", "Hard"]:
                    difficulty = "Medium"
                
                # Deterministic overrides for AIML/SQL/web topics (SQL/AIML ONLY for execution topics)
                if _v2_is_aiml_execution_topic(topic_label_lower):
                    question_type = "AIML"
                    can_use_judge0 = False
                elif _v2_is_sql_execution_topic(topic_label_lower):
                    question_type = "SQL"
                    can_use_judge0 = False
                elif _v2_contains_any(topic_label_lower, V2_WEB_KEYWORDS):
                    impl_keywords = ["build", "create", "implement", "design", "develop", "write"]
                    question_type = "Subjective" if _v2_contains_any(topic_label_lower, impl_keywords) else "MCQ"
                    can_use_judge0 = False

                # If model returned SQL but it's not an execution SQL topic, downgrade
                if question_type == "SQL" and not _v2_is_sql_execution_topic(topic_label_lower):
                    question_type = "Subjective" if any(k in topic_label_lower for k in ["vs", "versus", "difference", "compare", "comparison", "overview", "explained", "explain", "injection", "security"]) else "MCQ"
                    can_use_judge0 = False
                # If model returned AIML but it's not an execution AIML topic, downgrade
                if question_type == "AIML" and not _v2_is_aiml_execution_topic(topic_label_lower):
                    question_type = "Subjective"
                    can_use_judge0 = False

                # CRITICAL: If question type is Coding, validate it's supported by Judge0
                # Check both the topic label and the skill name
                if question_type == "Coding":
                    # Use comprehensive framework detection
                    skills_list = [skill_name] if skill_name else []
                    is_framework, framework_name = contains_unsupported_framework(topic_label, skills_list)
                    if is_framework:
                        logger.warning(f"Topic '{topic_label}' was assigned Coding but contains framework '{framework_name}'. Converting to PseudoCode.")
                        question_type = "PseudoCode"
                        can_use_judge0 = False
                
                # Ensure canUseJudge0 is only True for Coding
                if question_type != "Coding":
                    can_use_judge0 = False
                
                topic = {
                    "id": str(uuid.uuid4()),
                    "label": topic_data.get("label", ""),
                    "locked": False,
                    "source": "csv",
                    "status": "pending",
                    "questionRows": [
                        {
                            "rowId": str(uuid.uuid4()),
                            "questionType": question_type,
                            "difficulty": difficulty,
                            "questionsCount": 1,
                            "canUseJudge0": can_use_judge0,
                            "status": "pending",
                            "locked": False,
                            "questions": []
                        }
                    ]
                }
                all_topics.append(topic)
                
        except Exception as exc:
            logger.error(f"Error generating topics for requirement {skill_name}: {exc}", exc_info=True)
            continue
    
    return all_topics


async def improve_topic(
    previous_topic_label: str,
    skill_context: Optional[str] = None,
    skill_description: Optional[str] = None,
    importance_level: Optional[str] = None,
    experience_mode: str = "corporate",
    experience_min: int = 0,
    experience_max: int = 10,
    combined_skills: Optional[List[Dict[str, Any]]] = None,
    job_designation: Optional[str] = None,
    assessment_title: Optional[str] = None
) -> Dict[str, Any]:
    """
    Improve a topic label and regenerate its question type using the same prompt logic as generate_topics_v2.
    Returns both the improved label and the question type with canUseJudge0 flag.
    """
    # Get experience level
    if experience_mode == "corporate":
        experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
    else:
        experience_level, _ = _get_experience_level_student(experience_min, experience_max)
    
    # Check if skill context is a Judge0-compatible programming language
    # BUT exclude if the skill is a framework/library
    judge0_languages = ["python", "java", "javascript", "typescript", "c", "c++", "cpp", "go", "ruby", "php", "rust", "kotlin", "swift", "bash", "csharp", "cs"]
    has_judge0_compatible = False
    has_framework_skill = False
    
    if skill_context:
        skill_lower = skill_context.lower()
        # Check if skill is a framework
        if not is_judge0_supported(skill_context):
            has_framework_skill = True
        else:
            has_judge0_compatible = any(lang in skill_lower for lang in judge0_languages)
    
    # Check combined_skills for programming languages
    if combined_skills:
        for skill in combined_skills:
            # Handle both Pydantic models and dictionaries
            if hasattr(skill, "skill_name"):
                skill_name = skill.skill_name
            elif isinstance(skill, dict):
                skill_name = skill.get("skill_name", "")
            else:
                skill_name = str(skill) if skill else ""
            
            if skill_name:
                skill_lower = skill_name.lower()
                # Check if skill is a framework
                if not is_judge0_supported(skill_name):
                    has_framework_skill = True
                elif any(lang in skill_lower for lang in judge0_languages):
                    has_judge0_compatible = True
    
    # If we have framework skills and no pure languages, don't require Coding
    if has_framework_skill and not has_judge0_compatible:
        has_judge0_compatible = False
    
    # Build context text
    context_parts = []
    if skill_context:
        context_parts.append(f"Skill: {skill_context}")
    if skill_description:
        context_parts.append(f"Description: {skill_description}")
    if importance_level:
        context_parts.append(f"Importance: {importance_level}")
    
    context_text = "\n".join(context_parts) if context_parts else "N/A"
    
    # Build skills text for prompt
    skills_list = []
    if combined_skills:
        for s in combined_skills:
            # Handle both Pydantic models and dictionaries
            if hasattr(s, "skill_name"):
                skill_name = s.skill_name
            elif isinstance(s, dict):
                skill_name = s.get("skill_name", "")
            else:
                skill_name = str(s) if s else ""
            
            if skill_name:
                skills_list.append(skill_name)
    elif skill_context:
        skills_list = [skill_context]
    
    skills_text = ", ".join(skills_list) if skills_list else "Not specified"
    title_text = assessment_title if assessment_title else "Not specified"
    job_text = job_designation if job_designation else (skill_context if skill_context else "Not specified")
    
    # First, improve the topic label using the simpler prompt from usethislogic.py
    system_message = """You are an expert assessment designer. Improve the provided topic so that it is clearer, deeper, more technically accurate, and more assessable. Maintain the same domain, same conceptual scope, and same purpose. DO NOT generate a different topic. DO NOT change the domain. Produce 1 improved topic only."""
    
    user_message_label = f"""Improve the following topic while keeping the same domain and purpose. It must be a better version of the previous topic without repeating the same wording. DO NOT simplify it.

Experience mode: {experience_mode}
Experience level: {experience_level}
Context: {context_text}

Previous topic: {previous_topic_label}

Return ONLY the improved topic label as a single string, nothing else."""
    
    try:
        client = _get_openai_client()
        
        # Get improved label first
        response_label = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message_label}
            ],
            temperature=0.7,
        )
        
        improved_label = response_label.choices[0].message.content.strip()
        improved_label = improved_label.strip('"').strip("'")
        
        # Now determine question type using semantic understanding
        prompt = f"""You are an expert assessment designer. Determine the appropriate question type for this topic using SEMANTIC MEANING.

Topic: {improved_label}
Job role/domain: {job_text}
Selected skills: {skills_text}

Assign questionType based on SEMANTIC MEANING:

1. SUBJECTIVE (explanation-oriented):
   Use for topics requiring conceptual understanding, theoretical explanation, architectural reasoning, describing principles, comparing concepts.

2. PSEUDOCODE (logic/algorithm-oriented):
   Use for topics involving designing algorithms or workflows, explaining process flow, breaking down logic or structured thinking.

3. CODING (implementation/execution-oriented):
   Use ONLY if the topic implies writing functional, executable code, implementation of features/modules/algorithms, tasks that can be executed with test cases.
   Set canUseJudge0 = true ONLY for Coding topics.

4. MCQ (factual/basic/quick-assessment):
   Use for topics involving terminology, facts, syntax-level understanding, straightforward objective recall.

CRITICAL RULES:
- Assign questionType based on SEMANTIC MEANING, not keyword matching
- Work for ANY domain: programming, cloud, DevOps, AI/ML, cybersecurity, databases, frameworks, etc.
- Do NOT hardcode technology-specific rules

Return ONLY a JSON object:
{{
  "questionType": "MCQ | Subjective | PseudoCode | Coding",
  "difficulty": "Easy | Medium | Hard",
  "canUseJudge0": true/false
}}

No explanations. No markdown. JSON only."""
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON objects. Never include markdown code blocks or explanations outside the JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        topic_data = json.loads(content)
        
        question_type = topic_data.get("questionType", "MCQ")
        if question_type not in ["MCQ", "Subjective", "PseudoCode", "Coding", "SQL", "AIML"]:
            question_type = "MCQ"
        
        difficulty = topic_data.get("difficulty", "Medium")
        if difficulty not in ["Easy", "Medium", "Hard"]:
            difficulty = "Medium"

        can_use_judge0 = topic_data.get("canUseJudge0", False)

        # Deterministic overrides for AIML/SQL/web topics (SQL/AIML ONLY for execution topics)
        improved_label_lower = (improved_label or "").lower()
        if _v2_is_aiml_execution_topic(improved_label_lower):
            question_type = "AIML"
            can_use_judge0 = False
        elif _v2_is_sql_execution_topic(improved_label_lower):
            question_type = "SQL"
            can_use_judge0 = False
        elif _v2_contains_any(improved_label_lower, V2_WEB_KEYWORDS):
            impl_keywords = ["build", "create", "implement", "design", "develop", "write"]
            question_type = "Subjective" if _v2_contains_any(improved_label_lower, impl_keywords) else "MCQ"
            can_use_judge0 = False

        # If model returned SQL/AIML but it's not an execution topic, downgrade
        if question_type == "SQL" and not _v2_is_sql_execution_topic(improved_label_lower):
            question_type = "Subjective" if any(k in improved_label_lower for k in ["vs", "versus", "difference", "compare", "comparison", "overview", "explained", "explain", "injection", "security"]) else "MCQ"
            can_use_judge0 = False
        if question_type == "AIML" and not _v2_is_aiml_execution_topic(improved_label_lower):
            question_type = "Subjective"
            can_use_judge0 = False

        # Ensure canUseJudge0 is only True for Coding
        if question_type != "Coding":
            can_use_judge0 = False
        
        # Validate coding topic is supported by Judge0
        if question_type == "Coding":
            # Collect all skills for comprehensive checking
            skills_list = []
            if skill_context:
                skills_list.append(skill_context)
            if combined_skills:
                for skill in combined_skills:
                    # Handle both Pydantic models and dictionaries
                    if hasattr(skill, "skill_name"):
                        skill_name = skill.skill_name
                    elif isinstance(skill, dict):
                        skill_name = skill.get("skill_name", "")
                    else:
                        skill_name = str(skill) if skill else ""
                    if skill_name:
                        skills_list.append(skill_name)
            
            # Use comprehensive framework detection
            is_framework, framework_name = contains_unsupported_framework(improved_label, skills_list if skills_list else None)
            if is_framework:
                logger.warning(f"Topic '{improved_label}' was assigned Coding but contains framework '{framework_name}'. Changing to PseudoCode.")
                question_type = "PseudoCode"
                can_use_judge0 = False
        
        return {
            "label": improved_label,
            "questionType": question_type,
            "difficulty": difficulty,
            "canUseJudge0": can_use_judge0
        }
        
    except Exception as exc:
        logger.error(f"Error improving topic: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to improve topic: {str(exc)}") from exc


async def regenerate_question(
    old_question: str,
    question_type: str,
    difficulty: str,
    experience_mode: Optional[str] = "corporate",
    experience_min: Optional[int] = 0,
    experience_max: Optional[int] = 10,
    additional_requirements: Optional[str] = None,
    feedback: Optional[str] = None,
    topic_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Regenerate a single question based on the old question text and optional feedback.
    """
    try:
        if not experience_mode or experience_mode.lower() in ["student", "college"]:
            experience_mode = "college"
        else:
            experience_mode = "corporate"
        
        if experience_mode == "corporate":
            experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
        else:
            experience_level, _ = _get_experience_level_student(experience_min, experience_max)
        
        improvement_goals = [
            "increase clarity",
            "increase assessability",
            "ensure practical relevance if corporate",
            "ensure academic structure if student",
            "maintain conceptual integrity"
        ]
        
        if feedback:
            improvement_goals.append(f"User feedback: {feedback}")
        
        if additional_requirements:
            improvement_goals.append(f"Additional requirements: {additional_requirements}")
        
        system_message = """You are an expert assessment designer. Improve the provided question so that it is clearer, deeper, more technically accurate, and more assessable. Maintain the same domain, same conceptual scope, and same purpose. DO NOT generate a different topic. DO NOT change the domain. Produce 1 improved question only."""
        
        user_message = f"""Improve the following question while keeping the same topic and difficulty. It must be a better version of the previous question without repeating the same wording. DO NOT simplify it. Maintain the same question type.

Experience mode: {experience_mode}
Experience level: {experience_level}
Topic: {topic_name or "N/A"}
Difficulty: {difficulty}
Improvement goals: {', '.join(improvement_goals)}

Old question:
{old_question}

Output strictly in JSON format:
{{
    "question": "<new_question_text>",
    "options": [...],   // only for MCQ (exactly 4 options)
    "correctAnswer": "..." // only for MCQ (must match one of the options)
}}

For MCQ: Generate exactly 4 options and ensure correctAnswer matches one of them.
For Subjective: Generate a scenario-based question (3-5 sentences minimum).
For PseudoCode: Provide a scenario first, then ask for pseudocode.
For Coding: Generate a coding problem with clear description, examples, and constraints.
"""
        
        if experience_mode == "college":
            user_message += "\n\nCOLLEGE MODE RULES:\n- Beginner/intermediate academic level\n- Avoid enterprise/production terminology\n- Use small academic examples\n- Focus on conceptual understanding\n- NO job-role context\n"
        else:
            user_message += "\n\nCORPORATE MODE RULES:\n- Realistic, industry-driven scenarios\n- Include production workflows, optimization, best practices\n- Use professional terminology\n- Expect deeper critical thinking\n"
        
        try:
            client = _get_openai_client()
        except ValueError as exc:
            logger.error(f"OpenAI API key not configured: {exc}")
            raise HTTPException(status_code=500, detail="OpenAI API key not configured") from exc
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        result = _parse_json_response(content, "regenerated question JSON")
        
        if question_type == "MCQ":
            if not isinstance(result, dict) or "question" not in result or "options" not in result or "correctAnswer" not in result:
                raise HTTPException(status_code=500, detail="Invalid MCQ format returned")
            options = result["options"]
            if not isinstance(options, list) or len(options) != 4:
                raise HTTPException(status_code=500, detail="MCQ must have exactly 4 options")
            if result["correctAnswer"] not in options:
                raise HTTPException(status_code=500, detail="correctAnswer must match one of the options")
            return {
                "question": result["question"],
                "options": options,
                "correctAnswer": result["correctAnswer"],
            }
        else:
            if not isinstance(result, dict) or "question" not in result:
                raise HTTPException(status_code=500, detail="Invalid question format returned")
            return {
                "question": result["question"],
            }
            
    except Exception as exc:
        logger.error(f"Error regenerating question: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to regenerate question: {str(exc)}") from exc


async def _generate_subjective_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate Subjective questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - ONLY scenario-based, real-world, case-study style questions
    - Minimum 2-4 sentences
    - Requires reasoning, explanation, trade-offs, evaluation
    - NO: MCQ-like phrasing, "which of the following", one-liners
    - Should reflect real-world usage of the topic
    - Must be context-aware (topic, category, difficulty, experience mode)
    
    Difficulty Mapping:
    - EASY → simple but meaningful real-life context
    - MEDIUM → multi-step reasoning with explanation
    - HARD → deep design decisions, constraints, trade-offs
    """
    # Context-aware scenario generation based on experience mode
    if experience_mode == "college":
        context_guidance = """
        Scenarios should relate to:
        - Academic projects
        - Mini-projects
        - Lab tasks
        - Internships
        - Programming assignments
        """
    else:  # corporate
        context_guidance = """
        Scenarios should relate to:
        - Production systems
        - Debugging real issues
        - Business workflows
        - System design choices
        - Team collaboration
        - Customer-facing problems
        """
    
    # Difficulty-specific requirements
    difficulty_requirements = {
        "Easy": "Simple but meaningful real-life context. Short scenario, simple decision or explanation needed.",
        "Medium": "Multi-step scenario with constraints or trade-offs. Requires reasoning and explanation.",
        "Hard": "Complex real-world scenario with multiple stakeholders or constraints. Deep design decisions, trade-offs, and evaluation required."
    }
    
    difficulty_req = difficulty_requirements.get(difficulty, difficulty_requirements["Medium"])
    
    # Process requirements: if URL, fetch and summarize; if text, use directly
    processed_requirements = None
    if additional_requirements:
        processed_requirements = await _process_requirements_for_subjective(additional_requirements)
    
    additional_req_text = ""
    if processed_requirements:
        additional_req_text = f"\n11. Additional Requirements: {processed_requirements}\n"
    
    prompt = f"""You are an expert technical assessment writer. Generate {count} scenario-based subjective question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based, real-world, case-study style questions
2. Each question MUST be minimum 2-4 sentences
3. Questions MUST require reasoning, explanation, trade-offs, or evaluation
4. NO MCQ-like phrasing (no "which of the following", no multiple choice options)
5. NO one-liner questions
6. Questions should reflect real-world usage of the topic: {topic}
7. Difficulty level: {difficulty}
8. {difficulty_req}
9. Experience mode: {experience_mode}
10. {context_guidance}{additional_req_text}
12. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, contexts, stakeholders, and problem types. If generating multiple questions, ensure they cover different aspects or applications of the topic.

EXAMPLES OF GOOD QUESTIONS:
- "You are working on a production e-commerce system that processes thousands of orders per minute. During peak hours, you notice the database connection pool is exhausted, causing transaction failures. Describe your approach to diagnose and resolve this issue, considering both immediate fixes and long-term scalability."
- "A team is building a mobile app that needs to sync data across devices. They're debating between using a local-first architecture with eventual consistency versus a server-authoritative approach. Explain the trade-offs of each approach and recommend which one to use for a collaborative note-taking app."
- "You're tasked with refactoring a legacy codebase that has tight coupling between components. The current system works but is difficult to test and extend. Outline your strategy for refactoring while maintaining system stability and minimizing downtime."

EXAMPLES OF BAD QUESTIONS (DO NOT GENERATE THESE):
- "What is {topic}?" (too simple, definition-level)
- "Explain {topic}." (no scenario, no context)
- "Which of the following is true about {topic}?" (MCQ-like phrasing)
- "List the benefits of {topic}." (too trivial)

Output format (JSON array):
[
  {{
    "question": "<scenario-based question text, 2-4 sentences minimum>"
  }}
]

DO NOT include idealAnswer, expectedAnswer, or any answer fields.
Return ONLY a JSON array with question text."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in scenario-based technical questions. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Subjective questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "question" in q:
                question_text = q["question"].strip()
                # Ensure minimum length (at least 2 sentences)
                if len(question_text) > 50 and question_text.count('.') >= 1:
                    validated_questions.append({"question": question_text})
                else:
                    logger.warning(f"Generated subjective question too short or invalid, skipping: {question_text[:50]}...")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid subjective questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Subjective questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Subjective questions: {str(exc)}") from exc


async def _generate_pseudocode_questions(topic: str, difficulty: str, count: int, experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate Pseudocode questions - PRODUCTION-GRADE REWRITE.
    
    Rules:
    - Generate a pseudocode-related question ONLY
    - Should require algorithmic thinking
    - Must be scenario-based, not trivial
    - DO NOT generate the answer
    - Answer will be evaluated by AI scoring model
    """
    additional_req_text = ""
    if additional_requirements:
        additional_req_text = f"\n9. Additional Requirements: {additional_requirements}\n"
    
    prompt = f"""You are an expert technical assessor. Generate {count} pseudocode question(s) for the topic: {topic}.

CRITICAL REQUIREMENTS:
1. Generate ONLY scenario-based pseudocode questions (not trivial syntax questions)
2. Questions MUST require algorithmic thinking and problem-solving
3. Difficulty level: {difficulty}
4. Questions should describe a real-world problem that requires algorithmic logic
5. Include sample input/output scenarios in the question text
6. The question should ask for pseudocode, not executable code
7. Avoid syntax tied to any specific programming language
8. Experience mode: {experience_mode}{additional_req_text}
10. **CRITICAL DIVERSITY REQUIREMENT**: Each question MUST be unique and different from the others. Do NOT generate similar or repetitive questions. Vary the scenarios, problem types, and algorithmic approaches.

DO NOT include:
- expectedAnswer
- explanation
- idealAnswer
- Any answer fields

The question text should:
- Describe a scenario or problem
- Include sample input/output examples
- Ask the candidate to write pseudocode to solve it
- Be suitable for evaluation in an interview or assessment

Output format (JSON array):
[
  {{
    "questionText": "<scenario-based pseudocode question text with sample input/output>"
  }}
]

Example good question:
{{
  "questionText": "You are designing an algorithm for a ride-sharing app to match drivers with passengers. Given a list of available drivers (each with their current location coordinates) and a list of ride requests (each with pickup location coordinates), write pseudocode to match each request to the nearest available driver. Include sample input: drivers = [(10, 20), (15, 25), (5, 10)], requests = [(12, 22), (8, 15)]. Expected output: request 1 → driver 1, request 2 → driver 3."
}}

Return ONLY valid JSON. No markdown, no explanations, NO answer fields."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in algorithmic problems. Always return valid JSON arrays. Never include markdown code blocks or answer fields."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "PseudoCode questions JSON")
        
        # Validate and transform questions
        validated_questions = []
        for q in questions:
            if isinstance(q, dict) and "questionText" in q:
                question_text = q["questionText"].strip()
                # Remove any answer fields if present
                clean_question = {"questionText": question_text}
                validated_questions.append(clean_question)
            elif isinstance(q, dict) and "question" in q:
                # Handle alternative field name
                question_text = q["question"].strip()
                validated_questions.append({"questionText": question_text})
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid pseudocode questions out of {count} requested")
        
        return validated_questions[:count]
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error generating PseudoCode questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate PseudoCode questions: {str(exc)}") from exc


def _get_starter_code_template(language: str) -> str:
    """
    Get starter code template for a given language.
    
    Args:
        language: Programming language (python, java, cpp, c, javascript, typescript, go, ruby)
        
    Returns:
        Starter code template string
    """
    templates = {
        "python": """def solve():
    # Write your logic here
    pass""",
        "java": """public class Solution {
    public static void solve() {
        // Write your logic here
    }
    public static void main(String[] args) {
        // Do not modify this method
    }
}""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

void solve() {
    // Write your logic here
}

int main() {
    // Locked main function
    return 0;
}""",
        "c": """#include <stdio.h>

void solve() {
    // Write your logic here
}

int main() {
    // Do not modify main, input/output handled here
    return 0;
}""",
        "javascript": """function solve(input) {
    // Write your logic here
}""",
        "typescript": """function solve(input: string): string {
    // Write your logic here
}""",
        "go": """package main

import "fmt"

func solve() {
    // Write your logic here
}

func main() {
    // Do not modify this method
}""",
        "ruby": """def solve
    # Write your logic here
end""",
    }
    return templates.get(language.lower(), templates["python"])


def _get_judge0_language_id(language: str) -> int:
    """
    Get Judge0 language ID for a given language.
    
    Args:
        language: Programming language name
        
    Returns:
        Judge0 language ID
    """
    language_id_map = {
        "python": 71,      # Python 3
        "java": 62,        # Java
        "cpp": 54,         # C++ (GCC)
        "c": 50,           # C (GCC)
        "javascript": 63,  # Node.js
        "typescript": 74,  # TypeScript
        "go": 60,          # Go
        "ruby": 72,        # Ruby
    }
    return language_id_map.get(language.lower(), 71)  # Default to Python


async def _generate_coding_questions(topic: str, difficulty: str, count: int, can_use_judge0: bool, coding_language: str = "python", experience_mode: str = "corporate", additional_requirements: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Generate Coding questions (Judge0-compatible) using DSA module architecture.
    
    Args:
        topic: Topic label
        difficulty: Difficulty level (Easy, Medium, Hard)
        count: Number of questions to generate
        can_use_judge0: Whether Judge0 can be used
        coding_language: Programming language for coding questions (python, java, cpp, c, javascript, typescript, go, ruby)
    
    Returns questions in DSA-compatible format with:
    - questionText (description + examples + constraints)
    - starterCode (for specified language)
    - visibleTestCases (public test cases)
    - hiddenTestCases (hidden test cases)
    - constraints
    - functionSignature
    - explanation (optional)
    - language (Judge0 language ID)
    """
    if not can_use_judge0:
        raise HTTPException(status_code=400, detail="Coding questions require canUseJudge0 to be true")
    
    # Normalize language
    coding_language = coding_language.lower()
    if coding_language not in ["python", "java", "cpp", "c", "javascript", "typescript", "go", "ruby"]:
        logger.warning(f"Unknown language '{coding_language}', defaulting to 'python'")
        coding_language = "python"
    
    # Use DSA module's AI generator if available
    if DSA_AVAILABLE and dsa_generate_question is not None:
        try:
            # Generate questions using DSA module (one at a time for count > 1)
            questions = []
            for i in range(count):
                # Map difficulty: Easy -> easy, Medium -> medium, Hard -> hard
                dsa_difficulty = difficulty.lower()
                
                # Generate using DSA module with the specified language
                dsa_question = await dsa_generate_question(
                    difficulty=dsa_difficulty,
                    topic=topic,
                    concepts=None,
                    languages=[coding_language]  # Use the specified language
                )
                
                # Transform DSA format to assessment format
                # DSA format has: title, description, examples, constraints, public_testcases, hidden_testcases, starter_code, function_signature
                # Assessment format needs: questionText, starterCode, visibleTestCases, hiddenTestCases, constraints, functionSignature, explanation
                
                # Build questionText from description + examples
                question_text = dsa_question.get("description", "")
                
                # Add examples if available
                examples = dsa_question.get("examples", [])
                if examples:
                    question_text += "\n\nExamples:\n"
                    for idx, ex in enumerate(examples, 1):
                        question_text += f"\nExample {idx}:\n"
                        question_text += f"Input: {ex.get('input', '')}\n"
                        question_text += f"Output: {ex.get('output', '')}\n"
                        if ex.get("explanation"):
                            question_text += f"Explanation: {ex.get('explanation')}\n"
                
                # Get starter code for the specified language
                starter_code_dict = dsa_question.get("starter_code", {})
                starter_code = starter_code_dict.get(coding_language) if starter_code_dict else ""
                # Fallback to template if DSA didn't provide starter code for this language
                if not starter_code:
                    starter_code = _get_starter_code_template(coding_language)
                
                # Transform test cases
                visible_testcases = []
                for tc in dsa_question.get("public_testcases", []):
                    visible_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                hidden_testcases = []
                for tc in dsa_question.get("hidden_testcases", []):
                    hidden_testcases.append({
                        "input": tc.get("input", ""),
                        "output": tc.get("expected_output", "")
                    })
                
                # Get constraints
                constraints_list = dsa_question.get("constraints", [])
                constraints_text = "\n".join(f"- {c}" for c in constraints_list) if constraints_list else ""
                
                # Get function signature and validate/fix it
                func_sig_raw = dsa_question.get("function_signature", {})
                title = dsa_question.get("title", topic)
                func_sig = _validate_and_fix_function_signature(func_sig_raw, topic=topic, title=title, context="DSA module")
                
                # Format function signature as string for frontend editing
                func_sig_string = ""
                if func_sig and isinstance(func_sig, dict):
                    func_name = func_sig.get("name", "function")
                    params = func_sig.get("parameters", [])
                    return_type = func_sig.get("return_type", "void")
                    if params:
                        param_str = ", ".join([f"{p.get('name', '')}: {p.get('type', '')}" for p in params if isinstance(p, dict)])
                    else:
                        param_str = ""
                    func_sig_string = f"{func_name}({param_str}): {return_type}"
                
                # Extract title and problem statement for legacy format
                title = dsa_question.get("title", topic)
                problem_statement = dsa_question.get("description", question_text)
                
                # Extract input/output format and sample input/output from first example
                input_format = ""
                output_format = ""
                sample_input = ""
                sample_output = ""
                if examples and len(examples) > 0:
                    first_example = examples[0]
                    sample_input = first_example.get("input", "")
                    sample_output = first_example.get("output", "")
                    # Try to infer format from examples
                    if sample_input:
                        input_format = "See sample input format below"
                    if sample_output:
                        output_format = "See sample output format below"
                
                # Build assessment question object with both new and legacy formats
                assessment_question = {
                    # New format (DSA-compatible)
                    "questionText": question_text,
                    "starterCode": starter_code,
                    "visibleTestCases": visible_testcases,
                    "hiddenTestCases": hidden_testcases,
                    "constraints": constraints_text,
                    "functionSignature": func_sig,  # Keep as object for display
                    "difficulty": difficulty,
                    "explanation": f"This problem tests understanding of {topic} at {difficulty} level.",
                    "language": str(_get_judge0_language_id(coding_language)),  # Store Judge0 language ID
                    "codingLanguage": coding_language,  # Store language name for frontend
                    # Legacy format (for frontend editing compatibility)
                    "title": title,
                    "problemStatement": problem_statement,
                    "inputFormat": input_format,
                    "outputFormat": output_format,
                    "sampleInput": sample_input,
                    "sampleOutput": sample_output,
                    # Function signature as string for textarea editing (frontend expects string, not object)
                    "functionSignatureString": func_sig_string,
                }
                
                questions.append(assessment_question)
            
            return questions
            
        except Exception as dsa_exc:
            logger.warning(f"DSA module generation failed, falling back to basic generation: {dsa_exc}")
            # Fall through to basic generation
    
    # Fallback: Basic generation if DSA module not available or failed
    starter_template = _get_starter_code_template(coding_language)
    prompt = f"""Generate {count} fully Judge0-compatible coding questions for: {topic}.

Difficulty: {difficulty}
Programming Language: {coding_language.upper()}

CRITICAL REQUIREMENTS:
1. You MUST generate the starter code and solution template in {coding_language.upper()}.
2. NEVER produce Python code unless language=python.
3. The template must follow standard function-signature patterns of {coding_language.upper()}.
4. Use the {coding_language.upper()} starter code template provided below.
5. DO NOT generate the final solution or answer code - only starter code with function signature
6. The system will evaluate using Judge0 test cases

Starter Code Template for {coding_language.upper()}:
{starter_template}

Each question must include:
- questionText (problem description with examples, constraints, and input/output format)
- starterCode ({coding_language.upper()} starter code with function signature matching the template above - incomplete, candidate must fill in logic)
- visibleTestCases (2-3 public test cases with input/output)
- hiddenTestCases (3-5 hidden test cases with input/output)
- constraints (list of constraints as string)
- functionSignature (name, parameters, return_type - must match {coding_language.upper()} syntax)

DO NOT include:
- solution
- answer
- complete implementation
- final code

Return ONLY a JSON array. Example format for {coding_language.upper()}:
[
  {{
    "questionText": "Problem description with examples, constraints, and input/output format...",
    "starterCode": "{starter_template.replace(chr(10), '\\n').replace('"', '\\"')}",
    "visibleTestCases": [
      {{"input": "5", "output": "10"}},
      {{"input": "10", "output": "20"}}
    ],
    "hiddenTestCases": [
      {{"input": "1", "output": "2"}},
      {{"input": "100", "output": "200"}}
    ],
    "constraints": "1 <= n <= 10^5",
    "functionSignature": {{
      "name": "solve",
      "parameters": [],
      "return_type": "void"
    }}
  }}
]

IMPORTANT: 
- All starter code MUST be in {coding_language.upper()}, NOT Python (unless language=python)
- Starter code should be incomplete - candidate must implement the logic
- DO NOT provide the solution or answer

Return ONLY valid JSON. No markdown, no explanations, NO solution code."""

    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment writer specializing in coding problems. Always return valid JSON arrays. Never include markdown code blocks."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        content = response.choices[0].message.content.strip()
        questions = _parse_json_response(content, "Coding questions JSON")
        
        # Ensure all questions have language information and remove any solution/answer fields
        validated_questions = []
        for question in questions:
            if not isinstance(question, dict):
                continue
            
            # Remove any solution/answer fields
            clean_question = {k: v for k, v in question.items() 
                            if k not in ["solution", "answer", "completeCode", "finalCode", "implementation"]}
            
            # Ensure required fields
            if not clean_question.get("language"):
                clean_question["language"] = str(_get_judge0_language_id(coding_language))
            if not clean_question.get("codingLanguage"):
                clean_question["codingLanguage"] = coding_language
            # Ensure starter code is in the correct language (fallback to template if missing)
            if not clean_question.get("starterCode"):
                clean_question["starterCode"] = _get_starter_code_template(coding_language)
            
            # Add legacy format fields for frontend compatibility
            if not clean_question.get("title"):
                # Extract title from questionText if available, or use topic
                question_text = clean_question.get("questionText", "")
                if question_text:
                    # Try to extract first line as title
                    first_line = question_text.split("\n")[0].strip()
                    clean_question["title"] = first_line[:100] if len(first_line) > 100 else first_line or topic
                else:
                    clean_question["title"] = topic
            
            if not clean_question.get("problemStatement"):
                clean_question["problemStatement"] = clean_question.get("questionText", "")
            
            # Validate and fix function signature (same logic as DSA module)
            func_sig_raw = clean_question.get("functionSignature")
            title = clean_question.get("title", topic)
            func_sig = _validate_and_fix_function_signature(func_sig_raw, topic=topic, title=title, context="fallback generation")
            clean_question["functionSignature"] = func_sig  # Update with validated/fixed version
            
            # Format function signature as string for frontend editing
            if func_sig and isinstance(func_sig, dict):
                func_name = func_sig.get("name", "function")
                params = func_sig.get("parameters", [])
                return_type = func_sig.get("return_type", "void")
                if params:
                    param_str = ", ".join([f"{p.get('name', '')}: {p.get('type', '')}" for p in params if isinstance(p, dict)])
                else:
                    param_str = ""
                clean_question["functionSignatureString"] = f"{func_name}({param_str}): {return_type}"
            elif func_sig and isinstance(func_sig, str):
                clean_question["functionSignatureString"] = func_sig
            
            # Extract sample input/output from visible test cases
            visible_tcs = clean_question.get("visibleTestCases", [])
            if visible_tcs and len(visible_tcs) > 0:
                first_tc = visible_tcs[0]
                if not clean_question.get("sampleInput"):
                    clean_question["sampleInput"] = first_tc.get("input", "")
                if not clean_question.get("sampleOutput"):
                    clean_question["sampleOutput"] = first_tc.get("output", first_tc.get("expected_output", ""))
                if not clean_question.get("inputFormat"):
                    clean_question["inputFormat"] = "See sample input format below"
                if not clean_question.get("outputFormat"):
                    clean_question["outputFormat"] = "See sample output format below"
            
            # Validate required fields
            if clean_question.get("questionText") and clean_question.get("starterCode"):
                validated_questions.append(clean_question)
            else:
                logger.warning(f"Coding question missing required fields, skipping")
        
        if len(validated_questions) < count:
            logger.warning(f"Generated only {len(validated_questions)} valid coding questions out of {count} requested")
        
        return validated_questions[:count]
        
    except Exception as exc:
        logger.error(f"Error generating Coding questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate Coding questions: {str(exc)}") from exc


async def _is_technical_topic_ai(topic: str) -> bool:
    """
    Detect if a topic is technical/programming-related using OpenAI's models.
    Uses gpt-4o-mini (same as other functionality) for consistency.
    
    Returns True if the topic appears to be technical, False otherwise.
    """
    # Ultra-concise prompt to minimize token usage
    prompt = f"""Is '{topic}' a technical/programming topic? (programming languages, frameworks, software engineering, coding, APIs, databases, etc.)
Respond ONLY in JSON:
{{"isTechnical": true/false}}
"""
    
    models = ["gpt-4o-mini"]  # Same model as other functionality
    
    for model in models:
        try:
            client = _get_openai_client()
            api_params = _build_openai_payload(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a topic classifier. Return only JSON with isTechnical field."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                top_p=0.1,
                max_tokens=10,  # Very small for boolean response
            )
            
            logger.debug(f"Payload for model {model}: {api_params}")
            response = await client.chat.completions.create(**api_params)
            
            content = response.choices[0].message.content.strip()
            
            # Parse JSON response
            try:
                # Remove markdown code blocks if present
                if content.startswith("```"):
                    parts = content.split("```")
                    if len(parts) > 1:
                        content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                        if content.startswith("json"):
                            content = content[4:]
                        content = content.strip()
                
                result = json.loads(content)
                return result.get("isTechnical", False)
                    
            except json.JSONDecodeError as json_err:
                logger.warning(f"Failed to parse JSON from {model}: {json_err}. Content: {content}")
                # Retry with next model if JSON is malformed
                if model == models[0]:  # Only retry once on first model
                    continue
                # If retry also fails, default to False (allow topic, let backend validation catch it)
                return False
                
        except (APIError, APIConnectionError, AuthenticationError, RateLimitError) as api_err:
            logger.warning(f"API error with {model}: {api_err}. Trying fallback...")
            # Continue to next model (fallback)
            if model == models[-1]:  # Last model failed
                logger.error(f"All models failed for technical topic check: {api_err}")
                return False  # Default to False on complete failure
            continue
            
        except Exception as exc:
            logger.error(f"Unexpected error with {model}: {exc}", exc_info=True)
            # Try fallback model
            if model == models[-1]:  # Last model failed
                return False  # Default to False on complete failure
            continue
    
    # Should not reach here, but return False if it does
    return False


async def ai_topic_suggestion(category: str, user_input: str) -> Dict[str, Any]:
    """
    AI-powered topic validation and suggestions.
    
    Validates if the user input is relevant to the selected category and provides suggestions.
    Uses AI to determine relevance based on meaning, not keywords.
    
    Args:
        category: The category ("aptitude" | "communication" | "logical")
        user_input: The user's typed input
        
    Returns:
        {
            "isValid": bool,
            "reason": str,  # Explanation if invalid, or empty if valid
            "suggestions": List[str]  # Up to 5 relevant topic suggestions
        }
    """
    if not user_input or not user_input.strip():
        return {
            "isValid": False,
            "reason": "Input cannot be empty",
            "suggestions": []
        }
    
    category_lower = category.lower()
    if category_lower not in ["aptitude", "communication", "logical"]:
        return {
            "isValid": False,
            "reason": "Invalid category",
            "suggestions": []
        }
    
    # Map category to display name
    category_map = {
        "aptitude": "aptitude (mathematical, quantitative, problem-solving)",
        "communication": "communication (verbal, grammar, writing, language skills)",
        "logical": "logical reasoning (puzzles, patterns, deduction, analytical thinking)"
    }
    category_display = category_map.get(category_lower, category_lower)
    
    prompt = f"""Analyze the topic input: "{user_input}"

Category: {category_display}

Tasks:
1. Determine if this topic is relevant to {category_display}. 
   - REJECT if it's about programming, coding, software development, technical skills (Java, Python, SQL, React, Node, Spring, ML, DSA, APIs, databases, etc.)
   - ACCEPT if it's about {category_display} skills

2. If valid, suggest up to 5 relevant topic names for {category_display} that are similar or related.

Respond ONLY in JSON format:
{{
    "isValid": true/false,
    "reason": "Brief explanation (empty string if valid)",
    "suggestions": ["suggestion1", "suggestion2", ...] (max 5, empty array if invalid)
}}
"""
    
    try:
        client = _get_openai_client()
        api_params = _build_openai_payload(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert topic classifier. Analyze topics and provide validation and suggestions. Always return valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=300,
        )
        
        response = await client.chat.completions.create(**api_params)
        content = response.choices[0].message.content.strip()
        
        # Parse JSON response
        try:
            # Remove markdown code blocks if present
            if content.startswith("```"):
                parts = content.split("```")
                if len(parts) > 1:
                    content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                    if content.startswith("json"):
                        content = content[4:]
                    content = content.strip()
            
            result = json.loads(content)
            
            # Validate and sanitize response
            is_valid = result.get("isValid", False)
            reason = result.get("reason", "")
            suggestions = result.get("suggestions", [])
            
            # Ensure suggestions is a list and limit to 5
            if not isinstance(suggestions, list):
                suggestions = []
            suggestions = [s for s in suggestions[:5] if s and isinstance(s, str) and s.strip()]
            
            return {
                "isValid": bool(is_valid),
                "reason": str(reason) if reason else "",
                "suggestions": suggestions
            }
            
        except json.JSONDecodeError as json_err:
            logger.warning(f"Failed to parse JSON from AI topic suggestion: {json_err}. Content: {content}")
            # Fallback: check if input is technical
            is_technical = await _is_technical_topic_ai(user_input)
            if is_technical:
                return {
                    "isValid": False,
                    "reason": "This topic appears to be technical. Only soft-skill topics are allowed in this category.",
                    "suggestions": []
                }
            # If not technical, assume valid but no suggestions
            return {
                "isValid": True,
                "reason": "",
                "suggestions": []
            }
            
    except Exception as exc:
        logger.error(f"Error in AI topic suggestion: {exc}", exc_info=True)
        # Fallback: check if input is technical
        try:
            is_technical = await _is_technical_topic_ai(user_input)
            if is_technical:
                return {
                    "isValid": False,
                    "reason": "This topic appears to be technical. Only soft-skill topics are allowed in this category.",
                    "suggestions": []
                }
        except:
            pass
        
        # Default to valid on error to allow user to proceed
        return {
            "isValid": True,
            "reason": "",
            "suggestions": []
        }


def _is_technical_topic(topic: str) -> bool:
    """
    Detect if a topic is technical/programming-related (synchronous fallback).
    This is kept for backward compatibility but should use _is_technical_topic_ai for better accuracy.
    """
    topic_lower = topic.lower()
    
    # Technical keywords that should be blocked
    technical_keywords = [
        # Programming languages
        "java", "python", "javascript", "typescript", "c++", "c#", "cpp", "c ", "go ", "rust", "ruby", "php", "swift", "kotlin", "scala", "r ",
        # Frameworks and libraries
        "react", "angular", "vue", "node", "express", "django", "flask", "spring", "laravel", "rails", ".net",
        # Databases
        "sql", "mysql", "postgresql", "mongodb", "redis", "oracle", "database", "db ",
        # Technical concepts
        "api", "rest", "graphql", "microservice", "docker", "kubernetes", "aws", "azure", "gcp", "cloud",
        "algorithm", "data structure", "dsa", "leetcode", "coding", "programming", "software engineering",
        "system design", "architecture", "devops", "ci/cd", "git", "github", "gitlab",
        # Technical terms
        "function", "class", "object", "variable", "array", "list", "hash", "tree", "graph", "stack", "queue",
        "oop", "mvc", "mvp", "mvvm", "design pattern", "refactoring", "testing", "unit test", "integration test",
        "frontend", "backend", "full stack", "web development", "mobile development"
    ]
    
    # Check if topic contains any technical keywords
    for keyword in technical_keywords:
        if keyword in topic_lower:
            return True
    
    # Check if topic is a single programming language name
    programming_languages = ["java", "python", "javascript", "typescript", "c", "cpp", "c++", "go", "rust", "ruby", "php", "swift", "kotlin", "scala", "r"]
    if topic_lower.strip() in programming_languages:
        return True
    
    return False


async def validate_topic_category(topic: str, category: str) -> Dict[str, Any]:
    """
    Validate if a custom topic belongs to the selected non-technical category using OpenAI's models.
    
    Uses gpt-4o-mini (same as other functionality) for consistency.
    
    Args:
        topic: The custom topic entered by the user
        category: The selected category ("aptitude" | "communication" | "logical_reasoning")
    
    Returns:
        {
            "valid": bool,
            "error": Optional[str]  # Error message if validation fails
        }
    """
    # Normalize category
    category_lower = category.lower()
    if category_lower not in ["aptitude", "communication", "logical_reasoning"]:
        return {
            "valid": False,
            "error": "Invalid category. Must be one of: aptitude, communication, logical_reasoning"
        }
    
    # FIRST: Check if topic is technical - reject immediately if so (using AI)
    is_technical = await _is_technical_topic_ai(topic)
    if is_technical:
        return {
            "valid": False,
            "error": "This topic appears to be technical. Only soft-skill topics are allowed in this category."
        }
    
    # Map category to display name for prompt
    category_map = {
        "aptitude": "aptitude",
        "communication": "communication",
        "logical_reasoning": "logical reasoning"
    }
    category_display = category_map.get(category_lower, category_lower)
    
    # Ultra-concise prompt to minimize token usage
    prompt = f"""Check if the topic '{topic}' belongs to category '{category_display}'.
Categories:
aptitude = math/quant/problem solving (NO programming/coding)
communication = verbal/grammar/writing (NO technical topics)
logical = puzzles/patterns/deduction (NO coding/algorithms)
CRITICAL: Reject if topic is about programming, coding, software, or technology.
Respond ONLY in JSON:
{{"valid": true/false}}
"""
    
    models = ["gpt-4o-mini"]  # Same model as other functionality
    
    for model in models:
        try:
            client = _get_openai_client()
            api_params = _build_openai_payload(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a topic classifier. Return only JSON with valid field."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                top_p=0.1,
                frequency_penalty=0,
                presence_penalty=0,
                max_tokens=20,  # Extremely small for classification
            )
            
            logger.debug(f"Payload for model {model}: {api_params}")
            response = await client.chat.completions.create(**api_params)
            
            content = response.choices[0].message.content.strip()
            
            # Parse JSON response
            try:
                # Remove markdown code blocks if present
                if content.startswith("```"):
                    parts = content.split("```")
                    if len(parts) > 1:
                        content = "```".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                        if content.startswith("json"):
                            content = content[4:]
                        content = content.strip()
                
                result = json.loads(content)
                is_valid = result.get("valid", False)
                
                if is_valid:
                    return {"valid": True, "error": None}
                else:
                    return {
                        "valid": False,
                        "error": "❌ The entered topic does not match the selected category. Please enter a valid topic."
                    }
                    
            except json.JSONDecodeError as json_err:
                logger.warning(f"Failed to parse JSON from {model}: {json_err}. Content: {content}")
                # Retry once automatically if JSON is malformed
                if model == models[0]:  # Only retry once on first model
                    continue
                # If retry also fails, treat as invalid
                return {
                    "valid": False,
                    "error": "Unable to validate topic. Please try again."
                }
                
        except (APIError, APIConnectionError, AuthenticationError, RateLimitError) as api_err:
            logger.warning(f"API error with {model}: {api_err}. Trying fallback...")
            # Continue to next model (fallback)
            if model == models[-1]:  # Last model failed
                logger.error(f"All models failed for topic validation: {api_err}")
                return {
                    "valid": False,
                    "error": "Unable to validate topic. Please try again."
                }
            continue
            
        except Exception as exc:
            logger.error(f"Unexpected error with {model}: {exc}", exc_info=True)
            # Try fallback model
            if model == models[-1]:  # Last model failed
                return {
                    "valid": False,
                    "error": "Unable to validate topic. Please try again."
                }
            continue
    
    # Should not reach here, but return invalid if it does
    return {
        "valid": False,
        "error": "Unable to validate topic. Please try again."
    }


