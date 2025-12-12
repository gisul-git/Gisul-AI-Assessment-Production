"""
FastAPI application entry point.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.v1 import assessments, auth, candidate, proctor, users, custom_mcq
from .api.v1.dsa.routers import tests as dsa_tests, questions as dsa_questions, submissions as dsa_submissions, assessment as dsa_assessment, admin as dsa_admin, run as dsa_run
from .api.v1.super_admin.router import router as super_admin_router
from .api.v1.custom_mcq.routers import router as custom_mcq_router
from .db.mongo import connect_to_mongo, close_mongo_connection
from .api.v1.dsa.database import connect_to_dsa_mongo, close_dsa_mongo_connection
from .exceptions.handlers import (
    validation_exception_handler,
    not_found_handler,
    rate_limit_exceeded_handler,
)
from slowapi.errors import RateLimitExceeded


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    await connect_to_mongo()
    await connect_to_dsa_mongo()
    yield
    # Shutdown
    await close_dsa_mongo_connection()
    await close_mongo_connection()


app = FastAPI(
    title="AI Assessment Platform API",
    description="Backend API for AI-powered assessment platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(assessments.router)
app.include_router(candidate.router)
app.include_router(proctor.router)
app.include_router(custom_mcq.router)
app.include_router(super_admin_router)
app.include_router(custom_mcq_router)

# Include DSA routers
app.include_router(dsa_tests.router, prefix="/api/v1/dsa/tests", tags=["dsa"])
app.include_router(dsa_questions.router)
app.include_router(dsa_submissions.router)
app.include_router(dsa_assessment.router)
app.include_router(dsa_admin.router)
app.include_router(dsa_run.router)

# Setup exception handlers
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, not_found_handler)
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "AI Assessment Platform API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}
