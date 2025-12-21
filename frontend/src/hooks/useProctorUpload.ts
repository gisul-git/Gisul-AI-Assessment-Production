/**
 * useProctorUpload Hook
 * 
 * Handles snapshot capture, upload, and violation recording.
 */

import { useCallback, useRef } from 'react';

// API endpoint
const PROCTOR_UPLOAD_URL = '/api/proctor/upload';
const PROCTOR_RECORD_URL = '/api/proctor/record';

// Rate limits per event type (ms)
const SNAPSHOT_RATE_LIMITS: Record<string, number> = {
  MULTIPLE_FACES_DETECTED: 10000, // 10 seconds
  GAZE_AWAY: 5000, // 5 seconds
  NO_FACE_DETECTED: 8000, // 8 seconds
  TAB_SWITCH: 5000, // 5 seconds
  FOCUS_LOST: 5000, // 5 seconds
  DEFAULT: 2000, // 2 seconds
};

export interface UploadResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface ViolationData {
  eventType: string;
  timestamp: string;
  assessmentId: string;
  candidateId: string;
  snapshotId?: string;
  metadata?: Record<string, unknown>;
}

interface UseProctorUploadOptions {
  assessmentId: string;
  candidateId: string;
}

export function useProctorUpload({ assessmentId, candidateId }: UseProctorUploadOptions) {
  // Rate limiting refs
  const lastSnapshotTimeRef = useRef<Record<string, number>>({});
  const lastSnapshotIdRef = useRef<Record<string, string>>({});

  // Helper to get current candidateId (re-reads from sessionStorage if needed)
  const getCurrentCandidateId = useCallback((): string => {
    if (candidateId && candidateId.trim() !== '') {
      return candidateId;
    }
    // Fallback to sessionStorage
    if (typeof window !== 'undefined') {
      const fromSession = sessionStorage.getItem('candidateEmail');
      if (fromSession && fromSession.trim() !== '') {
        return fromSession;
      }
    }
    return '';
  }, [candidateId]);

  // Capture snapshot from video element
  const captureSnapshot = useCallback((videoElement: HTMLVideoElement): string | null => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 480;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('[ProctorUpload] Failed to get canvas context');
        return null;
      }

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      
      console.log('[ProctorUpload] Snapshot captured, size:', Math.round(dataUrl.length / 1024), 'KB');
      return dataUrl;
    } catch (error) {
      console.error('[ProctorUpload] Error capturing snapshot:', error);
      return null;
    }
  }, []);

  // Upload snapshot to backend
  const uploadSnapshot = useCallback(async (
    videoElement: HTMLVideoElement,
    eventType: string
  ): Promise<UploadResult> => {
    const now = Date.now();
    const rateLimit = SNAPSHOT_RATE_LIMITS[eventType] || SNAPSHOT_RATE_LIMITS.DEFAULT;
    const lastTime = lastSnapshotTimeRef.current[eventType] || 0;

    // Rate limiting check
    if (now - lastTime < rateLimit) {
      console.log(`[ProctorUpload] Rate limited for ${eventType}, using last snapshot ID`);
      const lastId = lastSnapshotIdRef.current[eventType];
      if (lastId) {
        return { success: true, id: lastId };
      }
      return { success: false, error: 'Rate limited' };
    }

    // Capture snapshot
    const snapshotBase64 = captureSnapshot(videoElement);
    if (!snapshotBase64) {
      return { success: false, error: 'Failed to capture snapshot' };
    }

    // Convert base64 to blob
    const base64Data = snapshotBase64.split(',')[1];
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/jpeg' });

    // Get current candidateId (re-reads from sessionStorage if needed)
    const currentCandidateId = getCurrentCandidateId();
    
    // Create form data - send both candidateId and userId for compatibility
    const formData = new FormData();
    formData.append('file', blob, `snapshot_${Date.now()}.jpg`);
    formData.append('metadata', JSON.stringify({
      eventType,
      timestamp: new Date().toISOString(),
      assessmentId,
      candidateId: currentCandidateId,
      userId: currentCandidateId, // Backend expects userId
    }));

    // Upload with retry
    let retries = 1;
    let lastError = '';

    while (retries >= 0) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(PROCTOR_UPLOAD_URL, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const result = await response.json();
          console.log('[ProctorUpload] Upload successful:', result);
          
          // Update rate limiting refs
          lastSnapshotTimeRef.current[eventType] = now;
          if (result.id) {
            lastSnapshotIdRef.current[eventType] = result.id;
          }
          
          return { success: true, id: result.id };
        } else if (response.status >= 500) {
          lastError = `Server error: ${response.status}`;
          retries--;
          console.warn(`[ProctorUpload] Server error ${response.status}, retrying...`);
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          lastError = `Client error: ${response.status}`;
          console.warn(`[ProctorUpload] Client error ${response.status}, not retrying`);
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ProctorUpload] Upload error:', error);
        retries--;
        if (retries >= 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    return { success: false, error: lastError };
  }, [assessmentId, captureSnapshot, getCurrentCandidateId]);

  // Record violation to backend (with optional snapshot)
  const recordViolation = useCallback(async (
    data: ViolationData,
    videoElement?: HTMLVideoElement | null
  ): Promise<boolean> => {
    try {
      // Capture snapshot if video element provided and this is a snapshot event
      let snapshotBase64: string | undefined;
      // TAB_SWITCH and FOCUS_LOST snapshots disabled per request
      const snapshotEvents = ['GAZE_AWAY', 'MULTIPLE_FACES_DETECTED', 'NO_FACE_DETECTED'];
      
      if (videoElement && snapshotEvents.includes(data.eventType)) {
        const now = Date.now();
        const rateLimit = SNAPSHOT_RATE_LIMITS[data.eventType] || SNAPSHOT_RATE_LIMITS.DEFAULT;
        const lastTime = lastSnapshotTimeRef.current[data.eventType] || 0;
        
        // Only capture if not rate limited
        if (now - lastTime >= rateLimit) {
          snapshotBase64 = captureSnapshot(videoElement) || undefined;
          if (snapshotBase64) {
            lastSnapshotTimeRef.current[data.eventType] = now;
          }
        }
      }

      // Get current candidateId (re-reads from sessionStorage if needed)
      const currentCandidateId = getCurrentCandidateId() || data.candidateId;
      
      // Backend expects 'userId' not 'candidateId'
      const payload = {
        eventType: data.eventType,
        timestamp: data.timestamp,
        assessmentId: assessmentId || data.assessmentId,
        userId: currentCandidateId, // Map candidateId to userId
        metadata: data.metadata,
        snapshotBase64: snapshotBase64, // Include snapshot directly
      };

      console.log('[ProctorUpload] Sending violation:', {
        eventType: payload.eventType,
        assessmentId: payload.assessmentId,
        userId: payload.userId,
        userIdType: typeof payload.userId,
        userIdLength: payload.userId?.length,
        userIdValue: payload.userId, // Explicit value for debugging
        hasSnapshot: !!snapshotBase64,
        snapshotSize: snapshotBase64 ? Math.round(snapshotBase64.length / 1024) + 'KB' : 'none',
        currentCandidateId: currentCandidateId,
        dataCandidateId: data.candidateId,
      });

      // Validate required fields
      if (!payload.userId || payload.userId.trim() === '') {
        console.error('[ProctorUpload] ERROR: userId is empty! Cannot record violation.');
        return false;
      }
      if (!payload.assessmentId || payload.assessmentId.trim() === '') {
        console.error('[ProctorUpload] ERROR: assessmentId is empty! Cannot record violation.');
        return false;
      }

      const response = await fetch(PROCTOR_RECORD_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[ProctorUpload] Violation recorded:', data.eventType, result);
        return true;
      } else {
        const errorText = await response.text();
        console.error('[ProctorUpload] Failed to record violation:', response.status, errorText);
        return false;
      }
    } catch (error) {
      console.error('[ProctorUpload] Error recording violation:', error);
      return false;
    }
  }, [assessmentId, captureSnapshot, getCurrentCandidateId]);

  return {
    captureSnapshot,
    uploadSnapshot,
    recordViolation,
  };
}

export default useProctorUpload;
