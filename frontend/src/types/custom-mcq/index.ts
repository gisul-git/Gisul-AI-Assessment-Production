export interface MCQOption {
  label: string; // A, B, C, D, etc.
  text: string;
}

export interface MCQQuestion {
  id?: string;
  section: string;
  question: string;
  options: MCQOption[];
  correctAn: string; // Single: "A" or Multiple: "A,B" or "A,B,C"
  answerType: "single" | "multiple_all" | "multiple_any";
  marks: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Candidate {
  name: string;
  email: string;
}

export interface CustomMCQAssessment {
  id?: string;
  title: string;
  description?: string;
  questions: MCQQuestion[];
  candidates?: Candidate[];
  accessMode: "private" | "public";
  examMode: "strict" | "flexible";
  startTime?: string;
  endTime?: string;
  duration?: number; // In minutes, for flexible mode
  passPercentage: number;
  status?: string;
  totalQuestions?: number;
  totalMarks?: number;
  submissionsCount?: number;
  createdAt?: string;
  updatedAt?: string;
  schedule?: {
    startTime?: string;
    endTime?: string;
    duration?: number;
  };
}

export interface AssessmentSubmission {
  candidateInfo: {
    name: string;
    email: string;
  };
  score: number;
  totalMarks: number;
  percentage: number;
  passed: boolean;
  status: string;
  startedAt?: string;
  submittedAt?: string;
}

