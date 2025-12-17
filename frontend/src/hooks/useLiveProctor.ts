/**
 * useLiveProctor Hook
 * 
 * Handles WebRTC streaming from candidate to admin for human proctoring.
 * Requires sessionId to be provided (created by consent flow).
 * Waits for streams and sessionId before starting publishing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_INTERVAL_MS = 2500; // 2.5 seconds
const STREAM_TIMEOUT_MS = 20000; // 20 seconds

interface LiveProctorSession {
  sessionId: string;
  assessmentId: string;
  candidateId: string;
  adminId: string;
  status: string;
  offer?: { sdp: string; type: string };
  answer?: { sdp: string; type: string };
  candidateICE: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
  adminICE: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
}

interface UseLiveProctorOptions {
  assessmentId: string;
  candidateId: string;
  sessionId?: string | null; // REQUIRED: Must be provided from consent flow
  screenStream?: MediaStream | null; // Pre-captured screen stream
  webcamStream?: MediaStream | null; // Pre-captured webcam stream
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  onError?: (error: string) => void;
  onStreamsTimeout?: () => void; // Called when streams timeout
  debugMode?: boolean;
}

// TODO: restore live proctoring
// Temporary noop export to avoid breaking imports
export function useLiveProctor(_options: UseLiveProctorOptions) {
  // Return minimal shape expected by callers so old code won't crash
  return {
    isStreaming: false,
    sessionId: null,
    connectionState: "disconnected" as const,
    streamError: null,
    stopStreaming: () => {},
  };
}

/* TODO: restore live proctoring - original implementation below
export function useLiveProctor({
  assessmentId,
  candidateId,
  sessionId: providedSessionId,
  screenStream: preScreenStream,
  webcamStream: preWebcamStream,
  onSessionStart,
  onSessionEnd,
  onError,
  onStreamsTimeout,
  debugMode = false,
}: UseLiveProctorOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionState, setConnectionState] = useState<string>("disconnected");
  const [streamError, setStreamError] = useState<string | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const icePollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isStreamingRef = useRef(false);
  const isConnectingRef = useRef(false);
  const publisherCreatedRef = useRef(false); // Prevent duplicate publishers
  const lastPollLogRef = useRef<string>(""); // Prevent duplicate log spam
  const hasLoggedMissingParamsRef = useRef(false);

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[LiveProctor] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Record proctoring event with sessionId
  const recordProctorEvent = useCallback(async (eventType: string, sessId: string) => {
    if (!sessId) {
      log("Cannot record event without sessionId");
      return;
    }
    try {
      await fetch(`${API_URL}/api/v1/proctor/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          assessmentId,
          userId: candidateId,
          sessionId: sessId,
          timestamp: new Date().toISOString(),
          metadata: { sessionId: sessId },
        }),
      });
    } catch (err) {
      log("Error recording proctor event", err);
    }
  }, [assessmentId, candidateId, log]);

  // Check if streams are available (from props or window globals as fallback)
  const getAvailableStreams = useCallback((): { webcam: MediaStream | null; screen: MediaStream | null } => {
    // Prefer explicit props
    let webcam = preWebcamStream && preWebcamStream.active && preWebcamStream.getVideoTracks().some(t => t.readyState === 'live')
      ? preWebcamStream
      : null;
    let screen = preScreenStream && preScreenStream.active && preScreenStream.getVideoTracks().some(t => t.readyState === 'live')
      ? preScreenStream
      : null;

    // Fallback to window globals if props not available
    if (!webcam && typeof window !== "undefined") {
      const globalWebcam = (window as any).__webcamStream;
      if (globalWebcam && globalWebcam.active && globalWebcam.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === 'live')) {
        webcam = globalWebcam;
      }
    }
    if (!screen && typeof window !== "undefined") {
      const globalScreen = (window as any).__screenStream;
      if (globalScreen && globalScreen.active && globalScreen.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === 'live')) {
        screen = globalScreen;
      }
    }

    return { webcam, screen };
  }, [preWebcamStream, preScreenStream]);

  // Poll for answer from admin (only after publisher is created)
  const startPollingForAnswer = useCallback(
    async (sessId: string, pc: RTCPeerConnection) => {
      let answerReceived = false;
      let lastAdminICEIndex = 0;
      
      icePollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/v1/proctor/live/session/${sessId}`);
          const data = await res.json();
          
          if (!data.success) return;
          
          const session = data.data as LiveProctorSession;
          
          // Process answer if not yet received
          if (!answerReceived && session.answer) {
            log("Received answer from admin");
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: session.answer.type as RTCSdpType,
                sdp: session.answer.sdp,
              })
            );
            answerReceived = true;
          }
          
          // Process new ICE candidates from admin
          if (session.adminICE && session.adminICE.length > lastAdminICEIndex) {
            const newCandidates = session.adminICE.slice(lastAdminICEIndex);
            for (const ice of newCandidates) {
              log("Adding admin ICE candidate");
              await pc.addIceCandidate(
                new RTCIceCandidate({
                  candidate: ice.candidate,
                  sdpMid: ice.sdpMid,
                  sdpMLineIndex: ice.sdpMLineIndex,
                })
              );
            }
            lastAdminICEIndex = session.adminICE.length;
          }
          
          // Check if session ended
          if (session.status === "ended") {
            log("Session ended by admin");
            cleanupStreaming(sessId);
          }
        } catch (err) {
          log("Error polling for answer", err);
        }
      }, POLL_INTERVAL_MS);
    },
    [log]
  );

  // Cleanup streaming
  const cleanupStreaming = useCallback((sessId?: string) => {
    // Store publisher state before resetting (to avoid spam on early exits)
    const hadPublisher = publisherCreatedRef.current;
    
    // Clear intervals
    if (icePollIntervalRef.current) {
      clearInterval(icePollIntervalRef.current);
      icePollIntervalRef.current = null;
    }
    if (streamPollIntervalRef.current) {
      clearInterval(streamPollIntervalRef.current);
      streamPollIntervalRef.current = null;
    }
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    
    // Close peer connection only - DO NOT stop media streams
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Only log cleanup if we actually had a publisher (avoid spam on early exits)
    if (hadPublisher) {
      if (sessId) {
        console.log(`[LiveProctor] Publisher stopped for session ${sessId}`);
        log(`Publisher stopped for session ${sessId}`);
        recordProctorEvent("PROCTOR_SESSION_ENDED", sessId).catch(() => {});
        fetch(`${API_URL}/api/v1/proctor/live/end-session/${sessId}`, {
          method: "POST",
        }).catch(() => {});
      } else {
        console.log("[LiveProctor] Cleaning up streaming...");
        log("Cleaning up streaming...");
      }
      onSessionEnd?.();
    }
    // If publisher was never created, don't log cleanup (prevents spam)
    
    setIsStreaming(false);
    isStreamingRef.current = false;
    isConnectingRef.current = false;
    publisherCreatedRef.current = false;
    setConnectionState("disconnected");
  }, [log, onSessionEnd, recordProctorEvent]);

  // Create publisher once when sessionId and streams are available
  const createPublisher = useCallback(async (sessId: string, webcamStream: MediaStream, screenStream: MediaStream) => {
    if (publisherCreatedRef.current || isConnectingRef.current) {
      log("Publisher already created or connecting, skipping");
      return;
    }

    try {
      // Always log publisher creation (not just in debug mode)
      console.log(`[LiveProctor] Publisher created for session ${sessId}`);
      log(`Publisher created for session ${sessId}`);
      isConnectingRef.current = true;
      publisherCreatedRef.current = true;
      isStreamingRef.current = true;
      setIsStreaming(true);
      setStreamError(null);

      // Store streams
      webcamStreamRef.current = webcamStream;
      screenStreamRef.current = screenStream;

      // Handle screen share stop
      screenStream.getVideoTracks()[0].onended = () => {
        log("Screen share stopped by user");
        cleanupStreaming(sessId);
      };

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      peerConnectionRef.current = pc;

      // Add tracks to peer connection
      webcamStream.getTracks().forEach((track) => {
        pc.addTrack(track, webcamStream);
        log(`Added webcam track: ${track.kind}`);
      });

      screenStream.getTracks().forEach((track) => {
        pc.addTrack(track, screenStream);
        log(`Added screen track: ${track.kind}`);
      });

      // Handle ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          log("Sending ICE candidate");
          await fetch(`${API_URL}/api/v1/proctor/live/ice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessId,
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sender: "candidate",
            }),
          });
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        log("Connection state:", pc.connectionState);
        setConnectionState(pc.connectionState);
        
        if (pc.connectionState === "connected") {
          onSessionStart?.();
          recordProctorEvent("PROCTOR_SESSION_STARTED", sessId).catch(() => {});
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          cleanupStreaming(sessId);
        }
      };

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await fetch(`${API_URL}/api/v1/proctor/live/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessId,
          sdp: offer.sdp,
          sdpType: "offer",
          sender: "candidate",
        }),
      });

      log("Offer sent, waiting for answer...");
      setConnectionState("connecting");

      // Start polling for answer and ICE candidates from admin
      startPollingForAnswer(sessId, pc);

    } catch (err) {
      log("Error creating publisher", err);
      onError?.(err instanceof Error ? err.message : "Failed to start streaming");
      isStreamingRef.current = false;
      isConnectingRef.current = false;
      publisherCreatedRef.current = false;
      setIsStreaming(false);
    }
  }, [log, onError, onSessionStart, cleanupStreaming, startPollingForAnswer, recordProctorEvent]);

  // Poll for streams with timeout - GATE: Only start if ALL required params are provided
  useEffect(() => {
    // Early guard: check if all required params exist
    if (!providedSessionId || !assessmentId || !candidateId || !preWebcamStream) {
      if (!hasLoggedMissingParamsRef.current) {
        console.info("[LiveProctor] Not starting — missing params", {
          hasSessionId: !!providedSessionId,
          hasAssessmentId: !!assessmentId,
          hasCandidateId: !!candidateId,
          hasWebcamStream: !!preWebcamStream
        });
        hasLoggedMissingParamsRef.current = true;
      }
      return;
    }
    
    // Check if webcam stream is live
    const webcamLive = preWebcamStream.active && preWebcamStream.getVideoTracks()?.[0]?.readyState === 'live';
    if (!webcamLive) {
      if (!hasLoggedMissingParamsRef.current) {
        console.info("[LiveProctor] Not starting — webcam stream not live", {
          hasSessionId: !!providedSessionId,
          hasAssessmentId: !!assessmentId,
          hasCandidateId: !!candidateId,
          webcamActive: preWebcamStream.active,
          webcamLive: false
        });
        hasLoggedMissingParamsRef.current = true;
      }
      return;
    }
    
    // reset missing params log because now we're proceeding
    hasLoggedMissingParamsRef.current = false;
    
    // create publisher only once
    if (publisherCreatedRef.current) {
      return; // Already created, skip
    }

    // Clear any existing timeout/polling
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
    }
    if (streamPollIntervalRef.current) {
      clearInterval(streamPollIntervalRef.current);
    }

    const sessId = providedSessionId!;
    let startTime = Date.now();
    let lastPollMessage = "";

    const checkStreams = () => {
      const streams = getAvailableStreams();
      const hasWebcam = !!streams.webcam;
      const hasScreen = !!streams.screen;
      const elapsed = Date.now() - startTime;

      // GATE: Check if we have required streams AND they are active
      const webcamActive = streams.webcam && 
                          streams.webcam.active && 
                          streams.webcam.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === 'live');
      const screenActive = streams.screen && 
                          streams.screen.active && 
                          streams.screen.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === 'live');
      
      if (webcamActive && screenActive) {
        // Clear polling immediately
        if (streamPollIntervalRef.current) {
          clearInterval(streamPollIntervalRef.current);
          streamPollIntervalRef.current = null;
        }
        if (streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current);
          streamTimeoutRef.current = null;
        }

        // Create publisher immediately
        createPublisher(sessId, streams.webcam!, streams.screen!);
        return;
      }

      // Log only once per interval to avoid spam
      const pollMessage = `Waiting for streams... (${Math.floor(elapsed / 1000)}s) - Webcam: ${hasWebcam ? '✓' : '✗'}, Screen: ${hasScreen ? '✓' : '✗'}`;
      if (pollMessage !== lastPollMessage) {
        log(pollMessage);
        lastPollMessage = pollMessage;
      }

      // Check timeout
      if (elapsed >= STREAM_TIMEOUT_MS) {
        log("Stream timeout reached");
        
        // Clear polling
        if (streamPollIntervalRef.current) {
          clearInterval(streamPollIntervalRef.current);
          streamPollIntervalRef.current = null;
        }
        if (streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current);
          streamTimeoutRef.current = null;
        }

        // Show error
        const errorMsg = "Camera or screen not detected. Please allow camera/screen permissions or re-share screen.";
        setStreamError(errorMsg);
        onError?.(errorMsg);
        onStreamsTimeout?.();
      }
    };

    // Start polling
    streamPollIntervalRef.current = setInterval(checkStreams, POLL_INTERVAL_MS);
    checkStreams(); // Initial check

    // Set timeout
    streamTimeoutRef.current = setTimeout(() => {
      checkStreams(); // Final check
    }, STREAM_TIMEOUT_MS);

    return () => {
      if (streamPollIntervalRef.current) {
        clearInterval(streamPollIntervalRef.current);
        streamPollIntervalRef.current = null;
      }
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }
    };
  }, [providedSessionId, assessmentId, candidateId, preWebcamStream, getAvailableStreams, createPublisher, log, onError, onStreamsTimeout, setStreamError]);

  // Cleanup effect - only log if publisher existed
  useEffect(() => {
    return () => {
      if (publisherCreatedRef.current) {
        console.log(`[LiveProctor] Publisher stopped for session ${providedSessionId || 'unknown'}`);
        cleanupStreaming(providedSessionId || undefined);
      }
    };
  }, [providedSessionId, cleanupStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupStreaming();
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(t => t.stop());
        webcamStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
    };
  }, [cleanupStreaming]);

  return {
    isStreaming,
    sessionId: providedSessionId,
    connectionState,
    streamError,
    stopStreaming: () => cleanupStreaming(providedSessionId || undefined),
  };
}
*/
