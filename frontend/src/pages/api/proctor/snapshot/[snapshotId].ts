import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ 
      success: false, 
      message: "Method not allowed" 
    });
  }

  try {
    const { snapshotId } = req.query;

    // Validate required fields
    if (!snapshotId || typeof snapshotId !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Missing required query parameter: snapshotId",
      });
    }

    console.log(`[Proctor API] Fetching snapshot: ${snapshotId}`);

    // Call backend FastAPI
    const backendResponse = await axios.get(
      `${BACKEND_URL}/api/v1/proctor/snapshot/${encodeURIComponent(snapshotId)}`,
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    console.log(`[Proctor API] Snapshot fetched successfully`);
    
    return res.status(200).json(backendResponse.data);
  } catch (error: any) {
    console.error("[Proctor API] Error fetching snapshot:", error.message);
    console.error("[Proctor API] Error details:", error.response?.data);
    
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "error",
      message: error.response?.data?.detail || error.message || "Failed to fetch snapshot",
    });
  }
}

