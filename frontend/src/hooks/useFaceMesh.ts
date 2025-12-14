import { useEffect, useRef, useState, useCallback } from 'react';

export interface FaceDetectionResult {
  facesCount: number;
  gazeAway: boolean;
  multiFace: boolean;
}

// CRITICAL: Set up createMediapipeSolutionsPackedAssets at module level
// This ensures it's available before any MediaPipe scripts are loaded
if (typeof window !== 'undefined') {
  // Define locateFile function that points to our public directory
  const locateFileFn = (file: string, prefix?: string) => {
    const filePath = file.startsWith('/') ? file.slice(1) : file;
    const url = `/mediapipe/face_mesh/${filePath}`;
    console.log(`[FaceMesh] locateFile called: ${file} -> ${url}`);
    return url;
  };

  // Create Module object with locateFile
  const moduleWithLocateFile: any = {
    locateFile: locateFileFn,
    locateFilePackage: locateFileFn,
    expectedDataFileDownloads: 0,
  };

  // ALWAYS set it on window (even if MediaPipe has set it, we want to ensure our locateFile is used)
  // The loader script will use this object when it runs
  (window as any).createMediapipeSolutionsPackedAssets = moduleWithLocateFile;

  // Also set on window.Module as fallback
  if (!(window as any).Module) {
    (window as any).Module = {};
  }
  (window as any).Module.locateFile = locateFileFn;
  (window as any).Module.locateFilePackage = locateFileFn;
  
  console.log('[FaceMesh] Module-level createMediapipeSolutionsPackedAssets configured');
}

interface UseFaceMeshOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  onDetection?: (result: FaceDetectionResult) => void;
  enabled?: boolean;
}

