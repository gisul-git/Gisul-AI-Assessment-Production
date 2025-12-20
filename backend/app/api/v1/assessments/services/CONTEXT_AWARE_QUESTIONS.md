# 🎯 Context-Aware Question Generation Implementation

## 📋 **Overview**

This document explains the context-aware question generation feature that personalizes questions based on assessment requirements, job role, company, and experience level.

---

## ✨ **Feature Description**

### **Before (Generic Questions)**
```
Question: "Explain how you would design a REST API for user authentication."
```

### **After (Context-Aware Personalized Questions)**
```
Assessment Requirements: "Candidate will work at Gisul as a Senior Backend Engineer using Python and AWS"
Topic Additional Requirements: "Focus on microservices architecture with high availability"

Generated Question:
"You are a Senior Backend Engineer at Gisul working on Python microservices deployed on AWS. 
Your team is building a high-availability authentication service that needs to handle 10M+ 
requests per day with 99.99% uptime SLA. Design a REST API authentication strategy that works 
across 50+ microservices. Explain your approach to token management, service-to-service 
authentication, session storage in a distributed environment, and how you would ensure zero 
downtime during deployments for Gisul's platform."
```

---

## 🎯 **Priority Hierarchy**

Questions are personalized based on context in this priority order:

```
1. ASSESSMENT REQUIREMENTS (Highest Priority)
   ↓ From "Requirements" field in assessment creation
   ↓ Example: "Candidate will work at Gisul on AWS serverless architecture"
   
2. TOPIC ADDITIONAL REQUIREMENTS
   ↓ From "Additional Requirements" for specific topics
   ↓ Example: "Focus on microservices with high availability"
   
3. JOB DESIGNATION
   ↓ From job role field
   ↓ Example: "Senior Software Engineer"
   
4. COMPANY NAME
   ↓ From company context
   ↓ Example: "Gisul"
   
5. EXPERIENCE LEVEL
   ↓ From experience range
   ↓ Example: 5-10 years (Senior-level)
```

**All context is combined and sent to the AI with explicit instructions to USE IT.**

---

## 🔧 **Technical Implementation**

### **File Modified**
```
backend/app/api/v1/assessments/services/ai_question_generator.py
```

### **Changes Made**

#### **1. Main Entry Point Function**

**Function**: `generate_questions_for_row_v2()`

**Added Parameter**:
```python
assessment_requirements: Optional[str] = None  # Global requirements from assessment creation
```

**Purpose**: Pass assessment-level requirements to all question generators.

---

#### **2. MCQ Question Generator**

**Function**: `_generate_mcq_questions()`

**Added Parameter**:
```python
assessment_requirements: Optional[str] = None  # Global requirements
```

**Context Building** (Priority Order):
```python
context_parts = []

# Priority 1: Assessment-level requirements (HIGHEST)
if assessment_requirements:
    context_parts.append(f"**Assessment Context (CRITICAL - USE THIS)**: {assessment_requirements}")

# Priority 2: Topic-level requirements
if additional_requirements:
    context_parts.append(f"**Topic-Specific Requirements**: {additional_requirements}")

# Priority 3: Job role and company
if job_designation:
    context_parts.append(f"**Job Role**: {job_designation}")

if company_name:
    context_parts.append(f"**Company**: {company_name}")

# Priority 4: Experience level
if experience_min is not None and experience_max is not None:
    # Calculate seniority level
    context_parts.append(f"**Experience Required**: {years_text} ({seniority})")

personalization_context = "\n".join(context_parts)
```

**Prompt Enhancement**:
- Added `CRITICAL: PERSONALIZATION CONTEXT (HIGHEST PRIORITY - MUST USE)` section
- Explicit instructions to use exact context from requirements
- Examples showing WITH context vs WITHOUT context
- Final reminder that generic questions are only acceptable when NO context provided

---

#### **3. Subjective Question Generator**

**Function**: `_generate_subjective_questions()`

