/**
 * LiveProctoringDashboard Component
 * 
 * Admin dashboard for monitoring multiple candidate streams in real-time.
 * Uses useMultiLiveProctorAdmin hook for WebRTC streaming.
 */

import React, { useEffect, useRef, useState } from "react";
import { useMultiLiveProctorAdmin } from "../../hooks/useMultiLiveProctorAdmin";
import { X, RefreshCw, Video, Monitor } from "lucide-react";

interface LiveProctoringDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  assessmentId: string;
  adminId: string;
}

interface CandidateCardProps {
  sessionId: string;
  candidateId: string;
  status: "connecting" | "connected" | "disconnected" | "failed";
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
  error: string | null;
  onRefresh: () => void;
  isExpanded: boolean;
  onExpandToggle: () => void;
}

function CandidateCard({
  sessionId,
  candidateId,
  status,
  webcamStream,
  screenStream,
  error,
  onRefresh,
  isExpanded,
  onExpandToggle,
}: CandidateCardProps) {
  const webcamRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);

  // Attach webcam stream
  useEffect(() => {
    const video = webcamRef.current;
    if (!video) return;
    
    if (webcamStream) {
      // Check if stream is already attached to avoid unnecessary re-assignment
      if (video.srcObject !== webcamStream) {
        video.srcObject = webcamStream;
      }
      // Only try to play if video is not already playing
      if (video.paused) {
        video.play().catch(err => {
          // Ignore AbortError - it happens when video element is removed during play
          if (err.name !== "AbortError") {
            console.error("[LiveProctoringDashboard] Error playing webcam:", err);
          }
        });
      }
    } else {
      // Only clear if there's actually a stream attached
      if (video.srcObject) {
        video.srcObject = null;
      }
    }
    
    // Cleanup: don't clear srcObject on unmount if stream is still active
    return () => {
      // Only clear if component is unmounting and stream is no longer available
      if (video && !webcamStream) {
        video.srcObject = null;
      }
    };
  }, [webcamStream]);

  // Attach screen stream
  useEffect(() => {
    const video = screenRef.current;
    if (!video) return;
    
    if (screenStream) {
      // Check if stream is already attached to avoid unnecessary re-assignment
      if (video.srcObject !== screenStream) {
        video.srcObject = screenStream;
      }
      // Only try to play if video is not already playing
      if (video.paused) {
        video.play().catch(err => {
          // Ignore AbortError - it happens when video element is removed during play
          if (err.name !== "AbortError") {
            console.error("[LiveProctoringDashboard] Error playing screen:", err);
          }
        });
      }
    } else {
      // Only clear if there's actually a stream attached
      if (video.srcObject) {
        video.srcObject = null;
      }
    }
    
    // Cleanup: don't clear srcObject on unmount if stream is still active
    return () => {
      // Only clear if component is unmounting and stream is no longer available
      if (video && !screenStream) {
        video.srcObject = null;
      }
    };
  }, [screenStream]);

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "#10b981"; // green
      case "connecting":
        return "#f59e0b"; // amber
      case "disconnected":
      case "failed":
        return "#ef4444"; // red
      default:
        return "#64748b"; // gray
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Disconnected";
      case "failed":
        return "Failed";
      default:
        return "Unknown";
    }
  };

  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        borderRadius: "0.75rem",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        width: isExpanded ? "100%" : "auto",
        height: isExpanded ? "100%" : "auto",
        minHeight: isExpanded ? "100%" : "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem",
          backgroundColor: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem" }}>
            {candidateId || sessionId}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: getStatusColor(),
              }}
            />
            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
              {getStatusText()}
            </span>
          </div>
        </div>
        <button
          onClick={onRefresh}
          style={{
            padding: "0.5rem",
            backgroundColor: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: "0.375rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Refresh connection"
        >
          <RefreshCw size={16} color="#64748b" />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#fef2f2",
            borderBottom: "1px solid #e2e8f0",
            color: "#dc2626",
            fontSize: "0.875rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Video streams */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: isExpanded ? "1rem" : "0.5rem",
          padding: isExpanded ? "1rem" : "0.5rem",
          flex: isExpanded ? 1 : "none",
          minHeight: isExpanded ? "0" : "200px",
          height: isExpanded ? "100%" : "auto",
        }}
      >
        {/* Webcam */}
        <div
          style={{
            backgroundColor: "#1e293b",
            borderRadius: "0.5rem",
            overflow: "hidden",
            position: "relative",
            aspectRatio: isExpanded ? undefined : "16/9",
            height: isExpanded ? "100%" : "auto",
            minHeight: isExpanded ? "400px" : "auto",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              left: "0.5rem",
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "0.25rem 0.5rem",
              borderRadius: "0.25rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <Video size={12} />
            Webcam
          </div>
          {webcamStream ? (
            <video
              ref={webcamRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                fontSize: "0.875rem",
              }}
            >
              Waiting for webcam...
            </div>
          )}
        </div>

        {/* Screen */}
        <div
          style={{
            backgroundColor: "#1e293b",
            borderRadius: "0.5rem",
            overflow: "hidden",
            position: "relative",
            aspectRatio: isExpanded ? undefined : "16/9",
            height: isExpanded ? "100%" : "auto",
            minHeight: isExpanded ? "400px" : "auto",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              left: "0.5rem",
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "0.25rem 0.5rem",
              borderRadius: "0.25rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <Monitor size={12} />
            Screen
          </div>
          {screenStream ? (
            <video
              ref={screenRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                fontSize: "0.875rem",
              }}
            >
              Waiting for screen...
            </div>
          )}
        </div>
      </div>

      {/* Expand/Collapse button */}
      <div
        style={{
          padding: "0.5rem",
          borderTop: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <button
          onClick={onExpandToggle}
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: "0.375rem",
            cursor: "pointer",
            fontSize: "0.875rem",
            color: "#475569",
          }}
        >
          {isExpanded ? "Show Grid" : "Expand View"}
        </button>
      </div>
    </div>
  );
}

