# AIML Competency Timer & Permission Implementation Plan

## Overview
This document outlines the implementation plan to fix timer logic and permission verification for AIML competency assessments, based on the analysis from Custom MCQ.

---

## Current Issues in AIML

### 1. Timer Logic Issues

#### **Frontend Timer** (`frontend/src/pages/aiml/test/[id]/take.tsx`)
- **Lines 472-489**: Client-side countdown only, no server sync
- **Lines 509-534**: Timer initialization doesn't properly track start time
  - Uses `time_remaining_seconds` from backend if available
  - Otherwise auto-starts test and uses full duration
  - **Problem**: If page refreshes, timer resets to full duration

#### **Backend Timer Calculation** (`backend/app/api/v1/aiml/routers/tests.py`)
- **Lines 539-659**: `get_test_for_candidate` endpoint
  - Calculates `time_remaining_seconds` based on `started_at` and duration
  - **Problem**: No validation of access time windows (strict/flexible mode)
  - **Problem**: No server-side timer validation on submission

### 2. Permission Verification Issues

#### **Verification Endpoint** (`tests.py:404-436`)
- **Lines 404-436**: `verify_candidate` endpoint
  - Only checks if candidate exists in test_candidates
  - **Problem**: No check for already submitted tests
  - **Problem**: No check for concurrent sessions
  - **Problem**: No access time window validation

#### **Start Test Endpoint** (`tests.py:439-536`)
- **Lines 439-536**: `start_test` endpoint
  - Creates submission with `started_at`
  - **Problem**: No atomic operation to prevent race conditions
  - **Problem**: No check for access time windows
  - **Problem**: Comment says "time window is informational, not restrictive" - this is wrong

