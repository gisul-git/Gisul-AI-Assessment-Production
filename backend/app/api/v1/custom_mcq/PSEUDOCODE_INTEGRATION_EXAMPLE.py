"""
Example: How to add Pseudocode AI Evaluation to Custom MCQ Assessment Submission

This file shows the code changes needed to integrate pseudocode evaluation
into the existing submit_custom_mcq_assessment endpoint.
"""

# ============================================================================
# STEP 1: Add Import at the top of routers.py
# ============================================================================

from ...assessments.services.unified_ai_evaluation import (
    evaluate_pseudocode_answer,
    aggregate_section_evaluation,
    generate_overall_assessment_summary
)


# ============================================================================
# STEP 2: Modify the submission separation logic (around line 1262)
# ============================================================================

# OLD CODE:
# mcq_submissions = []
# subjective_submissions = []

# NEW CODE:
mcq_submissions = []
subjective_submissions = []
pseudocode_submissions = []  # ADD THIS LINE

for submission in request.submissions:
    question = questions_dict.get(submission.questionId)
    if not question:
        continue

    question_type_raw = question.get("questionType", "")
    question_type = str(question_type_raw).lower().strip() if question_type_raw else ""
    
    # ADD PSEUDOCODE DETECTION
    if question_type == "pseudocode" or question_type == "pseudo code":
        if submission.textAnswer:
            question_marks = question.get("marks", 1)
            if isinstance(question_marks, str):
                try:
                    question_marks = int(question_marks)
                except (ValueError, TypeError):
                    question_marks = 1
            if question_marks < 1:
                question_marks = 1
            
            pseudocode_submissions.append({
                "questionId": submission.questionId,
                "question": question,
                "questionText": question.get("questionText") or question.get("question", ""),
                "answer": submission.textAnswer,
                "max_marks": question_marks,
                "section": question.get("section", ""),
                "sampleInput": question.get("sampleInput"),
                "expectedOutput": question.get("expectedOutput"),
                "rubric": question.get("rubric"),
                "difficulty": question.get("difficulty", "Medium")
            })
        continue  # Skip to next submission
    
    # ... rest of existing logic for MCQ and Subjective ...


# ============================================================================
# STEP 3: Add Pseudocode Evaluation (after subjective evaluation, around line 1434)
# ============================================================================

# Grade pseudocode questions using AI
pseudocode_score = 0
pseudocode_total = 0

logger.info(f"Grading: {len(mcq_submissions)} MCQ, {len(subjective_submissions)} subjective, {len(pseudocode_submissions)} pseudocode submissions")

if pseudocode_submissions:
    try:
        logger.info(f"Starting AI grading for {len(pseudocode_submissions)} pseudocode questions")
        grading_status = "grading"
        
        pseudocode_evaluations = []
        for sub in pseudocode_submissions:
            try:
                evaluation = await evaluate_pseudocode_answer(
                    question_id=sub["questionId"],
                    question_text=sub["questionText"],
                    candidate_answer=sub["answer"],
                    max_marks=sub["max_marks"],
                    section=sub.get("section"),
                    sample_input=sub.get("sampleInput"),
                    expected_output=sub.get("expectedOutput"),
                    rubric=sub.get("rubric"),
                    difficulty=sub.get("difficulty", "Medium")
                )
                pseudocode_evaluations.append(evaluation)
                
                score = float(evaluation.get("score", 0))
                max_marks = sub["max_marks"]
                pseudocode_total += max_marks
                pseudocode_score += score
                
                logger.info(f"Pseudocode question {sub['questionId']}: scored {score}/{max_marks}")
                
                # Add to graded_submissions
                graded_submissions.append({
                    "questionId": sub["questionId"],
                    "questionType": "pseudocode",
                    "textAnswer": sub["answer"],
                    "marksAwarded": round(score, 2),
                    "maxMarks": max_marks,
                    "feedback": evaluation.get("feedback", {}).get("summary", ""),
                    "detailed_feedback": evaluation.get("feedback", {}),
                    "reasoning": evaluation.get("answer_log", {}).get("partial_credit_reasoning", ""),
                    "ai_evaluation": evaluation  # Store full evaluation
                })
            except Exception as e:
                logger.exception(f"Error evaluating pseudocode question {sub['questionId']}: {e}")
                # Add with 0 marks on error
                max_marks = sub["max_marks"]
                pseudocode_total += max_marks
                graded_submissions.append({
                    "questionId": sub["questionId"],
                    "questionType": "pseudocode",
                    "textAnswer": sub["answer"],
                    "marksAwarded": 0,
                    "maxMarks": max_marks,
                    "feedback": f"Error during AI evaluation: {str(e)}",
                    "detailed_feedback": {},
                    "reasoning": "",
                    "ai_evaluation": None
                })
        
        grading_status = "completed"
        logger.info(f"Pseudocode AI grading completed: {len(pseudocode_evaluations)} evaluations")
        
    except Exception as e:
        logger.exception(f"Error during pseudocode AI grading: {e}")
        grading_status = "error"
        # Still save submissions but with 0 marks
        for sub in pseudocode_submissions:
            max_marks = sub["max_marks"]
            pseudocode_total += max_marks
            graded_submissions.append({
                "questionId": sub["questionId"],
                "questionType": "pseudocode",
                "textAnswer": sub["answer"],
                "marksAwarded": 0,
                "maxMarks": max_marks,
                "feedback": "Error during AI grading. Please contact administrator.",
                "detailed_feedback": {},
                "reasoning": "",
                "ai_evaluation": None
            })