export function LiveProctoringDashboard({
  isOpen,
  onClose,
  assessmentId,
  adminId,
}: LiveProctoringDashboardProps) {
  const {
    candidateStreams,
    activeCandidates,
    isLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  } = useMultiLiveProctorAdmin({
    assessmentId,
    adminId,
    debugMode: true,
  });

  // Track which candidate card is expanded
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // Use refs to store stable function references
  const startMonitoringRef = useRef(startMonitoring);
  const stopMonitoringRef = useRef(stopMonitoring);
  
  // Update refs when functions change
  useEffect(() => {
    startMonitoringRef.current = startMonitoring;
    stopMonitoringRef.current = stopMonitoring;
  }, [startMonitoring, stopMonitoring]);

  // Start monitoring when dashboard opens
  useEffect(() => {
    if (isOpen) {
      startMonitoringRef.current().catch(err => {
        console.error("[LiveProctoringDashboard] Error starting monitoring:", err);
      });
    } else {
      stopMonitoringRef.current();
      // Reset expanded state when closing
      setExpandedSessionId(null);
    }

    return () => {
      if (isOpen) {
        stopMonitoringRef.current();
      }
    };
  }, [isOpen]); // Only depend on isOpen, not the functions

  // Convert Map to array for rendering
  const streamsArray = Array.from(candidateStreams.values());

  // Handle expand toggle
  const handleExpandToggle = (sessionId: string) => {
    setExpandedSessionId(prev => prev === sessionId ? null : sessionId);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.75)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          width: "100%",
          maxWidth: "1400px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.5rem",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "#1e293b",
              }}
            >
              Live Proctoring Dashboard
            </h2>
            <p
              style={{
                margin: "0.5rem 0 0 0",
                fontSize: "0.875rem",
                color: "#64748b",
              }}
            >
              Monitoring {activeCandidates.length} active candidate{activeCandidates.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem",
              backgroundColor: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close dashboard"
          >
            <X size={20} color="#64748b" />
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: expandedSessionId ? "0" : "1.5rem",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isLoading ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "400px",
                color: "#64748b",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  border: "4px solid #e2e8f0",
                  borderTopColor: "#3b82f6",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <p style={{ marginTop: "1rem", fontSize: "0.875rem" }}>
                Loading active sessions...
              </p>
            </div>
          ) : streamsArray.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "400px",
                color: "#94a3b8",
              }}
            >
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p style={{ marginTop: "1rem", fontSize: "1.125rem", fontWeight: 600 }}>
                No Active Candidates
              </p>
              <p
                style={{
                  color: "#64748b",
                  fontSize: "0.875rem",
                  marginTop: "0.5rem",
                  textAlign: "center",
                  maxWidth: "400px",
                }}
              >
                There are no active candidates taking the test. Candidates will appear here when they start their assessment.
              </p>
            </div>
          ) : expandedSessionId ? (
            // Expanded view - show only the expanded card in full screen
            <div style={{ flex: 1, display: "flex", padding: "1.5rem" }}>
              {streamsArray
                .filter(stream => stream.sessionId === expandedSessionId)
                .map((stream) => (
                  <CandidateCard
                    key={stream.sessionId}
                    sessionId={stream.sessionId}
                    candidateId={stream.candidateId}
                    status={stream.status}
                    webcamStream={stream.webcamStream}
                    screenStream={stream.screenStream}
                    error={stream.error}
                    onRefresh={() => refreshCandidate(stream.sessionId)}
                    isExpanded={true}
                    onExpandToggle={() => handleExpandToggle(stream.sessionId)}
                  />
                ))}
            </div>
          ) : (
            // Grid view - show all cards
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
                gap: "1.5rem",
              }}
            >
              {streamsArray.map((stream) => (
                <CandidateCard
                  key={stream.sessionId}
                  sessionId={stream.sessionId}
                  candidateId={stream.candidateId}
                  status={stream.status}
                  webcamStream={stream.webcamStream}
                  screenStream={stream.screenStream}
                  error={stream.error}
                  onRefresh={() => refreshCandidate(stream.sessionId)}
                  isExpanded={false}
                  onExpandToggle={() => handleExpandToggle(stream.sessionId)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export default LiveProctoringDashboard;