#### **Submit Test Endpoint** (`tests.py:754-925`)
- **Lines 754-925**: `submit_test` endpoint
  - Checks if already completed
  - **Problem**: No timer validation (doesn't check if time expired)
  - **Problem**: No server-side time remaining calculation

---

## Implementation Plan

### Phase 1: Backend - Access Control & Timer Logic

#### 1.1 Add Access Control to `get_test_for_candidate` Endpoint
**File**: `backend/app/api/v1/aiml/routers/tests.py`
**Lines**: 539-659

**Changes**:
- Add exam mode check (strict/flexible)
- Add access time window validation
- Return `accessControl` object similar to Custom MCQ:
  ```python
  accessControl = {
      "canAccess": bool,
      "canStart": bool,
      "waitingForStart": bool,
      "examStarted": bool,
      "timeRemaining": int | None,  # seconds
      "errorMessage": str | None
  }
  ```

#### 1.2 Fix Timer Calculation
**File**: `backend/app/api/v1/aiml/routers/tests.py`
**Lines**: 539-659

**Changes**:
- For **strict mode**: Calculate timer based on scheduled end time
- For **flexible mode**: Calculate timer based on actual `started_at` + duration
- Always calculate server-side, never trust client

#### 1.3 Add Session Tracking
**File**: `backend/app/api/v1/aiml/routers/tests.py`
**New endpoint**: `POST /{test_id}/start`

**Changes**:
- Use atomic MongoDB operation to set `started_at`
- Check for existing active sessions before allowing start
- Prevent concurrent sessions

#### 1.4 Add Timer Validation to Submit
**File**: `backend/app/api/v1/aiml/routers/tests.py`
**Lines**: 754-925

**Changes**:
- Before accepting submission, validate timer server-side
- Reject if time has expired
- Calculate time remaining server-side

#### 1.5 Update Verify Candidate Endpoint
**File**: `backend/app/api/v1/aiml/routers/tests.py`
**Lines**: 404-436

**Changes**:
- Check if candidate already submitted
- Check if candidate is currently taking (concurrent session check)
- Validate access time windows based on exam mode

### Phase 2: Frontend - Timer Sync & Access Control

#### 2.1 Remove Client-Side Timer Logic
**File**: `frontend/src/pages/aiml/test/[id]/take.tsx`
**Lines**: 472-489, 509-534

**Changes**:
- Remove auto-start logic
- Remove client-side timer countdown
- Use server-provided `timeRemaining` from `accessControl`

#### 2.2 Add Periodic Server Sync
**File**: `frontend/src/pages/aiml/test/[id]/take.tsx`
**New useEffect**:

```typescript
// Sync timer with server every 30 seconds
useEffect(() => {
  if (!examStarted || submitted) return;
  
  const syncInterval = setInterval(async () => {
    const updated = await fetchTestData(token, userId);
    if (updated.accessControl?.timeRemaining !== null) {
      setTimeRemaining(updated.accessControl.timeRemaining);
    }
  }, 30000);
  
  return () => clearInterval(syncInterval);
}, [examStarted, submitted, token, userId]);
```

#### 2.3 Update Timer Countdown
**File**: `frontend/src/pages/aiml/test/[id]/take.tsx`
**Lines**: 472-489

**Changes**:
- Keep client-side countdown for UI
- But sync with server every 30 seconds
- Use server time as source of truth

#### 2.4 Handle Access Control States
**File**: `frontend/src/pages/aiml/test/[id]/take.tsx`
**New states**:
- `waitingForStart`: Show waiting screen for strict mode pre-check
- `canAccess`: Check before allowing test start
- `examStarted`: Only start timer when exam actually started

### Phase 3: Testing

#### 3.1 Timer Tests
- [ ] Test flexible mode timer persistence after refresh
- [ ] Test server-side timer validation on late submission
- [ ] Test timer sync accuracy over long sessions
- [ ] Test auto-submit when timer reaches 0
- [ ] Test strict mode timer accuracy

#### 3.2 Permission Tests
- [ ] Test concurrent session prevention
- [ ] Test submission after time expiry
- [ ] Test access time window validation (strict mode)
- [ ] Test access time window validation (flexible mode)
- [ ] Test already-submitted prevention

---

## Implementation Details

### Backend Changes Summary

1. **`get_test_for_candidate` endpoint**:
   - Add exam mode detection
   - Add access time window validation
   - Calculate timer server-side based on mode
   - Return `accessControl` object

2. **`start_test` endpoint**:
   - Add atomic operation for setting `started_at`
   - Check for concurrent sessions
   - Validate access time windows

3. **`verify_candidate` endpoint**:
   - Check submission status
   - Check concurrent sessions
   - Validate access time windows

4. **`submit_test` endpoint**:
   - Validate timer server-side before accepting
   - Reject if time expired

### Frontend Changes Summary

1. **Remove auto-start logic**: Don't auto-start test on page load
2. **Use accessControl**: Read `accessControl` from backend response
3. **Periodic sync**: Sync timer with server every 30 seconds
4. **Handle states**: Show appropriate UI for waiting/access denied states

---

## Migration Notes

### Breaking Changes
- **Timer calculation**: Now always server-side, client must sync
- **Access control**: New `accessControl` object required in responses
- **Start endpoint**: Now validates access time windows

### Backward Compatibility
- Keep existing fields (`started_at`, `time_remaining_seconds`) for backward compatibility
- Add new `accessControl` object alongside existing fields
- Gradually deprecate old fields

---

## Files to Modify

### Backend
1. `backend/app/api/v1/aiml/routers/tests.py`
   - `get_test_for_candidate` (lines 539-659)
   - `start_test` (lines 439-536)
   - `verify_candidate` (lines 404-436)
   - `submit_test` (lines 754-925)

### Frontend
1. `frontend/src/pages/aiml/test/[id]/take.tsx`
   - Timer logic (lines 472-489, 509-534)
   - Test data fetching (lines 491-549)
   - Add periodic sync
   - Handle access control states

---

## Success Criteria

1. ✅ Timer cannot be manipulated by refreshing page
2. ✅ Server validates timer on submission
3. ✅ Concurrent sessions are prevented
4. ✅ Access time windows are enforced
5. ✅ Timer syncs with server every 30 seconds
6. ✅ All existing functionality preserved

---

## Next Steps

1. Review and approve this plan
2. Implement backend changes first
3. Implement frontend changes
4. Test thoroughly
5. Deploy to staging
6. Monitor for issues