**Added Parameter**:
```python
assessment_requirements: Optional[str] = None  # Global requirements
```

**Context Building**: Same priority order as MCQ

**Prompt Enhancement**:
- Added `CRITICAL: PERSONALIZATION CONTEXT (HIGHEST PRIORITY - MUST USE)` section
- Mandatory personalization requirements with examples
- Scenario framing examples showing:
  - ✅ WITH FULL CONTEXT (company + role + technology)
  - ✅ WITH ASSESSMENT REQUIREMENTS (healthcare HIPAA compliance)
  - ✅ WITH TOPIC REQUIREMENTS (microservices high availability)
  - ❌ WITHOUT CONTEXT (generic - avoid)
- 2-4 sentence structure guide (context → problem → what to explain)
- Final reminder to USE the context in EVERY question

---

#### **4. PseudoCode Question Generator**

**Function**: `_generate_pseudocode_questions()`

**Added Parameter**:
```python
assessment_requirements: Optional[str] = None  # Global requirements
```

**Context Building**: Updated to include assessment and topic requirements

**Note**: PseudoCode currently uses legacy implementation, but signature updated for future enhancement.

---

## 📊 **Example Use Cases**

### **Example 1: AWS Serverless Architecture**

**Input**:
```
Assessment Requirements: "Candidate will work at Gisul as Senior Backend Engineer using Python and AWS serverless"
Job Designation: "Senior Backend Engineer"
Company: "Gisul"
Experience: 5-10 years
Topic: "API Design"
Additional Requirements: "Focus on rate limiting"
```

**Generated Subjective Question**:
```
You are a Senior Backend Engineer at Gisul working on AWS serverless architecture. 
Your team is building a public API using AWS API Gateway and Lambda that needs to handle 
10M+ requests per day from mobile apps. Design a rate-limiting strategy that prevents 
abuse while ensuring legitimate users aren't impacted. Explain your approach to:
1. Setting appropriate rate limits for different user tiers (free vs premium)
2. Implementing rate limiting using AWS API Gateway features and Lambda
3. Handling burst traffic without affecting legitimate users
4. Cost optimization considering Gisul's AWS budget
5. Monitoring and alerting for rate limit violations
```

---

### **Example 2: Healthcare HIPAA Compliance**

**Input**:
```
Assessment Requirements: "Focus on healthcare applications with HIPAA compliance"
Job Designation: "Software Engineer"
Experience: 3-5 years
Topic: "Data Security"
```

**Generated Subjective Question**:
```
Your application handles sensitive patient health records and must comply with HIPAA 
regulations. Explain your approach to implementing encryption for data at rest and in 
transit. Include specific Python libraries you would use, key management strategies 
using AWS KMS, and how you would ensure audit logging meets HIPAA requirements. Also 
discuss your approach to access control and data retention policies.
```

---

### **Example 3: Microservices High Availability**

**Input**:
```
Assessment Requirements: "Candidate will work at Gisul on microservices platform"
Topic: "System Design"
Additional Requirements: "Focus on high availability 99.99% uptime"
Experience: 5-10 years
```

**Generated Subjective Question**:
```
You are a Senior Engineer at Gisul. Your team is building a microservices platform 
that requires 99.99% uptime SLA. Design a deployment strategy that allows zero-downtime 
updates across 50+ microservices. Explain your approach to:
1. Blue-green vs canary deployments (which would you choose and why)
2. Rollback procedures if issues are detected
3. Health checks and readiness probes
4. Database schema migrations without downtime
5. Coordination across dependent services
```

---

### **Example 4: Generic (No Context)**

**Input**:
```
Assessment Requirements: (none)
Topic: "REST API Design"
Experience: 3-5 years
```

**Generated Subjective Question** (Generic is OK when no context):
```
Explain the differences between REST and GraphQL APIs. When would you choose one 
over the other? Provide real-world scenarios where each approach is more appropriate, 
considering factors like performance, complexity, and team expertise.
```