# ============================================================================
# STEP 4: Update Score Calculation (around line 1452)
# ============================================================================

# OLD CODE:
# total_score = mcq_score + subjective_score
# total_marks = mcq_total + subjective_total

# NEW CODE:
total_score = mcq_score + subjective_score + pseudocode_score
total_marks = mcq_total + subjective_total + pseudocode_total


# ============================================================================
# STEP 5: (Optional) Add Section Aggregation and Overall Summary
# ============================================================================

# After calculating all scores, you can optionally generate comprehensive summaries:

try:
    # Collect all AI evaluations
    all_evaluations = []
    
    # Add subjective evaluations (if using enhanced version)
    # all_evaluations.extend(subjective_evaluations)
    
    # Add pseudocode evaluations
    all_evaluations.extend(pseudocode_evaluations)
    
    # Generate section summary
    section_summary = await aggregate_section_evaluation(
        section_name="Assessment",
        question_evaluations=all_evaluations
    )
    
    # Generate overall summary
    overall_summary = await generate_overall_assessment_summary(
        section_summaries=[section_summary],
        question_evaluations=all_evaluations,
        job_role=None  # Can be extracted from assessment if available
    )
    
    # Store in submission document
    submission_data = {
        # ... existing fields ...
        "section_summary": section_summary,
        "overall_evaluation": overall_summary
    }
    
except Exception as e:
    logger.warning(f"Could not generate comprehensive evaluation summary: {e}")
    # Continue without summary - basic scoring still works


# ============================================================================
# COMPLETE EXAMPLE: Modified submit_custom_mcq_assessment function
# ============================================================================

"""
The complete modified function would look like this (showing key changes):

@router.post("/submit")
async def submit_custom_mcq_assessment(...):
    # ... existing code for fetching assessment, validation ...
    
    # Separate submissions by type
    mcq_submissions = []
    subjective_submissions = []
    pseudocode_submissions = []  # NEW
    
    for submission in request.submissions:
        question = questions_dict.get(submission.questionId)
        if not question:
            continue
        
        question_type = str(question.get("questionType", "")).lower().strip()
        
        if question_type == "mcq" and submission.selectedAnswers:
            mcq_submissions.append({...})
        elif question_type == "subjective" and submission.textAnswer:
            subjective_submissions.append({...})
        elif question_type in ["pseudocode", "pseudo code"] and submission.textAnswer:  # NEW
            pseudocode_submissions.append({...})
    
    # Grade MCQ (existing code)
    # ... MCQ grading ...
    
    # Grade Subjective (existing code)
    # ... Subjective AI grading ...
    
    # Grade Pseudocode (NEW)
    pseudocode_score = 0
    pseudocode_total = 0
    if pseudocode_submissions:
        for sub in pseudocode_submissions:
            evaluation = await evaluate_pseudocode_answer(...)
            # Process evaluation and add to graded_submissions
            pseudocode_score += evaluation["score"]
            pseudocode_total += sub["max_marks"]
    
    # Calculate totals (UPDATED)
    total_score = mcq_score + subjective_score + pseudocode_score
    total_marks = mcq_total + subjective_total + pseudocode_total
    percentage = (total_score / total_marks * 100) if total_marks > 0 else 0
    
    # ... rest of existing code ...
"""


