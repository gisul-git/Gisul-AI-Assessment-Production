# Proctoring System Rules and Configuration

## Overview

Client-side proctoring system for real-time face detection, gaze-away monitoring, and violation recording during assessments.

---

## Architecture

### Detection Pipeline

```
BlazeFace (Face Detection) → Face Counting → Debouncing → onDetection callback
                                                              ↓
MediaPipe FaceMesh → Landmarks → Gaze-Away Detection → onDetection callback
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| useFaceMesh | `hooks/useFaceMesh.ts` | Main detection hook (BlazeFace + FaceMesh) |
| useProctorUpload | `hooks/useProctorUpload.ts` | Snapshot upload and violation recording |
| take.tsx | `pages/assessment/[id]/[token]/take.tsx` | Assessment page integration |
| WebcamPreview | `components/WebcamPreview.tsx` | Camera preview UI |
| ViolationToast | `components/ViolationToast.tsx` | Violation notification UI |

---

## Face Detection (BlazeFace)

### Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Confidence Threshold | `0.4` | Minimum confidence to accept detection |
| Minimum Face Area | `1%` of frame | Filters very small false positives |
| Aspect Ratio Range | `0.4 - 2.0` | Filters invalid face shapes |
| In-Frame Requirement | `50%` | Allows partially visible faces |

### Overlap Filtering

Prevents same face from being counted multiple times:

| Parameter | Value | Description |
|-----------|-------|-------------|
| IoU Threshold | `0.3` | Merge boxes with ≥30% overlap |
| Centroid Distance | `60px` | Merge boxes within 60px |
| Condition | `>=` / `<=` | Inclusive comparison |

### Face Counting Debouncing

| Scenario | Required Frames | Description |
|----------|-----------------|-------------|
| Single Face | `2` consecutive | Confirm single face detection |
| Multiple Faces | `3` consecutive | Confirm multiple faces (stricter) |
| Face Count Decrease | `3` consecutive | Confirm face count reduction |

---

## Gaze-Away Detection (FaceMesh)

### Head Pose Calculation

Uses MediaPipe FaceMesh landmarks (468 points):

| Landmark | Index | Purpose |
|----------|-------|---------|
| Nose Tip | 1 or 4 | Pitch calculation |
| Left Eye | 33 | Yaw calculation |
| Right Eye | 263 | Yaw calculation |
| Chin | 152 | Face center reference |
| Forehead | 10 | Face vertical reference |

### Detection Thresholds

| Direction | Threshold | Duration Required |
|-----------|-----------|-------------------|
| Sideways (Yaw) | `>15°` | `1500ms` (1.5 seconds) |
| Up/Down (Pitch) | `>20°` | `1500ms` (1.5 seconds) |
| Looking Down | `>25°` | `2500ms` (2.5 seconds) |

### State Machine

```
IDLE → (gaze away detected) → DETECTING → (duration met) → COOLDOWN → (3s passed) → IDLE
         ↑                         |
         └── (looked back) ────────┘
