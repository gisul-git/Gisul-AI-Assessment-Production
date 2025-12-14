import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    
    // Explicitly allow MediaPipe static assets to pass through without auth
    if (pathname.startsWith('/mediapipe/')) {
      return NextResponse.next();
    }
    
    // Middleware logic can be added here if needed
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Protect all routes except public ones
        const { pathname } = req.nextUrl;
        
        // Public routes that don't require authentication
        const publicRoutes = [
          "/",
          "/auth/signin",
          "/auth/signup",
          "/super-admin/mfa",  // MFA page - user is in the middle of login flow
          "/api/auth",
          "/api/assessment",
          "/api/proctor",  // Proctoring API routes (validated server-side)
          "/mediapipe",  // MediaPipe static assets (JS, WASM, data files)
        ];
        
        // MediaPipe static assets should always be public
        if (pathname.startsWith('/mediapipe/')) {
          return true;
        }
        
        // Check if route is public
        const isPublicRoute = publicRoutes.some(route => 
          pathname === route || pathname.startsWith(route + "/")
        );
        
        // Allow public routes
        if (isPublicRoute) {
          return true;
        }
        
        // Candidate assessment routes (use token from URL, not session)
        if (pathname.startsWith("/assessment/")) {
          return true; // These routes have their own token-based auth
        }

        // Candidate precheck routes (use token from URL, not session)
        if (pathname.startsWith("/precheck/")) {
          return true; // These routes have their own token-based auth
        }

        // DSA test routes (use token from URL, not session)
        if (pathname.startsWith("/test/")) {
          return true; // These routes have their own token-based auth
        }

        // Candidate-facing API routes should remain public (token validated server-side)
        if (pathname.startsWith("/api/assessment/")) {
          return true;
        }
        
        // Proctoring API routes - public (candidates aren't logged in via NextAuth)
        if (pathname.startsWith("/api/proctor/")) {
          return true;
        }
        
        // All other routes require authentication
        return !!token;
      },
    },
    pages: {
      signIn: "/auth/signin",
    },
  }
);

// Configure which routes to protect
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/auth (NextAuth routes)
     * - api/assessment (Candidate assessment API)
     * - api/proctor (Proctoring API - candidates aren't logged in)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - mediapipe/ (MediaPipe assets - static files) - MUST be excluded
     * - public files (public folder) - files with extensions are auto-excluded
     */
    "/((?!api/auth|api/assessment|api/proctor|_next/static|_next/image|favicon.ico|mediapipe/).*)",
  ],
};

