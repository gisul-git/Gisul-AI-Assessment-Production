/**
 * useLiveProctoring Hook
 * 
 * Manages Live Proctoring streaming from candidate to admin.
 * 
 * CRITICAL REQUIREMENTS:
 * - When admin closes monitoring, candidate streaming MUST continue
 * - Candidate's peer connection stays active (may be disconnected but not closed)
 * - Candidate's streams stay active
 * - When admin reconnects, candidate recreates peer connection if needed
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UseLiveProctoringOptions {
  assessmentId: string;
  candidateId: string;
  enabled: boolean; // Whether Live Proctoring is enabled
  preScreenStream?: MediaStream | null; // Screen stream from identity-verify (window.__screenStream)
  onError?: (error: string) => void;
  debugMode?: boolean;
}

interface UseLiveProctoringReturn {
  isStreaming: boolean;
  connectionState: "disconnected" | "connecting" | "connected" | "failed";
  error: string | null;
  sessionId: string | null;
  startStreaming: () => Promise<void>;
  stopStreaming: () => Promise<void>;
}

export function useLiveProctoring({
  assessmentId,
  candidateId,
  enabled,
  preScreenStream,
  onError,
  debugMode = false,
}: UseLiveProctoringOptions): UseLiveProctoringReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionState, setConnectionState] = useState<"disconnected" | "connecting" | "connected" | "failed">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const answerReceivedRef = useRef(false);
  const isStartingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10; // Maximum reconnection attempts
  const offerRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null); // For retrying offer after peer connection failure

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[LiveProctoring] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Heartbeat interval ref
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPongTimeRef = useRef<number>(Date.now());

  // Start heartbeat ping-pong to detect dead connections
  const startHeartbeat = useCallback((ws: WebSocket) => {
    // Clear any existing heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }
    
    lastPongTimeRef.current = Date.now();
    
    // Send ping every 30 seconds
    heartbeatIntervalRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
          log("Sent ping to backend");
          
          // Check if we received pong within 10 seconds (connection might be dead)
          heartbeatTimeoutRef.current = setTimeout(() => {
            const timeSinceLastPong = Date.now() - lastPongTimeRef.current;
            if (timeSinceLastPong > 10000) {
              console.warn(`[LiveProctoring] ⚠️ No pong received in 10s, connection may be dead. Reconnecting...`);
              // Connection is dead, trigger reconnection
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close(); // This will trigger onclose and auto-reconnect
              }
            }
          }, 10000);
        } catch (err) {
          log("Error sending ping", err);
        }
      }
    }, 30000); // 30 seconds
  }, [log]);

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  // Get webcam stream
  const getWebcamStream = useCallback(async (): Promise<MediaStream> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      log("Webcam stream obtained");
      return stream;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to get webcam stream";
      log("Error getting webcam stream", err);
      throw new Error(errorMsg);
    }
  }, [log]);

  // Get screen stream (reuse from identity-verify)
  const getScreenStream = useCallback((): MediaStream | null => {
    // Prefer prop
    if (preScreenStream && preScreenStream.active) {
      const tracks = preScreenStream.getVideoTracks();
      if (tracks.length > 0 && tracks[0].readyState === "live") {
        log("Using preScreenStream from prop");
        return preScreenStream;
      }
    }

    // Fallback to window global
    if (typeof window !== "undefined") {
      const globalScreen = (window as any).__screenStream as MediaStream | undefined;
      if (globalScreen && globalScreen.active) {
        const tracks = globalScreen.getVideoTracks();
        if (tracks.length > 0 && tracks[0].readyState === "live") {
          log("Using window.__screenStream");
          return globalScreen;
        }
      }
    }

    log("No screen stream available");
    return null;
  }, [preScreenStream, log]);

  // Setup WebSocket connection
  const setupWebSocket = useCallback((sessId: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const wsUrl = `${API_URL.replace("http://", "ws://").replace("https://", "wss://")}/api/v1/proctor/ws/live/candidate/${sessId}?candidate_id=${encodeURIComponent(candidateId)}`;
      log("Connecting WebSocket", wsUrl);
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        // CRITICAL: Always log WebSocket connection in production
        console.log(`[LiveProctoring] ✅ WebSocket connected to ${wsUrl}`);
        log("WebSocket connected");
        // CRITICAL: Start heartbeat ping-pong to detect dead connections
        startHeartbeat(ws);
        resolve(ws);
      };
      
      ws.onerror = (err) => {
        // CRITICAL: Always log WebSocket errors in production
        console.error(`[LiveProctoring] ❌ WebSocket error connecting to ${wsUrl}:`, err);
        log("WebSocket error", err);
        reject(new Error("WebSocket connection failed"));
      };
      
      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          log("Received WebSocket message", message.type);
          
          // Handle heartbeat pong (backend responds to our ping)
          if (message.type === "pong") {
            lastPongTimeRef.current = Date.now();
            if (heartbeatTimeoutRef.current) {
              clearTimeout(heartbeatTimeoutRef.current);
              heartbeatTimeoutRef.current = null;
            }
            log("Received pong from backend (connection alive)");
            return; // Don't process pong as regular message
          }
          
          if (message.type === "answer") {
            // Admin sent answer (admin reconnected or new admin connected)
            let pc = peerConnectionRef.current;
            
            // If no peer connection or it's in a bad state, create a new one
            if (!pc || pc.connectionState === "closed" || pc.connectionState === "failed") {
              log("No peer connection or bad state, creating new one...");
              // Close old one if it exists
              if (pc) {
                try {
                  pc.close();
                } catch (e) {
                  log("Error closing old peer connection", e);
                }
              }
              await setupPeerConnection(sessId);
              pc = peerConnectionRef.current;
            }
            
            // Set answer
            if (pc && message.answer) {
              try {
                // CRITICAL: Check signalingState, not just connectionState
                // If already have a remote description AND signaling is stable (both descriptions set), ignore duplicate answer
                if (pc.remoteDescription && pc.signalingState === "stable") {
                  log("Already have remote description and signaling is stable, ignoring duplicate answer", {
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState,
                    iceConnectionState: pc.iceConnectionState,
                  });
                  return; // Ignore duplicate answer
                }
                
                // If already have a remote description AND connection is in a good state, also ignore
                if (pc.remoteDescription && 
                    (pc.connectionState === "connected" || pc.connectionState === "connecting")) {
                  log("Already have remote description and connection is active, ignoring duplicate answer", {
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState,
                    iceConnectionState: pc.iceConnectionState,
                  });
                  return; // Ignore duplicate answer
                }
                
                // If we have a remote description but connection is in a bad state, recreate
                if (pc.remoteDescription) {
                  log("Already have remote description but connection is in bad state, recreating peer connection", {
                    connectionState: pc.connectionState,
                    signalingState: pc.signalingState,
                    iceConnectionState: pc.iceConnectionState,
                  });
                  pc.close();
                  await setupPeerConnection(sessId);
                  pc = peerConnectionRef.current;
                }
                
                if (pc) {
                  await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
                  answerReceivedRef.current = true;
                  log("Answer set - admin connected/reconnected");
                }
              } catch (err) {
                log("Error setting remote description (answer)", err);
                // Only recreate if the error is about wrong state, not other errors
                const errorMsg = err instanceof Error ? err.message : String(err);
                if (errorMsg.includes("wrong state") || errorMsg.includes("stable")) {
                  log("Error due to wrong signaling state, recreating peer connection");
                  if (pc) {
                    try {
                      pc.close();
                    } catch (e) {
                      log("Error closing peer connection after error", e);
                    }
                  }
                  await setupPeerConnection(sessId);
                  pc = peerConnectionRef.current;
                  if (pc && message.answer) {
                    await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
                    answerReceivedRef.current = true;
                    log("Answer set after peer connection recreation");
                  }
                } else {
                  // For other errors, just log but don't recreate (might be temporary)
                  log("Non-state error when setting answer, not recreating", err);
                }
              }
            }
          } else if (message.type === "ice_candidate") {
            // Admin sent ICE candidate
            const pc = peerConnectionRef.current;
            if (pc && message.candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
                log("Added admin ICE candidate");
              } catch (err) {
                log("Error adding ICE candidate", err);
              }
            }
          } else if (message.type === "error") {
            const errorMsg = message.message || "WebSocket error";
            setError(errorMsg);
            onError?.(errorMsg);
            log("WebSocket error message", errorMsg);
          }
        } catch (err) {
          log("Error processing WebSocket message", err);
        }
      };
      
      ws.onclose = (event) => {
        // CRITICAL: Always log WebSocket close in production
        console.log(`[LiveProctoring] ⚠️ WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        log("WebSocket closed", { code: event.code, reason: event.reason });
        stopHeartbeat(); // Stop heartbeat when connection closes
        wsRef.current = null;
        
        // CRITICAL: Auto-reconnect if streaming (unless we're stopping)
        // This ensures continuous streaming even when admin is not watching
        // Also reconnects automatically after backend restart
        if (isStreaming && !isStoppingRef.current && sessionIdRef.current) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current += 1;
            // Exponential backoff: 3s, 6s, 12s, 24s, etc. (capped at 30s)
            const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
            // CRITICAL: Always log reconnection attempts in production
            console.log(`[LiveProctoring] 🔄 Attempting WebSocket reconnect (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${delay}ms...`);
            log(`Attempting WebSocket reconnect (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${delay}ms...`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (sessionIdRef.current && !wsRef.current && isStreaming && !isStoppingRef.current) {
                setupWebSocket(sessionIdRef.current)
                  .then(ws => {
                    wsRef.current = ws;
                    reconnectAttemptsRef.current = 0; // Reset on successful reconnect
                    log("WebSocket reconnected successfully");
                    
                    // Re-send offer if peer connection exists
                    if (peerConnectionRef.current && peerConnectionRef.current.localDescription) {
                      const offer = peerConnectionRef.current.localDescription;
                      ws.send(JSON.stringify({
                        type: "offer",
                        offer: {
                          type: offer.type,
                          sdp: offer.sdp,
                        },
                      }));
                      log("Re-sent offer after WebSocket reconnect");
                    } else if (peerConnectionRef.current && sessionIdRef.current) {
                      // Recreate peer connection and send new offer
                      setupPeerConnection(sessionIdRef.current).catch(err => {
                        log("Error recreating peer connection after WebSocket reconnect", err);
                      });
                    }
                  })
                  .catch(err => {
                    log("WebSocket reconnect failed", err);
                    // Will retry on next onclose event
                  });
              }
            }, delay);
          } else {
            log("Max WebSocket reconnection attempts reached. Streaming stopped.");
            setError("Lost connection to server. Please refresh the page.");
            onError?.("Lost connection to server");
          }
        }
      };
    });
  }, [candidateId, log, onError, isStreaming]);

  // Setup WebRTC peer connection
  const setupPeerConnection = useCallback(async (sessId: string): Promise<void> => {
    const webcamStream = webcamStreamRef.current;
    const screenStream = screenStreamRef.current;
    
    if (!webcamStream || !screenStream) {
      throw new Error("Streams not available");
    }
    
    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    
    peerConnectionRef.current = pc;
    answerReceivedRef.current = false;
    
    // Add tracks
    webcamStream.getTracks().forEach(track => {
      pc.addTrack(track, webcamStream);
      log(`Added webcam track: ${track.kind}`);
    });
    
    screenStream.getTracks().forEach(track => {
      pc.addTrack(track, screenStream);
      log(`Added screen track: ${track.kind}`);
      // CRITICAL: Always log screen track addition in production
      let trackSettings: MediaTrackSettings | null = null;
      try {
        trackSettings = track.getSettings();
      } catch (err) {
        console.warn(`[LiveProctoring] getSettings() failed for screen track:`, err);
      }
      console.log(`[LiveProctoring] ✅ Added screen track to peer connection`, {
        trackId: track.id,
        trackLabel: track.label,
        trackKind: track.kind,
        trackSettings: trackSettings,
        displaySurface: trackSettings?.displaySurface,
        streamId: screenStream.id,
        trackReadyState: track.readyState,
      });
    });
    
    // Handle ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({
            type: "ice",
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          }));
          log("Sent ICE candidate");
        } catch (err) {
          log("Error sending ICE candidate", err);
        }
      }
    };
    
    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log("Connection state changed", state);
      setConnectionState(state as "disconnected" | "connecting" | "connected" | "failed");
      
      if (state === "connected") {
        log("Peer connection connected");
      } else if (state === "disconnected" || state === "failed") {
        // CRITICAL: DO NOT call stopStreaming() here
        // DO NOT close peer connection
        // DO NOT stop streams
        // Keep streams active and wait for admin to reconnect and send new answer
        log("Peer connection disconnected/failed - keeping streams active, waiting for admin reconnection");
        setIsStreaming(false); // Update UI state, but keep streams active
        
        // When peer connection fails, send a new offer so admin can reconnect
        // This ensures admin can always reconnect even if peer connection is in bad state
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && sessionIdRef.current) {
          log("Peer connection failed - will send new offer for admin reconnection");
          // Clear any existing retry timeout
          if (offerRetryTimeoutRef.current) {
            clearTimeout(offerRetryTimeoutRef.current);
          }
          // Recreate peer connection and send new offer after delay
          offerRetryTimeoutRef.current = setTimeout(async () => {
            if (sessionIdRef.current && webcamStreamRef.current && screenStreamRef.current && 
                wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              try {
                log("Sending new offer after peer connection failure");
                // Close old peer connection
                if (peerConnectionRef.current) {
                  try {
                    peerConnectionRef.current.close();
                  } catch (e) {
                    log("Error closing old peer connection", e);
                  }
                  peerConnectionRef.current = null;
                }
                // Create new peer connection and send offer
                await setupPeerConnection(sessionIdRef.current);
                log("New offer sent after peer connection failure");
              } catch (err) {
                log("Error sending new offer after peer connection failure", err);
              }
            }
          }, 500); // Wait 500ms before sending new offer (OPTION 3: Reduced from 1000ms for faster recovery)
        }
      }
    };
    
    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "offer",
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
      }));
      log("Offer sent");
    } else {
      throw new Error("WebSocket not connected");
    }
    
    setConnectionState("connecting");
  }, [log]);

  // Start streaming
  const startStreaming = useCallback(async (): Promise<void> => {
    if (isStartingRef.current || isStreaming) {
      log("Already starting or streaming");
      return;
    }
    
    isStartingRef.current = true;
    setError(null);
    
    try {
      log("Starting Live Proctoring streaming...");
      
      // 1. Get webcam stream
      const webcamStream = await getWebcamStream();
      webcamStreamRef.current = webcamStream;
      
      // 2. Get screen stream
      const screenStream = getScreenStream();
      if (!screenStream) {
        const errorMsg = "Screen stream not available. Please share your screen first.";
        console.error(`[LiveProctoring] ❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      screenStreamRef.current = screenStream;
      // CRITICAL: Always log screen stream acquisition in production
      const videoTracks = screenStream.getVideoTracks();
      const trackSettingsArray: (MediaTrackSettings | null)[] = [];
      videoTracks.forEach(track => {
        try {
          trackSettingsArray.push(track.getSettings());
        } catch (err) {
          console.warn(`[LiveProctoring] getSettings() failed for track ${track.id}:`, err);
          trackSettingsArray.push(null);
        }
      });
      console.log(`[LiveProctoring] ✅ Screen stream acquired`, {
        streamId: screenStream.id,
        active: screenStream.active,
        videoTracks: videoTracks.length,
        trackLabels: videoTracks.map(t => t.label),
        trackSettings: trackSettingsArray,
        displaySurfaces: trackSettingsArray.map(ts => ts?.displaySurface),
      });
      
      // 3. Create session (backend call ONCE)
      // CRITICAL: Always log session creation in production
      console.log(`[LiveProctoring] 📝 Creating live proctoring session for assessment ${assessmentId}, candidate ${candidateId}`);
      const response = await fetch(`${API_URL}/api/v1/proctor/live/start-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          candidateId,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LiveProctoring] ❌ Failed to start session: ${response.status} ${response.statusText} - ${errorText}`);
        throw new Error(`Failed to start session: ${response.statusText}`);
      }
      
      const data = await response.json();
      const sessId = data.data.sessionId;
      sessionIdRef.current = sessId;
      setSessionId(sessId);
      // CRITICAL: Always log session ID in production
      console.log(`[LiveProctoring] ✅ Session created: ${sessId}`);
      log("Session created", sessId);
      
      // 4. Connect WebSocket
      const ws = await setupWebSocket(sessId);
      wsRef.current = ws;
      
      // 5. Setup peer connection and send offer
      await setupPeerConnection(sessId);
      
      setIsStreaming(true);
      log("Streaming started");
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to start streaming";
      log("Error starting streaming", err);
      setError(errorMsg);
      onError?.(errorMsg);
      
      // Cleanup on error
      stopHeartbeat();
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(t => t.stop());
        webcamStreamRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    } finally {
      isStartingRef.current = false;
    }
  }, [assessmentId, candidateId, isStreaming, getWebcamStream, getScreenStream, setupWebSocket, setupPeerConnection, log, onError, stopHeartbeat]);

  // Stop streaming
  const stopStreaming = useCallback(async (): Promise<void> => {
    if (isStoppingRef.current) {
      log("Already stopping");
      return;
    }
    
    isStoppingRef.current = true;
    
    // Clear any pending reconnection attempts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (offerRetryTimeoutRef.current) {
      clearTimeout(offerRetryTimeoutRef.current);
      offerRetryTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    
    log("Stopping streaming...");
    
    const sessId = sessionIdRef.current;
    
    try {
      // 1. End session (backend call ONCE)
      if (sessId) {
        await fetch(`${API_URL}/api/v1/proctor/live/end-session/${sessId}`, {
          method: "POST",
        });
        log("Session ended");
      }
    } catch (err) {
      log("Error ending session", err);
    }
    
    // 2. Stop heartbeat
    stopHeartbeat();
    
    // 3. Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // 3. Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // 4. Stop streams
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop());
      webcamStreamRef.current = null;
    }
    // Note: Don't stop screen stream as it may be used elsewhere
    
    setIsStreaming(false);
    setConnectionState("disconnected");
    setSessionId(null);
    sessionIdRef.current = null;
    answerReceivedRef.current = false;
    
    isStoppingRef.current = false;
    log("Streaming stopped");
  }, [log]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isStreaming) {
        stopStreaming().catch(err => {
          log("Error in cleanup stopStreaming", err);
        });
      }
    };
  }, [isStreaming, stopStreaming, log]);

  return {
    isStreaming,
    connectionState,
    error,
    sessionId,
    startStreaming,
    stopStreaming,
  };
}

