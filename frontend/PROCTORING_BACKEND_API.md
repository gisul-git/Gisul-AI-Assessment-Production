# Proctoring Backend API Documentation

## Endpoints

### POST `/api/proctor/upload`

Uploads a snapshot image for a violation event.

**Request Body (JSON):**
```json
{
  "assessmentId": "string",
  "candidateId": "string",
  "eventType": "MULTIPLE_FACE | GAZE_AWAY | TAB_SWITCH | FOCUS_LOST | FULLSCREEN_EXIT",
  "timestamp": "ISO 8601 string",
  "snapshot": "data:image/jpeg;base64,...",
  "metadata": {
    "facesCount": 2,
    "gazeScore": 3,
    "pageVisibility": true,
    "windowDimensions": { "width": 1920, "height": 1080 }
  }
}
```

**Response:**
```json
{
  "success": true,
  "id": "snapshot_document_id",
  "url": "optional_thumbnail_url"
}
```

**Backend Implementation Notes:**
- Extract base64 from `data:image/jpeg;base64,...` format
- Save image to GridFS or file storage
- Create document in MongoDB collection `proctor.snapshots`:
  ```json
  {
    "_id": "ObjectId",
    "assessmentId": "string",
    "candidateId": "string",
    "eventType": "string",
    "timestamp": "ISODate",
    "fileId": "GridFS file ID or file path",
    "metadata": {}
  }
  ```
- Return `{ success: true, id: "<document_id>", url: "<optional_thumbnail_url>" }`

---

### POST `/api/proctor/record`

Records a violation event (with optional snapshot reference).

**Request Body (JSON):**
```json
{
  "eventType": "string",
  "timestamp": "ISO 8601 string",
  "assessmentId": "string",
  "userId": "string (candidateId)",
  "hasSnapshot": true,
  "snapshotId": "string (optional, if snapshot was uploaded)",
  "metadata": {}
}
```

**Response:**
```json
{
  "status": "ok",
  "id": "violation_record_id"
}
```

**Backend Implementation Notes:**
- Save record in MongoDB collection `proctor.records`:
  ```json
  {
    "_id": "ObjectId",
    "assessmentId": "string",
    "candidateId": "string",
    "eventType": "string",
    "timestamp": "ISODate",
    "snapshotId": "string (optional)",
    "metadata": {}
  }
  ```
- Return `{ status: "ok", id: "<record_id>" }`

---

### GET `/api/proctor/snapshot/:id/thumb` (Optional)

Fetches a thumbnail URL for a snapshot by ID.

**Response:**
```json
{
  "thumbnailUrl": "data:image/jpeg;base64,... or URL"
}
```

**Backend Implementation Notes:**
- Lookup snapshot by ID
- Return thumbnail URL or base64 dataURL
- Used by ViolationToast component for async thumbnail loading




