import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import fastApiClient from "../../../lib/fastapi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const token = (session as any)?.backendToken;
    if (!token) {
      return res.status(401).json({ message: "Authentication token not found" });
    }

    const { testId } = req.query;

    if (req.method === "GET") {
      const response = await fastApiClient.get(`/api/v1/custom-mcq/${testId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return res.status(response.status || 200).json(response.data);
    } else if (req.method === "PUT") {
      const response = await fastApiClient.put(`/api/v1/custom-mcq/${testId}`, req.body, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return res.status(response.status || 200).json(response.data);
    } else if (req.method === "DELETE") {
      const response = await fastApiClient.delete(`/api/v1/custom-mcq/${testId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return res.status(response.status || 200).json(response.data);
    }
  } catch (error: any) {
    console.error("Error in custom MCQ test API route:", error);
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to process request";
    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
}

