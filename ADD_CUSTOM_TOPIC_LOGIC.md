# Add Custom Topic Logic Documentation

## Overview
This document explains the complete logic flow for adding custom topics in the assessment creation system. The system supports two main types of custom topics:
1. **Soft Skills Topics**: Aptitude, Communication, Logical Reasoning
2. **Technical Skills Topics**: Programming languages, frameworks, technical concepts

---

## Frontend Flow

### 1. User Interface Components

#### Soft Skills (Aptitude, Communication, Logical Reasoning)
- **Location**: `create-new.tsx` (Station 2 - Topic Selection)
- **UI Elements**:
  - Category selector dropdown: "Aptitude", "Communication", "Logical Reasoning"
  - Input field: "Enter aptitude topic name…" (placeholder changes based on selected category)
  - AI-powered suggestions dropdown (appears as user types)
  - "Add" button to add the topic

#### Technical Skills
- **Location**: `create-new.tsx` (Station 2 - Topic Selection)
- **UI Elements**:
  - "Add Technical Skill" button
  - Input field for technical topic name
  - "Add" button to add the topic

---

## Frontend State Management

### Key State Variables
```typescript
// Soft Skills
const [selectedCategoryForNewTopic, setSelectedCategoryForNewTopic] = useState<"aptitude" | "communication" | "logical_reasoning" | null>(null);
const [customTopicInputV2, setCustomTopicInputV2] = useState("");
const [isTopicValid, setIsTopicValid] = useState<boolean | null>(null);
const [validatingTopic, setValidatingTopic] = useState(false);
const [topicValidationError, setTopicValidationError] = useState<string | null>(null);
const [aiTopicSuggestions, setAiTopicSuggestions] = useState<string[]>([]);
const [showAiSuggestions, setShowAiSuggestions] = useState(false);
const [addingTopic, setAddingTopic] = useState(false);

// Technical Skills
const [showTechnicalInput, setShowTechnicalInput] = useState(false);
```

---

## Soft Skills Topic Addition Flow

### Step 1: User Selects Category
- User clicks on category dropdown and selects: "Aptitude", "Communication", or "Logical Reasoning"
- `selectedCategoryForNewTopic` state is updated
- Input field placeholder changes to match category (e.g., "Enter aptitude topic name…")

### Step 2: User Types Topic Name
- As user types in `customTopicInputV2`, the following happens:

#### 2a. AI Suggestions (Debounced)
- **Trigger**: User types 2+ characters
- **Debounce**: 500ms delay
- **API Call**: `POST /api/assessments/ai/topic-suggestion`
  ```json
  {
    "category": "aptitude" | "communication" | "logical_reasoning",
    "input": "partial topic name"
  }
  ```
- **Response**: 
  ```json
  {
    "success": true,
    "data": {
      "isValid": boolean,
      "reason": string,
      "suggestions": string[]
    }
  }
  ```
- **UI Update**: Shows dropdown with AI suggestions if available
- **User Action**: Can click suggestion to auto-fill input field

#### 2b. Real-time Validation (Debounced)
- **Trigger**: User types 2+ characters AND category is selected
- **Debounce**: 800ms delay
- **API Call**: `POST /api/assessments/validate-topic-category`
  ```json
  {
    "topic": "topic name",
    "category": "aptitude" | "communication" | "logical_reasoning"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "valid": boolean,
      "error": string | null
    }
  }
  ```
- **UI Update**: 
  - Shows green checkmark if valid
  - Shows red error message if invalid
  - Updates `isTopicValid` state

### Step 3: User Clicks "Add" Button
- **Handler**: `handleAddSoftSkillTopic(event)`
- **Location**: `create-new.tsx` line ~3740

#### 3a. Pre-validation Checks
```typescript
// 1. Check if input is empty
if (!topicName.trim()) return;

// 2. Check for duplicate topics (case-insensitive)
const topicExists = topicsV2.some(t => t.label.toLowerCase() === topicName.toLowerCase());
if (topicExists) {
  showToast("Topic already added.");
  return;
}

// 3. Check if category is selected
if (!selectedCategoryForNewTopic) return;

// 4. Check if already adding (prevent duplicate clicks)
if (addingTopic) return;
```

