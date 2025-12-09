/**
 * Violation Handler Module
 * 
 * Handles proctoring violations, captures screenshots, and logs to backend
 */

export type ViolationType =
  | "NO_FACE_DETECTED"
  | "MULTIPLE_FACES_DETECTED"
  | "FACE_MISMATCH"
  | "FACE_OBSTRUCTED"
  | "TAB_SWITCH"
  | "FULLSCREEN_EXIT"
  | "COPY_PASTE_ATTEMPT"
  | "SCREENSHOT_ATTEMPT"
  | "DEVTOOLS_OPEN"
  | "CAMERA_DENIED"
  | "CAMERA_ERROR";

export interface Violation {
  type: ViolationType;
  timestamp: string;
  assessmentId: string;
  candidateEmail: string;
  metadata?: Record<string, unknown>;
  screenshot?: string; // Base64 encoded image
}

/**
 * Capture screenshot from video element or canvas
 */
export function captureScreenshot(
  videoElement?: HTMLVideoElement,
  canvasElement?: HTMLCanvasElement
): string | null {
  try {
    const canvas = canvasElement || document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return null;
    }

    // If we have a video element, capture from it
    if (videoElement && videoElement.readyState === 4) {
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 480;
      ctx.drawImage(videoElement, 0, 0);
    } else {
      // Otherwise, try to capture the screen (if available)
      // Note: Screen capture requires user permission and may not work in all browsers
      return null;
    }

    // Convert to base64 JPEG
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch (error) {
    console.error("[ViolationHandler] Failed to capture screenshot:", error);
    return null;
  }
}

/**
 * Log violation to backend
 */
export async function logViolation(
  violation: Violation,
  apiEndpoint: string = "/api/proctor/record"
): Promise<boolean> {
  try {
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: violation.candidateEmail,
        assessmentId: violation.assessmentId,
        eventType: violation.type,
        timestamp: violation.timestamp,
        metadata: violation.metadata || {},
        snapshotBase64: violation.screenshot || null,
      }),
    });

    if (!response.ok) {
      console.error("[ViolationHandler] Failed to log violation:", response.statusText);
      return false;
    }

    console.log(`[ViolationHandler] Violation logged: ${violation.type}`);
    return true;
  } catch (error) {
    console.error("[ViolationHandler] Error logging violation:", error);
    return false;
  }
}

/**
 * Create a violation object
 */
export function createViolation(
  type: ViolationType,
  assessmentId: string,
  candidateEmail: string,
  metadata?: Record<string, unknown>,
  screenshot?: string
): Violation {
  return {
    type,
    timestamp: new Date().toISOString(),
    assessmentId,
    candidateEmail,
    metadata,
    screenshot,
  };
}



