/**
 * Face Detection Module using MediaPipe Face Detection (BlazeFace)
 * 
 * Fast and accurate face detection using BlazeFace model
 */

import * as blazeface from "@tensorflow-models/blazeface";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";

export type FaceDetectionState = "NO_FACE" | "SINGLE_FACE_CENTERED" | "FACE_OFF_CENTER" | "MULTIPLE_FACES";

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetectionResult {
  state: FaceDetectionState;
  faceCount: number;
  landmarks?: any[];
  confidence?: number;
  faceBoxes?: FaceBox[];
  centerStatus?: "CENTERED" | "OFF_CENTER";
}

export interface FaceDetectionModule {
  initialize: () => Promise<boolean>;
  detectFaces: (videoElement: HTMLVideoElement) => Promise<FaceDetectionResult>;
  cleanup: () => void;
  isInitialized: () => boolean;
}

let faceDetector: blazeface.BlazeFaceModel | null = null;
let isModelLoaded = false;

/**
 * Initialize BlazeFace detector (fast face detection model)
 */
export async function initializeFaceDetection(): Promise<boolean> {
  try {
    if (isModelLoaded && faceDetector) {
      return true;
    }

    // Initialize TensorFlow.js
    await tf.ready();
    
    // Prefer WebGL backend for better performance
    try {
      await tf.setBackend("webgl");
      await tf.ready();
    } catch (e) {
      console.warn("[FaceDetection] WebGL backend not available, using CPU");
      await tf.setBackend("cpu");
      await tf.ready();
    }

    // Load BlazeFace model (fast and accurate)
    // Using default model which is optimized for speed
    faceDetector = await blazeface.load();

    isModelLoaded = true;
    console.log("[FaceDetection] BlazeFace model loaded successfully");
    return true;
  } catch (error) {
    console.error("[FaceDetection] Failed to initialize:", error);
    isModelLoaded = false;
    return false;
  }
}

/**
 * Detect faces in a video element
 */
export async function detectFaces(videoElement: HTMLVideoElement): Promise<FaceDetectionResult> {
  if (!isModelLoaded || !faceDetector) {
    return {
      state: "NO_FACE",
      faceCount: 0,
    };
  }

  // Check if video is ready (readyState >= 2 means enough data loaded)
  if (videoElement.readyState < 2) {
    return {
      state: "NO_FACE",
      faceCount: 0,
    };
  }

  try {
    // Run face detection with BlazeFace
    // BlazeFace returns predictions with bounding boxes and landmarks
    const predictions = await faceDetector.estimateFaces(videoElement, false);

    const faceCount = predictions.length;
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    // Accurate face count detection
    if (faceCount === 0) {
      return {
        state: "NO_FACE",
        faceCount: 0,
      };
    } else if (faceCount > 1) {
      // Multiple faces detected
      const faceBoxes: FaceBox[] = predictions.map((p: any) => ({
        x: p.topLeft[0],
        y: p.topLeft[1],
        width: p.bottomRight[0] - p.topLeft[0],
        height: p.bottomRight[1] - p.topLeft[1],
      }));
      return {
        state: "MULTIPLE_FACES",
        faceCount: faceCount,
        landmarks: predictions[0].landmarks, // Return first face landmarks
        confidence: predictions[0].probability ? predictions[0].probability[0] : 0.9,
        faceBoxes,
      };
    } else {
      // Single face detected - check if centered
      const face = predictions[0];
      
      // Extract bounding box coordinates
      const bboxX = face.topLeft[0];
      const bboxY = face.topLeft[1];
      const bboxWidth = face.bottomRight[0] - face.topLeft[0];
      const bboxHeight = face.bottomRight[1] - face.topLeft[1];
      
      // Normalize coordinates to 0-1 range
      const normalizedX = bboxX / videoWidth;
      const normalizedY = bboxY / videoHeight;
      const normalizedWidth = bboxWidth / videoWidth;
      const normalizedHeight = bboxHeight / videoHeight;
      
      // Calculate face center in normalized coordinates
      const faceCenterX = normalizedX + normalizedWidth / 2;
      const faceCenterY = normalizedY + normalizedHeight / 2;
      
      // Check if face is in center safe zone
      // Horizontal: 0.30 ≤ faceCenterX ≤ 0.70
      // Vertical: 0.25 ≤ faceCenterY ≤ 0.75
      const isCentered = 
        faceCenterX >= 0.30 && faceCenterX <= 0.70 &&
        faceCenterY >= 0.25 && faceCenterY <= 0.75;
      
      const faceBox: FaceBox = {
        x: bboxX,
        y: bboxY,
        width: bboxWidth,
        height: bboxHeight,
      };
      
      if (isCentered) {
        return {
          state: "SINGLE_FACE_CENTERED",
          faceCount: 1,
          landmarks: face.landmarks,
          confidence: face.probability ? face.probability[0] : 0.9,
          faceBoxes: [faceBox],
          centerStatus: "CENTERED",
        };
      } else {
        return {
          state: "FACE_OFF_CENTER",
          faceCount: 1,
          landmarks: face.landmarks,
          confidence: face.probability ? face.probability[0] : 0.9,
          faceBoxes: [faceBox],
          centerStatus: "OFF_CENTER",
        };
      }
    }
  } catch (error) {
    console.error("[FaceDetection] Detection error:", error);
    return {
      state: "NO_FACE",
      faceCount: 0,
    };
  }
}

/**
 * Extract face landmarks for face matching
 */
export function extractFaceLandmarks(landmarks: any[]): number[][] | null {
  if (!landmarks || landmarks.length < 6) {
    return null;
  }

  // BlazeFace provides 6 key facial landmarks:
  // right eye, left eye, nose tip, mouth center, right mouth corner, left mouth corner
  const relevantPoints = landmarks.slice(0, 6).filter(p => p);
  if (relevantPoints.length < 4) {
    return null;
  }

  // Get bounding box for normalization
  const xs = relevantPoints.map(p => p[0]);
  const ys = relevantPoints.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  if (width < 10 || height < 10) {
    return null;
  }

  // Normalize to 0-1 range relative to face bounding box
  return relevantPoints.map(p => [
    (p[0] - minX) / width,
    (p[1] - minY) / height,
  ]);
}

/**
 * Cleanup face detection module
 */
export function cleanupFaceDetection(): void {
  if (faceDetector) {
    faceDetector = null;
    isModelLoaded = false;
    console.log("[FaceDetection] Cleaned up");
  }
}

/**
 * Check if face detection is initialized
 */
export function isFaceDetectionInitialized(): boolean {
  return isModelLoaded && faceDetector !== null;
}

/**
 * Create a face detection module instance
 */
export function createFaceDetectionModule(): FaceDetectionModule {
  return {
    initialize: initializeFaceDetection,
    detectFaces: detectFaces,
    cleanup: cleanupFaceDetection,
    isInitialized: isFaceDetectionInitialized,
  };
}



