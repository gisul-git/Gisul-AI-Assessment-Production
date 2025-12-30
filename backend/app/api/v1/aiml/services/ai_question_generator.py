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
    
    # Build difficulty-specific guidance with strict calibration
    difficulty_guidance = {
        "easy": """EASY difficulty - NON-NEGOTIABLE CALIBRATION:
- DIRECT, EXPLICIT INSTRUCTIONS: Problem provides clear, unambiguous direction
- SINGLE CLEAR SOLUTION PATH: One obvious, straightforward approach - no ambiguity about which method to use
- MINIMAL AMBIGUITY: Problem statement is clear, requirements are explicit
- FOCUS ON BASIC CONCEPTS: Tests basic syntax, data structures, or simple transformations
- Difficulty comes from correct application of fundamental concepts, not from choosing between approaches
- For Python topics: Focus on Python language usage (syntax, data types, basic operations)
- For ML/DL topics: Focus on basic model usage or simple transformations
- No trade-offs or conflicting requirements
- Straightforward reasoning: Apply known patterns or techniques directly""",
        
        "medium": """MEDIUM difficulty - NON-NEGOTIABLE CALIBRATION:
- MULTIPLE VALID APPROACHES: Several viable solutions exist, candidate must SELECT
- REQUIRES SELECTION, COMPARISON, OR REASONING: Must choose between approaches with justification
- MODERATE AMBIGUITY: Problem has some ambiguity that requires reasoning to resolve
- COMBINES LOGIC WITH STRUCTURED THINKING: Not just execution, requires understanding trade-offs
- Decision-oriented tasks: "Which approach is better and why?" not "Do X, then Y"
- Requires understanding of when and why to use different methods
- Real-world scenarios with practical constraints that inform decisions
- Tasks must be outcome-focused with justification required for choices
- Difficulty reflects reasoning depth: understanding trade-offs and making informed selections""",
        
        "hard": """HARD difficulty - NON-NEGOTIABLE CALIBRATION:
- NO OBVIOUS OR SINGLE BEST SOLUTION: Multiple approaches exist, each with different trade-offs
- CONFLICTING CONSTRAINTS OR TRADE-OFFS: Problem has competing requirements that create tension
- REQUIRES DESIGN DECISIONS, INTERPRETATION, OR ARCHITECTURAL THINKING: Not just implementation
- FORCES DEEPER REASONING BEYOND EXECUTION: Must analyze limitations, interpret results, justify decisions
- Real-world constraints and edge cases that create ambiguity requiring judgment
- MANDATORY: At least ONE task involving interpretation of results OR analysis of limitations OR trade-off discussion
- Interpretation/limitation tasks must NOT reveal solutions but require critical thinking
- Must address questions like "what are the limitations?" or "how would you interpret this?" or "what are the trade-offs?"
- Tasks require deep reasoning, strategic thinking, and critical evaluation
- Difficulty reflects reasoning depth: navigating ambiguity, analyzing trade-offs, and interpreting limitations"""
    }
    
    diff_guide = difficulty_guidance.get(difficulty.lower(), difficulty_guidance["medium"])
    
    # Build prompt
    topic_text = f"\nTopic: {topic}" if topic else ""
    
    prompt = f"""You are an AI assessment generator for an AIML competency assessment platform.

Your responsibility is to generate ONE complete AIML/Python competency question that reflects REAL-WORLD scenarios and requires DECISION-MAKING.
You may optionally generate a dataset depending on the complexity of the question.

CRITICAL PRINCIPLE: Difficulty reflects REASONING DEPTH, not procedural steps or library complexity.
This applies globally across Python, AI, ML, DL, and Data Science questions.

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

IMPORTANT: Question difficulty must reflect REASONING DEPTH across all domains:
- A hard Python question requires deep reasoning, not just complex syntax
- A hard ML question requires trade-off analysis, not just using advanced libraries
- A hard DL question requires architectural reasoning, not just model complexity
- A hard Data Science question requires analytical judgment, not just data manipulation steps

==================================================
ASSESSMENT TITLE INTEGRATION (CRITICAL)
==================================================

The Assessment Title "{title}" is the PRIMARY context for this question.

You MUST:
- Generate a question that directly relates to and reflects the Assessment Title
- Use the title to inform the real-world scenario, domain, and problem context
- Ensure the question aligns with the assessment's purpose and focus
- The title should guide the problem domain, industry context, or application area

Example: If title is "E-commerce Customer Segmentation", create a question about customer segmentation in e-commerce context, not generic ML.

==================================================
SKILL-TOPIC ALIGNMENT (STRICT - NON-NEGOTIABLE)
==================================================

CRITICAL: Ensure the actual tasks test the SELECTED TOPIC, not adjacent skills.

STRICT ALIGNMENT RULES:

1. TOPIC-SPECIFIC TESTING (MANDATORY):
   - If topic is Python-specific (e.g., data types, list comprehensions, generators, OOP, decorators, context managers):
     * The difficulty MUST come from Python language usage, NOT from ML or business reasoning
     * Tasks must require using the specific Python feature/concept
     * Example: If topic is "List Comprehensions", tasks must require list comprehensions, not just any Python code
   - If topic is ML-specific (e.g., feature engineering, model evaluation, cross-validation):
     * Tasks must test ML concepts, not just Python syntax
     * Difficulty comes from ML reasoning, not Python complexity
   - If topic is DL-specific (e.g., CNNs, RNNs, transfer learning):
     * Tasks must test DL concepts, not just framework usage
   - If topic is Data Science-specific (e.g., EDA, data preprocessing):
     * Tasks must test data analysis reasoning, not just library calls

2. TOPIC CANNOT BE BYPASSED (MANDATORY):
   - Do NOT allow questions where the topic can be bypassed or ignored
   - The selected topic must be ESSENTIAL to solving the problem
   - Candidates cannot solve the problem without engaging with the topic
   - Example: If topic is "Generators", the solution MUST use generators, not lists or other alternatives

3. SKILL-TOPIC MATCHING:
   - Skill: Python, Topic: "List Comprehensions" → Test Python list comprehension usage
   - Skill: Python, Topic: "OOP" → Test object-oriented programming in Python
   - Skill: Machine Learning, Topic: "Feature Engineering" → Test feature engineering reasoning
   - Skill: Deep Learning, Topic: "CNNs" → Test CNN architecture and reasoning
   - Skill: Data Science, Topic: "EDA" → Test exploratory data analysis thinking

4. DIFFICULTY SOURCE MUST MATCH TOPIC:
   - For Python topics: Difficulty from Python language complexity, not ML reasoning
   - For ML topics: Difficulty from ML reasoning, not Python syntax
   - For DL topics: Difficulty from DL architecture/design, not just implementation
   - For Data Science topics: Difficulty from analytical reasoning, not data manipulation steps

5. VALIDATION CHECK:
   - Ask: "Can this question be solved without using the selected topic?" If yes, redesign.
   - Ask: "Does the difficulty come from the selected topic area?" If no, recalibrate.
   - Ask: "Are the tasks testing the selected topic directly?" If no, refocus.

Current Input:
- Skill: {skill}
- Topic: {topic if topic else "None"}

You MUST ensure the question directly tests the topic "{topic if topic else skill}" and cannot be solved by bypassing it.

==================================================
QUESTION DESCRIPTION REQUIREMENTS (MANDATORY)
==================================================

Every question description MUST include ALL THREE components:

1. REAL-WORLD DOMAIN CONTEXT (Required):
   - Specific industry or domain (e.g., healthcare, finance, e-commerce, manufacturing, logistics)
   - Domain-specific terminology and context
   - Realistic business scenario or use case
   - Reference the Assessment Title: "{title}" to inform the domain

2. CLEAR OBJECTIVE (Required):
   - Explicitly state what needs to be accomplished
   - Define the desired outcome or goal
   - Explain the business value or purpose

3. AT LEAST ONE PRACTICAL CONSTRAINT OR TRADE-OFF (Required):
   - Resource limitations (time, compute, data size)
   - Business constraints (interpretability, latency, cost)
   - Conflicting requirements (accuracy vs. speed, complexity vs. interpretability)
   - Data quality issues or limitations
   - Regulatory or ethical considerations

Example structure:
"[Domain Context] You are a data scientist at [company/industry]. [Business scenario with domain specifics]. [Clear Objective] Your goal is to [specific outcome]. [Constraint/Trade-off] However, you must balance [requirement A] with [requirement B], and [limitation]."

==================================================
TASK DESIGN (QUALITY UPGRADE - MANDATORY)
==================================================

REPLACE procedural step-based tasks with outcome-driven, decision-oriented tasks.
Each task must test THINKING, not just execution.

This applies globally across Python, AI, ML, DL, and Data Science questions.

QUALITY REQUIREMENTS:

1. OUTCOME-DRIVEN, NOT PROCEDURAL (MANDATORY):
   ❌ AVOID step-based/procedural tasks like:
   - "Load the dataset"
   - "Train a model"
   - "Split the data"
   - "Calculate metrics"
   - "Implement function X"
   - "Use algorithm Y"
   - "Create a class"
   - "Write a function"
   
   ✅ USE outcome-driven, decision-oriented tasks requiring:
   - JUSTIFICATION: "Determine the most appropriate [approach] for [constraint] and justify your choice"
   - INTERPRETATION: "Interpret the results considering [context] and explain what they mean"
   - DESIGN CHOICES: "Design a [solution] that addresses [challenge] and explain your design decisions"
   - TRADE-OFF ANALYSIS: "Analyze the trade-offs between [approach A] and [approach B] and recommend the best option"
   - REASONING: "Select and implement a [solution] that balances [requirement A] and [requirement B], explaining your reasoning"
   - EVALUATION: "Evaluate [approach] considering [constraints] and recommend improvements"

2. TEST THINKING, NOT JUST EXECUTION (MANDATORY):
   - Each task must require reasoning, justification, interpretation, or design choices
   - Tasks must test understanding of WHY, not just HOW
   - Focus on WHAT to achieve and WHY, not just HOW (outcome-focused)
   - Present scenarios where candidates must make decisions, not follow steps
   - Tasks should require candidates to think about trade-offs, constraints, and alternatives

3. AVOID REPETITIVE PATTERNS (MANDATORY):
   - Do NOT use the same task structure across multiple questions
   - Vary task types and approaches
   - Use different internal archetypes to create diverse task structures
   - Avoid formulaic task patterns (e.g., always starting with "Load data", then "Preprocess", then "Train")
   - Create unique, engaging task sequences that test different aspects of reasoning

4. DIFFICULTY-APPROPRIATE TASK COMPLEXITY:
   - For Easy: Provide explicit guidance but still require outcome-focused thinking (single clear path)
   - For Medium: Require choosing between multiple valid approaches with justification (selection/comparison)
   - For Hard: Require trade-off analysis, interpretation, limitation discussion, or architectural thinking (deep reasoning)

5. TOPIC-SPECIFIC TASK FOCUS:
   - Tasks must directly test the selected topic
   - For Python topics: Tasks should require Python language features (e.g., "Design a generator that...")
   - For ML topics: Tasks should require ML reasoning (e.g., "Select a model that balances...")
   - Tasks cannot be solved without engaging with the selected topic

==================================================
INTERNAL QUESTION ARCHETYPES (NOT EXPOSED IN OUTPUT)
==================================================

Use these INTERNAL archetypes to vary question structure (do NOT mention archetype in output):

1. ANALYSIS: Analyze data/patterns and draw insights with reasoning
2. MODEL COMPARISON: Compare multiple models/approaches and justify selection
3. DEBUGGING: Diagnose issues in code/model behavior and propose solutions
4. FEATURE REASONING: Engineer features with domain knowledge and justify choices
5. PIPELINE DESIGN: Design end-to-end solutions considering constraints
6. OPTIMIZATION: Improve existing solutions with trade-off analysis
7. INTERPRETATION: Interpret results, identify limitations, and make recommendations
8. PROBLEM-SOLVING: Solve business problems with appropriate ML/AI techniques

Rotate between these archetypes internally to avoid repetitive task structures. The archetype guides your question design but is NOT mentioned in the output JSON.

==================================================
DIFFICULTY CALIBRATION (NON-NEGOTIABLE)
==================================================

Difficulty MUST be calibrated strictly according to these rules.
This applies globally across Python, AI, ML, DL, and Data Science questions.

{diff_guide}

KEY PRINCIPLES (Non-Negotiable):
- Easy: Direct explicit instructions, single clear solution path, minimal ambiguity, focus on basic concepts
- Medium: Multiple valid approaches, requires selection/comparison/reasoning, moderate ambiguity, combines logic with structured thinking
- Hard: No obvious best solution, conflicting constraints/trade-offs, requires design decisions/interpretation/architectural thinking, forces deeper reasoning beyond execution
- Difficulty is NOT about:
  * Number of procedural steps
  * Library complexity (e.g., using TensorFlow doesn't make it hard)
  * Code length or syntax complexity
  * Number of features or data size
  * Business context complexity
- Difficulty IS about:
  * Depth of reasoning required
  * Complexity of decision-making
  * Ambiguity and trade-off analysis needed
  * Interpretation and critical thinking required
  * Design decisions and architectural thinking
- For Python topics: Difficulty comes from Python language reasoning (e.g., when to use generators vs lists, OOP design decisions)
- For ML topics: Difficulty comes from ML reasoning (e.g., model selection, feature engineering trade-offs)
- For DL topics: Difficulty comes from architectural reasoning (e.g., layer design, optimization strategies)
- For Data Science topics: Difficulty comes from analytical reasoning (e.g., interpreting patterns, handling ambiguity)
- An "easy" question can use advanced libraries if the reasoning path is straightforward and explicit

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
QUESTION REQUIREMENTS (GLOBAL ENFORCEMENT)
==================================================

You MUST generate:
- ONE AIML competency coding question

The question MUST (applies globally across Python, AI, ML, DL, and Data Science):
- Be runnable in a Jupyter notebook
- Require writing executable Python code
- Include ALL THREE in description (MANDATORY):
  * (1) Real-world domain context: Specific industry/domain with realistic scenario
  * (2) Clear objective: Explicitly state what needs to be accomplished
  * (3) At least one realistic constraint: Time, memory, interpretability, cost, risk, regulatory, etc.
- Use outcome-driven, decision-oriented tasks (NOT step-based/procedural tasks)
- Each task must test THINKING, not just execution
- Require justification, interpretation, or design choices in tasks
- Match the selected difficulty based on NON-NEGOTIABLE calibration rules
- Test the SELECTED TOPIC directly (cannot be bypassed)
- NOT be multiple-choice
- NOT include solutions or hints
- Include decision-making elements appropriate to difficulty level
- Be grounded in real-world context
- Relate to the Assessment Title: "{title}"
- Avoid repetitive task patterns (use varied structures)
- For Hard difficulty (MANDATORY): Include at least one task involving:
  * Interpretation of results, OR
  * Analysis of limitations, OR
  * Trade-off discussion
  * Must NOT provide hints or solutions

==================================================
REALISTIC DATASET REQUIREMENTS (ONLY IF GENERATED)
==================================================

CRITICAL: These rules apply WHENEVER a dataset is generated, across ALL question types (Python, AI, ML, DL, Data Science) and ALL difficulty levels.

Generate datasets with REALISTIC COMPLEXITY rather than clean, deterministic patterns.

If a dataset is generated, it MUST be REALISTIC and MEANINGFUL with these requirements:

SIZE CONSTRAINTS (Preserved):
- EXACTLY 30 rows
- 4 to 7 columns

DOMAIN-SPECIFIC REALISM (Required):
- Domain-specific feature names that reflect the Assessment Title context: "{title}"
- Feature names should be realistic for the domain (e.g., "patient_age", "transaction_amount", "product_rating")
- Values should be domain-appropriate and realistic (not random numbers)
- Realistic distributions and relationships between features
- Data patterns that reflect real-world scenarios

DATA QUALITY CHARACTERISTICS - REALISTIC COMPLEXITY (Required):

CRITICAL: Generate datasets with REALISTIC COMPLEXITY, not clean deterministic patterns.
Apply these rules whenever a dataset is generated:

1. AVOID TRIVIAL CORRELATIONS AND TARGET LEAKAGE (MANDATORY):
   * NO features that directly encode or reveal the target
   * NO derived or redundant features that perfectly predict the target
   * NO features that would not be available at prediction time
   * NO features derived from the target variable
   * Ensure features are causally appropriate and temporally valid
   * Features should not have perfect or near-perfect correlation with target
   * Avoid features that make the problem trivial (e.g., "is_churned" for churn prediction)

2. INTRODUCE MILD AMBIGUITY (MANDATORY):
   * Include CONTRADICTORY SAMPLES: Similar feature values should map to DIFFERENT outcomes
   * Create overlapping feature distributions where the same feature combination can lead to different results
   * Add realistic ambiguity that requires reasoning, not deterministic patterns
   * Example: Two customers with similar profiles (age, spend, tenure) but different outcomes (churned vs. retained)

3. ADD REALISTIC NOISE OR UNCERTAINTY (MANDATORY):
   * Include slight inconsistencies or imperfect signals
   * Add realistic noise while keeping the dataset small (30 rows)
   * For classification: Slight class imbalance (e.g., 60/40 or 70/30 split, not 50/50)
   * For regression: Minor outliers or noise in target variable
   * Missing values or slight inconsistencies (if appropriate for difficulty)
   * Imperfect correlations and realistic variance

4. ENSURE NO SINGLE FEATURE CAN PERFECTLY PREDICT TARGET (MANDATORY):
   * No single feature or category alone can perfectly predict the target
   * Multiple features must work together to make predictions
   * Create realistic complexity where feature interactions matter
   * Avoid deterministic rules that make the problem too simple

5. PREFER DOMAIN-RELEVANT BUT IMPERFECT FEATURES (MANDATORY):
   * Use domain-relevant feature names and values (reflect Assessment Title: "{title}")
   * Features should be realistic for the domain but NOT perfectly clean
   * Prefer imperfect, noisy features over clean synthetic ones
   * Real-world data is messy - reflect this in the dataset
   * Domain-appropriate features with realistic imperfections

6. MEANINGFULLY INFLUENCE DECISIONS:
   * Dataset should enable meaningful feature selection choices (some features more relevant than others)
   * Data should support model comparison decisions (different models may perform differently)
   * Include features that create interesting trade-offs (e.g., interpretability vs. predictive power)
   * Data characteristics should influence preprocessing, feature engineering, or model selection decisions
   * Dataset should require reasoning about data quality, feature importance, or model suitability
   * Contradictory samples and noise should require candidates to reason about data quality and model robustness

TARGET/LABEL COLUMN:
- Include a label/target column for ML/DL tasks
- Target should be realistic and meaningful for the domain

FORMAT:
- Dataset must be FORMAT-AGNOSTIC
- You MUST provide:
  * schema (array of {{"name": "...", "type": "int|float|string|bool"}})
  * rows (array of arrays, where each inner array represents one row)

Example: For "Customer Churn Prediction" in e-commerce:
- Features: customer_id, account_age_months, monthly_spend, support_tickets_last_month, avg_order_value, is_premium_member
- Target: churned (0/1)
- Realistic complexity: account_age_months has moderate correlation (not perfect), support_tickets may indicate issues but not deterministically
- Mild ambiguity: Include contradictory samples - e.g., two customers with similar profiles (age=35, spend=$200, premium=yes) but different outcomes (one churned, one retained)
- Realistic noise: Slight inconsistencies in data (e.g., some high-spend customers churned, some low-spend retained - realistic variance)
- Mild imbalance: 65% non-churned, 35% churned
- No trivial correlations: No single feature perfectly predicts churn (e.g., not all premium members retained, not all high-spend customers retained)
- No leakage: Don't include "days_since_last_purchase" or "churn_date" (not available at prediction time)
- Imperfect features: Domain-relevant but imperfect (e.g., support_tickets may correlate but not perfectly, monthly_spend has variance)
- Meaningful decisions: Dataset enables feature selection choices, supports model comparison, requires reasoning about data quality

If dataset is NOT required:
- Set "dataset": null

==================================================
QUESTION DESCRIPTION GUIDELINES
==================================================

The "description" field MUST include (MANDATORY - all three required):
1. REAL-WORLD DOMAIN CONTEXT: Specific industry/domain with realistic scenario
   - Include domain-specific terminology and context
   - Reference the Assessment Title context: "{title}"
   - Set up a believable scenario that a professional would encounter

2. CLEAR OBJECTIVE: Explicitly state what needs to be accomplished
   - Define the desired outcome or goal
   - Explain the business value or purpose
   - Be specific about what success looks like

3. AT LEAST ONE REALISTIC CONSTRAINT (MANDATORY):
   - Time constraints (e.g., "must complete within 2 hours")
   - Memory/compute constraints (e.g., "limited to 4GB RAM")
   - Interpretability requirements (e.g., "model must be explainable to stakeholders")
   - Cost constraints (e.g., "budget limited to $X")
   - Risk constraints (e.g., "false positives are costly")
   - Regulatory constraints (e.g., "must comply with GDPR")
   - Data quality constraints (e.g., "missing values cannot be imputed")
   - Performance constraints (e.g., "latency must be under 100ms")
   - Or other realistic business/technical constraints

Additional guidelines:
- Be 2-3 paragraphs total
- NO examples in description
- NO detailed technical constraints in description (high-level constraints only; detailed technical constraints go in "constraints" field)
- Focus on the problem statement, domain context, objective, and key realistic constraints

The "tasks" field MUST:
- Include 3-5 decision-oriented, outcome-focused tasks (NOT step-based/procedural)
- Replace procedural steps with tasks requiring justification, interpretation, or design choices
- For EASY: Tasks provide explicit guidance but should still be outcome-oriented (single clear solution path)
- For MEDIUM: At least 2 tasks must require choosing between multiple valid approaches and justifying the selection
- For HARD: At least 2 tasks must require decision-making with trade-off analysis, AND at least 1 task must be interpretation of results OR analysis of limitations (e.g., "Analyze the limitations of your approach", "Interpret the results considering [constraint]", "What are the potential issues with this solution?", "How would you explain these results to stakeholders?")
- Hard interpretation/limitation tasks must NOT reveal solutions but require critical thinking
- Tasks should build upon each other logically
- Focus on WHAT to achieve and WHY, not just HOW (outcome-focused)
- Require reasoning depth appropriate to difficulty level

The "constraints" field should:
- Include technical constraints (e.g., "Use scikit-learn", "No external data sources")
- Include performance or quality requirements
- Include any specific requirements or limitations
- Complement the constraints/trade-offs mentioned in the description

==================================================
CRITICAL TECHNICAL RULES
==================================================

❌ DO NOT generate CSV, PDF, Parquet, Avro, or any file
❌ DO NOT format output as tables or markdown
❌ DO NOT include explanations outside JSON
❌ DO NOT mention answers or solutions
❌ DO NOT convert dataset into selected format
❌ DO NOT add explanations or hints in the dataset (dataset should be raw data only)

✅ Output MUST be STRICT JSON ONLY
✅ Dataset field MUST exist (object or null)
✅ Question text must remain unchanged for all users
✅ Question must reflect Assessment Title: "{title}"
✅ Question must include decision-making elements
✅ Question must be grounded in real-world context
✅ Dataset must be realistic complexity (not clean deterministic patterns)

==================================================
INPUT PROVIDED TO YOU
==================================================

Assessment Title: {title} ⭐ PRIMARY CONTEXT - Use this to guide the problem domain and scenario
Skill: {skill}
Topic (optional): {topic if topic else "None"}
Difficulty: {difficulty} (reflects REASONING COMPLEXITY, not library usage)
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
    "description": "[REAL-WORLD DOMAIN CONTEXT: 2-3 sentences with specific industry/domain, referencing Assessment Title '{title}'] [CLEAR OBJECTIVE: What needs to be accomplished and why] [AT LEAST ONE PRACTICAL CONSTRAINT OR TRADE-OFF: Resource limitations, business constraints, or conflicting requirements]. 2-3 paragraphs total. NO examples, NO detailed constraints (those go in constraints field).",
    "tasks": [
      "Task 1: [Outcome-oriented task requiring reasoning/justification, NOT procedural]",
      "Task 2: [Decision-making task - e.g., 'Determine which approach... and justify' or 'Choose between... based on...']",
      "Task 3: [Outcome-oriented task with decision element]",
      "Task 4: [For HARD only: Interpretation/limitation-analysis task - e.g., 'Analyze limitations...' or 'Interpret results considering...']"
    ],
    "constraints": [
      "Constraint 1: [Technical constraint]",
      "Constraint 2: [Requirement or limitation]"
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
    "description": "[REAL-WORLD DOMAIN CONTEXT: 2-3 sentences with specific industry/domain, referencing Assessment Title '{title}'] [CLEAR OBJECTIVE: What needs to be accomplished and why] [AT LEAST ONE PRACTICAL CONSTRAINT OR TRADE-OFF: Resource limitations, business constraints, or conflicting requirements]. 2-3 paragraphs total. NO examples, NO detailed constraints (those go in constraints field).",
    "tasks": [
      "Task 1: [Outcome-oriented task requiring reasoning/justification, NOT procedural]",
      "Task 2: [Decision-making task - e.g., 'Determine which approach... and justify' or 'Choose between... based on...']",
      "Task 3: [Outcome-oriented task with decision element]",
      "Task 4: [For HARD only: Interpretation/limitation-analysis task - e.g., 'Analyze limitations...' or 'Interpret results considering...']"
    ],
    "constraints": [
      "Constraint 1: [Technical constraint]",
      "Constraint 2: [Requirement or limitation]"
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

Before responding, VERIFY (Global Enforcement):

STRUCTURE & SCHEMA:
✓ JSON is valid and parsable
✓ All required fields present (preserved JSON schema)
✓ No text outside JSON
✓ Internal archetype used but NOT exposed in output

SKILL-TOPIC ALIGNMENT (STRICT - NON-NEGOTIABLE):
✓ Question directly tests the SELECTED TOPIC: "{topic if topic else skill}"
✓ Topic cannot be bypassed or ignored - it is ESSENTIAL to solving the problem
✓ For Python topics: Difficulty comes from Python language usage, NOT from ML or business reasoning
✓ For ML topics: Difficulty comes from ML reasoning, NOT from Python syntax
✓ For DL topics: Difficulty comes from DL architecture/design, NOT just implementation
✓ For Data Science topics: Difficulty comes from analytical reasoning, NOT data manipulation steps
✓ Tasks require using/testing the selected topic directly
✓ Validation: Question cannot be solved without engaging with the selected topic

QUESTION CONTENT (Global - applies to Python, AI, ML, DL, Data Science):
✓ Question reflects Assessment Title: "{title}"
✓ Description includes ALL THREE: (1) Real-world domain context, (2) Clear objective, (3) At least one realistic constraint (time, memory, interpretability, cost, risk, etc.)
✓ Question is grounded in REAL-WORLD context (not abstract)
✓ Question matches skill: {skill} and topic: {topic if topic else "None"}

TASK DESIGN QUALITY (Quality Upgrade - Mandatory):
✓ Tasks are OUTCOME-DRIVEN and DECISION-ORIENTED (NOT step-based/procedural like "load data", "train model")
✓ Each task tests THINKING, not just execution
✓ Tasks require justification, interpretation, or design choices
✓ Tasks avoid repetitive patterns (varied structures, not formulaic)
✓ Tasks are topic-specific and cannot be solved without the selected topic
✓ For Easy: Single clear solution path with explicit guidance
✓ For Medium: Multiple valid approaches requiring selection/comparison/reasoning
✓ For Hard: Requires design decisions, interpretation, or architectural thinking

DIFFICULTY CALIBRATION (NON-NEGOTIABLE):
✓ For EASY: Direct explicit instructions, single clear solution path, minimal ambiguity, focus on basic concepts
✓ For MEDIUM: Multiple valid approaches, requires selection/comparison/reasoning, moderate ambiguity, combines logic with structured thinking
✓ For HARD: No obvious best solution, conflicting constraints/trade-offs, requires design decisions/interpretation/architectural thinking, forces deeper reasoning beyond execution
✓ For HARD (MANDATORY): At least one task involving interpretation of results OR analysis of limitations OR trade-off discussion
✓ Hard interpretation/limitation task does NOT reveal solutions or provide hints
✓ Difficulty reflects reasoning depth, NOT procedural steps, library complexity, or code length
✓ Difficulty source matches topic type (Python language reasoning for Python topics, ML reasoning for ML topics, etc.)

DATASET (If Generated) - REALISTIC COMPLEXITY:
✓ Dataset included ONLY when required: {requires_dataset}
✓ Dataset has EXACTLY 30 rows if present (preserved constraint)
✓ Dataset has 4-7 columns (preserved constraint)
✓ Dataset uses DOMAIN-SPECIFIC feature names (not generic, reflects Assessment Title: "{title}")
✓ Dataset has REALISTIC COMPLEXITY (not clean deterministic patterns)
✓ Dataset includes MILD AMBIGUITY (contradictory samples: similar features → different outcomes)
✓ Dataset includes REALISTIC NOISE/UNCERTAINTY (slight inconsistencies, imperfect signals)
✓ Dataset AVOIDS TRIVIAL CORRELATIONS (no perfect/near-perfect correlations with target)
✓ Dataset AVOIDS TARGET LEAKAGE (no features revealing target, no derived/redundant features encoding target)
✓ NO SINGLE FEATURE can perfectly predict target (multiple features must work together)
✓ Dataset uses DOMAIN-RELEVANT BUT IMPERFECT features (prefer imperfect over clean synthetic)
✓ Dataset MEANINGFULLY INFLUENCES DECISIONS (enables feature selection, model comparison, trade-off analysis)
✓ Dataset requires reasoning about data quality, ambiguity, and model robustness

TECHNICAL:
✓ Libraries are appropriate: {json.dumps(libraries)}
✓ All validation logic preserved

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
                    "content": "You are an expert AI assessment generator for AIML competency assessment. You create real-world, decision-based questions that test reasoning complexity, not just library knowledge. Always return valid JSON only. Never include markdown code blocks or explanations outside JSON."
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
