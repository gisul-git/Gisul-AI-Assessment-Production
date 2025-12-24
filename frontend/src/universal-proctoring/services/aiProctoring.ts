// ============================================================================
// Universal Proctoring System - AI Proctoring Service
// Handles: Gaze away, No face, Multiple faces detection
// 
// ARCHITECTURE: Matches the proven useFaceMesh.ts implementation:
// - BlazeFace for face detection/counting (sole source of truth)
// - MediaPipe FaceMesh for gaze detection via head pose
// - requestAnimationFrame loop at ~12 FPS
// - Proper face count debouncing with stability frames
// - Gaze state machine: idle → detecting → cooldown
// ============================================================================

import {
  AIProctoringConfig,
  DEFAULT_AI_CONFIG,
  GazeDirection,
  FaceBox,
  ProctoringViolation,
  ProctoringSession,
  VIDEO_DIMENSIONS,
} from "../types";
import {
  debugLog,
  createThrottleTracker,
  getTimestamp,
} from "../utils";

// ============================================================================
// Constants - Preserved from useFaceMesh.ts
// ============================================================================

// Face validation thresholds
const CONFIDENCE_THRESHOLD = 0.4;
const MIN_FACE_AREA_RATIO = 0.01; // 1% of frame
const ASPECT_RATIO_MIN = 0.4;
const ASPECT_RATIO_MAX = 2.0;
const IN_FRAME_RATIO = 0.5; // 50%
const IOU_THRESHOLD = 0.3;
const CENTROID_DISTANCE_THRESHOLD = 60;

// Face count stability (debouncing) - frames required
const SINGLE_FACE_FRAMES = 2;
const MULTIPLE_FACE_FRAMES = 3;
const FACE_DECREASE_FRAMES = 3;

// Gaze-away thresholds (degrees)
const YAW_THRESHOLD = 15;
const PITCH_THRESHOLD = 20;
const LOOKING_DOWN_THRESHOLD = 25;

// Gaze-away timing (milliseconds)
const GAZE_AWAY_DURATION = 1500;
const GAZE_DOWN_DURATION = 2500;
const GAZE_AWAY_COOLDOWN = 3000;

// ============================================================================
// Types
// ============================================================================

export interface AIProctoringState {
  isCameraOn: boolean;
  isModelLoaded: boolean;
  facesCount: number;
  gazeDirection: GazeDirection | null;
  errors: string[];
}

export interface AIProctoringCallbacks {
  onViolation: (violation: ProctoringViolation) => void;
  onStateChange: (state: Partial<AIProctoringState>) => void;
}

// BlazeFace prediction interface
interface BlazeFacePrediction {
  topLeft: [number, number];
  bottomRight: [number, number];
  probability: number;
  landmarks?: number[][];
}

// Box interface for IoU/centroid calculations
interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Gaze state machine states
type GazeAwayState = 'idle' | 'detecting' | 'cooldown';

// ============================================================================
// Helper Functions - IoU and Centroid calculations
// ============================================================================

