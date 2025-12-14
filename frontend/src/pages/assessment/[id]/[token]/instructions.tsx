import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import { ProctoringConsentModal } from "@/components/proctor";
import axios from "axios";

export default function AssessmentInstructionsPage() {
  const router = useRouter();
  const { id, token } = router.query;
  const [acknowledged, setAcknowledged] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proctoringSettings, setProctoringSettings] = useState<{
    ai_proctoring: boolean;
    live_proctoring: boolean;
  }>({
    ai_proctoring: false,
    live_proctoring: false,
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const hasCheckedPrecheckRef = useRef(false); // Prevent multiple redirects

  // Fetch assessment proctoring settings
  useEffect(() => {
    if (!id || !token || typeof id !== "string") return;

    const fetchProctoringSettings = async () => {
      try {
        const response = await axios.get(
          `/api/assessment/get-assessment-full?assessmentId=${id}&token=${token}`
        );

        if (response.data?.success && response.data.data) {
          const assessment = response.data.data;
          const proctoring = assessment.proctoringSettings || assessment.proctoring || {};
          
          // Normalize to new format
          const aiProctoring = !!(proctoring.ai_proctoring || proctoring.multiFaceDetection || proctoring.tabSwitchDetection);
          const liveProctoring = !!(proctoring.live_proctoring || proctoring.liveCameraAndScreenMonitoring);

          setProctoringSettings({
            ai_proctoring: aiProctoring,
            live_proctoring: liveProctoring,
          });
        }
      } catch (error) {
        console.error("[Instructions] Error fetching proctoring settings:", error);
      }
    };

    fetchProctoringSettings();
  }, [id, token]);

  useEffect(() => {
    // Prevent multiple redirects
    if (hasCheckedPrecheckRef.current) return;
    if (typeof window === "undefined") return;
    
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
    setEmail(storedEmail);
    setName(storedName);

    if (!storedEmail || !storedName) {
      if (id && token) {
        hasCheckedPrecheckRef.current = true;
        router.replace(`/assessment/${id}/${token}`);
      }
      return;
    }

    // Check if pre-check was completed
    const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${id}`);
    if (!precheckCompleted && id && token) {
      // Pre-check not completed, redirect to new pre-check page
      hasCheckedPrecheckRef.current = true;
      router.replace(`/precheck/${id}/${token}`);
      return;
    }

    hasCheckedPrecheckRef.current = true;
    setIsCheckingSession(false);
  }, [id, token, router]);

  // Record proctoring event
  const recordProctorEvent = useCallback(async (eventType: string, metadata?: Record<string, unknown>) => {
    if (!id || !email) return;
    
    try {
      const response = await fetch("/api/proctor/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          timestamp: new Date().toISOString(),
          assessmentId: id,
          userId: email,
          metadata,
        }),
      });
      
      if (!response.ok) {
        console.error("[Proctor] Failed to record event:", response.statusText);
      }
    } catch (error) {
      console.error("[Proctor] Error recording event:", error);
    }
  }, [id, email]);

  // Start candidate session (record startedAt in backend)
  const startSession = useCallback(async (): Promise<boolean> => {
    if (!id || !token || !email || !name) return false;
    
    try {
      const response = await fetch("/api/assessment/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: id,
          token,
          email,
          name,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.startedAt) {
          // Store startedAt in sessionStorage for client-side timer reference
          sessionStorage.setItem("assessmentStartedAt", data.data.startedAt);
          sessionStorage.setItem("serverTime", data.data.serverTime);
          return true;
        }
      }
      
      console.error("[Session] Failed to start session");
      return false;
    } catch (error) {
      console.error("[Session] Error starting session:", error);
      return false;
    }
  }, [id, token, email, name]);

  // Request fullscreen
  const requestFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      const elem = document.documentElement;
      
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if ((elem as any).webkitRequestFullscreen) {
        await (elem as any).webkitRequestFullscreen();
      } else if ((elem as any).mozRequestFullScreen) {
        await (elem as any).mozRequestFullScreen();
      } else if ((elem as any).msRequestFullscreen) {
        await (elem as any).msRequestFullscreen();
      }
      
      // Verify fullscreen was actually entered
      await new Promise(resolve => setTimeout(resolve, 100));
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      
      return isFullscreen;
    } catch (error) {
      console.error("[Proctor] Failed to enter fullscreen:", error);
      return false;
    }
  }, []);

  // handleStartClick is now defined above (camera-first flow)

  // Handle "Enter Fullscreen" in the prompt (kept for backwards compatibility)
  const handleEnterFullscreen = async () => {
    setIsStarting(true);
    setFullscreenError(false);
    
    const success = await requestFullscreen();
    
    if (success) {
      await recordProctorEvent("FULLSCREEN_ENABLED", { source: "mandatory_prompt" });
      sessionStorage.setItem("fullscreenAccepted", "true");
      setShowFullscreenPrompt(false);
      setShowCameraPrompt(true);
      setIsStarting(false);
    } else {
      setFullscreenError(true);
      setIsStarting(false);
    }
  };

  // Background upload reference photo (fire-and-forget with retry)
  const uploadReferencePhotoBackground = useCallback((photo: string) => {
    // Fire-and-forget upload with retry
    const upload = async (retryCount = 0) => {
      try {
        const response = await fetch("/api/proctor/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "REFERENCE_PHOTO_CAPTURED",
            timestamp: new Date().toISOString(),
            assessmentId: id,
            userId: email,
            metadata: { source: "camera_modal" },
            snapshotBase64: photo,
          }),
        });
        
        if (!response.ok && retryCount < 2) {
          // Retry up to 2 times with delay
          setTimeout(() => upload(retryCount + 1), 2000);
        }
      } catch (err) {
        console.warn("[ReferencePhoto] Background upload failed:", err);
        if (retryCount < 2) {
          setTimeout(() => upload(retryCount + 1), 2000);
        }
      }
    };
    
    // Start upload in background (don't await)
    upload();
  }, [id, email]);

  // Check for existing streams (candidate may have shared before clicking Start)
  const checkForExistingStreams = useCallback((): { webcam: MediaStream | null; screen: MediaStream | null } => {
    const existingWebcam = typeof window !== "undefined" ? (window as any).__webcamStream : null;
    const existingScreen = typeof window !== "undefined" ? (window as any).__screenStream : null;
    
    // Verify streams are still active
    const webcam = existingWebcam && existingWebcam.active && existingWebcam.getTracks().some(t => t.readyState === 'live') 
      ? existingWebcam 
      : null;
    const screen = existingScreen && existingScreen.active && existingScreen.getTracks().some(t => t.readyState === 'live')
      ? existingScreen
      : null;
    
    return { webcam, screen };
  }, []);

  // Helper for timeout
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), ms);
      p.then(v => { clearTimeout(t); res(v); }).catch(e => { clearTimeout(t); rej(e); });
    });

  // Acquire webcam stream (camera-first)
  const acquireCamera = async (): Promise<MediaStream> => {
    if (typeof window === "undefined") {
      throw new Error("Window not available");
    }

    // Check for existing stream first
    const existing = (window as any).__webcamStream;
    if (existing && existing.active && existing.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === 'live')) {
      console.log("[Instructions] reusing existing webcam stream");
      return existing;
    }

    // Request new stream with timeout
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ video: true }),
        10000
      );
      (window as any).__webcamStream = stream;
      console.log("[Instructions] acquired webcam (active=true)");
      return stream;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        throw new Error("Camera permission denied. Please allow camera access in your browser settings.");
      } else if (err.name === 'NotFoundError') {
        throw new Error("No camera found. Please connect a camera and try again.");
      } else if (err.message === 'timeout') {
        throw new Error("Camera access timed out. Please check permissions and try again.");
      }
      throw new Error(`Camera access failed: ${err.message || 'Unknown error'}`);
    }
  };

  // Handle Start Assessment click - camera-first flow
  const handleStartClick = async () => {
    if (!acknowledged || !id || !token || !email) return;
    if (isStarting) return;
    if (typeof window === "undefined") return;

    setIsStarting(true);
    setError(null);
    console.log("[Instructions] Start clicked");

    try {
      // 1. Acquire webcam stream first (camera-first)
      const webcamStream = await acquireCamera();

      // 2. Attach stream to preview video element
      const previewVideo = document.getElementById("camera-preview-instructions") as HTMLVideoElement;
      if (previewVideo) {
        previewVideo.srcObject = webcamStream;
        previewVideo.style.display = "block";
      }

      // 3. Create proctoring session
      const sessionResponse = await axios.post('/api/proctor/create-session', {
        assessmentId: id,
        candidateEmail: email,
      });

      const sessionId = sessionResponse.data?.sessionId || sessionResponse.data?.data?.sessionId;
      if (!sessionId || sessionResponse.data?.status !== 'ok') {
        throw new Error('Failed to create proctoring session');
      }
      console.log("[Instructions] start-session returned:", sessionId);

      // 4. Store sessionId safely before navigation
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('__proctorSessionId', sessionId);
        (window as any).__proctoringSessionId = sessionId;
        
        // Verify stored
        const stored = sessionStorage.getItem('__proctorSessionId');
        if (stored !== sessionId) {
          throw new Error('Failed to store sessionId');
        }
      }

      // 5. Navigate to take page only after camera active and sessionId saved
      await router.push(`/assessment/${id}/${token}/take`);
    } catch (err: any) {
      console.error('[Instructions] start error', err);
      setError(err.message || "Failed to start assessment. Please try again.");
      setIsStarting(false);
    }
  };

  // Handle fullscreen failure from prompt
  const handleFullscreenFailed = () => {
    setFullscreenError(true);
    setIsStarting(false);
  };

  if (isCheckingSession) {
    return null;
  }

  return (
    <div style={{ backgroundColor: "#f7f3e8", minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <div className="card" style={{ padding: "2rem" }}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>Candidate</p>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1f2937" }}>
              Assessment Instructions
            </h1>
            {email && name && (
              <p style={{ color: "#4b5563", marginTop: "0.5rem" }}>
                {name} ({email})
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: "1.5rem", marginBottom: "2rem" }}>
            <InstructionCard
              title="General Guidelines"
              bullets={[
                "Ensure a stable internet connection and a quiet environment.",
                "Do not refresh or close the browser tab during the assessment.",
                "Each section may have its own timer—keep an eye on the countdown.",
              ]}
            />
            <InstructionCard
              title="Answering Questions"
              bullets={[
                "Read each question carefully before responding.",
                "For descriptive questions, type answers in your own words. Copy/paste is disabled.",
                "Multiple-choice questions allow only one selection; ensure you click the correct option.",
              ]}
            />
            <InstructionCard
              title="Submission Rules"
              bullets={[
                "You must submit each section before proceeding to the next.",
                "If time expires, remaining answers will be auto-submitted.",
                "Use the navigation controls to move between questions in the current section.",
              ]}
            />
            {/* Proctoring Guidelines Card - Mandatory Fullscreen */}
            <div
              style={{
                border: "2px solid #ef4444",
                borderRadius: "0.75rem",
                padding: "1.25rem",
                backgroundColor: "#fef2f2",
              }}
            >
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#991b1b", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Proctoring Requirements (Mandatory)
              </h2>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#991b1b", lineHeight: 1.6 }}>
                {(proctoringSettings.ai_proctoring || proctoringSettings.live_proctoring) && (
                  <>
                    {proctoringSettings.ai_proctoring && (
                      <li style={{ marginBottom: "0.5rem" }}>
                        <strong>AI Proctoring:</strong> Browser-based AI detection including multiple-face detection, gaze-away detection, and tab switching tracking. Snapshots will be captured when violations occur.
                      </li>
                    )}
                    {proctoringSettings.live_proctoring && (
                      <li style={{ marginBottom: "0.5rem" }}>
                        <strong>Live Proctoring:</strong> Continuous webcam and full-screen streaming to the Admin Live Proctoring panel.
                      </li>
                    )}
                    <li style={{ marginBottom: "0.5rem" }}>
                      <strong>Camera & Screen Access:</strong> You will be asked to grant camera {proctoringSettings.live_proctoring ? "and screen sharing" : ""} permissions before starting the assessment.
                    </li>
                  </>
                )}
                {!proctoringSettings.ai_proctoring && !proctoringSettings.live_proctoring && (
                  <li style={{ marginBottom: "0.5rem" }}>
                    No proctoring is enabled for this assessment.
                  </li>
                )}
              </ul>
            </div>
            <InstructionCard
              title="Code of Conduct"
              bullets={[
                "Any attempt to switch tabs, copy content, or seek unauthorized help may disqualify your attempt.",
                "Keep your webcam and microphone ready if proctoring is enabled.",
                "Contact the assessment administrator immediately if you face technical issues.",
              ]}
            />
          </div>

          {error && (
            <div
              style={{
                padding: "0.75rem",
                backgroundColor: "#fef2f2",
                borderRadius: "0.5rem",
                border: "1px solid #fecaca",
                marginBottom: "1rem",
              }}
            >
              <p style={{ color: "#dc2626", margin: 0, marginBottom: error.includes("Retry") ? "0.75rem" : 0, fontSize: "0.875rem" }}>{error}</p>
              {error.includes("Retry") && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setIsStarting(false);
                    // Retry by showing consent modal again
                    if (proctoringSettings.ai_proctoring || proctoringSettings.live_proctoring) {
                      setShowConsentModal(true);
                    }
                  }}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "#dc2626",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Camera Preview (shown when camera is active) */}
          <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
            <video
              id="camera-preview-instructions"
              autoPlay
              playsInline
              muted
              style={{
                width: "320px",
                height: "240px",
                borderRadius: "0.5rem",
                border: "2px solid #10b981",
                backgroundColor: "#000000",
                objectFit: "cover",
                display: "none", // Hidden until camera is active
              }}
            />
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
              Camera Preview
            </p>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ width: "1.25rem", height: "1.25rem" }}
              />
              <span style={{ fontSize: "0.95rem", color: "#1f2937" }}>
                I have read and understood the instructions, and I agree to follow the assessment rules.
              </span>
            </label>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleStartClick}
            disabled={!acknowledged || isStarting || !email}
            style={{
              width: "100%",
              padding: "0.85rem",
              fontSize: "1rem",
              opacity: (acknowledged && !isStarting && email) ? 1 : 0.6,
              cursor: (acknowledged && !isStarting && email) ? "pointer" : "not-allowed",
            }}
          >
            {isStarting ? "Starting..." : "Start Assessment"}
          </button>
        </div>
      </div>

      {/* Proctoring Consent Modal */}
      <ProctoringConsentModal
        isOpen={showConsentModal}
        onAccept={handleConsentAccept}
        onCancel={() => {
          setShowConsentModal(false);
          setError(null);
        }}
        aiProctoring={proctoringSettings.ai_proctoring}
        liveProctoring={proctoringSettings.live_proctoring}
        candidateName={name || undefined}
        isLoading={isStarting}
      />
    </div>
  );
}

function InstructionCard({ title, bullets }: { title: string; bullets: string[] }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
        padding: "1.25rem",
        backgroundColor: "#ffffff",
      }}
    >
      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" }}>
        {title}
      </h2>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#4b5563", lineHeight: 1.6 }}>
        {bullets.map((item, idx) => (
          <li key={idx} style={{ marginBottom: "0.5rem" }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
