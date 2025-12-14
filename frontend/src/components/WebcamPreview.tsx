import React from 'react';

interface WebcamPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  statusText?: string;
  modelLoaded?: boolean;
  facesCount?: number;
}

export default function WebcamPreview({ videoRef, statusText, modelLoaded, facesCount }: WebcamPreviewProps) {
  return (
    <>
      <style jsx>{`
        .webcam-container {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 9998;
          width: 180px;
          height: 120px;
          border-radius: 8px;
          overflow: hidden;
          background: #000;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        @media (max-width: 420px) {
          .webcam-container {
            right: auto;
            left: 12px;
          }
        }

        .webcam-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .webcam-status {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
          color: #fff;
          font-size: 10px;
          padding: 6px 8px;
          text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .webcam-badge {
          position: absolute;
          top: 8px;
          left: 8px;
          background: rgba(0, 0, 0, 0.7);
          color: #fff;
          font-size: 9px;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-weight: 500;
          backdrop-filter: blur(4px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>
      <div className="webcam-container">
        <video
          ref={videoRef}
          className="webcam-video"
          autoPlay
          playsInline
          muted
        />
        <div className="webcam-badge">
          Camera: ON | FaceMesh: {modelLoaded ? 'LOADED' : 'LOADING'} | Faces: {facesCount ?? 0}
        </div>
        {statusText && (
          <div className="webcam-status">{statusText}</div>
        )}
      </div>
    </>
  );
}