#### 3b. Client-Side Technical Check (Fast Validation)
- **API Call**: `POST /api/assessments/topics/check-technical`
  ```json
  {
    "topic": "topic name"
  }
  ```
- **Purpose**: Quick check to reject technical topics before expensive validation
- **If technical**: Show error and return early

#### 3c. Backend Validation (If not already validated)
- **Condition**: `isTopicValid === null` (validation not done yet)
- **API Call**: `POST /api/assessments/validate-topic-category`
- **If validation fails**: Show error and return

#### 3d. Generate Topic Context
- **API Call**: `POST /api/assessments/generate-topic-context`
  ```json
  {
    "topicName": "topic name",
    "category": "aptitude" | "communication" | "logical_reasoning"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "suggestedQuestionType": "MCQ" | "Subjective",
      "difficulty": "Easy" | "Medium" | "Hard",
      "contextSummary": "AI-generated context about the topic"
    }
  }
  ```
- **Purpose**: Get AI-generated context and suggested question type for the topic

#### 3e. Create Topic Object
```typescript
const newTopic: TopicV2 = {
  id: generateId(), // e.g., "custom-1234567890-abc123"
  label: topicName,
  category: finalCategory, // "aptitude" | "communication" | "logical_reasoning"
  locked: false,
  allowedQuestionTypes: ["MCQ", "Subjective"], // Soft skills only allow MCQ and Subjective
  contextSummary: contextSummary, // From API response
  questionRows: [{
    rowId: generateId(),
    questionType: defaultQuestionType, // From API response
    difficulty: contextData.difficulty || "Medium",
    questionsCount: 1,
    canUseJudge0: false, // Soft skills never use Judge0
    status: "pending",
    locked: false,
    questions: []
  }],
};
```

#### 3f. Add to State and Save
```typescript
// 1. Add to local state immediately
setTopicsV2((prev) => [...prev, newTopic]);

// 2. Save to database (if assessmentId exists)
await axios.put("/api/assessments/update-draft", {
  assessmentId: assessmentId,
  topics_v2: [...topicsV2, newTopic],
});

// 3. Clear UI state
setCustomTopicInputV2("");
setShowAiSuggestions(false);
setAiTopicSuggestions([]);
setIsTopicValid(null);
setTopicValidationError(null);
```

---

## Technical Skills Topic Addition Flow

### Step 1: User Clicks "Add Technical Skill"
- Shows technical input field
- Sets `showTechnicalInput = true`

### Step 2: User Types Topic Name
- User enters technical topic name (e.g., "Python", "React", "Machine Learning")
- No real-time validation (unlike soft skills)

### Step 3: User Clicks "Add" Button
- **Handler**: `handleAddCustomTopicV2(true, undefined, event)`
- **Location**: `create-new.tsx` line ~4034

#### 3a. Pre-validation Checks
```typescript
// Same as soft skills: empty check, duplicate check, prevent multiple additions
```

#### 3b. Classify Technical Topic
- **API Call**: `POST /api/assessments/topics/classify-technical-topic`
  ```json
  {
    "topic": "topic name"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding",
      "canUseJudge0": boolean,
      "coding_supported": boolean,
      "contextExplanation": "AI-generated explanation"
    }
  }
  ```
- **Purpose**: 
  - Determine appropriate question type
  - Check if Judge0 is supported (for coding questions)
  - Check if coding is supported (determines allowed question types)

#### 3c. Determine Allowed Question Types
```typescript
// If coding_supported = true: ["MCQ", "Subjective", "PseudoCode", "Coding"]
// If coding_supported = false: ["MCQ", "Subjective", "PseudoCode"]
const allowedQuestionTypes = codingSupported 
  ? ["MCQ", "Subjective", "PseudoCode", "Coding"]
  : ["MCQ", "Subjective", "PseudoCode"];
```

#### 3d. Create Topic Object
```typescript
const newTopic: TopicV2 = {
  id: generateId(),
  label: topicName,
  category: "technical",
  locked: false,
  contextSummary: contextExplanation, // From classification API
  coding_supported: codingSupported, // From classification API
  allowedQuestionTypes: allowedQuestionTypes, // Based on coding_supported
  status: "pending",
  questionRows: [{
    rowId: generateId(),
    questionType: defaultQuestionType, // From classification API
    difficulty: "Medium",
    questionsCount: 1,
    canUseJudge0: canUseJudge0, // From classification API (only true for Coding)
    status: "pending",
    locked: false,
    questions: []
  }],
};
```

