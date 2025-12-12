# Authentication Endpoints Summary

## Backend Endpoints (FastAPI - `/api/v1/auth`)

### 1. **POST `/api/v1/auth/superadmin-signup`**
   - **Purpose**: Create super admin account (requires email verification)
   - **Request Body**: `{ name, email, password }`
   - **Response**: Verification email sent, account created after verification
   - **Status**: ✅ Implemented

### 2. **POST `/api/v1/auth/org-signup`**
   - **Purpose**: Organization signup via Google OAuth
   - **Request Body**: `{ credential }` (Google OAuth token)
   - **Response**: Account created immediately (Google emails are pre-verified)
   - **Status**: ✅ Implemented

### 3. **POST `/api/v1/auth/org-signup-email`**
   - **Purpose**: Organization signup via email/password (requires email verification)
   - **Request Body**: `{ name, email, password, phone?, country? }`
   - **Response**: Verification email sent, account created after verification
   - **Status**: ✅ Implemented

### 4. **POST `/api/v1/auth/send-verification-code`**
   - **Purpose**: Send email verification code (for existing users or pending signups)
   - **Request Body**: `{ email }`
   - **Response**: Verification code sent to email
   - **Status**: ✅ Implemented

### 5. **POST `/api/v1/auth/verify-email-code`**
   - **Purpose**: Verify email code and create account if pending signup
   - **Request Body**: `{ email, code }`
   - **Response**: Email verified, account created if pending
   - **Status**: ✅ Implemented
   - **Rate Limited**: ✅ Yes (via `@_apply_rate_limit`)

### 6. **POST `/api/v1/auth/login`**
   - **Purpose**: User login with email/password
   - **Request Body**: `{ email, password }`
   - **Response**: `{ token, refreshToken, user }`
   - **Status**: ✅ Implemented
   - **Rate Limited**: ✅ Yes (5 requests/minute)
   - **Features**: Account lockout, failed attempt tracking

### 7. **POST `/api/v1/auth/oauth-login`**
   - **Purpose**: OAuth login (Google, Microsoft, etc.)
   - **Request Body**: `{ email, name, provider, role? }`
   - **Response**: `{ token, refreshToken, user }`
   - **Status**: ✅ Implemented
   - **Rate Limited**: ✅ Yes (5 requests/minute)

### 8. **POST `/api/v1/auth/refresh-token`**
   - **Purpose**: Refresh access token using refresh token
   - **Request Body**: `{ refreshToken }`
   - **Response**: `{ token, refreshToken }`
   - **Status**: ✅ Implemented

---

## Frontend API Routes (Next.js - `/api/auth`)

### 1. **`/api/auth/[...nextauth]`** (NextAuth Handler)
   - **Purpose**: NextAuth.js authentication handler
   - **Providers**: 
     - Credentials (email/password)
     - Google OAuth
     - Azure AD OAuth
   - **Backend Calls**:
     - `POST /api/v1/auth/login` (for credentials)
     - `POST /api/v1/auth/oauth-login` (for OAuth)
     - `POST /api/v1/auth/refresh-token` (for token refresh)
   - **Status**: ✅ Implemented

### 2. **POST `/api/auth/signup`**
   - **Purpose**: Organization email signup
   - **Request Body**: `{ name, email, password }`
   - **Backend Call**: `POST /api/v1/auth/org-signup-email`
   - **Status**: ✅ Implemented

### 3. **POST `/api/auth/send-verification-code`**
   - **Purpose**: Send email verification code
   - **Request Body**: `{ email }`
   - **Backend Call**: `POST /api/v1/auth/send-verification-code`
   - **Status**: ✅ Implemented

### 4. **POST `/api/auth/verify-email-code`**
   - **Purpose**: Verify email code
   - **Request Body**: `{ email, code }`
   - **Backend Call**: `POST /api/v1/auth/verify-email-code`
   - **Status**: ✅ Implemented

---

## Missing Frontend Routes

The following backend endpoints don't have direct frontend API routes (they may be called directly or through NextAuth):

- ❌ `/api/auth/superadmin-signup` - No frontend route (may be called directly)
- ❌ `/api/auth/org-signup` - No frontend route (handled via NextAuth Google provider)
- ❌ `/api/auth/refresh-token` - No frontend route (handled via NextAuth callbacks)

---

## Verification Checklist

- ✅ All backend endpoints are properly defined
- ✅ All frontend routes proxy to correct backend endpoints
- ✅ NextAuth handler integrates with backend OAuth login
- ✅ Rate limiting is applied to sensitive endpoints
- ✅ Error handling is consistent across all routes
- ✅ Token refresh is handled via NextAuth callbacks

---

## Notes

1. **Super Admin Signup**: May need a dedicated frontend route if admin panel requires it
2. **OAuth Signup**: Handled automatically via NextAuth providers
3. **Token Refresh**: Handled in NextAuth JWT callback, not as a separate API route
4. **Rate Limiting**: Applied to login and verify-email-code endpoints







