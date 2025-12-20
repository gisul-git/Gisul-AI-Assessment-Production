/**
 * useMultiLiveProctorAdmin Hook
 * 
 * Manages admin's monitoring of multiple candidate streams.
 * 
 * CRITICAL REQUIREMENTS:
 * - Admin ALWAYS creates NEW peer connection (never reuse old ones)
 * - When admin closes dashboard, only local cleanup (don't end candidate sessions)
 * - When admin reopens dashboard, creates new connections to see ongoing streams
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface CandidateStream {
  sessionId: string;
  candidateId: string;
  status: "connecting" | "connected" | "disconnected" | "failed";
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
  error: string | null;
}

interface UseMultiLiveProctorAdminOptions {
  assessmentId: string;
  adminId: string;
  onError?: (error: string) => void;
  debugMode?: boolean;
}

interface UseMultiLiveProctorAdminReturn {
  candidateStreams: Map<string, CandidateStream>;
  activeCandidates: string[]; // sessionIds
  isLoading: boolean;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => void;
  refreshCandidate: (sessionId: string) => Promise<void>;
}

export function useMultiLiveProctorAdmin({
  assessmentId,
  adminId,
  onError,
  debugMode = false,
}: UseMultiLiveProctorAdminOptions): UseMultiLiveProctorAdminReturn {
  const [candidateStreams, setCandidateStreams] = useState<Map<string, CandidateStream>>(new Map());
  const [activeCandidates, setActiveCandidates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const isMonitoringRef = useRef(false);
  const isStartingRef = useRef(false); // Guard against multiple simultaneous startMonitoring calls
  const connectingSessionsRef = useRef<Set<string>>(new Set()); // Track sessions we're currently connecting to

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[MultiLiveProctorAdmin] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Close peer connection for a candidate
  const closePeerConnection = useCallback((sessionId: string) => {
    const pc = peerConnectionsRef.current.get(sessionId);
    if (pc) {
      try {
        pc.close();
        log(`Closed peer connection for ${sessionId}`);
      } catch (err) {
        log(`Error closing peer connection for ${sessionId}`, err);
      }
      peerConnectionsRef.current.delete(sessionId);
    }
    // Remove from connecting set
    connectingSessionsRef.current.delete(sessionId);
  }, [log]);

  // Connect to a single candidate
  const connectToCandidate = useCallback(async (session: { sessionId: string; candidateId: string; status: string }, forceReconnect: boolean = false) => {
    const { sessionId, candidateId } = session;
    
    // Check if we're already connecting to this session
    if (connectingSessionsRef.current.has(sessionId) && !forceReconnect) {
      log(`Already connecting to session ${sessionId}, skipping duplicate connection`);
      return;
    }
    
    // Check if we already have a connected or connecting peer connection
    const existingPc = peerConnectionsRef.current.get(sessionId);
    if (existingPc && !forceReconnect) {
      const state = existingPc.connectionState;
      if (state === "connected" || state === "connecting") {
        log(`Already have active peer connection for ${sessionId} (state: ${state}), skipping duplicate connection`);
        return;
      }
      // Only close if it's in a bad state
      if (state === "disconnected" || state === "failed" || state === "closed") {
        log(`Closing existing peer connection for ${sessionId} (state: ${state}) to create fresh connection`);
        closePeerConnection(sessionId);
      } else {
        log(`Peer connection for ${sessionId} is in state ${state}, skipping duplicate connection`);
        return;
      }
    } else if (existingPc && forceReconnect) {
      log(`Force reconnecting: Closing existing peer connection for ${sessionId} (state: ${existingPc.connectionState})`);
      closePeerConnection(sessionId);
    }
    
    // Mark as connecting
    connectingSessionsRef.current.add(sessionId);
    
    // Update candidate stream state
    setCandidateStreams(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(sessionId);
      newMap.set(sessionId, {
        sessionId,
        candidateId: existing?.candidateId || candidateId,
        status: "connecting",
        webcamStream: existing?.webcamStream || null,
        screenStream: existing?.screenStream || null,
        error: null,
      });
      return newMap;
    });
    
    try {
      // Request session data (offer) via WebSocket
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
      }
      
      wsRef.current.send(JSON.stringify({
        type: "get_session",
        sessionId,
      }));
      
      log(`Requested session data for ${sessionId}`);
      
      // Wait for session_data response (handled in WebSocket message handler)
      // The actual peer connection setup happens when we receive the offer
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to candidate";
      log(`Error connecting to candidate ${sessionId}`, err);
      
      // Remove from connecting set
      connectingSessionsRef.current.delete(sessionId);
      
      setCandidateStreams(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(sessionId);
        if (existing) {
          newMap.set(sessionId, {
            ...existing,
            status: "failed",
            error: errorMsg,
          });
        }
        return newMap;
      });
      
      onError?.(errorMsg);
    }
  }, [log, closePeerConnection, onError]);

  // Setup WebSocket connection
  const setupWebSocket = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const wsUrl = `${API_URL.replace("http://", "ws://").replace("https://", "wss://")}/api/v1/proctor/ws/live/admin/${assessmentId}`;
      log("Connecting admin WebSocket", wsUrl);
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        log("Admin WebSocket connected");
        resolve(ws);
      };
      
      ws.onerror = (err) => {
        log("Admin WebSocket error", err);
        reject(new Error("WebSocket connection failed"));
      };
      
      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          log("Received admin WebSocket message", message.type);
          
          if (message.type === "active_sessions") {
            // Backend sent list of active sessions
            const sessions = message.sessions || [];
            log(`Received ${sessions.length} active sessions`);
            
            setActiveCandidates(sessions.map((s: any) => s.sessionId));
            
            // Connect to each active candidate
            for (const session of sessions) {
              await connectToCandidate(session);
            }
            
            setIsLoading(false);
            
          } else if (message.type === "new_session") {
            // New candidate started streaming
            const session = {
              sessionId: message.sessionId,
              candidateId: message.candidateId,
              status: message.status || "candidate_initiated",
            };
            
            log(`New session started: ${session.sessionId}`);
            
            setActiveCandidates(prev => {
              if (!prev.includes(session.sessionId)) {
                return [...prev, session.sessionId];
              }
              return prev;
            });
            
            // Only connect if we don't already have an active connection
            // This prevents infinite loops when candidate sends offer while we're already connecting
            const existingPc = peerConnectionsRef.current.get(session.sessionId);
            if (!existingPc || existingPc.connectionState === "disconnected" || existingPc.connectionState === "failed" || existingPc.connectionState === "closed") {
              await connectToCandidate(session, false);
            } else {
              log(`Ignoring new_session for ${session.sessionId} - already have active connection (state: ${existingPc.connectionState})`);
            }
            
          } else if (message.type === "session_ended") {
            // Candidate ended session
            const sessionId = message.sessionId;
            log(`Session ended: ${sessionId}`);
            
            setActiveCandidates(prev => prev.filter(id => id !== sessionId));
            
            // Close peer connection (local cleanup)
            closePeerConnection(sessionId);
            
            setCandidateStreams(prev => {
              const newMap = new Map(prev);
              newMap.delete(sessionId);
              return newMap;
            });
            
          } else if (message.type === "session_data") {
            // Response to get_session request
            const sessionId = message.sessionId;
            const offer = message.offer;
            const candidateICE = message.candidateICE || [];
            
            if (!offer) {
              log(`No offer in session_data for ${sessionId} - candidate may not have sent offer yet, retrying in 2 seconds...`);
              // Retry get_session after delay if no offer (candidate might still be setting up)
              setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: "get_session",
                    sessionId,
                  }));
                  log(`Retrying get_session for ${sessionId}`);
                }
              }, 2000);
              return;
            }
            
            log(`Received session data for ${sessionId}`);
            
            // Remove from connecting set since we're now setting up the peer connection
            connectingSessionsRef.current.delete(sessionId);
            
            // Check if we already have a peer connection for this session
            // If we do and it's in a good state, don't create a new one
            const existingPc = peerConnectionsRef.current.get(sessionId);
            if (existingPc && (existingPc.connectionState === "connected" || existingPc.connectionState === "connecting")) {
              log(`Already have active peer connection for ${sessionId} (state: ${existingPc.connectionState}), skipping duplicate setup`);
              return;
            }
            
            // Close existing if it exists and is in a bad state
            if (existingPc) {
              log(`Closing existing peer connection for ${sessionId} (state: ${existingPc.connectionState}) before creating new one`);
              closePeerConnection(sessionId);
            }
            
            // Create NEW peer connection
            const pc = new RTCPeerConnection({
              iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
              ],
            });
            
            peerConnectionsRef.current.set(sessionId, pc);
            
            // Handle incoming tracks (webcam + screen)
            pc.ontrack = (event) => {
              log(`Received track for ${sessionId}`, event.track.kind);
              
              setCandidateStreams(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(sessionId);
                if (existing) {
                  const stream = event.streams[0];
                  if (event.track.kind === "video") {
                    // Determine if it's webcam or screen based on stream ID or track label
                    // For simplicity, assume first video track is webcam, second is screen
                    if (!existing.webcamStream) {
                      newMap.set(sessionId, {
                        ...existing,
                        webcamStream: stream,
                        status: existing.screenStream ? "connected" : "connecting",
                      });
                    } else if (!existing.screenStream) {
                      newMap.set(sessionId, {
                        ...existing,
                        screenStream: stream,
                        status: "connected",
                      });
                    }
                  }
                }
                return newMap;
              });
            };
            
            // Handle ICE candidates
            pc.onicecandidate = async (event) => {
              if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                try {
                  wsRef.current.send(JSON.stringify({
                    type: "ice",
                    sessionId,
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                  }));
                  log(`Sent ICE candidate for ${sessionId}`);
                } catch (err) {
                  log(`Error sending ICE candidate for ${sessionId}`, err);
                }
              }
            };
            
            // Handle connection state changes
            pc.onconnectionstatechange = () => {
              const state = pc.connectionState;
              log(`Connection state for ${sessionId}: ${state}`);
              
              // Remove from connecting set when connected or failed/disconnected
              if (state === "connected") {
                connectingSessionsRef.current.delete(sessionId);
              } else if (state === "failed" || state === "disconnected" || state === "closed") {
                connectingSessionsRef.current.delete(sessionId);
              }
              
              setCandidateStreams(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(sessionId);
                if (existing) {
                  newMap.set(sessionId, {
                    ...existing,
                    status: state as "connecting" | "connected" | "disconnected" | "failed",
                  });
                }
                return newMap;
              });
            };
            
            // Set offer as remote description
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(offer));
              log(`Set remote description for ${sessionId}`);
              
              // Add existing ICE candidates from candidate
              for (const ice of candidateICE) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(ice));
                  log(`Added candidate ICE for ${sessionId}`);
                } catch (err) {
                  log(`Error adding candidate ICE for ${sessionId}`, err);
                }
              }
              
              // Create answer
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              
              // Send answer via WebSocket
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: "answer",
                  sessionId,
                  answer: {
                    type: answer.type,
                    sdp: answer.sdp,
                  },
                }));
                log(`Sent answer for ${sessionId}`);
              }
              
            } catch (err) {
              log(`Error setting up peer connection for ${sessionId}`, err);
              
              // Remove from connecting set on error
              connectingSessionsRef.current.delete(sessionId);
              
              // Close peer connection on error
              closePeerConnection(sessionId);
              
              setCandidateStreams(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(sessionId);
                if (existing) {
                  newMap.set(sessionId, {
                    ...existing,
                    status: "failed",
                    error: err instanceof Error ? err.message : "Failed to setup connection",
                  });
                }
                return newMap;
              });
            }
            
          } else if (message.type === "ice_candidate") {
            // Candidate sent ICE candidate
            const sessionId = message.sessionId;
            const candidate = message.candidate;
            
            const pc = peerConnectionsRef.current.get(sessionId);
            if (pc && candidate) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                log(`Added candidate ICE for ${sessionId}`);
              } catch (err) {
                log(`Error adding candidate ICE for ${sessionId}`, err);
              }
            }
            
          } else if (message.type === "error") {
            const errorMsg = message.message || "WebSocket error";
            log("Admin WebSocket error message", errorMsg);
            onError?.(errorMsg);
          }
        } catch (err) {
          log("Error processing admin WebSocket message", err);
        }
      };
      
      ws.onclose = () => {
        log("Admin WebSocket closed");
        wsRef.current = null;
        
        // Attempt reconnect if monitoring (unless explicitly stopped)
        if (isMonitoringRef.current) {
          log("Attempting admin WebSocket reconnect...");
          setTimeout(() => {
            if (isMonitoringRef.current && !wsRef.current) {
              setupWebSocket()
                .then(ws => {
                  wsRef.current = ws;
                })
                .catch(err => {
                  log("Admin WebSocket reconnect failed", err);
                });
            }
          }, 3000);
        }
      };
    });
  }, [assessmentId, log, connectToCandidate, onError]);

  // Start monitoring
  const startMonitoring = useCallback(async (): Promise<void> => {
    // Guard against multiple simultaneous calls
    if (isStartingRef.current) {
      log("startMonitoring already in progress, skipping duplicate call");
      return;
    }
    
    if (isMonitoringRef.current) {
      log("Already monitoring, cleaning up first to ensure clean restart");
      // Clean up existing connections without calling stopMonitoring (to avoid circular dependency)
      isMonitoringRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      peerConnectionsRef.current.forEach((pc, sessionId) => {
        closePeerConnection(sessionId);
      });
      peerConnectionsRef.current.clear();
      connectingSessionsRef.current.clear();
      setCandidateStreams(new Map());
      setActiveCandidates([]);
    }
    
    isStartingRef.current = true;
    isMonitoringRef.current = true;
    setIsLoading(true);
    
    // CRITICAL: Clear all old peer connections before starting
    // This ensures fresh connections when admin reopens dashboard
    peerConnectionsRef.current.forEach((pc, sessionId) => {
      log(`Clearing old peer connection for ${sessionId} before restart`);
      closePeerConnection(sessionId);
    });
    peerConnectionsRef.current.clear();
    connectingSessionsRef.current.clear();
    
    try {
      log("Starting monitoring...");
      
      // Connect WebSocket
      const ws = await setupWebSocket();
      wsRef.current = ws;
      
      // Backend will send active_sessions automatically on connect
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to start monitoring";
      log("Error starting monitoring", err);
      setIsLoading(false);
      onError?.(errorMsg);
      isMonitoringRef.current = false;
    } finally {
      // Always clear the starting guard, even on error
      isStartingRef.current = false;
    }
  }, [setupWebSocket, log, onError, closePeerConnection]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    log("Stopping monitoring...");
    
    isMonitoringRef.current = false;
    
    // Close WebSocket (local cleanup)
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Close all peer connections (local cleanup only)
    // CRITICAL: DO NOT end candidate sessions
    peerConnectionsRef.current.forEach((pc, sessionId) => {
      try {
        pc.close();
        log(`Closed peer connection for ${sessionId}`);
      } catch (err) {
        log(`Error closing peer connection for ${sessionId}`, err);
      }
    });
    peerConnectionsRef.current.clear();
    connectingSessionsRef.current.clear();
    
    // Clear local state
    setCandidateStreams(new Map());
    setActiveCandidates([]);
    setIsLoading(false);
    
    log("Monitoring stopped (local cleanup only)");
  }, [log]);

  // Refresh a specific candidate
  const refreshCandidate = useCallback(async (sessionId: string) => {
    log(`Refreshing candidate ${sessionId}`);
    
    // Get candidate info from existing stream
    const existingStream = candidateStreams.get(sessionId);
    const candidateId = existingStream?.candidateId || "";
    
    // Close existing peer connection
    closePeerConnection(sessionId);
    
    // Remove from streams
    setCandidateStreams(prev => {
      const newMap = new Map(prev);
      newMap.delete(sessionId);
      return newMap;
    });
    
    // Reconnect with force flag
    const session = {
      sessionId,
      candidateId,
      status: "active",
    };
    
    await connectToCandidate(session, true); // Force reconnect
  }, [log, closePeerConnection, candidateStreams, connectToCandidate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    candidateStreams,
    activeCandidates,
    isLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  };
}

