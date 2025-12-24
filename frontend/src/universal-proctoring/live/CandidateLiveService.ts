// ============================================================================
// Universal Proctoring System - Candidate Live Proctoring Service
// ============================================================================
//
// This service handles the CANDIDATE side of live proctoring:
// - Creates a session on the backend
// - Connects WebSocket for signaling
// - Creates WebRTC peer connection with webcam (+ optional screen)
// - Sends offer and handles answer from admin
// - Exchanges ICE candidates
//
// The webcam stream starts ONLY when this service is started.
// Admin viewing is independent - admin can connect at any time.
//
// ============================================================================

import {
  CandidateLiveProctoringConfig,
  CandidateLiveState,
  CandidateLiveCallbacks,
  DEFAULT_CANDIDATE_LIVE_CONFIG,
  INITIAL_CANDIDATE_LIVE_STATE,
  LIVE_PROCTORING_ENDPOINTS,
  WEBRTC_CONFIG,
} from "./types";
import {
  liveLog,
  setLiveDebugMode,
  createWebSocketConnection,
  sendWebSocketMessage,
  createPeerConnection,
  getWebcamStream,
  getAvailableScreenStream,
  stopStream,
  addStreamTracks,
  parseIceCandidate,
  formatIceCandidate,
} from "./utils";

// ============================================================================
// Candidate Live Proctoring Service
// ============================================================================

/**
 * Candidate Live Proctoring Service.
 *
 * Manages the candidate's side of live proctoring:
 * - Registers with backend (creates session)
 * - Starts webcam and optionally screen sharing
 * - Sets up WebRTC connection for admin to view
 *
 * The streaming starts ONLY when explicitly called via start().
 */
export class CandidateLiveService {
  private config: CandidateLiveProctoringConfig;
  private callbacks: CandidateLiveCallbacks | null = null;

  // WebSocket & WebRTC
  private ws: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;

  // Media streams
  private webcamStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  // Session tracking
  private sessionId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Guards
  private isStarting: boolean = false;
  private isStopping: boolean = false;

  // State
  private state: CandidateLiveState = { ...INITIAL_CANDIDATE_LIVE_STATE };

