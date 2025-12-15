"""
Semantic topic suggestions and context generation for Aptitude, Communication, and Logical Reasoning.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

try:
    from openai import AsyncOpenAI
except ImportError:
    AsyncOpenAI = None

from ....core.config import get_settings

logger = logging.getLogger(__name__)


def _is_technical_topic(topic: str) -> bool:
    """
    Detect if a topic is technical/programming-related.
    Returns True if the topic appears to be technical, False otherwise.
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


def _get_openai_client() -> AsyncOpenAI:
    """Get OpenAI client instance."""
    settings = get_settings()
    api_key = getattr(settings, 'openai_api_key', None)
    if not api_key:
        raise ValueError("OpenAI API key not configured")
    return AsyncOpenAI(api_key=api_key)


async def suggest_topic_contexts(
    partial_input: str,
    category: str  # "aptitude", "communication", "logical_reasoning"
) -> List[Dict[str, Any]]:
    """
    Generate semantic topic suggestions based on partial user input.
    Returns list of suggested topic contexts with their semantic meaning.
    """
    if not partial_input or len(partial_input.strip()) < 2:
        return []
    
    category_descriptions = {
        "aptitude": "numerical problem-solving, quantitative reasoning, mathematical calculations",
        "communication": "written communication, professional correspondence, clarity and tone",
        "logical_reasoning": "analytical thinking, pattern recognition, logical problem-solving"
    }
    
    category_description = category_descriptions.get(category.lower(), "general assessment")
    
    # Build strict prompt for soft-skill categories
    soft_skill_categories = ["aptitude", "communication", "logical_reasoning"]
    is_soft_skill = category.lower() in soft_skill_categories
    
    if is_soft_skill:
        prompt = f"""You are an expert assessment designer. Generate ONLY soft-skill topic suggestions.

User is typing: "{partial_input}"
Category: {category_description}

CRITICAL RULES - STRICTLY ENFORCE:
- Generate ONLY non-technical, soft-skill topics
- ABSOLUTELY FORBIDDEN: programming languages, coding, algorithms, software engineering, technical frameworks
- Even if user types technical terms, suggest ONLY soft-skill topics related to the category

Generate 4-6 relevant topic suggestions that:
- Are ONLY soft-skill, non-technical topics
- Match the semantic meaning of the partial input (interpreted as soft-skill context)
- Are specific and assessment-ready
- Fit naturally within the {category_description} category
- Are domain-agnostic (work for any context)

Return ONLY a JSON array of topic labels:
[
  "Topic Suggestion 1",
  "Topic Suggestion 2",
  "Topic Suggestion 3",
  ...
]

Do NOT include explanations or markdown. Return only the JSON array."""
    else:
        prompt = f"""You are an expert assessment designer. Generate topic suggestions based on semantic understanding.

User is typing: "{partial_input}"
Category: {category_description}

Generate 4-6 relevant topic suggestions that:
- Match the semantic meaning of the partial input
- Are specific and assessment-ready
- Fit naturally within the {category_description} category
- Are domain-agnostic (work for any context)

Return ONLY a JSON array of topic labels:
[
  "Topic Suggestion 1",
  "Topic Suggestion 2",
  "Topic Suggestion 3",
  ...
]

Do NOT include explanations or markdown. Return only the JSON array."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks."
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
        
        suggestions = json.loads(content)
        if not isinstance(suggestions, list):
            suggestions = [suggestions] if suggestions else []
        
        # Filter out technical topics for soft-skill categories
        filtered_suggestions = []
        for s in suggestions:
            if s and isinstance(s, str):
                topic_str = str(s).strip()
                # For soft-skill categories, filter out technical topics
                if is_soft_skill and _is_technical_topic(topic_str):
                    logger.warning(f"Filtered out technical suggestion: {topic_str}")
                    continue
                filtered_suggestions.append({"label": topic_str, "value": topic_str})
        
        return filtered_suggestions
        
    except Exception as exc:
        logger.error(f"Error generating topic suggestions: {exc}", exc_info=True)
        return []


async def generate_topic_context_summary(
    topic_name: str,
    category: str
) -> Dict[str, Any]:
    """
    Generate context summary and suggested question type for a topic.
    Returns: {
        "contextSummary": str,
        "suggestedQuestionType": "MCQ" | "Subjective",
        "reasoning": str
    }
    """
    category_descriptions = {
        "aptitude": "numerical problem-solving and quantitative reasoning",
        "communication": "written communication, professional correspondence",
        "logical_reasoning": "analytical thinking and logical problem-solving"
    }
    
    category_description = category_descriptions.get(category.lower(), "general assessment")
    
    prompt = f"""You are an expert assessment designer. Analyze this topic and generate a context summary.

