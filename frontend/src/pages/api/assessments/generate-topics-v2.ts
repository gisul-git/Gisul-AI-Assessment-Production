import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import fastApiClient from "../../../lib/fastapi";

interface CombinedSkill {
  skill_name: string;
  source: "role" | "manual" | "csv";
  description?: string | null;
  importance_level?: "Low" | "Medium" | "High" | null;
}

interface GenerateTopicsPayload {
  assessmentId?: string;
  assessmentTitle?: string;
  jobDesignation?: string;
  combinedSkills: CombinedSkill[];
  experienceMin: number;
  experienceMax: number;
  experienceMode: "corporate" | "student";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const payload = req.body as GenerateTopicsPayload;

  if (!payload.combinedSkills || payload.combinedSkills.length === 0) {
    return res.status(400).json({ message: "At least one skill must be provided in combinedSkills" });
  }

  // Validate combined skills structure
  for (const skill of payload.combinedSkills) {
    if (!skill.skill_name || !skill.skill_name.trim()) {
      return res.status(400).json({ message: "Each skill must have a skill_name" });
    }
    if (!skill.source || !["role", "manual", "csv"].includes(skill.source)) {
      return res.status(400).json({ message: "Each skill must have a valid source (role, manual, or csv)" });
    }
  }

  try {
    const token = (session as any)?.backendToken;
    const response = await fastApiClient.post(
      "/api/v1/assessments/generate-topics",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return res.status(response.status || 200).json(response.data);
  } catch (error: any) {
    console.error("Error in generate-topics-v2 API route:", error);
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to generate topics";
    return res.status(statusCode).json({
      message: errorMessage,
    });
  }
}



