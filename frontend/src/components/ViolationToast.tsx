import React, { useState, useEffect, useRef } from 'react';

export interface ViolationToastPayload {
  eventType: string;
  snapshotUrl?: string;
  timestamp: string;
  candidateId?: string;
}

let showToastFn: ((payload: ViolationToastPayload) => void) | null = null;

export function showViolationToast(payload: ViolationToastPayload) {
  if (showToastFn) {
    showToastFn(payload);
  }
}

const DISPLAY_MS = 3000;
const ANIM_MS = 180;
const TOAST_GAP_MS = 5000; // 5 seconds gap between toasts

export default function ViolationToast() {
  const [toast, setToast] = useState<ViolationToastPayload | null>(null);
  const timerRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const lastToastTimeRef = useRef<number>(0);
  const queuedToastRef = useRef<ViolationToastPayload | null>(null);
  const isToastVisibleRef = useRef<boolean>(false);

  const showToastRef = useRef<((payload: ViolationToastPayload) => void) | null>(null);

  useEffect(() => {
    const showToast = (payload: ViolationToastPayload) => {
      // Clear existing toast immediately
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsVisible(false);
      
      // Show new toast after brief delay for smooth transition
      setTimeout(() => {
        setToast(payload);
        setIsVisible(true);
        isToastVisibleRef.current = true;
        lastToastTimeRef.current = Date.now();
        
        // Auto-dismiss after 3 seconds
        timerRef.current = window.setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => {
            setToast(null);
            isToastVisibleRef.current = false;
            // After toast is dismissed, check if there's a queued toast
            const queued = queuedToastRef.current;
            if (queued) {
              queuedToastRef.current = null;
              // Wait for the gap period before showing queued toast
              const timeSinceLastToast = Date.now() - lastToastTimeRef.current;
              const remainingGap = Math.max(0, TOAST_GAP_MS - timeSinceLastToast);
              setTimeout(() => {
                if (showToastRef.current) {
                  showToastRef.current(queued);
                }
              }, remainingGap);
            }
          }, ANIM_MS);
        }, DISPLAY_MS);
      }, 50);
    };

    showToastRef.current = showToast;

    showToastFn = (payload: ViolationToastPayload) => {
      const now = Date.now();
      const timeSinceLastToast = now - lastToastTimeRef.current;
      
      // If a toast is currently visible, queue this one
      if (isToastVisibleRef.current) {
        queuedToastRef.current = payload;
        return;
      }
      
      // If enough time has passed since last toast (or first toast), show immediately
      if (timeSinceLastToast >= TOAST_GAP_MS || lastToastTimeRef.current === 0) {
        showToast(payload);
      } else {
        // Queue the toast and show it after the gap period
        queuedToastRef.current = payload;
        const remainingGap = TOAST_GAP_MS - timeSinceLastToast;
        setTimeout(() => {
          const queued = queuedToastRef.current;
          if (queued && !isToastVisibleRef.current && showToastRef.current) {
            queuedToastRef.current = null;
            showToastRef.current(queued);
          }
        }, remainingGap);
      }
    };

    return () => {
      showToastFn = null;
      showToastRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!toast) return null;

  const timeLabel = new Date(toast.timestamp).toLocaleTimeString();
  const titleMap: Record<string, string> = {
    'GAZE_AWAY': 'Gaze Away',
    'MULTIPLE_FACE': 'Multiple Faces',
    'MULTIPLE_FACES_DETECTED': 'Multiple Faces',
    'IN_FRAME_LOST': 'Face Not Detected',
    'TAB_SWITCH': 'Tab Switched',
    'FOCUS_LOST': 'Focus Lost',
    'FULLSCREEN_EXIT': 'Fullscreen Exited',
  };
  const title = titleMap[toast.eventType] || toast.eventType;

  return (
    <>
      <style jsx>{`
        .vt-container {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 9999;
          pointer-events: none;
        }

        .vt-toast {
          pointer-events: auto;
          width: 320px;
          max-width: calc(100vw - 32px);
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 12px;
          border-radius: 8px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
          background: rgba(17, 24, 39, 0.98);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transform: translateX(12px);
          opacity: 0;
          transition: transform ${ANIM_MS}ms ease, opacity ${ANIM_MS}ms ease;
        }

        .vt-toast.vt-visible {
          transform: translateX(0);
          opacity: 1;
        }

        .vt-thumb {
          width: 160px;
          height: 120px;
          border-radius: 6px;
          object-fit: cover;
          background: rgba(255, 255, 255, 0.05);
          flex-shrink: 0;
        }

        .vt-content {
          flex: 1;
          min-width: 0;
        }

        .vt-title {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 4px;
        }

        .vt-meta {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          margin-top: 4px;
        }

        .vt-close {
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.8);
          font-size: 16px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .vt-close:hover {
          color: #fff;
        }
      `}</style>
      <div className="vt-container" role="status" aria-live="polite" aria-atomic="true">
        <div className={`vt-toast ${isVisible ? 'vt-visible' : ''}`}>
          {toast.snapshotUrl && (
            <img src={toast.snapshotUrl} alt="violation snapshot" className="vt-thumb" />
          )}
          <div className="vt-content">
            <div className="vt-title">{title}</div>
            <div className="vt-meta">
              {timeLabel}
              {toast.candidateId && ` • ${toast.candidateId}`}
            </div>
          </div>
          <button
            className="vt-close"
            aria-label="Close"
            onClick={() => {
              setIsVisible(false);
              isToastVisibleRef.current = false;
              setTimeout(() => {
                setToast(null);
                // Check for queued toast after closing
                const queued = queuedToastRef.current;
                if (queued && showToastRef.current) {
                  queuedToastRef.current = null;
                  const timeSinceLastToast = Date.now() - lastToastTimeRef.current;
                  const remainingGap = Math.max(0, TOAST_GAP_MS - timeSinceLastToast);
                  setTimeout(() => {
                    if (showToastRef.current) {
                      showToastRef.current(queued);
                    }
                  }, remainingGap);
                }
              }, ANIM_MS);
              if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
              }
            }}
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
}