Topic: "{topic_name}"
Category: {category_description}

Generate:
1. A brief context summary (1-2 sentences) explaining what this topic evaluates
2. Suggested question type: MCQ or Subjective
   - MCQ: for numeric calculations, factual recall, quick assessment
   - Subjective: for explanations, scenarios, written responses
3. Brief reasoning for the question type choice

Return ONLY JSON:
{{
  "contextSummary": "This topic evaluates...",
  "suggestedQuestionType": "MCQ" or "Subjective",
  "reasoning": "Brief explanation"
}}"""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON. Never include markdown code blocks."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
        )
        
        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        result = json.loads(content)
        
        # Validate question type
        suggested_type = result.get("suggestedQuestionType", "MCQ")
        if suggested_type not in ["MCQ", "Subjective"]:
            suggested_type = "MCQ"
        
        return {
            "contextSummary": result.get("contextSummary", f"This topic evaluates {category_description}."),
            "suggestedQuestionType": suggested_type,
            "reasoning": result.get("reasoning", "Based on topic analysis")
        }
        
    except Exception as exc:
        logger.error(f"Error generating context summary: {exc}", exc_info=True)
        # Fallback
        return {
            "contextSummary": f"This topic evaluates {category_description}.",
            "suggestedQuestionType": "MCQ",
            "reasoning": "Default assignment"
        }


async def suggest_topics(
    category: str,
    query: str
) -> List[str]:
    """
    Generate AI-powered topic suggestions based on category and partial query.
    
    Args:
        category: "aptitude" | "communication" | "logical_reasoning" | "technical" | "auto"
        query: Partial user input
    
    Returns:
        List of suggested topic names
    """
    if not query or len(query.strip()) < 1:
        # If query is empty, return popular suggestions for the category
        return await _get_popular_suggestions(category)
    
    category_lower = category.lower()
    soft_skill_categories = ["aptitude", "communication", "logical_reasoning"]
    is_soft_skill = category_lower in soft_skill_categories
    
    category_descriptions = {
        "aptitude": "numerical problem-solving, quantitative reasoning, mathematical calculations, percentages, ratios, time/speed/distance, profit/loss, logical puzzles, quant skills, problem-solving items. NO programming, coding, or software topics.",
        "communication": "speaking skills, grammar, writing skills, comprehension, listening, professional correspondence, language skills, writing clarity, email etiquette, professional tone. NO technical or programming topics.",
        "logical_reasoning": "deductions, patterns, non-verbal reasoning, analytical puzzles, syllogisms, sequences, logical problem-solving. NO coding, algorithms, or software engineering topics.",
        "technical": "programming, software engineering, technology, frameworks, tools, systems, implementation, real-world engineering topics",
        "auto": "mixed categories - infer the most suitable category based on the query"
    }
    
    category_description = category_descriptions.get(category_lower, "general assessment topics")
    
    # Build strict prompt for soft-skill categories
    if is_soft_skill:
        prompt = f"""You are an expert in generating SOFT-SKILL assessment topics. Generate ONLY non-technical topics.

CRITICAL RULES - STRICTLY ENFORCE:
- Category: {category}
- User entered text: "{query}"

ABSOLUTELY FORBIDDEN - DO NOT SUGGEST:
- Programming languages (Java, Python, JavaScript, C, C++, etc.)
- Coding or programming topics
- Data structures or algorithms
- System design or software architecture
- Any software engineering topics
- Technical frameworks or tools

