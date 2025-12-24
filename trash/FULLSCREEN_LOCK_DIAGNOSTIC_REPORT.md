# 🔍 FULLSCREEN LOCK DIAGNOSTIC REPORT

**Date:** December 23, 2025  
**Status:** Analysis Only (No Fixes Applied)

---

## Executive Summary

**Root Cause:** The `useEffect` in `src/hooks/useFullscreenLock.ts` (lines 169-223) has a **fatal dependency array bug** that causes the fullscreenchange listener to be **re-registered on every fullscreen exit**, creating a race condition where the old listener may be removed at the wrong time.

---

## 1. END-TO-END FLOW ANALYSIS

### Where Fullscreen Enforcement is Started

| Location | Code | Behavior |
|----------|------|----------|
| `useFullscreenLock.ts` line 156 | `useState(autoStart)` | `isEnforcing` is initialized to `autoStart` value |
| Take pages | `autoStart: true` | Enforcement starts immediately on page load |

### Where Fullscreen Exit is Detected

| Location | Code |
|----------|------|
| `useFullscreenLock.ts` lines 169-222 | `useEffect` registers `fullscreenchange` listeners |
| `useFullscreenLock.ts` line 171 | `handleFullscreenChange()` function detects exit |

### Where `isFullscreenLocked` is Set

| Location | Code |
|----------|------|
| `useFullscreenLock.ts` line 259 | `const isLocked = isEnforcing && !isFullscreen;` (computed value) |

### Where `isLocked` is Consumed

| Location | UI Component |
|----------|--------------|
| All take pages | `<FullscreenLockOverlay isLocked={isFullscreenLocked} ... />` |

---

## 2. SPECIFIC POINT CHECKS

### A. Is `fullscreen.start()` ALWAYS called?

**Finding: NOT APPLICABLE for useFullscreenLock**

The `useFullscreenLock` hook does NOT use the service-based `FullscreenService.start()`. It manages its own listeners. 

- ✅ On page load: Listener registered in `useEffect` with `autoStart: true`
- ✅ On Start Assessment: N/A (already running)
- ⚠️ On route refresh: Listener RE-REGISTERED due to dependency array

### B. Is fullscreenchange listener registered:

**Finding: ⚠️ LISTENER IS REMOVED AND RE-ADDED ON EVERY EXIT**

```typescript
// Line 223
}, [isEnforcing, exitCount, onViolation, onFullscreenChange]);
```

**Problem:** `exitCount` is in the dependency array. When `exitCount` changes (on every fullscreen exit), the useEffect:
1. Runs cleanup (removes listeners)
2. Runs setup again (adds listeners)

This creates a **brief window** where no listener is attached.

### C. Is `isFullscreenLocked` stored correctly?

**Finding: ✅ Correctly computed, BUT...**

```typescript
const isLocked = isEnforcing && !isFullscreen;  // Line 259
```

This is computed EVERY render. It's not a problem itself, but:
- `isFullscreen` depends on `setIsFullscreen()` being called
- `setIsFullscreen()` is only called inside `handleFullscreenChange`
- If the listener is temporarily removed, the state won't update

### D. Is FullscreenLockOverlay always mounted?

**Finding: ✅ FIXED (from previous session)**

All early returns now include `<FullscreenLockOverlay />`.

### E. Is `autoStart: true` causing race conditions?

**Finding: ⚠️ PARTIAL PROBLEM**

`autoStart: true` initializes `isEnforcing = true` immediately, but:
- Initial fullscreen state is checked **after** listener registration (line 207-208)
- `wasFullscreenRef.current` is set INSIDE the useEffect, not before
- If user is NOT in fullscreen when page loads, `isLocked` will be `true` immediately

---

## 3. IDENTIFIED BUGS (Priority Order)

### 🔴 BUG #1: Critical - Dependency Array Causes Listener Re-registration

**File:** `src/hooks/useFullscreenLock.ts` line 223

**The Problem:**
```typescript
}, [isEnforcing, exitCount, onViolation, onFullscreenChange]);
```

`exitCount` being in the dependency array means:
- User exits fullscreen → `exitCount` increments → useEffect re-runs → listeners removed & re-added

This creates a race condition where:
1. Fullscreen exit triggers `handleFullscreenChange`
2. `exitCount` is incremented via `setExitCount`
3. React schedules useEffect cleanup
4. **Listener is removed**
5. **New listener is registered**
6. During steps 4-5, any fullscreen change is MISSED

**Impact:** Subsequent fullscreen exits may not be detected. Popup may not appear.

---

### 🟠 BUG #2: High - `onViolation` Callback in Dependency Array

**File:** `src/hooks/useFullscreenLock.ts` line 223

