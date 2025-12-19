import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import IdentityVerification from "@/proctoring/components/IdentityVerification";
import { getGateContext } from "@/lib/gateContext";

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
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  useEffect(() => {
    // Wait for router to be ready before accessing query params
    if (!router.isReady) return;
    
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
    
    setEmail(storedEmail);
    setName(storedName);
    
    if (!storedEmail || !storedName) {
      if (id && token) {
        const ctx = getGateContext(id as string);
        router.replace(ctx?.entryUrl || `/assessment/${id}/${token}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, id, token]);
  
  // Step A: Capture Photo - using IdentityVerification component
  const capturePhoto = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 0 ? { ...step, status: "running", message: "Initializing face detection..." } : step
    ));
    return true; // Component will handle the actual capture
  }, []);

  const handleCaptureComplete = useCallback((photoData: string) => {
    setCapturedPhoto(photoData);
    setSteps(prev => prev.map((step, idx) => 
      idx === 0 ? { ...step, status: "passed", message: "Photo captured successfully" } : step
    ));
  }, []);

  const handleCaptureError = useCallback((error: string) => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 0 ? { ...step, status: "failed", message: error } : step
    ));
  }, []);
  
  // Step B: Screen Share - Enforce "Entire Screen" only
  const startScreenShare = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 1 ? { ...step, status: "running", message: "Requesting screen share..." } : step
    ));
    
    const requestScreenShare = async (): Promise<boolean> => {
      try {
        // Use getDisplayMedia() normally - browser shows picker UI
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true,
          audio: false 
        });
        
        // Validate the selection after stream is returned
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
          stream.getTracks().forEach(track => track.stop());
          setSteps(prev => prev.map((step, idx) => 
            idx === 1 ? { ...step, status: "failed", message: "No video track found. Please try again." } : step
          ));
          return false;
        }
        
        const settings = videoTrack.getSettings();
        const displaySurface = settings.displaySurface;
        
        // Valid values: "monitor" or "screen" (Entire Screen)
        const isValidSelection = displaySurface === "monitor" || displaySurface === "screen";
        
        // Invalid values: "window", "browser", "application", "tab"
        if (!isValidSelection) {
          // Immediately stop the invalid stream
          stream.getTracks().forEach(track => track.stop());
          
          // Show rejection message
          setSteps(prev => prev.map((step, idx) => 
            idx === 1 ? { 
              ...step, 
              status: "failed", 
              message: "Please select ENTIRE SCREEN to continue." 
            } : step
          ));
          
          // Re-trigger screen share request (recursive call)
          // Small delay to allow UI update
          await new Promise(resolve => setTimeout(resolve, 500));
          return requestScreenShare();
        }
        
        // Valid selection - proceed
        setScreenStream(stream);
        // Expose screen stream globally so Live Proctoring can reuse it
        if (typeof window !== "undefined") {
          (window as any).__screenStream = stream;
        }
        
        // Handle screen share end
        videoTrack.addEventListener("ended", () => {
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
      } catch (error: any) {
        // User cancelled the picker
        if (error.name === "NotAllowedError" || error.name === "AbortError") {
          setSteps(prev => prev.map((step, idx) => 
            idx === 1 ? { 
              ...step, 
              status: "failed", 
              message: "Screen sharing is required. Please select ENTIRE SCREEN to continue." 
            } : step
          ));
          return false;
        }
        
        console.error("Error starting screen share:", error);
        setSteps(prev => prev.map((step, idx) => 
          idx === 1 ? { 
            ...step, 
            status: "failed", 
            message: "Failed to start screen share. Please try again." 
          } : step
        ));
        return false;
      }
    };
    
    return requestScreenShare();
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
  
  // Cleanup on unmount - but don't stop screen stream if it's stored globally for take.tsx
  useEffect(() => {
    return () => {
      // Only stop if NOT navigating to take (i.e., global not set)
      if (!(window as any).__screenStream) {
        screenStream?.getVideoTracks().forEach(track => track.stop());
      }
    };
  }, [screenStream]);
  
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
      
      // Store screen stream globally so take.tsx can access it for screen snapshots
      if (screenStream && screenStream.active) {
        (window as any).__screenStream = screenStream;
        console.log('[Identity] Screen stream stored globally for take.tsx');
      }
      
      // Navigate to exam (flow-aware)
      const ctx = getGateContext(id as string);
      router.push(ctx?.finalTakeUrl || `/assessment/${id}/${token}/take`);
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
                <IdentityVerification
                  assessmentId={id as string}
                  token={token as string}
                  candidateEmail={email || ""}
                  skipBackendSave={getGateContext(id as string)?.flowType !== "ai"}
                  onCaptureComplete={handleCaptureComplete}
                  onError={handleCaptureError}
                />
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