```

### Timing

| Parameter | Value | Description |
|-----------|-------|-------------|
| Sideways Duration | `1500ms` | Time before triggering |
| Looking Down Duration | `2500ms` | Longer for keyboard use |
| Cooldown Period | `3000ms` | Between events |

---

## Multiple Face Detection

### Detection Rules

1. BlazeFace detects faces → filters by confidence (>0.4)
2. Validates size, aspect ratio, in-frame ratio
3. Filters overlapping boxes (IoU 0.3, centroid 60px)
4. Debouncing: requires 3 consecutive frames with 2+ faces
5. Reports `multiFace: true` via `onDetection` callback

### Cooldown and Rate Limiting

| Type | Duration | Purpose |
|------|----------|---------|
| Event Cooldown | `15000ms` (15s) | Between MULTIPLE_FACES_DETECTED events |
| Snapshot Rate Limit | `10000ms` (10s) | Between snapshot uploads |

---

## No Face Detection

### Detection Rules

1. BlazeFace is the primary detector for face counting
2. FaceMesh is only used for gaze-away detection (not face counting)
3. Requires 5 consecutive frames with `facesCount === 0` to trigger violation
4. No dual detection override — BlazeFace is trusted completely

### FaceMesh Landmark Validation

Used for gaze-away detection only:

| Check | Requirement | Description |
|-------|-------------|-------------|
| Minimum Landmarks | `468` | Full FaceMesh model |
| Key Landmarks | Nose, eyes, chin, forehead | Must exist |
| Coordinate Bounds | `0-1` normalized | Valid range |
| Face Size | `5% - 80%` of frame | Reasonable size |
| Decay Frames | `2` | Reset flag after 2 invalid frames |

---

## Snapshot Capture

### Events That Trigger Snapshots

Only these events capture and upload snapshots:
- `GAZE_AWAY`
- `MULTIPLE_FACES_DETECTED`
- `NO_FACE_DETECTED`

### Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Format | JPEG | Image format |
| Quality | `0.8` (80%) | Compression level |
| Resolution | Video stream resolution | Typically 640x480 |

### Upload Rate Limits

| Event Type | Rate Limit | Description |
|------------|------------|-------------|
| MULTIPLE_FACES_DETECTED | `10000ms` (10s) | Prevent spam |
| GAZE_AWAY | `5000ms` (5s) | Standard limit |
| NO_FACE_DETECTED | `8000ms` (8s) | Prevent spam |
| Default | `2000ms` (2s) | Other events |

---

## Violation Handling

### Event Flow

```
Detection → Cooldown Check → Skip if in cooldown
                ↓ (passed)
         Snapshot Capture → Upload to /api/proctor/upload
                ↓
         Violation Recording → POST to /api/proctor/record
                ↓
         Toast Notification → Show user feedback
```

### Cooldowns

| Event Type | Cooldown | Description |
|------------|----------|-------------|
| MULTIPLE_FACES_DETECTED | `15000ms` (15s) | Prevent duplicate events |
| GAZE_AWAY | Handled in useFaceMesh | 3000ms cooldown built-in |
| NO_FACE_DETECTED | Uses 5-frame debouncing | No additional cooldown |

---

## Toast Notifications

### Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Position | Top-right | Fixed position |
| Z-Index | `9999` | Above all content |
| Auto-Dismiss | `3000ms` (3s) | Time before fade out |
| Gap Between Toasts | `5000ms` (5s) | Prevents spam |
| Behavior | Replace | New toast replaces existing |

---

## MediaPipe Assets

### Location

```
frontend/public/mediapipe/face_mesh/
├── face_mesh_solution_packed_assets.data
├── face_mesh_solution_packed_assets_loader.js
├── face_mesh_solution_simd_wasm_bin.js
├── face_mesh_solution_simd_wasm_bin.wasm
├── face_mesh_solution_wasm_bin.js
├── face_mesh_solution_wasm_bin.wasm
├── face_mesh.binarypb
└── face_mesh.js
```

### Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| locateFile | `/mediapipe/face_mesh/${file}` | Asset path |
| Module Setup | `window.createMediapipeSolutionsPackedAssets` | Global config |
| Middleware | `/mediapipe/` excluded | No authentication |

---

## Performance

### Frame Rate

| Parameter | Value | Description |
|-----------|-------|-------------|
| Detection FPS | `~12 FPS` | Throttled from 60 FPS |
| Throttle Calculation | `Math.ceil(60/12) = 5` | Frames per detection |

### Model Options

| Option | Value | Description |
|--------|-------|-------------|
| maxNumFaces | `1` | Optimize for single face |
| refineLandmarks | `false` | Faster processing |
| minDetectionConfidence | `0.5` | Standard confidence |
| minTrackingConfidence | `0.5` | Standard confidence |

---

## API Endpoints

### Frontend API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/proctor/upload` | POST | Upload snapshot (multipart/form-data) |
| `/api/proctor/record` | POST | Record violation event |
| `/api/proctor/snapshot/[snapshotId]` | GET | Retrieve snapshot by ID |

