# Question Generation Context Enhancement - Implementation Summary

## Overview
Enhanced the AI question generation system to incorporate job role, experience level, and company context when generating questions across all question types (MCQ, Subjective, PseudoCode, Coding, SQL, AIML).

## Problem Statement
Previously, the question generation system generated generic questions without considering:
- The specific job role the candidate is applying for
- The candidate's experience level (junior/mid-level/senior)
- The company name and context

This led to mismatched questions like asking senior-level architecture questions to junior candidates, or using generic company references instead of the actual company name.

## Solution Implemented

### 1. Enhanced `generate_questions_for_topic` Function (services.py)

#### Updated Function Signature
Added new parameters to capture contextual information:
- `job_designation`: Job role/title (e.g., "Senior Software Engineer", "Junior Developer")
- `experience_min`: Minimum years of experience required
- `experience_max`: Maximum years of experience required
- `requirements`: Main requirements (may contain company name, URL, etc.)
- `optional_requirements`: Additional optional requirements

#### Context Extraction Logic
```python
# Automatic company name extraction from requirements
company_name = None
if requirements or optional_requirements:
    # Uses regex patterns to find company names
    # Patterns: "company:", "organization:", "at [CompanyName]"
    
# Seniority level determination
if experience_min and experience_max:
    avg_experience = (experience_min + experience_max) / 2
    if avg_experience < 2: seniority_level = "junior"
    elif avg_experience < 5: seniority_level = "mid-level"
    else: seniority_level = "senior"
```

#### Enhanced Prompt Context
The system now builds rich contextual prompts that include:

**For Corporate/Professional Candidates:**
- Role phrase: "You are {role_designation} at {company_name}"
- Complexity guidance based on seniority:
  - **Junior**: Simple, single-component scenarios with clear requirements
  - **Mid-level**: Moderate scenarios with multiple components, trade-offs, or debugging
  - **Senior**: Complex, multi-stakeholder scenarios involving architecture, design, and business impact
- Explicit instructions to avoid asking senior questions to junior candidates

**For Student/College Candidates:**
- Scenarios related to academic projects, internships, lab tasks
- Appropriate complexity for limited industry experience
- Focus on foundational concepts and learning scenarios

### 2. Updated Question Generation Prompts

#### Subjective Questions
Enhanced requirements now include:
```
- Use the provided job role and company context when framing questions
- If job role is provided, frame scenarios using that role (e.g., "You are a {job_role} at {company}...")
- If company name is provided, incorporate it into the scenario naturally
- Ensure seniority level matches the experience range
- For senior roles: Include architectural decisions, system design, mentoring, strategic choices
- For junior roles: Focus on implementation, code quality, debugging, learning scenarios
- For mid-level roles: Balance between implementation and design decisions
```

#### MCQ Questions
- When creating scenario-based MCQs, incorporate job role and company context
- Ensure question complexity matches candidate's experience level

#### PseudoCode Questions
- Incorporate job role and company context for scenario-based questions
- Complexity matches experience level (simpler algorithms for junior, complex optimization for senior)

### 3. Updated `generate_questions_for_row_v2` Function (ai_question_generator.py)

Enhanced the V2 API function to:
- Accept `job_designation`, `experience_min`, `experience_max` parameters
- Extract company name from `company_context` or `website_summary`
- Build combined requirements including company context
- Pass all contextual information to `generate_questions_for_topic`

### 4. Updated All API Endpoints (routers.py)

Modified 6 API endpoints to extract and pass contextual information:

**Extraction added before each `generate_questions_for_row_v2` call:**
```python
# Extract job role and experience for contextual question generation
job_designation = assessment.get("jobDesignation")
experience_min = assessment.get("experienceMin")
experience_max = assessment.get("experienceMax")
```

**Enhanced function calls:**
```python
questions = await generate_questions_for_row_v2(
    # ... existing parameters ...
    job_designation=job_designation,
    experience_min=experience_min,
    experience_max=experience_max
)
```

**Affected endpoints:**
1. `/generate-question` (line ~3555) - Generate single question row
2. `/generate-all-questions-v2` (line ~3647) - Generate all questions for assessment
3. `/regenerate-question-in-review` (line ~3861) - Regenerate specific question
4. Draft endpoint 1 (line ~4816) - Draft question generation
5. Draft endpoint 2 (line ~4908) - Draft all questions generation  
6. Draft regenerate (line ~5122) - Draft question regeneration

### 5. Updated `generate_questions_for_topic_safe` Wrapper (services.py)

Updated the safe wrapper function to accept and pass through all new contextual parameters.

## Examples of Enhanced Question Generation

### Before Enhancement
**Subjective Question (Generic):**
```
You are a Senior Software Engineer at a large tech company, and you need to optimize 
a database query that handles millions of records...
```