  constructor(
    config: Pick<CandidateLiveProctoringConfig, "assessmentId" | "candidateId"> &
      Partial<CandidateLiveProctoringConfig>
  ) {
    this.config = {
      ...DEFAULT_CANDIDATE_LIVE_CONFIG,
      ...config,
    };

    if (this.config.debugMode) {
      setLiveDebugMode(true);
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start live proctoring session.
   *
   * This will:
   * 1. Get webcam stream
   * 2. Get screen stream (if available)
   * 3. Create session on backend
   * 4. Connect WebSocket
   * 5. Create peer connection and send offer
   *
   * @param callbacks - Callbacks for state changes and errors
   * @param screenStream - Optional pre-captured screen stream
   */
  async start(
    callbacks: CandidateLiveCallbacks,
    screenStream?: MediaStream | null
  ): Promise<boolean> {
    // Guards
    if (this.isStarting) {
      this.log("Already starting, skipping");
      return false;
    }
    if (this.state.isStreaming) {
      this.log("Already streaming, skipping");
      return true;
    }

    this.isStarting = true;
    this.callbacks = callbacks;
    this.updateState({ error: null, connectionState: "connecting" });

    try {
      this.log("✅ Starting Live Proctoring...");

      // 1. Get webcam stream
      this.log("Getting webcam...");
      this.webcamStream = await getWebcamStream();
      this.log("✅ Webcam obtained");

      // 2. Get screen stream (optional but expected)
      this.screenStream = getAvailableScreenStream(screenStream);
      if (this.screenStream) {
        this.log("✅ Screen stream available");
      } else {
        this.log("⚠️ Screen stream not available - continuing with webcam only");
      }

      // 3. Create session on backend
      this.log("Creating session...");
      const sessionId = await this.createBackendSession();
      this.sessionId = sessionId;
      this.log(`✅ Session created: ${sessionId}`);

      // 4. Connect WebSocket
      this.log("Connecting WebSocket...");
      await this.connectWebSocket();
      this.log("✅ WebSocket connected");

      // 5. Setup peer connection and send offer
      this.log("Setting up peer connection...");
      await this.setupPeerConnection();
      this.log("✅ Peer connection ready");

      // 6. Start heartbeat
      this.startHeartbeat();

      // Mark as streaming
      this.updateState({
        isStreaming: true,
        sessionId,
        connectionState: "connecting",
      });

      this.log("✅ Live Proctoring started - waiting for admin to connect");
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to start streaming";
      this.log(`❌ Error: ${msg}`);
      this.updateState({ error: msg, connectionState: "failed" });
      this.callbacks?.onError?.(msg);
      this.cleanup();
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop live proctoring session.
   */
  async stop(): Promise<void> {
    if (this.isStopping) {
      this.log("Already stopping");
      return;
    }

    this.isStopping = true;
    this.log("✅ Stopping Live Proctoring...");

    try {
      // End session on backend
      if (this.sessionId) {
        try {
          await fetch(LIVE_PROCTORING_ENDPOINTS.endSession(this.sessionId), {
            method: "POST",
          });
          this.log("Session ended on backend");
        } catch (e) {
          this.log("Error ending session (ignored)", e);
        }
      }
    } finally {
      this.cleanup();
      this.isStopping = false;
      this.log("✅ Live Proctoring stopped");
    }
  }

  /**
   * Get current state.
   */
  getState(): CandidateLiveState {
    return { ...this.state };
  }

  /**
   * Check if streaming is active.
   */
  isStreaming(): boolean {
    return this.state.isStreaming;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Create session on backend.
   */
  private async createBackendSession(): Promise<string> {
    const response = await fetch(LIVE_PROCTORING_ENDPOINTS.startSession, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentId: this.config.assessmentId,
        candidateId: this.config.candidateId,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(
        errData.detail || `Session creation failed: ${response.statusText}`
      );
    }

    const data = await response.json();
    const sessionId = data.data?.sessionId || data.sessionId;
    if (!sessionId) {
      throw new Error("No sessionId returned from backend");
    }

    return sessionId;
  }

  /**
   * Connect WebSocket for signaling.
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No session ID for WebSocket connection");
    }

    const wsUrl = LIVE_PROCTORING_ENDPOINTS.candidateWs(
      this.sessionId,
      this.config.candidateId
    );

    this.ws = await createWebSocketConnection(
      wsUrl,
      this.config.connectionTimeoutMs
    );

    // Setup message handler
    this.ws.onmessage = this.handleWebSocketMessage.bind(this);

    this.ws.onclose = () => {
      this.log("⚠️ WebSocket closed");
      // Don't cleanup - session may still be active
    };

    this.ws.onerror = (err) => {
      this.log("❌ WebSocket error", err);
    };
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private async handleWebSocketMessage(event: MessageEvent): Promise<void> {
    try {
      const msg = JSON.parse(event.data);
      this.log(`WS message: ${msg.type}`);

      switch (msg.type) {
        case "answer":
          await this.handleAnswer(msg.answer);
          break;

        case "ice_candidate":
          await this.handleIceCandidate(msg.candidate);
          break;

        case "pong":
          this.log("Received pong");
          break;

        case "request_offer":
          // Admin requesting new offer (reconnection)
          this.log("Admin requested new offer");
          await this.sendOffer();
          break;

        default:
          this.log(`Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      this.log("Error processing WS message", err);
    }
  }

  /**
   * Handle answer from admin.
   */
  private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      this.log("⚠️ No peer connection for answer");
      return;
    }

    if (this.peerConnection.signalingState !== "have-local-offer") {
      this.log(
        `⚠️ Ignoring answer - wrong signaling state: ${this.peerConnection.signalingState}`
      );
      return;
    }

    this.log("Setting remote description (answer)...");
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
    this.log("✅ Answer set - connection establishing");
  }

  /**
   * Handle ICE candidate from admin.
   */
  private async handleIceCandidate(candidateData: unknown): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      return;
    }

    const candidate = parseIceCandidate(candidateData);
    if (candidate) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
        this.log("Added admin ICE candidate");
      } catch (err) {
        // Ignore duplicate/invalid ICE candidates
        this.log("ICE candidate error (ignored)", err);
      }
    }
  }

  /**
   * Setup WebRTC peer connection.
   */
  private async setupPeerConnection(): Promise<void> {
    this.peerConnection = createPeerConnection(WEBRTC_CONFIG);

    // Add webcam tracks
    if (this.webcamStream) {
      addStreamTracks(this.peerConnection, this.webcamStream, "webcam");
    }

    // Add screen tracks (if available)
    if (this.screenStream) {
      addStreamTracks(this.peerConnection, this.screenStream, "screen");
    }

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendWebSocketMessage(this.ws, {
          type: "ice",
          ...formatIceCandidate(event.candidate),
        });
        this.log("Sent ICE candidate");
      }
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      this.log(`Connection state: ${state}`);

      switch (state) {
        case "connected":
          this.updateState({ connectionState: "connected" });
          this.log("✅ WebRTC connected - streaming to admin!");
          break;
        case "disconnected":
          this.updateState({ connectionState: "disconnected" });
          this.log("⚠️ WebRTC disconnected");
          break;
        case "failed":
          this.updateState({ connectionState: "failed" });
          this.log("❌ WebRTC connection failed");
          break;
      }
    };

    // Send initial offer
    await this.sendOffer();
  }

  /**
   * Create and send WebRTC offer.
   */
  private async sendOffer(): Promise<void> {
    if (!this.peerConnection) return;

    this.log("Creating offer...");
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    sendWebSocketMessage(this.ws, {
      type: "offer",
      offer: { type: offer.type, sdp: offer.sdp },
    });

    this.log("✅ Offer sent");
  }

  /**
   * Start WebSocket heartbeat.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      sendWebSocketMessage(this.ws, { type: "ping" });
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Cleanup all resources.
   */
  private cleanup(): void {
    this.log("Cleaning up resources...");

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
      this.ws = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {
        /* ignore */
      }
      this.peerConnection = null;
    }

    // Stop webcam stream (we own it)
    stopStream(this.webcamStream);
    this.webcamStream = null;

    // Don't stop screen stream - we don't own it

    // Reset state
    this.sessionId = null;
    this.updateState({
      ...INITIAL_CANDIDATE_LIVE_STATE,
    });
  }

  /**
   * Update state and notify callback.
   */
  private updateState(partial: Partial<CandidateLiveState>): void {
    this.state = { ...this.state, ...partial };
    this.callbacks?.onStateChange(partial);
  }

  /**
   * Log with prefix.
   */
  private log(msg: string, data?: unknown): void {
    liveLog("CandidateLive", msg, data);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let candidateLiveInstance: CandidateLiveService | null = null;

/**
 * Get or create the candidate live proctoring service.
 */
export function getCandidateLiveService(
  config: Pick<CandidateLiveProctoringConfig, "assessmentId" | "candidateId"> &
    Partial<CandidateLiveProctoringConfig>
): CandidateLiveService {
  if (!candidateLiveInstance) {
    candidateLiveInstance = new CandidateLiveService(config);
  }
  return candidateLiveInstance;
}

/**
 * Reset the candidate live proctoring service.
 */
export async function resetCandidateLiveService(): Promise<void> {
  if (candidateLiveInstance) {
    await candidateLiveInstance.stop();
    candidateLiveInstance = null;
  }
}
