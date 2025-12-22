# Auto-Submit Flow Verification for Per-Question Timer

## Overview
This document verifies the complete flow for auto-submitting questions when the per-question timer expires in `PER_QUESTION` mode.

## Flow Steps

### 1. Timer Expiration Detection
- **Location**: `frontend/src/hooks/useDSTimer.ts` (lines 307-315)
- **Trigger**: When `remaining === 0` for a question in `PER_QUESTION` mode
- **Action**: Calls `onQuestionExpire(questionId)` callback
- **Status**: ✅ Verified - Timer hook correctly detects expiration and calls callback

### 2. Auto-Submit Callback Execution
- **Location**: `frontend/src/pages/test/[id]/take.tsx` (lines 1226-1317)
- **Triggered by**: `onQuestionExpire` callback from timer hook
- **Status**: ✅ Verified

#### 2.1 Question Validation
- Checks if question exists and userId is available
- **Status**: ✅ Verified (lines 1228-1232)

#### 2.2 State Updates (Synchronous)
- Marks question as submitted: `setSubmittedQuestions(prev => ({ ...prev, [questionId]: true }))`
- Stores timeout flag in sessionStorage: `question_timeout_${testId}_${questionId} = 'true'`
- Stores submitted status in sessionStorage: `submittedQuestions_${testId}` (immediate sync)
- **Status**: ✅ Verified (lines 1237-1247)

#### 2.3 Backend Submission
- **SQL Questions**: Calls `/assessment/submit-sql` endpoint
- **Coding Questions**: Calls `/assessment/submit` endpoint
- Includes timing data: `started_at`, `submitted_at`, `time_spent_seconds`
- **Status**: ✅ Verified (lines 1253-1296)

#### 2.4 Error Handling
- If submission fails, still marks question as submitted and moves on
- Code will be included in final submission
- **Status**: ✅ Verified (lines 1301-1305)

#### 2.5 Question Status Update
- Updates question status to 'attempted' after successful submission
- **Status**: ✅ Verified (line 1299)

### 3. Navigation Logic
- **Location**: `frontend/src/pages/test/[id]/take.tsx` (lines 1307-1316)
- **Status**: ✅ Verified

#### 3.1 Next Question Navigation
- Finds current question index
- If not last question: Calls `handleQuestionChange(currentIndex + 1)`
- **Status**: ✅ Verified (lines 1308-1311)

#### 3.2 Final Test Auto-Submit
- If last question: Calls `handleAutoSubmit()`
- `handleAutoSubmit()` calls `handleSubmit(true)` to submit entire test
- **Status**: ✅ Verified (lines 1312-1315)

### 4. Navigation Validation
- **Location**: `frontend/src/pages/test/[id]/take.tsx` (lines 1430-1465)
- **Status**: ✅ Verified

#### 4.1 Timed-Out Question Prevention
- Checks sessionStorage for `question_timeout_${testId}_${questionId}`
- Prevents navigation to timed-out questions
- **Status**: ✅ Verified (lines 1434-1441)

#### 4.2 Sequential Locking (PER_QUESTION mode)
- Checks if previous question was submitted
- Uses both React state AND sessionStorage for reliable checking
- Allows navigation if question was timed out (considered submitted)
- **Status**: ✅ Verified (lines 1450-1465)

### 5. SessionStorage Persistence
- **Location**: Multiple locations in `frontend/src/pages/test/[id]/take.tsx`
- **Status**: ✅ Verified

#### 5.1 Timeout Flags
- Key: `question_timeout_${testId}_${questionId}`
- Value: `'true'`
- Set immediately when timer expires
- **Status**: ✅ Verified (line 1241)

#### 5.2 Submitted Questions
- Key: `submittedQuestions_${testId}`
- Value: JSON object with question IDs as keys
- Updated immediately when timer expires
- Also persisted via useEffect when state changes
- **Status**: ✅ Verified (lines 1243-1247, 162-167)

#### 5.3 Restoration on Page Load
- `submittedQuestions` restored from sessionStorage on mount
- Timeout flags checked during navigation
- **Status**: ✅ Verified (lines 147-160)

### 6. Final Test Submission
- **Location**: `frontend/src/pages/test/[id]/take.tsx` (lines 1355-1428)
- **Status**: ✅ Verified

#### 6.1 Timeout Flags in Final Submission
- Includes `timed_out: true` flag for timed-out questions
- Read from sessionStorage: `question_timeout_${testId}_${q.id}`
- **Status**: ✅ Verified (lines 1358-1368)

#### 6.2 Question Submissions Array
- Maps all questions with their code, language, and timeout flags
- Sent to backend `/tests/{testId}/final-submit` endpoint
- **Status**: ✅ Verified (lines 1359-1369)

## Potential Issues & Fixes

### Issue 1: Async State Updates
**Problem**: React state updates are asynchronous, so `submittedQuestions` might not be updated when `handleQuestionChange` is called immediately after.

**Fix Applied**: 
- Store submitted status in sessionStorage immediately (synchronous)
- Check both React state AND sessionStorage in navigation logic
- **Status**: ✅ Fixed (lines 1243-1247, 1454-1465)

### Issue 2: Timer Only Active in PER_QUESTION Mode
**Verification**: Timer hook only triggers `onQuestionExpire` when `test.timer_mode === 'PER_QUESTION'`
- **Status**: ✅ Verified - Timer hook checks mode (line 219 in useDSTimer.ts)

### Issue 3: Multiple Submissions
**Protection**: `questionExpireCalledRef` prevents multiple calls to `onQuestionExpire` for the same question
- **Status**: ✅ Verified (lines 283-288, 307-315 in useDSTimer.ts)

## Test Scenarios

### Scenario 1: Middle Question Times Out
1. User is on Question 2 of 5
2. Timer reaches 0
3. ✅ Question 2 auto-submitted to backend
4. ✅ Question 2 marked as submitted and locked
5. ✅ Timeout flag stored in sessionStorage
6. ✅ Automatically navigates to Question 3
7. ✅ Question 3 timer starts

### Scenario 2: Last Question Times Out
1. User is on Question 5 of 5
2. Timer reaches 0
3. ✅ Question 5 auto-submitted to backend
4. ✅ Question 5 marked as submitted and locked
5. ✅ Timeout flag stored in sessionStorage
6. ✅ Entire test auto-submitted (`handleAutoSubmit()` called)
7. ✅ Test completion flow triggered

### Scenario 3: Page Refresh After Timeout
1. Question 2 times out and is auto-submitted
2. User refreshes page
3. ✅ `submittedQuestions` restored from sessionStorage
4. ✅ Timeout flags restored from sessionStorage
5. ✅ Question 2 remains locked
6. ✅ User cannot navigate back to Question 2

### Scenario 4: SQL Question Timeout
1. User is on SQL question
2. Timer reaches 0
3. ✅ Calls `/assessment/submit-sql` endpoint
4. ✅ Includes SQL query (or starter query if empty)
5. ✅ Same locking and navigation flow as coding questions

### Scenario 5: Coding Question Timeout
1. User is on coding question
2. Timer reaches 0
3. ✅ Calls `/assessment/submit` endpoint
4. ✅ Includes source code and language ID
5. ✅ Same locking and navigation flow as SQL questions

## Summary

✅ **All flow steps verified and working correctly**

The auto-submit flow for per-question timer expiration is fully implemented and handles:
- ✅ Backend submission (SQL and coding questions)
- ✅ Question locking (state + sessionStorage)
- ✅ Automatic navigation
- ✅ Final test auto-submit for last question
- ✅ Persistence across page refreshes
- ✅ Error handling
- ✅ State synchronization