REQUIRED - ONLY SUGGEST:
- For aptitude: numerical reasoning, logical puzzles, quant skills, problem-solving items (math-based, NOT coding)
- For communication: speaking skills, grammar, writing skills, comprehension, listening, professional writing
- For logical reasoning: deductions, patterns, non-verbal reasoning, analytical puzzles (NOT coding puzzles)

Even if user types technical terms like "java" or "python", suggest ONLY soft-skill topics that relate to the category.

Generate 6-10 suggested topics that:
- Are ONLY soft-skill, non-technical topics
- Fit the {category} category perfectly
- Are relevant to the user's input (but interpret it as soft-skill context)
- Are concise, specific, and assessment-ready
- Are NOT repetitive
- Are appropriate for professional assessments

Return ONLY a JSON array of topic names:
["Topic A", "Topic B", "Topic C", ...]

Do NOT include explanations or markdown. Return only the JSON array."""
    else:
        prompt = f"""You are an expert in categorizing and generating assessment topics.

Given:
- Selected category: {category}
- User entered text: "{query}"

Generate a list of 6-10 suggested topics that:
- Belong naturally to the specified category (or inferred category if auto-detect)
- Are relevant completions or extensions of the user partial query
- Are concise, specific, and assessment-ready
- Are not repetitive
- Are appropriate for professional assessments
- For technical: include real-world engineering topics
- For aptitude: include numerical/quantitative reasoning topics
- For communication: include language, writing, comprehension topics
- For logical reasoning: include pattern, deduction, puzzle, analysis topics
- For auto-detect: infer the most suitable category based on the query and return mixed suggestions

Return ONLY a JSON array of topic names:
["Topic A", "Topic B", "Topic C", ...]

Do NOT include explanations or markdown. Return only the JSON array."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert assessment designer. Always return valid JSON arrays. Never include markdown code blocks."
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
        
        suggestions = json.loads(content)
        if not isinstance(suggestions, list):
            suggestions = [suggestions] if suggestions else []
        
        # Filter out technical topics for soft-skill categories
        filtered_suggestions = []
        for s in suggestions:
            if s and isinstance(s, str):
                topic_str = str(s).strip()
                # For soft-skill categories, filter out technical topics
                if is_soft_skill and _is_technical_topic(topic_str):
                    logger.warning(f"Filtered out technical suggestion: {topic_str}")
                    continue
                filtered_suggestions.append(topic_str)
        
        # Return only valid strings, limit to 10
        return filtered_suggestions[:10]
        
    except Exception as exc:
        logger.error(f"Error generating topic suggestions: {exc}", exc_info=True)
        return []


async def _get_popular_suggestions(category: str) -> List[str]:
    """Get popular/default suggestions for a category when query is empty."""
    popular_by_category = {
        "aptitude": [
            "Percentage Calculations",
            "Ratio & Proportion",
            "Time & Work Problems",
            "Profit & Loss",
            "Simple & Compound Interest",
            "Average & Mixtures",
            "Number Systems",
            "Algebra Basics"
        ],
        "communication": [
            "Email Etiquette",
            "Professional Writing",
            "Sentence Reconstruction",
            "Reading Comprehension",
            "Grammar & Vocabulary",
            "Business Communication",
            "Report Writing",
            "Presentation Skills"
        ],
        "logical_reasoning": [
            "Syllogisms",
            "Seating Arrangements",
            "Pattern Recognition",
            "Blood Relations",
            "Direction Sense",
            "Coding-Decoding",
            "Analytical Puzzles",
            "Logical Sequences"
        ],
        "technical": [
            "REST API Design",
            "Database Optimization",
            "System Design Principles",
            "Algorithm Complexity",
            "Security Best Practices",
            "Code Refactoring",
            "Testing Strategies",
            "Performance Optimization"
        ],
        "auto": [
            "Problem Solving",
            "Critical Thinking",
            "Data Analysis",
            "System Design",
            "Communication Skills",
            "Technical Writing",
            "Logical Reasoning",
            "Quantitative Analysis"
        ]
    }
    
    return popular_by_category.get(category.lower(), popular_by_category["auto"])


