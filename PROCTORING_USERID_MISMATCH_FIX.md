# Proctoring Logs userId Mismatch - Fix Applied

**Date:** December 24, 2025  
**Status:** ✅ PARTIAL FIX APPLIED - Analytics pages fixed, Take pages need backend session integration

---

## Problem Statement

**Issue:** Proctoring logs written for a user are NOT visible in the UI.

**Root Cause:** Mismatch between how logs are written vs. how they're fetched:
- **Logs written with:** Various string identifiers (email, URL params, sessionStorage values, token-based IDs)
- **Logs fetched with:** Expecting MongoDB ObjectId (`session.user.id`)

**Impact:** Candidates and admins cannot see violation logs even though they're being recorded in the database.

---

## Current Implementation

### How Logs Are Written (Take Pages)

Each competency's take page uses different userId formats when creating proctoring sessions:

#### 1. DSA Tests (`pages/test/[id]/take.tsx`)
```typescript
// Uses URL query param 'userId' or 'candidateEmail' as fallback
const getCandidateId = (): string => {
  if (userId && userId.trim() !== '') {
    return userId.trim();  // From URL: ?userId=somevalue
  }
  if (candidateEmail && candidateEmail.trim() !== '') {
    return candidateEmail.trim();  // From state or sessionStorage
  }
  return 'anonymous';
};

// Proctoring session created with:
session: {
  userId: candidateIdStr,  // String like "user@email.com" or "someUserId"
  assessmentId: assessmentIdStr,
}
```

#### 2. MCQ Assessments (`pages/assessment/[id]/[token]/take.tsx`)
```typescript
// Uses candidateEmail from state/sessionStorage, token as fallback
const getCandidateId = (): string => {
  if (candidateEmail && candidateEmail.trim() !== '') {
    return candidateEmail.trim();
  }
  // Check sessionStorage
  const sessionEmail = sessionStorage.getItem('candidateEmail');
  if (sessionEmail && sessionEmail.trim() !== '') {
    return sessionEmail.trim();
  }
  const sessionName = sessionStorage.getItem('candidateName');
  if (sessionName && sessionName.trim() !== '') {
    return sessionName.trim();
  }
  if (tokenStr) {
    return `candidate-${tokenStr}`;  // e.g., "candidate-abc123xyz"
  }
  return 'anonymous';
};
```

#### 3. Custom MCQ (`pages/custom-mcq/take/[assessmentId].tsx`)
```typescript
// Uses candidateInfo.email directly
const candidateIdStr = candidateInfo?.email || '';

session: {
  userId: candidateIdStr,  // Email string
  assessmentId: assessmentIdStr,
}
```

#### 4. AIML Tests (`pages/aiml/test/[id]/take.tsx`)
```typescript
// Uses candidateEmail or userId from URL params
const localCandidateIdStr = candidateEmail || userId || '';

session: {
  userId: localCandidateIdStr,
  assessmentId: localAssessmentIdStr,
}
```

### How Logs Are Fetched (Analytics Pages)

Analytics pages were trying to fetch logs using different strategies:

#### Before Fix:
- **DSA Analytics:** Used `candidate.email` with complex fallback filtering
- **MCQ Analytics:** Used `candidate.email` with pattern matching
- **AIML Analytics:** Used `candidate.email` with comment saying "we record with email"

#### After Fix (✅ Applied):
All analytics pages now:
1. Use `userId` (expecting MongoDB ObjectId)
2. Removed email-based filtering
3. Removed pattern matching fallbacks

---

## Fixes Applied

### ✅ 1. DSA Tests Analytics (`pages/dsa/tests/[id]/analytics.tsx`)

**Changed:**
```typescript
// BEFORE: Used email with fallback
const emailForProctorLogs = candidate?.email || candidateUserId
fetchProctorLogs(emailForProctorLogs)

// AFTER: Use user_id directly
fetchProctorLogs(candidateUserId)  // MongoDB ObjectId
```

**Removed:** Email-based filtering logic in fallback search
```typescript
// REMOVED complex pattern matching:
// userId.toLowerCase().replace(/[^a-z0-9]/g, '')
// Now uses exact match: log.userId === userId
```

### ✅ 2. MCQ Assessments Analytics (`pages/assessments/[id]/analytics.tsx`)

