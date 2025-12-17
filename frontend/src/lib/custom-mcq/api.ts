import fastApiClient from "../fastapi";
import { CustomMCQAssessment, MCQQuestion, Candidate } from "../../types/custom-mcq";

const BASE_URL = "/api/v1/custom-mcq";

export const customMCQApi = {
  // Download sample CSV
  downloadSampleCSV: async (): Promise<Blob> => {
    const response = await fastApiClient.get(`${BASE_URL}/sample-csv`, {
      responseType: "blob",
    });
    return response.data;
  },

  // Upload CSV
  uploadCSV: async (file: File): Promise<{ questions: MCQQuestion[]; totalQuestions: number }> => {
    const formData = new FormData();
    formData.append("file", file);
    
    const response = await fastApiClient.post(`${BASE_URL}/upload-csv`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to upload CSV");
  },

  // Validate CSV data
  validateCSV: async (csvData: Record<string, any>[]): Promise<{ questions: MCQQuestion[]; totalQuestions: number }> => {
    const response = await fastApiClient.post(`${BASE_URL}/validate-csv`, {
      csvData,
    });
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to validate CSV");
  },

  // Create assessment
  createAssessment: async (assessment: CustomMCQAssessment & { status?: string; currentStation?: number }): Promise<{
    assessmentId: string;
    assessmentToken?: string;
    assessmentUrl?: string;
    totalQuestions: number;
    totalMarks: number;
    status?: string;
    currentStation?: number;
  }> => {
    const response = await fastApiClient.post(`${BASE_URL}/create`, assessment);
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to create assessment");
  },

  // Get assessment
  getAssessment: async (assessmentId: string): Promise<CustomMCQAssessment> => {
    const response = await fastApiClient.get(`${BASE_URL}/${assessmentId}`);
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to get assessment");
  },

  // Update assessment
  updateAssessment: async (assessmentId: string, updates: Partial<CustomMCQAssessment> & { status?: string; currentStation?: number }): Promise<any> => {
    const response = await fastApiClient.put(`${BASE_URL}/${assessmentId}`, updates);
    
    if (!response.data.success) {
      throw new Error(response.data.message || "Failed to update assessment");
    }
    
    // Return response data in case it contains token/URL for scheduled assessments
    return response.data.data || {};
  },

  // List assessments
  listAssessments: async (): Promise<CustomMCQAssessment[]> => {
    const response = await fastApiClient.get(`${BASE_URL}/list`);
    
    if (response.data.success) {
      return response.data.data.assessments || [];
    }
    throw new Error(response.data.message || "Failed to list assessments");
  },

  // Delete assessment
  deleteAssessment: async (assessmentId: string): Promise<void> => {
    const response = await fastApiClient.delete(`${BASE_URL}/${assessmentId}`);
    
    if (!response.data.success) {
      throw new Error(response.data.message || "Failed to delete assessment");
    }
  },

  // Verify candidate
  verifyCandidate: async (
    assessmentId: string,
    token: string,
    email: string,
    name: string
  ): Promise<{ verified: boolean; accessMode: string }> => {
    try {
      const response = await fastApiClient.post(`${BASE_URL}/verify-candidate`, {
        assessmentId,
        token,
        email,
        name,
      });
      
      if (response.data.success) {
        return response.data.data;
      }
      throw new Error(response.data.message || "Failed to verify candidate");
    } catch (err: any) {
      // Extract error message from different possible response structures
      const errorMessage = err.response?.data?.message || 
                          err.response?.data?.detail || 
                          err.message || 
                          "Failed to verify candidate. Please check your details and try again.";
      throw new Error(errorMessage);
    }
  },

  // Get assessment for taking (candidate view)
  getAssessmentForTaking: async (assessmentId: string, token: string, email?: string, name?: string): Promise<CustomMCQAssessment> => {
    const params: any = { token };
    if (email) params.email = email;
    if (name) params.name = name;
    
    const response = await fastApiClient.get(`${BASE_URL}/take/${assessmentId}`, {
      params,
    });
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to get assessment");
  },

  // Submit assessment
  submitAssessment: async (
    assessmentId: string,
    token: string,
    email: string,
    name: string,
    submissions: Array<{ questionId: string; selectedAnswers: string[] }>,
    startedAt?: Date,
    submittedAt?: Date
  ): Promise<{
    score: number;
    totalMarks: number;
    percentage: number;
    passed: boolean;
    passPercentage: number;
  }> => {
    const response = await fastApiClient.post(`${BASE_URL}/submit`, {
      assessmentId,
      token,
      email,
      name,
      submissions,
      startedAt: startedAt?.toISOString(),
      submittedAt: submittedAt?.toISOString(),
    });
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to submit assessment");
  },

  // Send invitation emails
  sendInvitations: async (
    assessmentId: string,
    candidates: Array<{ name: string; email: string }>,
    assessmentUrl: string,
    template?: {
      subject?: string;
      message?: string;
      footer?: string;
      sentBy?: string;
    }
  ): Promise<{
    sentCount: number;
    failedCount: number;
    failedEmails: string[];
    errorMessages: string[];
  }> => {
    const response = await fastApiClient.post(`${BASE_URL}/send-invitations`, {
      assessmentId,
      candidates,
      assessmentUrl,
      template,
    });
    
    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.message || "Failed to send invitations");
  },
};

