import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import { customMCQApi } from "../../lib/custom-mcq/api";
import { CustomMCQAssessment, MCQQuestion, Candidate } from "../../types/custom-mcq";
import {
  Station1AssessmentInfo,
  Station2UploadCSV,
  Station3ReviewEdit,
  Station4AddCandidates,
  Station5Schedule,
} from "../../components/custom-mcq";

interface CreateCustomMCQPageProps {
  session: any;
}

export default function CreateCustomMCQPage({ session }: CreateCustomMCQPageProps) {
  const router = useRouter();
  const [currentStation, setCurrentStation] = useState(1);
  const [assessmentData, setAssessmentData] = useState<Partial<CustomMCQAssessment>>({
    title: "",
    description: "",
    questions: [],
    candidates: [],
    accessMode: "private",
    examMode: "strict",
    passPercentage: 50,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [createdAssessmentUrl, setCreatedAssessmentUrl] = useState<string | null>(null);
  const [assessmentToken, setAssessmentToken] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef(true);

  const stations = [
    { id: 1, name: "Assessment Information", icon: "📋" },
    { id: 2, name: "Upload CSV", icon: "📤" },
    { id: 3, name: "Review & Edit", icon: "✏️" },
    { id: 4, name: "Add Candidates", icon: "👥" },
    { id: 5, name: "Schedule", icon: "📅" },
  ];

  // Load draft from backend if assessmentId is in URL, otherwise check localStorage
  useEffect(() => {
    const loadDraft = async () => {
      try {
        const { id } = router.query;
        
        if (id && typeof id === "string") {
          // Load existing draft from backend
          try {
            const assessment = await customMCQApi.getAssessment(id);
            setAssessmentId(id);
            setAssessmentData({
              title: assessment.title || "",
              description: assessment.description || "",
              questions: assessment.questions || [],
              candidates: assessment.candidates || [],
              accessMode: assessment.accessMode || "private",
              examMode: assessment.examMode || "strict",
              startTime: assessment.startTime,
              endTime: assessment.endTime,
              duration: assessment.duration,
              passPercentage: assessment.passPercentage || 50,
            });
            
            // Set current station from backend or default to 1
            const station = (assessment as any).currentStation || 1;
            setCurrentStation(station);
            isInitialLoadRef.current = false;
          } catch (err) {
            console.error("Error loading draft from backend:", err);
            // Fallback to localStorage if backend load fails
            const draft = localStorage.getItem("custom_mcq_draft");
            if (draft) {
              const parsed = JSON.parse(draft);
              setAssessmentData(parsed);
              if (parsed.currentStation) {
                setCurrentStation(parsed.currentStation);
              }
            }
          }
        } else {
          // No ID in URL, check localStorage
          const draft = localStorage.getItem("custom_mcq_draft");
          if (draft) {
            const parsed = JSON.parse(draft);
            setAssessmentData(parsed);
            if (parsed.currentStation) {
              setCurrentStation(parsed.currentStation);
            }
          }
        }
      } catch (err) {
        console.error("Error loading draft:", err);
      } finally {
        isInitialLoadRef.current = false;
      }
    };

    if (router.isReady) {
      loadDraft();
    }
  }, [router.isReady, router.query]);

  // Auto-save draft to backend on every change (debounced)
  const saveDraftToBackend = useCallback(async () => {
    // Skip save on initial load
    if (isInitialLoadRef.current) {
      return;
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce: wait 1 second after last change before saving
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSaving(true);
        
        const draftData: any = {
          title: assessmentData.title || "",
          description: assessmentData.description || "",
          questions: assessmentData.questions || [],
          candidates: assessmentData.candidates || [],
          accessMode: assessmentData.accessMode || "private",
          examMode: assessmentData.examMode || "strict",
          startTime: assessmentData.startTime,
          endTime: assessmentData.endTime,
          duration: assessmentData.duration,
          passPercentage: assessmentData.passPercentage || 50,
          status: "draft",
          currentStation: currentStation,
        };

        if (assessmentId) {
          // Update existing draft
          await customMCQApi.updateAssessment(assessmentId, {
            ...draftData,
            status: "draft",
            currentStation: currentStation,
          });
        } else {
          // Create new draft
          const result = await customMCQApi.createAssessment({
            ...draftData,
            status: "draft",
            currentStation: currentStation,
          } as any);
          setAssessmentId(result.assessmentId);
        }
      } catch (err) {
        console.error("Error auto-saving draft:", err);
        // Don't show error to user for auto-save failures
      } finally {
        setIsSaving(false);
      }
    }, 1000); // 1 second debounce
  }, [assessmentData, currentStation, assessmentId]);

  // Auto-save when data changes
  useEffect(() => {
    saveDraftToBackend();
    
    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [saveDraftToBackend]);

  // Save draft before page unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Save synchronously before leaving
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Use sendBeacon for reliable save on page unload
      if (assessmentId || assessmentData.title || (assessmentData.questions && assessmentData.questions.length > 0)) {
        const draftData = {
          title: assessmentData.title || "",
          description: assessmentData.description || "",
          questions: assessmentData.questions || [],
          candidates: assessmentData.candidates || [],
          accessMode: assessmentData.accessMode || "private",
          examMode: assessmentData.examMode || "strict",
          startTime: assessmentData.startTime,
          endTime: assessmentData.endTime,
          duration: assessmentData.duration,
          passPercentage: assessmentData.passPercentage || 50,
          status: "draft",
          currentStation: currentStation,
        };

        // Note: We rely on the debounced auto-save mechanism
        // sendBeacon doesn't support custom headers needed for authentication
        // The debounced save will handle the save before navigation
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [assessmentData, currentStation, assessmentId]);

  const updateAssessmentData = (updates: Partial<CustomMCQAssessment>) => {
    setAssessmentData((prev) => ({ ...prev, ...updates }));
    setError(null);
  };

  const handleNext = () => {
    if (currentStation < 5) {
      setCurrentStation(currentStation + 1);
      setError(null);
    }
  };

  const handlePrevious = () => {
    if (currentStation > 1) {
      setCurrentStation(currentStation - 1);
      setError(null);
    }
  };

  const handleCreateAssessment = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validate required fields
      if (!assessmentData.title?.trim()) {
        setError("Title is required");
        setLoading(false);
        return;
      }

      if (!assessmentData.questions || assessmentData.questions.length === 0) {
        setError("At least one question is required");
        setLoading(false);
        return;
      }

      // Validate schedule based on exam mode
      if (assessmentData.examMode === "strict") {
        if (!assessmentData.startTime || !assessmentData.endTime) {
          setError("Start time and end time are required for strict window mode");
          setLoading(false);
          return;
        }
      } else if (assessmentData.examMode === "flexible") {
        if (!assessmentData.duration) {
          setError("Duration is required for flexible window mode");
          setLoading(false);
          return;
        }
        if (!assessmentData.startTime || !assessmentData.endTime) {
          setError("Start time and end time are required for flexible window mode");
          setLoading(false);
          return;
        }
      }

      // Prepare data for API - change status from draft to scheduled
      const createData: any = {
        title: assessmentData.title!,
        description: assessmentData.description || "",
        questions: assessmentData.questions!,
        candidates: assessmentData.candidates || [],
        accessMode: assessmentData.accessMode || "private",
        examMode: assessmentData.examMode || "strict",
        startTime: assessmentData.startTime,
        endTime: assessmentData.endTime,
        duration: assessmentData.duration,
        passPercentage: assessmentData.passPercentage || 50,
        status: "scheduled", // Change from draft to scheduled
        currentStation: currentStation,
      };

      let result: any;
      if (assessmentId) {
        // Update existing draft to scheduled
        const updateResponse = await customMCQApi.updateAssessment(assessmentId, createData);
        result = await customMCQApi.getAssessment(assessmentId);
        // Get the token and URL from the update response if available
        if (updateResponse && (updateResponse as any).assessmentToken) {
          result.assessmentToken = (updateResponse as any).assessmentToken;
          result.assessmentUrl = (updateResponse as any).assessmentUrl;
        }
      } else {
        // Create new as scheduled
        result = await customMCQApi.createAssessment(createData);
        setAssessmentId(result.assessmentId);
      }

      // Clear localStorage draft
      localStorage.removeItem("custom_mcq_draft");

      // Store the assessment URL for display - always construct full URL
      const token = result.assessmentToken || (result as any).assessmentToken;
      const id = result.assessmentId || assessmentId;
      let assessmentUrl = result.assessmentUrl || `/custom-mcq/entry/${id}?token=${token}`;
      
      // If URL doesn't start with http, prepend the origin
      if (!assessmentUrl.startsWith('http://') && !assessmentUrl.startsWith('https://')) {
        assessmentUrl = `${window.location.origin}${assessmentUrl.startsWith('/') ? '' : '/'}${assessmentUrl}`;
      }
      
      setCreatedAssessmentUrl(assessmentUrl);
      setAssessmentToken(result.assessmentToken || (result as any).assessmentToken);
      setAssessmentId(result.assessmentId || assessmentId);
      
      // Scroll to the URL section
      setTimeout(() => {
        const urlSection = document.getElementById('assessment-url-section');
        if (urlSection) {
          urlSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    } catch (err: any) {
      console.error("Error creating assessment:", err);
      setError(err.message || "Failed to create assessment");
    } finally {
      setLoading(false);
    }
  };

  const canProceedToNext = () => {
    switch (currentStation) {
      case 1:
        return !!(assessmentData.title?.trim());
      case 2:
        return !!(assessmentData.questions && assessmentData.questions.length > 0);
      case 3:
        return !!(assessmentData.questions && assessmentData.questions.length > 0);
      case 4:
        // Always allow proceeding - candidates are optional (public mode doesn't need candidates)
        return true;
      case 5:
        return true; // Can always proceed from schedule to create
      default:
        return false;
    }
  };

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh", padding: "2rem" }}>
      <div className="container" style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 style={{ margin: 0, color: "#1E5A3B" }}>Create Custom MCQ Assessment</h1>
          {isSaving && (
            <span style={{ fontSize: "0.875rem", color: "#2D7A52", fontStyle: "italic" }}>
              💾 Saving draft...
            </span>
          )}
        </div>

        {/* Metro Station Navigation */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "3rem",
            padding: "1.5rem",
            backgroundColor: "#E8FAF0",
            borderRadius: "0.75rem",
            border: "1px solid #A8E8BC",
            position: "relative",
          }}
        >
          {/* Connection Line */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "5%",
              right: "5%",
              height: "3px",
              backgroundColor: currentStation > 1 ? "#2D7A52" : "#A8E8BC",
              zIndex: 0,
            }}
          />

          {stations.map((station, idx) => {
            const isActive = currentStation === station.id;
            const isCompleted = currentStation > station.id;
            const isAccessible = currentStation >= station.id || isCompleted;

            return (
              <div
                key={station.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  position: "relative",
                  zIndex: 1,
                  cursor: isAccessible ? "pointer" : "not-allowed",
                  flex: 1,
                }}
                onClick={() => {
                  if (isAccessible) {
                    setCurrentStation(station.id);
                  }
                }}
              >
                <div
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    backgroundColor: isActive
                      ? "#2D7A52"
                      : isCompleted
                      ? "#10b981"
                      : "#A8E8BC",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.5rem",
                    color: "#ffffff",
                    marginBottom: "0.5rem",
                    border: "3px solid #ffffff",
                    boxShadow: isActive ? "0 0 0 3px #C9F4D4" : "none",
                    transition: "all 0.3s ease",
                  }}
                >
                  {isCompleted && !isActive ? "✓" : station.icon}
                </div>
                <div
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#1E5A3B" : isCompleted ? "#2D7A52" : "#4A9A6A",
                    textAlign: "center",
                  }}
                >
                  {station.name}
                </div>
                {isActive && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#2D7A52",
                      marginTop: "0.25rem",
                      fontWeight: 500,
                    }}
                  >
                    Current
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error Message */}
        {error && (
          <div
            style={{
              padding: "1rem",
              backgroundColor: "#fee2e2",
              border: "1px solid #ef4444",
              borderRadius: "0.5rem",
              color: "#991b1b",
              marginBottom: "1.5rem",
            }}
          >
            {error}
          </div>
        )}

        {/* Station Content */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #A8E8BC",
            borderRadius: "0.75rem",
            padding: "2rem",
            marginBottom: "2rem",
            minHeight: "400px",
          }}
        >
          {currentStation === 1 && (
            <Station1AssessmentInfo
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 2 && (
            <Station2UploadCSV
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 3 && (
            <Station3ReviewEdit
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 4 && (
            <Station4AddCandidates
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
            />
          )}
          {currentStation === 5 && (
            <Station5Schedule
              assessmentData={assessmentData}
              updateAssessmentData={updateAssessmentData}
              onCreateAssessment={handleCreateAssessment}
              loading={loading}
              createdAssessmentUrl={createdAssessmentUrl}
              assessmentId={assessmentId}
              router={router}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentStation === 1}
            className="btn-secondary"
            style={{
              padding: "0.75rem 1.5rem",
              opacity: currentStation === 1 ? 0.5 : 1,
              cursor: currentStation === 1 ? "not-allowed" : "pointer",
            }}
          >
            ← Previous
          </button>

          {/* Back to Dashboard Button - Always Visible */}
          <button
            type="button"
            onClick={async () => {
              // Save draft before navigating away
              if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
              }
              try {
                const draftData: any = {
                  title: assessmentData.title || "",
                  description: assessmentData.description || "",
                  questions: assessmentData.questions || [],
                  candidates: assessmentData.candidates || [],
                  accessMode: assessmentData.accessMode || "private",
                  examMode: assessmentData.examMode || "strict",
                  startTime: assessmentData.startTime,
                  endTime: assessmentData.endTime,
                  duration: assessmentData.duration,
                  passPercentage: assessmentData.passPercentage || 50,
                  status: "draft",
                  currentStation: currentStation,
                };

                if (assessmentId) {
                  await customMCQApi.updateAssessment(assessmentId, draftData);
                } else if (assessmentData.title || (assessmentData.questions && assessmentData.questions.length > 0)) {
                  const result = await customMCQApi.createAssessment(draftData);
                  setAssessmentId(result.assessmentId);
                }
              } catch (err) {
                console.error("Error saving draft before navigation:", err);
              }
              router.push("/dashboard");
            }}
            className="btn-secondary"
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#ffffff",
              color: "#2D7A52",
              border: "1px solid #A8E8BC",
            }}
          >
            ← Back to Dashboard
          </button>

          {currentStation < 5 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={!canProceedToNext()}
              className="btn-primary"
              style={{
                padding: "0.75rem 1.5rem",
                opacity: canProceedToNext() ? 1 : 0.5,
                cursor: canProceedToNext() ? "pointer" : "not-allowed",
              }}
            >
              Next →
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;

