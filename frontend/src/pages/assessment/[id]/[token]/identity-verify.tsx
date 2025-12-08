import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import axios from "axios";

interface VerificationStep {
  id: string;
  title: string;
  status: "pending" | "running" | "passed" | "failed";
  message: string;
}

export default function IdentityVerificationPage() {
  const router = useRouter();
  const { id, token } = router.query;
  
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<VerificationStep[]>([
    { id: "photo", title: "Capture Photo", status: "pending", message: "" },
    { id: "screenshare", title: "Screen Share", status: "pending", message: "" },
    { id: "fullscreen", title: "Fullscreen Mode", status: "pending", message: "" },
  ]);
  
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [faceCount, setFaceCount] = useState<number>(0);
  const [brightness, setBrightness] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceDetectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
    
    setEmail(storedEmail);
    setName(storedName);
    
    if (!storedEmail || !storedName) {
      if (id && token) {
        router.replace(`/assessment/${id}/${token}`);
      }
      return;
    }
    
    // Check precheck completion
    const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${id}`);
    if (!precheckCompleted && id && token) {
      router.replace(`/precheck/${id}/${token}`);
      return;
    }
    
    // Check instructions acknowledgment
    const instructionsAcknowledged = sessionStorage.getItem(`instructionsAcknowledged_${id}`);
    if (!instructionsAcknowledged && id && token) {
      router.replace(`/assessment/${id}/${token}/instructions-new`);
      return;
    }
    
    // Check candidate requirements completion
    const candidateRequirementsCompleted = sessionStorage.getItem(`candidateRequirementsCompleted_${id}`);
    if (!candidateRequirementsCompleted && id && token) {
      router.replace(`/assessment/${id}/${token}/candidate-requirements`);
      return;
    }
  }, [id, token, router]);
  
  // Step A: Capture Photo
  const capturePhoto = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 0 ? { ...step, status: "running", message: "Accessing camera..." } : step
    ));
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "user" } 
      });
      setCameraStream(stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      // Start face detection
      faceDetectionIntervalRef.current = setInterval(() => {
        if (videoRef.current && canvasRef.current) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");
          
          if (!ctx) return;
          
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const faces = detectFaces(imageData);
          setFaceCount(faces);
          
          // Calculate brightness
          const avgBrightness = calculateBrightness(imageData);
          setBrightness(avgBrightness);
          
          // Update status message
          if (faces === 0) {
            setSteps(prev => prev.map((step, idx) => 
              idx === 0 ? { ...step, message: "No face detected. Please ensure your face is visible." } : step
            ));
          } else if (faces > 1) {
            setSteps(prev => prev.map((step, idx) => 
              idx === 0 ? { ...step, message: "Multiple faces detected. Please ensure only you are visible." } : step
            ));
          } else {
            setSteps(prev => prev.map((step, idx) => 
              idx === 0 ? { ...step, message: "Face detected. Click 'Capture Photo' when ready." } : step
            ));
          }
        }
      }, 500);
      
      return true;
    } catch (error) {
      console.error("Error accessing camera:", error);
      setSteps(prev => prev.map((step, idx) => 
        idx === 0 ? { ...step, status: "failed", message: "Failed to access camera. Please check permissions." } : step
      ));
      return false;
    }
  }, []);
  
  const detectFaces = (imageData: ImageData): number => {
    // Simplified face detection using skin tone detection
    // In production, use MediaPipe or similar library
    const data = imageData.data;
    let skinPixels = 0;
    let faceRegions = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Skin tone detection (simplified)
      if (r > 95 && g > 40 && b > 20 && 
          Math.max(r, g, b) - Math.min(r, g, b) > 15 &&
          Math.abs(r - g) > 15 && r > g && r > b) {
        skinPixels++;
      }
    }
    
    // Estimate face count based on skin pixel clusters
    const skinRatio = skinPixels / (data.length / 4);
    if (skinRatio > 0.15) {
      faceRegions = Math.min(Math.floor(skinRatio * 10), 2);
    }
    
    return faceRegions;
  };
  
  const calculateBrightness = (imageData: ImageData): number => {
    const data = imageData.data;
    let sum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sum += (r + g + b) / 3;
    }
    
    return sum / (data.length / 4);
  };
  
  const handleCapturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) return;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    const photoData = canvas.toDataURL("image/jpeg", 0.8);
    setCapturedPhoto(photoData);
    
    // Check face count one more time
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const faces = detectFaces(imageData);
    
    if (faces > 1) {
      setSteps(prev => prev.map((step, idx) => 
        idx === 0 ? { ...step, status: "failed", message: "Multiple faces detected. Please capture again with only yourself visible." } : step
      ));
      setCapturedPhoto(null);
      return;
    }
    
    // Stop camera stream
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    
    if (faceDetectionIntervalRef.current) {
      clearInterval(faceDetectionIntervalRef.current);
      faceDetectionIntervalRef.current = null;
    }
    
    // Mark step as passed
    setSteps(prev => prev.map((step, idx) => 
      idx === 0 ? { ...step, status: "passed", message: "Photo captured successfully" } : step
    ));
    
    // Store photo in sessionStorage
    sessionStorage.setItem(`capturedPhoto_${id}`, photoData);
  };
  
  // Step B: Screen Share
  const startScreenShare = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 1 ? { ...step, status: "running", message: "Requesting screen share..." } : step
    ));
    
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { displaySurface: "monitor" } as MediaTrackConstraints,
        audio: false 
      });
      
      setScreenStream(stream);
      
      // Handle screen share end
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        setScreenStream(null);
        setSteps(prev => prev.map((step, idx) => 
          idx === 1 ? { ...step, status: "failed", message: "Screen share ended. Please share again." } : step
        ));
      });
      
      setSteps(prev => prev.map((step, idx) => 
        idx === 1 ? { ...step, status: "passed", message: "Screen share active" } : step
      ));
      
      // Store screen share status
      sessionStorage.setItem(`screenShareCompleted_${id}`, "true");
      
      return true;
    } catch (error) {
      console.error("Error starting screen share:", error);
      setSteps(prev => prev.map((step, idx) => 
        idx === 1 ? { ...step, status: "failed", message: "Failed to start screen share. Please try again." } : step
      ));
      return false;
    }
  }, [id]);
  
  // Step C: Fullscreen Mode
  const enterFullscreen = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 2 ? { ...step, status: "running", message: "Entering fullscreen mode..." } : step
    ));
    
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        await (document.documentElement as any).webkitRequestFullscreen();
      } else if ((document.documentElement as any).msRequestFullscreen) {
        await (document.documentElement as any).msRequestFullscreen();
      }
      
      setIsFullscreen(true);
      setSteps(prev => prev.map((step, idx) => 
        idx === 2 ? { ...step, status: "passed", message: "Fullscreen mode active" } : step
      ));
      
      // Store fullscreen status
      sessionStorage.setItem(`fullscreenEnabled_${id}`, "true");
      
      return true;
    } catch (error) {
      console.error("Error entering fullscreen:", error);
      setSteps(prev => prev.map((step, idx) => 
        idx === 2 ? { ...step, status: "failed", message: "Failed to enter fullscreen. Please try again." } : step
      ));
      return false;
    }
  }, [id]);
  
  // Auto-advance steps
  useEffect(() => {
    if (currentStep === 0 && steps[0].status === "pending") {
      capturePhoto();
    }
  }, [currentStep, steps, capturePhoto]);
  
  useEffect(() => {
    if (currentStep < 2 && steps[currentStep].status === "passed") {
      setTimeout(() => setCurrentStep(currentStep + 1), 1000);
    }
  }, [currentStep, steps]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach(track => track.stop());
      screenStream?.getVideoTracks().forEach(track => track.stop());
      if (faceDetectionIntervalRef.current) {
        clearInterval(faceDetectionIntervalRef.current);
      }
    };
  }, [cameraStream, screenStream]);
  
  // Handle fullscreen exit
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && 
          !(document as any).webkitFullscreenElement && 
          !(document as any).msFullscreenElement) {
        setIsFullscreen(false);
        setSteps(prev => prev.map((step, idx) => 
          idx === 2 ? { ...step, status: "failed", message: "Fullscreen exited. Please enter fullscreen again." } : step
        ));
      }
    };
    
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("msfullscreenchange", handleFullscreenChange);
    
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("msfullscreenchange", handleFullscreenChange);
    };
  }, []);
  
  const handleStartAssessment = () => {
    // Verify all steps are passed
    if (steps.every(step => step.status === "passed")) {
      // Store verification completion
      sessionStorage.setItem(`identityVerificationCompleted_${id}`, "true");
      
      // Navigate to exam
      router.push(`/assessment/${id}/${token}/take`);
    }
  };
  
  const allStepsPassed = steps.every(step => step.status === "passed");
  
  return (
    <div style={{ 
      minHeight: "100vh", 
      backgroundColor: "#f7f3e8",
      padding: "2rem"
    }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          padding: "2rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
        }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>
              Identity Verification
            </h1>
            <p style={{ color: "#64748b", fontSize: "1rem" }}>
              Please complete the following verification steps
            </p>
          </div>
          
          {/* Verification Steps */}
          <div style={{ display: "grid", gap: "1.5rem", marginBottom: "2rem" }}>
            {/* Step 1: Capture Photo */}
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              backgroundColor: steps[0].status === "passed" ? "#f0fdf4" : 
                             steps[0].status === "failed" ? "#fef2f2" : "#f9fafb"
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "50%",
                  backgroundColor: steps[0].status === "passed" ? "#10b981" : 
                                 steps[0].status === "failed" ? "#ef4444" : "#94a3b8",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  marginRight: "1rem"
                }}>
                  {steps[0].status === "passed" ? "✓" : steps[0].status === "failed" ? "✗" : "1"}
                </div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#1e293b" }}>
                  {steps[0].title}
                </h3>
              </div>
              
              {steps[0].status === "running" && (
                <div style={{ marginBottom: "1rem" }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      width: "100%",
                      maxWidth: "400px",
                      borderRadius: "0.5rem",
                      marginBottom: "1rem"
                    }}
                  />
                  <canvas ref={canvasRef} style={{ display: "none" }} />
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "1rem" }}>
                    {steps[0].message}
                  </div>
                  {faceCount === 1 && (
                    <button
                      onClick={handleCapturePhoto}
                      style={{
                        padding: "0.75rem 1.5rem",
                        backgroundColor: "#6953a3",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Capture Photo
                    </button>
                  )}
                </div>
              )}
              
              {steps[0].status === "passed" && capturedPhoto && (
                <div>
                  <img
                    src={capturedPhoto}
                    alt="Captured photo"
                    style={{
                      width: "100%",
                      maxWidth: "400px",
                      borderRadius: "0.5rem",
                      marginBottom: "1rem"
                    }}
                  />
                  <div style={{ fontSize: "0.875rem", color: "#10b981" }}>
                    {steps[0].message}
                  </div>
                </div>
              )}
              
              {steps[0].status === "failed" && (
                <div style={{ fontSize: "0.875rem", color: "#ef4444" }}>
                  {steps[0].message}
                </div>
              )}
            </div>
            
            {/* Step 2: Screen Share */}
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              backgroundColor: steps[1].status === "passed" ? "#f0fdf4" : 
                             steps[1].status === "failed" ? "#fef2f2" : "#f9fafb"
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "50%",
                  backgroundColor: steps[1].status === "passed" ? "#10b981" : 
                                 steps[1].status === "failed" ? "#ef4444" : "#94a3b8",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  marginRight: "1rem"
                }}>
                  {steps[1].status === "passed" ? "✓" : steps[1].status === "failed" ? "✗" : "2"}
                </div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#1e293b" }}>
                  {steps[1].title}
                </h3>
              </div>
              
              {steps[1].status === "pending" && currentStep === 1 && (
                <button
                  onClick={startScreenShare}
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#6953a3",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Start Screen Share
                </button>
              )}
              
              {steps[1].status === "running" && (
                <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                  {steps[1].message}
                </div>
              )}
              
              {steps[1].status === "passed" && (
                <div style={{ fontSize: "0.875rem", color: "#10b981" }}>
                  {steps[1].message}
                </div>
              )}
              
              {steps[1].status === "failed" && (
                <div>
                  <div style={{ fontSize: "0.875rem", color: "#ef4444", marginBottom: "1rem" }}>
                    {steps[1].message}
                  </div>
                  <button
                    onClick={startScreenShare}
                    style={{
                      padding: "0.75rem 1.5rem",
                      backgroundColor: "#6953a3",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Retry Screen Share
                  </button>
                </div>
              )}
            </div>
            
            {/* Step 3: Fullscreen Mode */}
            <div style={{
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              backgroundColor: steps[2].status === "passed" ? "#f0fdf4" : 
                             steps[2].status === "failed" ? "#fef2f2" : "#f9fafb"
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "50%",
                  backgroundColor: steps[2].status === "passed" ? "#10b981" : 
                                 steps[2].status === "failed" ? "#ef4444" : "#94a3b8",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  marginRight: "1rem"
                }}>
                  {steps[2].status === "passed" ? "✓" : steps[2].status === "failed" ? "✗" : "3"}
                </div>
                <h3 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#1e293b" }}>
                  {steps[2].title}
                </h3>
              </div>
              
              {steps[2].status === "pending" && currentStep === 2 && (
                <button
                  onClick={enterFullscreen}
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#6953a3",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Enter Fullscreen
                </button>
              )}
              
              {steps[2].status === "running" && (
                <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                  {steps[2].message}
                </div>
              )}
              
              {steps[2].status === "passed" && (
                <div style={{ fontSize: "0.875rem", color: "#10b981" }}>
                  {steps[2].message}
                </div>
              )}
              
              {steps[2].status === "failed" && (
                <div>
                  <div style={{ fontSize: "0.875rem", color: "#ef4444", marginBottom: "1rem" }}>
                    {steps[2].message}
                  </div>
                  <button
                    onClick={enterFullscreen}
                    style={{
                      padding: "0.75rem 1.5rem",
                      backgroundColor: "#6953a3",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Retry Fullscreen
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Start Assessment Button */}
          {allStepsPassed && (
            <button
              onClick={handleStartAssessment}
              style={{
                width: "100%",
                padding: "1rem 2rem",
                backgroundColor: "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "1.125rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 6px -1px rgba(16, 185, 129, 0.3)"
              }}
            >
              Start Assessment →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
