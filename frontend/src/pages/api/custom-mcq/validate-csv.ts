import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import fastApiClient from "../../../lib/fastapi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const payload = req.body;

  if (!payload.csvContent) {
    return res.status(400).json({ message: "CSV content is required" });
  }

  try {
    const token = (session as any)?.backendToken;
    if (!token) {
      return res.status(401).json({ message: "Authentication token not found" });
    }

    const response = await fastApiClient.post("/api/v1/custom-mcq/validate-csv", payload, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return res.status(response.status || 200).json(response.data);
  } catch (error: any) {
    console.error("Error in validate-csv API route:", error);
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to validate CSV";
    return res.status(statusCode).json({
      message: errorMessage,
    });
  }
}

