/**
 * LiveProctoringDashboard - COMPLETE REBUILD
 * 
 * Admin dashboard for viewing live candidate streams.
 * 
 * Features:
 * - Shows all active candidates with their webcam and screen streams
 * - Auto-connects when opened
 * - Handles stream updates and reconnections
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Video, Monitor, RefreshCw, User } from "lucide-react";
import { useMultiLiveProctorAdmin } from "@/hooks/useMultiLiveProctorAdmin";

interface LiveProctoringDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  assessmentId: string;
  adminId: string;
}

// Video stream component - handles attaching MediaStream to video element
function VideoStream({ 
  stream, 
  label, 
  icon: Icon 
}: { 
  stream: MediaStream | null; 
  label: string; 
  icon: React.ComponentType<{ className?: string }>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const lastStreamIdRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Check if this is a new stream
    const currentStreamId = stream?.id || null;
    if (currentStreamId === lastStreamIdRef.current) {
      // Same stream, don't re-attach
      return;
    }
    lastStreamIdRef.current = currentStreamId;

    // Reset state
    setIsPlaying(false);
    setHasError(false);

    if (!stream || !stream.active) {
      video.srcObject = null;
      console.log(`[VideoStream] ${label}: No active stream`);
      return;
    }

    const tracks = stream.getTracks();
    console.log(`[VideoStream] ${label}: Attaching stream`, {
      id: stream.id,
      active: stream.active,
      tracks: tracks.map(t => ({ kind: t.kind, readyState: t.readyState, enabled: t.enabled })),
    });

    // Attach stream to video element
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    // Play function with retry logic
    let playAttempts = 0;
    const maxAttempts = 5;

    const attemptPlay = async () => {
      if (playAttempts >= maxAttempts) {
        console.log(`[VideoStream] ${label}: Max play attempts reached`);
        setHasError(true);
        return;
      }
      playAttempts++;

      try {
        console.log(`[VideoStream] ${label}: Play attempt ${playAttempts}`);
        await video.play();
        console.log(`[VideoStream] ✅ ${label}: Playing! Size: ${video.videoWidth}x${video.videoHeight}`);
        setIsPlaying(true);
        setHasError(false);
      } catch (err) {
        console.log(`[VideoStream] ${label}: Play failed:`, err);
        // Retry after short delay
        setTimeout(attemptPlay, 500);
      }
    };

    // Event handlers
    const onLoadedMetadata = () => {
      console.log(`[VideoStream] ${label}: Metadata loaded, size: ${video.videoWidth}x${video.videoHeight}`);
      attemptPlay();
    };

    const onCanPlay = () => {
      console.log(`[VideoStream] ${label}: Can play`);
      if (!isPlaying) attemptPlay();
    };

    const onPlaying = () => {
      console.log(`[VideoStream] ${label}: Playing event`);
      setIsPlaying(true);
      setHasError(false);
    };

    const onError = (e: Event) => {
      console.error(`[VideoStream] ${label}: Error`, e);
      setHasError(true);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);

    // Initial play attempt
    setTimeout(attemptPlay, 100);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
    };
  }, [stream, label, isPlaying]);

  return (
    <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      
      {/* Label */}
      <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      
      {/* Loading/Error indicator */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80">
          <span className="text-gray-400 text-sm">
            {hasError ? "Error loading stream" : stream ? "Loading..." : "No stream"}
          </span>
        </div>
      )}
    </div>
  );
}

// Candidate card component
function CandidateCard({
  sessionId,
  candidateId,
  candidateName,
  candidateEmail,
  status,
  webcamStream,
  screenStream,
  error,
  onRefresh,
}: {
  sessionId: string;
  candidateId: string;
  candidateName?: string;
  candidateEmail?: string;
  status: string;
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
  error: string | null;
  onRefresh: () => void;
}) {
  // Display name priority: name > email > id
  const displayName = candidateName || candidateEmail || candidateId;
  
  // Status indicator color
  const statusColor = {
    connecting: "bg-yellow-500",
    connected: "bg-green-500",
    disconnected: "bg-gray-500",
    failed: "bg-red-500",
  }[status] || "bg-gray-500";

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm truncate max-w-[200px]">
              {displayName}
            </p>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              <span className="text-xs text-gray-500 capitalize">{status}</span>
            </div>
          </div>
        </div>
        
        <button
          onClick={onRefresh}
          className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
          title="Refresh connection"
        >
          <RefreshCw className="w-4 h-4 text-gray-600" />
        </button>
      </div>
      
      {/* Streams */}
      <div className="p-3 grid grid-cols-2 gap-2">
        <VideoStream stream={webcamStream} label="Webcam" icon={Video} />
        <VideoStream stream={screenStream} label="Screen" icon={Monitor} />
      </div>
      
      {/* Error message */}
      {error && (
        <div className="px-3 pb-3">
          <p className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">{error}</p>
        </div>
      )}
    </div>
  );
}

// Main dashboard component
export function LiveProctoringDashboard({
  isOpen,
  onClose,
  assessmentId,
  adminId,
}: LiveProctoringDashboardProps) {
  const hasStartedRef = useRef(false);
  
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
    onError: (err) => console.error("[Dashboard] Error:", err),
  });

  // Start monitoring when dashboard opens
  useEffect(() => {
    if (!isOpen) return;
    
    if (hasStartedRef.current) {
      console.log("[Dashboard] Already started, skipping");
      return;
    }
    
    hasStartedRef.current = true;
    console.log("[Dashboard] ✅ Starting monitoring...");
    startMonitoring();
  }, [isOpen, startMonitoring]);

  // Stop when closed
  useEffect(() => {
    if (!isOpen && hasStartedRef.current) {
      console.log("[Dashboard] Closed, stopping monitoring");
      hasStartedRef.current = false;
      stopMonitoring();
    }
  }, [isOpen, stopMonitoring]);

  // Handle close button
  const handleClose = useCallback(() => {
    console.log("[Dashboard] Close button clicked");
    hasStartedRef.current = false;
    stopMonitoring();
    onClose();
  }, [onClose, stopMonitoring]);

  if (!isOpen) return null;

  const candidates = Array.from(candidateStreams.values());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-100 rounded-xl shadow-2xl w-[95vw] max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Live Proctoring Dashboard</h2>
            <p className="text-sm text-green-600">
              Monitoring {candidates.length} active candidate{candidates.length !== 1 ? "s" : ""}
            </p>
          </div>
          
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              <span className="ml-3 text-gray-600">Connecting...</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Video className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-lg">No active candidates</p>
              <p className="text-sm">Candidates will appear here when they start their test</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.sessionId}
                  sessionId={candidate.sessionId}
                  candidateId={candidate.candidateId}
                  candidateName={candidate.candidateName}
                  candidateEmail={candidate.candidateEmail}
                  status={candidate.status}
                  webcamStream={candidate.webcamStream}
                  screenStream={candidate.screenStream}
                  error={candidate.error}
                  onRefresh={() => refreshCandidate(candidate.sessionId)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LiveProctoringDashboard;

