/**
 * WebcamPreview Component
 * 
 * Displays a small webcam preview with status overlay.
 */

import React, { forwardRef } from 'react';

interface WebcamPreviewProps {
  cameraOn: boolean;
  faceMeshStatus: 'loading' | 'loaded' | 'error';
  facesCount: number;
}

const WebcamPreview = forwardRef<HTMLVideoElement, WebcamPreviewProps>(
  ({ cameraOn, faceMeshStatus, facesCount }, ref) => {
    const statusColor = 
      faceMeshStatus === 'loaded' ? '#10b981' : 
      faceMeshStatus === 'loading' ? '#f59e0b' : 
      '#ef4444';

    const statusText = faceMeshStatus === 'loaded' ? 'LOADED' : 
                       faceMeshStatus === 'loading' ? 'LOADING' : 
                       'ERROR';

    return (
      <>
        <div className="webcam-preview-container">
          <video
            ref={ref}
            autoPlay
            playsInline
            muted
            className="webcam-video"
          />
          <div className="webcam-status">
            <span className={cameraOn ? 'status-on' : 'status-off'}>
              Camera: {cameraOn ? 'ON' : 'OFF'}
            </span>
            <span style={{ color: statusColor }}>
              | FaceMesh: {statusText}
            </span>
            <span>
              | Faces: {facesCount}
            </span>
          </div>
        </div>

        <style jsx>{`
          .webcam-preview-container {
            position: fixed;
            bottom: 16px;
            right: 16px;
            width: 180px;
            height: 120px;
            background-color: #1a1a1a;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 9998;
            border: 2px solid #333;
          }

          .webcam-video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transform: scaleX(-1);
          }

          .webcam-status {
            position: absolute;
            top: 4px;
            left: 4px;
            right: 4px;
            padding: 4px 6px;
            background-color: rgba(0, 0, 0, 0.7);
            color: #fff;
            font-size: 9px;
            font-family: monospace;
            border-radius: 4px;
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
          }

          .status-on {
            color: #10b981;
          }

          .status-off {
            color: #ef4444;
          }

          @media (max-width: 420px) {
            .webcam-preview-container {
              right: auto;
              left: 12px;
              width: 140px;
              height: 100px;
            }

            .webcam-status {
              font-size: 8px;
            }
          }
        `}</style>
      </>
    );
  }
);

WebcamPreview.displayName = 'WebcamPreview';

export default WebcamPreview;
