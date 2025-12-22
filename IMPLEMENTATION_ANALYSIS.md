# DSA Test Implementation Analysis

## 1. Time & Scheduling

### How is the assessment start time stored in the backend?
- **Format**: Stored as Python `datetime` objects in MongoDB
- **Location**: `backend/app/api/v1/dsa/models/test.py` - `Test` model has `start_time: datetime` field
- **Storage**: MongoDB stores as BSON datetime

### UTC or local time?
- **Backend**: Uses `datetime.utcnow()` for creation timestamps (line 231 in `tests.py`)
- **API Response**: Converted to ISO string with 'Z' suffix (UTC indicator) - see `format_datetime_iso()` function (lines 525-536, 674-684 in `tests.py`)
- **Frontend**: Receives ISO string (e.g., "2025-12-20T13:00:00Z") and parses with `new Date()` which handles timezone conversion automatically

### Is any timezone conversion happening on the frontend?
- **No explicit conversion**: Frontend uses JavaScript's `new Date()` which automatically handles ISO strings with 'Z' (UTC)
- **Display**: Uses browser's local timezone for display via `toLocaleString()` if used

### Which function/library is currently used to format and display the start time?
- **Backend**: Custom `format_datetime_iso()` function that adds 'Z' suffix to ISO strings
- **Frontend**: Native JavaScript `new Date()` constructor and string formatting
- **Display**: Currently shows raw message from backend: `precheckMode.message` (line 1767 in `take.tsx`)

### Is the start time calculated on Backend only, Frontend only, or Both?
- **Backend**: Calculates and stores start_time during test creation
- **Frontend**: Receives start_time from backend, calculates countdown locally
- **Both**: Backend is source of truth; frontend calculates remaining time for display

### Does the backend send ISO string, Timestamp, or Plain string?
- **ISO String**: Backend sends ISO format string with 'Z' suffix (UTC indicator)
- **Example**: `"2025-12-20T13:00:00Z"` or `start_time.isoformat()` (line 1062 in `tests.py`)

---

## 2. Pre-Check Flow

### What triggers the Pre-Check Mode page to load?
- **Trigger**: Backend `/tests/{test_id}/start` endpoint returns `precheck_mode: true` when:
  - Current time is within 15 minutes before start_time (pre-check window)
  - Current time is before start_time (line 1058 in `tests.py`)
- **Frontend**: Sets `precheckMode` state when API response contains `precheck_mode: true` (line 929-935 in `take.tsx`)

### Is fullscreen being triggered automatically on page load or on user action?
- **Not in pre-check mode**: Fullscreen is NOT triggered during pre-check
- **After pre-check**: Fullscreen handling happens on the take page after test starts (line 737 mentions fullscreen)

### Are camera, mic, and screen permissions checked sequentially or together?
- **Sequential**: Pre-checks run in order defined by `CHECK_ORDER` array: `["browser", "network", "camera", "microphone"]` (line 15 in `precheck.tsx`)
- **Implementation**: `usePrecheck` hook manages sequential checking with `currentCheckIndex` state

### Where is the permission validation logic implemented?
- **Frontend only**: All validation happens client-side via `usePrecheck` hook (`frontend/src/hooks/usePrecheck.ts`)
- **Backend verification**: No backend verification of pre-check results during pre-check phase
- **Storage**: Pre-check completion stored in `sessionStorage` as `precheckCompleted_{testId}` (line 188 in `take.tsx`)

### Is there any flag that indicates pre-checks completed?
- **Frontend**: `sessionStorage.getItem('precheckCompleted_{id}')` (line 188 in `take.tsx`)
- **Backend**: No explicit flag; pre-check is a frontend-only validation step

---

## 3. Test Start Logic

### How does the system currently decide when the test starts?
- **Backend check**: `/tests/{test_id}/start` endpoint checks:
  - If `now < pre_check_start` (15 min before): Returns 403 error
  - If `pre_check_start <= now < start_time`: Returns `precheck_mode: true`
  - If `now >= start_time`: Allows test start, creates/returns `test_submission` with `started_at` timestamp
- **Frontend**: Calls `/tests/{test_id}/start` endpoint and checks response

