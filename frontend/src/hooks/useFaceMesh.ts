/**
 * useFaceMesh Hook
 * 
 * Provides face detection using BlazeFace for counting and MediaPipe FaceMesh for gaze detection.
 * BlazeFace is the sole source of truth for face counting.
 * FaceMesh is only used for gaze-away detection.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// Detection result interface
export interface DetectionResult {
  facesCount: number;
  gazeAway: boolean;
  multiFace: boolean;
}

// Hook options
interface UseFaceMeshOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  onDetection: (result: DetectionResult) => void;
  enabled?: boolean;
}

// BlazeFace prediction interface
interface BlazeFacePrediction {
  topLeft: [number, number];
  bottomRight: [number, number];
  probability: number;
  landmarks?: number[][];
}

// Compute Intersection over Union for two boxes
function computeIoU(
  box1: { x1: number; y1: number; x2: number; y2: number },
  box2: { x1: number; y1: number; x2: number; y2: number }
): number {
  const xA = Math.max(box1.x1, box2.x1);
  const yA = Math.max(box1.y1, box2.y1);
  const xB = Math.min(box1.x2, box2.x2);
  const yB = Math.min(box1.y2, box2.y2);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const box1Area = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
  const box2Area = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
  const unionArea = box1Area + box2Area - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

// Compute centroid distance
function computeCentroidDistance(
  box1: { x1: number; y1: number; x2: number; y2: number },
  box2: { x1: number; y1: number; x2: number; y2: number }
): number {
  const c1x = (box1.x1 + box1.x2) / 2;
  const c1y = (box1.y1 + box1.y2) / 2;
  const c2x = (box2.x1 + box2.x2) / 2;
  const c2y = (box2.y1 + box2.y2) / 2;
  return Math.sqrt((c1x - c2x) ** 2 + (c1y - c2y) ** 2);
}

export function useFaceMesh({ videoRef, onDetection, enabled = true }: UseFaceMeshOptions) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [facesCount, setFacesCount] = useState(0);

  // Refs
  const blazefaceModelRef = useRef<any>(null);
  const faceMeshRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const frameCountRef = useRef(0);

  // Debouncing refs for face counting
  const lastFaceCountRef = useRef(0);
  const faceCountStabilityRef = useRef(0);
  const stableFaceCountRef = useRef(0);

  // Gaze-away state refs
  const gazeAwayStartTimeRef = useRef<number | null>(null);
  const lastGazeAwayEventTimeRef = useRef<number>(0);
  const gazeAwayStateRef = useRef<'idle' | 'detecting' | 'cooldown'>('idle');

  // Constants
  const CONFIDENCE_THRESHOLD = 0.4;
  const MIN_FACE_AREA_RATIO = 0.01; // 1% of frame
  const ASPECT_RATIO_MIN = 0.4;
  const ASPECT_RATIO_MAX = 2.0;
  const IN_FRAME_RATIO = 0.5; // 50%
  const IOU_THRESHOLD = 0.3;
  const CENTROID_DISTANCE_THRESHOLD = 60;
  const SINGLE_FACE_FRAMES = 2;
  const MULTIPLE_FACE_FRAMES = 3;
  const FACE_DECREASE_FRAMES = 3;

  // Gaze-away constants
  const YAW_THRESHOLD = 15; // degrees
  const PITCH_THRESHOLD = 20; // degrees
  const LOOKING_DOWN_THRESHOLD = 25; // degrees
  const GAZE_AWAY_DURATION = 1500; // ms
  const GAZE_DOWN_DURATION = 2500; // ms
  const GAZE_AWAY_COOLDOWN = 3000; // ms

  // Initialize models
  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;

    const initModels = async () => {
      try {
        console.log('[FaceMesh] Starting model initialization...');

        // Load BlazeFace
        const blazeface = await import('@tensorflow-models/blazeface');
        await import('@tensorflow/tfjs');
        
        console.log('[FaceMesh] Loading BlazeFace model...');
        const blazefaceModel = await blazeface.load();
        
        if (!isMounted) return;
        blazefaceModelRef.current = blazefaceModel;
        console.log('[FaceMesh] BlazeFace model loaded successfully');

        // Try to load FaceMesh for gaze detection
        try {
          // Set up locateFile before importing
          if (typeof window !== 'undefined') {
            (window as any).createMediapipeSolutionsPackedAssets = {
              locateFile: (file: string) => `/mediapipe/face_mesh/${file}`
            };
            (window as any).Module = (window as any).Module || {};
            (window as any).Module.locateFile = (file: string) => `/mediapipe/face_mesh/${file}`;
          }

          const FaceMeshModule = await import('@mediapipe/face_mesh');
          const faceMesh = new FaceMeshModule.FaceMesh({
            locateFile: (file: string) => {
              const url = `/mediapipe/face_mesh/${file}`;
              console.log(`[FaceMesh] Loading asset: ${url}`);
              return url;
            }
          });

          faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

          await faceMesh.initialize();
          
          if (!isMounted) return;
          faceMeshRef.current = faceMesh;
          console.log('[FaceMesh] FaceMesh model loaded successfully');
        } catch (faceMeshError) {
          console.warn('[FaceMesh] FaceMesh failed to load, gaze detection disabled:', faceMeshError);
          // Continue without FaceMesh - BlazeFace is still available
        }

        if (isMounted) {
          setIsModelLoaded(true);
          console.log('[FaceMesh] Models initialized successfully');
        }
      } catch (error) {
        console.error('[FaceMesh] Model initialization failed:', error);
        if (isMounted) {
          setModelError(error instanceof Error ? error.message : 'Unknown error');
          if (typeof window !== 'undefined') {
            (window as any).__faceMeshInitFailed = true;
          }
        }
      }
    };

    initModels();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [enabled]);

  // Compute head pose from FaceMesh landmarks
  const computeHeadPose = useCallback((landmarks: any[]): { yaw: number; pitch: number } => {
    if (!landmarks || landmarks.length < 468) {
      return { yaw: 0, pitch: 0 };
    }

    try {
      // Key landmarks
      const noseTip = landmarks[4] || landmarks[1];
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const chin = landmarks[152];
      const forehead = landmarks[10];

      if (!noseTip || !leftEye || !rightEye) {
        return { yaw: 0, pitch: 0 };
      }

      // Yaw: horizontal angle based on eye positions relative to nose
      const eyeCenterX = (leftEye.x + rightEye.x) / 2;
      const eyeDistance = Math.abs(rightEye.x - leftEye.x);
      const noseOffsetX = noseTip.x - eyeCenterX;
      const yaw = (noseOffsetX / (eyeDistance + 0.001)) * 60; // Scale to degrees

      // Pitch: vertical angle based on nose position relative to eye-chin line
      const eyeCenterY = (leftEye.y + rightEye.y) / 2;
      const faceHeight = chin && forehead ? Math.abs(chin.y - forehead.y) : 0.3;
      const noseOffsetY = noseTip.y - eyeCenterY;
      const pitch = (noseOffsetY / (faceHeight + 0.001)) * 60; // Scale to degrees

      return { yaw, pitch };
    } catch (error) {
      console.error('[FaceMesh] Error computing head pose:', error);
      return { yaw: 0, pitch: 0 };
    }
  }, []);

  // Filter overlapping boxes
  const filterOverlappingBoxes = useCallback((predictions: BlazeFacePrediction[]): BlazeFacePrediction[] => {
    if (predictions.length <= 1) return predictions;

    const boxes = predictions.map((p) => ({
      prediction: p,
      x1: p.topLeft[0],
      y1: p.topLeft[1],
      x2: p.bottomRight[0],
      y2: p.bottomRight[1],
    }));

    // Sort by confidence
    boxes.sort((a, b) => (b.prediction.probability || 0) - (a.prediction.probability || 0));

    const filtered: typeof boxes = [];
    for (const box of boxes) {
      let isOverlapping = false;
      for (const existing of filtered) {
        const iou = computeIoU(box, existing);
        const centroidDist = computeCentroidDistance(box, existing);
        
        if (iou >= IOU_THRESHOLD || centroidDist <= CENTROID_DISTANCE_THRESHOLD) {
          isOverlapping = true;
          break;
        }
      }
      if (!isOverlapping) {
        filtered.push(box);
      }
    }

    return filtered.map((b) => b.prediction);
  }, []);

  // Validate face prediction
  const validateFace = useCallback((prediction: BlazeFacePrediction, videoWidth: number, videoHeight: number): boolean => {
    const width = prediction.bottomRight[0] - prediction.topLeft[0];
    const height = prediction.bottomRight[1] - prediction.topLeft[1];
    const area = width * height;
    const frameArea = videoWidth * videoHeight;

    // Minimum area check (1% of frame)
    if (area / frameArea < MIN_FACE_AREA_RATIO) {
      return false;
    }

    // Aspect ratio check
    const aspectRatio = width / height;
    if (aspectRatio < ASPECT_RATIO_MIN || aspectRatio > ASPECT_RATIO_MAX) {
      return false;
    }

    // In-frame check (at least 50% of face must be in frame)
    const inFrameX = Math.min(prediction.bottomRight[0], videoWidth) - Math.max(prediction.topLeft[0], 0);
    const inFrameY = Math.min(prediction.bottomRight[1], videoHeight) - Math.max(prediction.topLeft[1], 0);
    const inFrameArea = Math.max(0, inFrameX) * Math.max(0, inFrameY);
    if (inFrameArea / area < IN_FRAME_RATIO) {
      return false;
    }

    return true;
  }, []);

  // Detection loop
  useEffect(() => {
    if (!enabled || !isModelLoaded || !videoRef.current) return;

    const detect = async () => {
      if (isProcessingRef.current) {
        animationFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      frameCountRef.current++;
      
      // Throttle to ~12 FPS
      if (frameCountRef.current % 5 !== 0) {
        animationFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.paused) {
        animationFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      isProcessingRef.current = true;

      try {
        const videoWidth = video.videoWidth || 640;
        const videoHeight = video.videoHeight || 480;

        // BlazeFace detection for face counting
        let rawFaceCount = 0;
        if (blazefaceModelRef.current) {
          const predictions: BlazeFacePrediction[] = await blazefaceModelRef.current.estimateFaces(video, false);
          
          // Filter by confidence
          const confidentPredictions = predictions.filter(
            (p: BlazeFacePrediction) => (p.probability || 0) > CONFIDENCE_THRESHOLD
          );

          // Validate faces
          const validPredictions = confidentPredictions.filter(
            (p: BlazeFacePrediction) => validateFace(p, videoWidth, videoHeight)
          );

          // Filter overlapping boxes
          const filteredPredictions = filterOverlappingBoxes(validPredictions);
          rawFaceCount = filteredPredictions.length;
        }

        // Debounce face counting
        if (rawFaceCount === lastFaceCountRef.current) {
          faceCountStabilityRef.current++;
        } else {
          faceCountStabilityRef.current = 1;
          lastFaceCountRef.current = rawFaceCount;
        }

        // Update stable face count based on stability
        let newStableFaceCount = stableFaceCountRef.current;
        
        if (rawFaceCount === 1 && faceCountStabilityRef.current >= SINGLE_FACE_FRAMES) {
          newStableFaceCount = 1;
        } else if (rawFaceCount > 1 && faceCountStabilityRef.current >= MULTIPLE_FACE_FRAMES) {
          newStableFaceCount = rawFaceCount;
        } else if (rawFaceCount === 0 && faceCountStabilityRef.current >= FACE_DECREASE_FRAMES) {
          newStableFaceCount = 0;
        } else if (rawFaceCount < stableFaceCountRef.current && faceCountStabilityRef.current >= FACE_DECREASE_FRAMES) {
          newStableFaceCount = rawFaceCount;
        }

        stableFaceCountRef.current = newStableFaceCount;
        setFacesCount(newStableFaceCount);

        // Gaze-away detection using FaceMesh
        let gazeAway = false;
        if (faceMeshRef.current && newStableFaceCount === 1) {
          try {
            const results = await new Promise<any>((resolve) => {
              faceMeshRef.current.onResults((r: any) => resolve(r));
              faceMeshRef.current.send({ image: video });
            });

            if (results?.multiFaceLandmarks?.[0]) {
              const landmarks = results.multiFaceLandmarks[0];
              const { yaw, pitch } = computeHeadPose(landmarks);

              const isLookingAway = Math.abs(yaw) > YAW_THRESHOLD || Math.abs(pitch) > PITCH_THRESHOLD;
              const isLookingDown = pitch > LOOKING_DOWN_THRESHOLD;
              const now = Date.now();

              if (gazeAwayStateRef.current === 'cooldown') {
                // Check if cooldown is over
                if (now - lastGazeAwayEventTimeRef.current > GAZE_AWAY_COOLDOWN) {
                  gazeAwayStateRef.current = 'idle';
                }
              }

              if (gazeAwayStateRef.current === 'idle' && isLookingAway) {
                gazeAwayStateRef.current = 'detecting';
                gazeAwayStartTimeRef.current = now;
              } else if (gazeAwayStateRef.current === 'detecting') {
                if (!isLookingAway) {
                  // User looked back
                  gazeAwayStateRef.current = 'idle';
                  gazeAwayStartTimeRef.current = null;
                } else if (gazeAwayStartTimeRef.current) {
                  const duration = now - gazeAwayStartTimeRef.current;
                  const requiredDuration = isLookingDown ? GAZE_DOWN_DURATION : GAZE_AWAY_DURATION;

                  if (duration >= requiredDuration) {
                    gazeAway = true;
                    gazeAwayStateRef.current = 'cooldown';
                    lastGazeAwayEventTimeRef.current = now;
                    gazeAwayStartTimeRef.current = null;
                    console.log('[GazeAway] Triggered after', duration, 'ms');
                  }
                }
              }
            }
          } catch (faceError) {
            // FaceMesh error - skip gaze detection this frame
          }
        }

        // Call onDetection callback
        onDetection({
          facesCount: newStableFaceCount,
          gazeAway,
          multiFace: newStableFaceCount > 1,
        });
      } catch (error) {
        console.error('[FaceMesh] Detection error:', error);
      } finally {
        isProcessingRef.current = false;
        animationFrameRef.current = requestAnimationFrame(detect);
      }
    };

    animationFrameRef.current = requestAnimationFrame(detect);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [enabled, isModelLoaded, videoRef, onDetection, computeHeadPose, filterOverlappingBoxes, validateFace]);

  return {
    isModelLoaded,
    modelError,
    facesCount,
  };
}

export default useFaceMesh;
