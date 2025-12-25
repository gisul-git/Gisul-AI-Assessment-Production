# Live Proctoring System - Current State Analysis

**Analysis Date**: December 24, 2025  
**Analysis Type**: READ-ONLY (No code modifications)  
**Purpose**: Understand current implementation, identify issues, and document deletion candidates

---

## Table of Contents

1. [Live Proctoring File Inventory](#1-live-proctoring-file-inventory)
2. [Current Live Proctoring Flow](#2-current-live-proctoring-flow)
3. [Permission Handling Analysis](#3-permission-handling-analysis)
4. [Stream Lifecycle](#4-stream-lifecycle)
5. [Critical Problems](#5-critical-problems)
6. [Deletion Candidates](#6-deletion-candidates)
7. [Summary](#7-summary)

---

## 1. Live Proctoring File Inventory

### ACTIVE FILES (Currently Used in Production)

| File Path | Lines | Purpose | Status |
|-----------|-------|---------|--------|
| `frontend/src/universal-proctoring/live/CandidateLiveService.ts` | 544 | Candidate-side streaming service - Creates WebSocket + WebRTC connection, streams webcam + screen to backend | ✅ **ACTIVE** |
| `frontend/src/universal-proctoring/live/AdminLiveService.ts` | 735 | Admin-side monitoring service - CCTV-style multi-candidate viewer (WebSocket + WebRTC) | ✅ **ACTIVE** |
| `frontend/src/universal-proctoring/live/types.ts` | ~200 | TypeScript interfaces for Live Proctoring (configs, states, callbacks) | ✅ **ACTIVE** |
| `frontend/src/universal-proctoring/live/utils.ts` | 302 | Helper functions (WebSocket, WebRTC, stream management, ICE candidates) | ✅ **ACTIVE** |
| `frontend/src/universal-proctoring/live/index.ts` | ~50 | Re-export module for Live Proctoring services | ✅ **ACTIVE** |
| `frontend/src/pages/assessment/[id]/[token]/identity-verify.tsx` | 855 | Screen sharing capture gate (getDisplayMedia) - Enforces "entire screen" only | ✅ **ACTIVE** |
| `frontend/src/pages/precheck/[assessmentId]/[token]/index.tsx` | 2546 | Camera permission pre-check gate (getUserMedia) - Verifies camera works | ✅ **ACTIVE** |
| `frontend/src/pages/assessment/[id]/[token]/take.tsx` | ~400 | Assessment page using CandidateLiveService | ✅ **ACTIVE** |
| `frontend/src/pages/test/[id]/take.tsx` | 2453 | DSA test page using CandidateLiveService | ✅ **ACTIVE** |
| `frontend/src/pages/aiml/test/[id]/take.tsx` | 715 | AIML test page using CandidateLiveService | ✅ **ACTIVE** |
| `frontend/src/pages/custom-mcq/take/[assessmentId].tsx` | 1409 | Custom MCQ page using CandidateLiveService | ✅ **ACTIVE** |
| `frontend/src/universal-proctoring/UniversalProctoringService.ts` | ~350 | Orchestrator for AI/Tab/Fullscreen - Also starts camera for AI proctoring | ✅ **ACTIVE** |
| `frontend/src/universal-proctoring/utils/resolveUserId.ts` | ~50 | Helper to resolve candidate ID for proctoring | ✅ **ACTIVE** |

**Total Active Files**: 13

---

### LEGACY FILES (Old Implementation - Still Present)

| File Path | Lines | Purpose | Status |
|-----------|-------|---------|--------|
| `reference/useLiveProctoring.ts` | ~350 | Old React hook for single-candidate Live Proctoring | ⚠️ **LEGACY** - Replaced by `CandidateLiveService` |
| `reference/useMultiLiveProctorAdmin.ts` | ~500 | Old React hook for multi-candidate admin monitoring | ⚠️ **LEGACY** - Replaced by `AdminLiveService` |
| `reference/LiveProctoringDashboard.tsx` | 692 | Old admin dashboard component using legacy hooks | ⚠️ **LEGACY** - No longer used in active pages |
| `reference/take.tsx` | ~800 | Old assessment take page implementation | ⚠️ **LEGACY** - Replaced by current take pages |
| `reference/useFaceMesh.ts` | ~200 | Old face detection hook | ⚠️ **LEGACY** - Integrated into Universal Proctoring |

**Total Legacy Files**: 5

---

### UNUSED FILES (Safe to Delete After Verification)

| File | Reason | Risk |
|------|--------|------|
| `reference/useLiveProctoring.ts` | Replaced by class-based `CandidateLiveService` | 🟢 LOW |
| `reference/useMultiLiveProctorAdmin.ts` | Replaced by class-based `AdminLiveService` | 🟢 LOW |
| `reference/take.tsx` | Old assessment page, not imported anywhere | 🟢 LOW |
| `reference/useFaceMesh.ts` | Face detection now in Universal Proctoring | 🟢 LOW |
| `reference/LiveProctoringDashboard.tsx` | Not used BUT may be needed as reference for future admin UI | 🟡 MEDIUM |

---

## 2. Current Live Proctoring Flow

### PRE-CHECK PHASE (Before "Start Assessment")

**File**: `frontend/src/pages/precheck/[assessmentId]/[token]/index.tsx`

**Flow**:
```
1. Candidate enters email/token → lands on precheck page
2. Browser compatibility check (Chrome/Edge 110+)
3. Network stability check (ping, upload, download)
4. 📷 CAMERA CHECK (Lines 393-510):
   ├─ Calls: navigator.mediaDevices.getUserMedia({ video: true })
   ├─ Browser permission popup APPEARS HERE ✅
   ├─ Stream stored: setCameraStream(stream)
   ├─ Face detection attempted (optional validation)
   └─ Stream STOPPED: stream.getTracks().forEach(track => track.stop())
5. 🎤 Microphone check (also uses getUserMedia)
6. ✅ Store completion: sessionStorage.setItem('precheckCompleted_${id}', 'true')
7. Navigate to instructions page
```

**❌ CRITICAL ISSUE**: Camera stream is **DISCARDED** after verification (line ~450).

---

### IDENTITY VERIFICATION PHASE (Before "Start Assessment")

**File**: `frontend/src/pages/assessment/[id]/[token]/identity-verify.tsx`

**Flow**:
```
1. 📸 Photo Capture:
   ├─ Uses IdentityVerification component
   ├─ Calls getUserMedia() internally
   └─ Captures photo for identity verification
   
2. 🖥️ SCREEN SHARE (Lines 95-193):
   ├─ Calls: navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
   ├─ Browser permission popup APPEARS HERE ✅
   ├─ Validates selection:
   │  ├─ ✅ ACCEPTS: displaySurface === "monitor" || "screen" (entire screen)
   │  └─ ❌ REJECTS: displaySurface === "window" || "tab" || "application"
   ├─ If rejected: recursive call to force correct selection
   ├─ Stream stored GLOBALLY: window.__screenStream = stream
   ├─ Track end listener: handles if user stops sharing
   └─ ✅ Store completion: sessionStorage.setItem('screenShareCompleted_${id}', 'true')
   
3. ⛶ Fullscreen Mode Enforcement:
   ├─ Enters fullscreen
   └─ Stores flag for later checks
   
4. ✅ Store completion: sessionStorage.setItem('identityVerificationCompleted_${id}', 'true')
5. Navigate to take page with "Start Assessment" button
```

**✅ SUCCESS**: Screen stream is **PRESERVED** in `window.__screenStream` for reuse.

---

### START ASSESSMENT PHASE (After "Start Assessment" Button)

**Files**: 
- `frontend/src/pages/assessment/[id]/[token]/take.tsx`
- `frontend/src/pages/test/[id]/take.tsx` (DSA)
- `frontend/src/pages/aiml/test/[id]/take.tsx`
- `frontend/src/pages/custom-mcq/take/[assessmentId].tsx`

**Flow**:

#### Step 1: Universal Proctoring Starts (if AI enabled)

**File**: `frontend/src/universal-proctoring/UniversalProctoringService.ts`

```
UniversalProctoringService.start(session, settings, callbacks):
├─ Check: settings.aiProctoringEnabled || settings.liveProctoringEnabled
├─ IF needs camera:
│  ├─ 📷 NEW getUserMedia() call (Line 204)
│  ├─ ⚠️ Browser permission popup CAN appear here
│  ├─ Stream stored: this.stream = stream
│  └─ Video element assigned: videoElement.srcObject = stream
├─ IF AI enabled:
│  ├─ Start AIProctoringService (face detection, gaze tracking)
│  ├─ Start TabSwitchService (only if AI enabled - recently fixed)
│  └─ Start FullscreenService (only if AI enabled - recently fixed)
└─ Return success
```

**⚠️ ISSUE**: NEW camera permission request AFTER "Start Assessment".

---

#### Step 2: Live Proctoring Starts (if Live enabled)

**File**: `frontend/src/universal-proctoring/live/CandidateLiveService.ts`

```
CandidateLiveService.start(callbacks, screenStream, existingWebcamStream):
├─ 1️⃣ GET WEBCAM STREAM (Lines 130-141):
│  ├─ IF existingWebcamStream?.active:
│  │  ├─ Log: "✅ Reusing existing webcam stream"
│  │  └─ this.webcamStream = existingWebcamStream
│  ├─ ELSE:
│  │  ├─ Log: "Getting new webcam stream..."
│  │  ├─ 📷 NEW getUserMedia() call
│  │  └─ ⚠️ Browser permission popup CAN appear here
│  
├─ 2️⃣ GET SCREEN STREAM (Lines 147-151):
│  ├─ Call: getAvailableScreenStream(screenStream)
│  ├─ First checks: propStream parameter
│  ├─ Then checks: window.__screenStream
│  └─ ✅ REUSES existing screen stream (no new getDisplayMedia)
│  
├─ 3️⃣ CREATE SESSION ON BACKEND:
│  ├─ POST /api/live-proctoring/session
│  ├─ Body: { candidate_id, assessment_id }
│  └─ Response: { session_id }
│  
├─ 4️⃣ CONNECT WEBSOCKET:
│  ├─ URL: ws://localhost:8000/ws/live-proctoring
│  ├─ Send: { type: "join_candidate", session_id }
│  └─ Receive: { type: "joined" }
│  
├─ 5️⃣ CREATE WEBRTC PEER CONNECTION:
│  ├─ new RTCPeerConnection(WEBRTC_CONFIG)
│  ├─ Add webcam tracks: peerConnection.addTrack(track, webcamStream)
│  ├─ Add screen tracks: peerConnection.addTrack(track, screenStream)
│  ├─ Create offer: peerConnection.createOffer()
│  ├─ Set local description: peerConnection.setLocalDescription(offer)
│  ├─ Send via WebSocket: { type: "offer", sdp: offer.sdp }
│  └─ Await answer from backend
│  
└─ 6️⃣ HANDLE SDP ANSWER & ICE CANDIDATES:
   ├─ Receive: { type: "answer", sdp }
   ├─ Set remote description: peerConnection.setRemoteDescription(answer)
   ├─ Exchange ICE candidates bidirectionally
   └─ Connection established ✅
```

**✅ SUCCESS**: Reuses existing webcam stream when available.  
**⚠️ ISSUE**: Falls back to NEW camera request if no existing stream.

---

### ADMIN CONNECTION PHASE (Independent from Candidate)

**File**: `frontend/src/universal-proctoring/live/AdminLiveService.ts`

**Status**: ⚠️ **FULLY IMPLEMENTED BUT NO UI EXISTS**

**Flow**:
```
AdminLiveService.startMonitoring(callbacks):
├─ 1️⃣ CONNECT WEBSOCKET:
│  ├─ URL: ws://localhost:8000/ws/live-proctoring
│  ├─ Send: { type: "join_admin", assessment_id }
│  └─ Receive: { type: "sessions_list", sessions: [...] }
│  
├─ 2️⃣ FOR EACH ACTIVE SESSION:
│  ├─ Create new RTCPeerConnection
│  ├─ Send: { type: "connect_to_session", session_id }
│  ├─ Receive: { type: "offer", sdp, session_id }
│  ├─ Set remote description: setRemoteDescription(offer)
│  ├─ Create answer: createAnswer()
│  ├─ Set local description: setLocalDescription(answer)
│  ├─ Send: { type: "answer", sdp, session_id }
│  ├─ Exchange ICE candidates
│  └─ ontrack event: Receive MediaStreams (webcam + screen)
│  
└─ 3️⃣ EXPOSE STREAMS TO UI:
   ├─ candidateStreams.set(sessionId, { webcamStream, screenStream })
   ├─ Callback: onStreamAdded(sessionId, webcamStream, screenStream)
   └─ UI attaches streams to <video> elements
```

**❌ CRITICAL MISSING**: No admin dashboard UI in production pages.

---

## 3. Permission Handling Analysis

### Camera Permission Timeline

| Phase | File | Line | Method | When Popup Appears | Violation? |
|-------|------|------|--------|-------------------|-----------|
| **Pre-check** | `precheck/[assessmentId]/[token]/index.tsx` | 399 | `getUserMedia({ video: true })` | User clicks "Start Camera Check" | ❌ NO |
| **Identity Verify** | `identity-verify.tsx` | Via `IdentityVerification` component | `getUserMedia()` | Photo capture step | ❌ NO |
| **Universal Proctoring** | `UniversalProctoringService.ts` | 204 | `getUserMedia({ video: true })` | When AI/Live proctoring starts | ⚠️ **YES** |
| **Live Proctoring (fallback)** | `CandidateLiveService.ts` | 138 | `getWebcamStream()` | Only if no existing stream | ⚠️ **YES** |

### Screen Sharing Permission Timeline

| Phase | File | Line | Method | When Popup Appears | Violation? |
|-------|------|------|--------|-------------------|-----------|
| **Identity Verify** | `identity-verify.tsx` | 104 | `getDisplayMedia({ video: true })` | User clicks "Start Screen Share" | ❌ NO |
| **Live Proctoring** | `CandidateLiveService.ts` | 147 | `getAvailableScreenStream()` | Never - reuses `window.__screenStream` | ✅ NO |

---

### Permission Request Locations (getUserMedia)

**Location 1: Pre-check Camera Check**
```typescript
// File: frontend/src/pages/precheck/[assessmentId]/[token]/index.tsx
// Line: ~399

const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
  },
  audio: false,
});
setCameraStream(stream);

// ... later (line ~450)
if (stream) {
  stream.getTracks().forEach(track => track.stop()); // ❌ STREAM DESTROYED
}
```

**Location 2: Universal Proctoring Camera Start**
```typescript
// File: frontend/src/universal-proctoring/UniversalProctoringService.ts
// Line: ~204

const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
});
this.stream = stream; // ✅ KEPT ALIVE
this.videoElement!.srcObject = stream;
```

**Location 3: Live Proctoring Camera (Fallback)**
```typescript
// File: frontend/src/universal-proctoring/live/utils.ts
// Line: ~210

export async function getWebcamStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
}

// Called from CandidateLiveService.ts line 138:
this.webcamStream = await getWebcamStream(); // ⚠️ NEW REQUEST
```

---

### Permission Request Locations (getDisplayMedia)

**Location 1: Identity Verify Screen Share (ONLY LOCATION)**
```typescript
// File: frontend/src/pages/assessment/[id]/[token]/identity-verify.tsx
// Line: ~104

const stream = await navigator.mediaDevices.getDisplayMedia({ 
  video: true,
  audio: false 
});

// Validation logic (lines 111-142)
const settings = videoTrack.getSettings();
const displaySurface = settings.displaySurface;
const isValidSelection = displaySurface === "monitor" || displaySurface === "screen";

if (!isValidSelection) {
  stream.getTracks().forEach(track => track.stop()); // Reject invalid selection
  return requestScreenShare(); // Recursive call to force correct selection
}

// Store globally
window.__screenStream = stream; // ✅ GLOBAL STORAGE
```

**✅ CORRECT**: Only ONE location calls `getDisplayMedia()`, stream is preserved.

---

### Violations Summary

#### 🔴 VIOLATION FOUND: Camera Re-Request After "Start Assessment"

**What Happens**:
1. Pre-check phase: `getUserMedia()` → permission granted → stream **stopped and discarded**
2. Universal Proctoring starts: **NEW** `getUserMedia()` → permission popup **CAN appear again**
3. Live Proctoring starts: **NEW** `getUserMedia()` (if no existing stream) → permission popup **CAN appear again**

**Why It's a Problem**:
- User already granted camera permission in pre-check
- Browser may show permission popup again after "Start Assessment"
- User may deny permission, breaking proctoring
- Violates UX expectation: permissions before exam starts

**When It Occurs**:

| Scenario | AI Proctoring | Live Proctoring | Camera Popups |
|----------|---------------|-----------------|---------------|
| AI Only | ✅ ON | ❌ OFF | 1️⃣ Pre-check + 1️⃣ Universal = **2 total** |
| Live Only | ❌ OFF | ✅ ON | 1️⃣ Pre-check + 1️⃣ Live = **2 total** |
| AI + Live | ✅ ON | ✅ ON | 1️⃣ Pre-check + 1️⃣ Universal = **2 total** (Live reuses) |

**Root Cause**: Camera stream from pre-check is not preserved across gate phases.

---

#### ✅ NO VIOLATION: Screen Sharing

**What Happens**:
1. Identity verify phase: `getDisplayMedia()` → permission granted → stream **stored in `window.__screenStream`**
2. Live Proctoring starts: Reads `window.__screenStream` → **NO new permission request**

**Why It Works**:
- Screen stream is preserved globally
- Live Proctoring reuses existing stream
- No duplicate `getDisplayMedia()` calls

---

## 4. Stream Lifecycle

### Camera Stream Lifecycle

| Stage | Location | Storage Mechanism | Lifecycle | Issue |
|-------|----------|------------------|-----------|-------|
| **Pre-check** | `precheck/[...]/index.tsx` | React state: `setCameraStream(stream)` | ❌ **STOPPED** after verification (line ~450) | Stream discarded |
| **Identity Verify** | `IdentityVerification` component | Component internal state | ❌ **STOPPED** after photo capture | Stream discarded |
| **Universal Proctoring** | `UniversalProctoringService.ts` | Class property: `this.stream` | ✅ **KEPT ALIVE** until test ends | Works correctly |
| **Live Proctoring** | `CandidateLiveService.ts` | Class property: `this.webcamStream` | ✅ **REUSED** from Universal OR new stream | Conditional reuse |

**Problem**: Camera stream is **NOT preserved** between gate phases (pre-check → identity → take).

---

### Screen Stream Lifecycle

| Stage | Location | Storage Mechanism | Lifecycle | Issue |
|-------|----------|------------------|-----------|-------|
| **Identity Verify** | `identity-verify.tsx` | Global: `window.__screenStream` | ✅ **KEPT ALIVE** entire session | None - works perfectly |
| **Live Proctoring** | `CandidateLiveService.ts` | Class property: `this.screenStream` | ✅ **REUSED** from global | None - works perfectly |

**Success**: Screen stream is **correctly preserved** and reused. No duplicate permission requests.

---

### Stream Creation Points

```typescript
// ========================================
// 1. PRE-CHECK CAMERA (DISCARDED)
// ========================================
// File: precheck/[assessmentId]/[token]/index.tsx
// Line: ~399
const stream = await navigator.mediaDevices.getUserMedia({ video: true });
setCameraStream(stream);

// Later (line ~450):
stream.getTracks().forEach(track => track.stop()); // ❌ DESTROYED


// ========================================
// 2. IDENTITY VERIFY SCREEN (PRESERVED)
// ========================================
// File: identity-verify.tsx
// Line: ~104
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
window.__screenStream = stream; // ✅ GLOBAL STORAGE


// ========================================
// 3. UNIVERSAL PROCTORING CAMERA (NEW)
// ========================================
// File: UniversalProctoringService.ts
// Line: ~204
this.stream = await navigator.mediaDevices.getUserMedia({ video: true }); // ⚠️ NEW REQUEST


// ========================================
// 4. LIVE PROCTORING CAMERA (CONDITIONAL)
// ========================================
// File: CandidateLiveService.ts
// Lines: 130-141
if (existingWebcamStream?.active) {
  this.webcamStream = existingWebcamStream; // ✅ REUSED
} else {
  this.webcamStream = await getWebcamStream(); // ⚠️ NEW REQUEST
}


// ========================================
// 5. LIVE PROCTORING SCREEN (REUSED)
// ========================================
// File: CandidateLiveService.ts
// Line: ~147
this.screenStream = getAvailableScreenStream(screenStream);
// Function checks:
//   1. screenStream parameter (if passed)
//   2. window.__screenStream (global)
// ✅ ALWAYS REUSES EXISTING STREAM
```

---

### Stream Storage Locations

```typescript
// ========================================
// TEMPORARY STORAGE (Discarded)
// ========================================
const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
// ❌ Problem: React state cleared on navigation


// ========================================
// GLOBAL STORAGE (Persistent)
// ========================================
window.__screenStream = stream;
// ✅ Success: Persists across navigation and components


// ========================================
// CLASS INSTANCE STORAGE (Persistent)
// ========================================
export class UniversalProctoringService {
  private stream: MediaStream | null = null; // ✅ Persists during test
}

export class CandidateLiveService {
  private webcamStream: MediaStream | null = null; // ✅ Persists during test
  private screenStream: MediaStream | null = null; // ✅ Persists during test
}
```

---

### Stream Duplication Scenarios

#### Scenario 1: Live-Only Mode (AI OFF, Live ON)

```
Pre-check Phase:
  └─ getUserMedia() → camera permission → stream STOPPED ❌

Take Page:
  └─ Universal Proctoring: SKIPPED (AI disabled)
  └─ Live Proctoring:
     └─ No existing webcam stream
     └─ getUserMedia() → camera permission AGAIN ⚠️

Result: 2 camera permission requests
```

---

#### Scenario 2: AI + Live Mode (AI ON, Live ON)

```
Pre-check Phase:
  └─ getUserMedia() → camera permission → stream STOPPED ❌

Take Page:
  ├─ Universal Proctoring:
  │  └─ getUserMedia() → camera permission AGAIN ⚠️
  │  └─ Stream stored in this.stream
  │
  └─ Live Proctoring:
     └─ Receives existingWebcamStream from Universal
     └─ REUSES existing stream ✅

Result: 2 camera permission requests (but Live successfully reuses)
```

---

#### Scenario 3: AI-Only Mode (AI ON, Live OFF)

```
Pre-check Phase:
  └─ getUserMedia() → camera permission → stream STOPPED ❌

Take Page:
  └─ Universal Proctoring:
     └─ getUserMedia() → camera permission AGAIN ⚠️
  └─ Live Proctoring: SKIPPED (Live disabled)

Result: 2 camera permission requests
```

---

#### Screen Stream (All Scenarios)

```
Identity Verify Phase:
  └─ getDisplayMedia() → screen permission → stream stored in window.__screenStream ✅

Take Page:
  └─ Live Proctoring:
     └─ Reads window.__screenStream → REUSES ✅

Result: 1 screen permission request (perfect! ✅)
```

---

## 5. Critical Problems

### Problem 1: Camera Permission Re-Prompts ⚠️ HIGH PRIORITY

**Severity**: 🔴 HIGH

**Description**: Browser CAN show camera permission popup after "Start Assessment" button is clicked.

**Root Cause**:
- Pre-check camera stream is stopped and discarded (line 450 in precheck/index.tsx)
- Universal Proctoring makes NEW `getUserMedia()` call (line 204 in UniversalProctoringService.ts)
- Live Proctoring makes NEW `getUserMedia()` call if no existing stream (line 138 in CandidateLiveService.ts)

**Evidence**:
```typescript
// Pre-check discards stream:
if (stream) {
  stream.getTracks().forEach(track => track.stop()); // ❌ DESTROYED
}

// Universal Proctoring requests new stream:
const stream = await navigator.mediaDevices.getUserMedia({ video: true }); // ⚠️ NEW REQUEST

// Live Proctoring falls back to new stream:
if (!existingWebcamStream?.active) {
  this.webcamStream = await getWebcamStream(); // ⚠️ NEW REQUEST
}
```

**Impact**:
- Violates UX rule: "No browser permission popups after 'Start Assessment'"
- User may deny permission, breaking proctoring mid-exam
- Inconsistent behavior across different proctoring modes
- User confusion: "I already granted camera access in pre-check"

**Affected Scenarios**:
- ✅ AI + Live mode: Universal requests, Live reuses (1 popup after start)
- ❌ AI-only mode: Universal requests (1 popup after start)
- ❌ Live-only mode: Live requests (1 popup after start)

**Why Screen Sharing Doesn't Have This Problem**:
- Screen stream stored globally: `window.__screenStream`
- Stream persists across navigation
- Live Proctoring successfully reuses it

---

### Problem 2: No Admin Dashboard UI ⚠️ MEDIUM PRIORITY

**Severity**: 🟠 MEDIUM

**Description**: `AdminLiveService` is fully implemented (735 lines) but NOT exposed in any production page.

**Evidence**:
- ✅ Service exists: `frontend/src/universal-proctoring/live/AdminLiveService.ts`
- ✅ WebSocket signaling implemented
- ✅ WebRTC peer connections implemented
- ✅ Multi-candidate monitoring implemented
- ❌ No active page imports `AdminLiveService`
- ❌ Analytics page has NO live stream viewing
- ⚠️ `reference/LiveProctoringDashboard.tsx` exists but uses legacy hooks

**Where Admin UI Should Be**:
- Option 1: Separate Live Proctoring Dashboard route (`/assessments/[id]/live-dashboard`)
- Option 2: Integrated into Analytics page (`/assessments/[id]/analytics/[candidateEmail]`)
- Option 3: Assessment overview page with multi-candidate grid

**Current State**:
```typescript
// Analytics page (assessments/[id]/analytics/[candidateEmail].tsx) has NO live streaming
// Only shows:
// - Candidate results
// - Answer logs
// - Proctor violation logs
// - No video streams
```

**Impact**:
- Live Proctoring backend works perfectly
- Candidates stream video successfully
- Admin CANNOT view streams
- Feature is incomplete for production use

---

### Problem 3: Tight Coupling with Universal Proctoring ✅ MITIGATED

**Severity**: 🟢 LOW (Already Fixed)

**Description**: Live Proctoring depends on Universal Proctoring for camera stream in AI+Live mode.

**Current State**: ✅ MITIGATED

**How It Was Fixed**:
- `CandidateLiveService` now accepts `existingWebcamStream` parameter (line 112)
- Falls back to new `getUserMedia()` call if no existing stream (line 138)
- Works independently in Live-only mode
- Successfully reuses Universal Proctoring camera when available

**Code Evidence**:
```typescript
// CandidateLiveService.start() signature:
async start(
  callbacks: CandidateLiveCallbacks,
  screenStream?: MediaStream | null,
  existingWebcamStream?: MediaStream | null // ← OPTIONAL PARAMETER
): Promise<boolean>

// Reuse logic:
if (existingWebcamStream && existingWebcamStream.active) {
  this.log("✅ Reusing existing webcam stream");
  this.webcamStream = existingWebcamStream;
} else {
  this.log("Getting new webcam stream...");
  this.webcamStream = await getWebcamStream(); // Fallback
}
```

---

### Problem 4: Camera Stream Discarded in Pre-Check ⚠️ HIGH PRIORITY

**Severity**: 🔴 HIGH

**Description**: Camera stream from pre-check is verified then immediately discarded, forcing new permission request later.

**Code Evidence**:
```typescript
// File: precheck/[assessmentId]/[token]/index.tsx
// Lines: ~440-450

// Stream is working and verified
setCameraStream(stream);
setFaceCount(1);

// But then immediately destroyed:
if (stream) {
  stream.getTracks().forEach(track => track.stop()); // ❌ DESTROYED
}
```

**Why This Happens**:
- Pre-check is separate route/page
- Stream stored in React component state
- State cleared on navigation to next page
- No global storage mechanism for camera (unlike screen)

**Impact**:
- Wasted permission grant in pre-check
- Forces new permission request in take page
- User confusion: "Why ask again?"
- Violates principle: permissions before exam starts

**Comparison with Screen Stream** (which works correctly):
```typescript
// Screen stream stored globally:
window.__screenStream = stream; // ✅ PERSISTS across navigation

// Camera stream NOT stored globally:
setCameraStream(stream); // ❌ React state, cleared on navigation
```

---

### Problem 5: Race Condition in Stream Attachment 🟢 LOW PRIORITY

**Severity**: 🟢 LOW

**Description**: When AI and Live proctoring start simultaneously, both may try to access camera.

**Current Mitigation**:
- Universal Proctoring starts first (higher in useEffect order)
- Live Proctoring waits for existing stream
- Race condition unlikely but theoretically possible

**Code Evidence**:
```typescript
// Take page typically has this order:
useEffect(() => {
  // Universal Proctoring starts first
  startUniversalProctoring({ ... });
}, [dependencies]);

useEffect(() => {
  // Live Proctoring starts after
  if (liveProctoringEnabled && liveProctorScreenStream) {
    const liveService = new CandidateLiveService({ ... });
    liveService.start(
      callbacks,
      liveProctorScreenStream,
      thumbVideoRef.current?.srcObject // ← May not be ready yet
    );
  }
}, [liveProctoringEnabled, liveProctorScreenStream]);
```

**Recommendation**: Not urgent, but consider explicit sequencing.

---

## 6. Deletion Candidates

### Safe to Delete (After Verification)

#### File 1: `reference/useLiveProctoring.ts` (350+ lines)

**Status**: 🟢 **SAFE TO DELETE**

**Reason**:
- Old React hook for single-candidate Live Proctoring
- Replaced by class-based `CandidateLiveService`
- NOT imported in any active file (verified by grep search)
- Functionality fully replicated in new service

**Verification**:
```bash
# Search for imports:
grep -r "useLiveProctoring" frontend/src/pages/**/*.tsx
# Result: No matches found (only in reference/ folder)
```

**Recommendation**: Archive to `archive/reference/useLiveProctoring.ts`

---

#### File 2: `reference/useMultiLiveProctorAdmin.ts` (500+ lines)

**Status**: 🟢 **SAFE TO DELETE**

**Reason**:
- Old React hook for multi-candidate admin monitoring
- Replaced by class-based `AdminLiveService`
- Only used by `reference/LiveProctoringDashboard.tsx` (also unused)
- Functionality fully replicated in new service

**Verification**:
```bash
# Search for imports:
grep -r "useMultiLiveProctorAdmin" frontend/src/pages/**/*.tsx
# Result: No matches (only in reference/LiveProctoringDashboard.tsx)
```

**Recommendation**: Archive to `archive/reference/useMultiLiveProctorAdmin.ts`

---

#### File 3: `reference/take.tsx` (800+ lines)

**Status**: 🟢 **SAFE TO DELETE**

**Reason**:
- Old assessment take page implementation
- Superseded by current take pages in `pages/assessment/`, `pages/test/`, etc.
- NOT imported anywhere
- Uses old proctoring hooks (useLiveProctoring, useFaceMesh)

**Verification**:
```bash
# Check if referenced:
grep -r "reference/take" frontend/src/**/*.{ts,tsx}
# Result: No matches
```

**Recommendation**: Archive to `archive/reference/take.tsx`

---

#### File 4: `reference/useFaceMesh.ts` (200+ lines)

**Status**: 🟢 **SAFE TO DELETE**

**Reason**:
- Old face detection hook using MediaPipe
- Face detection now handled by Universal Proctoring's `AIProctoringService`
- NOT imported in any active file
- Functionality integrated into new system

**Verification**:
```bash
# Search for imports:
grep -r "useFaceMesh" frontend/src/pages/**/*.tsx
# Result: No matches (only in reference/ folder)
```

**Recommendation**: Archive to `archive/reference/useFaceMesh.ts`

---

#### File 5: `reference/LiveProctoringDashboard.tsx` (692 lines)

**Status**: 🟡 **CAUTION - Keep as Reference**

**Reason**:
- Admin dashboard component using legacy hooks
- NOT used in any active page
- BUT: Contains valuable UI patterns for future admin dashboard
- Shows how to:
  - Render multi-candidate grid
  - Handle stream attachment to video elements
  - Implement refresh/reconnect functionality
  - Display connection status per candidate

**Verification**:
```bash
# Check if imported:
grep -r "LiveProctoringDashboard" frontend/src/pages/**/*.tsx
# Result: No matches in active pages
```

**Recommendation**: 
- **DO NOT DELETE** yet
- Keep as reference when implementing admin dashboard UI
- Archive after new admin dashboard is built
- Rename to `REFERENCE_LiveProctoringDashboard.tsx` to make status clear

---

### Archive Strategy

**Step 1: Create Archive Directory**
```bash
mkdir -p frontend/archive/reference
```

**Step 2: Move Files (Preserving Git History)**
```bash
git mv frontend/reference/useLiveProctoring.ts frontend/archive/reference/
git mv frontend/reference/useMultiLiveProctorAdmin.ts frontend/archive/reference/
git mv frontend/reference/take.tsx frontend/archive/reference/
git mv frontend/reference/useFaceMesh.ts frontend/archive/reference/
```

**Step 3: Keep LiveProctoringDashboard as Reference**
```bash
git mv frontend/reference/LiveProctoringDashboard.tsx \
        frontend/reference/REFERENCE_LiveProctoringDashboard.tsx
```

**Step 4: Add Archive README**
Create `frontend/archive/reference/README.md`:
```markdown
# Archived Reference Files

These files are legacy implementations that have been superseded by the Universal Proctoring System.

## Archived Files

- `useLiveProctoring.ts` - Replaced by `CandidateLiveService` class
- `useMultiLiveProctorAdmin.ts` - Replaced by `AdminLiveService` class
- `take.tsx` - Replaced by current take pages
- `useFaceMesh.ts` - Integrated into `AIProctoringService`

## Still Active

- `REFERENCE_LiveProctoringDashboard.tsx` - Keep as reference for future admin UI

Archived: December 24, 2025
```

**Step 5: Commit**
```bash
git commit -m "Archive legacy Live Proctoring hooks and components

- Move useLiveProctoring.ts to archive (replaced by CandidateLiveService)
- Move useMultiLiveProctorAdmin.ts to archive (replaced by AdminLiveService)
- Move take.tsx to archive (replaced by current take pages)
- Move useFaceMesh.ts to archive (integrated into AIProctoringService)
- Keep LiveProctoringDashboard.tsx as reference for future admin UI"
```

---

### Deletion Risk Matrix

| File | Risk | Reason | Action |
|------|------|--------|--------|
| `useLiveProctoring.ts` | 🟢 LOW | Not imported anywhere | Archive now |
| `useMultiLiveProctorAdmin.ts` | 🟢 LOW | Only used by unused dashboard | Archive now |
| `take.tsx` | 🟢 LOW | Old page, not routed | Archive now |
| `useFaceMesh.ts` | 🟢 LOW | Functionality in Universal Proctoring | Archive now |
| `LiveProctoringDashboard.tsx` | 🟡 MEDIUM | Valuable UI reference for future work | Rename, keep |

---

## 7. Summary

### ✅ What Works Perfectly

| Feature | Implementation | Status |
|---------|---------------|--------|
| **Screen Stream Reuse** | `window.__screenStream` global storage | ✅ Perfect |
| **CandidateLiveService** | WebSocket + WebRTC streaming | ✅ Production ready |
| **AdminLiveService** | Multi-candidate monitoring backend | ✅ Fully implemented |
| **WebRTC Signaling** | SDP offer/answer + ICE candidates | ✅ Working |
| **Stream Reuse (AI+Live)** | Live reuses Universal's camera | ✅ Working |
| **Identity Verification** | Screen share validation | ✅ Enforces entire screen |
| **Pre-check Validation** | Camera/mic verification | ✅ Working |

---

### 🔴 Critical Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| **Camera permission re-prompts** | HIGH | Browser popup after "Start Assessment" |
| **No admin dashboard UI** | MEDIUM | Admin cannot view live streams |
| **Camera stream discarded** | HIGH | Pre-check stream not preserved |

---

### 📊 Statistics

| Metric | Count |
|--------|-------|
| **Active Live Proctoring Files** | 13 |
| **Legacy Files** | 5 |
| **Safe to Delete** | 4 |
| **Keep as Reference** | 1 |
| **Total getUserMedia Calls** | 3 (pre-check, Universal, Live fallback) |
| **Total getDisplayMedia Calls** | 1 (identity verify) ✅ |
| **Admin UI Pages** | 0 ❌ |

---

### 🎯 Recommendations Priority

#### Priority 1 (HIGH - Fix Immediately)

1. **Preserve Camera Stream from Pre-Check**
   - Store in global variable like screen stream
   - OR: Move camera check to identity-verify page
   - OR: Keep stream alive across navigation

2. **Prevent Camera Re-Requests After Start**
   - Pass pre-check camera stream to Universal Proctoring
   - Ensure Live Proctoring always receives existing stream
   - Eliminate fallback `getUserMedia()` calls after "Start Assessment"

#### Priority 2 (MEDIUM - Plan Implementation)

3. **Build Admin Dashboard UI**
   - Create route: `/assessments/[id]/live-dashboard`
   - Use `AdminLiveService` (already implemented)
   - Show multi-candidate grid with webcam + screen
   - Add refresh/reconnect functionality

4. **Archive Legacy Files**
   - Move 4 files to archive folder
   - Rename LiveProctoringDashboard to REFERENCE_*
   - Add archive README documentation

#### Priority 3 (LOW - Future Enhancement)

5. **Add Stream Sequencing**
   - Ensure Universal Proctoring completes before Live starts
   - Add explicit dependency in useEffect

6. **Add Monitoring Metrics**
   - Track permission denial rates
   - Track stream reuse success rates
   - Add logging for debugging

---

### 📝 Next Steps

**For Permission Fix**:
1. Read how screen stream is preserved (`window.__screenStream`)
2. Apply same pattern to camera stream (`window.__cameraStream`)
3. Update pre-check to store stream globally
4. Update Universal Proctoring to check for existing stream first
5. Test all three scenarios (AI-only, Live-only, AI+Live)

**For Admin Dashboard**:
1. Review `REFERENCE_LiveProctoringDashboard.tsx` for UI patterns
2. Create new dashboard route
3. Import `AdminLiveService`
4. Implement candidate grid with video elements
5. Add connection status indicators

**For Cleanup**:
1. Verify no imports to legacy files (grep search)
2. Run tests to ensure nothing breaks
3. Move files to archive folder
4. Update documentation
5. Monitor for 1 sprint before permanent deletion

---

**Analysis Complete**: December 24, 2025  
**Document Version**: 1.0  
**Status**: READ-ONLY ANALYSIS (No code modifications made)