---

## 🚀 **Usage in Router**

**File**: `routers.py`

**Update Required**: Pass `assessment_requirements` when calling `generate_questions_for_row_v2()`

```python
# Extract requirements from assessment
assessment_requirements = assessment.requirements if hasattr(assessment, 'requirements') else None

# Extract topic-level requirements
topic_additional_requirements = row.additional_requirements if hasattr(row, 'additional_requirements') else None

questions = await generate_questions_for_row_v2(
    topic_label=topic_label,
    question_type=question_type,
    difficulty=difficulty,
    questions_count=questions_count,
    can_use_judge0=can_use_judge0,
    coding_language=coding_language,
    additional_requirements=topic_additional_requirements,      # Topic-specific
    experience_mode=experience_mode,
    job_designation=assessment.job_designation,
    experience_min=assessment.experience_min,
    experience_max=assessment.experience_max,
    company_name=company_context.get("company_name") if company_context else None,
    assessment_requirements=assessment_requirements             # ⭐ NEW - Global requirements
)
```

---

## ✅ **Benefits**

1. **Personalized Scenarios**: Questions reference actual company, role, and technologies
2. **Relevant Context**: Questions align with candidate's actual job responsibilities
3. **Better Assessment**: Evaluate candidates on scenarios they'll actually face
4. **Reduced Generic Questions**: AI forced to use provided context
5. **Clear Priority**: Assessment requirements take highest priority

---

## 📝 **Testing**

### **Test Case 1: With Full Context**

```python
questions = await generate_questions_for_row_v2(
    topic_label="API Design",
    question_type="Subjective",
    difficulty="Medium",
    questions_count=2,
    can_use_judge0=False,
    job_designation="Senior Backend Engineer",
    experience_min=5,
    experience_max=10,
    company_name="Gisul",
    assessment_requirements="Candidate will work at Gisul on AWS serverless architecture using Python"
)

# Expected: Questions mention "Gisul", "AWS serverless", "Python", "Senior Backend Engineer"
```

### **Test Case 2: With Topic Requirements**

```python
questions = await generate_questions_for_row_v2(
    topic_label="Microservices",
    question_type="Subjective",
    difficulty="Hard",
    questions_count=2,
    can_use_judge0=False,
    additional_requirements="Focus on high availability and zero-downtime deployments",
    experience_min=5,
    experience_max=10
)

# Expected: Questions mention "high availability", "zero-downtime", deployment strategies
```

### **Test Case 3: Generic (No Context)**

```python
questions = await generate_questions_for_row_v2(
    topic_label="Python Basics",
    question_type="MCQ",
    difficulty="Easy",
    questions_count=4,
    can_use_judge0=False
)

# Expected: Generic professional questions (context not required for basics)
```

---

## 🎯 **Success Criteria**

After implementation:

1. ✅ **Assessment requirements** appear in generated questions
2. ✅ **Company name** referenced in scenario-based questions
3. ✅ **Job designation** used in framing ("You are a Senior Engineer at Gisul...")
4. ✅ **Technologies** from requirements mentioned in questions
5. ✅ **Topic requirements** combined with assessment requirements
6. ✅ **Generic questions** only when NO context provided
7. ✅ **Priority respected**: Assessment context > Topic context > Role > Experience

---

## 📖 **Summary**

This implementation transforms the question generation system from **generic** to **context-aware**, creating personalized scenarios that match the candidate's actual job requirements.

**Key Changes**:
- ✅ Added `assessment_requirements` parameter throughout the chain
- ✅ Built priority-based context combining all available information
- ✅ Enhanced prompts with explicit instructions to USE the context
- ✅ Provided clear examples of WITH vs WITHOUT context
- ✅ Final reminders to AI that generic questions are only acceptable without context

**Result**: Every question now can reference the actual company, role, technologies, and constraints the candidate will face in their job! 🎉

