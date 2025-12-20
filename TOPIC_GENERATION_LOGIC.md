# Topic Generation Logic - Complete Analysis

## 📊 Summary

This document explains how topics are generated, including minimum/maximum counts, distribution across skills, and what factors are considered.

---

## 🎯 Topic Counts: Minimum & Maximum

### **Unified Generation (All Sources Combined)**
- **Range**: **8-12 topics TOTAL** (covering ALL skills from all sources)
- **Location**: `backend/app/api/v1/assessments/usethislogic.py` - `generate_topics_unified()` function
- **Behavior**: 
  - ALL skills from role-based, manual, and CSV sources are combined
  - Single API call generates 8-12 topics total
  - Topics are distributed across ALL skills (no skill is skipped)
  - Distribution is based on role, skill complexity, and importance level

---

## 🔀 Distribution Logic: How Topics Are Distributed Across Skills

### **Unified Distribution - All Sources with Equal Priority**

**All three sources (role-based, manual, CSV) are combined and treated with EQUAL PRIORITY:**

```
ALL Skills Combined → Single API call → 8-12 topics total

Example:
  - Role Skills: ["Python", "Django"]
  - Manual Skills: ["React"]
  - CSV Skills: ["Node.js", "TypeScript"]
  - Result: 8-12 topics TOTAL covering all 5 skills
  - Distribution: AI decides based on role, skill complexity, and importance
  - No skill is skipped - all skills are covered
```

**Key Features:**
- ✅ **Equal Priority**: All three sources treated equally
- ✅ **No Skipping**: All skills from all sources are covered
- ✅ **Smart Distribution**: Based on role, skill complexity, and importance level
- ✅ **Unified Generation**: Single prompt includes all skills with their metadata

### Code Location
- **Main Distribution Logic**: `backend/app/api/v1/assessments/usethislogic.py` - `generate_topics_unified()` function
- **Updated**: Now combines all sources into a single batch generation

```python
# Role skills: Combined batch
if role_skills and job_designation:
    role_skill_names = [s.get("skill_name", "") for s in role_skills]
    role_topics = await generate_topics_v2(...)  # Single call, 8-12 topics
    all_topics.extend(role_topics)

# Manual skills: Individual batches
if manual_skills:
    for skill in manual_skills:
        manual_topics = await generate_topics_v2(...)  # Per skill, 8-12 topics each
        all_topics.extend(manual_topics)

# CSV skills: Individual batches
if csv_skills:
    csv_topics = await generate_topics_from_requirements_v2(...)  # Per requirement, 2-4 topics each
    all_topics.extend(csv_topics)
```

---

## ✅ Factors Considered in Topic Generation

### 1. **Job Designation (Role/Position)**
- ✅ **Included**: Passed directly to OpenAI prompt
- **Location**: `topic_service_v2.py` line 1001
- **Usage**: `"- Job role/domain: {job_designation}"`

### 2. **Assessment Title**
- ✅ **Included**: If provided, included in prompt
- **Location**: `topic_service_v2.py` line 1002
- **Usage**: `"- Assessment title: {title_text}"`

### 3. **Selected Skills**
- ✅ **Included**: All skills are listed in prompt
- **Location**: `topic_service_v2.py` line 1003
- **Usage**: `"- Selected skills: {skills_text}"`

### 4. **Experience Level (Min/Max)**
- ✅ **Included**: Converted to experience level text
- **Location**: `topic_service_v2.py` lines 960-964
- **Conversion Logic**:
  ```python
  if experience_mode == "corporate":
      experience_level, _ = _get_experience_level_corporate(experience_min, experience_max)
  else:
      experience_level, _ = _get_experience_level_student(experience_min, experience_max)
  ```
- **Usage**: `"- Experience level: {experience_level}"` and `"- Experience Range: {exp_range_text}"`

### 5. **Experience Mode**
- ✅ **Included**: Corporate vs Student mode
- **Location**: `topic_service_v2.py` line 1004
- **Usage**: `"- Experience mode: {experience_mode}"`
- **Impact**: Affects prompt tone and difficulty expectations

