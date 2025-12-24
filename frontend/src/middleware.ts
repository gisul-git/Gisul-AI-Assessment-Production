import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    
    // Skip middleware for MediaPipe assets (static files)
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
        
        // Skip auth for MediaPipe assets
        if (pathname.startsWith('/mediapipe/')) {
          return true;
        }
        
        // Public routes that don't require authentication
        const publicRoutes = [
          "/",
          "/auth/signin",
          "/auth/signup",
          "/super-admin/mfa",  // MFA page - user is in the middle of login flow
          "/api/auth",
          "/api/assessment",
          "/api/proctor",  // Proctoring API routes (validated server-side)
        ];
        
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

        // Custom MCQ assessment routes (use token from URL, not session)
        if (pathname.startsWith("/custom-mcq/entry/") || 
            pathname.startsWith("/custom-mcq/take/") ||
            pathname.startsWith("/custom-mcq/result/")) {
          return true; // These routes have their own token-based auth
        }

        // Candidate-facing API routes should remain public (token validated server-side)
        if (pathname.startsWith("/api/assessment/")) {
          return true;
        }
        
        // Custom MCQ API routes - public (candidates aren't logged in via NextAuth, token validated server-side)
        if (pathname.startsWith("/api/v1/custom-mcq/verify-candidate") ||
            pathname.startsWith("/api/v1/custom-mcq/take/") ||
            pathname.startsWith("/api/v1/custom-mcq/submit") ||
            pathname.startsWith("/api/custom-mcq/take/")) {
          return true;
        }
        
        // Proctoring API routes - public (candidates aren't logged in via NextAuth)
        if (pathname.startsWith("/api/proctor/")) {
          return true;
        }

  // Custom MCQ assessment routes (use token from URL, not session)
        if (pathname.startsWith("/custom-mcq/entry/") ||
            pathname.startsWith("/custom-mcq/take/") ||
            pathname.startsWith("/custom-mcq/result/")) {
          return true; // These routes have their own token-based auth
        }
 
        // Candidate-facing API routes should remain public (token validated server-side)
        if (pathname.startsWith("/api/assessment/")) {
          return true;
        }
       
        // Custom MCQ API routes - public (candidates aren't logged in via NextAuth, token validated server-side)
        if (pathname.startsWith("/api/v1/custom-mcq/verify-candidate") ||
            pathname.startsWith("/api/v1/custom-mcq/take/") ||
            pathname.startsWith("/api/v1/custom-mcq/submit") ||
            pathname.startsWith("/api/custom-mcq/take/")) {
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
     * - mediapipe (MediaPipe assets)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!api/auth|api/assessment|api/proctor|mediapipe|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|wasm|data|binarypb)$).*)",
  ],
};

