/**
 * Identity Verification Component
 * 
 * Reusable component for face capture with BlazeFace detection
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { initializeFaceDetection, detectFaces, cleanupFaceDetection, type FaceDetectionState } from "../engine/faceDetection";
import axios from "@/lib/axios-config"; // Use configured axios with auth interceptor

export interface IdentityVerificationProps {
  assessmentId: string;
  token: string;
  candidateEmail: string;
  /**
   * Only AI assessments have a matching backend "assessments" record for save-reference-face.
   * For other flows (DSA/AIML/Custom MCQ) we should skip the backend call and store locally.
   */
  skipBackendSave?: boolean;
  onCaptureComplete: (photoDataUrl: string) => void;
  onError?: (error: string) => void;
}

export default function IdentityVerification({
  assessmentId,
  token,
  candidateEmail,
  skipBackendSave = false,
  onCaptureComplete,
  onError,
}: IdentityVerificationProps) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [faceDetectionState, setFaceDetectionState] = useState<FaceDetectionState>("NO_FACE");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionAnimationFrameRef = useRef<number | null>(null);
  const isDetectionRunningRef = useRef(false);
  const isModelLoadedRef = useRef(false);
  const isSavingRef = useRef(false); // Guard to prevent duplicate saves

  // Optimized camera initialization - fast and seamless
  useEffect(() => {
    const initCamera = async () => {
      try {
        // Get camera stream with optimized settings for fast startup (100-200ms)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640, max: 640 },
            height: { ideal: 480, max: 480 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: "user",
          },
        });

        setCameraStream(stream);

        if (videoRef.current) {
          const video = videoRef.current;
          video.srcObject = stream;
          
          // Don't wait for metadata - start playing immediately
          try {
            await video.play();
            setIsCameraReady(true);
          } catch (playError: any) {
            if (playError.name !== "AbortError" && playError.name !== "NotAllowedError") {
              console.warn("Video play() error (non-critical):", playError);
            }
            setIsCameraReady(true);
          }
        }

        // Start detection loop immediately (even before model loads)
        startDetectionLoop();

        // Initialize face detection model in background (non-blocking)
        // Model loads in ~20-40ms, no UI updates needed
        initializeFaceDetection()
          .then((initialized) => {
            if (initialized) {
              setIsModelLoaded(true);
              isModelLoadedRef.current = true;
            } else {
              console.error("[IdentityVerification] Failed to initialize face detection");
              if (onError) {
                onError("Failed to initialize face detection");
              }
            }
          })
          .catch((error) => {
            console.error("[IdentityVerification] Face detection initialization error:", error);
            if (onError) {
              onError("Failed to initialize face detection");
            }
          });
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return;
        }
        console.error("Error accessing camera:", error);
        setStatusMessage("Failed to access camera. Please check permissions.");
        if (onError) {
          onError("Failed to access camera");
        }
      }
    };

    initCamera();

    return () => {
      stopDetectionLoop();
      isModelLoadedRef.current = false;
      // Only cleanup if camera stream still exists (component unmounting)
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      // Cleanup face detection on unmount (safe to call multiple times)
      cleanupFaceDetection();
    };
  }, []);

  // Optimized detection loop using requestAnimationFrame - runs immediately
  const startDetectionLoop = useCallback(() => {
    if (isDetectionRunningRef.current) {
      return;
    }

    isDetectionRunningRef.current = true;

    const detectionLoop = async () => {
      if (!videoRef.current) {
        isDetectionRunningRef.current = false;
        return;
      }

      const video = videoRef.current;

      // Only detect if video is ready and model is loaded
      if (video.readyState >= 2 && isModelLoadedRef.current) {
        try {
          const detectionResult = await detectFaces(video);
          
          // Update state inside animation frame for smooth UI updates
          setFaceDetectionState(detectionResult.state);

          // Update status message based on detection state (no loading messages)
          if (detectionResult.state === "NO_FACE") {
            setStatusMessage("No face detected. Please ensure your face is visible.");
          } else if (detectionResult.state === "MULTIPLE_FACES") {
            setStatusMessage(`Multiple faces detected (${detectionResult.faceCount}). Please ensure only you are visible.`);
          } else if (detectionResult.state === "FACE_OFF_CENTER") {
            setStatusMessage("Please move your face to the center of the frame.");
          } else if (detectionResult.state === "SINGLE_FACE_CENTERED") {
            setStatusMessage("Face detected and centered. Click 'Capture Photo' when ready.");
          }
        } catch (error) {
          console.error("Face detection error:", error);
        }
      }

      // Continue loop (runs even if model isn't ready yet)
      if (isDetectionRunningRef.current) {
        detectionAnimationFrameRef.current = requestAnimationFrame(detectionLoop);
      }
    };

    // Start the loop immediately
    detectionAnimationFrameRef.current = requestAnimationFrame(detectionLoop);
  }, []);

  const stopDetectionLoop = useCallback(() => {
    isDetectionRunningRef.current = false;
    if (detectionAnimationFrameRef.current !== null) {
      cancelAnimationFrame(detectionAnimationFrameRef.current);
      detectionAnimationFrameRef.current = null;
    }
  }, []);

  const handleCapturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || faceDetectionState !== "SINGLE_FACE_CENTERED") {
      return;
    }

    setIsCapturing(true);
    stopDetectionLoop();

    try {
      // Final face detection check
      const finalDetection = await detectFaces(videoRef.current);
      if (finalDetection.state !== "SINGLE_FACE_CENTERED") {
        if (finalDetection.state === "MULTIPLE_FACES") {
          setStatusMessage("Multiple faces detected. Please capture again with only yourself visible.");
        } else if (finalDetection.state === "FACE_OFF_CENTER") {
          setStatusMessage("Please move your face to the center of the frame.");
        } else {
          setStatusMessage("Face detection failed. Please try again.");
        }
        setIsCapturing(false);
        startDetectionLoop();
        return;
      }

      // Capture image
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        setIsCapturing(false);
        startDetectionLoop();
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const photoData = canvas.toDataURL("image/jpeg", 0.8);
      setCapturedPhoto(photoData);

      // Stop camera stream and cleanup detection immediately
      stopDetectionLoop();
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
      }
      // Cleanup face detection model immediately after capture
      cleanupFaceDetection();
      isModelLoadedRef.current = false;

      // Store in sessionStorage first (for proctoring engine)
      sessionStorage.setItem(`referenceFace_${assessmentId}`, photoData);
      sessionStorage.setItem(`capturedPhoto_${assessmentId}`, photoData);

      // Call onCaptureComplete immediately to advance to next step (don't wait for save)
      onCaptureComplete(photoData);
      setStatusMessage("Photo captured successfully!");

      // Save reference image to backend asynchronously (non-blocking)
      // Prevent duplicate saves
      if (isSavingRef.current) {
        console.log('[IdentityVerification] Save already in progress, skipping duplicate save');
        return;
      }

      // Save to database in background (non-blocking)
      isSavingRef.current = true;
      (async () => {
        try {
          console.log('[IdentityVerification] Saving reference photo to database:', {
            assessmentId,
            candidateEmail,
            skipBackendSave,
            photoDataLength: photoData.length,
            photoDataPrefix: photoData.substring(0, 50)
          });

          const response = await axios.post("/api/v1/candidate/save-reference-face", {
            assessmentId,
            candidateEmail,
            referenceImage: photoData,
          });
          console.log('[IdentityVerification] ✅ Reference photo saved to database:', response.data);
        } catch (saveError: any) {
          // Don't block the flow if saving fails - photo is still in sessionStorage
          console.warn('[IdentityVerification] Failed to save to database (non-critical):', {
            status: saveError?.response?.status,
            error: saveError?.response?.data?.error || saveError?.response?.data?.detail || saveError?.message,
            assessmentId,
            candidateEmail
          });
        } finally {
          isSavingRef.current = false;
        }
      })();
    } catch (error) {
      console.error("Error capturing photo:", error);
      setStatusMessage("Failed to capture photo. Please try again.");
      if (onError) {
        onError("Failed to capture photo");
      }
      startDetectionLoop();
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {!capturedPhoto ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              maxWidth: "400px",
              borderRadius: "0.5rem",
              marginBottom: "1rem",
              backgroundColor: "#000",
            }}
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          {statusMessage && (
            <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "1rem" }}>
              {statusMessage}
            </div>
          )}
          {faceDetectionState === "SINGLE_FACE_CENTERED" && isCameraReady && isModelLoaded && (
            <button
              onClick={handleCapturePhoto}
              disabled={isCapturing}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: isCapturing ? "#94a3b8" : "#6953a3",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: isCapturing ? "not-allowed" : "pointer",
              }}
            >
              {isCapturing ? "Capturing..." : "Capture Photo"}
            </button>
          )}
        </>
      ) : (
        <div>
          <img
            src={capturedPhoto}
            alt="Captured photo"
            style={{
              width: "100%",
              maxWidth: "400px",
              borderRadius: "0.5rem",
              marginBottom: "1rem",
            }}
          />
          <div style={{ fontSize: "0.875rem", color: "#10b981" }}>
            {statusMessage}
          </div>
        </div>
      )}
    </div>
  );
}



