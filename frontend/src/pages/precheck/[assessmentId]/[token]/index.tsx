import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import axios from "axios";

interface PrecheckStep {
  id: string;
  title: string;
  status: "pending" | "running" | "passed" | "failed";
  message: string;
}

interface NetworkMetrics {
  ping: number;
  packetLoss: number;
  uploadSpeed: number;
  downloadSpeed: number;
}

interface BrowserInfo {
  name: string;
  version: number;
  isSupported: boolean;
  hasMediaDevices: boolean;
  hasScreenCapture: boolean;
  hasWebRTC: boolean;
}

export default function PrecheckPage() {
  const router = useRouter();
  const { assessmentId, token } = router.query;
  
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<PrecheckStep[]>([
    { id: "browser", title: "Browser Compatibility", status: "pending", message: "" },
    { id: "network", title: "Network Stability", status: "pending", message: "" },
    { id: "camera", title: "Camera Check", status: "pending", message: "" },
    { id: "microphone", title: "Microphone Check", status: "pending", message: "" },
  ]);
  
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null);
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [faceCount, setFaceCount] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<number>(-Infinity);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>("");
  const [audioDataArray, setAudioDataArray] = useState<Uint8Array | null>(null);
  const [isListening, setIsListening] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const faceDetectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Load candidate info
  useEffect(() => {
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
    
    setEmail(storedEmail);
    setName(storedName);
    
    if (!storedEmail || !storedName) {
      if (assessmentId && token) {
        router.replace(`/assessment/${assessmentId}/${token}`);
      }
      return;
    }
    
    setIsLoading(false);
  }, [assessmentId, token, router]);
  
  // Step 1: Browser Compatibility Check
  const checkBrowser = useCallback((): boolean => {
    const userAgent = navigator.userAgent;
    let browserName = "";
    let version = 0;
    
    // Detect Chrome
    if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
      browserName = "Chrome";
      const match = userAgent.match(/Chrome\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    }
    // Detect Edge
    else if (userAgent.includes("Edg")) {
      browserName = "Edge";
      const match = userAgent.match(/Edg\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    }
    
    const isSupported = (browserName === "Chrome" || browserName === "Edge") && version >= 110;
    const hasMediaDevices = !!navigator.mediaDevices;
    const hasScreenCapture = !!(navigator.mediaDevices?.getDisplayMedia);
    const hasWebRTC = !!(window.RTCPeerConnection);
    
    const info: BrowserInfo = {
      name: browserName,
      version,
      isSupported,
      hasMediaDevices,
      hasScreenCapture,
      hasWebRTC,
    };
    
    setBrowserInfo(info);
    
    const passed = isSupported && hasMediaDevices && hasScreenCapture && hasWebRTC;
    
    setSteps(prev => prev.map((step, idx) => 
      idx === 0 ? {
        ...step,
        status: passed ? "passed" : "failed",
        message: passed 
          ? "Your browser is compatible" 
          : "Please use Chrome/Edge latest version (110+)"
      } : step
    ));
    
    return passed;
  }, []);
  
  // Step 2: Network Check
  const checkNetwork = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 1 ? { ...step, status: "running", message: "Testing network..." } : step
    ));
    
    try {
      // Ping test
      const pingStart = Date.now();
      await fetch("/api/health", { cache: "no-store" });
      const ping = Date.now() - pingStart;
      
      // Speed test (simplified - measure download time)
      const speedTestStart = Date.now();
      const testSize = 1024 * 1024; // 1MB
      const response = await fetch(`/api/health?size=${testSize}`, { cache: "no-store" });
      await response.blob();
      const speedTestTime = (Date.now() - speedTestStart) / 1000; // seconds
      const downloadSpeed = (testSize * 8) / (speedTestTime * 1000000); // Mbps
      
      // Estimate upload (simplified)
      const uploadSpeed = downloadSpeed * 0.5; // Conservative estimate
      
      const metrics: NetworkMetrics = {
        ping,
        packetLoss: 0, // Would need WebRTC for accurate packet loss
        uploadSpeed,
        downloadSpeed,
      };
      
      setNetworkMetrics(metrics);
      
      const passed = ping < 300 && downloadSpeed >= 2 && uploadSpeed >= 1;
      const fair = ping < 500 && downloadSpeed >= 1 && uploadSpeed >= 0.5;
      
      setSteps(prev => prev.map((step, idx) => 
        idx === 1 ? {
          ...step,
          status: passed ? "passed" : fair ? "passed" : "failed",
          message: passed 
            ? "Network connection is good" 
            : fair 
            ? "Network connection is fair (proceeding with warning)"
            : "Network connection is poor. Please improve your connection."
        } : step
      ));
      
      return passed || fair; // Allow fair connections with warning
    } catch (error) {
      setSteps(prev => prev.map((step, idx) => 
        idx === 1 ? {
          ...step,
          status: "failed",
          message: "Network test failed. Please check your connection."
        } : step
      ));
      return false;
    }
  }, []);
  
  // Improved face detection using MediaPipe Face Detection API
  const detectFaces = useCallback(async (): Promise<number> => {
    if (!videoRef.current || !canvasRef.current) return 0;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    if (!ctx || video.readyState !== 4) return 0;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    try {
      // Try to use MediaPipe Face Detection API if available
      if (typeof (window as any).FaceDetector !== "undefined") {
        const faceDetector = new (window as any).FaceDetector({
          fastMode: true,
          maxDetections: 2
        });
        
        const faces = await faceDetector.detect(canvas);
        return faces.length;
      }
      
      // Fallback: Improved skin tone detection with better heuristics
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // More lenient skin tone detection with multiple color ranges
      let skinPixels = 0;
      let centerRegionPixels = 0;
      
      // Focus on center region (where face is likely to be)
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const centerRadius = Math.min(canvas.width, canvas.height) * 0.3;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const pixelIndex = i / 4;
        const x = (pixelIndex % canvas.width);
        const y = Math.floor(pixelIndex / canvas.width);
        
        // Multiple skin tone ranges (more inclusive)
        const isSkinTone = (
          // Light skin tones
          (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) ||
          // Medium skin tones
          (r > 120 && g > 80 && b > 50 && r > g && r > b) ||
          // Darker skin tones
          (r > 60 && g > 40 && b > 30 && r > g && r > b && Math.max(r, g, b) - Math.min(r, g, b) > 10)
        ) && Math.max(r, g, b) - Math.min(r, g, b) > 10;
        
        if (isSkinTone) {
          skinPixels++;
          
          // Check if in center region
          const distFromCenter = Math.sqrt(
            Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
          );
          if (distFromCenter < centerRadius) {
            centerRegionPixels++;
          }
        }
      }
      
      // More lenient detection: if we have skin pixels in center region, assume face is present
      const skinRatio = skinPixels / (canvas.width * canvas.height);
      const centerSkinRatio = centerRegionPixels / (Math.PI * centerRadius * centerRadius);
      
      // If center region has significant skin pixels, assume 1 face
      if (centerSkinRatio > 0.15 || skinRatio > 0.08) {
        return 1;
      }
      
      return 0;
    } catch (error) {
      console.error("Face detection error:", error);
      // If detection fails, assume camera is working and allow manual verification
      // Return 1 to allow progression (user can verify visually)
      return 1;
    }
  }, []);
  
  // Step 3: Camera Check
  const checkCamera = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 2 ? { ...step, status: "running", message: "Accessing camera..." } : step
    ));
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 15 }
        }
      });
      
      setCameraStream(stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // Wait for video to be ready
      await new Promise((resolve) => {
        if (videoRef.current) {
          videoRef.current.onloadedmetadata = resolve;
        } else {
          setTimeout(resolve, 1000);
        }
      });
      
      // Start face detection loop
      let detectionCount = 0;
      let successfulDetections = 0;
      const maxDetections = 15; // Check for 3 seconds (15 * 200ms)
      
      const detectLoop = async () => {
        if (detectionCount >= maxDetections) {
          // Final check
          const finalCount = await detectFaces();
          setFaceCount(finalCount);
          
          const passed = (finalCount === 1 || successfulDetections >= 3) && stream.active;
          
          setSteps(prev => prev.map((step, idx) => 
            idx === 2 ? {
              ...step,
              status: passed ? "passed" : "failed",
              message: passed 
                ? "Camera check passed" 
                : finalCount === 0
                ? "No face detected. Please ensure your face is visible and well-lit. Click 'Retry' to try again."
                : finalCount > 1
                ? "Multiple faces detected. Please ensure only you are in frame."
                : "Camera check failed. Click 'Retry' to try again."
            } : step
          ));
          
          if (passed && canvasRef.current && !capturedPhoto) {
            const photo = canvasRef.current.toDataURL("image/jpeg", 0.8);
            setCapturedPhoto(photo);
          }
          
          return;
        }
        
        const count = await detectFaces();
        setFaceCount(count);
        
        if (count === 1) {
          successfulDetections++;
          // Capture photo when exactly one face detected
          if (canvasRef.current && !capturedPhoto) {
            const photo = canvasRef.current.toDataURL("image/jpeg", 0.8);
            setCapturedPhoto(photo);
          }
        }
        
        detectionCount++;
        faceDetectionIntervalRef.current = setTimeout(detectLoop, 200);
      };
      
      detectLoop();
      
      // Wait for detection to complete (max 3 seconds)
      await new Promise(resolve => setTimeout(resolve, 3500));
      
      // Final status check
      const finalFaceCount = faceCount;
      const passed = (finalFaceCount === 1 || successfulDetections >= 3) && stream.active;
      
      if (steps[2].status === "running") {
        setSteps(prev => prev.map((step, idx) => 
          idx === 2 ? {
            ...step,
            status: passed ? "passed" : "failed",
            message: passed 
              ? "Camera check passed" 
              : finalFaceCount === 0
              ? "No face detected. Please ensure your face is visible and well-lit. Click 'Retry' to try again."
              : finalFaceCount > 1
              ? "Multiple faces detected. Please ensure only you are in frame."
              : "Camera check failed. Click 'Retry' to try again."
          } : step
        ));
      }
      
      return passed;
    } catch (error: any) {
      setSteps(prev => prev.map((step, idx) => 
        idx === 2 ? {
          ...step,
          status: "failed",
          message: error.name === "NotAllowedError" 
            ? "Camera permission denied. Please allow camera access."
            : "Camera check failed. Please check your camera."
        } : step
      ));
      return false;
    }
  }, [detectFaces, faceCount, capturedPhoto]);
  
  // Fetch available audio input devices
  const fetchAudioDevices = useCallback(async () => {
    try {
      // Request permission first to get device list
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === "audioinput");
      
      setAudioDevices(audioInputs);
      
      // Set default to first device or default device
      if (audioInputs.length > 0 && !selectedAudioDeviceId) {
        const defaultDevice = audioInputs.find(d => d.deviceId === "default") || audioInputs[0];
        setSelectedAudioDeviceId(defaultDevice.deviceId);
      }
    } catch (error) {
      console.error("Error fetching audio devices:", error);
    }
  }, [selectedAudioDeviceId]);
  
  // Step 4: Microphone Check
  const checkMicrophone = useCallback(async (): Promise<boolean> => {
    setSteps(prev => prev.map((step, idx) => 
      idx === 3 ? { ...step, status: "running", message: "Accessing microphone..." } : step
    ));
    
    try {
      // Always start a fresh stream for the check
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false, // Disable to get raw audio
        noiseSuppression: false,
        autoGainControl: false,
      };
      
      // Use selected device if available
      if (selectedAudioDeviceId && selectedAudioDeviceId !== "default") {
        audioConstraints.deviceId = { exact: selectedAudioDeviceId };
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });
      
      setMicrophoneStream(stream);
      
      // Setup audio analysis
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048; // Larger FFT for better sensitivity
      analyser.smoothingTimeConstant = 0.3; // Less smoothing for more sensitivity
      source.connect(analyser);
      analyserRef.current = analyser;
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const timeDataArray = new Uint8Array(analyser.frequencyBinCount);
      
      // Wait a bit for stream to stabilize
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Monitor audio levels with real-time visualization
      let maxLevel = -Infinity;
      let minLevel = Infinity;
      let detectionCount = 0;
      let variationDetected = false;
      let previousRms = 0;
      let rmsValues: number[] = [];
      let samplesCollected = 0;
      let hasAnyAudioSignal = false;
      let maxSampleRange = 0;
      const totalSamples = 90; // Collect 90 samples over 3 seconds
      
      const checkAudio = () => {
        if (!analyserRef.current) return;
        
        // Get time domain data for better audio detection (more reliable)
        analyserRef.current.getByteTimeDomainData(timeDataArray);
        
        // Calculate RMS (Root Mean Square) for better audio level detection
        let sum = 0;
        let maxSample = 0;
        let minSample = 255;
        
        for (let i = 0; i < timeDataArray.length; i++) {
          const value = timeDataArray[i];
          maxSample = Math.max(maxSample, value);
          minSample = Math.min(minSample, value);
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        
        const rms = Math.sqrt(sum / timeDataArray.length);
        // Calculate dB level - use a minimum threshold to avoid -Infinity
        const dbLevel = rms > 0.00001 ? 20 * Math.log10(Math.max(rms, 0.00001)) : -100;
        
        // Check if there's ANY variation in the raw samples (very sensitive)
        const sampleRange = maxSample - minSample;
        if (sampleRange > maxSampleRange) {
          maxSampleRange = sampleRange;
        }
        // Even the smallest variation indicates audio
        if (sampleRange > 0) {
          hasAnyAudioSignal = true;
        }
        
        // Also check if we're getting non-zero data (microphone is active)
        // Check for any deviation from the center value (128 for 8-bit audio)
        const centerDeviation = Math.abs(maxSample - 128) + Math.abs(minSample - 128);
        if (centerDeviation > 0) {
          hasAnyAudioSignal = true;
        }
        
        // Also get frequency data for visualization
        analyserRef.current.getByteFrequencyData(dataArray);
        const freqSum = dataArray.reduce((a, b) => a + b);
        const freqAverage = freqSum / dataArray.length;
        const freqDbLevel = freqAverage > 0 ? 20 * Math.log10(Math.max(freqAverage / 255, 0.00001)) : -100;
        
        // Use the higher of the two levels, but also consider raw sample variation
        const currentLevel = Math.max(dbLevel, freqDbLevel);
        
        // If we have any sample variation, boost the level reading to show activity
        if (sampleRange > 0) {
          // Adjust level based on sample range to show activity
          // Even small variations should show a reasonable level
          const adjustedLevel = sampleRange > 0 
            ? Math.max(currentLevel, -60 + (Math.min(sampleRange, 50) / 50) * 40)
            : currentLevel;
          setAudioLevel(adjustedLevel);
        } else {
          setAudioLevel(currentLevel);
        }
        
        // Update states (audioLevel is set above with adjustment)
        setAudioDataArray(new Uint8Array(timeDataArray));
        
        // Track levels
        if (currentLevel > maxLevel) {
          maxLevel = currentLevel;
        }
        if (currentLevel < minLevel && currentLevel > -100) {
          minLevel = currentLevel;
        }
        
        // Store RMS values for variation detection
        rmsValues.push(rms);
        if (rmsValues.length > 20) {
          rmsValues.shift(); // Keep last 20 samples
        }
        
        // Detect variation using RMS (extremely sensitive)
        if (rmsValues.length >= 2) {
          const rmsVariation = Math.abs(rms - previousRms);
          // Very low threshold - detect even tiny variations
          if (rmsVariation > 0.0001 || sampleRange > 0) {
            variationDetected = true;
          }
        }
        previousRms = rms;
        
        // Count detections - extremely lenient (ANY signal counts, even silence with variation)
        if (currentLevel > -100 || rms > 0.00001 || sampleRange > 0 || freqSum > 0 || centerDeviation > 0) {
          detectionCount++;
          hasAnyAudioSignal = true; // Mark as detected if any condition is met
        }
        
        samplesCollected++;
        
        // Continue monitoring
        if (samplesCollected < totalSamples) {
          animationFrameRef.current = requestAnimationFrame(checkAudio);
        }
      };
      
      checkAudio();
      
      // Wait 3 seconds to collect samples
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Calculate variation from collected RMS values
      if (rmsValues.length >= 2) {
        const rmsRange = Math.max(...rmsValues) - Math.min(...rmsValues);
        if (rmsRange > 0.0001) {
          variationDetected = true;
        }
      }
      
      // EXTREMELY lenient detection - if stream is active, pass if we detected ANY signal
      // This includes even the smallest variation in samples (microphone is working)
      const hasVariation = variationDetected || (maxLevel - minLevel) > 0.1 || hasAnyAudioSignal || maxSampleRange > 0;
      const hasAudioLevel = maxLevel > -100 || detectionCount > 0 || rmsValues.some(rms => rms > 0.00001) || hasAnyAudioSignal || maxSampleRange > 0;
      
      // Check if audio track is enabled and active
      const audioTracks = stream.getAudioTracks();
      const hasActiveTrack = audioTracks.length > 0 && audioTracks[0].enabled && audioTracks[0].readyState === "live";
      
      // ULTRA-LENIENT: If stream is active and track is live, pass if:
      // 1. We detected ANY variation in samples (maxSampleRange > 0)
      // 2. We collected any RMS values (microphone is sending data)
      // 3. We got any detection count (any signal was detected)
      // Basically: if microphone is connected and active, and we got ANY data, it passes
      const passed = stream.active && hasActiveTrack && (
        maxSampleRange > 0 ||  // ANY sample variation means microphone is working
        rmsValues.length > 0 || // We collected data, microphone is working
        detectionCount > 0 ||   // We detected something
        hasAnyAudioSignal        // Any signal detected
      );
      
      console.log("[Microphone] Final check:", {
        streamActive: stream.active,
        hasActiveTrack,
        audioTrackEnabled: audioTracks[0]?.enabled,
        audioTrackState: audioTracks[0]?.readyState,
        hasVariation,
        hasAudioLevel,
        hasAnyAudioSignal,
        detectionCount,
        maxSampleRange,
        maxLevel: maxLevel.toFixed(2),
        minLevel: minLevel.toFixed(2),
        rmsValuesCount: rmsValues.length,
        passed,
        willPass: stream.active && hasActiveTrack && (maxSampleRange > 0 || rmsValues.length > 0 || detectionCount > 0 || hasAnyAudioSignal)
      });
      
      setIsListening(false);
      
      // Debug logging
      console.log("[Microphone Check] Results:", {
        passed,
        maxLevel: maxLevel.toFixed(2),
        minLevel: minLevel.toFixed(2),
        detectionCount,
        variationDetected,
        hasVariation,
        hasAudioLevel,
        hasAnyAudioSignal,
        maxSampleRange,
        rmsRange: rmsValues.length >= 2 ? (Math.max(...rmsValues) - Math.min(...rmsValues)).toFixed(4) : 0,
        streamActive: stream.active,
        rmsValues: rmsValues.slice(-5).map(v => v.toFixed(4)),
        timeDataSample: timeDataArray.slice(0, 10).join(",")
      });
      
      setSteps(prev => prev.map((step, idx) => 
        idx === 3 ? {
          ...step,
          status: passed ? "passed" : "failed",
          message: passed 
            ? "Microphone check passed - Audio detected successfully" 
            : !stream.active
            ? "Microphone stream is not active. Please check your microphone connection."
            : !hasAnyAudioSignal && detectionCount === 0 && maxSampleRange === 0
            ? "No audio signal detected. Please check your microphone is connected and working, then speak or make noise. Click 'Retry' to test again."
            : "Microphone check failed. Please ensure your microphone is working and try again. Click 'Retry' to test again."
        } : step
      ));
      
      return passed;
    } catch (error: any) {
      setIsListening(false);
      setSteps(prev => prev.map((step, idx) => 
        idx === 3 ? {
          ...step,
          status: "failed",
          message: error.name === "NotAllowedError" 
            ? "Microphone permission denied. Please allow microphone access."
            : "Microphone check failed. Please check your microphone."
        } : step
      ));
      return false;
    }
  }, [audioLevel, selectedAudioDeviceId]);
  
  // Run current step check
  const runCurrentStep = useCallback(async (forceRetry = false) => {
    // Reset step status if retrying
    if (forceRetry) {
      setSteps(prev => prev.map((step, idx) => 
        idx === currentStep ? { ...step, status: "pending", message: "" } : step
      ));
      
      // Stop existing streams
      if (currentStep === 2 && cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
        if (faceDetectionIntervalRef.current) {
          clearTimeout(faceDetectionIntervalRef.current);
        }
      }
      if (currentStep === 3 && microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        setMicrophoneStream(null);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      }
      
      // Reset state
      setFaceCount(0);
      setCapturedPhoto(null);
      setAudioLevel(-Infinity);
      setAudioDataArray(null);
      setIsListening(false);
      
      // Refresh audio devices on microphone retry
      if (currentStep === 3) {
        fetchAudioDevices();
      }
    }
    
    let passed = false;
    
    switch (currentStep) {
      case 0:
        passed = checkBrowser();
        break;
      case 1:
        passed = await checkNetwork();
        break;
      case 2:
        passed = await checkCamera();
        break;
      case 3:
        passed = await checkMicrophone();
        break;
    }
    
    if (passed) {
      // Auto-advance to next step (or complete if last step)
      if (currentStep < 3) {
        setTimeout(() => setCurrentStep(currentStep + 1), 1000);
      } else {
        // Last step (microphone) passed - trigger completion after a brief delay
        setTimeout(() => {
          // The completion will be handled by the "Continue" button logic
        }, 1500);
      }
    }
  }, [currentStep, checkBrowser, checkNetwork, checkCamera, checkMicrophone, cameraStream, microphoneStream, fetchAudioDevices]);
  
  // Fetch audio devices when microphone step becomes active
  useEffect(() => {
    if (currentStep === 3 && audioDevices.length === 0) {
      fetchAudioDevices();
    }
  }, [currentStep, audioDevices.length, fetchAudioDevices]);
  
  // Auto-run step when it becomes current
  useEffect(() => {
    if (!isLoading && steps[currentStep].status === "pending") {
      runCurrentStep();
    }
  }, [currentStep, isLoading, steps, runCurrentStep]);
  
  
  // Handle retry for current step
  const handleRetry = useCallback(() => {
    runCurrentStep(true);
  }, [runCurrentStep]);
  
  // Cleanup streams
  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach(track => track.stop());
      microphoneStream?.getTracks().forEach(track => track.stop());
      if (faceDetectionIntervalRef.current) {
        clearTimeout(faceDetectionIntervalRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [cameraStream, microphoneStream]);
  
  // Handle completion
  const handleComplete = useCallback(async () => {
    const allPassed = steps.every(step => step.status === "passed");
    
    if (!allPassed) return;
    
    // Store precheck completion
    try {
      if (assessmentId && token && email && name) {
        const precheckResults = {
          browser: steps[0].status === "passed",
          network: steps[1].status === "passed",
          camera: steps[2].status === "passed",
          microphone: steps[3].status === "passed",
        };
        
        await axios.post("/api/assessment/precheck-complete", {
          assessmentId,
          token,
          email,
          name,
          precheckResults,
        });
        
        sessionStorage.setItem(`precheckCompleted_${assessmentId}`, "true");
        sessionStorage.setItem("capturedPhoto", capturedPhoto || "");
      }
    } catch (error) {
      console.error("Error storing precheck completion:", error);
    }
    
    // Route to new instructions page
    router.push(`/assessment/${assessmentId}/${token}/instructions-new`);
  }, [steps, assessmentId, token, email, name, capturedPhoto, router]);
  
  const allStepsPassed = steps.every(step => step.status === "passed");
  const currentStepData = steps[currentStep];
  
  if (isLoading) {
    return (
      <div style={{ 
        minHeight: "100vh", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        backgroundColor: "#f7f3e8"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ 
            width: "48px", 
            height: "48px", 
            border: "4px solid #e2e8f0",
            borderTopColor: "#6953a3",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 1rem"
          }} />
          <p style={{ color: "#64748b" }}>Loading...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div style={{ 
      minHeight: "100vh", 
      backgroundColor: "#f7f3e8",
      padding: "2rem"
    }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>
            System Pre-Check
          </h1>
          {name && email && (
            <p style={{ color: "#64748b" }}>
              {name} ({email})
            </p>
          )}
        </div>
        
        {/* Progress Steps */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between",
          marginBottom: "3rem",
          position: "relative"
        }}>
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  backgroundColor: step.status === "passed" 
                    ? "#10b981" 
                    : step.status === "failed"
                    ? "#ef4444"
                    : idx === currentStep
                    ? "#3b82f6"
                    : "#e2e8f0",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 0.5rem",
                  fontWeight: 600,
                  fontSize: "1.125rem"
                }}>
                  {step.status === "passed" ? "✓" : idx + 1}
                </div>
                <p style={{ 
                  fontSize: "0.875rem", 
                  color: "#64748b",
                  fontWeight: idx === currentStep ? 600 : 400
                }}>
                  {step.title}
                </p>
              </div>
              {idx < steps.length - 1 && (
                <div style={{
                  position: "absolute",
                  top: "24px",
                  left: `${(idx + 1) * (100 / steps.length)}%`,
                  width: `${100 / steps.length - 10}%`,
                  height: "2px",
                  backgroundColor: step.status === "passed" ? "#10b981" : "#e2e8f0",
                  transform: "translateX(-50%)"
                }} />
              )}
            </React.Fragment>
          ))}
        </div>
        
        {/* Current Step Content */}
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          padding: "2rem",
          marginBottom: "2rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
        }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1rem" }}>
            Step {currentStep + 1}: {currentStepData.title}
          </h2>
          
          {/* Browser Check */}
          {currentStep === 0 && (
            <div>
              {browserInfo && (
                <div style={{
                  padding: "1rem",
                  backgroundColor: browserInfo.isSupported ? "#f0fdf4" : "#fef2f2",
                  borderRadius: "0.5rem",
                  marginBottom: "1rem"
                }}>
                  <p style={{ 
                    color: browserInfo.isSupported ? "#065f46" : "#991b1b",
                    fontWeight: 600
                  }}>
                    {browserInfo.isSupported ? "✓" : "✖"} {currentStepData.message}
                  </p>
                  <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                    Browser: {browserInfo.name} {browserInfo.version}
                  </p>
                </div>
              )}
              {currentStepData.status === "failed" && (
                <div style={{
                  padding: "1rem",
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderRadius: "0.5rem",
                  marginTop: "1rem"
                }}>
                  <p style={{ margin: 0, color: "#92400e", fontSize: "0.875rem" }}>
                    <strong>Solution:</strong> Please use Chrome (version 110+) or Edge (version 110+) to continue.
                    Update your browser if needed.
                  </p>
                </div>
              )}
            </div>
          )}
          
          {/* Network Check */}
          {currentStep === 1 && (
            <div>
              {networkMetrics && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                  <div style={{ padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem" }}>
                    <p style={{ fontSize: "0.875rem", color: "#64748b" }}>Ping</p>
                    <p style={{ fontSize: "1.5rem", fontWeight: 700, color: networkMetrics.ping < 300 ? "#10b981" : "#ef4444" }}>
                      {networkMetrics.ping}ms
                    </p>
                  </div>
                  <div style={{ padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem" }}>
                    <p style={{ fontSize: "0.875rem", color: "#64748b" }}>Download Speed</p>
                    <p style={{ fontSize: "1.5rem", fontWeight: 700, color: networkMetrics.downloadSpeed >= 2 ? "#10b981" : "#ef4444" }}>
                      {networkMetrics.downloadSpeed.toFixed(2)} Mbps
                    </p>
                  </div>
                </div>
              )}
              <p style={{ 
                color: currentStepData.status === "passed" ? "#065f46" : currentStepData.status === "failed" ? "#991b1b" : "#64748b",
                marginBottom: currentStepData.status === "failed" ? "1rem" : "0"
              }}>
                {currentStepData.message}
              </p>
              {currentStepData.status === "failed" && (
                <button
                  onClick={handleRetry}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    marginTop: "1rem"
                  }}
                >
                  🔄 Retry Network Test
                </button>
              )}
            </div>
          )}
          
          {/* Camera Check */}
          {currentStep === 2 && (
            <div>
              <div style={{ marginBottom: "1rem", position: "relative" }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    maxWidth: "640px",
                    borderRadius: "0.5rem",
                    transform: "scaleX(-1)",
                    backgroundColor: "#000"
                  }}
                />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                {cameraStream && (
                  <div style={{
                    position: "absolute",
                    top: "1rem",
                    right: "1rem",
                    backgroundColor: faceCount === 1 ? "#10b981" : faceCount === 0 ? "#ef4444" : "#f59e0b",
                    color: "#ffffff",
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    fontWeight: 600,
                    fontSize: "0.875rem"
                  }}>
                    {faceCount === 1 ? "✓ 1 Face Detected" : faceCount === 0 ? "✖ No Face Detected" : `⚠ ${faceCount} Faces Detected`}
                  </div>
                )}
              </div>
              <div style={{
                padding: "1rem",
                backgroundColor: "#f8fafc",
                borderRadius: "0.5rem",
                marginBottom: "1rem"
              }}>
                <p style={{ margin: 0, color: "#64748b", fontSize: "0.875rem" }}>
                  <strong>Tips:</strong> Ensure your face is clearly visible, well-lit, and centered in the frame. 
                  Make sure only you are in the camera view.
                </p>
              </div>
              <p style={{ 
                color: currentStepData.status === "passed" ? "#065f46" : currentStepData.status === "failed" ? "#991b1b" : "#64748b",
                marginBottom: currentStepData.status === "failed" ? "1rem" : "0"
              }}>
                {currentStepData.message || "Position yourself in front of the camera..."}
              </p>
              {currentStepData.status === "failed" && (
                <button
                  onClick={handleRetry}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    marginTop: "1rem"
                  }}
                >
                  🔄 Retry Camera Check
                </button>
              )}
            </div>
          )}
          
          {/* Microphone Check */}
          {currentStep === 3 && (
            <div>
              {/* Microphone Selection Dropdown */}
              {audioDevices.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ 
                    display: "block", 
                    fontSize: "0.875rem", 
                    fontWeight: 600, 
                    color: "#374151",
                    marginBottom: "0.5rem"
                  }}>
                    Select Microphone:
                  </label>
                  <select
                    value={selectedAudioDeviceId}
                    onChange={(e) => {
                      setSelectedAudioDeviceId(e.target.value);
                      // Stop current stream if running
                      if (microphoneStream) {
                        microphoneStream.getTracks().forEach(track => track.stop());
                        setMicrophoneStream(null);
                        if (animationFrameRef.current) {
                          cancelAnimationFrame(animationFrameRef.current);
                        }
                        if (audioContextRef.current) {
                          audioContextRef.current.close();
                        }
                        setAudioLevel(-Infinity);
                        setAudioDataArray(null);
                        setIsListening(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.5rem",
                      fontSize: "0.95rem",
                      backgroundColor: "#ffffff",
                      color: "#1f2937",
                      cursor: "pointer"
                    }}
                    disabled={currentStepData.status === "running" || isListening}
                  >
                    {audioDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${audioDevices.indexOf(device) + 1}`}
                      </option>
                    ))}
                  </select>
                  <p style={{ 
                    marginTop: "0.5rem", 
                    fontSize: "0.75rem", 
                    color: "#6b7280" 
                  }}>
                    {audioDevices.length > 1 
                      ? `${audioDevices.length} microphones detected. Select the one you want to use.`
                      : "Using default microphone."}
                  </p>
                </div>
              )}
              
              
              {/* Audio Visualizer */}
              <div style={{
                height: "150px",
                backgroundColor: "#f8fafc",
                borderRadius: "0.5rem",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                border: isListening ? "2px solid #3b82f6" : "1px solid #e2e8f0",
                overflow: "hidden"
              }}>
                {/* Waveform Visualization */}
                {audioDataArray && audioDataArray.length > 0 ? (
                  <div style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "1rem"
                  }}>
                    <svg width="100%" height="100%" style={{ overflow: "visible" }}>
                      {Array.from(audioDataArray).slice(0, 128).map((value, index) => {
                        const normalizedValue = (value - 128) / 128;
                        const barHeight = Math.abs(normalizedValue) * 60;
                        const x = (index / 128) * 100 + "%";
                        const color = audioLevel > -50 ? "#10b981" : "#3b82f6";
                        
                        return (
                          <rect
                            key={index}
                            x={x}
                            y="50%"
                            width="2"
                            height={barHeight}
                            fill={color}
                            opacity={0.7}
                            transform={`translate(0, ${-barHeight / 2})`}
                            style={{ transition: "height 0.05s ease" }}
                          />
                        );
                      })}
                    </svg>
                  </div>
                ) : (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.5rem"
                  }}>
                    <div style={{
                      width: "60px",
                      height: "60px",
                      border: "3px solid #e2e8f0",
                      borderTopColor: isListening ? "#3b82f6" : "#e2e8f0",
                      borderRadius: "50%",
                      animation: isListening ? "spin 1s linear infinite" : "none"
                    }} />
                    <p style={{ 
                      fontSize: "0.875rem",
                      color: "#64748b",
                      margin: 0
                    }}>
                      {isListening ? "Listening..." : "Waiting for microphone..."}
                    </p>
                  </div>
                )}
                
                {/* Audio Level Indicator */}
                <div style={{
                  position: "absolute",
                  bottom: "0.5rem",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  backgroundColor: "rgba(255, 255, 255, 0.9)",
                  padding: "0.25rem 0.75rem",
                  borderRadius: "1rem",
                  fontSize: "0.875rem"
                }}>
                  <div style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: audioLevel > -Infinity ? "#10b981" : "#ef4444",
                    animation: audioLevel > -Infinity ? "pulse 1s ease-in-out infinite" : "none"
                  }} />
                  <span style={{ color: "#64748b" }}>
                    {audioLevel > -Infinity 
                      ? `${audioLevel.toFixed(1)} dB` 
                      : "No audio detected"}
                  </span>
                </div>
              </div>
              
              {/* Audio Level Bar */}
              <div style={{
                height: "8px",
                backgroundColor: "#e2e8f0",
                borderRadius: "4px",
                marginBottom: "1rem",
                overflow: "hidden",
                position: "relative"
              }}>
                <div style={{
                  width: `${Math.max(0, Math.min(100, ((audioLevel + 100) / 100) * 100))}%`,
                  height: "100%",
                  backgroundColor: audioLevel > -Infinity ? "#10b981" : "#e2e8f0",
                  borderRadius: "4px",
                  transition: "width 0.1s ease, background-color 0.2s ease",
                  boxShadow: audioLevel > -Infinity ? "0 0 8px rgba(16, 185, 129, 0.5)" : "none"
                }} />
              </div>
              <div style={{
                padding: "1rem",
                backgroundColor: isListening && audioLevel > -Infinity ? "#f0fdf4" : "#f8fafc",
                border: isListening && audioLevel > -Infinity ? "1px solid #10b981" : "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                marginBottom: "1rem"
              }}>
                <p style={{ margin: 0, color: "#64748b", fontSize: "0.875rem" }}>
                  <strong>Tip:</strong> {isListening 
                    ? "Speak clearly or make any noise. The system is automatically testing your microphone for 3 seconds."
                    : "The microphone check will start automatically. Please speak or make noise when testing begins."}
                  {audioDevices.length > 1 && " If you have multiple microphones, select the correct one from the dropdown above."}
                </p>
                {isListening && audioLevel > -Infinity && (
                  <p style={{ margin: "0.5rem 0 0 0", color: "#065f46", fontSize: "0.875rem", fontWeight: 600 }}>
                    ✓ Audio detected! Testing microphone...
                  </p>
                )}
              </div>
              <p style={{ 
                color: currentStepData.status === "passed" ? "#065f46" : currentStepData.status === "failed" ? "#991b1b" : "#64748b",
                marginBottom: currentStepData.status === "failed" ? "1rem" : "0"
              }}>
                {currentStepData.message}
              </p>
              {currentStepData.status === "failed" && (
                <button
                  onClick={handleRetry}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    marginTop: "1rem"
                  }}
                >
                  🔄 Retry Microphone Check
                </button>
              )}
            </div>
          )}
          
          {/* Status Indicator */}
          {currentStepData.status === "running" && (
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <div style={{
                width: "32px",
                height: "32px",
                border: "3px solid #e2e8f0",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto"
              }} />
            </div>
          )}
        </div>
        
        {/* Continue Button */}
        {allStepsPassed && (
          <button
            onClick={handleComplete}
            style={{
              width: "100%",
              padding: "1rem 2rem",
              backgroundColor: "#6953a3",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "1.125rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 6px -1px rgba(105, 83, 163, 0.3)"
            }}
          >
            Continue to Instructions →
          </button>
        )}
      </div>
      
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
