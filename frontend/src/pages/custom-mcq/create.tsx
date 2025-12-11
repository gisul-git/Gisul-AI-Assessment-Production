import { useState, useEffect } from "react";
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

  const stations = [
    { id: 1, name: "Assessment Information", icon: "📋" },
    { id: 2, name: "Upload CSV", icon: "📤" },
    { id: 3, name: "Review & Edit", icon: "✏️" },
    { id: 4, name: "Add Candidates", icon: "👥" },
    { id: 5, name: "Schedule", icon: "📅" },
  ];

  // Load draft from localStorage if exists
  useEffect(() => {
    try {
      const draft = localStorage.getItem("custom_mcq_draft");
      if (draft) {
        const parsed = JSON.parse(draft);
        setAssessmentData(parsed);
        if (parsed.currentStation) {
          setCurrentStation(parsed.currentStation);
        }
      }
    } catch (err) {
      console.error("Error loading draft:", err);
    }
  }, []);

  // Save draft to localStorage
  useEffect(() => {
    try {
      const draft = {
        ...assessmentData,
        currentStation,
      };
      localStorage.setItem("custom_mcq_draft", JSON.stringify(draft));
    } catch (err) {
      console.error("Error saving draft:", err);
    }
  }, [assessmentData, currentStation]);

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

      // Prepare data for API
      const createData: CustomMCQAssessment = {
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
      };

      let result: any;
      if (assessmentId) {
        // Update existing
        await customMCQApi.updateAssessment(assessmentId, createData);
        result = await customMCQApi.getAssessment(assessmentId);
      } else {
        // Create new
        result = await customMCQApi.createAssessment(createData);
        setAssessmentId(result.assessmentId);
      }

      // Clear draft
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
        <h1 style={{ marginBottom: "2rem", color: "#1E5A3B" }}>Create Custom MCQ Assessment</h1>

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
              router={router}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
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

