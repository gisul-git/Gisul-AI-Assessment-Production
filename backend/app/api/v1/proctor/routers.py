from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
import base64

from ....db.mongo import get_db
from .schemas import (
    ProctorEventIn, 
    ProctorSummaryOut, 
    EVENT_TYPE_LABELS,
    StartSessionRequest,
    StopSessionRequest
)
from ....utils.responses import success_response
from ....utils.mongo import to_object_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/proctor", tags=["proctor"])


# ============================================================================
# WebRTC Signalling Models
# ============================================================================

class CreateSessionRequest(BaseModel):
    assessmentId: str
    candidateId: str  # userId/email of candidate
    adminId: str  # userId of admin creating session


class SessionResponse(BaseModel):
    sessionId: str
    status: str


class SDPRequest(BaseModel):
    sessionId: str
    sdp: str
    sdpType: str  # "offer" or "answer"
    sender: str  # "candidate" or "admin"


class ICECandidateRequest(BaseModel):
    sessionId: str
    candidate: str
    sdpMid: Optional[str] = None
    sdpMLineIndex: Optional[int] = None
    sender: str  # "candidate" or "admin"


# ============================================================================
# WebRTC Live Proctoring Endpoints
# ============================================================================

@router.post("/live/create-session")
async def create_live_session(
    request: CreateSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Create a new live proctoring session for WebRTC signalling.
    Called by admin when they want to start watching a candidate.
    Automatically ends any existing pending/active sessions for this candidate.
    """
    try:
        # End any existing pending/active sessions for this candidate first
        await db.proctor_sessions.update_many(
            {
                "assessmentId": request.assessmentId,
                "candidateId": request.candidateId,
                "status": {"$in": ["pending", "active", "offer_sent"]},
            },
            {
                "$set": {
                    "status": "ended",
                    "endedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        session_id = str(uuid.uuid4())
        
        session = {
            "sessionId": session_id,
            "assessmentId": request.assessmentId,
            "candidateId": request.candidateId,
            "adminId": request.adminId,
            "status": "pending",  # pending -> active -> ended
            "offer": None,
            "answer": None,
            "candidateICE": [],
            "adminICE": [],
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        
        await db.proctor_sessions.insert_one(session)
        
        logger.info(f"[LiveProctor] Session created: {session_id} for candidate {request.candidateId}")
        
        # Include TURN server configuration if available
        response_data = {"sessionId": session_id, "status": "pending"}
        from ....config.settings import get_settings
        turn_settings = get_settings()
        if turn_settings.turn_url:
            response_data["turnConfig"] = {
                "url": turn_settings.turn_url,
                "username": turn_settings.turn_username or "",
                "password": turn_settings.turn_password or "",
            }
        
        return success_response("Session created", response_data)
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error creating session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/live/session/{session_id}")
async def get_live_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get current session state including SDP and ICE candidates."""
    try:
        session = await db.proctor_sessions.find_one({"sessionId": session_id})
        
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session["_id"] = str(session["_id"])
        
        # Include TURN server configuration if available
        from ....config.settings import get_settings
        turn_settings = get_settings()
        if turn_settings.turn_url:
            session["turnConfig"] = {
                "url": turn_settings.turn_url,
                "username": turn_settings.turn_username or "",
                "password": turn_settings.turn_password or "",
            }
        
        return success_response("Session fetched", session)
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error fetching session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/offer")
async def post_offer(
    request: SDPRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Post WebRTC offer SDP.
    Candidate sends offer when starting to stream.
    """
    try:
        result = await db.proctor_sessions.update_one(
            {"sessionId": request.sessionId},
            {
                "$set": {
                    "offer": {"sdp": request.sdp, "type": request.sdpType, "sender": request.sender},
                    "status": "offer_sent",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[LiveProctor] Offer received for session {request.sessionId}")
        
        return success_response("Offer saved", {"sessionId": request.sessionId})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error saving offer: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/answer")
async def post_answer(
    request: SDPRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Post WebRTC answer SDP.
    Admin sends answer after receiving candidate's offer.
    """
    try:
        result = await db.proctor_sessions.update_one(
            {"sessionId": request.sessionId},
            {
                "$set": {
                    "answer": {"sdp": request.sdp, "type": request.sdpType, "sender": request.sender},
                    "status": "active",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[LiveProctor] Answer received for session {request.sessionId}")
        
        return success_response("Answer saved", {"sessionId": request.sessionId})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error saving answer: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/ice")
async def post_ice_candidate(
    request: ICECandidateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Post ICE candidate for WebRTC connection.
    Both candidate and admin send ICE candidates.
    """
    try:
        ice_field = "candidateICE" if request.sender == "candidate" else "adminICE"
        
        ice_candidate = {
            "candidate": request.candidate,
            "sdpMid": request.sdpMid,
            "sdpMLineIndex": request.sdpMLineIndex,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        result = await db.proctor_sessions.update_one(
            {"sessionId": request.sessionId},
            {
                "$push": {ice_field: ice_candidate},
                "$set": {"updatedAt": datetime.now(timezone.utc).isoformat()},
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return success_response("ICE candidate saved", {"sessionId": request.sessionId})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error saving ICE candidate: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/end-session/{session_id}")
async def end_live_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """End a live proctoring session."""
    try:
        result = await db.proctor_sessions.update_one(
            {"sessionId": session_id},
            {
                "$set": {
                    "status": "ended",
                    "endedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[LiveProctor] Session ended: {session_id}")
        
        return success_response("Session ended", {"sessionId": session_id, "status": "ended"})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error ending session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/live/pending/{assessment_id}/{candidate_id}")
async def get_pending_session(
    assessment_id: str,
    candidate_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Check if there's a pending live proctoring session for a candidate.
    Candidate polls this to know when admin wants to watch them.
    """
    try:
        session = await db.proctor_sessions.find_one({
            "assessmentId": assessment_id,
            "candidateId": candidate_id,
            "status": {"$in": ["pending", "offer_sent", "active"]},
        })
        
        if not session:
            return success_response("No active session", {"hasSession": False})
        
        session["_id"] = str(session["_id"])
        
        return success_response("Session found", {"hasSession": True, "session": session})
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error checking pending session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ============================================================================
# Multi-Candidate Live Proctoring Endpoints
# ============================================================================

class CreateMultiSessionRequest(BaseModel):
    assessmentId: str
    adminId: str


@router.get("/live/active-candidates/{assessment_id}")
async def get_active_candidates(
    assessment_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get all candidates who are currently taking the assessment.
    These are candidates who have started but not yet submitted.
    """
    try:
        # Find candidates who have started but not submitted
        # Look in assessment_sessions collection for active sessions
        active_sessions = await db.assessment_sessions.find({
            "assessmentId": assessment_id,
            "startedAt": {"$exists": True},
            "submittedAt": {"$exists": False},
        }).to_list(length=100)
        
        candidates = []
        for session in active_sessions:
            # Check if there's an active proctoring session
            proctor_session = await db.proctor_sessions.find_one({
                "assessmentId": assessment_id,
                "candidateId": session.get("email", session.get("candidateId")),
                "status": {"$in": ["pending", "offer_sent", "active"]},
            })
            
            candidates.append({
                "email": session.get("email", session.get("candidateId")),
                "name": session.get("name", "Unknown"),
                "startedAt": session.get("startedAt"),
                "hasActiveSession": proctor_session is not None,
                "sessionId": proctor_session.get("sessionId") if proctor_session else None,
                "sessionStatus": proctor_session.get("status") if proctor_session else None,
            })
        
        return success_response("Active candidates retrieved", {
            "count": len(candidates),
            "candidates": candidates
        })
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error getting active candidates: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/create-multi-session")
async def create_multi_live_sessions(
    request: CreateMultiSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Create live proctoring sessions for ALL active candidates in an assessment.
    Used for the multi-candidate proctoring dashboard.
    """
    try:
        # Find all active candidates (started but not submitted)
        active_sessions = await db.assessment_sessions.find({
            "assessmentId": request.assessmentId,
            "startedAt": {"$exists": True},
            "submittedAt": {"$exists": False},
        }).to_list(length=100)
        
        created_sessions = []
        
        for session in active_sessions:
            candidate_id = session.get("email", session.get("candidateId"))
            
            # End any existing sessions for this candidate
            await db.proctor_sessions.update_many(
                {
                    "assessmentId": request.assessmentId,
                    "candidateId": candidate_id,
                    "status": {"$in": ["pending", "active", "offer_sent"]},
                },
                {
                    "$set": {
                        "status": "ended",
                        "endedAt": datetime.now(timezone.utc).isoformat(),
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                    }
                }
            )
            
            # Create new session
            session_id = str(uuid.uuid4())
            
            new_session = {
                "sessionId": session_id,
                "assessmentId": request.assessmentId,
                "candidateId": candidate_id,
                "candidateName": session.get("name", "Unknown"),
                "adminId": request.adminId,
                "status": "pending",
                "offer": None,
                "answer": None,
                "candidateICE": [],
                "adminICE": [],
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            
            await db.proctor_sessions.insert_one(new_session)
            
            session_data = {
                "sessionId": session_id,
                "candidateId": candidate_id,
                "candidateName": session.get("name", "Unknown"),
                "status": "pending",
            }
            
            # Include TURN server configuration if available
            from ....config.settings import get_settings
            turn_settings = get_settings()
            if turn_settings.turn_url:
                session_data["turnConfig"] = {
                    "url": turn_settings.turn_url,
                    "username": turn_settings.turn_username or "",
                    "password": turn_settings.turn_password or "",
                }
            
            created_sessions.append(session_data)
            
            logger.info(f"[LiveProctor] Multi-session created: {session_id} for {candidate_id}")
        
        return success_response("Sessions created for all active candidates", {
            "count": len(created_sessions),
            "sessions": created_sessions
        })
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error creating multi-sessions: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/live/all-sessions/{assessment_id}")
async def get_all_sessions(
    assessment_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get all active proctoring sessions for an assessment.
    Used by the multi-proctor dashboard to display all candidate streams.
    Excludes sessions for candidates who have already submitted.
    """
    try:
        sessions = await db.proctor_sessions.find({
            "assessmentId": assessment_id,
            "status": {"$in": ["pending", "offer_sent", "active"]},
        }).to_list(length=100)
        
        # Convert ObjectId to string
        for session in sessions:
            session["_id"] = str(session["_id"])
        
        # Filter out sessions for candidates who have submitted
        # Check assessment's candidateResponses to see if candidate has submittedAt
        try:
            try:
                assessment_oid = to_object_id(assessment_id)
            except ValueError:
                logger.warning(f"[LiveProctor] Invalid assessment ID format: {assessment_id}, skipping submission check")
                assessment_oid = None
            
            if assessment_oid:
                assessment = await db.assessments.find_one({"_id": assessment_oid})
                
                if assessment and assessment.get("candidateResponses"):
                    candidate_responses = assessment.get("candidateResponses", {})
                    submitted_candidates = set()
                    
                    # Extract submitted candidate emails (normalize to lowercase)
                    for response_key, response_data in candidate_responses.items():
                        if isinstance(response_data, dict) and response_data.get("submittedAt"):
                            email = response_data.get("email", "")
                            if email:
                                submitted_candidates.add(email.strip().lower())
                    
                    # Filter out sessions for submitted candidates
                    if submitted_candidates:
                        active_sessions = []
                        for session in sessions:
                            candidate_id = session.get("candidateId", "")
                            candidate_email = candidate_id.strip().lower() if candidate_id else ""
                            
                            if candidate_email and candidate_email in submitted_candidates:
                                logger.info(f"[LiveProctor] Filtering out session for submitted candidate: {candidate_email}")
                                continue
                            
                            active_sessions.append(session)
                        
                        sessions = active_sessions
                        logger.info(f"[LiveProctor] Filtered out {len(submitted_candidates)} submitted candidates, {len(sessions)} active sessions remaining")
        except Exception as filter_exc:
            logger.warning(f"[LiveProctor] Error filtering submitted candidates, using all sessions: {filter_exc}")
            # If filtering fails, continue with all sessions (fail-safe)
        
        return success_response("Sessions retrieved", {
            "count": len(sessions),
            "sessions": sessions
        })
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error getting all sessions: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# Session Lifecycle Endpoints
# ============================================================================

@router.post("/start-session")
async def start_proctoring_session(
    payload: StartSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Start a new proctoring session for a candidate.
    Creates a session record with timestamps and mode flags.
    """
    try:
        if not payload.consent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User consent is required to start proctoring session"
            )
        
        # Check if there's an existing active session
        existing_session = await db.proctoring_sessions.find_one({
            "assessmentId": payload.assessmentId.strip(),
            "userId": payload.userId.strip(),
            "status": "active",
        })
        
        if existing_session:
            # Update existing session instead of creating new one
            await db.proctoring_sessions.update_one(
                {"_id": existing_session["_id"]},
                {
                    "$set": {
                        "ai_proctoring": payload.ai_proctoring,
                        "live_proctoring": payload.live_proctoring,
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                    }
                }
            )
            session_id = str(existing_session["_id"])
        else:
            # Create new session
            session = {
                "assessmentId": payload.assessmentId.strip(),
                "userId": payload.userId.strip(),
                "ai_proctoring": payload.ai_proctoring,
                "live_proctoring": payload.live_proctoring,
                "status": "active",
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "endedAt": None,
                "metadata": payload.metadata or {},
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            
            result = await db.proctoring_sessions.insert_one(session)
            session_id = str(result.inserted_id)
        
        logger.info(
            f"[Proctor Session] Session started: {session_id} for user {payload.userId} "
            f"in assessment {payload.assessmentId} (AI: {payload.ai_proctoring}, Live: {payload.live_proctoring})"
        )
        
        return success_response(
            "Proctoring session started",
            {
                "sessionId": session_id,
                "ai_proctoring": payload.ai_proctoring,
                "live_proctoring": payload.live_proctoring,
            }
        )
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[Proctor Session] Error starting session: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start proctoring session: {str(exc)}"
        ) from exc
@router.post("/record")
async def record_proctor_event(
    payload: ProctorEventIn,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Record a proctoring event from the browser.
    
    This endpoint receives proctoring violation events (tab switches, fullscreen exits, etc.)
    and stores them in MongoDB for later review by admins.
    """
    try:
        # If snapshotId is provided, fetch the snapshot and include base64 for backward compatibility
        snapshot_base64 = payload.snapshotBase64
        if payload.snapshotId and not snapshot_base64:
            try:
                from bson import ObjectId
                snapshot = await db.proctor_snapshots.find_one({"_id": ObjectId(payload.snapshotId)})
                if snapshot:
                    snapshot_base64 = snapshot.get("snapshotBase64")
                    logger.info(f"[Proctor API] Fetched snapshot {payload.snapshotId} for event")
            except Exception as e:
                logger.warning(f"[Proctor API] Failed to fetch snapshot {payload.snapshotId}: {e}")
        
        # Create the document to storea
        proctor_event = {
            "userId": payload.userId.strip(),
            "assessmentId": payload.assessmentId.strip(),
            "eventType": payload.eventType.strip(),
            "timestamp": payload.timestamp,
            "metadata": payload.metadata,
            "snapshotBase64": snapshot_base64,  # Include for backward compatibility
            "snapshotId": payload.snapshotId,  # Store snapshotId for reference
            "receivedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Insert into proctor_events collection
        result = await db.proctor_events.insert_one(proctor_event)
        
        # Log the event
        logger.info(
            f"[Proctor API] Event recorded: {payload.eventType} for user {payload.userId} "
            f"in assessment {payload.assessmentId} (id: {result.inserted_id})"
        )
        
        # Log if snapshot was included
        if payload.snapshotBase64:
            logger.info(f"[Proctor API] Snapshot saved for event (id: {result.inserted_id})")

        return {"status": "ok", "id": str(result.inserted_id)}
    
    except Exception as exc:
        logger.exception(f"[Proctor] Error recording event: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record proctoring event: {str(exc)}"
        ) from exc


@router.post("/upload")
async def upload_proctor_snapshot(
    file: UploadFile = File(...),
    metadata: str = Form(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Upload a proctoring snapshot (image file).
    
    This endpoint receives snapshot images from the frontend and stores them in MongoDB.
    Returns the snapshot ID which can be linked to violation records.
    """
    try:
        import json
        
        # Parse metadata JSON
        try:
            metadata_dict = json.loads(metadata)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid metadata JSON format"
            )
        
        # Validate required metadata fields
        required_fields = ["eventType", "timestamp", "assessmentId", "userId"]
        for field in required_fields:
            if field not in metadata_dict:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing required metadata field: {field}"
                )
        
        # Read file content
        file_content = await file.read()
        
        # Convert to base64 for storage
        snapshot_base64 = base64.b64encode(file_content).decode('utf-8')
        
        # Create snapshot document
        snapshot_doc = {
            "assessmentId": metadata_dict["assessmentId"].strip(),
            "userId": metadata_dict["userId"].strip(),
            "eventType": metadata_dict["eventType"].strip(),
            "timestamp": metadata_dict["timestamp"],
            "snapshotBase64": snapshot_base64,
            "contentType": file.content_type or "image/jpeg",
            "size": len(file_content),
            "metadata": {k: v for k, v in metadata_dict.items() if k not in ["assessmentId", "userId", "eventType", "timestamp"]},
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        
        # Insert into proctor_snapshots collection
        result = await db.proctor_snapshots.insert_one(snapshot_doc)
        snapshot_id = str(result.inserted_id)
        
        logger.info(
            f"[Proctor Upload] Snapshot saved: {snapshot_id} for user {metadata_dict['userId']} "
            f"in assessment {metadata_dict['assessmentId']} (event: {metadata_dict['eventType']}, size: {len(file_content)} bytes)"
        )
        
        return {
            "status": "ok",
            "id": snapshot_id,
        }
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[Proctor Upload] Error uploading snapshot: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload snapshot: {str(exc)}"
        ) from exc


@router.get("/snapshot/{snapshotId}")
async def get_proctor_snapshot(
    snapshotId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Retrieve a proctoring snapshot by ID.
    """
    try:
        from bson import ObjectId
        
        snapshot = await db.proctor_snapshots.find_one({"_id": ObjectId(snapshotId)})
        
        if not snapshot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Snapshot not found"
            )
        
        return {
            "status": "ok",
            "id": str(snapshot["_id"]),
            "snapshotBase64": snapshot.get("snapshotBase64"),
            "contentType": snapshot.get("contentType", "image/jpeg"),
            "eventType": snapshot.get("eventType"),
            "timestamp": snapshot.get("timestamp"),
        }
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[Proctor] Error fetching snapshot: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch snapshot: {str(exc)}"
        ) from exc


@router.get("/summary/{assessmentId}/{userId}")
async def get_proctor_summary(
    assessmentId: str,
    userId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get proctoring violation summary for a specific candidate in an assessment.
    
    Returns:
    - summary: Count of each event type
    - totalViolations: Total number of violations
    - violations: List of all violation documents
    """
    try:
        # Query all events for this user and assessment
        query = {
            "assessmentId": assessmentId.strip(),
            "userId": userId.strip(),
        }
        
        cursor = db.proctor_events.find(query).sort("timestamp", 1)
        violations = []
        
        async for doc in cursor:
            # Convert ObjectId to string for JSON serialization
            doc["_id"] = str(doc["_id"])
            violations.append(doc)
        
        # Aggregate counts by event type
        summary: Dict[str, int] = {}
        for violation in violations:
            event_type = violation.get("eventType", "UNKNOWN")
            summary[event_type] = summary.get(event_type, 0) + 1
        
        total_violations = len(violations)
        
        logger.info(
            f"[Proctor] Summary fetched for user {userId} in assessment {assessmentId}: "
            f"{total_violations} total violations"
        )

        return success_response(
            "Proctoring summary fetched successfully",
            {
                "summary": summary,
                "totalViolations": total_violations,
                "violations": violations,
                "eventTypeLabels": EVENT_TYPE_LABELS,
            }
        )
    
    except Exception as exc:
        logger.exception(f"[Proctor] Error fetching summary: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch proctoring summary: {str(exc)}"
        ) from exc


@router.get("/logs/{assessmentId}/{userId}")
async def get_proctor_logs(
    assessmentId: str,
    userId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get full proctoring logs for a specific candidate in an assessment.
    Returns all violation documents with metadata and snapshotBase64 for evidence gallery.
    
    If userId is "*", returns all logs for the assessment (for admin view).
    
    Returns:
    - logs: List of all violation documents sorted by timestamp (newest first)
    - totalCount: Total number of logs
    """
    try:
        # Query all events for this user and assessment, sorted newest first
        # If userId is "*", return all logs for the assessment
        if userId.strip() == "*":
            query = {
                "assessmentId": assessmentId.strip(),
            }
            logger.info(f"[Proctor API] Fetching ALL logs for assessment {assessmentId}")
        else:
            query = {
                "assessmentId": assessmentId.strip(),
                "userId": userId.strip(),
            }
        
        # Use to_list with a reasonable limit to avoid timeout
        # Limit to 1000 most recent logs to prevent timeout issues
        cursor = db.proctor_events.find(query).sort("timestamp", -1).limit(1000)
        logs = await cursor.to_list(length=1000)
        
            # Convert ObjectId to string for JSON serialization
        for doc in logs:
            doc["_id"] = str(doc["_id"])
            # Ensure snapshotBase64 is properly formatted if present
            if doc.get("snapshotBase64") and not doc["snapshotBase64"].startswith("data:"):
                # If it's raw base64, add data URI prefix (assume PNG format)
                doc["snapshotBase64"] = f"data:image/png;base64,{doc['snapshotBase64']}"
        
        logger.info(
            f"[Proctor API] Logs fetched for user {userId} in assessment {assessmentId}: "
            f"{len(logs)} total logs"
        )

        return success_response(
            "Proctoring logs fetched successfully",
            {
                "logs": logs,
                "totalCount": len(logs),
                "eventTypeLabels": EVENT_TYPE_LABELS,
            }
        )
    
    except Exception as exc:
        logger.exception(f"[Proctor API] Error fetching logs: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch proctoring logs: {str(exc)}"
        ) from exc


@router.get("/assessment/{assessmentId}/all")
async def get_all_proctor_events_for_assessment(
    assessmentId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get all proctoring events for an assessment, grouped by user.
    
    Returns a dictionary where keys are userIds and values contain
    their violation summary and details.
    """
    try:
        # Query all events for this assessment
        query = {"assessmentId": assessmentId.strip()}
        
        cursor = db.proctor_events.find(query).sort("timestamp", 1)
        
        # Group by user
        users_data: Dict[str, Dict[str, Any]] = {}
        
        async for doc in cursor:
            user_id = doc.get("userId", "unknown")
            doc["_id"] = str(doc["_id"])
            
            if user_id not in users_data:
                users_data[user_id] = {
                    "violations": [],
                    "summary": {},
                    "totalViolations": 0,
                }
            
            users_data[user_id]["violations"].append(doc)
            event_type = doc.get("eventType", "UNKNOWN")
            users_data[user_id]["summary"][event_type] = users_data[user_id]["summary"].get(event_type, 0) + 1
            users_data[user_id]["totalViolations"] += 1
        
        logger.info(
            f"[Proctor API] All events fetched for assessment {assessmentId}: "
            f"{len(users_data)} users with violations"
        )

        return success_response(
            "All proctoring events fetched successfully",
            {
                "users": users_data,
                "eventTypeLabels": EVENT_TYPE_LABELS,
            }
        )
    
    except Exception as exc:
        logger.exception(f"[Proctor API] Error fetching all events: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch proctoring events: {str(exc)}"
        ) from exc

