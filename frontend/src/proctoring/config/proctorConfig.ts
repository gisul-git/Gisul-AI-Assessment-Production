/**
 * Shared Proctor Configuration
 * 
 * This configuration is used by ALL three platforms:
 * - AI Assessment Platform
 * - Custom MCQ (CSV) Platform
 * - DSA Coding Assessment Platform
 */

export interface ProctorConfig {
  // Face Monitoring
  enableFaceMonitoring: boolean;
  
  // Tab Switch Detection
  enableTabSwitchDetection: boolean;
  
  // Fullscreen Monitoring
  enableFullscreenMonitoring: boolean;
  
  // Copy/Paste Blocking
  enableCopyPasteBlocking: boolean;
  
  // Screen Share Monitoring
  enableScreenShareMonitoring: boolean;
  
  // Extension Detection
  enableExtensionDetection: boolean;
  
  // Human Camera Monitoring (Live Proctoring)
  enableHumanCameraMonitoring: boolean;
  
  // External Device Detection
  enableExternalDeviceDetection: boolean;
  
  // Future features can be added here
}

/**
 * Default proctor configuration
 */
export const defaultProctorConfig: ProctorConfig = {
  enableFaceMonitoring: false,
  enableTabSwitchDetection: false,
  enableFullscreenMonitoring: false,
  enableCopyPasteBlocking: false,
  enableScreenShareMonitoring: false,
  enableExtensionDetection: false,
  enableHumanCameraMonitoring: false,
  enableExternalDeviceDetection: false,
};

/**
 * Convert proctoring settings from backend format to ProctorConfig
 * Backend uses different property names (multiFaceDetection, etc.)
 */
export function normalizeProctorConfig(backendSettings: any): ProctorConfig {
  return {
    enableFaceMonitoring: backendSettings?.multiFaceDetection || backendSettings?.frameMatchRecognition || false,
    enableTabSwitchDetection: backendSettings?.tabSwitchDetection || false,
    enableFullscreenMonitoring: backendSettings?.fullscreenMonitoring || false,
    enableCopyPasteBlocking: backendSettings?.copyPasteBlocking || false,
    enableScreenShareMonitoring: backendSettings?.liveCameraAndScreenMonitoring || false,
    enableExtensionDetection: backendSettings?.browserExtensionMonitoring || false,
    enableHumanCameraMonitoring: backendSettings?.liveCameraAndScreenMonitoring || false,
    enableExternalDeviceDetection: backendSettings?.externalDeviceDetection || false,
  };
}