### Is there a timer or interval checking start time?
- **No continuous polling**: Frontend does NOT poll backend for start time
- **Manual refresh**: User must refresh page or click "Start" button to check if test can start
- **Pre-check mode**: Shows countdown but doesn't auto-refresh (timer is static in render, not updating)

### What happens if the user opens the page before start time?
- **Before pre-check window**: Backend returns 403 error with message
- **In pre-check window**: Backend returns `precheck_mode: true`, frontend shows pre-check screen
- **After start time**: Test can start normally

### Is auto-start handled via setInterval/setTimeout, backend response, or page reload?
- **Currently**: NO auto-start mechanism
- **Pre-check mode**: Shows countdown but requires manual page refresh to check if test can start
- **Recommendation needed**: Should implement auto-refresh when countdown reaches 0

---

## 4. Timer Mode (Global vs Per Question)

### How is the timer mode defined?
- **Type**: `TimerMode = Literal["GLOBAL", "PER_QUESTION"]` (line 9 in `models/test.py`)
- **Default**: `"GLOBAL"` (line 48 in `models/test.py`)

### Where is this timer mode coming from?
- **Admin config**: Set during test creation/update via `TestCreate` model (line 75 in `models/test.py`)
- **Not hardcoded**: Admin can choose between GLOBAL and PER_QUESTION modes
- **Validation**: Backend validates `timer_mode` must be "GLOBAL" or "PER_QUESTION" (line 181 in `tests.py`)

### Is the timer maintained on Frontend state, Backend state, or Both?
- **Frontend state**: `useDSTimer` hook maintains timer state (lines 44-48 in `useDSTimer.ts`)
- **Backend state**: Stores `started_at` timestamp in `test_submissions` collection
- **Both**: 
  - Frontend: Real-time countdown via `setInterval` (1 second)
  - Backend: Authoritative `started_at` timestamp used to calculate remaining time on page load

---

## 5. Per-Question Timer Behavior

### What currently happens when a per-question timer reaches zero?
- **Auto-submit**: Question is NOT auto-submitted
- **Auto-lock**: Question is marked as submitted via `setSubmittedQuestions` (line 1129 in `take.tsx`)
- **Auto-navigate**: Automatically moves to next question (line 1134) or submits test if last question (line 1136)

### Is the question auto-submitted right now?
- **No**: Code submission is NOT triggered automatically
- **Yes**: Question is marked as "submitted" in frontend state, unlocking next question

### Is the question locked after timeout?
- **Yes**: Question is marked in `submittedQuestions` state (line 1129)
- **Effect**: Prevents going back to timed-out question in PER_QUESTION mode (line 1240)

### Can the user navigate back to a timed-out question?
- **PER_QUESTION mode**: NO - Sequential locking prevents going back (line 1238-1244)
- **GLOBAL mode**: YES - All questions accessible, no sequential locking

### Is the timeout event sent to the backend?
- **No**: Timeout is handled entirely in frontend
- **Backend only receives**: Final submission via `/tests/{test_id}/final-submit` endpoint

---

## 6. Navigation & Locking

### How is question navigation handled?
- **Index-based**: Uses `currentQuestionIndex` state (line 142 in `take.tsx`)
- **Function**: `handleQuestionChange(index: number)` (line 1231)

### Is there any logic preventing revisits to completed questions?
- **PER_QUESTION mode**: YES - Sequential locking (line 1238-1244)
  - Can only navigate forward if previous question is submitted
  - Alert shown if trying to skip: "Please submit Question X before moving to Question X+1"
- **GLOBAL mode**: NO - All questions accessible at any time

### Where is question lock status stored?
- **Frontend memory only**: `submittedQuestions` state (line 147): `Record<string, boolean>`
- **Not in backend DB**: Lock status is ephemeral, lost on page refresh
- **Recovery**: On refresh, all questions are unlocked again (no persistence)

---

## 7. Backend Communication

### How frequently does the frontend hit the backend during the test?
- **Initial load**: 
  - Fetch test: `/tests/{test_id}` (once)
  - Fetch questions: Multiple calls to `/tests/{test_id}/question/{question_id}` (once per question)
  - Start test: `/tests/{test_id}/start` (once)
