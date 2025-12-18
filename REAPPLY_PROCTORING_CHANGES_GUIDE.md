## Reapply Guide: Unified Proctoring Gate + AI Proctoring Checkbox (All Sections)

This document is a **source-of-truth** for the proctoring work completed in this repo.
If a teammate’s branch overwrites changes, use this as a checklist to **reapply everything** quickly and safely.

---

## 0) What’s implemented (behavior)

### A) Unified candidate gate flow for all sections
All candidate flows (AI assessment, DSA, Custom MCQ, AIML) go through the same gate:

- **Precheck** (browser/network/camera/mic)
- **Instructions**
- **Candidate Requirements**
- **Identity Verify** (photo capture + ENTIRE SCREEN share + fullscreen)
- Then redirect to the correct take page for that product.

### B) “AI Proctoring” is a **single checkbox** (same UI as AI create-new)
Admin-side checkbox:

- **Label**: “Enable AI Proctoring (camera-based: no face, multiple faces, gaze away)”
- **Saved field**: `proctoringSettings.aiProctoringEnabled` (boolean)

Runtime behavior:

- **Photo capture remains required** (identity verification).
- If `aiProctoringEnabled` is **false**, we **disable AI camera violations** (no-face/multi-face/gaze-away) by not running camera proctoring on take pages.
- Other integrity mechanisms (fullscreen, tab switch, screen share, gate flow) remain enforced.

### C) DSA candidate UI: show the same webcam preview tile as AI
DSA take page uses the same bottom-right `WebcamPreview` tile when AI camera proctoring is enabled.

### D) Precheck camera step is robust again
Camera precheck now attempts preferred constraints (HD) and falls back to `video: true`.

---

## 1) Files added

### `frontend/src/lib/gateContext.ts`
Purpose: store cross-flow routing context in `sessionStorage` so the shared gate can route to each product’s final take page.

- Key: `gateContext_<assessmentId>`
- Fields: `flowType`, `entryUrl`, `finalTakeUrl`, candidate identity fields.

---

## 2) Gate routing: entry/verify pages updated

These pages must set `candidateEmail`, `candidateName` and store `GateContext`, then route into:

`/precheck/<assessmentId>/<token>`

### DSA candidate entry
- File: `frontend/src/pages/test/[id].tsx`
- Sets gate context:
  - `flowType: "dsa"`
  - `finalTakeUrl: /test/<id>/take?...`
  - `entryUrl: /test/<id>?token=...`

### Custom MCQ candidate entry
- File: `frontend/src/pages/custom-mcq/entry/[assessmentId].tsx`
- Also sets shared keys:
  - `candidateEmail`, `candidateName`
- Sets gate context:
  - `flowType: "custom-mcq"`
  - `finalTakeUrl: /custom-mcq/take/<assessmentId>?token=...`
  - `entryUrl: /custom-mcq/entry/<assessmentId>?token=...`

### AIML candidate verify
- File: `frontend/src/pages/aiml/test/[id].tsx`
- **Important**: does NOT auto-start test before gate anymore.
- Sets gate context:
  - `flowType: "aiml"`
  - `finalTakeUrl: /aiml/test/<id>/take?...`
  - `entryUrl: /aiml/test/<id>?token=...`

---

## 3) Gate pages updated (flow-aware)

### Shared precheck
- File: `frontend/src/pages/precheck/[assessmentId]/[token]/index.tsx`
- Behavior:
  - If candidate session missing, redirect to `gateContext.entryUrl` if present; otherwise AI default.
  - Backend `POST /api/assessment/precheck-complete` runs only for AI (`flowType === "ai"` or missing).

#### Camera check robustness (Step 3)
Still in the same file:
- Try HD constraints first
- Fallback to `getUserMedia({ video: true })`
- Better error messages for:
  - `NotAllowedError`, `NotFoundError`, `NotReadableError`

### Instructions gate
- File: `frontend/src/pages/assessment/[id]/[token]/instructions-new.tsx`
- AI: fetch schedule via `/api/assessment/get-schedule`
- Non-AI: skip fetch and display defaults

### Candidate requirements gate
- File: `frontend/src/pages/assessment/[id]/[token]/candidate-requirements.tsx`
- AI: fetch assessment settings + call AI-only backend endpoints
- Non-AI: use default requirements and **skip AI-only backend save/upload**

### Identity verify gate → route to correct take page
- File: `frontend/src/pages/assessment/[id]/[token]/identity-verify.tsx`
- On completion:
  - If `gateContext.finalTakeUrl` exists, redirect there
  - Else fallback to AI `/assessment/<id>/<token>/take`

---

## 4) Take pages: enforce gate completion + AI proctor toggle

### Enforce gate completion (deep-link safety)
Added to:
- `frontend/src/pages/test/[id]/take.tsx` (DSA)
- `frontend/src/pages/custom-mcq/take/[assessmentId].tsx`
- `frontend/src/pages/aiml/test/[id]/take.tsx`