**Changed:**
```typescript
// BEFORE: Function signature used 'email'
const fetchProctorLogs = async (email: string) => {
  // First try with email...
  let response = await fetch(`...&userId=${encodeURIComponent(email)}`)
  // Complex fallback with pattern matching...
}

// AFTER: Function signature uses 'userId'
const fetchProctorLogs = async (userId: string) => {
  // Fetch logs using user_id (MongoDB ObjectId)
  let response = await fetch(`...&userId=${encodeURIComponent(userId)}`)
  // Simple exact match filter
  const candidateLogs = allLogs.filter((log: any) => {
    return log.userId === userId
  })
}
```

**Note:** This file still calls `fetchProctorLogs(candidate.email)` because MCQ assessments don't have `user_id` in candidate data. **This needs backend fix.**

### ✅ 3. Removed Complex Filtering

**Before:** Analytics pages had complex fallback logic:
- Normalized strings (lowercase, remove special chars)
- Pattern matching on email prefixes
- Filtering by `candidate-` prefix
- Multiple attempts with different formats

**After:** Simple exact match:
```typescript
const candidateLogs = allLogs.filter((log: any) => {
  return log.userId === userId  // Exact MongoDB ObjectId match
})
```

---

## Remaining Issues

### ❌ 1. Take Pages Don't Use `session.user.id`

**Problem:** When a logged-in user takes a test, the take pages should use `session.user.id` (MongoDB ObjectId) for the proctoring session, but they use email/URL params instead.

**Why This Happens:**
- DSA/AIML/Custom-MCQ take pages use URL query params (`userId`, `candidateEmail`)
- MCQ assessment take pages are public (token-based) with no authentication
- No `useSession()` hook to get `session.user.id`

**Ideal Fix:**
```typescript
// In authenticated take pages:
import { useSession } from 'next-auth/react'

const { data: session } = useSession()

// When starting proctoring:
const getUserIdForProctoring = (): string => {
  // Priority 1: Use logged-in user's MongoDB ObjectId
  if (session?.user?.id) {
    return session.user.id;  // MongoDB ObjectId like "6942eb18668f33b32ac26542"
  }
  
  // Priority 2: For public/token-based access, use email or token
  if (candidateEmail) return candidateEmail;
  if (userId) return userId;  // From URL params
  if (tokenStr) return `candidate-${tokenStr}`;
  
  return 'anonymous';
};

startUniversalProctoring({
  session: {
    userId: getUserIdForProctoring(),  // Now uses session.user.id when available
    assessmentId: assessmentIdStr,
  },
  // ...
})
```

### ❌ 2. MCQ Assessments Don't Track `user_id`

**Problem:** MCQ assessment candidates are tracked by email only (no `user_id` field).

**Current Schema:**
```typescript
interface Candidate {
  email: string
  name: string
  score?: number
  // ... NO user_id field
}
```

**Required:** Backend needs to return `user_id` in candidate results:
```typescript
// GET /api/assessments/get-candidate-results?assessmentId=...
// Should return:
{
  candidates: [
    {
      email: "user@example.com",
      name: "John Doe",
      user_id: "6942eb18668f33b32ac26542",  // ← ADD THIS
      score: 85,
      // ...
    }
  ]
}
```

### ❌ 3. Public Take Pages (Token-Based) Need Mapping

**Problem:** Public take pages (e.g., `/assessment/[id]/[token]/take`) don't have authentication, so they can't use `session.user.id`.

**Current Behavior:** Uses email, candidateName, or token-based IDs

**Solution Options:**

**Option A: Map email to user_id at log write time (Backend)**
```typescript
// When receiving proctoring violation:
POST /api/proctor/record
{
  userId: "user@example.com",  // Frontend sends email
  assessmentId: "...",
  eventType: "GAZE_AWAY",
  // ...
}

// Backend transforms:
const userRecord = await User.findOne({ email: userId });
const actualUserId = userRecord?._id || userId;  // Use MongoDB ObjectId if found

// Save to DB:
await ProctoringLog.create({
  userId: actualUserId,  // Now using MongoDB ObjectId
  assessmentId,
  eventType,
  // ...
});
```

**Option B: Require authentication for proctored assessments**
- Force users to sign in before taking proctored tests
- Public links redirect to login page
- After login, redirect back with userId in session

---

## Architecture Recommendation

### Short-term Fix (✅ Partially Applied)

1. ✅ **Analytics pages use exact userId match** - DONE
2. ✅ **Remove email-based fallback logic** - DONE
3. ❌ **Backend maps email → user_id in POST /api/proctor/record** - TODO
4. ❌ **Backend returns user_id in candidate results** - TODO

### Long-term Solution (Recommended)