#### 3e. Add to State and Save
- Same as soft skills: Add to state, save to database, clear UI

---

## Backend API Endpoints

### 1. Validate Topic Category
**Endpoint**: `POST /api/v1/assessments/validate-topic-category`

**Request**:
```json
{
  "topic": "string",
  "category": "aptitude" | "communication" | "logical_reasoning"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "valid": boolean,
    "error": string | null
  }
}
```

**Logic** (`topic_service_v2.py` line ~3165):
1. Check if topic is technical (reject if so)
2. Use OpenAI (gpt-4o-mini) to validate if topic belongs to category
3. Return validation result

**Prompt**:
```
Check if the topic '{topic}' belongs to category '{category_display}'.
Categories:
aptitude = math/quant/problem solving (NO programming/coding)
communication = verbal/grammar/writing (NO technical topics)
logical = puzzles/patterns/deduction (NO coding/algorithms)
CRITICAL: Reject if topic is about programming, coding, software, or technology.
Respond ONLY in JSON:
{"valid": true/false}
```

---

### 2. Generate Topic Context
**Endpoint**: `POST /api/v1/assessments/generate-topic-context`

**Request**:
```json
{
  "topicName": "string",
  "category": "aptitude" | "communication" | "logical_reasoning"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "suggestedQuestionType": "MCQ" | "Subjective",
    "difficulty": "Easy" | "Medium" | "Hard",
    "contextSummary": "string"
  }
}
```

**Logic** (`topic_suggestions.py`):
- Uses OpenAI to generate context summary for the topic
- Suggests appropriate question type based on topic nature
- Suggests difficulty level

---

### 3. AI Topic Suggestions
**Endpoint**: `POST /api/v1/assessments/ai/topic-suggestion`

**Request**:
```json
{
  "category": "aptitude" | "communication" | "logical_reasoning",
  "input": "partial topic name"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "isValid": boolean,
    "reason": string,
    "suggestions": string[]
  }
}
```

**Logic** (`topic_service_v2.py`):
- Uses OpenAI to validate partial input
- Generates topic suggestions based on category and partial input
- Returns validation status and suggestions

---

### 4. Check if Topic is Technical
**Endpoint**: `POST /api/v1/assessments/topics/check-technical`

**Request**:
```json
{
  "topic": "string"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "isTechnical": boolean
  }
}
```

**Logic**:
- Uses OpenAI to quickly determine if topic is technical/programming-related
- Fast validation to reject technical topics from soft skill categories

---

### 5. Classify Technical Topic
**Endpoint**: `POST /api/v1/assessments/topics/classify-technical-topic`

**Request**:
```json
{
  "topic": "string"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "questionType": "MCQ" | "Subjective" | "PseudoCode" | "Coding",
    "canUseJudge0": boolean,
    "coding_supported": boolean,
    "contextExplanation": "string"
  }
}
```

**Logic**:
- Uses OpenAI to classify technical topic
- Determines:
  - Appropriate question type
  - Whether Judge0 can be used (for coding questions)
  - Whether coding is supported (affects allowed question types)
  - Context explanation for the topic

---

## Validation Rules

### Soft Skills Categories

#### Aptitude
- **Allowed**: Math, quantitative reasoning, problem-solving, numerical ability
- **Rejected**: Programming, coding, software, technical concepts
- **Question Types**: MCQ, Subjective
- **Judge0 Support**: Never

#### Communication
- **Allowed**: Verbal communication, grammar, writing, language skills
- **Rejected**: Technical topics, programming
- **Question Types**: MCQ, Subjective
- **Judge0 Support**: Never

#### Logical Reasoning
- **Allowed**: Puzzles, patterns, sequences, logical deduction, arrangements
- **Rejected**: Coding, algorithms, programming
- **Question Types**: MCQ, Subjective
- **Judge0 Support**: Never

### Technical Skills
- **Allowed**: Programming languages, frameworks, technical concepts, software tools
- **Question Types**: 
  - If `coding_supported = true`: MCQ, Subjective, PseudoCode, Coding
  - If `coding_supported = false`: MCQ, Subjective, PseudoCode