They check `sessionStorage` flags:
- `precheckCompleted_<id>`
- `instructionsAcknowledged_<id>`
- `candidateRequirementsCompleted_<id>`
- `identityVerificationCompleted_<id>`

and redirect back to the correct gate page if missing.

### AI proctoring toggle usage
On take pages, camera proctoring is conditional:
- If `proctoringSettings.aiProctoringEnabled` is missing, we default to **ON** for backward compatibility.

Files:
- DSA: `frontend/src/pages/test/[id]/take.tsx`
- AIML: `frontend/src/pages/aiml/test/[id]/take.tsx`
- Custom MCQ: `frontend/src/pages/custom-mcq/take/[assessmentId].tsx`
- AI multi-section take: `frontend/src/pages/assessment/[id]/[token]/take-new.tsx`

### DSA webcam tile UI (match AI)
- File: `frontend/src/pages/test/[id]/take.tsx`
- Uses `WebcamPreview`:
  - shows only when `cameraProctorEnabled` is true
  - eliminates “Camera Off” widget confusion

### DSA camera start condition
- File: `frontend/src/pages/test/[id]/take.tsx`
- Camera starts after questions load, not gated by `timerStarted` (fixes camera staying off when timer is 0).

---

## 5) Admin create pages: single checkbox UI (matches AI first section)

The repo includes a multi-option `ProctoringSettings` component, but we intentionally **do not use it**.
We use the same **single checkbox** block as the AI assessment “create-new” flow.

### AI assessment create page (reference)
- File: `frontend/src/pages/assessments/create-new.tsx`
- Saved into schedule as:
  - `schedule.proctoringSettings.aiProctoringEnabled`

### DSA create page
- File: `frontend/src/pages/dsa/create.tsx`
- Includes a “Proctoring Settings” card + single checkbox
- Sends:
  - `proctoringSettings: { aiProctoringEnabled }`

### AIML create page
- File: `frontend/src/pages/aiml/create.tsx`
- Same single checkbox card
- Sends:
  - `proctoringSettings: { aiProctoringEnabled }`

### Custom MCQ create flow
- File: `frontend/src/pages/custom-mcq/create.tsx`
- Single checkbox card is shown on **Station 5 (Schedule)** to match AI placement
- Persisted in drafts/updates as:
  - `proctoringSettings: { aiProctoringEnabled }`

---

## 6) Backend persistence for aiProctoringEnabled (non-breaking)

### DSA backend
- Model: `backend/app/api/v1/dsa/models/test.py`
  - Added optional `proctoringSettings`
- Routers: `backend/app/api/v1/dsa/routers/tests.py`
  - Include `proctoringSettings` in:
    - create response
    - list response
    - get test response

### AIML backend
- Model: `backend/app/api/v1/aiml/models/test.py`
  - Added optional `proctoringSettings`
- Routers: `backend/app/api/v1/aiml/routers/tests.py`
  - Include `proctoringSettings` in:
    - create response
    - list response
    - candidate test fetch (`/candidate`)

### Custom MCQ backend
- Schemas: `backend/app/api/v1/custom_mcq/schemas.py`
  - Added optional `proctoringSettings` to create/update schemas
- Routers: `backend/app/api/v1/custom_mcq/routers.py`
  - Store `proctoringSettings` on create
  - Update `proctoringSettings` on update
  - Candidate take fetch already serializes the full assessment (so it returns this field automatically)

---

## 7) Quick “reapply checklist” (copy/paste)

If changes are overwritten, reapply in this order:

1. Add `frontend/src/lib/gateContext.ts`
2. Update candidate entry/verify pages:
   - `frontend/src/pages/test/[id].tsx`
   - `frontend/src/pages/custom-mcq/entry/[assessmentId].tsx`
   - `frontend/src/pages/aiml/test/[id].tsx`
3. Update gate pages:
   - `frontend/src/pages/precheck/[assessmentId]/[token]/index.tsx` (flow-aware + camera fallback)
   - `frontend/src/pages/assessment/[id]/[token]/instructions-new.tsx`
   - `frontend/src/pages/assessment/[id]/[token]/candidate-requirements.tsx`
   - `frontend/src/pages/assessment/[id]/[token]/identity-verify.tsx` (redirect to finalTakeUrl)
4. Take pages:
   - Gate enforcement + aiProctoringEnabled runtime toggle
   - DSA uses WebcamPreview and starts camera after questions load
5. Admin create pages:
   - Ensure only the single checkbox UI exists in:
     - `frontend/src/pages/dsa/create.tsx`
     - `frontend/src/pages/aiml/create.tsx`
     - `frontend/src/pages/custom-mcq/create.tsx` (schedule station)
6. Backend:
   - Add and return `proctoringSettings` for DSA/AIML/Custom MCQ as described above

---

## 8) Notes / Known-good defaults

- **Backward compatibility default**: if `aiProctoringEnabled` is missing, runtime defaults to **ON** (so old tests keep working).
- **Identity photo capture** remains required regardless of the checkbox.
- **Camera precheck** can still fail if camera permissions are blocked or device is in use, but the fallback improves success rate.