export function useFaceMesh({ videoRef, onDetection, enabled = true }: UseFaceMeshOptions) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const faceMeshRef = useRef<any>(null);
  const blazefaceDetectorRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectionRef = useRef<FaceDetectionResult | null>(null);
  const frameCountRef = useRef(0);
  const THROTTLE_FPS = 12; // ~12 FPS detection
  
  // Debounced face counting: require same detection for 2 consecutive frames to increment, 3 missing frames to decrement
  const debouncedFacesCountRef = useRef<number>(0);
  const faceCountStabilityRef = useRef<{ count: number; consecutiveMatches: number; consecutiveMisses: number }>({
    count: 0,
    consecutiveMatches: 0,
    consecutiveMisses: 0,
  });

  // Gaze-away state tracking
  const gazeAwayStartTimeRef = useRef<number | null>(null);
  const lastGazeAwayEventTimeRef = useRef<number>(0);
  const gazeAwayStateRef = useRef<'idle' | 'detecting' | 'cooldown'>('idle');
  
  // Track FaceMesh detection for gaze-away only (not for face counting)
  // Face counting is handled entirely by BlazeFace
  const faceMeshHasFaceRef = useRef<boolean>(false);
  const faceMeshNoFaceCountRef = useRef<number>(0);
  
  // Validate FaceMesh landmarks to ensure they're real, not stale
  const validateFaceMeshLandmarks = useCallback((landmarks: any[]): boolean => {
    if (!landmarks || landmarks.length < 468) return false;
    
    // Check if key landmarks exist and are within reasonable bounds (0-1 normalized)
    const keyLandmarks = [
      landmarks[1],  // Nose tip
      landmarks[33], // Left eye
      landmarks[263], // Right eye
      landmarks[152], // Chin
      landmarks[10], // Forehead
    ];
    
    // Check all key landmarks exist
    if (!keyLandmarks.every(lm => lm && typeof lm.x === 'number' && typeof lm.y === 'number')) {
      return false;
    }
    
    // Check landmarks are within valid bounds (0-1 normalized coordinates)
    const allValid = keyLandmarks.every(lm => {
      return lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;
    });
    
    if (!allValid) {
      return false;
    }
    
    // Check face size is reasonable (not too small or too large)
    const xs = keyLandmarks.map(lm => lm.x);
    const ys = keyLandmarks.map(lm => lm.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    
    // Face should be at least 5% of frame and at most 80% of frame
    if (width < 0.05 || height < 0.05 || width > 0.8 || height > 0.8) {
      return false;
    }
    
    return true;
  }, []);

  // Compute yaw and pitch from face landmarks
  // MediaPipe FaceMesh landmarks: https://github.com/google/mediapipe/blob/master/docs/solutions/face_mesh.md
  const computeHeadPose = useCallback((landmarks: any[]): { yaw: number; pitch: number } | null => {
    if (!landmarks || landmarks.length < 468) return null;
    
    // Key landmarks for head pose estimation
    // MediaPipe FaceMesh landmark indices (0-467):
    // Nose tip: 1 or 4
    // Left eye outer corner: 33
    // Right eye outer corner: 263
    // Left cheek: 234
    // Right cheek: 454
    // Chin: 152 or 18
    // Forehead: 10
    // Nose bridge: 6 or 168
    
    const noseTip = landmarks[1] || landmarks[4];      // Nose tip (fallback to 4)
    const leftEye = landmarks[33];                      // Left eye outer corner
    const rightEye = landmarks[263];                   // Right eye outer corner
    const leftCheek = landmarks[234];                   // Left cheek
    const rightCheek = landmarks[454];                  // Right cheek
    const chin = landmarks[152] || landmarks[18];      // Chin (fallback to 18)
    const forehead = landmarks[10];                     // Forehead center
    const noseBridge = landmarks[6] || landmarks[168]; // Nose bridge (fallback to 168)
    
    if (!noseTip || !leftEye || !rightEye || !chin || !forehead || !noseBridge) {
      return null;
    }

    // Yaw (left/right rotation): use eye positions for more accurate detection
    // When head turns left, right eye moves forward (smaller x), left eye moves back
    // When head turns right, left eye moves forward, right eye moves back
    const eyeCenterX = (leftEye.x + rightEye.x) / 2;
    const faceCenterX = 0.5; // Normalized center
    const yawOffset = eyeCenterX - faceCenterX;
    // Convert to degrees: normalize to -1 to 1, then scale
    // 0.1 offset ≈ 15-20 degrees
    const yaw = yawOffset * 150; // Scale factor for degrees

    // Pitch (up/down rotation): compare nose tip to nose bridge and chin
    // When looking down, nose tip moves down relative to bridge
    // When looking up, nose tip moves up
    const noseVertical = noseTip.y - noseBridge.y;
    const faceVertical = chin.y - forehead.y;
    if (Math.abs(faceVertical) < 0.01) return null; // Avoid division by zero
    const pitchOffset = noseVertical / faceVertical;
    // Normalize: when looking straight, pitchOffset ≈ 0.2-0.3
    // When looking down, pitchOffset increases
    // When looking up, pitchOffset decreases
    const pitch = (pitchOffset - 0.25) * 120; // Scale and offset for degrees

    return { yaw, pitch };
  }, []);

  // Check if candidate gaze-away: |yaw| > 20° OR |pitch| > 25°
  const isCandidateGazeAway = useCallback((yaw: number, pitch: number): boolean => {
    return Math.abs(yaw) > 20 || Math.abs(pitch) > 25;
  }, []);

  // Compute bounding box from landmarks
  const computeBoundingBox = useCallback((landmarks: any[], videoWidth: number, videoHeight: number) => {
    if (!landmarks || landmarks.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of landmarks) {
      const x = point.x * videoWidth;
      const y = point.y * videoHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return {
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      w: Math.min(videoWidth, maxX) - Math.max(0, minX),
      h: Math.min(videoHeight, maxY) - Math.max(0, minY),
    };
  }, []);

  // Calculate centroid of bounding box
  const calculateCentroid = useCallback((box: { x: number; y: number; w: number; h: number }) => {
    return {
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
    };
  }, []);

  // Calculate centroid distance between two boxes
  const calculateCentroidDistance = useCallback((box1: { x: number; y: number; w: number; h: number }, box2: { x: number; y: number; w: number; h: number }): number => {
    const c1 = calculateCentroid(box1);
    const c2 = calculateCentroid(box2);
    return Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));
  }, [calculateCentroid]);

  // IoU calculation for filtering overlapping boxes
  const calculateIoU = useCallback((box1: { x: number; y: number; w: number; h: number }, box2: { x: number; y: number; w: number; h: number }): number => {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.w, box2.x + box2.w);
    const y2 = Math.min(box1.y + box1.h, box2.y + box2.h);
    if (x2 <= x1 || y2 <= y1) return 0;
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.w * box1.h;
    const area2 = box2.w * box2.h;
    const union = area1 + area2 - intersection;
    return union > 0 ? intersection / union : 0;
  }, []);

  // Filter overlapping detections: merge if IoU > 0.6 OR centroid distance < 30px
  const filterOverlapping = useCallback((boxes: Array<{ x: number; y: number; w: number; h: number }>, threshold: number = 0.6, centroidThreshold: number = 30) => {
    if (boxes.length <= 1) return boxes;
    const filtered: typeof boxes = [];
    const used = new Set<number>();
    
    for (let i = 0; i < boxes.length; i++) {
      if (used.has(i)) continue;
      let merged = { ...boxes[i] };
      used.add(i);
      
      for (let j = i + 1; j < boxes.length; j++) {
        if (used.has(j)) continue;
        const iou = calculateIoU(merged, boxes[j]);
        const centroidDist = calculateCentroidDistance(merged, boxes[j]);
        
        // Merge if IoU >= threshold OR centroid distance <= centroidThreshold
        // Using >= and <= to be more inclusive and catch edge cases
        if (iou >= threshold || centroidDist <= centroidThreshold) {
          // Merge boxes
          merged = {
            x: Math.min(merged.x, boxes[j].x),
            y: Math.min(merged.y, boxes[j].y),
            w: Math.max(merged.x + merged.w, boxes[j].x + boxes[j].w) - Math.min(merged.x, boxes[j].x),
            h: Math.max(merged.y + merged.h, boxes[j].y + boxes[j].h) - Math.min(merged.y, boxes[j].y),
          };
          used.add(j);
        }
      }
      filtered.push(merged);
    }
    return filtered;
  }, [calculateIoU, calculateCentroidDistance]);

  useEffect(() => {
    // Client-only guard
    if (typeof window === 'undefined') return;
    if (!enabled) return;
    
    // Prevent duplicate instances - check if already initialized
    if (faceMeshRef.current) {
      console.log('[FaceMesh] Instance already exists, skipping reinit');
      return;
    }

    // locateFile is already set at module level, but verify it's still there
    // and use a logging version for this hook
    const locateFileFn = (file: string, prefix?: string) => {
      const filePath = file.startsWith('/') ? file.slice(1) : file;
      const url = `/mediapipe/face_mesh/${filePath}`;
      console.log(`[FaceMesh] locateFile -> ${url}`);
      
      // Store URL for potential 404 logging
      if (typeof window !== 'undefined') {
        if (!(window as any).__faceMeshAssetUrls) {
          (window as any).__faceMeshAssetUrls = [];
        }
        (window as any).__faceMeshAssetUrls.push(url);
      }
      
      return url;
    };

    // Verify createMediapipeSolutionsPackedAssets is set (it should be from module level)
    if (typeof window !== 'undefined') {
      if (!(window as any).createMediapipeSolutionsPackedAssets || 
          !(window as any).createMediapipeSolutionsPackedAssets.locateFile) {
        console.warn('[FaceMesh] createMediapipeSolutionsPackedAssets missing, re-setting...');
        const moduleWithLocateFile: any = {
          locateFile: locateFileFn,
          locateFilePackage: locateFileFn,
          expectedDataFileDownloads: 0,
        };
        (window as any).createMediapipeSolutionsPackedAssets = moduleWithLocateFile;
        (window as any).Module.locateFile = locateFileFn;
        (window as any).Module.locateFilePackage = locateFileFn;
      } else {
        console.log('[FaceMesh] createMediapipeSolutionsPackedAssets already set with locateFile');
      }
    }

    let cancelled = false;
    let faceMeshInstance: any = null;

    async function initFaceMesh() {
      try {
        // Wait for video element and ensure it has a stream and is ready
        if (!videoRef.current) {
          console.warn('[FaceMesh] Video element not available');
          return;
        }

        const video = videoRef.current;
        
        // Wait for video to have stream and be ready (readyState >= 2)
        if (!video.srcObject) {
          console.warn('[FaceMesh] Video has no stream attached');
          return;
        }

        // Wait for video to be ready AND playing before initializing FaceMesh
        await new Promise<void>((resolve) => {
          const checkReady = () => {
            if (video.readyState >= 2 && !video.paused && video.currentTime > 0) {
              console.log('[Webcam] playing (readyState:', video.readyState, ')');
              resolve();
              return true;
            }
            return false;
          };
          
          if (checkReady()) return;
          
          const onPlaying = () => {
            if (checkReady()) {
              video.removeEventListener('playing', onPlaying);
              video.removeEventListener('loadeddata', onPlaying);
              video.removeEventListener('canplay', onPlaying);
            }
          };
          
          video.addEventListener('playing', onPlaying, { once: true });
          video.addEventListener('loadeddata', onPlaying, { once: true });
          video.addEventListener('canplay', onPlaying, { once: true });
          
          // Fallback: if video is already ready, trigger check
          if (video.readyState >= 2) {
            video.play().catch(() => {});
          }
        });

        if (cancelled) return;

        // Load BlazeFace for face detection (counting faces)
        try {
          const blazefaceModule = await import('@tensorflow-models/blazeface');
          const tf = await import('@tensorflow/tfjs');
          await tf.ready();
          blazefaceDetectorRef.current = await blazefaceModule.load();
          console.log('[FaceMesh] BlazeFace loaded for face detection');
        } catch (blazeError) {
          console.error('[FaceMesh] Failed to load BlazeFace:', blazeError);
          // Continue without BlazeFace - FaceMesh can still work
        }

        // locateFileFn is already defined in the outer scope and createMediapipeSolutionsPackedAssets is already set
        // CRITICAL: Ensure createMediapipeSolutionsPackedAssets is properly configured BEFORE importing MediaPipe
        // The loader script runs immediately when MediaPipe is imported, so this must be set first
        if (typeof window !== 'undefined') {
          // Force set createMediapipeSolutionsPackedAssets with proper locateFile
          const moduleWithLocateFile: any = {
            locateFile: locateFileFn,
            locateFilePackage: locateFileFn,
            expectedDataFileDownloads: 0,
          };
          (window as any).createMediapipeSolutionsPackedAssets = moduleWithLocateFile;
          
          // Also ensure Module.locateFile is set
          if (!(window as any).Module) {
            (window as any).Module = {};
          }
          (window as any).Module.locateFile = locateFileFn;
          (window as any).Module.locateFilePackage = locateFileFn;
          
          console.log('[FaceMesh] createMediapipeSolutionsPackedAssets configured before MediaPipe import');
        }

        // Lazy load MediaPipe only after user gesture (when enabled is true)
        // The createMediapipeSolutionsPackedAssets is already set at module level,
        // but we ensure it's still correct right before import
        const faceMeshModule = await import('@mediapipe/face_mesh');
        const FaceMesh = (faceMeshModule as any).FaceMesh || faceMeshModule;
        
        // Initialize FaceMesh with locateFile
        faceMeshInstance = new FaceMesh({
          locateFile: locateFileFn,
        });
        
        // After FaceMesh is created, verify createMediapipeSolutionsPackedAssets still has locateFile
        // The loader might have modified it, so we ensure it's correct
        if (typeof window !== 'undefined') {
          // Wait a moment for the loader to initialize
          await new Promise(resolve => setTimeout(resolve, 50));
          
          const currentModule = (window as any).createMediapipeSolutionsPackedAssets;
          if (currentModule && typeof currentModule === 'object') {
            // Always ensure locateFile is set (MediaPipe loader might have modified it)
            if (!currentModule.locateFile || typeof currentModule.locateFile !== 'function') {
              currentModule.locateFile = locateFileFn;
              currentModule.locateFilePackage = locateFileFn;
              console.log('[FaceMesh] Re-injected locateFile into createMediapipeSolutionsPackedAssets');
            } else {
              console.log('[FaceMesh] createMediapipeSolutionsPackedAssets has locateFile');
            }
          } else {
            // Re-create if it was cleared or is invalid
            const moduleWithLocateFile: any = {
              locateFile: locateFileFn,
              locateFilePackage: locateFileFn,
              expectedDataFileDownloads: 0,
            };
            (window as any).createMediapipeSolutionsPackedAssets = moduleWithLocateFile;
            console.log('[FaceMesh] Re-created createMediapipeSolutionsPackedAssets');
          }
          
          // Also ensure Module.locateFile is set as fallback
          if (!(window as any).Module) {
            (window as any).Module = {};
          }
          (window as any).Module.locateFile = locateFileFn;
          (window as any).Module.locateFilePackage = locateFileFn;
        }

        // Performance-optimized options: maxNumFaces: 1, refineLandmarks: false
        faceMeshInstance.setOptions({
          maxNumFaces: 1, // Limit to 1 face for faster detection
          refineLandmarks: false, // Disable refined landmarks for speed
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        
        console.log('[FaceMesh] assets found: face_mesh_solution_packed_assets.data, face_mesh_solution_simd_wasm_bin.wasm, face_mesh_solution_wasm_bin.wasm');

        // FaceMesh results callback - only processes landmarks for gaze detection
        faceMeshInstance.onResults((results: any) => {
          if (cancelled || !videoRef.current) return;
          
          frameCountRef.current++;
          const video = videoRef.current;
          const faces = results.multiFaceLandmarks || [];

          // DEBUG: Log first few frames to verify landmarks structure
          if (frameCountRef.current <= 3) {
            console.log('[GazeAway] onResults called, faces:', faces.length);
            if (faces.length > 0 && faces[0]) {
              console.log('[GazeAway] First face landmarks:', {
                length: faces[0].length,
                sample: faces[0].slice(0, 5),
                hasNoseTip: !!faces[0][1],
                hasLeftEye: !!faces[0][33],
                hasRightEye: !!faces[0][263],
              });
            }
          }

          // Gaze-away detection with stateful timing logic (only for single face)
          let gazeAway = false;
          const now = Date.now();
          const COOLDOWN_MS = 3000; // 3 seconds cooldown after event
          const GAZE_AWAY_DURATION_MS = 1500; // 1.5 seconds for yaw (sideways)
          const GAZE_DOWN_DURATION_MS = 2500; // 2.5 seconds for pitch (looking down)

          // Update FaceMesh face detection status for dual detection check
          // Validate landmarks are real, not stale
          if (faces.length > 0 && faces[0]) {
            // Validate landmarks before accepting as face detection
            const landmarksValid = validateFaceMeshLandmarks(faces[0]);
            
            if (landmarksValid) {
              // FaceMesh actively detecting valid face in current frame
              faceMeshHasFaceRef.current = true;
              faceMeshNoFaceCountRef.current = 0; // Reset no-face counter when valid face is detected
            } else {
              // Landmarks exist but are invalid/stale - treat as no face
              faceMeshNoFaceCountRef.current++;
              if (frameCountRef.current % 30 === 0) {
                console.log(`[NoFace] FaceMesh landmarks invalid/stale (count: ${faceMeshNoFaceCountRef.current})`);
              }
              
              // Aggressive decay: reset after 2 frames (was 3)
              if (faceMeshNoFaceCountRef.current >= 2) {
                if (faceMeshHasFaceRef.current) {
                  console.log(`[NoFace] FaceMesh: Invalid landmarks for ${faceMeshNoFaceCountRef.current} consecutive frames - resetting face detection flag`);
                }
                faceMeshHasFaceRef.current = false;
              }
            }
            
            const headPose = computeHeadPose(faces[0]);
            
            if (headPose) {
              const { yaw, pitch } = headPose;
              const candidateGazeAway = isCandidateGazeAway(yaw, pitch);
              const isLookingDown = Math.abs(pitch) > 25; // Looking down requires longer duration
              
              // DEBUG: Log every frame for first 10 frames, then every 30 frames
              const shouldLog = frameCountRef.current <= 10 || frameCountRef.current % 30 === 0;
              if (shouldLog) {
                console.log(`[GazeAway] Frame ${frameCountRef.current}: yaw: ${yaw.toFixed(1)}°, pitch: ${pitch.toFixed(1)}°, candidate: ${candidateGazeAway}, state: ${gazeAwayStateRef.current}`);
              }
              
              // Check if we're in cooldown period
              const timeSinceLastEvent = now - lastGazeAwayEventTimeRef.current;
              const inCooldown = timeSinceLastEvent < COOLDOWN_MS;

              if (candidateGazeAway) {
                // Gaze-away detected
                if (gazeAwayStateRef.current === 'idle') {
                  // Start tracking gaze-away duration
                  gazeAwayStartTimeRef.current = now;
                  gazeAwayStateRef.current = 'detecting';
                  console.log(`[GazeAway] ✅ Started detecting (yaw: ${yaw.toFixed(1)}°, pitch: ${pitch.toFixed(1)}°)`);
                } else if (gazeAwayStateRef.current === 'detecting' && gazeAwayStartTimeRef.current) {
                  // Check if duration requirement is met
                  const duration = now - gazeAwayStartTimeRef.current;
                  const requiredDuration = isLookingDown ? GAZE_DOWN_DURATION_MS : GAZE_AWAY_DURATION_MS;
                  
                  if (shouldLog) {
                    console.log(`[GazeAway] Detecting... duration: ${duration}ms / ${requiredDuration}ms, cooldown: ${inCooldown}`);
                  }
                  
                  if (duration >= requiredDuration && !inCooldown) {
                    // Duration met and not in cooldown - trigger GAZE_AWAY event
                    gazeAway = true;
                    lastGazeAwayEventTimeRef.current = now;
                    gazeAwayStateRef.current = 'cooldown';
                    gazeAwayStartTimeRef.current = null;
                    console.log(`[GazeAway] 🚨 EVENT TRIGGERED after ${duration}ms (${isLookingDown ? 'looking down' : 'sideways'}, yaw: ${yaw.toFixed(1)}°, pitch: ${pitch.toFixed(1)}°)`);
                  } else if (duration >= requiredDuration && inCooldown) {
                    // Duration met but in cooldown - reset to detecting to wait for cooldown
                    console.log(`[GazeAway] ⏳ Duration met but in cooldown (${timeSinceLastEvent}ms since last event)`);
                  }
                } else if (gazeAwayStateRef.current === 'cooldown') {
                  // Still in cooldown, ignore
                  if (shouldLog) {
                    console.log(`[GazeAway] ⏸️ In cooldown (${timeSinceLastEvent}ms / ${COOLDOWN_MS}ms)`);
                  }
                }
              } else {
                // User looked back - reset state
                if (gazeAwayStateRef.current !== 'idle') {
                  const previousState = gazeAwayStateRef.current;
                  gazeAwayStateRef.current = 'idle';
                  gazeAwayStartTimeRef.current = null;
                  if (previousState === 'detecting') {
                    console.log(`[GazeAway] 👀 User looked back, reset from detecting to idle`);
                  }
                }
              }
            } else {
              // Head pose calculation failed - log more frequently
              if (frameCountRef.current <= 10 || frameCountRef.current % 60 === 0) {
                console.warn('[GazeAway] ⚠️ computeHeadPose returned null - landmarks may be invalid');
                if (faces[0] && faces[0].length > 0) {
                  console.warn('[GazeAway] Landmarks available:', {
                    length: faces[0].length,
                    hasNoseTip: !!faces[0][1],
                    hasLeftEye: !!faces[0][33],
                    hasRightEye: !!faces[0][263],
                    hasChin: !!faces[0][152],
                    hasForehead: !!faces[0][10],
                  });
                }
              }
            }
          } else {
            // FaceMesh detected no face in current frame - increment counter
            faceMeshNoFaceCountRef.current++;
            
            // Aggressive decay: reset flag after 2 consecutive frames with no landmarks (was 3)
            // This prevents stale detection from keeping face count at 1
            if (faceMeshNoFaceCountRef.current >= 2) {
              if (faceMeshHasFaceRef.current) {
                console.log(`[NoFace] FaceMesh: No landmarks for ${faceMeshNoFaceCountRef.current} consecutive frames - resetting face detection flag`);
              }
              faceMeshHasFaceRef.current = false;
            }
            
            // No face - reset gaze-away state
            if (gazeAwayStateRef.current !== 'idle') {
              gazeAwayStateRef.current = 'idle';
              gazeAwayStartTimeRef.current = null;
            }
          }

          // Face count is handled ENTIRELY by BlazeFace - trust it completely
          // FaceMesh is only used for gaze-away detection, not for face counting
          // This simplifies the logic and prevents dual detection conflicts
          const facesCount = debouncedFacesCountRef.current;
          
          // Update FaceMesh flag for gaze-away detection only (not for face counting)
          if (faces.length > 0 && faces[0]) {
            const landmarksValid = validateFaceMeshLandmarks(faces[0]);
            if (landmarksValid) {
              faceMeshHasFaceRef.current = true;
              faceMeshNoFaceCountRef.current = 0;
            } else {
              faceMeshNoFaceCountRef.current++;
              if (faceMeshNoFaceCountRef.current >= 2) {
                faceMeshHasFaceRef.current = false;
              }
            }
          } else {
            faceMeshNoFaceCountRef.current++;
            if (faceMeshNoFaceCountRef.current >= 2) {
              faceMeshHasFaceRef.current = false;
            }
          }

          // Create result with current face count from BlazeFace
          // This is called from onResults (FaceMesh callback), but uses BlazeFace count
          // Gaze-away is the only FaceMesh-specific detection
          const result: FaceDetectionResult = {
            facesCount,
            gazeAway, // Only true when event is actually triggered
            multiFace: facesCount > 1, // Based on BlazeFace count
          };

          // DEBUG: Log when gazeAway is true
          if (gazeAway) {
            console.log('[GazeAway] 📤 Sending gazeAway=true to onDetection callback');
          }
          
          // DEBUG: Log when multiple faces detected
          if (facesCount > 1) {
            console.log(`[MultiFace] 📤 Reporting ${facesCount} faces from onResults callback`);
          }

          lastDetectionRef.current = result;
          if (onDetection) {
            onDetection(result);
          } else {
            console.warn('[GazeAway] ⚠️ onDetection callback is not defined!');
          }
        });

        // Store instance to prevent duplicates
        faceMeshRef.current = faceMeshInstance;
        setIsModelLoaded(true);
        console.log('[FaceMesh] init success');

        // Start detection loop only after model is loaded and video is ready
        async function detectionLoop() {
          if (cancelled || !faceMeshInstance || !videoRef.current) {
            return;
          }
          
          const video = videoRef.current;
          
          // Only process if video is ready
          if (video.readyState < 2) {
            rafRef.current = requestAnimationFrame(detectionLoop);
            return;
          }
          
          frameCountRef.current++;
          // Run detection every N frames (throttle to ~12 FPS)
          if (frameCountRef.current % Math.ceil(60 / THROTTLE_FPS) === 0) {
            try {
              // Step 1: Use BlazeFace to detect and count faces
              let blazefacePredictions: any[] = [];
              let facesCount = 0;
              
              if (blazefaceDetectorRef.current) {
                try {
                  blazefacePredictions = await blazefaceDetectorRef.current.estimateFaces(video, false);
                  
                  // Filter by confidence (lowered to 0.4 to catch more faces)
                  let validPredictions = blazefacePredictions.filter((p: any) => {
                    const confidence = Array.isArray(p.probability) ? p.probability[0] : p.probability;
                    return confidence > 0.4;
                  });
                  
                  // Convert predictions to bounding boxes for filtering
                  const videoWidth = video.videoWidth || video.clientWidth || 640;
                  const videoHeight = video.videoHeight || video.clientHeight || 480;
                  const frameArea = videoWidth * videoHeight;
                  const minFaceArea = frameArea * 0.01; // Minimum 1% of frame area (relaxed from 2%)
                  
                  let boundingBoxes = validPredictions
                    .map((p: any) => {
                      const start = p.topLeft as [number, number];
                      const end = p.bottomRight as [number, number];
                      const x = start[0];
                      const y = start[1];
                      const w = end[0] - start[0];
                      const h = end[1] - start[1];
                      return { x, y, w, h };
                    })
                    .filter((box: { x: number; y: number; w: number; h: number }) => {
                      // Validate face size (minimum area) - relaxed
                      const area = box.w * box.h;
                      if (area < minFaceArea) {
                        if (frameCountRef.current % 60 === 0) {
                          console.log(`[NoFace] Filtered out face: too small (${area.toFixed(0)} < ${minFaceArea.toFixed(0)})`);
                        }
                        return false; // Too small, likely false positive
                      }
                      
                      // Validate aspect ratio (relaxed: 0.4 to 2.0)
                      const aspectRatio = box.w / box.h;
                      if (aspectRatio < 0.4 || aspectRatio > 2.0) {
                        if (frameCountRef.current % 60 === 0) {
                          console.log(`[NoFace] Filtered out face: invalid aspect ratio (${aspectRatio.toFixed(2)})`);
                        }
                        return false; // Invalid aspect ratio
                      }
                      
                      // Validate face is at least partially within frame bounds (relaxed: allow 50% out of frame)
                      const boxArea = box.w * box.h;
                      const inFrameX = Math.max(0, Math.min(box.x + box.w, videoWidth) - Math.max(0, box.x));
                      const inFrameY = Math.max(0, Math.min(box.y + box.h, videoHeight) - Math.max(0, box.y));
                      const inFrameArea = inFrameX * inFrameY;
                      const inFrameRatio = inFrameArea / boxArea;
                      
                      // Relaxed: only require 50% of face in frame (was 70%)
                      // This allows faces that are partially visible when looking down/sideways
                      if (inFrameRatio < 0.5) {
                        if (frameCountRef.current % 60 === 0) {
                          console.log(`[NoFace] Filtered out face: too much out of frame (${(inFrameRatio * 100).toFixed(0)}% in frame)`);
                        }
                        return false; // Less than 50% of face in frame
                      }
                      
                      return true;
                    });
                  
                  // CRITICAL: Filter overlapping detections BEFORE counting
                  // This prevents the same face from being counted multiple times
                  // Use more aggressive thresholds: IoU 0.3 (lower = merge more) and centroid distance 60px (higher = merge more)
                  const filteredBoxes = filterOverlapping(boundingBoxes, 0.3, 60);
                  
                  facesCount = filteredBoxes.length;
                  
                  // Debug logging for multiple face detection
                  if (facesCount > 1) {
                    console.log(`[MultiFace] Detected ${facesCount} faces (after filtering). Original predictions: ${validPredictions.length}, Valid boxes: ${boundingBoxes.length}`);
                  }
                  
                  // Debounce face counting: require 3 consecutive frames for multiple faces, 2 for single face
                  const stability = faceCountStabilityRef.current;
                  if (facesCount === stability.count) {
                    stability.consecutiveMatches++;
                    stability.consecutiveMisses = 0;
                  } else if (facesCount > stability.count) {
                    // Increasing face count - require more frames for multiple faces
                    const requiredMatches = facesCount > 1 ? 3 : 2; // 3 frames for multiple, 2 for single
                    stability.consecutiveMatches++;
                    stability.consecutiveMisses = 0;
                    if (stability.consecutiveMatches >= requiredMatches) {
                      debouncedFacesCountRef.current = facesCount;
                      stability.count = facesCount;
                      stability.consecutiveMatches = 0;
                      if (facesCount > 1) {
                        console.log(`[MultiFace] ✅ Confirmed ${facesCount} faces after ${requiredMatches} consecutive frames`);
                      }
                    }
                  } else {
                    // Decreasing face count
                    stability.consecutiveMisses++;
                    stability.consecutiveMatches = 0;
                    if (stability.consecutiveMisses >= 3) {
                      debouncedFacesCountRef.current = facesCount;
                      stability.count = facesCount;
                      stability.consecutiveMisses = 0;
                      if (stability.count > 1 && facesCount === 1) {
                        console.log(`[MultiFace] ✅ Confirmed single face after ${stability.consecutiveMisses} consecutive frames`);
                      }
                    }
                  }
                  
                  facesCount = debouncedFacesCountRef.current;
                  
                  // Step 2: Report detection results
                  // Call onDetection for all cases to ensure violations are triggered
                  // Multiple face detection is reported here when confirmed (after debouncing)
                  if (onDetection) {
                    const result: FaceDetectionResult = {
                      facesCount,
                      gazeAway: false, // Gaze-away is handled in onResults callback
                      multiFace: facesCount > 1,
                    };
                    
                    // Debug logging for multiple faces
                    if (facesCount > 1) {
                      console.log(`[MultiFace] 📤 Reporting ${facesCount} faces from BlazeFace loop (debounced count)`);
                    }
                    
                    onDetection(result);
                  }
                  
                  // Step 3: Run FaceMesh only on primary face (first face) for landmarks/gaze
                  // FaceMesh will run on the full frame, but we only care about the first face's landmarks
                  if (facesCount >= 1) {
                    faceMeshInstance.send({ image: video });
                  }
                  
                } catch (blazeErr) {
                  console.warn('[FaceMesh] BlazeFace detection error:', blazeErr);
                  // Fallback: run FaceMesh anyway
                  faceMeshInstance.send({ image: video });
                }
              } else {
                // No BlazeFace available - fallback to FaceMesh only
                faceMeshInstance.send({ image: video });
              }
              
            } catch (err) {
              console.error('[FaceMesh] Detection error:', err);
              cancelled = true;
            }
          }
          
          rafRef.current = requestAnimationFrame(detectionLoop);
        }
        
        // Start detection loop
        rafRef.current = requestAnimationFrame(detectionLoop);
      } catch (error: any) {
        console.error('[FaceMesh] init failed:', error);
        setIsModelLoaded(false);
        
        // Show error to user
        if (typeof window !== 'undefined' && window.console) {
          console.error('[FaceMesh] Asset loading failed. Check that files exist in /public/mediapipe/face_mesh/');
          console.error('[FaceMesh] Error details:', error.message || error);
          
          // Log asset URLs that were attempted (for 404 debugging)
          if ((window as any).__faceMeshAssetUrls) {
            console.error('[FaceMesh] Asset URLs attempted:', (window as any).__faceMeshAssetUrls);
            // Check network panel or try to identify which asset failed
            const errorMessage = error.message || String(error);
            if (errorMessage.includes('404') || errorMessage.includes('Failed to fetch')) {
              console.error('[FaceMesh] Possible 404 on one or more assets. Check network panel for failed requests to /mediapipe/face_mesh/');
            }
          }
          
          // Store error for non-blocking UI message
          (window as any).__faceMeshInitFailed = true;
          (window as any).__faceMeshInitError = error.message || 'Initialization failed';
        }
        cancelled = true;
        
        // Non-blocking: camera preview still works, just proctoring is degraded
      }
    }

    initFaceMesh();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (faceMeshInstance) {
        try {
          faceMeshInstance.close?.();
        } catch (e) {
          // Ignore cleanup errors
        }
        faceMeshInstance = null;
      }
      if (blazefaceDetectorRef.current) {
        blazefaceDetectorRef.current = null;
      }
      // Clear ref on unmount
      faceMeshRef.current = null;
    };
  }, [enabled, videoRef, onDetection, computeHeadPose, isCandidateGazeAway, computeBoundingBox, filterOverlapping, calculateCentroid, calculateCentroidDistance]);

  return { isModelLoaded };
}