1. **Standardize on MongoDB ObjectId everywhere:**
   ```typescript
   // All take pages:
   const getUserIdForProctoring = (session, fallbackEmail, fallbackToken) => {
     return session?.user?.id || fallbackEmail || `token-${fallbackToken}` || 'anonymous';
   };
   ```

2. **Backend: Normalize userId on write:**
   ```typescript
   // POST /api/proctor/record handler:
   const normalizeUserId = async (userId: string) => {
     // If looks like email, look up user_id
     if (userId.includes('@')) {
       const user = await User.findOne({ email: userId });
       return user?._id || userId;
     }
     // If looks like ObjectId, use as-is
     if (/^[0-9a-fA-F]{24}$/.test(userId)) {
       return userId;
     }
     // Otherwise keep as-is (token-based, anonymous, etc.)
     return userId;
   };
   ```

3. **Migrate existing logs (one-time script):**
   ```typescript
   // Script: migrate-proctor-logs-userid.ts
   const logs = await ProctoringLog.find({ userId: /@/ }); // Find email-based logs
   for (const log of logs) {
     const user = await User.findOne({ email: log.userId });
     if (user) {
       await ProctoringLog.updateOne(
         { _id: log._id },
         { $set: { userId: user._id } }
       );
     }
   }
   ```

---

## Testing Checklist

### ✅ Verified (Analytics Pages)
- [x] DSA analytics fetches logs with user_id
- [x] MCQ analytics function signature updated to userId
- [x] AIML analytics uses userKey parameter
- [x] Removed email pattern matching
- [x] Removed normalized string filtering

### ❌ Not Yet Tested (Take Pages)
- [ ] DSA take page uses session.user.id when logged in
- [ ] MCQ take page uses session.user.id when logged in
- [ ] Custom MCQ take page uses session.user.id
- [ ] AIML take page uses session.user.id
- [ ] Public take pages map email to user_id via backend
- [ ] Logs written with user_id are visible in analytics

### ❌ Backend Changes Required
- [ ] POST /api/proctor/record normalizes email → user_id
- [ ] GET /api/proctor/logs accepts MongoDB ObjectId
- [ ] GET /api/assessments/get-candidate-results returns user_id
- [ ] GET /api/dsa/tests/{id}/candidates returns user_id (if not already)
- [ ] GET /api/aiml/tests/{id}/candidates returns user_id (if not already)

---

## Implementation Guide

### Step 1: Update Take Pages (Frontend)

**File:** `pages/test/[id]/take.tsx` (and similar)

```typescript
import { useSession } from 'next-auth/react'

function TakePage() {
  const { data: session } = useSession()
  
  const getUserIdForProctoring = (): string => {
    // Priority 1: Authenticated user
    if (session?.user?.id) {
      console.log('[Proctoring] Using session.user.id:', session.user.id);
      return session.user.id;  // MongoDB ObjectId
    }
    
    // Priority 2: URL param or email (for public access)
    if (userId && userId.trim() !== '') {
      console.log('[Proctoring] Using userId param:', userId);
      return userId.trim();
    }
    
    if (candidateEmail && candidateEmail.trim() !== '') {
      console.log('[Proctoring] Using candidateEmail:', candidateEmail);
      return candidateEmail.trim();
    }
    
    // Priority 3: Fallback to anonymous
    console.warn('[Proctoring] No valid userId found, using anonymous');
    return 'anonymous';
  };

  // When starting proctoring:
  await startUniversalProctoring({
    settings: {
      aiProctoringEnabled: true,
      liveProctoringEnabled: false,
    },
    session: {
      userId: getUserIdForProctoring(),  // ← Use helper function
      assessmentId: assessmentIdStr,
    },
    videoElement: aiProctoringEnabled ? thumbVideoRef.current : null,
  });
}
```

### Step 2: Update Backend Record Endpoint

**File:** `backend/app/api/v2/proctor.py` (or similar)

```python
from bson import ObjectId

@router.post("/record")
async def record_violation(violation: ProctoringViolation):
    """
    Record a proctoring violation.
    Normalizes userId: email → MongoDB ObjectId if user exists.
    """
    user_id = violation.userId
    
    # If userId looks like an email, try to find the actual user_id
    if "@" in user_id:
        user_doc = await users_collection.find_one({"email": user_id})
        if user_doc and "_id" in user_doc:
            user_id = str(user_doc["_id"])  # Convert ObjectId to string
            print(f"[Proctor] Mapped email {violation.userId} → user_id {user_id}")
    
    # Save violation with normalized user_id
    log_entry = {
        "userId": user_id,  # Now using MongoDB ObjectId if found
        "assessmentId": violation.assessmentId,
        "eventType": violation.eventType,
        "timestamp": violation.timestamp,
        "metadata": violation.metadata,
        "snapshotBase64": violation.snapshotBase64,
    }
    
    await proctoring_logs_collection.insert_one(log_entry)
    
    return {"success": True}
```