### Backend API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/proctor/upload` | POST | Save snapshot to MongoDB |
| `/api/v1/proctor/record` | POST | Save violation event |
| `/api/v1/proctor/snapshot/{snapshotId}` | GET | Retrieve snapshot |

---

## Configuration Constants

```typescript
// BlazeFace
CONFIDENCE_THRESHOLD = 0.4
MIN_FACE_AREA = 0.01 // 1% of frame
ASPECT_RATIO_MIN = 0.4
ASPECT_RATIO_MAX = 2.0
IN_FRAME_RATIO = 0.5 // 50%

// Overlap Filtering
IOU_THRESHOLD = 0.3
CENTROID_DISTANCE = 60 // pixels

// Gaze-Away
YAW_THRESHOLD = 15 // degrees
PITCH_THRESHOLD = 20 // degrees
LOOKING_DOWN_THRESHOLD = 25 // degrees
GAZE_AWAY_DURATION = 1500 // ms
GAZE_DOWN_DURATION = 2500 // ms
GAZE_AWAY_COOLDOWN = 3000 // ms

// Face Counting Debouncing
SINGLE_FACE_FRAMES = 2
MULTIPLE_FACE_FRAMES = 3
FACE_COUNT_DECREASE_FRAMES = 3
NO_FACE_FRAMES = 5

// Cooldowns
MULTIPLE_FACES_COOLDOWN = 15000 // ms
MULTIPLE_FACES_SNAPSHOT_RATE = 10000 // ms
GAZE_AWAY_SNAPSHOT_RATE = 5000 // ms
NO_FACE_SNAPSHOT_RATE = 8000 // ms
DEFAULT_SNAPSHOT_RATE = 2000 // ms

// FaceMesh Validation
MIN_LANDMARKS = 468
FACE_SIZE_MIN = 0.05 // 5%
FACE_SIZE_MAX = 0.8 // 80%
LANDMARK_DECAY_FRAMES = 2
```

---

## Troubleshooting

### "Faces: 1" when no face

- BlazeFace is the only source for face counting
- FaceMesh flag is only for gaze-away detection
- Check BlazeFace console logs for detection issues

### Multiple faces for single person

- Check overlap filtering (IoU 0.3, centroid 60px)
- Verify debouncing (3 frames required)
- Check validation filters (aspect ratio, size)

### Gaze-away not triggering

- Check yaw/pitch thresholds (15°/20°)
- Verify duration requirements (1500ms/2500ms)
- Check cooldown period (3000ms)
- Check console logs for gaze-away state

### Snapshots not saving

- Check rate limiting per event type
- Verify API endpoint availability
- Check network requests in DevTools
- Verify MongoDB connection

---

## Debug Logging

### Console Log Prefixes

| Prefix | Component | Description |
|--------|-----------|-------------|
| `[FaceMesh]` | Model | Initialization and assets |
| `[GazeAway]` | Gaze | Detection and state changes |
| `[MultiFace]` | Multi-face | Detection and counting |
| `[NoFace]` | No-face | Detection and validation |
| `[ProctorUpload]` | Upload | Snapshots and recording |
| `[Take]` | Page | Integration events |

---

## Do Not Modify

- Gaze-away timing logic (1500ms/2500ms durations)
- Multiple face cooldown (15 seconds)
- Face counting debouncing (2/3 frames)
- Overlap filtering thresholds (IoU 0.3, centroid 60px)
- BlazeFace as sole face counting source

## Safe to Adjust

- Confidence thresholds (if false positives/negatives occur)
- Snapshot rate limits (if storage is a concern)
- Toast notification timing (if UX needs adjustment)
- Debug logging frequency (if performance is impacted)

---

## Version

**Current Version**: v1.5

### Changelog

- v1.0: Initial implementation with BlazeFace + FaceMesh
- v1.1: Added dual detection system
- v1.2: Improved overlap filtering (IoU 0.3, centroid 60px)
- v1.3: Added cooldowns and rate limiting
- v1.4: Enhanced FaceMesh landmark validation
- v1.5: Simplified face counting (BlazeFace only), fixed multiple face detection

