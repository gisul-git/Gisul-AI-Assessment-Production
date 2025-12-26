# Live Proctoring Visibility Bug - ROOT CAUSE & FIX

## 🎯 ROOT CAUSE (CONFIRMED)

**Issue**: Admin dashboard shows `active_sessions: []` even when candidates have started assessment

**Why**:
1. Admin opens dashboard → Backend sends initial `active_sessions` list (may be empty if no candidates connected yet)
2. Candidate starts assessment 2 seconds later → Candidate WebSocket connects → MongoDB updated with `wsConnected: true`
3. **❌ BUG**: Backend never notifies already-connected admins about the new candidate
4. Admin still sees empty list because they only received the initial snapshot

**Timing Sequence**:
```
T=0s:  Admin opens dashboard
       Backend queries MongoDB → 0 sessions (no candidates yet)
       Admin receives: { type: "active_sessions", sessions: [] }

T=2s:  Candidate starts assessment
       POST /api/v1/proctor/live/start-session → session created
       Candidate WebSocket connects
       MongoDB updated: wsConnected = true
       ❌ Admin NOT notified

T=5s:  Admin still sees 0 sessions (stale data)
```

---

## ✅ THE FIX (Minimal, Targeted)

### Backend Change: Notify Admins on Candidate Connect

**File**: `backend/app/api/v1/proctor/routers.py`  
**Function**: `websocket_candidate()` (Lines ~700-710)

**Added** (after setting `wsConnected: true` in MongoDB):

```python
# ✅ FIX: Notify all admins watching this assessment that a new candidate connected
session_data = {
    "sessionId": session_id,
    "candidateId": session.get("candidateId"),
    "candidateName": session.get("candidateName"),
    "candidateEmail": session.get("candidateEmail"),
    "status": session.get("status"),
    "createdAt": session.get("createdAt"),
}
await connection_manager.send_to_admins(assessment_id, {
    "type": "candidate_connected",
    "session": session_data
})
logger.info(f"[Live Proctoring] 📢 Notified admins of assessment {assessment_id} about new candidate: {session_id}")
```

**What it does**:
- When candidate WebSocket connects, immediately notify all admins watching that assessment
- Sends complete session data (sessionId, candidateId, name, email, status)
- Admins can instantly add this candidate to their grid view

---

### Frontend Change: Handle `candidate_connected` Event

**File**: `frontend/src/universal-proctoring/live/AdminLiveService.ts`  
**Function**: `handleWebSocketMessage()` (Line ~240)

**Added** case in switch statement:

```typescript
case "candidate_connected":
  // Handle real-time notification when candidate WebSocket connects
  await this.handleNewSession(message.session || message);
  break;
```

**What it does**:
- Receives `candidate_connected` event from backend
- Reuses existing `handleNewSession()` logic (already implemented)
- Adds candidate to `activeSessions` array
- Creates WebRTC peer connection
- Triggers UI update via state callback

---

## 📊 Code Diff

### Backend (`routers.py`)
```diff
  logger.info(f"[Live Proctoring] ✅ Marked session {session_id} as wsConnected=True in MongoDB")
  
  # Verify connection was registered
  is_registered = connection_manager.is_candidate_connected(session_id)
  logger.info(f"[Live Proctoring] After connect_candidate, is_candidate_connected({session_id}) = {is_registered}")
  logger.info(f"[Live Proctoring] All registered candidate connections: {list(connection_manager.candidate_connections.keys())}")
+ 
+ # ✅ FIX: Notify all admins watching this assessment that a new candidate connected
+ session_data = {
+     "sessionId": session_id,
+     "candidateId": session.get("candidateId"),
+     "candidateName": session.get("candidateName"),
+     "candidateEmail": session.get("candidateEmail"),
+     "status": session.get("status"),
+     "createdAt": session.get("createdAt"),
+ }
+ await connection_manager.send_to_admins(assessment_id, {
+     "type": "candidate_connected",
+     "session": session_data
+ })
+ logger.info(f"[Live Proctoring] 📢 Notified admins of assessment {assessment_id} about new candidate: {session_id}")
```

### Frontend (`AdminLiveService.ts`)
```diff
  switch (message.type) {
    case "active_sessions":
      await this.handleActiveSessions(message.sessions || []);
      break;

    case "new_session":
      await this.handleNewSession(message);
      break;

+   case "candidate_connected":
+     // Handle real-time notification when candidate WebSocket connects
+     await this.handleNewSession(message.session || message);
+     break;

    case "session_ended":
      this.handleSessionEnded(message.sessionId);
      break;
```

---

## 🧪 Verification Steps

### Step 1: Check Backend Logs

**Expected logs when candidate connects**:
```
[Live Proctoring] Candidate WebSocket connecting: session_id=abc-123, candidate_id=test@example.com
[Live Proctoring] ✅ Marked session abc-123 as wsConnected=True in MongoDB
[Live Proctoring] 📢 Notified admins of assessment assessment-456 about new candidate: abc-123
```

### Step 2: Check Admin Browser Console

**Expected logs when candidate connects (admin already watching)**:
```
[AdminLiveService] Received message: candidate_connected
[AdminLiveService] New session started: abc-123
[AdminLiveService] Creating peer connection for candidate abc-123
[AdminLiveService] ✅ Candidate connected: abc-123
```

### Step 3: Verify UI Updates

