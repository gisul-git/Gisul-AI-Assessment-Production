# Custom MCQ Timer Logic and Permission Verification Analysis

## Overview
This document analyzes the timer logic and permission verification mechanisms for the Custom MCQ assessment feature.

---

## 1. Timer Logic Analysis

### 1.1 Current Implementation

#### **Strict Mode Timer**
**Backend Calculation** (`routers.py:1167`):
```python
time_remaining = max(0, int((end_time - now).total_seconds()))
```
- ✅ **Correct**: Timer is calculated server-side based on scheduled end time
- ✅ **Accurate**: Uses UTC time, accounts for actual elapsed time
- ✅ **Prevents manipulation**: Client receives remaining time, but server calculates it

**Frontend Countdown** (`[assessmentId].tsx:765-781`):
```typescript
useEffect(() => {
  if (timeRemaining === null || timeRemaining <= 0 || isNaN(timeRemaining) || waitingForStart) {
    return;
  }
  const interval = setInterval(() => {
    setTimeRemaining((prev) => {
      if (prev === null || prev <= 1 || isNaN(prev || 0)) {
        return 0;
      }
      return prev - 1;
    });
  }, 1000);
  return () => clearInterval(interval);
}, [timeRemaining, waitingForStart]);
```
- ⚠️ **Issue**: Client-side countdown can drift from server time
- ⚠️ **Issue**: No periodic sync with server to correct drift
- ✅ **Auto-submit**: Correctly triggers when timer reaches 0

#### **Flexible Mode Timer**
**Backend Calculation** (`routers.py:1199`):
```python
time_remaining = duration * 60 if duration else None  # Timer starts with full duration
```
- ❌ **Critical Issue**: Timer always starts with full duration, regardless of when candidate actually started
- ❌ **No server-side tracking**: Backend doesn't record when candidate clicked "Start Exam" or when exam auto-started
- ❌ **Race condition**: Multiple tabs could start at different times, each getting full duration

**Frontend Start** (`[assessmentId].tsx:490-519`):
```typescript
const handleStartExam = async () => {
  // ...
  if (duration) {
    setTimeRemaining(duration * 60); // Convert minutes to seconds
    setStartedAt(new Date());
    setExamStarted(true);
  }
};
```
- ❌ **Issue**: `startedAt` is only stored in frontend state, not persisted to backend
- ❌ **Issue**: If page refreshes, timer resets to full duration
- ❌ **Issue**: No server validation of actual start time on submission

### 1.2 Timer Issues Summary

| Issue | Severity | Impact |
|-------|----------|--------|
| **Flexible mode timer doesn't track actual start time** | 🔴 Critical | Candidates can refresh page to reset timer |
| **No server-side timer validation on submission** | 🔴 Critical | Candidates can submit after time expires by manipulating client |
| **Client-side countdown can drift** | 🟡 Medium | Timer may show incorrect time after long sessions |
| **No periodic server sync** | 🟡 Medium | Timer accuracy degrades over time |
| **Strict mode timer is server-calculated** | ✅ Good | Correct implementation |

---

## 2. Permission Verification Analysis

### 2.1 Entry Verification Flow

#### **Step 1: Entry Page Verification** (`routers.py:900-1041`)
```python
@router.post("/verify-candidate")
async def verify_custom_mcq_candidate(...)
```

**Checks Performed:**
1. ✅ Token validation
2. ✅ Submission status check (prevents retaking)
3. ✅ In-progress check (prevents concurrent sessions)
4. ✅ Access time window (strict/flexible mode)
5. ✅ Access mode (public/private) and candidate list

**Issues:**
- ⚠️ **Race condition window**: Between verification and starting exam, candidate could open multiple tabs
- ⚠️ **No session token**: Verification doesn't create a session, so concurrent access detection relies on `startedAt` field

#### **Step 2: Take Page Verification** (`[assessmentId].tsx:343-445`)
```typescript
// Enforce unified gate completion (deep-link safety)
const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${id}`);
// ...
// Verify access
await customMCQApi.verifyCandidate(...);
// Load assessment
const assessmentData = await customMCQApi.getAssessmentForTaking(...);
```

**Checks Performed:**
1. ✅ Precheck completion (sessionStorage)
2. ✅ Candidate info from sessionStorage
3. ✅ Backend verification API call
4. ✅ Access control from backend

**Issues:**
- ⚠️ **SessionStorage dependency**: Can be cleared, allowing bypass
- ⚠️ **No server-side session tracking**: Backend doesn't know if candidate is actively taking exam
- ⚠️ **Deep-link protection**: Only relies on sessionStorage, not server validation

### 2.2 Permission Verification Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| **No server-side session tracking** | 🔴 Critical | Cannot reliably detect concurrent sessions |
| **Race condition between verification and start** | 🟡 Medium | Multiple tabs could start simultaneously |
| **SessionStorage-based precheck validation** | 🟡 Medium | Can be cleared to bypass precheck |
| **No session token/ID** | 🟡 Medium | Cannot track active sessions server-side |
| **Submission check happens at verification** | ✅ Good | Prevents retaking |

---

## 3. Critical Problems

### 3.1 Flexible Mode Timer Exploit
**Scenario:**
1. Candidate starts exam at 10:00 AM (60-minute duration)
2. Candidate works for 30 minutes
3. Candidate refreshes page at 10:30 AM
4. Timer resets to 60 minutes (full duration)
5. Candidate now has 90 total minutes instead of 60

**Root Cause:**
- Backend doesn't record actual start time for flexible mode
- Frontend `startedAt` is lost on refresh
- Timer always initializes with full duration

**Fix Required:**
- Record `startedAt` timestamp in backend when exam starts
- Calculate timer as: `duration - (now - startedAt)`
- Validate timer on submission

### 3.2 No Server-Side Timer Validation
**Scenario:**
1. Timer expires on client (reaches 0)
2. Auto-submit is triggered
3. But candidate could manipulate client to prevent auto-submit
4. Candidate could manually submit after time expires

**Root Cause:**
- Submission endpoint doesn't validate remaining time
- Only checks if already submitted, not if time expired

**Fix Required:**
- Validate timer on submission endpoint
- Reject submissions if time has expired
- Calculate time remaining server-side on submission

### 3.3 Concurrent Session Detection Gap
**Scenario:**
1. Candidate verifies access (Tab 1)
2. Candidate starts exam in Tab 1
3. Candidate opens new tab (Tab 2) before `startedAt` is saved
4. Tab 2 also verifies and starts exam
5. Both tabs are active simultaneously

**Root Cause:**
- No atomic "start exam" operation
- `startedAt` is set after verification, creating a race window
- No session token to track active sessions

**Fix Required:**
- Create server-side session when exam starts
- Use atomic operation to set `startedAt`
- Check for active sessions before allowing start

---

## 4. Recommendations

### 4.1 Timer Logic Fixes

#### **Priority 1: Fix Flexible Mode Timer**
```python
# Backend: Record start time when exam starts
@router.post("/start/{assessment_id}")
async def start_custom_mcq_assessment(...):
    # Atomically set startedAt if not already set
    # Return time_remaining based on actual start time
    pass

