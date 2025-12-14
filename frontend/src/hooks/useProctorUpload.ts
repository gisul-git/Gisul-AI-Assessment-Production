import { useCallback, useRef } from 'react';
import axios from 'axios';

interface UploadSnapshotParams {
  assessmentId: string;
  candidateId: string;
  eventType: string;
  timestamp: string;
  snapshotBlob: Blob; // JPEG Blob
  metadata?: Record<string, any>;
}

interface RecordViolationParams {
  assessmentId: string;
  candidateId: string;
  eventType: string;
  timestamp: string;
  snapshotId?: string;
  metadata?: Record<string, any>;
}

// Different rate limits per event type to prevent duplicate snapshots
// Only MULTIPLE_FACES_DETECTED has increased limit, others use default
const UPLOAD_DEBOUNCE_MS: Record<string, number> = {
  'MULTIPLE_FACES_DETECTED': 10000, // 10 seconds for multiple faces (most frequent false positive)
  'default': 2000, // 2 seconds default for all other events
};
const PROCTOR_UPLOAD_URL = '/api/proctor/upload'; // Frontend API route (forwards to backend)

export function useProctorUpload() {
  const lastUploadTimeRef = useRef<Record<string, number>>({});
  const lastSnapshotIdRef = useRef<Record<string, string>>({}); // Track last snapshot ID per event type

  const uploadSnapshot = useCallback(async (params: UploadSnapshotParams): Promise<{ success: boolean; id?: string; url?: string }> => {
    const { eventType, timestamp } = params;
    const now = Date.now();
    const lastTime = lastUploadTimeRef.current[eventType] || 0;
    
    // Rate limiting: different limits per event type
    const debounceMs = UPLOAD_DEBOUNCE_MS[eventType] || UPLOAD_DEBOUNCE_MS['default'];
    if (now - lastTime < debounceMs) {
      const lastSnapshotId = lastSnapshotIdRef.current[eventType];
      const timeRemaining = Math.ceil((debounceMs - (now - lastTime)) / 1000);
      if (lastSnapshotId) {
        // Return the last snapshot ID so violation can still be linked to a snapshot
        console.log(`[ProctorUpload] ⏳ Rate limited ${eventType} upload (${timeRemaining}s remaining), reusing last snapshot ID: ${lastSnapshotId}`);
        return { success: true, id: lastSnapshotId };
      }
      console.log(`[ProctorUpload] ⏳ Rate limited ${eventType} upload (${timeRemaining}s remaining), no previous snapshot available`);
      return { success: false };
    }
    
    lastUploadTimeRef.current[eventType] = now;

    // Prepare multipart/form-data
    const formData = new FormData();
    formData.append('file', params.snapshotBlob, 'snapshot.jpg');
    
    // Add metadata as JSON string
    const metadataJson = JSON.stringify({
      eventType: params.eventType,
      timestamp: params.timestamp,
      assessmentId: params.assessmentId,
      userId: params.candidateId,
      ...(params.metadata || {}),
    });
    formData.append('metadata', metadataJson);

    // Retry logic: retry once for 5xx errors, surface warning for 4xx
    let retries = 2;
    while (retries > 0) {
      try {
        const response = await axios.post(PROCTOR_UPLOAD_URL, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 10000, // 10s timeout
        });

        // Backend returns { status: 'ok', id: '<snapshotId>' }
        if (response.data?.status === 'ok' || response.data?.success || response.data?.id) {
          const snapshotId = response.data.id;
          // Store the snapshot ID for this event type (for rate limiting fallback)
          lastSnapshotIdRef.current[eventType] = snapshotId;
          console.log(`[Proctor Upload] Snapshot uploaded: { eventType: ${eventType}, assessmentId: ${params.assessmentId}, userId: ${params.candidateId}, snapshotSize: ${params.snapshotBlob.size}, snapshotId: ${snapshotId} }`);
          return {
            success: true,
            id: snapshotId,
            url: response.data.url || response.data.thumbnailUrl,
          };
        }
        return { success: false };
      } catch (error: any) {
        const status = error.response?.status;
        const serverResponse = error.response?.data;
        
        // Log server response
        console.error(`[Proctor Upload] Server response:`, serverResponse || error.message);
        
        // 4xx errors: surface warning, don't retry
        if (status >= 400 && status < 500) {
          console.warn(`[Proctor Upload] Client error (${status}):`, serverResponse?.message || error.message);
          return { success: false };
        }
        
        // 5xx errors: retry once
        retries--;
        if (retries === 0) {
          console.error(`[Proctor Upload] Backend error: ${error.message || error}`);
          return { success: false };
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return { success: false };
  }, []);

  const recordViolation = useCallback(async (params: RecordViolationParams): Promise<boolean> => {
    try {
      const response = await axios.post('/api/proctor/record', {
        eventType: params.eventType,
        timestamp: params.timestamp,
        assessmentId: params.assessmentId,
        userId: params.candidateId,
        hasSnapshot: !!params.snapshotId,
        snapshotId: params.snapshotId || null,
        metadata: params.metadata || null,
      });

      if (response.data?.status === 'ok' || response.data?.success) {
        console.log('[ProctorUpload] Violation recorded');
        return true;
      }
      return false;
    } catch (error: any) {
      console.error('[ProctorUpload] Record failed:', error);
      return false;
    }
  }, []);

  return { uploadSnapshot, recordViolation };
}


