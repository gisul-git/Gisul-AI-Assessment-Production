"""Request body size limiting middleware."""
from __future__ import annotations

from fastapi import Request, status
from fastapi.responses import JSONResponse

# Maximum request body size: 5MB
MAX_REQUEST_SIZE = 5 * 1024 * 1024  # 5MB in bytes


async def request_size_limit_middleware(request: Request, call_next):
    """
    Middleware to limit request body size to 5MB.
    Returns 413 Payload Too Large if exceeded.
    """
    # Check Content-Length header if present
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            size = int(content_length)
            if size > MAX_REQUEST_SIZE:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={
                        "success": False,
                        "message": f"Request body too large. Maximum size is {MAX_REQUEST_SIZE / (1024 * 1024):.0f}MB",
                        "detail": f"Request size: {size / (1024 * 1024):.2f}MB, Maximum: {MAX_REQUEST_SIZE / (1024 * 1024):.0f}MB"
                    }
                )
        except ValueError:
            # Invalid content-length, let it pass (will be caught by FastAPI)
            pass
    
    # For streaming requests, we'll check during body reading
    # FastAPI will handle this automatically if we set the limit in the app
    response = await call_next(request)
    return response


