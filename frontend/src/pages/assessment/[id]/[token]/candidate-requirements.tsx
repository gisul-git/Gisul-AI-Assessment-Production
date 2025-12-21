import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import { getGateContext } from "@/lib/gateContext";
 
/**
 * Default candidate requirements when assessment data is not available
 * For custom MCQ, defaults are all false - only show what admin checked
 */
const DEFAULT_REQUIREMENTS = {
  requireEmail: false,
  requireName: false,
  requirePhone: false,
  requireResume: false,
  requireLinkedIn: false,
  requireGithub: false,
};
 
export default function CandidateRequirementsPage() {
  const router = useRouter();
  const { id, token } = router.query;
 
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [linkedInUrl, setLinkedInUrl] = useState<string>("");
  const [githubUrl, setGithubUrl] = useState<string>("");
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
    requireLinkedIn?: boolean;
    requireGithub?: boolean;
  }>(DEFAULT_REQUIREMENTS);
 
  useEffect(() => {
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
   
    // Don't auto-fill - let user enter manually
    // if (storedEmail) setEmail(storedEmail);
    // if (storedName) setName(storedName);
   
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
    const isCustomMCQFlow = ctx?.flowType === "custom-mcq";

    // For custom-mcq flow, fetch requirements from custom MCQ assessment
    if (isCustomMCQFlow && id && token) {
      const fetchCustomMCQAssessment = async () => {
        try {
          setFetchingAssessment(true);
          setError(null);

          // Fetch custom MCQ assessment
          const response = await axios.get(
            `/api/custom-mcq/take/${id}`,
            {
              params: { token }
            }
          );

          const data = response.data;
          console.log("Custom MCQ API response:", data);
          
          // Handle different response structures
          const assessment = data?.data || data?.assessment || data;

          if (!assessment || typeof assessment !== "object") {
            console.warn("No custom MCQ assessment found, using default requirements");
            setAssessmentInfo(null);
            setCandidateRequirements(DEFAULT_REQUIREMENTS);
            setFetchingAssessment(false);
            return;
          }

          setAssessmentInfo(assessment);

          // Get candidate requirements from schedule
          const schedule = assessment?.schedule || {};
          console.log("Schedule from assessment:", schedule);
          
          const candidateReqs = schedule?.candidateRequirements || {};
          console.log("Candidate requirements from schedule:", candidateReqs);

          const normalizedRequirements = {
            requireEmail: candidateReqs?.requireEmail === true,
            requireName: candidateReqs?.requireName === true,
            requirePhone: candidateReqs?.requirePhone === true,
            requireResume: candidateReqs?.requireResume === true,
            requireLinkedIn: candidateReqs?.requireLinkedIn === true,
            requireGithub: candidateReqs?.requireGithub === true,
          };

          console.log("Normalized candidate requirements for custom MCQ:", normalizedRequirements);
          setCandidateRequirements(normalizedRequirements);

          const hasAnyRequirement =
            normalizedRequirements.requireEmail ||
            normalizedRequirements.requireName ||
            normalizedRequirements.requirePhone ||
            normalizedRequirements.requireResume ||
            normalizedRequirements.requireLinkedIn ||
            normalizedRequirements.requireGithub;

          // If no requirements are enabled, skip this page
          if (!hasAnyRequirement && id && token) {
            console.log("No candidate requirements enabled for custom MCQ, skipping to identity verification");
            sessionStorage.setItem(`candidateRequirementsCompleted_${id}`, "true");
            router.push(`/assessment/${id}/${token}/identity-verify`);
          }

          setError(null);
        } catch (error: any) {
          console.error("Error fetching custom MCQ assessment:", {
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

      fetchCustomMCQAssessment();
      return;
    }

    // Non-AI flows (other than custom-mcq): skip AI-only backend calls entirely and proceed
    if (!isAIFlow && !isCustomMCQFlow && id && token) {
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
          requireLinkedIn: candidateReqs?.requireLinkedIn ?? DEFAULT_REQUIREMENTS.requireLinkedIn,
          requireGithub: candidateReqs?.requireGithub ?? DEFAULT_REQUIREMENTS.requireGithub,
        };
 
        console.log("Normalized candidate requirements:", normalizedRequirements);
        setCandidateRequirements(normalizedRequirements);
 
        const hasAnyRequirement =
          normalizedRequirements.requireEmail ||
          normalizedRequirements.requireName ||
          normalizedRequirements.requirePhone ||
          normalizedRequirements.requireResume ||
          normalizedRequirements.requireLinkedIn ||
          normalizedRequirements.requireGithub;
 
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
    
    // Disable button immediately to prevent double-clicks
    if (loading) return;
    setLoading(true);
    setError(null);
    
    // Determine flow type
    const ctx = getGateContext(id as string);
    const isAIFlow = !ctx || ctx.flowType === "ai";
   
    // Validate only required fields
    if (candidateRequirements.requireEmail && !email.trim()) {
      setError("Email is required");
      setLoading(false);
      return;
    }
    
    if (candidateRequirements.requireName && !name.trim()) {
      setError("Full Name is required");
      setLoading(false);
      return;
    }
    
    if (candidateRequirements.requirePhone && !phone.trim()) {
      setError("Phone Number is required");
      setLoading(false);
      return;
    }
    
    if (candidateRequirements.requireResume && !resumeFile) {
      setError("Resume upload is required");
      setLoading(false);
      return;
    }
    
    if (candidateRequirements.requireLinkedIn && !linkedInUrl.trim()) {
      setError("LinkedIn URL is required");
      setLoading(false);
      return;
    }
    
    if (candidateRequirements.requireGithub && !githubUrl.trim()) {
      setError("GitHub URL is required");
      setLoading(false);
      return;
    }
    
    // Validate email format if email is required
    if (candidateRequirements.requireEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setError("Please enter a valid email address");
        setLoading(false);
        return;
      }
    }
    
    // Validate LinkedIn URL format if required
    if (candidateRequirements.requireLinkedIn && linkedInUrl.trim()) {
      const linkedInRegex = /^https?:\/\/(www\.)?linkedin\.com\/.+/i;
      if (!linkedInRegex.test(linkedInUrl.trim())) {
        setError("Please enter a valid LinkedIn URL (e.g., https://www.linkedin.com/in/yourprofile)");
        setLoading(false);
        return;
      }
    }
    
    // Validate GitHub URL format if required
    if (candidateRequirements.requireGithub && githubUrl.trim()) {
      const githubRegex = /^https?:\/\/(www\.)?github\.com\/.+/i;
      if (!githubRegex.test(githubUrl.trim())) {
        setError("Please enter a valid GitHub URL (e.g., https://github.com/yourusername)");
        setLoading(false);
        return;
      }
    }
   
    try {
      // Update sessionStorage with candidate info
      // For email/name: if required, use form value; if not required, preserve existing from sessionStorage
      const existingEmail = sessionStorage.getItem("candidateEmail") || "";
      const existingName = sessionStorage.getItem("candidateName") || "";
      
      if (candidateRequirements.requireEmail && email.trim()) {
        sessionStorage.setItem("candidateEmail", email.trim());
      } else if (!candidateRequirements.requireEmail && existingEmail) {
        // Preserve existing email if not required
        sessionStorage.setItem("candidateEmail", existingEmail);
      }
      
      if (candidateRequirements.requireName && name.trim()) {
        sessionStorage.setItem("candidateName", name.trim());
      } else if (!candidateRequirements.requireName && existingName) {
        // Preserve existing name if not required
        sessionStorage.setItem("candidateName", existingName);
      }
      
      if (phone.trim()) {
        sessionStorage.setItem("candidatePhone", phone.trim());
      }
      if (linkedInUrl.trim()) {
        sessionStorage.setItem("candidateLinkedIn", linkedInUrl.trim());
      }
      if (githubUrl.trim()) {
        sessionStorage.setItem("candidateGithub", githubUrl.trim());
      }
     
      // Get final email/name values (from form if required, or from sessionStorage if preserved)
      const finalEmail = (candidateRequirements.requireEmail && email.trim()) 
        ? email.trim() 
        : (sessionStorage.getItem("candidateEmail") || "");
      const finalName = (candidateRequirements.requireName && name.trim()) 
        ? name.trim() 
        : (sessionStorage.getItem("candidateName") || "");
     
      // Upload resume if provided
      if (resumeFile) {
        const formData = new FormData();
        formData.append("resume", resumeFile);
        formData.append("assessmentId", id as string);
        formData.append("token", token as string);
        formData.append("email", finalEmail);
        formData.append("name", finalName);
       
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
     
      // Save candidate requirements to backend (only for AI flow, not custom MCQ)
      // For custom MCQ, data is stored in sessionStorage and sent with assessment submission
      if (isAIFlow) {
        try {
          await axios.post("/api/assessment/save-candidate-info", {
            assessmentId: id,
            token,
            email: finalEmail,
            name: finalName,
            phone: phone.trim() || null,
            hasResume: !!resumeFile,
          });
        } catch (saveError: any) {
          console.warn("Failed to save candidate info (non-blocking):", saveError);
        }
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
        padding: "1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
          border: "1px solid #e5e7eb",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
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
      padding: "1.5rem",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
      <div style={{ maxWidth: "500px", width: "100%" }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
          border: "1px solid #e5e7eb"
        }}>
          {/* Header */}
          <div style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.25rem" }}>
              Candidate Requirements
            </h1>
            <p style={{ color: "#64748b", fontSize: "0.875rem", margin: 0 }}>
              Please provide the following information to proceed
            </p>
          </div>
         
          {/* Assessment fetch error (non-blocking) */}
          {error && (
            <div style={{
              padding: "0.625rem 0.75rem",
              backgroundColor: "#fef3c7",
              border: "1px solid #fde68a",
              borderRadius: "0.375rem",
              color: "#92400e",
              marginBottom: "1rem",
              fontSize: "0.8125rem"
            }}>
              ⚠️ {error}
            </div>
          )}
          
          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gap: "1rem", marginBottom: "1.25rem" }}>
              {/* Email - Only show if required */}
              {candidateRequirements.requireEmail && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontWeight: 500,
                    color: "#374151",
                    fontSize: "0.875rem"
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
                      padding: "0.625rem 0.75rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.375rem",
                      fontSize: "0.875rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                      boxSizing: "border-box"
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                  />
                </div>
              )}
             
              {/* Name - Only show if required */}
              {candidateRequirements.requireName && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontWeight: 500,
                    color: "#374151",
                    fontSize: "0.875rem"
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
                      padding: "0.625rem 0.75rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.375rem",
                      fontSize: "0.875rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                      boxSizing: "border-box"
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                  />
                </div>
              )}
             
              {/* Phone - Only show if required */}
              {candidateRequirements.requirePhone && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontWeight: 500,
                    color: "#374151",
                    fontSize: "0.875rem"
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
                      padding: "0.625rem 0.75rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.375rem",
                      fontSize: "0.875rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                      boxSizing: "border-box"
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                  />
                </div>
              )}
              
              {/* LinkedIn URL - Only show if required */}
              {candidateRequirements.requireLinkedIn && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontWeight: 500,
                    color: "#374151",
                    fontSize: "0.875rem"
                  }}>
                    LinkedIn URL <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="url"
                    value={linkedInUrl}
                    onChange={(e) => setLinkedInUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/in/yourprofile"
                    required
                    style={{
                      width: "100%",
                      padding: "0.625rem 0.75rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.375rem",
                      fontSize: "0.875rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                      boxSizing: "border-box"
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                  />
                </div>
              )}
              
              {/* GitHub URL - Only show if required */}
              {candidateRequirements.requireGithub && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontWeight: 500,
                    color: "#374151",
                    fontSize: "0.875rem"
                  }}>
                    GitHub URL <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/yourusername"
                    required
                    style={{
                      width: "100%",
                      padding: "0.625rem 0.75rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "0.375rem",
                      fontSize: "0.875rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                      boxSizing: "border-box"
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#6953a3"}
                    onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                  />
                </div>
              )}
             
              {/* Resume Upload - Only show if required */}
              {candidateRequirements.requireResume && (
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontWeight: 500,
                    color: "#374151",
                    fontSize: "0.875rem"
                  }}>
                    Resume <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                <div style={{
                  border: "2px dashed #d1d5db",
                  borderRadius: "0.375rem",
                  padding: "1rem",
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
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "#d1d5db";
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
                        <div style={{ marginBottom: "0.25rem", fontSize: "0.875rem" }}>✓ {resumeFileName}</div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          Click to change file
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ marginBottom: "0.375rem", fontSize: "1.25rem" }}>📄</div>
                        <div style={{ fontSize: "0.875rem" }}>Click to upload or drag and drop</div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
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
                padding: "0.625rem 0.75rem",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "0.375rem",
                color: "#991b1b",
                marginBottom: "1rem",
                fontSize: "0.8125rem"
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
                (candidateRequirements.requireResume && !resumeFile) ||
                (candidateRequirements.requireLinkedIn && !linkedInUrl.trim()) ||
                (candidateRequirements.requireGithub && !githubUrl.trim())}
              style={{
                width: "100%",
                padding: "0.75rem 1.5rem",
                backgroundColor: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile) ||
                  (candidateRequirements.requireLinkedIn && !linkedInUrl.trim()) ||
                  (candidateRequirements.requireGithub && !githubUrl.trim())) ? "#e2e8f0" : "#6953a3",
                color: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile) ||
                  (candidateRequirements.requireLinkedIn && !linkedInUrl.trim()) ||
                  (candidateRequirements.requireGithub && !githubUrl.trim())) ? "#94a3b8" : "#ffffff",
                border: "none",
                borderRadius: "0.375rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile) ||
                  (candidateRequirements.requireLinkedIn && !linkedInUrl.trim()) ||
                  (candidateRequirements.requireGithub && !githubUrl.trim())) ? "not-allowed" : "pointer",
                boxShadow: (loading ||
                  (candidateRequirements.requireEmail && !email.trim()) ||
                  (candidateRequirements.requireName && !name.trim()) ||
                  (candidateRequirements.requirePhone && !phone.trim()) ||
                  (candidateRequirements.requireResume && !resumeFile) ||
                  (candidateRequirements.requireLinkedIn && !linkedInUrl.trim()) ||
                  (candidateRequirements.requireGithub && !githubUrl.trim())) ? "none" : "0 2px 4px rgba(105, 83, 163, 0.2)",
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
 