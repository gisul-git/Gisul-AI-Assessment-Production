"""Exception handlers for FastAPI."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

logger = logging.getLogger(__name__)


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handle request validation errors with user-friendly messages."""
    logger.error(f"Validation error for {request.url.path}: {exc.errors()}")
    
    # Format errors into user-friendly messages
    error_messages = []
    for error in exc.errors():
        field = ".".join(str(loc) for loc in error.get("loc", []))
        error_type = error.get("type", "")
        error_msg = error.get("msg", "")
        
        # Handle password validation errors
        if "password" in field.lower():
            if error_type == "string_too_short":
                error_messages.append("Password must be at least 8 characters long")
            elif error_type == "value_error":
                # This is from our custom password validation
                error_messages.append(error_msg)
            elif "missing" in error_type:
                error_messages.append("Password is required")
            else:
                error_messages.append(f"Password: {error_msg}")
        # Handle email validation errors
        elif "email" in field.lower():
            if "missing" in error_type:
                error_messages.append("Email is required")
            elif "value_error" in error_type or "string" in error_type:
                error_messages.append("Please enter a valid email address")
            else:
                error_messages.append(f"Email: {error_msg}")
        # Handle other field errors
        else:
            field_name = field.split(".")[-1] if "." in field else field
            if "missing" in error_type:
                error_messages.append(f"{field_name.capitalize()} is required")
            else:
                error_messages.append(f"{field_name.capitalize()}: {error_msg}")
    
    # Join all error messages into a single message
    message = "; ".join(error_messages) if error_messages else "Validation error"
    
    return JSONResponse(
        status_code=422,
        content={
            "success": False, 
            "message": message,
            "detail": message
        },
    )


async def not_found_handler(request: Request, exc: Any) -> JSONResponse:
    """Handle 404 errors."""
    return JSONResponse(
        status_code=404,
        content={
            "success": False,
            "message": f"Route {request.url.path} not found",
        },
    )


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Handle rate limit exceeded errors."""
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "message": "Rate limit exceeded. Please try again later.",
            "detail": str(exc.detail) if hasattr(exc, "detail") else "Too many requests"
        },
        headers={"Retry-After": str(exc.retry_after) if hasattr(exc, "retry_after") else "60"}
    )


