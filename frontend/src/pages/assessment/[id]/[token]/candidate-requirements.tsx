import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import { getGateContext } from "@/lib/gateContext";
 
/**
 * Default candidate requirements when assessment data is not available
 */
const DEFAULT_REQUIREMENTS = {
  requireEmail: true,
  requireName: true,
  requirePhone: false,
  requireResume: false,
};
 
export default function CandidateRequirementsPage() {
  const router = useRouter();
  const { id, token } = router.query;
 
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingAssessment, setFetchingAssessment] = useState(true);
  const [assessmentInfo, setAssessmentInfo] = useState<any>(null);
  const [candidateRequirements, setCandidateRequirements] = useState<{
    requireEmail: boolean;
    requireName: boolean;
    requirePhone: boolean;
    requireResume: boolean;
  }>(DEFAULT_REQUIREMENTS);
 
  useEffect(() => {
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
   
    // Auto-fill from sessionStorage
    if (storedEmail) setEmail(storedEmail);
    if (storedName) setName(storedName);
   
    if (!storedEmail || !storedName) {
      if (id && token) {
        const ctx = getGateContext(id as string);
        router.replace(ctx?.entryUrl || `/assessment/${id}/${token}`);
      }
      return;
    }
   
    // Check precheck completion
    const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${id}`);
    if (!precheckCompleted && id && token) {
      router.replace(`/precheck/${id}/${token}`);
      return;
    }
   
    // Check instructions acknowledgment
    const instructionsAcknowledged = sessionStorage.getItem(`instructionsAcknowledged_${id}`);
    if (!instructionsAcknowledged && id && token) {
      router.replace(`/assessment/${id}/${token}/instructions-new`);
      return;
    }
   
    const ctx = getGateContext(id as string);
    const isAIFlow = !ctx || ctx.flowType === "ai";

    // Non-AI flows: skip AI-only backend calls entirely and proceed
    if (!isAIFlow && id && token) {
      sessionStorage.setItem(`candidateRequirementsCompleted_${id}`, "true");
      router.replace(`/assessment/${id}/${token}/identity-verify`);
      setFetchingAssessment(false);
      return;
    }

    // AI: Fetch assessment info to get candidate requirements settings
    const fetchAssessment = async () => {
      if (!id || !token) {
        setFetchingAssessment(false);
        return;
      }
 
      try {
        setFetchingAssessment(true);
        setError(null);
 
        const response = await axios.get(
          `/api/assessment/get-assessment-full?assessmentId=${id}&token=${token}`
        );
 
        const data = response.data;
        console.log("get-assessment-full raw response:", data);
 
        // 🔑 Normalize all possible response formats
        const assessment =
          data?.data ||          // { success, data: {...} }
          data?.assessment ||    // { assessment: {...} }
          data?.message ||       // 🔥 Your case: { success, message: {...}, data: null }
          data;                  // Fallback to data itself
 
        // If we still don't have a usable object, fallback to defaults
        if (!assessment || typeof assessment !== "object") {
          console.warn("No assessment found in response, using default requirements");
          setAssessmentInfo(null);
          setCandidateRequirements(DEFAULT_REQUIREMENTS);
          setFetchingAssessment(false);
          return;
        }
 
        // We now have the assessment object
        setAssessmentInfo(assessment);
 
        // 🔧 FIX: Use optional chaining throughout and provide defaults
        const schedule = assessment?.schedule;
        const candidateReqs = schedule?.candidateRequirements;
 
        // 🔧 FIX: If candidateRequirements doesn't exist, use defaults
        const normalizedRequirements = {
          requireEmail: candidateReqs?.requireEmail ?? DEFAULT_REQUIREMENTS.requireEmail,
          requireName: candidateReqs?.requireName ?? DEFAULT_REQUIREMENTS.requireName,
          requirePhone: candidateReqs?.requirePhone ?? DEFAULT_REQUIREMENTS.requirePhone,
          requireResume: candidateReqs?.requireResume ?? DEFAULT_REQUIREMENTS.requireResume,
        };
 
        console.log("Normalized candidate requirements:", normalizedRequirements);
        setCandidateRequirements(normalizedRequirements);
 
        const hasAnyRequirement =
          normalizedRequirements.requireEmail ||
          normalizedRequirements.requireName ||
          normalizedRequirements.requirePhone ||
          normalizedRequirements.requireResume;
 
        // If no requirements are enabled, skip this page
        if (!hasAnyRequirement && id && token) {
          console.log("No candidate requirements enabled, skipping to identity verification");
          router.push(`/assessment/${id}/${token}/identity-verify`);
        }
       
        // Clear any previous errors since we successfully loaded the assessment
        setError(null);
      } catch (error: any) {
        console.error("Error fetching assessment:", {
          message: error?.message,
          response: error?.response?.data,
          status: error?.response?.status,
        });
 
        setError("Failed to load assessment settings. Using default requirements.");
        setCandidateRequirements(DEFAULT_REQUIREMENTS);
      } finally {
        setFetchingAssessment(false);
      }
    };
   
    if (id && token) {
      fetchAssessment();
    }
  }, [id, token, router]);
 
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type (PDF, DOC, DOCX)
      const allowedTypes = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
      if (!allowedTypes.includes(file.type)) {
        setError("Please upload a PDF, DOC, or DOCX file");
        return;
      }
     
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
     
      setResumeFile(file);
      setResumeFileName(file.name);
      setError(null);
    }
  };
 
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
   
    // Validate only required fields
    if (candidateRequirements.requireEmail && !email.trim()) {
      setError("Email is required");
      return;
    }
   
    if (candidateRequirements.requireName && !name.trim()) {
      setError("Full Name is required");
      return;
    }
   
    if (candidateRequirements.requirePhone && !phone.trim()) {
      setError("Phone Number is required");
      return;
    }
   
    if (candidateRequirements.requireResume && !resumeFile) {
      setError("Resume upload is required");
      return;
    }
   
    // Validate email format if email is required
    if (candidateRequirements.requireEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setError("Please enter a valid email address");
        return;
      }
    }
   
    setLoading(true);
   
    try {
      // Update sessionStorage with candidate info
      sessionStorage.setItem("candidateEmail", email.trim());
      sessionStorage.setItem("candidateName", name.trim());
      if (phone.trim()) {
        sessionStorage.setItem("candidatePhone", phone.trim());
      }
     
      // Upload resume if provided
      if (resumeFile) {
        const formData = new FormData();
        formData.append("resume", resumeFile);
        formData.append("assessmentId", id as string);
        formData.append("token", token as string);
        formData.append("email", email.trim());
        formData.append("name", name.trim());
       
        try {
          await axios.post("/api/assessment/upload-resume", formData, {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          });
        } catch (uploadError: any) {
          console.warn("Resume upload failed (non-blocking):", uploadError);
          // Don't block submission if resume upload fails
        }
      }
     
      // Save candidate requirements to backend
      try {
        await axios.post("/api/assessment/save-candidate-info", {
          assessmentId: id,
          token,
          email: email.trim(),
          name: name.trim(),
          phone: phone.trim() || null,
          hasResume: !!resumeFile,
        });
      } catch (saveError: any) {
        console.warn("Failed to save candidate info (non-blocking):", saveError);
      }
     
      // Mark this step as completed
      sessionStorage.setItem(`candidateRequirementsCompleted_${id}`, "true");
     
      // Route to identity verification
      router.push(`/assessment/${id}/${token}/identity-verify`);
    } catch (err: any) {
      console.error("Error submitting candidate requirements:", err);
      setError(err.response?.data?.message || "Failed to submit information. Please try again.");
    } finally {
      setLoading(false);
    }
  };
 
  // Show loading state while fetching assessment
  if (fetchingAssessment) {
    return (
      <div style={{
        minHeight: "100vh",
        backgroundColor: "#f7f3e8",
        padding: "2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          padding: "2rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "1.125rem", color: "#64748b" }}>
            Loading assessment requirements...
          </div>
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
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          padding: "2rem",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
        }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>
              Candidate Requirements
            </h1>
            <p style={{ color: "#64748b", fontSize: "1rem" }}>
              Please provide the following information to proceed
            </p>
          </div>
         
          {/* Assessment fetch error (non-blocking) */}
          {error && (
            <div style={{
              padding: "0.75rem",
              backgroundColor: "#fef3c7",
              border: "1px solid #fde68a",
              borderRadius: "0.5rem",
              color: "#92400e",
              marginBottom: "1rem",
              fontSize: "0.875rem"
            }}>
              ⚠️ {error}
            </div>
          )}
         
          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gap: "1.5rem", marginBottom: "2rem" }}>
              {/* Email - Only show if required */}
              {candidateRequirements.requireEmail && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: 600,
                    color: "#1e293b",
                    fontSize: "0.95rem"
                  }}>
                    Email <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                  />
                </div>
              )}
             
              {/* Name - Only show if required */}
              {candidateRequirements.requireName && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: 600,
                    color: "#1e293b",
                    fontSize: "0.95rem"
                  }}>
                    Full Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                  />
                </div>
              )}
             
              {/* Phone - Only show if required */}
              {candidateRequirements.requirePhone && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: 600,
                    color: "#1e293b",
                    fontSize: "0.95rem"
                  }}>
                    Phone Number <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#e5e7eb"}
                  />
                </div>
              )}
             
              {/* Resume Upload - Only show if required */}
              {candidateRequirements.requireResume && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: 600,
                    color: "#1e293b",
                    fontSize: "0.95rem"
                  }}>
                    Resume <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                <div style={{
                  border: "2px dashed #e5e7eb",
                  borderRadius: "0.5rem",
                  padding: "1.5rem",
                  textAlign: "center",
                  backgroundColor: "#f9fafb",
                  transition: "border-color 0.2s",
                  cursor: "pointer",
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "#6953a3";
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "#e5e7eb";
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    const allowedTypes = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
                    if (allowedTypes.includes(file.type) && file.size <= 5 * 1024 * 1024) {
                      setResumeFile(file);
                      setResumeFileName(file.name);
                      setError(null);
                    } else {
                      setError("Please upload a PDF, DOC, or DOCX file (max 5MB)");
                    }
                  }
                }}
                >
                  <input
                    type="file"
                    id="resume-upload"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                  <label
                    htmlFor="resume-upload"
                    style={{
                      cursor: "pointer",
                      display: "block",
                      color: "#6953a3",
                      fontWeight: 600,
                    }}
                  >
                    {resumeFileName ? (
                      <div>
                        <div style={{ marginBottom: "0.5rem" }}>✓ {resumeFileName}</div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                          Click to change file
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ marginBottom: "0.5rem", fontSize: "1.5rem" }}>📄</div>
                        <div>Click to upload or drag and drop</div>
                        <div style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.25rem" }}>
                          PDF, DOC, or DOCX (max 5MB)
                        </div>
                      </div>
                    )}
                  </label>
                </div>
                </div>
              )}
            </div>
           
            {/* Error Message */}
            {error && (
              <div style={{
                padding: "0.75rem",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "0.5rem",
                color: "#991b1b",
                marginBottom: "1rem",
                fontSize: "0.875rem"
              }}>
                {error}
              </div>
            )}
           
            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading ||
                (candidateRequirements.requireEmail && !email.trim()) ||
                (candidateRequirements.requireName && !name.trim()) ||
                (candidateRequirements.requirePhone && !phone.trim()) ||
                (candidateRequirements.requireResume && !resumeFile)}
              style={{
                width: "100%",
                padding: "1rem 2rem",
                backgroundColor: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile)) ? "#e2e8f0" : "#6953a3",
                color: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile)) ? "#94a3b8" : "#ffffff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "1.125rem",
                fontWeight: 600,
                cursor: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile)) ? "not-allowed" : "pointer",
                boxShadow: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile)) ? "none" : "0 4px 6px -1px rgba(105, 83, 163, 0.3)",
                transition: "all 0.2s ease"
              }}
            >
              {loading ? "Submitting..." : "Continue to Assessment →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
 