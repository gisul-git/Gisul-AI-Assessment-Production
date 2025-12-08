# Backend Server Restart Instructions

## Issue
The backend server is returning 404 for `/api/v1/auth/login` because it hasn't reloaded the updated routes.

## Solution
**You need to restart your FastAPI backend server** for the auth route fixes to take effect.

## Steps to Restart

### Option 1: If running with uvicorn directly
1. Stop the server (Ctrl+C in the terminal where it's running)
2. Restart it:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

### Option 2: If running with Python module
1. Stop the server (Ctrl+C)
2. Restart it:
   ```bash
   cd backend
   python -m app
   ```

### Option 3: If running in VS Code or IDE
1. Stop the running process
2. Restart the debugger/runner

## Verify It's Working

After restarting, you should see in the server logs:
- Routes being registered
- No import errors
- Server starting successfully

Then test the login endpoint:
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'
```

You should get a 401 (unauthorized) or 400 (bad request) response, **NOT a 404**.

## What Was Fixed

1. ✅ `backend/app/api/v1/__init__.py` - Added proper module exports
2. ✅ `backend/app/core/dependencies.py` - Fixed OAuth2PasswordBearer token URL path
3. ✅ Auth router is properly included in `main.py`

All routes are correctly registered in the code. The server just needs to reload them.