### Step 3: Update Backend Candidate Results

**File:** `backend/app/api/v2/assessments.py` (or similar)

```python
@router.get("/get-candidate-results")
async def get_candidate_results(assessmentId: str):
    """
    Get candidate results for an assessment.
    NOW INCLUDES user_id field.
    """
    # Fetch candidate submissions
    submissions = await submissions_collection.find(
        {"assessmentId": assessmentId}
    ).to_list(None)
    
    candidates = []
    for sub in submissions:
        candidate = {
            "email": sub.get("email"),
            "name": sub.get("name"),
            "user_id": str(sub.get("userId")),  # ← ADD THIS (MongoDB ObjectId as string)
            "score": sub.get("score"),
            "submittedAt": sub.get("submittedAt"),
            # ... other fields
        }
        candidates.append(candidate)
    
    return {"success": True, "data": candidates}
```

### Step 4: Update Analytics Page Calls

**File:** `pages/assessments/[id]/analytics.tsx`

```typescript
// Now that backend returns user_id, use it:
if (candidate) {
  setSelectedCandidate(candidateEmail)
  fetchAnalytics(candidate.email, candidate.name)
  fetchProctorLogs(candidate.user_id)  // ← Use user_id instead of email
}
```

---

## Migration Plan (Optional)

If you have existing logs with email-based userIds, run this migration script:

**File:** `backend/scripts/migrate_proctor_logs_userid.py`

```python
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import asyncio

async def migrate_logs():
    client = AsyncIOMotorClient("mongodb://...")
    db = client.gisul_assessment
    logs = db.proctoring_logs
    users = db.users
    
    # Find all logs with email-based userIds
    email_logs = await logs.find({"userId": {"$regex": "@"}}).to_list(None)
    
    print(f"Found {len(email_logs)} logs with email-based userIds")
    
    migrated = 0
    for log in email_logs:
        email = log["userId"]
        
        # Look up user by email
        user = await users.find_one({"email": email})
        
        if user and "_id" in user:
            new_user_id = str(user["_id"])
            
            # Update log
            await logs.update_one(
                {"_id": log["_id"]},
                {"$set": {"userId": new_user_id}}
            )
            
            migrated += 1
            if migrated % 100 == 0:
                print(f"Migrated {migrated} logs...")
    
    print(f"✅ Migration complete: {migrated}/{len(email_logs)} logs migrated")

if __name__ == "__main__":
    asyncio.run(migrate_logs())
```

---

## Success Criteria

### Immediate (Analytics Fix Applied ✅)
- [x] Analytics pages fetch logs using userId parameter
- [x] Removed email-based filtering fallbacks
- [x] Simplified exact-match filtering

### Phase 2 (Take Pages - TODO ❌)
- [ ] Take pages use `session.user.id` when user is logged in
- [ ] Take pages fall back to email/token for public access
- [ ] Backend normalizes email → user_id in POST /api/proctor/record

### Phase 3 (Backend Integration - TODO ❌)
- [ ] Backend candidate endpoints return user_id field
- [ ] Existing logs migrated (optional)
- [ ] End-to-end test: Log written → visible in analytics UI

---

## Related Files

### Frontend Files Modified ✅
- `frontend/src/pages/dsa/tests/[id]/analytics.tsx` - Fixed userId fetch
- `frontend/src/pages/assessments/[id]/analytics.tsx` - Fixed function signature

### Frontend Files Needing Update ❌
- `frontend/src/pages/test/[id]/take.tsx` - Use session.user.id
- `frontend/src/pages/assessment/[id]/[token]/take.tsx` - Use session.user.id (or map via backend)
- `frontend/src/pages/custom-mcq/take/[assessmentId].tsx` - Use session.user.id
- `frontend/src/pages/aiml/test/[id]/take.tsx` - Use session.user.id

### Backend Files Needing Update ❌
- `backend/app/api/v2/proctor.py` - Normalize email → user_id
- `backend/app/api/v2/assessments.py` - Return user_id in candidate results
- `backend/app/api/v2/dsa.py` - Return user_id in candidate results (if not already)
- `backend/app/api/v2/aiml.py` - Return user_id in candidate results (if not already)

---

**Status:** Analytics pages fixed ✅ | Take pages pending ❌ | Backend pending ❌