**Admin Dashboard Should**:
1. Show loading state initially
2. If no candidates: Show "No active candidates" message
3. When candidate connects: Immediately show new tile in grid
4. Tile should display: name/email, status badge, loading spinner (until streams arrive)
5. Within 2-3 seconds: Webcam + screen streams appear

---

## 🔍 MongoDB Validation Query

**Check if candidate session exists and is connected**:
```javascript
db.live_proctor_sessions.findOne({
  sessionId: "paste-session-id-here"
})

// Should return:
{
  sessionId: "abc-123",
  assessmentId: "assessment-456",
  candidateId: "test@example.com",
  status: "candidate_initiated",
  wsConnected: true,  // ← Must be boolean true
  createdAt: "2025-12-24T10:00:00Z",
  updatedAt: "2025-12-24T10:00:02Z"
}
```

**Check admin can see it**:
```javascript
db.live_proctor_sessions.find({
  assessmentId: "assessment-456",
  status: {$in: ["candidate_initiated", "offer_sent", "active"]},
  wsConnected: true
}).pretty()

// Should return all visible sessions
```

---

## 📋 Test Scenarios

### Scenario 1: Admin Opens Dashboard First (Original Bug)

**Steps**:
1. Admin opens `/assessments/123/live-dashboard`
2. Admin sees: "No active candidates" (or loading)
3. Candidate starts assessment (opens take page)
4. Candidate clicks "Start Assessment"
5. Candidate WebSocket connects

**Expected Result (After Fix)**:
- Admin dashboard **instantly** shows new candidate tile
- No page refresh needed
- Candidate name, status, and loading spinner appear
- Streams load within 2-3 seconds

**Before Fix**: Admin sees nothing (empty list, no updates)

---

### Scenario 2: Candidate Starts First

**Steps**:
1. Candidate starts assessment
2. Candidate WebSocket connects
3. MongoDB shows `wsConnected: true`
4. Admin opens dashboard 5 seconds later

**Expected Result**:
- Backend sends initial `active_sessions` list with 1 candidate
- Admin sees candidate immediately (no notification needed - already in initial query)

**Status**: ✅ Already worked (no bug in this direction)

---

### Scenario 3: Multiple Candidates Join Late

**Steps**:
1. Admin opens dashboard (sees 0 candidates)
2. Candidate A connects after 2 seconds
3. Candidate B connects after 5 seconds
4. Candidate C connects after 8 seconds

**Expected Result (After Fix)**:
- Candidate A tile appears at T=2s
- Candidate B tile appears at T=5s
- Candidate C tile appears at T=8s
- All tiles show correct streams and status

---

## 🎯 Why This Fix Is Minimal

**What Changed**:
- ✅ 1 backend notification call (15 lines)
- ✅ 1 frontend case handler (3 lines)

**What Did NOT Change**:
- ❌ No database schema changes
- ❌ No API endpoint modifications
- ❌ No WebRTC logic changes
- ❌ No take page modifications
- ❌ No status value changes
- ❌ No connection_manager refactoring

**Architecture Preserved**:
- Lazy WebRTC still works the same
- ADMIN_CONNECTED signal unchanged
- Session lifecycle unchanged
- MongoDB queries unchanged
- AI Proctoring completely untouched

---

## 🚀 Expected Console Output

### Full Flow (Admin Opens First)

**Admin Side**:
```
[AdminLiveService] ✅ Starting admin monitoring...
[AdminLiveService] ✅ WebSocket connected
[AdminLiveService] Received message: active_sessions
[AdminLiveService] Received 0 active sessions

// (2 seconds later, candidate connects)
[AdminLiveService] Received message: candidate_connected
[AdminLiveService] New session started: abc-123-def
[AdminLiveService] Creating peer connection for candidate abc-123-def
[AdminLiveService] Peer connection state: connecting
[AdminLiveService] ✅ Candidate connected: abc-123-def

// (3 seconds later, streams arrive)
[AdminLiveService] Received offer from candidate abc-123-def
[AdminLiveService] ✅ Received webcam stream for abc-123-def
[AdminLiveService] ✅ Received screen stream for abc-123-def
[AdminLiveService] Connection state: connected
```

**Candidate Side**:
```
[Take] 📝 Registering Live Proctoring session...
[Take] ✅ Session registered: abc-123-def
[Take] ✅ WebSocket connected, waiting for admin...

// (Admin is already watching, ADMIN_CONNECTED sent immediately)
[Take] 🚀 ADMIN_CONNECTED signal received!
[Take] 🚀 Admin connected! Starting WebRTC...
[CandidateLiveService] ✅ Offer sent
[CandidateLiveService] Connection state: connected
```

**Backend Logs**:
```
[Live Proctoring] Candidate WebSocket connecting: session_id=abc-123-def
[Live Proctoring] ✅ Marked session abc-123-def as wsConnected=True in MongoDB
[Live Proctoring] 📢 Notified admins of assessment assessment-456 about new candidate: abc-123-def

// (If admin already connected)
[WebSocket] Sent to admin: candidate_connected
```

---

## ✅ Summary

**Root Cause**: Missing real-time notification when candidate connects  
**Fix Location**: Backend WebSocket handler + Frontend message handler  
**Lines Changed**: Backend: +15 lines | Frontend: +3 lines  
**Breaking Changes**: None  
**Architecture Changes**: None  
**Testing Required**: Manual end-to-end with admin-first scenario  

**Result**: Admin dashboard now receives real-time updates when candidates join, eliminating the visibility bug.