- **During test**: 
  - Run code: `/assessment/run` (on user action)
  - Submit test: `/tests/{test_id}/final-submit` (once at end)
- **No polling**: No continuous backend polling during test

### Are timers synced with backend continuously?
- **No**: Timers are NOT synced with backend
- **Initial sync only**: Backend `started_at` timestamp used to initialize frontend timer
- **Frontend authoritative**: Timer runs entirely in frontend after initialization

### Is polling used? If yes, at what interval?
- **No polling**: No setInterval/setTimeout polling backend for timer updates

### Are WebSockets or SSE used anywhere?
- **No**: No WebSockets or Server-Sent Events
- **Communication**: REST API only, request-response pattern

### What events trigger backend updates?
- **Test start**: `POST /tests/{test_id}/start` - Creates/updates `test_submission` with `started_at`
- **Code execution**: `POST /assessment/run` - Runs code against testcases
- **Final submission**: `POST /tests/{test_id}/final-submit` - Submits all answers, marks test as completed

---

## 8. Refresh & Abuse Prevention

### What happens if the user refreshes the page?
- **Timer reset**: Timer recalculates from backend `started_at` timestamp (line 80-95 in `useDSTimer.ts`)
- **Question state lost**: `submittedQuestions` state is reset (frontend-only, not persisted)
- **Code preserved**: Code stored in `code` state may be lost unless stored in localStorage/sessionStorage
- **Navigation reset**: Returns to first question (`currentQuestionIndex` resets)

### Does the backend restore current question and remaining time?
- **Remaining time**: YES - Recalculated from `started_at` + `duration_minutes` (line 97-102 in `useDSTimer.ts`)
- **Current question**: NO - Frontend resets to question 0
- **Question locks**: NO - `submittedQuestions` state is lost

### Is there protection against timer reset on refresh?
- **Partial protection**: Timer recalculates from authoritative `started_at` timestamp
- **No abuse prevention**: User could refresh to reset question locks in PER_QUESTION mode
- **Time cannot be extended**: Backend `started_at` is immutable, so total time is fixed

### Is any anti-tampering logic implemented?
- **Frontend timer**: Can be manipulated via browser DevTools (setInterval can be paused)
- **Backend validation**: Final submission validates `started_at` vs current time
- **No real-time validation**: No continuous backend checks during test

---

## 9. Proctoring Integration

### How often are proctoring events sent to backend?
- **On violation**: Events sent immediately via `POST /api/proctor/record` (line 164 in `instructions.tsx`)
- **Not batched**: Each violation sent individually
- **Frequency**: Depends on violation type (gaze away, tab switch, etc.)

### Are violations batched or sent individually?
- **Individually**: Each violation triggers immediate API call (line 164-178 in `instructions.tsx`)

### Is proctoring tied to timer events?
- **No direct tie**: Proctoring runs independently of timer
- **Both active during test**: Proctoring and timer run in parallel

### Does proctoring affect question submission or locking?
- **No**: Proctoring violations do NOT affect question submission or locking
- **Separate systems**: Proctoring logs violations but doesn't interfere with test flow

---

## 10. Source of Truth

### What is the single source of truth for time remaining?
- **Backend**: `started_at` timestamp in `test_submissions` collection
- **Frontend**: Calculates remaining time from `started_at` + `duration_minutes`
- **Issue**: Frontend timer can drift or be manipulated; backend is authoritative but not continuously validated

### What is the single source of truth for question state?
- **Frontend only**: `submittedQuestions` state (not persisted)
- **Backend**: No question-level state tracking during test
- **Issue**: Question locks are lost on refresh

### Is frontend trusted or backend authoritative?
- **Mixed approach**:
  - **Time**: Backend is authoritative (`started_at`), but frontend calculates remaining time
  - **Question state**: Frontend is trusted (no backend validation)
  - **Final submission**: Backend validates and is authoritative

### Recommendations:
1. **Timer sync**: Add periodic backend validation of remaining time
2. **Question state**: Persist `submittedQuestions` in backend or sessionStorage
3. **Auto-start**: Implement auto-refresh when pre-check countdown reaches 0
4. **Anti-tampering**: Add backend validation of timer state on critical actions



