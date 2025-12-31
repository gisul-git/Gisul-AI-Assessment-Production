"""
FastAPI application entry point.
"""
from contextlib import asynccontextmanager
import subprocess
import sys
import os
import logging
from pathlib import Path
 
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
 
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
 
from .api.v1 import assessments, auth, candidate, proctor, users
from .api.v1.custom_mcq.routers import router as custom_mcq_router
from .api.v1.proctoring.routers import router as proctoring_router
from .api.v1.dsa.routers import tests as dsa_tests, questions as dsa_questions, submissions as dsa_submissions, assessment as dsa_assessment, admin as dsa_admin, run as dsa_run
from .api.v1.aiml.routers import questions as aiml_questions, tests as aiml_tests, assessment as aiml_assessment, run as aiml_run
from .api.v1.assessments.code_execution import router as assessment_code_execution_router
from .api.v1.super_admin.router import router as super_admin_router
from .config.settings import get_settings
from .db.mongo import connect_to_mongo, close_mongo_connection
from .api.v1.dsa.database import connect_to_dsa_mongo, close_dsa_mongo_connection
from .api.v1.aiml.database import connect_to_aiml_mongo, close_aiml_mongo_connection
from .exceptions.handlers import (
    validation_exception_handler,
    not_found_handler,
    rate_limit_exceeded_handler,
)
from slowapi.errors import RateLimitExceeded

# Configure logging to output to console
logging.basicConfig(
    level=logging.INFO,  # Set to INFO to see info, warning, and error logs
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout)  # Output to console
    ]
)

# Set uvicorn access logs to INFO level
logging.getLogger("uvicorn.access").setLevel(logging.INFO)

logger = logging.getLogger("backend")

# Redis imports
try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    try:
        import redis
        REDIS_AVAILABLE = True
    except ImportError:
        REDIS_AVAILABLE = False
        logger.warning("Redis not available - caching will be disabled")
 
