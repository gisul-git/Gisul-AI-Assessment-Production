# Live Proctoring Redesign Proposal - Production Architecture

**Date**: December 24, 2025  
**Status**: READ-ONLY ANALYSIS & DESIGN PROPOSAL  
**Purpose**: Redesign Live Proctoring for production with proper permission handling and lazy WebRTC

---

## Table of Contents

1. [Requirements Analysis](#1-requirements-analysis)
2. [Current State Assessment](#2-current-state-assessment)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Candidate Flow (New)](#4-candidate-flow-new)
5. [Admin Flow (New)](#5-admin-flow-new)
6. [WebRTC Lifecycle](#6-webrtc-lifecycle)
7. [Permission Verification](#7-permission-verification)
8. [Files to Delete/Archive](#8-files-to-deletearchive)
9. [Refactor Checklist](#9-refactor-checklist)
10. [Risk Assessment](#10-risk-assessment)

---

## 1. Requirements Analysis

### ✅ Production Requirements

| # | Requirement | Current Status | Required Change |
|---|-------------|----------------|-----------------|
| 1 | Live Proctoring independent of AI Proctoring | ✅ DONE | None (recently fixed) |
| 2 | NO browser permission popups after "Start Assessment" | ❌ BROKEN | Camera preservation needed |
| 3 | Camera + screen permissions ONLY in precheck/identity | ⚠️ PARTIAL | Camera not preserved |
| 4 | Candidate must NOT start WebRTC automatically | ❌ BROKEN | Remove auto-start |
| 5 | WebRTC streaming ONLY when admin opens dashboard | ❌ MISSING | Implement lazy connection |
| 6 | Admin can close/reopen without affecting candidate | ✅ SUPPORTED | Backend already handles |
| 7 | Backend must not relay video (WebRTC P2P only) | ⚠️ VERIFY | Check backend architecture |
| 8 | Multiple candidates stream simultaneously in grid | ✅ SUPPORTED | AdminLiveService ready |
| 9 | Admin can expand single candidate | ✅ SUPPORTED | UI feature only |

---

## 2. Current State Assessment

### Critical Issues

#### Issue 1: Camera Stream Not Preserved 🔴 HIGH

**Problem**:
```typescript
// Pre-check: Camera requested → verified → DESTROYED
const stream = await getUserMedia({ video: true });
stream.getTracks().forEach(track => track.stop()); // ❌ DISCARDED

// Take page: Camera requested AGAIN after "Start Assessment"
this.stream = await getUserMedia({ video: true }); // ⚠️ NEW POPUP
```

**Impact**: Browser permission popup appears after exam starts

---

#### Issue 2: WebRTC Auto-Start 🔴 HIGH

**Problem**:
```typescript
// Take page mounts → immediately starts WebRTC
useEffect(() => {
  if (liveProctoringEnabled && liveProctorScreenStream) {
    const liveService = new CandidateLiveService({ ... });
    liveService.start(...); // ❌ STARTS IMMEDIATELY
  }
}, [liveProctoringEnabled, liveProctorScreenStream]);
```

**Impact**: 
- Candidate wastes bandwidth streaming to nobody
- WebRTC connection before admin even opens dashboard
- Cannot implement lazy connection

---

#### Issue 3: No Admin Dashboard UI 🟠 MEDIUM

**Problem**: `AdminLiveService` fully implemented but no UI exists

**Impact**: Live Proctoring feature is incomplete

---

### What Works Well ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Screen stream preservation | ✅ Perfect | `window.__screenStream` works |
| CandidateLiveService | ✅ Ready | WebRTC implementation solid |
| AdminLiveService | ✅ Ready | Multi-candidate monitoring ready |
| WebSocket signaling | ✅ Working | SDP offer/answer/ICE working |
| Stream reuse (AI+Live) | ✅ Working | Live reuses Universal's camera |

---

## 3. Proposed Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION FLOW                              │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 1: PRE-CHECK (No "Start Assessment" Yet)                       │
├──────────────────────────────────────────────────────────────────────┤
│ 1. Browser Check                                                      │
│ 2. Network Check                                                      │
│ 3. 📷 Camera Check                                                    │
│    └─ getUserMedia({ video: true })                                  │
│    └─ Store: window.__cameraStream = stream ← ✅ PRESERVED           │
│ 4. 🎤 Microphone Check                                               │
│    └─ getUserMedia({ audio: true })                                  │
│    └─ Stop after verification (audio not needed)                     │
│ 5. Navigate → Instructions                                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 2: IDENTITY VERIFICATION (No "Start Assessment" Yet)           │
├──────────────────────────────────────────────────────────────────────┤
│ 1. 📸 Photo Capture                                                  │
│    └─ Reuses: window.__cameraStream ← ✅ NO NEW REQUEST             │
│ 2. 🖥️ Screen Share                                                  │
│    └─ getDisplayMedia({ video: true })                               │
│    └─ Store: window.__screenStream = stream ← ✅ PRESERVED           │
│ 3. ⛶ Fullscreen Enforcement                                         │
│    └─ Enter fullscreen mode                                          │
│ 4. Navigate → Take Page with "Start Assessment" button               │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 3: TAKE PAGE - CANDIDATE SIDE (After "Start Assessment")       │
├──────────────────────────────────────────────────────────────────────┤
│ 1. IF AI Proctoring Enabled:                                         │
│    └─ Universal Proctoring starts                                    │
│       └─ Reuses: window.__cameraStream ← ✅ NO NEW REQUEST          │
│                                                                       │
│ 2. IF Live Proctoring Enabled:                                       │
│    ├─ Register session with backend:                                 │
│    │  └─ POST /api/live-proctoring/session                          │
│    │     { candidate_id, assessment_id, status: "ready" }           │
│    │                                                                  │
│    ├─ Listen for admin connection signal:                            │
│    │  └─ WebSocket: { type: "admin_connected" }                     │
│    │                                                                  │
│    └─ ONLY WHEN ADMIN CONNECTS:                                      │
│       ├─ CandidateLiveService.start()                                │
│       ├─ Use existing streams:                                       │
│       │  ├─ window.__cameraStream                                    │
│       │  └─ window.__screenStream                                    │
│       └─ Create WebRTC peer connection                               │
│                                                                       │
│ 3. Candidate focuses on answering questions                          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 4: ADMIN DASHBOARD (Independent Timeline)                      │
├──────────────────────────────────────────────────────────────────────┤
│ 1. Admin opens: /assessments/{id}/live-dashboard                     │
│                                                                       │
│ 2. AdminLiveService.startMonitoring():                               │
│    ├─ Connect WebSocket                                              │
│    ├─ GET /api/live-proctoring/sessions?assessment_id={id}          │
│    │  └─ Returns: [{ session_id, candidate_id, status: "ready" }]   │
│    │                                                                  │
│    ├─ For each candidate:                                            │
│    │  ├─ Backend signals candidate: { type: "admin_connected" }     │
│    │  ├─ Candidate starts WebRTC                                     │
│    │  ├─ Backend relays SDP offer → Admin                            │
│    │  ├─ Admin creates peer connection                               │
│    │  ├─ Admin sends SDP answer → Backend → Candidate               │
│    │  └─ ICE candidates exchanged                                    │
│    │                                                                  │
│    └─ Admin receives streams:                                        │
│       ├─ webcamStream (track 1)                                      │
│       └─ screenStream (track 2)                                      │
│                                                                       │
│ 3. Display in grid view:                                             │
│    └─ 2x2, 3x3, or 4x4 grid based on candidate count                │
│                                                                       │
│ 4. Admin can:                                                         │
│    ├─ Expand single candidate (screen + PiP webcam)                 │
│    ├─ Close dashboard (streams pause, no disconnect)                │
│    └─ Reopen dashboard (streams resume)                              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Candidate Flow (New)

### State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                    CANDIDATE STATE MACHINE                       │
└─────────────────────────────────────────────────────────────────┘

[NOT_STARTED] 
    │
    │ User enters email + token
    ▼
[PRECHECK_IN_PROGRESS]
    │ getUserMedia (camera) → window.__cameraStream
    │ getUserMedia (mic) → verify then stop
    ▼
[PRECHECK_COMPLETE]
    │
    ▼
[IDENTITY_VERIFY_IN_PROGRESS]
    │ Reuse window.__cameraStream (photo)
    │ getDisplayMedia (screen) → window.__screenStream
    │ Enter fullscreen
    ▼
[IDENTITY_VERIFY_COMPLETE]
    │
    │ Click "Start Assessment"
    ▼
[ASSESSMENT_STARTED]
    │ IF AI Proctoring: Reuse window.__cameraStream
    │ IF Live Proctoring: Register session (no WebRTC yet)
    ▼
[LIVE_PROCTORING_READY] ← Waiting for admin
    │
    │ Receive: { type: "admin_connected" }
    ▼
[LIVE_PROCTORING_CONNECTING]
    │ CandidateLiveService.start()
    │ Create peer connection
    │ Exchange SDP
    ▼
[LIVE_PROCTORING_STREAMING] ← Streaming to admin
    │
    │ Admin closes dashboard
    ▼
[LIVE_PROCTORING_PAUSED] ← Connection maintained, no streaming
    │
    │ Admin reopens dashboard
    ▼
[LIVE_PROCTORING_STREAMING]
    │
    │ Submit test
    ▼
[ASSESSMENT_SUBMITTED]
    │ Stop all streams
    │ Close peer connections
    ▼
[COMPLETED]
```

---

### Detailed Step-by-Step

#### Step 1: Pre-Check (No Permission Issues)

```typescript
// File: precheck/[assessmentId]/[token]/index.tsx

async function checkCamera(): Promise<boolean> {
  // Request camera permission
  const stream = await navigator.mediaDevices.getUserMedia({ 
    video: { ideal: 640, height: 480 } 
  });
  
  // Verify camera works
  setCameraStream(stream);
  
  // ✅ NEW: Store globally (DO NOT STOP)
  if (typeof window !== 'undefined') {
    window.__cameraStream = stream;
    console.log('✅ Camera stream preserved globally');
  }
  
  // ❌ OLD: stream.getTracks().forEach(track => track.stop());
  // ✅ NEW: Keep stream alive
  
  return true;
}
```

**Changes Required**:
- Remove `stream.getTracks().forEach(track => track.stop())` from line ~450
- Add `window.__cameraStream = stream` storage
- Update video element to use global stream

---

#### Step 2: Identity Verify (Reuse Camera)

```typescript
// File: identity-verify.tsx

// Photo capture component receives window.__cameraStream
<IdentityVerification
  existingCameraStream={window.__cameraStream} // ✅ Reuse
  onCaptureComplete={handlePhotoCapture}
/>
```

**Changes Required**:
- Update `IdentityVerification` component to accept `existingCameraStream` prop
- Remove internal `getUserMedia()` call
- Use provided stream instead

---

#### Step 3: Take Page (Lazy WebRTC)

```typescript
// File: assessment/[id]/[token]/take.tsx

// ✅ NEW APPROACH: Register session, wait for admin
useEffect(() => {
  if (!liveProctoringEnabled) return;
  
  // Register session (no WebRTC yet)
  registerLiveSession({
    candidate_id: candidateIdStr,
    assessment_id: assessmentIdStr,
    status: 'ready',
  });
  
  // Listen for admin connection signal
  const ws = new WebSocket('ws://localhost:8000/ws/live-proctoring');
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'admin_connected') {
      // NOW start WebRTC
      startLiveProctoring();
    }
    
    if (message.type === 'admin_disconnected') {
      // Pause streaming (keep connection alive)
      pauseLiveProctoring();
    }
  };
  
}, [liveProctoringEnabled]);

async function startLiveProctoring() {
  const liveService = new CandidateLiveService({ ... });
  
  // Use existing streams (NO NEW getUserMedia)
  await liveService.start(
    callbacks,
    window.__screenStream,     // ✅ Existing screen
    window.__cameraStream      // ✅ Existing camera
  );
}
```

**Changes Required**:
- Add session registration endpoint
- Add WebSocket listener for admin signals
- Remove auto-start useEffect
- Add lazy connection logic

---

## 5. Admin Flow (New)

### Admin Dashboard UI (NEW)

#### Route: `/assessments/[id]/live-dashboard`

```
┌─────────────────────────────────────────────────────────────────┐
│                    LIVE PROCTORING DASHBOARD                     │
├─────────────────────────────────────────────────────────────────┤
│  Assessment: DSA Test 2024 Q4                                    │
│  Active Candidates: 12                                           │
│  ┌──────────┬──────────┬──────────┬──────────┐                  │
│  │ Jane Doe │ John S.  │ Alice W. │ Bob M.   │                  │
│  │ 🟢 Conn  │ 🟢 Conn  │ 🟡 Warn  │ 🔴 Issue │                  │
│  │ [webcam] │ [webcam] │ [webcam] │ [webcam] │                  │
│  │ [screen] │ [screen] │ [screen] │ [screen] │                  │
│  │  Expand  │  Expand  │  Expand  │  Expand  │                  │
│  └──────────┴──────────┴──────────┴──────────┘                  │
│  ┌──────────┬──────────┬──────────┬──────────┐                  │
│  │ Carol T. │ David L. │ Emma B.  │ Frank H. │                  │
│  │ 🟢 Conn  │ 🟢 Conn  │ 🟢 Conn  │ 🟢 Conn  │                  │
│  │ [webcam] │ [webcam] │ [webcam] │ [webcam] │                  │
│  │ [screen] │ [screen] │ [screen] │ [screen] │                  │
│  │  Expand  │  Expand  │  Expand  │  Expand  │                  │
│  └──────────┴──────────┴──────────┴──────────┘                  │
│  ┌──────────┬──────────┬──────────┬──────────┐                  │
│  │ Grace N. │ Henry P. │ Ivy Q.   │ Jack R.  │                  │
│  │ 🟢 Conn  │ 🟢 Conn  │ 🟢 Conn  │ 🟢 Conn  │                  │
│  │ [webcam] │ [webcam] │ [webcam] │ [webcam] │                  │
│  │ [screen] │ [screen] │ [screen] │ [screen] │                  │
│  │  Expand  │  Expand  │  Expand  │  Expand  │                  │
│  └──────────┴──────────┴──────────┴──────────┘                  │
│                                                                  │
│  [Close Dashboard]                                               │
└─────────────────────────────────────────────────────────────────┘

EXPANDED VIEW (Click "Expand" on candidate):
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Grid     Jane Doe (jane@example.com)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                  PRIMARY: SCREEN STREAM                   │  │
│  │                                                           │  │
│  │                    [Full Screen Share]                    │  │
│  │                                                           │  │
│  │                                                           │  │
│  │  ┌──────────────────┐                                    │  │
│  │  │  PiP: WEBCAM     │  ← Picture-in-Picture              │  │
│  │  │  [Face visible]  │                                    │  │
│  │  └──────────────────┘                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Status: 🟢 Connected | Duration: 00:23:45                      │
│  [Refresh Connection]                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

### Admin State Machine

```
[DASHBOARD_CLOSED]
    │
    │ Admin navigates to /assessments/{id}/live-dashboard
    ▼
[DASHBOARD_OPENING]
    │ AdminLiveService.startMonitoring()
    │ Connect WebSocket
    │ Fetch active sessions
    ▼
[FETCHING_SESSIONS]
    │ GET /api/live-proctoring/sessions
    │ Response: [{ session_id, candidate_id, status }]
    ▼
[SIGNALING_CANDIDATES]
    │ For each session:
    │   Send: { type: "admin_connected", session_id }
    ▼
[ESTABLISHING_CONNECTIONS]
    │ Wait for SDP offers from candidates
    │ Create peer connections
    │ Send SDP answers
    │ Exchange ICE candidates
    ▼
[STREAMING] ← Receiving streams from all candidates
    │
    │ Admin clicks "Close Dashboard"
    ▼
[DASHBOARD_CLOSING]
    │ Send: { type: "admin_disconnected" }
    │ Close peer connections (local only)
    │ Navigate away
    ▼
[DASHBOARD_CLOSED]
    │
    │ Admin reopens dashboard
    ▼
[DASHBOARD_OPENING] (reconnection cycle)
```

---

### Detailed Step-by-Step

#### Step 1: Admin Opens Dashboard

```typescript
// File: assessments/[id]/live-dashboard.tsx (NEW FILE)

export default function LiveDashboardPage() {
  const router = useRouter();
  const { id: assessmentId } = router.query;
  const { data: session } = useSession();
  
  const adminId = session?.user?.email || 'admin';
  const serviceRef = useRef<AdminLiveService | null>(null);
  
  const [candidates, setCandidates] = useState<CandidateStreamInfo[]>([]);
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  
  useEffect(() => {
    if (!assessmentId) return;
    
    // Create AdminLiveService
    const service = new AdminLiveService({
      assessmentId: String(assessmentId),
      adminId,
      debugMode: true,
    });
    
    // Start monitoring
    service.startMonitoring({
      onSessionsUpdated: (sessions) => {
        console.log('Sessions updated:', sessions);
        setCandidates(sessions);
      },
      onStreamAdded: (sessionId, webcamStream, screenStream) => {
        console.log('Stream added:', sessionId);
        setCandidates(prev => prev.map(c => 
          c.sessionId === sessionId 
            ? { ...c, webcamStream, screenStream, status: 'connected' }
            : c
        ));
      },
      onError: (error) => {
        console.error('Admin monitoring error:', error);
      },
    });
    
    serviceRef.current = service;
    
    // Cleanup
    return () => {
      service.stopMonitoring();
    };
  }, [assessmentId, adminId]);
  
  return (
    <div className="live-dashboard">
      {expandedCandidate ? (
        <ExpandedView 
          candidate={candidates.find(c => c.sessionId === expandedCandidate)}
          onBack={() => setExpandedCandidate(null)}
        />
      ) : (
        <GridView 
          candidates={candidates}
          onExpand={setExpandedCandidate}
        />
      )}
    </div>
  );
}
```

---

#### Step 2: Grid View Component

```typescript
// File: components/live/GridView.tsx (NEW FILE)

interface GridViewProps {
  candidates: CandidateStreamInfo[];
  onExpand: (sessionId: string) => void;
}

export function GridView({ candidates, onExpand }: GridViewProps) {
  return (
    <div className="grid grid-cols-4 gap-4 p-4">
      {candidates.map(candidate => (
        <CandidateCard
          key={candidate.sessionId}
          candidate={candidate}
          onExpand={() => onExpand(candidate.sessionId)}
        />
      ))}
    </div>
  );
}

function CandidateCard({ candidate, onExpand }) {
  const webcamRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  
  // Attach webcam stream
  useEffect(() => {
    if (webcamRef.current && candidate.webcamStream) {
      webcamRef.current.srcObject = candidate.webcamStream;
      webcamRef.current.play();
    }
  }, [candidate.webcamStream]);
  
  // Attach screen stream
  useEffect(() => {
    if (screenRef.current && candidate.screenStream) {
      screenRef.current.srcObject = candidate.screenStream;
      screenRef.current.play();
    }
  }, [candidate.screenStream]);
  
  return (
    <div className="candidate-card border rounded">
      <div className="header">
        <span>{candidate.candidateId}</span>
        <StatusBadge status={candidate.status} />
      </div>
      
      <video ref={webcamRef} className="webcam" autoPlay muted />
      <video ref={screenRef} className="screen" autoPlay muted />
      
      <button onClick={onExpand}>Expand</button>
    </div>
  );
}
```

---

#### Step 3: Expanded View Component

```typescript
// File: components/live/ExpandedView.tsx (NEW FILE)

interface ExpandedViewProps {
  candidate: CandidateStreamInfo;
  onBack: () => void;
}

export function ExpandedView({ candidate, onBack }: ExpandedViewProps) {
  const screenRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (screenRef.current && candidate.screenStream) {
      screenRef.current.srcObject = candidate.screenStream;
      screenRef.current.play();
    }
  }, [candidate.screenStream]);
  
  useEffect(() => {
    if (webcamRef.current && candidate.webcamStream) {
      webcamRef.current.srcObject = candidate.webcamStream;
      webcamRef.current.play();
    }
  }, [candidate.webcamStream]);
  
  return (
    <div className="expanded-view h-screen">
      <div className="header">
        <button onClick={onBack}>← Back to Grid</button>
        <h2>{candidate.candidateId}</h2>
      </div>
      
      <div className="relative h-full">
        {/* Primary: Screen Stream (full size) */}
        <video 
          ref={screenRef}
          className="w-full h-full object-contain"
          autoPlay 
          muted 
        />
        
        {/* Picture-in-Picture: Webcam (bottom-right corner) */}
        <video 
          ref={webcamRef}
          className="absolute bottom-4 right-4 w-64 h-48 border-2 border-white rounded"
          autoPlay 
          muted 
        />
      </div>
    </div>
  );
}
```

---

## 6. WebRTC Lifecycle

### Connection States

```
┌─────────────────────────────────────────────────────────────────┐
│                       WEBRTC LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────┘

CANDIDATE SIDE:
  [IDLE] 
    → Admin opens dashboard
  [SIGNALED] (received admin_connected message)
    → Create RTCPeerConnection
  [CREATING_OFFER]
    → Add media tracks
    → createOffer()
  [OFFER_CREATED]
    → setLocalDescription(offer)
    → Send offer via WebSocket
  [WAITING_FOR_ANSWER]
    → Receive answer from admin
  [ANSWER_RECEIVED]
    → setRemoteDescription(answer)
  [EXCHANGING_ICE]
    → Send/receive ICE candidates
  [CONNECTED] ✅
    → Streaming video to admin
  [PAUSED] (admin closed dashboard)
    → Connection maintained, no active streaming
  [DISCONNECTED] (test submitted)
    → Close peer connection
    → Stop tracks

ADMIN SIDE:
  [IDLE]
    → Open dashboard
  [CONNECTING]
    → Connect WebSocket
    → Signal all candidates
  [WAITING_FOR_OFFERS]
    → Receive offers from candidates
  [CREATING_ANSWERS]
    → For each offer:
      - Create RTCPeerConnection
      - setRemoteDescription(offer)
      - createAnswer()
      - setLocalDescription(answer)
      - Send answer via WebSocket
  [EXCHANGING_ICE]
    → Send/receive ICE candidates
  [CONNECTED] ✅
    → Receiving streams from all candidates
  [CLOSING]
    → Admin closes dashboard
    → Send disconnect signal
    → Close peer connections (local only)
  [CLOSED]
```

---

### Signal Flow

```
┌────────────┐                 ┌────────────┐                 ┌────────────┐
│ CANDIDATE  │                 │  BACKEND   │                 │   ADMIN    │
└────────────┘                 └────────────┘                 └────────────┘
      │                              │                              │
      │ 1. Register Session          │                              │
      ├─────────────────────────────►│                              │
      │   POST /session              │                              │
      │   { status: "ready" }        │                              │
      │                              │                              │
      │                              │ 2. Admin Opens Dashboard      │
      │                              │◄─────────────────────────────┤
      │                              │   GET /sessions              │
      │                              │                              │
      │ 3. Admin Connected Signal    │                              │
      │◄─────────────────────────────┤                              │
      │   WS: { type: "admin_connected" }                           │
      │                              │                              │
      │ 4. Create Peer Connection    │                              │
      │ 5. Create Offer              │                              │
      │ 6. Send Offer                │                              │
      ├─────────────────────────────►│                              │
      │   WS: { type: "offer", sdp } │                              │
      │                              │                              │
      │                              │ 7. Relay Offer               │
      │                              ├─────────────────────────────►│
      │                              │   WS: { type: "offer" }      │
      │                              │                              │
      │                              │ 8. Admin Creates Peer Conn   │
      │                              │ 9. Admin Creates Answer      │
      │                              │                              │
      │                              │ 10. Admin Sends Answer       │
      │                              │◄─────────────────────────────┤
      │                              │   WS: { type: "answer", sdp }│
      │                              │                              │
      │ 11. Relay Answer             │                              │
      │◄─────────────────────────────┤                              │
      │   WS: { type: "answer" }     │                              │
      │                              │                              │
      │ 12. Set Remote Description   │                              │
      │                              │                              │
      │ 13. ICE Candidates ◄────────►│◄────────────────────────────►│
      │     (bidirectional)          │     (relayed by backend)     │
      │                              │                              │
      │ 14. ✅ CONNECTED             │                              │
      │ 15. Streaming Video ─────────┼─────────────────────────────►│
      │     (P2P, no backend relay)  │                              │
      │                              │                              │
```

---

### Reconnection Handling

```typescript
// Scenario: Admin closes and reopens dashboard

// CANDIDATE SIDE:
- Receives: { type: "admin_disconnected" }
- Action: Pause streaming (keep peer connection alive)
- State: PAUSED

// Later...
- Receives: { type: "admin_connected" }
- Action: Resume streaming (same peer connection OR create new)
- State: CONNECTED

// ADMIN SIDE:
- Admin closes dashboard
- Action: Close all peer connections (local cleanup only)
- Backend: Keeps candidate sessions active

// Admin reopens dashboard
- Action: Fetch active sessions again
- Action: Create NEW peer connections for all candidates
- Action: Signal candidates to reconnect
```

---

## 7. Permission Verification

### ✅ GUARANTEE: No Permissions After "Start Assessment"

#### Current Permission Calls (Before Redesign)

| Phase | File | Method | When | After Start? |
|-------|------|--------|------|--------------|
| Pre-check | `precheck/[...]/index.tsx` | `getUserMedia()` | Camera check | ❌ NO |
| Identity | `identity-verify.tsx` | `getUserMedia()` | Photo capture | ❌ NO |
| Identity | `identity-verify.tsx` | `getDisplayMedia()` | Screen share | ❌ NO |
| Take (AI) | `UniversalProctoringService.ts` | `getUserMedia()` | AI proctoring starts | ⚠️ YES |
| Take (Live) | `CandidateLiveService.ts` | `getUserMedia()` | Live fallback | ⚠️ YES |

#### Proposed Permission Calls (After Redesign)

| Phase | File | Method | When | After Start? |
|-------|------|--------|------|--------------|
| Pre-check | `precheck/[...]/index.tsx` | `getUserMedia()` | Camera check | ❌ NO |
| Pre-check | `precheck/[...]/index.tsx` | Store in `window.__cameraStream` | After verification | ❌ NO |
| Identity | `identity-verify.tsx` | Reuse `window.__cameraStream` | Photo capture | ❌ NO |
| Identity | `identity-verify.tsx` | `getDisplayMedia()` | Screen share | ❌ NO |
| Identity | `identity-verify.tsx` | Store in `window.__screenStream` | After verification | ❌ NO |
| Take (AI) | `UniversalProctoringService.ts` | Reuse `window.__cameraStream` | AI proctoring starts | ✅ NO |
| Take (Live) | `CandidateLiveService.ts` | Reuse `window.__cameraStream` | When admin connects | ✅ NO |

### Code Changes Required

#### Change 1: Pre-check Camera Storage

```typescript
// File: precheck/[assessmentId]/[token]/index.tsx
// Line: ~440-450

// ❌ OLD CODE:
if (stream) {
  stream.getTracks().forEach(track => track.stop()); // DESTROYED
}

// ✅ NEW CODE:
if (stream) {
  // Store globally (keep alive)
  if (typeof window !== 'undefined') {
    (window as any).__cameraStream = stream;
  }
  console.log('✅ Camera stream preserved in window.__cameraStream');
}
// DO NOT STOP TRACKS
```

---

#### Change 2: Universal Proctoring Camera Reuse

```typescript
// File: UniversalProctoringService.ts
// Line: ~200-210

// ❌ OLD CODE:
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
});

// ✅ NEW CODE:
let stream: MediaStream;

// Check for existing camera stream first
if (typeof window !== 'undefined' && (window as any).__cameraStream) {
  const existingStream = (window as any).__cameraStream as MediaStream;
  
  if (existingStream.active && existingStream.getVideoTracks().length > 0) {
    console.log('✅ Reusing existing camera stream from pre-check');
    stream = existingStream;
  } else {
    console.warn('⚠️ Existing camera stream not active, requesting new');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  }
} else {
  console.warn('⚠️ No existing camera stream found, requesting new');
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
}

this.stream = stream;
```

---

#### Change 3: Live Proctoring Remove Fallback

```typescript
// File: CandidateLiveService.ts
// Lines: 130-141

// ❌ OLD CODE:
if (existingWebcamStream && existingWebcamStream.active) {
  this.log("✅ Reusing existing webcam stream");
  this.webcamStream = existingWebcamStream;
} else {
  this.log("Getting new webcam stream...");
  this.webcamStream = await getWebcamStream(); // ← CAN REQUEST NEW STREAM
}

// ✅ NEW CODE:
if (existingWebcamStream && existingWebcamStream.active) {
  this.log("✅ Reusing existing webcam stream");
  this.webcamStream = existingWebcamStream;
} else {
  // Check global storage
  const globalCamera = (window as any).__cameraStream as MediaStream | undefined;
  
  if (globalCamera?.active) {
    this.log("✅ Reusing camera from window.__cameraStream");
    this.webcamStream = globalCamera;
  } else {
    // FAIL FAST - do not request new stream
    const error = 'No camera stream available. Camera must be captured in pre-check.';
    this.log(`❌ ${error}`);
    throw new Error(error);
  }
}
```

---

### Verification Checklist

```
✅ Pre-check: getUserMedia() → window.__cameraStream (preserved)
✅ Identity: Reuses window.__cameraStream (no new request)
✅ Identity: getDisplayMedia() → window.__screenStream (preserved)
✅ Universal Proctoring: Reuses window.__cameraStream (no new request)
✅ Live Proctoring: Reuses window.__cameraStream (no new request)
✅ No getUserMedia() calls after "Start Assessment"
✅ No getDisplayMedia() calls after "Start Assessment"
```

---

## 8. Files to Delete/Archive

### 🗑️ SAFE TO DELETE

| File | Lines | Reason | Risk |
|------|-------|--------|------|
| `reference/useLiveProctoring.ts` | ~350 | Replaced by `CandidateLiveService` | 🟢 LOW |
| `reference/useMultiLiveProctorAdmin.ts` | ~500 | Replaced by `AdminLiveService` | 🟢 LOW |
| `reference/take.tsx` | ~800 | Old assessment page | 🟢 LOW |
| `reference/useFaceMesh.ts` | ~200 | Integrated into Universal Proctoring | 🟢 LOW |

**Action**: Move to `archive/reference/` folder

---

### 📦 KEEP AS REFERENCE (Do Not Delete)

| File | Lines | Reason | Status |
|------|-------|--------|--------|
| `reference/LiveProctoringDashboard.tsx` | 692 | UI patterns for grid view + expand view | 🟡 REFERENCE |

**Action**: Rename to `REFERENCE_LiveProctoringDashboard.tsx`

---

### ✅ KEEP (Production Files)

| File | Lines | Status |
|------|-------|--------|
| `universal-proctoring/live/CandidateLiveService.ts` | 544 | ✅ Production ready (needs minor updates) |
| `universal-proctoring/live/AdminLiveService.ts` | 735 | ✅ Production ready (no changes needed) |
| `universal-proctoring/live/types.ts` | ~200 | ✅ Production ready |
| `universal-proctoring/live/utils.ts` | 302 | ✅ Production ready |
| `universal-proctoring/live/index.ts` | ~50 | ✅ Production ready |

---

## 9. Refactor Checklist

### Phase 1: Camera Stream Preservation (HIGH PRIORITY) 🔴

**Objective**: Store camera stream globally, eliminate permission re-prompts

**Tasks**:
- [ ] **Task 1.1**: Update pre-check camera check
  - [ ] File: `precheck/[assessmentId]/[token]/index.tsx`
  - [ ] Line: ~440-450
  - [ ] Change: Remove `stream.getTracks().forEach(track => track.stop())`
  - [ ] Add: `(window as any).__cameraStream = stream;`
  - [ ] Verify: Stream kept alive after verification

- [ ] **Task 1.2**: Update UniversalProctoringService
  - [ ] File: `UniversalProctoringService.ts`
  - [ ] Line: ~200-210
  - [ ] Add: Check `window.__cameraStream` before `getUserMedia()`
  - [ ] Fallback: Only if global stream not available
  - [ ] Log: "Reusing camera from pre-check" when successful

- [ ] **Task 1.3**: Update CandidateLiveService
  - [ ] File: `CandidateLiveService.ts`
  - [ ] Line: ~130-141
  - [ ] Add: Check `window.__cameraStream` if no existing stream
  - [ ] Remove: Fallback `getUserMedia()` call
  - [ ] Error: Throw error if no stream available

- [ ] **Task 1.4**: Add TypeScript declarations
  - [ ] File: `types/window.d.ts` (create if needed)
  - [ ] Add: `__cameraStream?: MediaStream;`
  - [ ] Add: `__screenStream?: MediaStream;`

- [ ] **Task 1.5**: Test all scenarios
  - [ ] AI-only mode: No camera popup after start
  - [ ] Live-only mode: No camera popup after start
  - [ ] AI+Live mode: No camera popup after start
  - [ ] Verify: Only 1 camera popup in pre-check

---

### Phase 2: Lazy WebRTC Connection (HIGH PRIORITY) 🔴

**Objective**: Candidate waits for admin before starting WebRTC

**Tasks**:
- [ ] **Task 2.1**: Add session registration endpoint (backend)
  - [ ] Endpoint: `POST /api/live-proctoring/session`
  - [ ] Body: `{ candidate_id, assessment_id, status: "ready" }`
  - [ ] Response: `{ session_id }`
  - [ ] Database: Store session with "ready" status

- [ ] **Task 2.2**: Add admin connection signal (backend)
  - [ ] WebSocket: Add message type `"admin_connected"`
  - [ ] When: Admin opens dashboard
  - [ ] Send to: All candidates with "ready" status
  - [ ] Payload: `{ type: "admin_connected", session_id }`

- [ ] **Task 2.3**: Update take pages - Remove auto-start
  - [ ] Files: All 4 take pages (assessment, DSA, AIML, custom MCQ)
  - [ ] Remove: Auto-start useEffect for `CandidateLiveService`
  - [ ] Add: Session registration logic
  - [ ] Add: WebSocket listener for admin signal
  - [ ] Add: Lazy start function

- [ ] **Task 2.4**: Implement lazy connection
  - [ ] Register session on component mount
  - [ ] Listen for `admin_connected` message
  - [ ] Start `CandidateLiveService` ONLY when signaled
  - [ ] Use existing camera/screen streams

- [ ] **Task 2.5**: Test lazy connection
  - [ ] Candidate starts test
  - [ ] Verify: No WebRTC connection created yet
  - [ ] Admin opens dashboard
  - [ ] Verify: WebRTC connection starts immediately
  - [ ] Verify: Streams received by admin

---

### Phase 3: Admin Dashboard UI (MEDIUM PRIORITY) 🟠

**Objective**: Create admin dashboard with grid and expanded views

**Tasks**:
- [ ] **Task 3.1**: Create dashboard page
  - [ ] File: `pages/assessments/[id]/live-dashboard.tsx` (NEW)
  - [ ] Route: `/assessments/[id]/live-dashboard`
  - [ ] Auth: Require admin role
  - [ ] Layout: Full screen, no sidebar

- [ ] **Task 3.2**: Create GridView component
  - [ ] File: `components/live/GridView.tsx` (NEW)
  - [ ] Layout: 2x2, 3x3, or 4x4 grid based on count
  - [ ] Each card: Candidate name, webcam, screen, status
  - [ ] Action: Expand button

- [ ] **Task 3.3**: Create ExpandedView component
  - [ ] File: `components/live/ExpandedView.tsx` (NEW)
  - [ ] Layout: Screen primary (full), webcam PiP (corner)
  - [ ] Action: Back to grid button
  - [ ] Info: Candidate name, status, duration

- [ ] **Task 3.4**: Create CandidateCard component
  - [ ] File: `components/live/CandidateCard.tsx` (NEW)
  - [ ] Display: Webcam + screen thumbnails
  - [ ] Status: Connection indicator (green/yellow/red)
  - [ ] Actions: Expand, refresh

- [ ] **Task 3.5**: Integrate AdminLiveService
  - [ ] Import: `AdminLiveService` from universal-proctoring
  - [ ] Start: On dashboard mount
  - [ ] Callbacks: Handle stream updates
  - [ ] Cleanup: On dashboard unmount

- [ ] **Task 3.6**: Add navigation link
  - [ ] Add: Link in assessment analytics page
  - [ ] Label: "Live Proctoring Dashboard"
  - [ ] Condition: Show only if live proctoring enabled

- [ ] **Task 3.7**: Test dashboard
  - [ ] Open with 1 candidate
  - [ ] Open with 12 candidates
  - [ ] Test expand/collapse
  - [ ] Test close/reopen

---

### Phase 4: Identity Verify Camera Reuse (MEDIUM PRIORITY) 🟠

**Objective**: Reuse camera stream for photo capture

**Tasks**:
- [ ] **Task 4.1**: Update IdentityVerification component
  - [ ] File: `proctoring/components/IdentityVerification.tsx`
  - [ ] Add: `existingCameraStream?: MediaStream` prop
  - [ ] Check: If prop provided, use it
  - [ ] Remove: Internal `getUserMedia()` call when prop exists

- [ ] **Task 4.2**: Update identity-verify page
  - [ ] File: `assessment/[id]/[token]/identity-verify.tsx`
  - [ ] Pass: `window.__cameraStream` to IdentityVerification
  - [ ] Verify: No new camera permission request

- [ ] **Task 4.3**: Test photo capture
  - [ ] Pre-check: Camera granted
  - [ ] Identity: Photo captured
  - [ ] Verify: Only 1 camera popup total

---

### Phase 5: Backend Verification (LOW PRIORITY) 🟢

**Objective**: Confirm backend doesn't relay video (P2P only)

**Tasks**:
- [ ] **Task 5.1**: Review WebRTC backend code
  - [ ] File: Backend WebRTC endpoints
  - [ ] Verify: Backend only relays signaling (SDP, ICE)
  - [ ] Verify: Backend does NOT relay video data

- [ ] **Task 5.2**: Check TURN server configuration
  - [ ] Verify: TURN server only for NAT traversal
  - [ ] Verify: Direct P2P preferred
  - [ ] Document: TURN server fallback behavior

- [ ] **Task 5.3**: Monitor bandwidth usage
  - [ ] Test: Admin receives streams from 10 candidates
  - [ ] Measure: Backend bandwidth (should be minimal)
  - [ ] Measure: Admin bandwidth (should match 10 streams)
  - [ ] Confirm: P2P working correctly

---

### Phase 6: Testing & Documentation (LOW PRIORITY) 🟢

**Objective**: Comprehensive testing and documentation

**Tasks**:
- [ ] **Task 6.1**: Create test scenarios document
  - [ ] Scenario 1: AI-only mode
  - [ ] Scenario 2: Live-only mode
  - [ ] Scenario 3: AI+Live mode
  - [ ] Scenario 4: Admin connect/disconnect/reconnect
  - [ ] Scenario 5: Multiple candidates (1, 5, 10, 20)

- [ ] **Task 6.2**: Test permission flow
  - [ ] Pre-check: Camera + mic
  - [ ] Identity: Screen share
  - [ ] Take: No new popups
  - [ ] Document: Screenshot each step

- [ ] **Task 6.3**: Test WebRTC lifecycle
  - [ ] Candidate waits for admin
  - [ ] Admin connects
  - [ ] Streams established
  - [ ] Admin disconnects
  - [ ] Admin reconnects

- [ ] **Task 6.4**: Create admin user guide
  - [ ] How to access dashboard
  - [ ] How to use grid view
  - [ ] How to expand candidate
  - [ ] How to interpret status indicators

- [ ] **Task 6.5**: Update README
  - [ ] Live Proctoring architecture
  - [ ] Permission flow
  - [ ] WebRTC lifecycle
  - [ ] Admin dashboard usage

---

### Phase 7: Cleanup (LOW PRIORITY) 🟢

**Objective**: Remove legacy files

**Tasks**:
- [ ] **Task 7.1**: Archive legacy files
  - [ ] Move: `reference/useLiveProctoring.ts` → `archive/`
  - [ ] Move: `reference/useMultiLiveProctorAdmin.ts` → `archive/`
  - [ ] Move: `reference/take.tsx` → `archive/`
  - [ ] Move: `reference/useFaceMesh.ts` → `archive/`

- [ ] **Task 7.2**: Rename reference dashboard
  - [ ] Rename: `LiveProctoringDashboard.tsx` → `REFERENCE_LiveProctoringDashboard.tsx`
  - [ ] Add: Comment explaining it's reference only

- [ ] **Task 7.3**: Create archive README
  - [ ] Document: Why files were archived
  - [ ] Document: What replaced them
  - [ ] Document: Archive date

- [ ] **Task 7.4**: Verify no imports
  - [ ] Search: All archived files
  - [ ] Confirm: No active imports
  - [ ] Test: Build succeeds

---

## 10. Risk Assessment

### 🔴 HIGH RISK (Requires Careful Testing)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Camera stream not preserved correctly** | User sees permission popup after start | Test all 3 scenarios extensively |
| **WebRTC connection fails in lazy mode** | Admin sees no streams | Implement robust error handling |
| **Stream tracks stopped accidentally** | Video freezes mid-test | Never call `track.stop()` on global streams |
| **Multiple candidates overwhelm admin** | Dashboard lags with 20+ candidates | Test with 20 concurrent connections |

---

### 🟠 MEDIUM RISK (Monitor Closely)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Backend WebSocket disconnects** | Lost signaling, no reconnection | Implement WebSocket reconnection |
| **ICE candidate exchange timeout** | Connection never establishes | Add timeout + retry logic |
| **Browser compatibility issues** | Safari, Firefox behave differently | Test on all major browsers |
| **NAT traversal fails** | P2P connection impossible | Ensure TURN server configured |

---

### 🟢 LOW RISK (Standard Testing)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Grid view performance** | Slow rendering with many candidates | Use React virtualization if needed |
| **Admin closes mid-connection** | Candidate confused | Clear UI feedback |
| **Candidate submits during streaming** | Abrupt disconnect | Graceful cleanup on unmount |

---

## 11. Success Criteria

### Phase 1 Success Criteria

✅ **Camera Permission**:
- [ ] Only 1 camera popup in pre-check
- [ ] 0 camera popups after "Start Assessment"
- [ ] Stream reused by AI Proctoring
- [ ] Stream reused by Live Proctoring
- [ ] Works in all 3 scenarios (AI-only, Live-only, AI+Live)

### Phase 2 Success Criteria

✅ **Lazy WebRTC**:
- [ ] Candidate does NOT start WebRTC automatically
- [ ] WebRTC starts ONLY when admin opens dashboard
- [ ] Streams received by admin within 5 seconds
- [ ] Multiple candidates connect simultaneously
- [ ] No bandwidth wasted before admin connects

### Phase 3 Success Criteria

✅ **Admin Dashboard**:
- [ ] Grid view displays all active candidates
- [ ] Expanded view shows screen + webcam PiP
- [ ] Connection status indicators accurate
- [ ] Dashboard can be closed and reopened
- [ ] Performance acceptable with 20+ candidates

---

## 12. Implementation Timeline

### Week 1: Camera Preservation (Phase 1)
- Day 1-2: Implement camera storage in pre-check
- Day 3-4: Update Universal Proctoring to reuse
- Day 5: Update Live Proctoring to reuse
- Weekend: Testing + bug fixes

### Week 2: Lazy WebRTC (Phase 2)
- Day 1-2: Backend session registration + signaling
- Day 3-4: Update take pages for lazy connection
- Day 5: Testing + bug fixes
- Weekend: Integration testing

### Week 3: Admin Dashboard (Phase 3)
- Day 1-2: Dashboard page + routing
- Day 3-4: Grid view + expanded view components
- Day 5: AdminLiveService integration
- Weekend: UI polish + testing

### Week 4: Testing & Cleanup (Phases 4-7)
- Day 1-2: Comprehensive testing
- Day 3: Documentation
- Day 4: Cleanup + archive files
- Day 5: Final review
- Weekend: Deploy to staging

---

## 13. Appendix: Key Code Snippets

### A. Global Stream Storage

```typescript
// Window interface extension
declare global {
  interface Window {
    __cameraStream?: MediaStream;
    __screenStream?: MediaStream;
  }
}

// Pre-check: Store camera
window.__cameraStream = stream;

// Universal Proctoring: Reuse camera
const stream = window.__cameraStream || await getUserMedia(...);

// Live Proctoring: Reuse camera
const stream = window.__cameraStream;
```

---

### B. Lazy WebRTC Connection

```typescript
// Take page: Register session
useEffect(() => {
  if (liveProctoringEnabled) {
    registerLiveSession({ candidate_id, assessment_id, status: 'ready' });
    
    // Listen for admin signal
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'admin_connected') {
        startLiveProctoring(); // ← LAZY START
      }
    };
  }
}, [liveProctoringEnabled]);
```

---

### C. Admin Dashboard Integration

```typescript
// Dashboard page
const service = new AdminLiveService({ assessmentId, adminId });

service.startMonitoring({
  onStreamAdded: (sessionId, webcamStream, screenStream) => {
    setCandidates(prev => prev.map(c => 
      c.sessionId === sessionId 
        ? { ...c, webcamStream, screenStream }
        : c
    ));
  },
});
```

---

## 14. Final Checklist

### Pre-Implementation Verification

- [ ] Read entire document
- [ ] Understand current issues
- [ ] Understand proposed architecture
- [ ] Review all affected files
- [ ] Confirm backend API compatibility
- [ ] Verify browser compatibility requirements

### Implementation Verification

- [ ] Phase 1: Camera preservation complete
- [ ] Phase 2: Lazy WebRTC complete
- [ ] Phase 3: Admin dashboard complete
- [ ] Phase 4: Identity camera reuse complete
- [ ] All tests passing
- [ ] Documentation updated

### Deployment Verification

- [ ] Staging deployment successful
- [ ] Performance testing complete
- [ ] Security review complete
- [ ] Admin training complete
- [ ] Rollback plan documented

---

**Document Status**: READY FOR REVIEW  
**Next Step**: Approve design → Begin Phase 1 implementation  
**Estimated Total Effort**: 4 weeks (1 developer)