# Frontend: Use server-provided time_remaining
# Sync periodically (every 30 seconds) with server
```

#### **Priority 2: Add Server-Side Timer Validation**
```python
# On submission, validate timer
if exam_mode == "strict":
    if now > end_time:
        return error_response("Time has expired", status_code=400)
elif exam_mode == "flexible":
    started_at = submission.get("startedAt")
    if started_at:
        elapsed = (now - started_at).total_seconds()
        if elapsed > duration * 60:
            return error_response("Time has expired", status_code=400)
```

#### **Priority 3: Periodic Server Sync**
```typescript
// Frontend: Sync timer with server every 30 seconds
useEffect(() => {
  const syncInterval = setInterval(async () => {
    const updated = await customMCQApi.getAssessmentForTaking(...);
    if (updated.accessControl?.timeRemaining !== null) {
      setTimeRemaining(updated.accessControl.timeRemaining);
    }
  }, 30000);
  return () => clearInterval(syncInterval);
}, [assessmentId, token]);
```

### 4.2 Permission Verification Fixes

#### **Priority 1: Server-Side Session Tracking**
```python
# Create session when exam starts
session_id = str(uuid.uuid4())
await db.custom_mcq_sessions.insert_one({
    "sessionId": session_id,
    "assessmentId": assessment_id,
    "candidateKey": candidate_key,
    "startedAt": datetime.utcnow(),
    "status": "active",
    "expiresAt": started_at + timedelta(minutes=duration)
})

# Check for active sessions before allowing start
active_session = await db.custom_mcq_sessions.find_one({
    "candidateKey": candidate_key,
    "assessmentId": assessment_id,
    "status": "active"
})
if active_session:
    return error_response("Already taking assessment", status_code=400)
```

#### **Priority 2: Atomic Start Operation**
```python
# Use MongoDB atomic operation
result = await db.custom_mcq_assessments.update_one(
    {
        "_id": oid,
        f"submissions.{candidate_key}.startedAt": {"$exists": False}
    },
    {
        "$set": {
            f"submissions.{candidate_key}.startedAt": datetime.utcnow(),
            f"submissions.{candidate_key}.status": "in_progress"
        }
    }
)
if result.modified_count == 0:
    return error_response("Already started or in progress", status_code=400)
```

#### **Priority 3: Server-Side Precheck Validation**
```python
# Store precheck completion in backend, not just sessionStorage
# Validate on take page load
precheck_status = await db.custom_mcq_prechecks.find_one({
    "assessmentId": assessment_id,
    "candidateKey": candidate_key
})
if not precheck_status or not precheck_status.get("completed"):
    return error_response("Precheck not completed", status_code=403)
```

---

## 5. Testing Recommendations

### 5.1 Timer Tests
- [ ] Test flexible mode timer persistence after refresh
- [ ] Test server-side timer validation on late submission
- [ ] Test timer sync accuracy over long sessions
- [ ] Test auto-submit when timer reaches 0
- [ ] Test strict mode timer accuracy

### 5.2 Permission Tests
- [ ] Test concurrent session prevention
- [ ] Test submission after time expiry
- [ ] Test deep-link bypass attempts
- [ ] Test sessionStorage clearing scenarios
- [ ] Test race condition between tabs

---

## 6. Summary

### Current State
- ✅ **Strict mode timer**: Correctly implemented server-side
- ⚠️ **Flexible mode timer**: Has critical exploit (refresh resets timer)
- ⚠️ **Permission verification**: Works but has race condition gaps
- ❌ **Server-side validation**: Missing on timer and session tracking

### Critical Fixes Needed
1. **Record actual start time** for flexible mode exams
2. **Validate timer server-side** on submission
3. **Add session tracking** to prevent concurrent access
4. **Use atomic operations** for exam start

### Impact
- **Security**: Medium-High (timer manipulation, concurrent sessions)
- **User Experience**: Medium (timer accuracy, session management)
- **Data Integrity**: High (submission timing, session tracking)