function computeIoU(box1: Box, box2: Box): number {
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

function computeCentroidDistance(box1: Box, box2: Box): number {
  const c1x = (box1.x1 + box1.x2) / 2;
  const c1y = (box1.y1 + box1.y2) / 2;
  const c2x = (box2.x1 + box2.x2) / 2;
  const c2y = (box2.y1 + box2.y2) / 2;
  return Math.sqrt((c1x - c2x) ** 2 + (c1y - c2y) ** 2);
}

// ============================================================================
// AI Proctoring Service Class
// ============================================================================

/**
 * AI Proctoring Service - handles face detection and gaze tracking.
 * 
 * ARCHITECTURE (matches useFaceMesh.ts):
 * - BlazeFace: Face detection and counting (sole source of truth)
 * - MediaPipe FaceMesh: Gaze detection via head pose calculation
 * - requestAnimationFrame: Detection loop at ~12 FPS
 * - Face count debouncing: Stability counters prevent flickering
 * - Gaze state machine: idle → detecting → cooldown
 */
export class AIProctoringService {
  private config: AIProctoringConfig;
  private session: ProctoringSession | null = null;
  private callbacks: AIProctoringCallbacks | null = null;

  // Model refs
  private blazefaceModel: any = null;
  private faceMesh: any = null;

  // Media refs
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  
  // Animation frame ref (replaces setInterval)
  private animationFrameId: number | null = null;
  private isProcessing = false;
  private frameCount = 0;

  // Face count debouncing refs
  private lastFaceCount = 0;
  private faceCountStability = 0;
  private stableFaceCount = 0;

  // Gaze state machine refs
  private gazeAwayState: GazeAwayState = 'idle';
  private gazeAwayStartTime: number | null = null;
  private lastGazeAwayEventTime = 0;

  // Throttle tracker
  private throttleTracker: ReturnType<typeof createThrottleTracker>;

  // State
  private state: AIProctoringState = {
    isCameraOn: false,
    isModelLoaded: false,
    facesCount: 0,
    gazeDirection: null,
    errors: [],
  };

  constructor(config: Partial<AIProctoringConfig> = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...config };
    this.throttleTracker = createThrottleTracker(this.config.throttleIntervalMs);
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Initialize the AI proctoring service.
   * Loads BlazeFace + MediaPipe FaceMesh models.
   */
  async initialize(): Promise<boolean> {
    debugLog("AIProctoringService: Initializing...");

    try {
      // Load BlazeFace for face detection
      const blazeface = await import("@tensorflow-models/blazeface");
      await import("@tensorflow/tfjs");
      
      debugLog("[AIProctoringService] Loading BlazeFace model...");
      this.blazefaceModel = await blazeface.load();
      debugLog("[AIProctoringService] BlazeFace model loaded successfully");

      // Try to load MediaPipe FaceMesh for gaze detection
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
            debugLog(`[AIProctoringService] Loading asset: ${url}`);
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
        this.faceMesh = faceMesh;
        debugLog("[AIProctoringService] FaceMesh model loaded successfully");
      } catch (faceMeshError) {
        console.warn('[AIProctoringService] FaceMesh failed to load, gaze detection disabled:', faceMeshError);
        // Continue without FaceMesh - BlazeFace is still available for face counting
      }

      this.updateState({ isModelLoaded: true });
      debugLog("AIProctoringService: Models loaded successfully");
      return true;
    } catch (error) {
      console.error("[AIProctoringService] Failed to load models:", error);
      this.addError(`Model loading failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Start AI proctoring with the given session and callbacks.
   * @param session - User and assessment info
   * @param callbacks - Violation and state change handlers
   * @param videoElement - Video element for camera feed
   * @param canvasElement - Canvas element for snapshot capture
   * @param existingStream - Optional existing MediaStream (from precheck)
   */
  async start(
    session: ProctoringSession,
    callbacks: AIProctoringCallbacks,
    videoElement: HTMLVideoElement,
    canvasElement?: HTMLCanvasElement,
    existingStream?: MediaStream
  ): Promise<boolean> {
    debugLog("AIProctoringService: Starting...", { session });

    if (this.state.isCameraOn) {
      debugLog("AIProctoringService: Already running");
      return true;
    }

    this.session = session;
    this.callbacks = callbacks;
    this.videoElement = videoElement;
    this.canvasElement = canvasElement || null;

    // Ensure models are loaded
    if (!this.state.isModelLoaded) {
      const loaded = await this.initialize();
      if (!loaded) {
        return false;
      }
    }

    // Use existing stream from precheck if provided, otherwise get new one
    try {
      if (existingStream && existingStream.active) {
        debugLog("AIProctoringService: Using existing stream from precheck");
        this.stream = existingStream;
      } else {
        debugLog("AIProctoringService: Getting new camera stream");
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: VIDEO_DIMENSIONS.WIDTH },
            height: { ideal: VIDEO_DIMENSIONS.HEIGHT },
            facingMode: "user",
          },
        });
      }

      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      this.updateState({ isCameraOn: true });

      // Reset detection state
      this.resetDetectionState();

      // Start detection loop using requestAnimationFrame
      this.startDetectionLoop();

      debugLog("AIProctoringService: Started successfully");
      return true;
    } catch (error) {
      console.error("[AIProctoringService] Failed to start camera:", error);
      this.recordViolation("CAMERA_ERROR", {
        error: (error as Error).message,
        stage: "start",
      });
      this.addError(`Camera error: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Stop AI proctoring and release resources.
   */
  stop(): void {
    debugLog("AIProctoringService: Stopping...");

    // Stop detection loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Stop media stream
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    // Clear video source
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    // Reset all state
    this.resetDetectionState();
    this.throttleTracker.resetAll();

    this.updateState({
      isCameraOn: false,
      facesCount: 0,
      gazeDirection: null,
    });

    debugLog("AIProctoringService: Stopped");
  }

  /**
   * Get current state.
   */
  getState(): AIProctoringState {
    return { ...this.state };
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<AIProctoringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============================================================================
  // Private Methods - Detection Loop
  // ============================================================================

  /**
   * Reset detection state between sessions.
   */
  private resetDetectionState(): void {
    this.frameCount = 0;
    this.isProcessing = false;
    this.lastFaceCount = 0;
    this.faceCountStability = 0;
    this.stableFaceCount = 0;
    this.gazeAwayState = 'idle';
    this.gazeAwayStartTime = null;
    this.lastGazeAwayEventTime = 0;
  }

  /**
   * Start the detection loop using requestAnimationFrame.
   * Runs at ~12 FPS (every 5th frame at 60fps).
   */
  private startDetectionLoop(): void {
    const detect = async () => {
      // Skip if already processing a frame
      if (this.isProcessing) {
        this.animationFrameId = requestAnimationFrame(detect);
        return;
      }

      this.frameCount++;

      // Throttle to ~12 FPS (every 5th frame at 60fps)
      if (this.frameCount % 5 !== 0) {
        this.animationFrameId = requestAnimationFrame(detect);
        return;
      }

      const video = this.videoElement;
      if (!video || video.readyState < 2 || video.paused) {
        this.animationFrameId = requestAnimationFrame(detect);
        return;
      }

      this.isProcessing = true;

      try {
        await this.runDetection();
      } catch (error) {
        console.error("[AIProctoringService] Detection error:", error);
      } finally {
        this.isProcessing = false;
        this.animationFrameId = requestAnimationFrame(detect);
      }
    };

    this.animationFrameId = requestAnimationFrame(detect);
  }

  // ============================================================================
  // Private Methods - Face Detection Helpers
  // ============================================================================

  /**
   * Filter overlapping face boxes using IoU and centroid distance.
   * Prevents double-counting the same face.
   */
  private filterOverlappingBoxes(predictions: BlazeFacePrediction[]): BlazeFacePrediction[] {
    if (predictions.length <= 1) return predictions;

    const boxes = predictions.map((p) => ({
      prediction: p,
      x1: p.topLeft[0],
      y1: p.topLeft[1],
      x2: p.bottomRight[0],
      y2: p.bottomRight[1],
    }));

    // Sort by confidence (highest first)
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
  }

  /**
   * Validate a face prediction based on size, aspect ratio, and position.
   */
  private validateFace(prediction: BlazeFacePrediction, videoWidth: number, videoHeight: number): boolean {
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
  }

  // ============================================================================
  // Private Methods - Head Pose / Gaze Detection
  // ============================================================================

  /**
   * Compute head pose (yaw/pitch) from FaceMesh landmarks.
   * Uses landmarks: noseTip(4), leftEye(33), rightEye(263), chin(152), forehead(10)
   */
  private computeHeadPose(landmarks: any[]): { yaw: number; pitch: number } {
    if (!landmarks || landmarks.length < 468) {
      return { yaw: 0, pitch: 0 };
    }

    try {
      // Key landmarks (MediaPipe FaceMesh indices)
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
      console.error('[AIProctoringService] Error computing head pose:', error);
      return { yaw: 0, pitch: 0 };
    }
  }

  // ============================================================================
  // Private Methods - Main Detection
  // ============================================================================

  /**
   * Run face detection and gaze tracking.
   * Main detection logic matching useFaceMesh.ts implementation.
   */
  private async runDetection(): Promise<void> {
    if (!this.videoElement || !this.blazefaceModel) {
      return;
    }

    const video = this.videoElement;
    const videoWidth = video.videoWidth || VIDEO_DIMENSIONS.WIDTH;
    const videoHeight = video.videoHeight || VIDEO_DIMENSIONS.HEIGHT;

    // ========== BlazeFace Detection for Face Counting ==========
    let rawFaceCount = 0;
    let validPredictions: BlazeFacePrediction[] = [];
    
    try {
      const predictions: BlazeFacePrediction[] = await this.blazefaceModel.estimateFaces(video, false);

      // Filter by confidence
      const confidentPredictions = predictions.filter(
        (p: BlazeFacePrediction) => (p.probability || 0) > CONFIDENCE_THRESHOLD
      );

      // Validate faces (size, aspect ratio, in-frame)
      validPredictions = confidentPredictions.filter(
        (p: BlazeFacePrediction) => this.validateFace(p, videoWidth, videoHeight)
      );

      // Filter overlapping boxes (IoU + centroid)
      const filteredPredictions = this.filterOverlappingBoxes(validPredictions);
      rawFaceCount = filteredPredictions.length;
    } catch (error) {
      console.error('[AIProctoringService] BlazeFace error:', error);
    }

    // ========== Face Count Debouncing ==========
    if (rawFaceCount === this.lastFaceCount) {
      this.faceCountStability++;
    } else {
      this.faceCountStability = 1;
      this.lastFaceCount = rawFaceCount;
    }

    // Update stable face count based on stability thresholds
    let newStableFaceCount = this.stableFaceCount;

    if (rawFaceCount === 1 && this.faceCountStability >= SINGLE_FACE_FRAMES) {
      newStableFaceCount = 1;
    } else if (rawFaceCount > 1 && this.faceCountStability >= MULTIPLE_FACE_FRAMES) {
      newStableFaceCount = rawFaceCount;
    } else if (rawFaceCount === 0 && this.faceCountStability >= FACE_DECREASE_FRAMES) {
      newStableFaceCount = 0;
    } else if (rawFaceCount < this.stableFaceCount && this.faceCountStability >= FACE_DECREASE_FRAMES) {
      newStableFaceCount = rawFaceCount;
    }

    this.stableFaceCount = newStableFaceCount;
    this.updateState({ facesCount: newStableFaceCount });

    // ========== No Face Detection Violation ==========
    if (newStableFaceCount === 0) {
      this.recordViolation("NO_FACE_DETECTED", {
        rawFaceCount,
        stabilityFrames: this.faceCountStability,
      });
      this.updateState({ gazeDirection: { direction: "away", confidence: 1 } });
    }

    // ========== Multiple Faces Detection Violation ==========
    if (newStableFaceCount > 1) {
      const faceBoxes: FaceBox[] = validPredictions.slice(0, newStableFaceCount).map((p: BlazeFacePrediction) => ({
        x: p.topLeft[0],
        y: p.topLeft[1],
        width: p.bottomRight[0] - p.topLeft[0],
        height: p.bottomRight[1] - p.topLeft[1],
        confidence: p.probability || 0,
      }));

      this.recordViolation("MULTIPLE_FACES_DETECTED", {
        facesCount: newStableFaceCount,
        boxes: faceBoxes,
      });
    }

    // ========== Gaze Detection using FaceMesh (Head Pose) ==========
    let gazeAway = false;
    
    if (this.faceMesh && newStableFaceCount === 1) {
      try {
        const results = await new Promise<any>((resolve) => {
          this.faceMesh.onResults((r: any) => resolve(r));
          this.faceMesh.send({ image: video });
        });

        if (results?.multiFaceLandmarks?.[0]) {
          const landmarks = results.multiFaceLandmarks[0];
          const { yaw, pitch } = this.computeHeadPose(landmarks);

          const isLookingAway = Math.abs(yaw) > YAW_THRESHOLD || Math.abs(pitch) > PITCH_THRESHOLD;
          const isLookingDown = pitch > LOOKING_DOWN_THRESHOLD;
          const now = Date.now();

          // Update gaze direction state
          if (isLookingAway) {
            const direction = Math.abs(yaw) > Math.abs(pitch)
              ? (yaw > 0 ? 'right' : 'left')
              : (pitch > 0 ? 'down' : 'up');
            this.updateState({ gazeDirection: { direction, confidence: 0.8 } });
          } else {
            this.updateState({ gazeDirection: { direction: 'center', confidence: 0.9 } });
          }

          // ========== Gaze State Machine ==========
          if (this.gazeAwayState === 'cooldown') {
            // Check if cooldown is over
            if (now - this.lastGazeAwayEventTime > GAZE_AWAY_COOLDOWN) {
              this.gazeAwayState = 'idle';
            }
          }

          if (this.gazeAwayState === 'idle' && isLookingAway) {
            // Start detecting gaze away
            this.gazeAwayState = 'detecting';
            this.gazeAwayStartTime = now;
          } else if (this.gazeAwayState === 'detecting') {
            if (!isLookingAway) {
              // User looked back - reset to idle
              this.gazeAwayState = 'idle';
              this.gazeAwayStartTime = null;
            } else if (this.gazeAwayStartTime) {
              // Check if duration threshold exceeded
              const duration = now - this.gazeAwayStartTime;
              const requiredDuration = isLookingDown ? GAZE_DOWN_DURATION : GAZE_AWAY_DURATION;

              if (duration >= requiredDuration) {
                gazeAway = true;
                this.gazeAwayState = 'cooldown';
                this.lastGazeAwayEventTime = now;
                this.gazeAwayStartTime = null;
                debugLog(`[AIProctoringService] GAZE_AWAY triggered after ${duration}ms (yaw: ${yaw.toFixed(1)}°, pitch: ${pitch.toFixed(1)}°)`);
              }
            }
          }
        }
      } catch (faceMeshError) {
        // FaceMesh error - skip gaze detection this frame
        debugLog('[AIProctoringService] FaceMesh error, skipping gaze detection');
      }
    }

    // ========== Record Gaze Away Violation ==========
    if (gazeAway) {
      this.recordViolation("GAZE_AWAY", {
        direction: this.state.gazeDirection?.direction || 'away',
        stateMachine: 'cooldown_triggered',
      });
    }
  }

  /**
   * Record a violation event.
   */
  private recordViolation(
    eventType: ProctoringViolation["eventType"],
    metadata?: Record<string, unknown>
  ): void {
    if (!this.session || !this.callbacks) {
      debugLog("Cannot record violation - no session or callbacks");
      return;
    }

    // Check throttle
    if (!this.throttleTracker.shouldRecord(eventType)) {
      return;
    }

    // Capture snapshot if canvas available
    const snapshotBase64 = this.captureSnapshot();

    const violation: ProctoringViolation = {
      eventType,
      timestamp: getTimestamp(),
      assessmentId: this.session.assessmentId,
      userId: this.session.userId,
      metadata,
      snapshotBase64,
    };

    debugLog("Recording violation:", eventType, metadata);

    // Notify callback
    this.callbacks.onViolation(violation);

    // Also call session callback if provided
    if (this.session.onViolation) {
      this.session.onViolation(violation);
    }
  }

  /**
   * Capture a snapshot from the video feed.
   */
  private captureSnapshot(): string | null {
    if (!this.videoElement || !this.canvasElement) {
      return null;
    }

    try {
      const ctx = this.canvasElement.getContext("2d");
      if (!ctx) return null;

      this.canvasElement.width = VIDEO_DIMENSIONS.WIDTH;
      this.canvasElement.height = VIDEO_DIMENSIONS.HEIGHT;
      ctx.drawImage(
        this.videoElement,
        0,
        0,
        VIDEO_DIMENSIONS.WIDTH,
        VIDEO_DIMENSIONS.HEIGHT
      );

      return this.canvasElement.toDataURL("image/jpeg", 0.7);
    } catch (error) {
      debugLog("Error capturing snapshot:", error);
      return null;
    }
  }

  /**
   * Update internal state and notify callback.
   */
  private updateState(partial: Partial<AIProctoringState>): void {
    this.state = { ...this.state, ...partial };
    if (this.callbacks) {
      this.callbacks.onStateChange(partial);
    }
  }

  /**
   * Add an error to the state.
   */
  private addError(error: string): void {
    this.state.errors = [...this.state.errors, error];
    if (this.callbacks) {
      this.callbacks.onStateChange({ errors: this.state.errors });
    }
  }
}

// ============================================================================
// Singleton Instance (for simpler usage)
// ============================================================================

let aiProctoringInstance: AIProctoringService | null = null;

/**
 * Get or create the AI proctoring service instance.
 */
export function getAIProctoringService(
  config?: Partial<AIProctoringConfig>
): AIProctoringService {
  if (!aiProctoringInstance) {
    aiProctoringInstance = new AIProctoringService(config);
  } else if (config) {
    aiProctoringInstance.updateConfig(config);
  }
  return aiProctoringInstance;
}

/**
 * Reset the AI proctoring service instance.
 */
export function resetAIProctoringService(): void {
  if (aiProctoringInstance) {
    aiProctoringInstance.stop();
    aiProctoringInstance = null;
  }
}