### 6. **Importance Level** (CSV Skills Only)
- ✅ **Included**: For CSV requirements, importance level is included
- **Location**: `usethislogic.py` line 1581
- **Usage**: `"Importance Level: {importance_level}"`
- **Note**: Currently only used as context; doesn't affect topic count

### 7. **Skill Descriptions** (CSV Skills Only)
- ✅ **Included**: For CSV requirements, skill description is included
- **Location**: `usethislogic.py` line 1580
- **Usage**: `"Skill Description: {skill_description}"`

---

## 📝 Full Prompt Template (Role-Based & Manual Skills)

The complete prompt sent to OpenAI includes all factors:

```python
prompt = f"""You are an expert assessment designer. Generate topics with UNIVERSAL, DOMAIN-AGNOSTIC question type assignment.

Generate a list of highly relevant assessment topics using:
- Job role/domain: {job_designation}
- Assessment title: {title_text}
- Selected skills: {skills_text}
- Experience mode: {experience_mode}
- Experience level: {experience_level}

[... classification rules for MCQ/Subjective/PseudoCode/Coding/SQL/AIML ...]

Generate 8-12 topics. Return only the JSON array, no explanations."""
```

---

## 🔍 Additional Notes

### Deduplication
- After generating topics from all sources, duplicates are removed based on label (case-insensitive)
- **Location**: `usethislogic.py` lines 1536-1544

### Post-Processing
- Topics are filtered to ensure Judge0-compatible skills only
- Topics are validated for SQL/AIML execution-only rules
- Topics may be converted to ensure question type variety

### Experience Level Mapping
The system converts numeric experience ranges to text levels:
- **Corporate Mode**: Uses `_get_experience_level_corporate()` function
- **Student Mode**: Uses `_get_experience_level_student()` function

These functions map ranges like `(0-2, 3-5, 6-10, 11+)` to levels like `"Junior"`, `"Mid-level"`, `"Senior"`, `"Expert"`.

---

## 📊 Example Scenarios

### Scenario 1: Role-Based Only
```
Input:
  - Job Designation: "Python Developer"
  - Role Skills: ["Python", "Django", "PostgreSQL"]
  - Experience: 3-5 years (Corporate)

Output:
  - 8-12 topics TOTAL covering all three skills
  - AI decides distribution based on role and skill complexity
  - Example: 4 Python topics, 3 Django topics, 3 PostgreSQL topics (if 10 topics generated)
```

### Scenario 2: Manual Skills Only
```
Input:
  - Manual Skills: ["React", "TypeScript"]
  - Experience: 1-3 years (Corporate)

Output:
  - 8-12 topics TOTAL covering both skills
  - Distribution based on skill complexity and importance
  - All skills are covered (no skipping)
```

### Scenario 3: Mixed Sources (All Equal Priority)
```
Input:
  - Role Skills: ["Python"]
  - Manual Skills: ["React"]
  - CSV Skills: ["Node.js", "TypeScript"] (with descriptions and importance levels)

Output:
  - 8-12 topics TOTAL covering ALL 4 skills
  - All sources treated with equal priority
  - Distribution based on role, skill complexity, and importance levels
  - No skill is skipped
```

---

## 🎯 Key Takeaways

1. **Unified Generation**: ALL sources (role + manual + CSV) are combined into ONE batch
2. **Equal Priority**: All three sources are treated with EQUAL priority
3. **Fixed Range**: Always generates 8-12 topics TOTAL (not per source or per skill)
4. **Smart Distribution**: Topics distributed based on:
   - Job role/designation
   - Skill complexity
   - Importance levels (from CSV)
   - Experience level
5. **No Skipping**: All skills from all sources are covered
6. **All factors are considered**: role, title, skills (with descriptions), experience (min/max), mode, importance (CSV)
7. **Comprehensive Prompt**: Single prompt includes all skills with their metadata (descriptions, importance)