async def classify_technical_topic(topic: str) -> Dict[str, Any]:
    """
    Classify a technical topic to determine question type, coding support, and context.
    
    Returns:
    {
        "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding",
        "canUseJudge0": bool,
        "coding_supported": bool,  # NEW: Whether topic supports coding questions
        "contextExplanation": str
    }
    """
    from .services import determine_topic_coding_support
    
    # Determine coding support using ENGINE-DRIVEN logic
    coding_supported = await determine_topic_coding_support(topic)
    
    prompt = f"""You are an expert technical assessor. Analyze the following topic:

Topic: {topic}

Determine:
1. The topic category type based on semantic meaning:
   - concept/theory
   - logic/algorithm
   - implementation/coding

2. The most appropriate question type:
   - MCQ -> for basic factual technical recall
   - Subjective -> for conceptual, architectural, or explanation-focused topics
   - PseudoCode -> for algorithmic or logic-flow topics
   - Coding -> ONLY if the topic clearly requires writing runnable code

3. Determine whether Coding is valid and supported by Judge0.
   Coding is allowed ONLY IF:
      - The topic implies an algorithm, data structure operation,
        computation, programmatic task, or implementable logic
      - AND it can be evaluated via input/output test cases.

4. Return:
{{
  "questionType": "...",
  "canUseJudge0": true | false,
  "contextExplanation": "Short explanation of how you interpreted this topic."
}}

Do NOT generate the question here. Only classify.

Return ONLY valid JSON. No markdown, no explanations."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert technical assessor. Always return valid JSON. Never include markdown code blocks."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
        )
        
        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        
        result = json.loads(content)
        
        # Validate question type
        valid_types = ["MCQ", "Subjective", "PseudoCode", "Coding"]
        question_type = result.get("questionType", "MCQ")
        if question_type not in valid_types:
            question_type = "MCQ"
        
        # Validate canUseJudge0
        can_use_judge0 = bool(result.get("canUseJudge0", False))
        
        # If question type is not Coding, canUseJudge0 must be false
        if question_type != "Coding":
            can_use_judge0 = False
        
        # If coding_supported is True, ensure canUseJudge0 is also True for Coding type
        if coding_supported and question_type == "Coding":
            can_use_judge0 = True
        
        return {
            "questionType": question_type,
            "canUseJudge0": can_use_judge0,
            "coding_supported": coding_supported,  # NEW: Engine-driven coding support
            "contextExplanation": result.get("contextExplanation", f"This topic evaluates technical knowledge in {topic}.")
        }
        
    except Exception as exc:
        logger.error(f"Error classifying technical topic: {exc}", exc_info=True)
        # Fallback to safe defaults
        return {
            "questionType": "MCQ",
            "canUseJudge0": False,
            "coding_supported": coding_supported,  # Still use the determined coding support
            "contextExplanation": f"This topic evaluates technical knowledge in {topic}."
        }


async def _detect_category_semantically(topic_name: str) -> str:
    """
    Detect topic category using semantic understanding.
    Returns: "aptitude", "communication", "logical_reasoning", or "technical"
    """
    prompt = f"""You are an expert at categorizing assessment topics. Analyze this topic and determine its category.

Topic: "{topic_name}"

Categories:
1. "aptitude" - Numerical problem-solving, quantitative reasoning, mathematical calculations, percentages, ratios, time/speed/distance, profit/loss
2. "communication" - Written communication, professional correspondence, email etiquette, formal writing, clarity and tone
3. "logical_reasoning" - Analytical thinking, pattern recognition, logical problem-solving, puzzles, sequences, deductions
4. "technical" - Programming, technology, frameworks, tools, systems, implementation (default for technical topics)

Return ONLY the category name (one word): aptitude, communication, logical_reasoning, or technical
No explanations, just the category."""
    
    try:
        client = _get_openai_client()
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at categorizing topics. Always return only the category name, no explanations."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=10,
        )
        
        content = response.choices[0].message.content.strip().lower()
        
        # Validate category
        valid_categories = ["aptitude", "communication", "logical_reasoning", "technical"]
        if content in valid_categories:
            return content
        
        return "technical"  # Default fallback
        
    except Exception as exc:
        logger.warning(f"Error detecting category: {exc}. Defaulting to technical.")
        return "technical"
