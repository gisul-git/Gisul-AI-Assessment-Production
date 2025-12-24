/**
 * useMultiLiveProctorAdmin Hook - COMPLETE REBUILD
 * 
 * Admin-side Live Proctoring monitoring.
 * 
 * Architecture:
 * - Admin connects WebSocket to receive list of active candidate sessions
 * - For each candidate session: admin receives offer, creates answer
 * - Media streams flow P2P from candidate to admin
 * - Admin can disconnect/reconnect without affecting candidate streams
 */

import { useCallback, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface CandidateStream {
  sessionId: string;
  candidateId: string;
  candidateName?: string;
  candidateEmail?: string;
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
  activeCandidates: string[];
  isLoading: boolean;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => void;
  refreshCandidate: (sessionId: string) => Promise<void>;
}

// Module-level singleton to prevent React Strict Mode double connections
let adminSingleton: {
  assessmentId: string;
  ws: WebSocket | null;
  isConnecting: boolean;
} | null = null;

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

  // Logging
  const log = useCallback((msg: string, data?: unknown) => {
    const prefix = `[AdminProctor]`;
    if (debugMode || msg.includes("✅") || msg.includes("❌") || msg.includes("⚠️")) {
      console.log(`${prefix} ${msg}`, data !== undefined ? data : "");
    }
  }, [debugMode]);

  // Update candidate stream state
  const updateCandidate = useCallback((sessionId: string, updates: Partial<CandidateStream>) => {
    setCandidateStreams(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(sessionId);
      if (existing) {
        newMap.set(sessionId, { ...existing, ...updates });
      }
      return newMap;
    });
  }, []);

  // Connect to a single candidate (receive their streams)
  const connectToCandidate = useCallback(async (
    sessionId: string,
    candidateId: string,
    offer: RTCSessionDescriptionInit
  ) => {
    log(`Connecting to candidate ${candidateId} (session: ${sessionId})...`);
    
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log("❌ WebSocket not connected");
      return;
    }
    
    // Close existing peer connection if any
    const existingPc = peerConnectionsRef.current.get(sessionId);
    if (existingPc) {
      // Check if already connected/connecting
      if (existingPc.connectionState === "connected" || existingPc.connectionState === "connecting") {
        log(`Already connected/connecting to ${candidateId}, skipping`);
        return;
      }
      try { existingPc.close(); } catch (e) { /* ignore */ }
      peerConnectionsRef.current.delete(sessionId);
    }
    
    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peerConnectionsRef.current.set(sessionId, pc);
    
    // Track received streams
    let trackCount = 0;
    
    // Handle incoming tracks - CRITICAL for receiving streams
    pc.ontrack = (event) => {
      trackCount++;
      log(`✅ Received track #${trackCount} for ${candidateId}:`, {
        kind: event.track.kind,
        id: event.track.id,
        streamId: event.streams[0]?.id,
      });
      
      const stream = event.streams[0];
      if (!stream) {
        log("⚠️ No stream in track event");
        return;
      }
      
      // First video track = webcam, second = screen
      if (trackCount === 1) {
        log(`✅ Webcam stream received: ${stream.id}`);
        updateCandidate(sessionId, { webcamStream: stream, status: "connected" });
      } else if (trackCount === 2) {
        log(`✅ Screen stream received: ${stream.id}`);
        updateCandidate(sessionId, { screenStream: stream, status: "connected" });
      }
    };
    
    // Handle ICE candidates - send to candidate
    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "ice",
          sessionId,
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }));
        log(`Sent ICE candidate to ${candidateId}`);
      }
    };
    
    // Handle connection state
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log(`Connection state for ${candidateId}: ${state}`);
      
      if (state === "connected") {
        updateCandidate(sessionId, { status: "connected" });
        log(`✅ Connected to ${candidateId}!`);
      } else if (state === "disconnected" || state === "failed") {
        updateCandidate(sessionId, { 
          status: state === "failed" ? "failed" : "disconnected" 
        });
        log(`⚠️ ${state} from ${candidateId}`);
      }
    };
    
    try {
      // Set remote description (candidate's offer)
      log("Setting remote description (offer)...");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Create answer
      log("Creating answer...");
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      // Send answer to candidate via WebSocket
      ws.send(JSON.stringify({
        type: "answer",
        sessionId,
        answer: { type: answer.type, sdp: answer.sdp },
      }));
      log(`✅ Answer sent to ${candidateId}`);
      
      updateCandidate(sessionId, { status: "connecting" });
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      log(`❌ Error connecting to ${candidateId}: ${msg}`);
      updateCandidate(sessionId, { status: "failed", error: msg });
    }
  }, [log, updateCandidate]);

  // Start monitoring all candidates
  const startMonitoring = useCallback(async () => {
    // Singleton check - prevent duplicate connections
    if (adminSingleton?.assessmentId === assessmentId) {
      if (adminSingleton.isConnecting) {
        log("Connection already in progress (singleton)");
        return;
      }
      if (adminSingleton.ws?.readyState === WebSocket.OPEN) {
        log("Using existing singleton connection");
        wsRef.current = adminSingleton.ws;
        isMonitoringRef.current = true;
        return;
      }
    }
    
    if (isMonitoringRef.current) {
      log("Already monitoring");
      return;
    }
    
    // Set singleton immediately to prevent race conditions
    adminSingleton = { assessmentId, ws: null, isConnecting: true };
    
    setIsLoading(true);
    isMonitoringRef.current = true;
    
    try {
      log("✅ Starting admin monitoring...");
      
      // Connect WebSocket
      const wsUrl = `${API_URL.replace("http://", "ws://").replace("https://", "wss://")}/api/v1/proctor/ws/live/admin/${assessmentId}`;
      log(`Connecting WebSocket: ${wsUrl}`);
      
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error("WebSocket timeout"));
        }, 10000);
        
        socket.onopen = () => {
          clearTimeout(timeout);
          log("✅ Admin WebSocket connected");
          adminSingleton = { assessmentId, ws: socket, isConnecting: false };
          resolve(socket);
        };
        
        socket.onerror = () => {
          clearTimeout(timeout);
          adminSingleton = null;
          reject(new Error("WebSocket connection failed"));
        };
      });
      
      wsRef.current = ws;
      
      // Handle WebSocket messages
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          log(`WS message: ${msg.type}`, msg);
          
          if (msg.type === "active_sessions") {
            // List of active candidate sessions
            const sessions = msg.sessions as Array<{
              sessionId: string;
              candidateId: string;
              candidateName?: string;
              candidateEmail?: string;
              status: string;
            }>;
            
            log(`✅ Received ${sessions.length} active sessions`);
            
            // Initialize candidate streams
            const newStreams = new Map<string, CandidateStream>();
            const sessionIds: string[] = [];
            
            for (const sess of sessions) {
              sessionIds.push(sess.sessionId);
              newStreams.set(sess.sessionId, {
                sessionId: sess.sessionId,
                candidateId: sess.candidateId,
                candidateName: sess.candidateName,
                candidateEmail: sess.candidateEmail,
                status: "connecting",
                webcamStream: null,
                screenStream: null,
                error: null,
              });
              
              // Request session data (offer) for each session
              ws.send(JSON.stringify({
                type: "get_session",
                sessionId: sess.sessionId,
              }));
              log(`Requested session data for ${sess.candidateName || sess.candidateEmail || sess.candidateId}`);
            }
            
            setCandidateStreams(newStreams);
            setActiveCandidates(sessionIds);
            
          } else if (msg.type === "session_data") {
            // Received offer from candidate
            const { sessionId, candidateId, offer } = msg;
            
            if (!offer) {
              log(`⚠️ No offer for session ${sessionId}`);
              updateCandidate(sessionId, { 
                status: "failed", 
                error: "No offer available" 
              });
              return;
            }
            
            log(`✅ Received offer for ${candidateId}`);
            await connectToCandidate(sessionId, candidateId, offer);
            
          } else if (msg.type === "ice_candidate") {
            // ICE candidate from candidate
            const { sessionId, candidate } = msg;
            const pc = peerConnectionsRef.current.get(sessionId);
            
            if (pc && candidate && pc.remoteDescription) {
              try {
                const candidateStr = typeof candidate === 'object' ? candidate.candidate : candidate;
                const ice = new RTCIceCandidate({
                  candidate: candidateStr,
                  sdpMid: candidate.sdpMid || "0",
                  sdpMLineIndex: candidate.sdpMLineIndex || 0,
                });
                await pc.addIceCandidate(ice);
                log(`Added ICE candidate for ${sessionId}`);
              } catch (err) {
                // Ignore duplicate/invalid ICE candidates
                log(`ICE error (ignored): ${err}`);
              }
            }
            
          } else if (msg.type === "new_session") {
            // New candidate joined
            const { sessionId, candidateId, candidateName, candidateEmail } = msg;
            log(`✅ New candidate: ${candidateName || candidateEmail || candidateId}`);
            
            setCandidateStreams(prev => {
              const newMap = new Map(prev);
              newMap.set(sessionId, {
                sessionId,
                candidateId,
                candidateName,
                candidateEmail,
                status: "connecting",
                webcamStream: null,
                screenStream: null,
                error: null,
              });
              return newMap;
            });
            
            setActiveCandidates(prev => [...prev, sessionId]);
            
            // Request their offer
            ws.send(JSON.stringify({
              type: "get_session",
              sessionId,
            }));
            
          } else if (msg.type === "session_ended") {
            // Candidate left
            const { sessionId } = msg;
            log(`⚠️ Session ended: ${sessionId}`);
            
            // Close peer connection
            const pc = peerConnectionsRef.current.get(sessionId);
            if (pc) {
              try { pc.close(); } catch (e) { /* ignore */ }
              peerConnectionsRef.current.delete(sessionId);
            }
            
            // Remove from state
            setCandidateStreams(prev => {
              const newMap = new Map(prev);
              newMap.delete(sessionId);
              return newMap;
            });
            
            setActiveCandidates(prev => prev.filter(id => id !== sessionId));
          }
        } catch (err) {
          log("Error processing message", err);
        }
      };
      
      ws.onclose = () => {
        log("⚠️ Admin WebSocket closed");
        isMonitoringRef.current = false;
        wsRef.current = null;
        if (adminSingleton?.assessmentId === assessmentId) {
          adminSingleton = null;
        }
      };
      
      ws.onerror = (err) => {
        log("❌ Admin WebSocket error", err);
      };
      
      setIsLoading(false);
      log("✅ Admin monitoring started");
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Monitoring failed";
      log(`❌ Error: ${msg}`);
      onError?.(msg);
      setIsLoading(false);
      isMonitoringRef.current = false;
      adminSingleton = null;
    }
  }, [assessmentId, log, onError, connectToCandidate, updateCandidate]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    log("✅ Stopping monitoring...");
    
    // Close all peer connections
    peerConnectionsRef.current.forEach((pc, sessionId) => {
      try { pc.close(); } catch (e) { /* ignore */ }
    });
    peerConnectionsRef.current.clear();
    
    // Close WebSocket
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) { /* ignore */ }
      wsRef.current = null;
    }
    
    // Clear singleton
    if (adminSingleton?.assessmentId === assessmentId) {
      adminSingleton = null;
    }
    
    isMonitoringRef.current = false;
    setCandidateStreams(new Map());
    setActiveCandidates([]);
    
    log("✅ Monitoring stopped");
  }, [assessmentId, log]);

  // Refresh a single candidate's connection
  const refreshCandidate = useCallback(async (sessionId: string) => {
    log(`Refreshing candidate ${sessionId}...`);
    
    // Close existing connection
    const pc = peerConnectionsRef.current.get(sessionId);
    if (pc) {
      try { pc.close(); } catch (e) { /* ignore */ }
      peerConnectionsRef.current.delete(sessionId);
    }
    
    // Request new session data
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "get_session",
        sessionId,
      }));
    }
  }, [log]);

  return {
    candidateStreams,
    activeCandidates,
    isLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  };
}