- **Judge0 Support**: Only for Coding question type

---

## Error Handling

### Frontend Errors
1. **Duplicate Topic**: "Topic already added."
2. **Empty Input**: No action (button disabled)
3. **Validation Failed**: Shows error message from backend
4. **Technical Topic in Soft Skill Category**: "Invalid topic for selected category. Please enter only aptitude/communication/logical reasoning topics. Technical topics are not allowed."
5. **API Errors**: Shows generic error message with retry option

### Backend Errors
1. **Invalid Category**: Returns 400 with error message
2. **Topic Too Short**: Returns 400 "Topic name must be at least 2 characters"
3. **Duplicate Topic**: Returns 400 "Topic already exists"
4. **AI Service Errors**: Returns 500 with error details
5. **Validation Errors**: Returns validation result with error message

---

## Data Flow Diagram

```
User Input
    ↓
[Category Selection] → [Topic Name Input]
    ↓                        ↓
[AI Suggestions]      [Real-time Validation]
    ↓                        ↓
[User Clicks Add] → [Pre-validation Checks]
    ↓
[Client-side Technical Check]
    ↓
[Backend Validation] (if needed)
    ↓
[Generate Topic Context]
    ↓
[Create Topic Object]
    ↓
[Add to State]
    ↓
[Save to Database]
    ↓
[Clear UI]
    ↓
[Topic Added Successfully]
```

---

## Key Functions Reference

### Frontend (`create-new.tsx`)

1. **`handleAddSoftSkillTopic`** (line ~3740)
   - Main handler for adding soft skill topics
   - Handles validation, context generation, and topic creation

2. **`handleAddCustomTopicV2`** (line ~4034)
   - Main handler for adding technical topics
   - Handles classification and topic creation

3. **`validateTopicCategory`** (line ~3648)
   - Debounced validation function
   - Calls backend validation API

4. **`fetchTopicSuggestions`** (line ~4227)
   - Debounced function to fetch AI suggestions
   - Calls AI topic suggestion API

5. **`handleSuggestionClick`** (line ~3620)
   - Handles clicking on AI suggestion
   - Auto-fills input field

### Backend (`routers.py`)

1. **`validate_topic_category_endpoint`** (line ~5248)
   - Validates if topic belongs to category

2. **`generate_topic_context_endpoint`** (line ~5189)
   - Generates context and suggested question type

3. **`ai_topic_suggestion_endpoint`** (line ~5289)
   - Provides AI-powered suggestions

4. **`classify_technical_topic_endpoint`** (line ~5233)
   - Classifies technical topics

### Backend Services (`topic_service_v2.py`)

1. **`validate_topic_category`** (line ~3165)
   - Core validation logic using OpenAI

2. **`_is_technical_topic_ai`**
   - Checks if topic is technical

---

## Testing Scenarios

### Soft Skills
1. ✅ Add valid aptitude topic: "Number Series"
2. ✅ Add valid communication topic: "Grammar Rules"
3. ✅ Add valid logical reasoning topic: "Pattern Recognition"
4. ❌ Add technical topic to soft skill category: "Python" → Should reject
5. ❌ Add duplicate topic → Should show error
6. ✅ Click AI suggestion → Should auto-fill input

### Technical Skills
1. ✅ Add programming language: "Python" → Should classify as Coding
2. ✅ Add framework: "React" → Should classify as PseudoCode or Subjective
3. ✅ Add technical concept: "Machine Learning" → Should classify appropriately
4. ✅ Judge0 support detection → Should set `canUseJudge0` correctly

---

## Notes

1. **Debouncing**: All API calls are debounced to prevent excessive requests
2. **State Management**: Topics are added to state immediately for responsive UI
3. **Database Sync**: Topics are saved to database after state update
4. **Error Recovery**: Failed API calls don't block UI, show error messages instead
5. **AI Integration**: All validation and classification uses OpenAI (gpt-4o-mini) for consistency
6. **Question Type Assignment**: AI decides question types based on semantic meaning, not hardcoded rules

---

## Future Enhancements

1. Bulk topic addition from CSV
2. Topic templates/pre-sets
3. Custom question type assignment
4. Topic difficulty auto-adjustment
5. Topic analytics and usage tracking

