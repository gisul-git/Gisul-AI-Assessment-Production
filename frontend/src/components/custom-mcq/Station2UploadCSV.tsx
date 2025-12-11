import { useState, useRef } from "react";
import { CustomMCQAssessment, MCQQuestion } from "../../types/custom-mcq";
import { customMCQApi } from "../../lib/custom-mcq/api";

interface Station2Props {
  assessmentData: Partial<CustomMCQAssessment>;
  updateAssessmentData: (updates: Partial<CustomMCQAssessment>) => void;
}

export default function Station2UploadCSV({ assessmentData, updateAssessmentData }: Station2Props) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadSample = async () => {
    try {
      const blob = await customMCQApi.downloadSampleCSV();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sample_mcq.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Failed to download sample CSV");
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      setUploading(true);
      setError(null);
      setSuccess(null);

      const result = await customMCQApi.uploadCSV(file);
      
      updateAssessmentData({ questions: result.questions });
      setSuccess(`Successfully uploaded! Found ${result.totalQuestions} valid questions.`);
      setUploadedFile(file);
    } catch (err: any) {
      setError(err.message || "Failed to upload CSV");
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleValidate = async () => {
    if (!assessmentData.questions || assessmentData.questions.length === 0) {
      setError("Please upload a CSV file first");
      return;
    }

    // Validation is already done during upload, but we can show success
    setSuccess(`CSV validated! ${assessmentData.questions.length} questions are ready.`);
  };

  return (
    <div>
      <h2 style={{ marginBottom: "1.5rem", color: "#1E5A3B" }}>📤 Upload CSV</h2>
      <p style={{ marginBottom: "2rem", color: "#2D7A52" }}>
        Upload your questions in CSV format. Download the sample file to see the expected format.
      </p>

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

      {success && (
        <div
          style={{
            padding: "1rem",
            backgroundColor: "#dcfce7",
            border: "1px solid #10b981",
            borderRadius: "0.5rem",
            color: "#166534",
            marginBottom: "1.5rem",
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* Download Sample */}
        <div
          style={{
            padding: "1.5rem",
            border: "2px dashed #A8E8BC",
            borderRadius: "0.5rem",
            backgroundColor: "#E8FAF0",
          }}
        >
          <h3 style={{ marginBottom: "0.5rem", color: "#1E5A3B" }}>Sample CSV File</h3>
          <p style={{ marginBottom: "1rem", color: "#2D7A52", fontSize: "0.875rem" }}>
            Download the sample CSV file to see the expected format with columns: section, question, optionA, optionB, optionC, optionD, correctAn, answerType, marks
          </p>
          <button
            type="button"
            onClick={handleDownloadSample}
            className="btn-secondary"
            style={{ width: "fit-content" }}
          >
            📥 Download Sample CSV
          </button>
        </div>

        {/* Upload CSV */}
        <div
          style={{
            padding: "1.5rem",
            border: "2px dashed #A8E8BC",
            borderRadius: "0.5rem",
            backgroundColor: "#ffffff",
          }}
        >
          <h3 style={{ marginBottom: "0.5rem", color: "#1E5A3B" }}>Upload Your CSV File</h3>
          <p style={{ marginBottom: "1rem", color: "#2D7A52", fontSize: "0.875rem" }}>
            Select a CSV file containing your questions. The file will be validated automatically.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-primary"
            style={{ width: "fit-content" }}
          >
            {uploading ? "Uploading..." : "📤 Upload CSV File"}
          </button>
          {uploadedFile && (
            <p style={{ marginTop: "0.5rem", color: "#2D7A52", fontSize: "0.875rem" }}>
              Uploaded: {uploadedFile.name}
            </p>
          )}
        </div>

        {/* Validate CSV */}
        <div>
          <button
            type="button"
            onClick={handleValidate}
            disabled={validating || !assessmentData.questions || assessmentData.questions.length === 0}
            className="btn-primary"
            style={{
              width: "100%",
              opacity: assessmentData.questions && assessmentData.questions.length > 0 ? 1 : 0.5,
              cursor: assessmentData.questions && assessmentData.questions.length > 0 ? "pointer" : "not-allowed",
            }}
          >
            {validating ? "Validating..." : "✓ Validate CSV File"}
          </button>
          {assessmentData.questions && assessmentData.questions.length > 0 && (
            <p style={{ marginTop: "0.5rem", color: "#2D7A52", fontSize: "0.875rem", textAlign: "center" }}>
              {assessmentData.questions.length} questions loaded and validated
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

