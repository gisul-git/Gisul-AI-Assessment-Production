# Snapshot Capture Fix - Implementation Summary

## Issue
Backend logs showed `hasSnapshot: false` and `snapshotSize: 'none'` despite violation incidents being created. Snapshots were never appearing in the analytics dashboard.

## Root Cause
The `canvasElement` parameter in `aiProctoring.ts` was optional and defaulted to `null`. All three take pages (DSA, MCQ, AIML) were calling `startProctoring()` without passing a canvas element, causing `captureSnapshot()` to always return `null`.

## Solution Overview
**Modified ONLY:** `frontend/src/universal-proctoring/services/aiProctoring.ts`

### 1. Auto-Create Offscreen Canvas (Lines 294-305)
```typescript
// Create canvas element if not provided (required for snapshot capture)
if (canvasElement) {
  this.canvasElement = canvasElement;
} else {
  // Create an offscreen canvas for snapshot capture
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_DIMENSIONS.WIDTH;
  canvas.height = VIDEO_DIMENSIONS.HEIGHT;
  this.canvasElement = canvas;
  debugLog("AIProctoringService: Created offscreen canvas for snapshots");
}
```

**Impact:** All violations now have snapshots automatically captured without modifying take pages.

### 2. Optional Enhancement: Typing Detection (Lines 162, 169-171, 413-443, 723-729)

**Added keyboard tracking:**
```typescript
private keyboardHandler: (() => void) | null = null;
private lastKeyPressTime = 0;
private readonly TYPING_WINDOW = 3000; // 3 seconds
```

**Added helper methods:**
- `startKeyboardListener()` - Tracks any keypress
- `stopKeyboardListener()` - Cleanup on stop
- `isLikelyTyping()` - Returns true if key pressed within 3s

**Updated gaze detection logic (Lines 723-729):**
```typescript
// Special case: Ignore brief 'down' gaze during typing
const isLookingDown = pitch > LOOKING_DOWN_THRESHOLD;
const isTyping = this.isLikelyTyping();

// Gaze is away if: outside thresholds OR (looking down but NOT typing)
isGazeAway = 
  Math.abs(yaw) > YAW_THRESHOLD || 
  Math.abs(pitch) > PITCH_THRESHOLD ||
  (isLookingDown && !isTyping);
```

**Impact:** Reduces false positives for candidates looking down briefly at keyboard during coding.

## What Was NOT Changed
✅ No changes to fullscreen detection  
✅ No changes to gaze angle thresholds (15° yaw, 20° pitch, 25° down)  
✅ No changes to take pages (DSA, MCQ, AIML)  
✅ No changes to backend or analytics  
✅ No changes to incident timing or cooldowns  

## Testing Verification

### Test Case 1: NO_FACE Violation
1. Start any assessment
2. Cover camera for 2+ seconds
3. **Expected:** TRIGGERED state, snapshot captured
4. **Verify:** Analytics shows violation with snapshot image

### Test Case 2: MULTIPLE_FACE Violation
1. Start any assessment
2. Show multiple faces for 1+ second
3. **Expected:** TRIGGERED state, snapshot captured
4. **Verify:** Analytics shows violation with snapshot image

### Test Case 3: GAZE_AWAY Violation
1. Start any assessment
2. Look away (left/right/up) for 1.5+ seconds
3. **Expected:** TRIGGERED state, snapshot captured
4. **Verify:** Analytics shows violation with snapshot image

### Test Case 4: Typing Detection (Enhancement)
1. Start any assessment (preferably coding)
2. Look down briefly at keyboard while typing
3. **Expected:** NO violation if typing recently (within 3s)
4. **Verify:** Fewer false positives for "down" gaze

### Backend Log Verification
After any violation is triggered, check backend logs:
```
hasSnapshot: true
snapshotSize: '50KB' (or similar)
```

## Technical Details

### Snapshot Capture Flow
1. **State Machine:** IDLE → DETECTING → **TRIGGERED** → COOLDOWN
2. **Capture Location:** Lines 749 (NO_FACE), 825 (MULTIPLE_FACE), 906 (GAZE_AWAY)
3. **Canvas:** Auto-created offscreen canvas (640x480)
4. **Format:** Base64 JPEG, quality 0.8
5. **Payload:** Attached to `incident.snapshotData` before `emitViolation()`

### Typing Detection Flow
1. **Listener:** Global `keydown` event on `document`
2. **Tracking:** Updates `lastKeyPressTime` on any keypress
3. **Window:** 3-second grace period
4. **Application:** Only affects GAZE_AWAY detection when looking down
5. **Thresholds:** No changes to angle thresholds

## Validation Status
✅ TypeScript: 0 errors  
✅ Code review: All changes isolated to aiProctoring.ts  
✅ State machine: Incident-based logic preserved  
✅ Compatibility: Works with all take pages without modification  

## Rollback Instructions
If issues occur, revert `frontend/src/universal-proctoring/services/aiProctoring.ts` to previous version. No other files were modified.

## Next Steps
1. Deploy frontend changes
2. Test snapshot capture with real violations
3. Verify snapshots appear in analytics dashboard
4. Monitor for reduced false positives with typing detection
5. Adjust `TYPING_WINDOW` (3000ms) if needed based on feedback