### After Enhancement

**For Junior Developer at Gisul (0-2 years experience):**
```
You are a Junior Developer at Gisul working on the company's web application. 
You've been assigned to implement a feature that displays a list of users from the 
database. The current implementation is slow. How would you approach debugging and 
improving the performance?
```

**For Senior Engineer at Gisul (7-10 years experience):**
```
You are a Senior Software Engineer at Gisul leading the architecture for a new 
microservices-based system. The system needs to handle 100,000 concurrent users 
across multiple regions. How would you design the database architecture to ensure 
scalability, availability, and data consistency? What trade-offs would you consider?
```

## Data Flow

```
Assessment Creation
├── User inputs: jobDesignation, experienceMin, experienceMax, requirements
│
API Endpoint (routers.py)
├── Extracts: job_designation, experience_min, experience_max from assessment
├── Passes to: generate_questions_for_row_v2()
│
Question Generator V2 (ai_question_generator.py)
├── Extracts company name from company_context
├── Builds combined requirements
├── Calls: generate_questions_for_topic()
│
Core Generator (services.py)
├── Determines seniority level from experience range
├── Extracts company name from requirements if not provided
├── Builds context-aware prompt with:
│   ├── Job role phrases
│   ├── Company name
│   ├── Seniority-appropriate complexity guidance
│   └── Experience-level-specific scenario types
│
OpenAI API
├── Generates questions with full context
└── Returns role-appropriate, company-specific questions
```

## Benefits

### 1. **Role-Appropriate Questions**
- Junior candidates get implementation-focused questions
- Mid-level candidates get balanced questions with some design considerations
- Senior candidates get architecture, leadership, and strategic questions

### 2. **Personalized Company Context**
- Questions reference the actual company the candidate is applying to
- Creates more realistic and relevant scenarios
- Improves candidate engagement and assessment quality

### 3. **Experience-Aligned Complexity**
- No more asking junior candidates about system architecture
- No more asking senior candidates trivial implementation questions
- Better alignment between question difficulty and candidate level

### 4. **Consistent Application**
- All question types (MCQ, Subjective, PseudoCode, Coding, SQL, AIML) benefit
- Both legacy (V1) and new (V2) API endpoints updated
- Consistent experience across draft and finalized assessments

## Files Modified

1. **backend/app/api/v1/assessments/services.py**
   - Enhanced `generate_questions_for_topic()` function
   - Added context extraction logic
   - Updated prompts with role/experience/company context
   - Enhanced `generate_questions_for_topic_safe()` wrapper

2. **backend/app/api/v1/assessments/services/ai_question_generator.py**
   - Updated `generate_questions_for_row_v2()` signature
   - Added company name extraction
   - Implemented delegation to enhanced core generator

3. **backend/app/api/v1/assessments/routers.py**
   - Updated 6 API endpoints to extract contextual data
   - Added job_designation, experience_min, experience_max parameters to all calls

## Testing Recommendations

### 1. Unit Tests
- Test seniority level determination logic
- Test company name extraction from various requirement formats
- Test prompt building with different context combinations

### 2. Integration Tests
- Create assessments with different experience ranges
- Generate questions and verify they match the seniority level
- Test with and without company names
- Test with and without job designations

### 3. End-to-End Tests
- Create assessment for "Junior Developer at Gisul" (0-2 years)
  - Verify questions are appropriate for junior level
  - Verify "Gisul" appears in scenario-based questions
  
- Create assessment for "Senior Architect at Microsoft" (8-12 years)
  - Verify questions involve architecture and design
  - Verify "Microsoft" appears in scenarios

### 4. Edge Cases
- Empty job designation
- Missing experience range
- No company name in requirements
- Experience range with only min or only max

## Backward Compatibility

The implementation maintains full backward compatibility:
- All new parameters are optional with defaults
- Existing API calls without new parameters continue to work
- Legacy V1 endpoints updated but maintain existing behavior when context not provided
- No breaking changes to API contracts

## Future Enhancements

1. **Company URL Processing**
   - Fetch and summarize company website
   - Extract company culture, tech stack, and values
   - Incorporate into question generation

2. **Industry-Specific Questions**
   - Detect industry from requirements (fintech, healthcare, etc.)
   - Generate industry-specific scenarios

3. **Team Size Context**
   - Small startup vs large enterprise scenarios
   - Adjust questions based on company size

4. **Custom Question Templates**
   - Allow companies to provide their own question templates
   - Merge company templates with AI-generated questions

## Conclusion

This enhancement significantly improves the quality and relevance of AI-generated assessment questions by making them contextually aware of the job role, candidate experience level, and company. Questions are now tailored to each assessment's specific context, resulting in more accurate candidate evaluation and better hiring decisions.