# Global variables to store the agent process and log file
aiml_agent_process = None
aiml_agent_log_file = None
 
 
def is_port_in_use(host: str, port: int) -> bool:
    """Check if a port is already in use."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex((host, port))
            return result == 0
    except Exception:
        return False
 
 
def start_aiml_agent():
    """Start the AIML competency agent as a subprocess."""
    global aiml_agent_process, aiml_agent_log_file
   
    print("[AIML Agent] Starting AIML agent startup process...")
   
    try:
        # Check if port 8889 is already in use (agent might already be running)
        if is_port_in_use('127.0.0.1', 8889):
            print("[AIML Agent] Port 8889 already in use - agent may already be running")
            logger.info("="*50)
            logger.info("ℹ️  AIML agent appears to be already running on port 8889")
            logger.info("   WebSocket: ws://127.0.0.1:8889")
            logger.info("   Skipping agent startup (using existing instance)")
            logger.info("="*50)
            return None  # Return None to indicate we're using existing instance
       
        # Get the path to the agent directory (in backend/app/api/v1/aiml/agent/)
        app_dir = Path(__file__).parent  # backend/app/
        agent_dir = app_dir / "api" / "v1" / "aiml" / "agent"
        agent_script = agent_dir / "run.py"
       
        print(f"[AIML Agent] Looking for agent at: {agent_script}")
       
        if not agent_script.exists():
            print(f"[AIML Agent] Agent NOT FOUND at {agent_script}")
            logger.warning(f"AIML agent not found at {agent_script}")
            logger.warning("AIML code execution will not be available")
            return None
       
        print(f"[AIML Agent] Agent found! Starting subprocess...")
       
        logger.info("="*50)
        logger.info("🚀 Starting AIML competency agent...")
        logger.info(f"   Agent directory: {agent_dir}")
        logger.info(f"   Python: {sys.executable}")
       
        # Check if agent dependencies are installed by checking requirements file
        requirements_file = agent_dir / "requirements.txt"
        if requirements_file.exists():
            logger.info(f"   Dependencies: {requirements_file}")
        else:
            logger.warning(f"   Requirements file not found: {requirements_file}")
            logger.warning("   AIML agent may fail if dependencies are missing")
       
        # Create log file for agent output
        log_dir = agent_dir / "logs"
        log_dir.mkdir(exist_ok=True)
        agent_log_file = log_dir / "agent.log"
       
        # Open log file for writing
        aiml_agent_log_file = open(agent_log_file, "w", buffering=1)
       
        # Start the agent as a subprocess (NO new console window)
        # Output goes to log file instead
        if sys.platform == 'win32':
            # Windows: Run in background without console
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
           
            aiml_agent_process = subprocess.Popen(
                [sys.executable, "run.py"],
                cwd=str(agent_dir),
                stdout=aiml_agent_log_file,
                stderr=subprocess.STDOUT,
                startupinfo=startupinfo,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        else:
            # Linux/Mac: Run in background
            aiml_agent_process = subprocess.Popen(
                [sys.executable, "run.py"],
                cwd=str(agent_dir),
                stdout=aiml_agent_log_file,
                stderr=subprocess.STDOUT
            )
       
        # Give it a moment to start and bind to the port
        import time
        time.sleep(2)  # Increased wait time for port binding
       
        # Check if it's still running
        if aiml_agent_process.poll() is None:
            print(f"[AIML Agent] ✅ Agent started successfully (PID: {aiml_agent_process.pid})")
            print(f"[AIML Agent] WebSocket: ws://127.0.0.1:8889")
            logger.info(f"✅ AIML agent started successfully (PID: {aiml_agent_process.pid})")
            logger.info(f"   WebSocket: ws://127.0.0.1:8889")
            logger.info(f"   Logs: {agent_log_file}")
            logger.info("="*50)
            return aiml_agent_process
        else:
            print(f"[AIML Agent] ❌ Agent failed to start (exit code: {aiml_agent_process.returncode})")
            logger.error(f"❌ AIML agent failed to start (exit code: {aiml_agent_process.returncode})")
            logger.error(f"   Check logs: {agent_log_file}")
            if aiml_agent_log_file:
                aiml_agent_log_file.close()
                aiml_agent_log_file = None
            # Read and display last few lines of log
            port_in_use = False
            try:
                with open(agent_log_file, 'r') as f:
                    lines = f.readlines()
                    if lines:
                        # Check for port already in use error
                        log_content = ''.join(lines)
                        if '10048' in log_content or 'address already in use' in log_content.lower() or 'only one usage of each socket' in log_content.lower():
                            port_in_use = True
                            logger.warning("   ⚠️  Port 8889 is already in use")
                            logger.info("   ℹ️  This usually means the agent is already running")
                            logger.info("   ℹ️  The existing agent instance will be used")
                            logger.info("="*50)
                            return None  # Return None but don't treat as error
                        else:
                            logger.error("   Last error:")
                            for line in lines[-5:]:
                                logger.error(f"   {line.rstrip()}")
            except:
                pass
           
            if not port_in_use:
                logger.warning("AIML code execution will not be available")
            return None
       
    except Exception as e:
        print(f"[AIML Agent] ❌ Exception: {str(e)}")
        logger.error(f"❌ Failed to start AIML agent: {str(e)}")
        logger.exception("Full traceback:")
        logger.warning("AIML code execution will not be available")
        return None
 
 
def stop_aiml_agent():
    """Stop the AIML competency agent subprocess."""
    global aiml_agent_process, aiml_agent_log_file
   
    if aiml_agent_process:
        try:
            logger.info("Stopping AIML competency agent...")
            aiml_agent_process.terminate()
            try:
                aiml_agent_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Agent did not terminate gracefully, killing...")
                aiml_agent_process.kill()
            logger.info("✅ AIML agent stopped")
        except Exception as e:
            logger.error(f"Error stopping AIML agent: {str(e)}")
        finally:
            aiml_agent_process = None
   
    # Close log file if open
    if aiml_agent_log_file:
        try:
            aiml_agent_log_file.close()
        except:
            pass
        finally:
            aiml_agent_log_file = None
 
 
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    await connect_to_mongo()
    await connect_to_dsa_mongo()
    await connect_to_aiml_mongo()
   
    # Initialize Redis for assessment context caching
    redis_client = None
    if REDIS_AVAILABLE:
        try:
            settings = get_settings()
            # Parse Redis URL
            redis_url = settings.redis_url
            if redis_url.startswith("redis://"):
                # Extract host, port, db from URL
                # Format: redis://localhost:6379/0
                url_parts = redis_url.replace("redis://", "").split("/")
                host_port = url_parts[0].split(":")
                host = host_port[0] if len(host_port) > 0 else "localhost"
                port = int(host_port[1]) if len(host_port) > 1 else 6379
                db = int(url_parts[1]) if len(url_parts) > 1 else 0
                
                # Try async Redis first
                try:
                    redis_client = redis.Redis(host=host, port=port, db=db, decode_responses=False)
                    # Test connection
                    await redis_client.ping()
                    logger.info(f"✅ Redis connected successfully: {host}:{port}/{db}")
                except Exception as e:
                    logger.warning(f"Async Redis connection failed, trying sync: {e}")
                    # Fallback to sync Redis
                    import redis as redis_sync
                    redis_client = redis_sync.Redis(host=host, port=port, db=db, decode_responses=False)
                    redis_client.ping()
                    logger.info(f"✅ Redis (sync) connected successfully: {host}:{port}/{db}")
                
                # Initialize assessment context cache
                from .api.v1.assessments.services.assessment_cache import init_redis_cache
                init_redis_cache(redis_client)
            else:
                logger.warning(f"Invalid Redis URL format: {redis_url}")
        except Exception as e:
            logger.warning(f"Redis initialization failed: {e}. Assessment caching will be disabled.")
            logger.warning("This is not critical - the app will continue to work without Redis caching.")
            redis_client = None
    
    # Start AIML agent
    start_aiml_agent()
   
    yield
   
    # Shutdown
    stop_aiml_agent()
    
    # Close Redis connection
    if redis_client:
        try:
            if hasattr(redis_client, 'close'):
                if hasattr(redis_client.close, '__call__'):
                    import inspect
                    if inspect.iscoroutinefunction(redis_client.close):
                        await redis_client.close()
                    else:
                        redis_client.close()
            elif hasattr(redis_client, 'aclose'):
                await redis_client.aclose()
            logger.info("✅ Redis connection closed")
        except Exception as e:
            logger.warning(f"Error closing Redis connection: {e}")
    
    await close_aiml_mongo_connection()
    await close_dsa_mongo_connection()
    await close_mongo_connection()
 
 
app = FastAPI(
    title="Aaptor",
    description="Backend API for AI-powered assessment platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,    # Disables /docs
    redoc_url=None    # Disables /redoc 
)
 
# CORS middleware - Secure configuration with specific origins
settings = get_settings()
 
# Parse allowed origins from settings
if settings.cors_origins:
    allowed_origins = [origin.strip() for origin in settings.cors_origins.split(",")]
    # Validate no wildcards in production
    if "*" in allowed_origins:
        logger.warning("⚠️  Wildcard CORS origin detected! This is a security risk.")
else:
    # Fallback to localhost only if not configured
    allowed_origins = ["http://localhost:3000"]
    logger.warning("⚠️  No CORS_ORIGINS configured, using localhost only")
 
logger.info(f"✅ CORS allowed origins: {allowed_origins}")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  # ✅ Specific origins only - no wildcards
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    max_age=600,  # Cache preflight requests for 10 minutes
)
 
# Include routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(assessments.router)
app.include_router(candidate.router)
app.include_router(proctor.router)
app.include_router(proctoring_router)  
app.include_router(custom_mcq_router)
app.include_router(super_admin_router)
app.include_router(assessment_code_execution_router)
 
# Include DSA routers
app.include_router(dsa_tests.router, prefix="/api/v1/dsa/tests", tags=["dsa"])
app.include_router(dsa_questions.router)
app.include_router(dsa_submissions.router)
app.include_router(dsa_assessment.router)
app.include_router(dsa_admin.router)
app.include_router(dsa_run.router)
 
# Include AIML routers
app.include_router(aiml_tests.router, prefix="/api/v1/aiml/tests", tags=["aiml"])
app.include_router(aiml_questions.router)
app.include_router(aiml_assessment.router)
app.include_router(aiml_run.router)
 
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