**The Problem:**
```typescript
}, [isEnforcing, exitCount, onViolation, onFullscreenChange]);
```

`onViolation` is passed from the take page:
```typescript
onViolation: handleUniversalViolation,
```

If `handleUniversalViolation` is not memoized with `useCallback`, it will be a new function reference on every render → listener re-registered on every render.

**Impact:** Listener thrashing on every render.

---

### 🟠 BUG #3: High - `onFullscreenChange` Callback in Dependency Array

Same issue as BUG #2. If passed, this callback must be memoized.

---

### 🟡 BUG #4: Medium - Stale Closure in exitCount

**File:** `src/hooks/useFullscreenLock.ts` line 178

```typescript
const newExitCount = exitCount + 1;
setExitCount(newExitCount);
```

This uses `exitCount` from closure, which may be stale. Should use functional update:
```typescript
setExitCount(prev => prev + 1);
```

**Impact:** Exit count may be incorrect in rapid succession scenarios.

---

### 🟡 BUG #5: Medium - No Stable Callback Refs

**File:** `src/hooks/useFullscreenLock.ts` lines 169-222

Callbacks (`onViolation`, `onFullscreenChange`) are used directly in the handler instead of through refs. This forces them into the dependency array.

**Impact:** Forces unnecessary listener re-registration.

---

## 4. RECOMMENDED FIXES (Not Yet Implemented)

### Fix #1: Remove `exitCount` from Dependency Array

Use a ref to track exitCount inside the handler, or use functional setState:
```typescript
setExitCount(prev => {
  const newCount = prev + 1;
  // Use newCount here
  return newCount;
});
```

### Fix #2: Use Refs for Callbacks

```typescript
const onViolationRef = useRef(onViolation);
const onFullscreenChangeRef = useRef(onFullscreenChange);

useEffect(() => {
  onViolationRef.current = onViolation;
}, [onViolation]);

// Then in handler:
onViolationRef.current?.(violation);
```

### Fix #3: Simplify Dependency Array to Only Essential Deps

```typescript
}, [isEnforcing]); // Only re-register when enforcement starts/stops
```

### Fix #4: Consider Using `useEventListener` Pattern

A custom hook that properly handles listener lifecycle without cleanup thrashing.

---

## 5. SUMMARY TABLE

| Issue | Severity | File | Line | Root Cause |
|-------|----------|------|------|------------|
| Listener re-registration on exit | 🔴 Critical | useFullscreenLock.ts | 223 | `exitCount` in deps |
| Callback thrashing | 🟠 High | useFullscreenLock.ts | 223 | `onViolation` not stable |
| Stale closure | 🟡 Medium | useFullscreenLock.ts | 178 | Direct state access |

---

## 6. WHY BEHAVIOR IS INCONSISTENT

The popup **sometimes** appears because:

1. **First exit:** Listener is attached → exit detected → popup shows → `exitCount` changes → useEffect re-runs
2. **Re-entry:** User clicks "Enter Fullscreen" → fullscreen entered → `wasFullscreenRef` updated
3. **Second exit:** May be MISSED if it happens during the brief window when useEffect is cleaning up and re-adding listeners
4. **Render-dependent:** If the page re-renders (any state change), and `onViolation` is not memoized, listeners get thrashed

The inconsistency is a **timing-dependent race condition** caused by the dependency array including values that change as a result of the event being detected.

---

## 7. FILES INVOLVED

| File | Purpose | Issues Found |
|------|---------|--------------|
| `src/hooks/useFullscreenLock.ts` | Main hook for fullscreen enforcement | BUG #1, #2, #3, #4, #5 |
| `src/components/FullscreenLockOverlay.tsx` | UI overlay component | ✅ No issues |
| `src/pages/test/[id]/take.tsx` | DSA take page | Potentially unmemoized callback |
| `src/pages/assessment/[id]/[token]/take.tsx` | Assessment take page | Potentially unmemoized callback |
| `src/pages/aiml/test/[id]/take.tsx` | AIML take page | Potentially unmemoized callback |
| `src/pages/custom-mcq/take/[assessmentId].tsx` | Custom MCQ take page | Potentially unmemoized callback |
| `src/universal-proctoring/services/fullscreen.ts` | Service class (NOT USED by hook) | N/A |

---

## 8. NEXT STEPS

1. **Approval Required:** Get approval to implement fixes
2. **Fix Priority:** BUG #1 (critical) → BUG #2/3 (high) → BUG #4/5 (medium)
3. **Testing:** After fixes, test:
   - Multiple fullscreen exits in quick succession
   - Page re-renders during fullscreen exit
   - Browser compatibility (Chrome, Firefox, Edge, Safari)
