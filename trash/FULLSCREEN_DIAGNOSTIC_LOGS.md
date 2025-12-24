# Fullscreen Diagnostic Logs

**Date:** December 23, 2025  
**Purpose:** Diagnose why fullscreen exit is not detected in the DSA take page

---

## Files Modified (Temporary Diagnostic Logs)

### 1. `src/components/FullscreenLockOverlay.tsx`

**Location:** `handleEnterFullscreen` callback

**Logs Added:**
```
[FullscreenLockOverlay] BEFORE click: { document.fullscreenElement, document.webkitFullscreenElement, isFullscreen }
[FullscreenLockOverlay] AFTER click (100ms delay): { document.fullscreenElement, document.webkitFullscreenElement, isFullscreen, requestReturnedSuccess }
```

---

### 2. `src/hooks/useFullscreenLock.ts`

**Location:** `requestFullscreenAPI()` function

**Logs Added:**
```
[useFullscreenLock] requestFullscreenAPI called: { element, hasRequestFullscreen, hasWebkitRequestFullscreen, hasMozRequestFullScreen, hasMsRequestFullscreen }
[useFullscreenLock] Using standard requestFullscreen()
[useFullscreenLock] Fullscreen verification (50ms after request): { isNowFullscreen, fullscreenElement }
```

**Location:** `useEffect` for fullscreen listener registration

**Logs Added:**
```
[useFullscreenLock] Registering fullscreen listener (enforcement started)
[useFullscreenLock] Initial fullscreen state on enforcement start: { initialFullscreen, document.fullscreenElement }
```

**Location:** `handleFullscreenChange` event handler

**Logs Added:**
```
[useFullscreenLock] *** FULLSCREENCHANGE EVENT FIRED ***
[useFullscreenLock] Fullscreen change: was=X, now=Y { document.fullscreenElement, webkitFullscreenElement }
[useFullscreenLock] Fullscreen EXIT detected
[useFullscreenLock] Fullscreen ENTER detected
```

---

## Testing Instructions

### Step 1: Open DevTools Console
- Open browser DevTools (F12)
- Go to Console tab
- Filter by `[useFullscreenLock]` or `[FullscreenLockOverlay]`

### Step 2: Test Fullscreen Entry
1. Navigate to DSA take page
2. Click "Enter Fullscreen" button
3. Watch for these logs in order:
   - `BEFORE click` - should show `isFullscreen: false`
   - `requestFullscreenAPI called` - confirms which API is available
   - `Using standard requestFullscreen()` - confirms API is called on `document.documentElement`
   - `*** FULLSCREENCHANGE EVENT FIRED ***` - **CRITICAL: confirms browser event triggered**
   - `Fullscreen change: was=false, now=true` - confirms state transition
   - `AFTER click (100ms delay)` - should show `isFullscreen: true`

### Step 3: Test Fullscreen Exit
1. Press ESC or F11 to exit fullscreen
2. Watch for these logs:
   - `*** FULLSCREENCHANGE EVENT FIRED ***` - **CRITICAL: must appear**
   - `Fullscreen change: was=true, now=false` - confirms exit detected
   - `Fullscreen EXIT detected` - confirms exit logic triggered

---

## Expected vs Problematic Output

### ✅ Expected (Working Correctly)
```
[useFullscreenLock] Registering fullscreen listener (enforcement started)
[useFullscreenLock] Initial fullscreen state on enforcement start: { initialFullscreen: false }
[FullscreenLockOverlay] BEFORE click: { isFullscreen: false }
[useFullscreenLock] requestFullscreenAPI called: { element: 'HTML', hasRequestFullscreen: true }
[useFullscreenLock] Using standard requestFullscreen()
[useFullscreenLock] *** FULLSCREENCHANGE EVENT FIRED ***
[useFullscreenLock] Fullscreen change: was=false, now=true
[useFullscreenLock] Fullscreen ENTER detected
[FullscreenLockOverlay] AFTER click: { isFullscreen: true, requestReturnedSuccess: true }

... user presses ESC ...

[useFullscreenLock] *** FULLSCREENCHANGE EVENT FIRED ***
[useFullscreenLock] Fullscreen change: was=true, now=false
[useFullscreenLock] Fullscreen EXIT detected
```

### ❌ Problematic (Event Not Firing)
```
[useFullscreenLock] Registering fullscreen listener (enforcement started)
[FullscreenLockOverlay] BEFORE click: { isFullscreen: false }
[useFullscreenLock] requestFullscreenAPI called: { ... }
[useFullscreenLock] Using standard requestFullscreen()
[FullscreenLockOverlay] AFTER click: { isFullscreen: true }

... user presses ESC ...

(NO "*** FULLSCREENCHANGE EVENT FIRED ***" log appears)
```

If the event is NOT fired, this indicates:
- Browser issue (blocked by iframe, extension, or browser policy)
- CSS-based fullscreen being used instead of native API
- Listener was removed prematurely

---

## Possible Root Causes to Check

| Symptom | Possible Cause |
|---------|----------------|
| No `requestFullscreenAPI called` log | Button not connected to hook's `requestFullscreen` |
| API called but no event fired | Browser blocked fullscreen request |
| Event fired on enter but not exit | Listener removed between enter and exit |
| `was=false, now=false` on exit | `wasFullscreenRef` not updated correctly |
| Popup appears on page load | `isLocked` set to `true` incorrectly on init |

---

## Cleanup Instructions

After debugging is complete, remove the diagnostic logs from:
1. `src/components/FullscreenLockOverlay.tsx` - lines 143-156
2. `src/hooks/useFullscreenLock.ts` - lines 93-109, 219-224, 234-238

Or search for `DIAGNOSTIC:` comments in these files.
