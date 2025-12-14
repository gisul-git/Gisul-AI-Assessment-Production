import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import { IncomingForm, File as FormidableFile } from "formidable";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Disable default body parser to handle multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }

  let tempFilePath: string | null = null;

  try {
    // Parse multipart/form-data using formidable
    const form = new IncomingForm({
      maxFileSize: 10 * 1024 * 1024, // 10MB max
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    
    // Extract fields
    const metadataStr = Array.isArray(fields.metadata) ? fields.metadata[0] : fields.metadata;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    // Validate required fields
    if (!metadataStr || !file) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: file and metadata",
      });
    }

    tempFilePath = file.filepath;

    // Parse metadata JSON
    let metadata: any;
    try {
      metadata = JSON.parse(metadataStr);
    } catch (parseError) {
      return res.status(400).json({
        status: "error",
        message: "Invalid metadata JSON format",
      });
    }

    const { eventType, timestamp, assessmentId, userId } = metadata;

    // Validate metadata fields
    if (!eventType || !timestamp || !assessmentId || !userId) {
      return res.status(400).json({
        status: "error",
        message: "Missing required metadata fields: eventType, timestamp, assessmentId, userId",
      });
    }

    // Log the upload locally for debugging
    console.log("[Proctor Upload] Snapshot received:", {
      eventType,
      timestamp,
      assessmentId,
      userId,
      snapshotSize: file.size,
      filename: file.originalFilename || file.newFilename,
    });

    // Forward to backend FastAPI as multipart/form-data
    try {
      // Read file buffer
      const fileBuffer = fs.readFileSync(file.filepath);
      
      // Create FormData for axios (Node.js FormData)
      const backendFormData = new FormData();
      backendFormData.append('file', fileBuffer, {
        filename: file.originalFilename || 'snapshot.jpg',
        contentType: 'image/jpeg',
      });
      backendFormData.append('metadata', metadataStr);

      const backendResponse = await axios.post(
        `${BACKEND_URL}/api/v1/proctor/upload`,
        backendFormData,
        {
          headers: {
            ...backendFormData.getHeaders(),
          },
          timeout: 30000, // 30 second timeout for file upload
        }
      );

      // Clean up temp file
      if (tempFilePath) {
        fs.unlinkSync(tempFilePath);
        tempFilePath = null;
      }

      console.log("[Proctor Upload] Backend response:", backendResponse.data);
      
      // Backend returns { status: 'ok', id: '<snapshotId>' }
      return res.status(200).json({ 
        status: "ok", 
        id: backendResponse.data?.id || backendResponse.data?.fileId || backendResponse.data?.snapshotId,
        ...backendResponse.data 
      });
    } catch (backendError: any) {
      // Clean up temp file on error
      if (tempFilePath) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
        tempFilePath = null;
      }
      
      console.error("[Proctor Upload] Backend error:", backendError.message);
      console.error("[Proctor Upload] Backend error details:", backendError.response?.data);
      
      // Return error to client
      return res.status(500).json({ 
        status: "error",
        message: "Failed to upload snapshot to backend",
        details: backendError.response?.data || backendError.message,
      });
    }
  } catch (error: any) {
    // Clean up temp file on error
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }
    }
    
    console.error("[Proctor Upload] Error processing upload:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      details: error.message,
    });
  }
}

