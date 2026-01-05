import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { GetServerSideProps } from "next";
import { requireAuth } from "../lib/auth";
import Link from "next/link";
import Image from "next/image";
import axios from "@/lib/axios-config"; // Use configured axios with auth interceptor
import dsaApi from "../lib/dsa/api";
import aimlApi from "../lib/aiml/api";
import DashboardCard from "../components/DashboardCard";

interface Assessment {
  id: string;
  title: string;
  status?: string; // Optional - hook determines status from is_published/status field
  hasSchedule: boolean;
  scheduleStatus?: {
    startTime?: string;
    endTime?: string;
    duration?: number;
    isActive?: boolean;
  } | null;
  createdAt?: string;
  updatedAt?: string;
  type?: 'assessment' | 'dsa' | 'custom_mcq' | 'aiml'; // Add type to distinguish
  isDraft?: boolean; // Add isDraft to interface
  // Fields for DSA/AIML/Custom MCQ
  is_published?: boolean;
  is_active?: boolean;
  pausedAt?: string;
}

interface DashboardPageProps {
  session: any;
}

export default function DashboardPage({ session: serverSession }: DashboardPageProps) {
  const { data: session, update: updateSession } = useSession();
  const router = useRouter();
  
  // Use server session if available, fallback to client session
  const activeSession = serverSession || session;
  
  // Check if user is super_admin - show back button for super admins
  const isSuperAdmin = Boolean(activeSession && (activeSession as any)?.user?.role === "super_admin");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [cloneModal, setCloneModal] = useState<{ show: boolean; assessmentId: string | null; assessmentTitle: string; newTitle: string }>({
    show: false,
    assessmentId: null,
    assessmentTitle: "",
    newTitle: "",
  });
  const [cloning, setCloning] = useState(false);
  // Store recently cloned assessments to preserve them across refetches
  const recentlyClonedRef = useRef<Map<string, Assessment>>(new Map());


  useEffect(() => {
    // Close profile dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showProfile && !target.closest('[data-profile-dropdown]')) {
        setShowProfile(false);
      }
      if (openMenuId && !target.closest(`[data-menu-id="${openMenuId}"]`)) {
        setOpenMenuId(null);
      }
    };

    if (showProfile || openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showProfile, openMenuId]);

  useEffect(() => {
    // Listen for token refresh events from the interceptor
    const handleTokenRefresh = async (event: Event) => {
      const customEvent = event as CustomEvent<{ backendToken: string; refreshToken: string }>;
      const { backendToken, refreshToken } = customEvent.detail;
      try {
        await updateSession({
          backendToken,
          refreshToken,
        });
        // Refetch assessments after session update
        setTimeout(() => {
          fetchAssessments();
        }, 300);
      } catch (err) {
        console.error("Failed to update NextAuth session:", err);
      }
    };

    window.addEventListener("token-refreshed", handleTokenRefresh);

    // Check if session has backendToken, if not try to refresh
    if (session?.user && !session.backendToken) {
      // Trigger a session update to re-run the JWT callback
      updateSession().then(() => {
        // Wait a bit for session to update, then fetch
        setTimeout(() => {
          fetchAssessments();
        }, 500);
      }).catch((err) => {
        console.error("Failed to update session:", err);
        fetchAssessments(); // Try anyway
      });
    } else {
      fetchAssessments();
    }

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefresh);
    };
  }, [session, updateSession]);

  // Refresh assessments when refresh query param is present
  useEffect(() => {
    if (router.query.refresh) {
      // Force fresh fetch from API
      fetchAssessments();
      // Remove refresh param from URL
      router.replace('/dashboard', undefined, { shallow: true });
    }
  }, [router.query.refresh]);

  const fetchAssessments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // CRITICAL: Clear any cached/stale assessments first
      setAssessments([]);
      
      // Get current user ID - try multiple sources
      const currentUserId = (session?.user as any)?.id || (activeSession?.user as any)?.id;
      console.log(`[Dashboard] Fetching assessments for user_id: ${currentUserId}`);
      console.log(`[Dashboard] Session user:`, session?.user);
      console.log(`[Dashboard] Active session user:`, activeSession?.user);
      
      if (!currentUserId) {
        console.error("[Dashboard] CRITICAL: No user ID found in session - cannot filter DSA tests securely");
      }
      
      // Fetch regular assessments, DSA tests, AIML tests, and custom MCQ tests in parallel
      // CRITICAL: DSA/AIML tests endpoint filters by created_by automatically via authentication
      const [assessmentsResponse, dsaTestsResponse, aimlTestsResponse, customMcqResponse] = await Promise.allSettled([
        axios.get("/api/assessments/list"),
        dsaApi.get("/tests/", { params: { active_only: false } }),  // Explicit trailing slash and params
        aimlApi.get("/tests/"),  // Fetch AIML tests
        axios.get("/api/custom-mcq/list")
      ]);
      
      const allAssessments: Assessment[] = [];
      
      // Process regular assessments
      if (assessmentsResponse.status === 'fulfilled' && assessmentsResponse.value.data?.success && assessmentsResponse.value.data?.data) {
        const regularAssessments = assessmentsResponse.value.data.data.map((a: any) => ({
          ...a,
          type: 'assessment' as const
        }));
        allAssessments.push(...regularAssessments);
      } else if (assessmentsResponse.status === 'rejected') {
        console.error("Error fetching regular assessments:", assessmentsResponse.reason);
      }
      
      // Process custom MCQ tests
      if (customMcqResponse.status === 'fulfilled' && customMcqResponse.value.data?.success && customMcqResponse.value.data.data?.assessments) {
        const assessmentsList = Array.isArray(customMcqResponse.value.data.data.assessments) 
          ? customMcqResponse.value.data.data.assessments 
          : [];
        const customMcqTests = assessmentsList.map((test: any) => {
          // Determine status: pausedAt > status field (similar to DSA)
          let status = 'draft';
          if (test.pausedAt) {
            status = 'paused';
          } else {
            status = test.status || 'draft';
          }
          const isDraft = status === 'draft';
          
          // Check if schedule exists (startTime and endTime in schedule object or direct fields)
          const schedule = test.schedule || {};
          const hasSchedule = !!(schedule.startTime || schedule.endTime || test.startTime || test.endTime);
          const scheduleStatus = hasSchedule ? {
            startTime: schedule.startTime || test.startTime,
            endTime: schedule.endTime || test.endTime,
            duration: schedule.duration || test.duration,
            isActive: status === 'active', // Active if status is active (not paused)
          } : null;
          
          return {
            id: test.id,
            title: test.title || 'Untitled Custom MCQ/Subjective Test',
            status: status as 'draft' | 'active' | 'paused',
            isDraft: isDraft,
            hasSchedule: hasSchedule,
            scheduleStatus: scheduleStatus,
            createdAt: test.createdAt,
            updatedAt: test.updatedAt || test.createdAt,
            type: 'custom_mcq' as const,
            pausedAt: test.pausedAt, // Store pausedAt for reference
          };
        });
        allAssessments.push(...customMcqTests);
        console.log(`[Dashboard] Loaded ${customMcqTests.length} custom MCQ tests`, customMcqTests);
      } else if (customMcqResponse.status === 'rejected') {
        console.error("Error fetching custom MCQ tests:", customMcqResponse.reason);
      } else {
        console.warn("[Dashboard] Custom MCQ response structure unexpected:", customMcqResponse.status === 'fulfilled' ? customMcqResponse.value.data : 'rejected');
      }
      
      // Process DSA tests
      if (dsaTestsResponse.status === 'fulfilled' && Array.isArray(dsaTestsResponse.value.data)) {
        const rawDsaTests = dsaTestsResponse.value.data;
        console.log(`[Dashboard] Received ${rawDsaTests.length} DSA tests from backend`);
        console.log(`[Dashboard] Raw DSA tests:`, rawDsaTests.map((t: any) => ({ id: t.id, title: t.title, created_by: t.created_by })));
        
        // CRITICAL SECURITY: Client-side filter to ensure we only show tests that belong to current user
        // This is a defense-in-depth measure - backend should already filter, but this ensures safety
        if (!currentUserId) {
          console.error("[Dashboard] SECURITY: No user ID available - NOT showing any DSA tests (fail secure)");
        } else {
          const dsaTests = rawDsaTests
            .filter((test: any) => {
              const testCreatedBy = test.created_by;
              if (!testCreatedBy) {
                console.warn(`[Dashboard] SECURITY: Test ${test.id || test._id} has no created_by field - hiding it`);
                return false;
              }
              
              if (!currentUserId) {
                console.warn(`[Dashboard] SECURITY: Cannot verify ownership - hiding test ${test.id || test._id}`);
                return false;
              }
              
              const testCreatedByStr = String(testCreatedBy).trim();
              const currentUserIdStr = String(currentUserId).trim();
              const matches = testCreatedByStr === currentUserIdStr;
              
              if (!matches) {
                console.error(`[Dashboard] SECURITY: Filtered out test ${test.id || test._id} (${test.title}) - created_by='${testCreatedByStr}' != user_id='${currentUserIdStr}'`);
              } else {
                console.log(`[Dashboard] Test ${test.id || test._id} (${test.title}) belongs to current user - showing it`);
              }
              
              return matches;
            })
            .map((test: any) => {
              // Determine status: paused > published > draft
              let status = 'draft';
              if (test.pausedAt) {
                status = 'paused';
              } else if (test.is_published) {
                status = 'active'; // Use 'active' instead of 'published' to match AI assessment pattern
              }
              
              // For DSA: if schedule is None/null, there's no schedule even if start_time/end_time exist
              // (backend sets default start_time/end_time even when keepSchedule: false)
              const schedule = test.schedule;
              const hasSchedule = schedule !== null && schedule !== undefined && !!(test.start_time && test.end_time);
              
              return {
                id: test.id || test._id,
                title: test.title || 'Untitled DSA Test',
                status: status as 'draft' | 'active' | 'paused',
                hasSchedule: hasSchedule,
                scheduleStatus: hasSchedule ? {
                  startTime: test.start_time,
                  endTime: test.end_time,
                  duration: test.duration_minutes || 0,
                  isActive: test.is_active || false
                } : null,
                createdAt: test.created_at || null,
                updatedAt: test.updated_at || null,
                type: 'dsa' as const,
                is_published: test.is_published,
                is_active: test.is_active,
                pausedAt: test.pausedAt
              };
            });
          allAssessments.push(...dsaTests);
          console.log(`[Dashboard] Loaded ${dsaTests.length} DSA tests for current user (filtered from ${rawDsaTests.length} total from backend)`);
        }
      } else if (dsaTestsResponse.status === 'rejected') {
        console.error("Error fetching DSA tests:", dsaTestsResponse.reason);
        console.error("DSA tests response error details:", dsaTestsResponse.reason?.response?.data);
      }
      
      // Process AIML tests
      if (aimlTestsResponse.status === 'fulfilled' && Array.isArray(aimlTestsResponse.value.data)) {
        const rawAimlTests = aimlTestsResponse.value.data;
        console.log(`[Dashboard] Received ${rawAimlTests.length} AIML tests from backend`);
        
        // CRITICAL SECURITY: Client-side filter to ensure we only show tests that belong to current user
        if (!currentUserId) {
          console.error("[Dashboard] SECURITY: No user ID available - NOT showing any AIML tests (fail secure)");
        } else {
          const aimlTests = rawAimlTests
            .filter((test: any) => {
              const testCreatedBy = test.created_by;
              if (!testCreatedBy) {
                console.warn(`[Dashboard] SECURITY: AIML Test ${test.id || test._id} has no created_by field - hiding it`);
                return false;
              }
              
              const testCreatedByStr = String(testCreatedBy).trim();
              const currentUserIdStr = String(currentUserId).trim();
              const matches = testCreatedByStr === currentUserIdStr;
              
              if (!matches) {
                console.error(`[Dashboard] SECURITY: Filtered out AIML test ${test.id || test._id} (${test.title}) - created_by='${testCreatedByStr}' != user_id='${currentUserIdStr}'`);
              } else {
                console.log(`[Dashboard] AIML Test ${test.id || test._id} (${test.title}) belongs to current user - showing it`);
              }
              
              return matches;
            })
            .map((test: any) => {
              // Extract schedule information (same logic as DSA)
              // For AIML: if schedule is None/null, there's no schedule even if start_time/end_time exist
              // (backend sets default start_time/end_time even when keepSchedule: false)
              const schedule = test.schedule;
              const hasSchedule = schedule !== null && schedule !== undefined && !!(test.start_time && test.end_time);
              
              return {
                id: test.id || test._id,
                title: test.title || 'Untitled AIML Test',
                hasSchedule: hasSchedule,
                scheduleStatus: hasSchedule ? {
                  startTime: test.start_time,
                  endTime: test.end_time,
                  duration: schedule?.duration || test.duration_minutes || 0,
                  isActive: test.is_published || false
                } : null,
                createdAt: test.created_at || null,
                updatedAt: test.updated_at || null,
                type: 'aiml' as const,
                is_published: test.is_published,
                is_active: test.is_active,
                pausedAt: test.pausedAt
                // Note: status field is NOT set here - the hook determines it from is_published/pausedAt
              };
            });
          allAssessments.push(...aimlTests);
          console.log(`[Dashboard] Loaded ${aimlTests.length} AIML tests for current user (filtered from ${rawAimlTests.length} total from backend)`);
        }
      } else if (aimlTestsResponse.status === 'rejected') {
        console.error("Error fetching AIML tests:", aimlTestsResponse.reason);
        console.error("AIML tests response error details:", aimlTestsResponse.reason?.response?.data);
      }
      
      // Sort by creation date (newest first)
      allAssessments.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      // Preserve recently cloned assessments - always add them to ensure visibility
      // Only remove from ref if we can confirm they're definitely in the server response
      const clonedAssessmentsToAdd: Assessment[] = [];
      const clonedIdsToRemove: string[] = [];
      
      recentlyClonedRef.current.forEach((clonedAssessment: Assessment, clonedId: string) => {
        // Check if this cloned assessment is already in the fetched list
        // Compare IDs as strings to handle any format differences
        const clonedIdStr = String(clonedId).trim();
        const existsInFetched = allAssessments.find(a => {
          const aId = String(a.id || (a as any)._id || "").trim();
          const matches = aId === clonedIdStr;
          return matches;
        });
        
        if (existsInFetched) {
          // Found in server response - it's now persisted
          // BUT: Keep it in ref for a few more refetches to ensure it stays visible
          // Only remove from ref after we've seen it in server response consistently
          console.log(`[Dashboard] Cloned assessment ${clonedIdStr} (${clonedAssessment.title}) found in server response`);
          // Don't remove from ref immediately - keep it for safety
          // The assessment from server will be used, but we keep the ref as backup
        } else {
          // Not in server response - preserve it by adding to the list
          console.log(`[Dashboard] Preserving cloned assessment ${clonedIdStr} (${clonedAssessment.title}) - not in server response`);
          console.log(`[Dashboard] Looking for ID: "${clonedIdStr}"`);
          console.log(`[Dashboard] Available IDs:`, allAssessments.map(a => `"${String(a.id || (a as any)._id || "")}"`));
          clonedAssessmentsToAdd.push(clonedAssessment);
        }
      });
      
      // Start with server-fetched assessments
      const finalAssessments = [...allAssessments];
      
      // Add cloned assessments that aren't already present (at the beginning)
      clonedAssessmentsToAdd.forEach(clonedAssessment => {
        const clonedId = String(clonedAssessment.id || "").trim();
        const alreadyExists = finalAssessments.find(a => {
          const aId = String(a.id || (a as any)._id || "").trim();
          return aId === clonedId;
        });
        
        if (!alreadyExists) {
          console.log(`[Dashboard] Adding cloned assessment ${clonedId} (${clonedAssessment.title}) to final list`);
          finalAssessments.unshift(clonedAssessment); // Add at beginning
        } else {
          console.log(`[Dashboard] Cloned assessment ${clonedId} already in final list, skipping duplicate`);
        }
      });
      
      // Don't remove from ref immediately - keep cloned assessments in ref for safety
      // They'll be automatically handled: if in server response, use that; if not, use from ref
      // This ensures cloned assessments always stay visible
      
      // Re-sort to ensure proper order
      finalAssessments.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      setAssessments(finalAssessments);
    } catch (err: any) {
      console.error("Error fetching assessments:", err);
      const errorMsg = err.response?.data?.message || err.response?.data?.detail || err.message || "Failed to load assessments";
      
      // If it's a 401, the interceptor should handle token refresh automatically
      // But if it still fails, show the error
      if (err.response?.status === 401) {
        setError("Session expired. Please refresh the page or sign in again.");
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAssessment = async (assessmentId: string, assessmentTitle: string, assessmentType?: 'assessment' | 'dsa' | 'custom_mcq' | 'aiml') => {
    if (!confirm(`Are you sure you want to delete "${assessmentTitle}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      
      if (assessmentType === 'dsa') {
        // Delete DSA test
        await dsaApi.delete(`/tests/${assessmentId}`);
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
      } else if (assessmentType === 'aiml') {
        // Delete AIML test
        await aimlApi.delete(`/tests/${assessmentId}`);
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
      } else if (assessmentType === 'custom_mcq') {
        // Delete custom MCQ test
        const response = await axios.delete(`/api/custom-mcq/${assessmentId}`);
        if (response.data?.success) {
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
        } else {
          setError(response.data?.message || "Failed to delete custom MCQ/Subjective test");
        }
      } else {
        // Delete regular assessment
      const response = await axios.delete(`/api/assessments/delete-assessment?assessmentId=${assessmentId}`);
      if (response.data?.success) {
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
      } else {
        setError(response.data?.message || "Failed to delete assessment");
        }
      }
    } catch (err: any) {
      console.error("Error deleting assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to delete assessment");
    }
  };

  const handlePauseAssessment = async (assessmentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(null);
    
    try {
      setError(null);
      // Find the assessment to determine its type
      const assessment = assessments.find(a => a.id === assessmentId);
      const assessmentType = assessment?.type || 'assessment';
      
      let response: any;
      
      // Use different endpoints based on assessment type
      if (assessmentType === 'custom_mcq') {
        response = await axios.post(`/api/custom-mcq/pause?assessmentId=${assessmentId}`);
      } else if (assessmentType === 'aiml') {
        // Use AIML API client directly
        response = await aimlApi.post(`/tests/${assessmentId}/pause`);
        response = { data: response.data }; // Normalize response format
      } else if (assessmentType === 'dsa') {
        // Use DSA API client directly
        response = await dsaApi.post(`/tests/${assessmentId}/pause`);
        response = { data: response.data }; // Normalize response format
      } else {
        // Regular assessment
        response = await axios.post(`/api/assessments/pause?assessmentId=${assessmentId}`);
      }
      
      // Handle both response formats (with or without success wrapper)
      const updatedAssessment = response.data?.data?.assessment || response.data?.data || response.data?.assessment || response.data;
      
      if (updatedAssessment || response.data?.success !== false) {
        // For AIML, DSA, and Custom MCQ, paused status is determined by pausedAt field
        // For other assessments, use the status from response
        let finalStatus: "active" | "scheduled" | "draft" | "paused" = updatedAssessment?.status || 'paused' as const;
        if (assessmentType === 'aiml' || assessmentType === 'dsa' || assessmentType === 'custom_mcq') {
          // For AIML/DSA/Custom MCQ tests, if paused, status should be 'paused'
          finalStatus = 'paused';
        }
        
        // Update the assessment in the list immediately
        setAssessments(prev => prev.map(a => 
          a.id === assessmentId 
            ? { 
                ...a, 
                status: finalStatus,
                pausedAt: (updatedAssessment?.pausedAt || new Date().toISOString()) as any
              }
            : a
        ));
        
        // Show success toast
        alert("Assessment paused — current candidates may continue; new entrants are blocked");
      } else {
        setError(response.data?.message || "Failed to pause assessment");
      }
    } catch (err: any) {
      console.error("Error pausing assessment:", err);
      setError(err.response?.data?.detail || err.response?.data?.message || err.message || "Failed to pause assessment");
    }
  };

  const handleResumeAssessment = async (assessmentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(null);
    
    try {
      setError(null);
      // Find the assessment to determine its type
      const assessment = assessments.find(a => a.id === assessmentId);
      const assessmentType = assessment?.type || 'assessment';
      
      let response: any;
      
      // Use different endpoints based on assessment type
      if (assessmentType === 'custom_mcq') {
        response = await axios.post(`/api/custom-mcq/resume?assessmentId=${assessmentId}`);
      } else if (assessmentType === 'aiml') {
        // Use AIML API client directly
        response = await aimlApi.post(`/tests/${assessmentId}/resume`);
        response = { data: response.data }; // Normalize response format
      } else if (assessmentType === 'dsa') {
        // Use DSA API client directly
        response = await dsaApi.post(`/tests/${assessmentId}/resume`);
        response = { data: response.data }; // Normalize response format
      } else {
        // Regular assessment
        response = await axios.post(`/api/assessments/resume?assessmentId=${assessmentId}`);
      }
      
      // Handle both response formats (with or without success wrapper)
      const updatedAssessment = response.data?.data?.assessment || response.data?.data || response.data?.assessment || response.data;
      const newStatus = updatedAssessment?.status || 'active';
      
      if (updatedAssessment || response.data?.success !== false) {
        // Determine the correct status after resume
        // For AIML, DSA, and Custom MCQ, resumed means active
        let finalStatus: "active" | "scheduled" | "draft" | "paused" = newStatus as "active" | "scheduled";
        if (assessmentType === 'aiml' || assessmentType === 'dsa' || assessmentType === 'custom_mcq') {
          // For AIML/DSA/Custom MCQ tests, resumed means active
          finalStatus = 'active';
        }
        
        // Update the assessment in the list immediately
        setAssessments(prev => prev.map(a => 
          a.id === assessmentId 
            ? { 
                ...a, 
                status: finalStatus,
                resumeAt: updatedAssessment?.resumeAt || new Date().toISOString(),
                pausedAt: undefined as any
              }
            : a
        ));
        
        // Show success toast
        alert("Assessment resumed");
      } else {
        setError(response.data?.message || "Failed to resume assessment");
      }
    } catch (err: any) {
      console.error("Error resuming assessment:", err);
      setError(err.response?.data?.detail || err.response?.data?.message || err.message || "Failed to resume assessment");
    }
  };

  const handleCloneAssessment = async (assessmentId: string, newTitle: string) => {
    if (!newTitle || newTitle.trim().length < 3) {
      setError("Assessment name must be at least 3 characters");
      return;
    }

    setCloning(true);
    setError(null);
    
    try {
      // Find the original assessment to get its type
      const originalAssessment = assessments.find(a => a.id === assessmentId);
      const assessmentType = originalAssessment?.type || 'assessment';
      
      let response: any;
      if (assessmentType === 'dsa') {
        // DSA has its own backend clone endpoint
        const r = await dsaApi.post(`/tests/${assessmentId}/clone`, {
          newTitle: newTitle.trim(),
          keepSchedule: false,
          keepCandidates: false,
        });
        response = { data: r.data }; // normalize
      } else if (assessmentType === 'aiml') {
        // AIML has its own backend clone endpoint
        const r = await aimlApi.post(`/tests/${assessmentId}/clone`, {
          newTitle: newTitle.trim(),
          keepSchedule: false,
          keepCandidates: false,
        });
        response = { data: r.data }; // normalize
      } else {
        // Regular assessments and custom_mcq use Next.js API routes
        const endpoint = assessmentType === 'custom_mcq' 
          ? `/api/custom-mcq/clone?assessmentId=${assessmentId}`
          : `/api/assessments/clone?assessmentId=${assessmentId}`;
        
        response = await axios.post(endpoint, {
          newTitle: newTitle.trim(),
          keepSchedule: false,
          keepCandidates: false,
        });
      }
      
      // Handle response - check both success wrapper and direct response
      const responseData = response.data;
      console.log("[Clone] Full response:", responseData);
      
      // AIML and DSA return data directly, regular assessments wrap it in {assessment: ...}
      let clonedAssessment: any;
      if (assessmentType === 'aiml' || assessmentType === 'dsa') {
        // AIML/DSA: response.data has {message, data: {id, title, ...}}
        clonedAssessment = responseData?.data || responseData;
      } else {
        // Regular assessments: response.data has {success, data: {assessment: {...}}}
        clonedAssessment = responseData?.data?.assessment || responseData?.assessment || responseData?.data;
      }
      
      console.log("[Clone] Cloned assessment data:", clonedAssessment);
      
      // Check success condition - AIML/DSA use 'message', regular assessments use 'success'
      const isSuccess = assessmentType === 'aiml' || assessmentType === 'dsa'
        ? responseData?.message || clonedAssessment?.id
        : responseData?.success !== false;
      
      if (isSuccess && clonedAssessment) {
        // Get the new assessment ID
        const newId = clonedAssessment.id || clonedAssessment._id || responseData?.data?.assessmentId || responseData?.assessmentId;
        console.log("[Clone] New assessment ID:", newId);
        
        if (newId) {
          // Clones should ALWAYS be "draft" with no schedule (keepSchedule: false)
          // Force status to "draft" regardless of what backend returns
          let status: "draft" | "scheduled" | "active" | "paused" | "completed" | "published" = "draft";
          
          // Clones never have schedule since keepSchedule: false
          let hasSchedule = false;
          let scheduleStatus = null;
          
          // For AIML/DSA: ensure is_published is false and no schedule
          // For Regular/Custom MCQ: status is already "draft" from backend, but force it anyway
          
          // Create new assessment object matching the dashboard format
          // Clones are ALWAYS draft with no schedule (keepSchedule: false)
          // For AIML/DSA: Backend may return start_time/end_time even when keepSchedule is false,
          // but we should ignore them and treat as no schedule
          const newAssessment: Assessment = {
            id: String(newId),
            title: clonedAssessment.title || newTitle.trim(),
            status: "draft", // Always draft for clones
            hasSchedule: false, // Always false since keepSchedule: false - ignore backend schedule data
            createdAt: clonedAssessment.created_at || clonedAssessment.createdAt || new Date().toISOString(),
            updatedAt: clonedAssessment.updated_at || clonedAssessment.updatedAt || new Date().toISOString(),
            type: assessmentType,
            scheduleStatus: null, // Always null for clones - ignore start_time/end_time from backend
            // For AIML/DSA: ensure these are set to draft state
            is_published: false, // Clones are never published
            is_active: false, // Clones are never active
            pausedAt: undefined // Clones are never paused
          };
          
          // Close modal first
          setCloneModal({ show: false, assessmentId: null, assessmentTitle: "", newTitle: "" });
          setOpenMenuId(null);
          
          // Store in ref to preserve across refetches
          const clonedIdStr = String(newId);
          recentlyClonedRef.current.set(clonedIdStr, newAssessment);
          console.log("[Clone] Stored cloned assessment in ref for preservation:", clonedIdStr, newAssessment);
          
          // Immediately add cloned assessment to dashboard (optimistic update)
          setAssessments(prev => {
            // Check if already exists to avoid duplicates
            const exists = prev.find(a => a.id === String(newId));
            if (exists) {
              console.log("[Clone] Assessment already in list, skipping duplicate");
              return prev;
            }
            console.log("[Clone] Adding new assessment to dashboard:", newAssessment);
            // Insert at the beginning (newest first)
            return [newAssessment, ...prev];
          });
          
          // Show success toast
          alert("Assessment cloned successfully");
          
          // Don't refetch at all - the optimistic update is sufficient
          // The assessment will appear in the list when the user refreshes or navigates back
          // This ensures the card stays visible and doesn't get cleared by fetchAssessments()
          
          // User stays on dashboard to see the new cloned assessment card
        } else {
          setError("Failed to get cloned assessment ID");
          console.error("[Clone] No assessment ID in response:", responseData);
        }
      } else {
        const errorMsg = responseData?.message || "Failed to clone assessment";
        setError(errorMsg);
        console.error("[Clone] Clone failed:", errorMsg, responseData);
      }
    } catch (err: any) {
      console.error("Error cloning assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to clone assessment");
    } finally {
      setCloning(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":
        return { bg: "#dcfce7", text: "#166534", border: "#10b981" }; // Keep success green
      case "draft":
        return { bg: "rgba(201, 244, 212, 0.2)", text: "#1E5A3B", border: "#C9F4D4" }; // Mint Cream theme
      case "scheduled":
        return { bg: "rgba(201, 244, 212, 0.2)", text: "#1E5A3B", border: "#C9F4D4" }; // Mint Cream theme
      case "active":
        return { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" }; // Keep info blue
      case "paused":
        return { bg: "#fef3c7", text: "#92400e", border: "#f59e0b", icon: "⏸️" }; // Amber/yellow for paused
      case "published":
        return { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" }; // Same as active (info blue)
      case "completed":
        return { bg: "#f3f4f6", text: "#6b7280", border: "#9ca3af" }; // Gray for completed
      default:
        return { bg: "rgba(232, 250, 240, 0.5)", text: "#2D7A52", border: "#A8E8BC" }; // Mint 50/400
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  const fetchUserProfile = async () => {
    // First, try to use session data if available (faster)
    if (activeSession?.user) {
      const sessionUser = activeSession.user as any;
      if (sessionUser.name || sessionUser.email) {
        // Use session data immediately, then fetch full profile in background
        setUserProfile({
          name: sessionUser.name,
          email: sessionUser.email,
          phone: sessionUser.phone,
          country: sessionUser.country,
        });
      }
    }

    try {
      setLoadingProfile(true);
      const response = await axios.get("/api/v1/users/me");
      if (response.data?.success && response.data?.data) {
        setUserProfile(response.data.data);
      }
    } catch (err: any) {
      console.error("Error fetching user profile:", err);
      // If API fails but we have session data, keep using it
      if (!userProfile && activeSession?.user) {
        const sessionUser = activeSession.user as any;
        setUserProfile({
          name: sessionUser.name,
          email: sessionUser.email,
          phone: sessionUser.phone,
          country: sessionUser.country,
        });
      }
    } finally {
      setLoadingProfile(false);
    }
  };

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <header className="enterprise-header">
        <div className="enterprise-header-content">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1, minWidth: 0, marginLeft: "-5rem" }}>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => router.push("/super-admin/dashboard")}
                style={{
                  padding: "0.5rem 1rem",
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "0.5rem",
                  color: "#ffffff",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  transition: "background-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
                }}
                title="Back to Super Admin Dashboard"
              >
                <span>←</span>
                <span>Back to Super Admin</span>
              </button>
            )}
            <Image 
              src="/gisullogo.png" 
              alt="Gisul Logo" 
              width={250} 
              height={100} 
              style={{ 
                objectFit: "contain", 
                height: "auto", 
                maxHeight: "100px",
                width: "auto",
                maxWidth: "200px"
              }}
              priority
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0, position: "relative" }}>
            <button
              type="button"
              onClick={() => {
                const newShowState = !showProfile;
                setShowProfile(newShowState);
                if (newShowState) {
                  // If we don't have profile data or session has more info, fetch it
                  if (!userProfile || (activeSession?.user && !userProfile.phone && !userProfile.country)) {
                    fetchUserProfile();
                  }
                }
              }}
              style={{
                marginTop: 0,
                padding: "0.5rem",
                fontSize: "1.25rem",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                borderRadius: "50%",
                color: "#ffffff",
                width: "40px",
                height: "40px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
              }}
              title={activeSession?.user?.name || activeSession?.user?.email || "Profile"}
            >
              👤
            </button>
            {showProfile && (
              <div
                data-profile-dropdown
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "0.5rem",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                  minWidth: "250px",
                  zIndex: 1000,
                  padding: "1rem",
                }}
              >
                {loadingProfile && !userProfile ? (
                  <div style={{ textAlign: "center", padding: "1rem" }}>Loading...</div>
                ) : userProfile ? (
                  <div>
                    <div style={{ marginBottom: "1rem", paddingBottom: "1rem", borderBottom: "1px solid #e2e8f0" }}>
                      <div style={{ fontWeight: 600, fontSize: "1rem", color: "#1a1625", marginBottom: "0.25rem" }}>
                        {userProfile.name || "User"}
                      </div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>{userProfile.email}</div>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#1e293b", marginBottom: "0.5rem" }}>
                      <div><strong>Phone:</strong> {userProfile.phone || "Not provided"}</div>
                      <div><strong>Country:</strong> {userProfile.country || "Not provided"}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                      className="btn-secondary"
                      style={{
                        width: "100%",
                        marginTop: "0.5rem",
                        padding: "0.5rem 1rem",
                        fontSize: "0.875rem",
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "1rem" }}>Failed to load profile</div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container">
        <div className="card" style={{ 
          marginBottom: "2rem",
          background: "linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)",
          border: "1.5px solid #A8E8BC",
          borderRadius: "1rem",
          boxShadow: "0 4px 12px rgba(168, 232, 188, 0.15)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Header Section */}
            <div style={{ 
              paddingBottom: "1.5rem",
              borderBottom: "2px solid #E8FAF0",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "250px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                    <div style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "0.75rem",
                      backgroundColor: "#2D7A52",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(45, 122, 82, 0.2)",
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </div>
                    <div>
                      <h1 style={{ 
                        margin: 0, 
                        fontSize: "clamp(1.5rem, 4vw, 2rem)", 
                        color: "#1a1625", 
                        fontWeight: 700,
                        lineHeight: 1.2,
                      }}>
                        Assessments Dashboard
                      </h1>
                    </div>
                  </div>
                </div>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.625rem 1rem",
                  backgroundColor: "#E8FAF0",
                  borderRadius: "0.75rem",
                  border: "1px solid #A8E8BC",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2D7A52" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span style={{ 
                    color: "#2D7A52", 
                    fontSize: "0.875rem",
                    fontWeight: 500,
                  }}>
                    {activeSession?.user?.name || activeSession?.user?.email || "User"}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons Section */}
            <div>
              <h3 style={{
                margin: 0,
                marginBottom: "1rem",
                fontSize: "0.875rem",
                color: "#64748b",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}>
                Quick Actions
              </h3>
              <div style={{ display: "flex", gap: "1rem", width: "100%", flexWrap: "wrap" }}>
                <Link 
                  href="/assessments/create-new" 
                  style={{ flex: 1, minWidth: "200px" }}
                  onClick={() => {
                    // Clear any draft from localStorage to ensure a fresh start
                    try {
                      localStorage.removeItem('currentDraftAssessmentId');
                    } catch (err) {
                      console.error("Error clearing draft ID:", err);
                    }
                  }}
                >
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1.5px solid #A8E8BC",
                    borderRadius: "0.75rem",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "0 2px 6px rgba(168, 232, 188, 0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.2)";
                    e.currentTarget.style.borderColor = "#10b981";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(168, 232, 188, 0.1)";
                    e.currentTarget.style.borderColor = "#A8E8BC";
                  }}
                  >
                    <button 
                      type="button" 
                      style={{ 
                        marginTop: 0, 
                        width: "100%",
                        padding: "0.875rem 1.5rem",
                        backgroundColor: "#10b981",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "0.625rem",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.625rem",
                        boxShadow: "0 2px 8px rgba(16, 185, 129, 0.2)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#059669";
                        e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "#10b981";
                        e.currentTarget.style.boxShadow = "0 2px 8px rgba(16, 185, 129, 0.2)";
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                      </svg>
                      Create New Assessment (AI)
                    </button>
                    <p style={{
                      margin: 0,
                      fontSize: "0.8125rem",
                      color: "#64748b",
                      lineHeight: 1.4,
                      textAlign: "center",
                    }}>
                      AI-powered assessment creation with automated question generation
                    </p>
                  </div>
                </Link>
                <div
                  style={{
                    flex: 1,
                    minWidth: "200px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1.5px solid #A8E8BC",
                    borderRadius: "0.75rem",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "0 2px 6px rgba(168, 232, 188, 0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.2)";
                    e.currentTarget.style.borderColor = "#10b981";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(168, 232, 188, 0.1)";
                    e.currentTarget.style.borderColor = "#A8E8BC";
                  }}
                >
                  <button
                    type="button"
                    onClick={() => router.push("/custom-mcq/create")}
                    style={{
                      marginTop: 0,
                      width: "100%",
                      padding: "0.875rem 1.5rem",
                      backgroundColor: "#10b981",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "0.625rem",
                      fontSize: "0.9375rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.625rem",
                      boxShadow: "0 2px 8px rgba(16, 185, 129, 0.2)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#059669";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.3)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "#10b981";
                      e.currentTarget.style.boxShadow = "0 2px 8px rgba(16, 185, 129, 0.2)";
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    Create Custom MCQ/Subjective Test (CSV)
                  </button>
                  <p style={{
                    margin: 0,
                    fontSize: "0.8125rem",
                    color: "#64748b",
                    lineHeight: 1.4,
                    textAlign: "center",
                  }}>
                      Upload CSV file to create custom MCQ and subjective questions
                    </p>
                </div>
                <Link href="/dsa" style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1.5px solid #A8E8BC",
                    borderRadius: "0.75rem",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "0 2px 6px rgba(168, 232, 188, 0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.2)";
                    e.currentTarget.style.borderColor = "#10b981";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(168, 232, 188, 0.1)";
                    e.currentTarget.style.borderColor = "#A8E8BC";
                  }}
                  >
                    <button 
                      type="button" 
                      style={{ 
                        marginTop: 0, 
                        width: "100%",
                        padding: "0.875rem 1.5rem",
                        backgroundColor: "#10b981",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "0.625rem",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.625rem",
                        boxShadow: "0 2px 8px rgba(16, 185, 129, 0.2)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#059669";
                        e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "#10b981";
                        e.currentTarget.style.boxShadow = "0 2px 8px rgba(16, 185, 129, 0.2)";
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                      Create DSA Competency
                    </button>
                    <p style={{
                      margin: 0,
                      fontSize: "0.8125rem",
                      color: "#64748b",
                      lineHeight: 1.4,
                      textAlign: "center",
                    }}>
                      Data structures and algorithms coding assessments
                    </p>
                  </div>
                </Link>
                <Link href="/aiml" style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1.5px solid #A8E8BC",
                    borderRadius: "0.75rem",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "0 2px 6px rgba(168, 232, 188, 0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.2)";
                    e.currentTarget.style.borderColor = "#10b981";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(168, 232, 188, 0.1)";
                    e.currentTarget.style.borderColor = "#A8E8BC";
                  }}
                  >
                    <button 
                      type="button" 
                      style={{ 
                        marginTop: 0, 
                        width: "100%",
                        padding: "0.875rem 1.5rem",
                        backgroundColor: "#10b981",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "0.625rem",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.625rem",
                        boxShadow: "0 2px 8px rgba(16, 185, 129, 0.2)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#059669";
                        e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.3)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "#10b981";
                        e.currentTarget.style.boxShadow = "0 2px 8px rgba(16, 185, 129, 0.2)";
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                      </svg>
                      Create AIML Competency
                    </button>
                    <p style={{
                      margin: 0,
                      fontSize: "0.8125rem",
                      color: "#64748b",
                      lineHeight: 1.4,
                      textAlign: "center",
                    }}>
                      AI/ML libraries (numpy, matplotlib, pandas) coding assessments
                    </p>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div style={{ textAlign: "center", padding: "3rem" }}>
              <div className="spinner" style={{ fontSize: "2rem", marginBottom: "1rem" }}>⟳</div>
              <p style={{ color: "#2D7A52" }}>Loading assessments...</p>
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div className="alert alert-error">{error}</div>
            <button type="button" className="btn-primary" onClick={fetchAssessments} style={{ marginTop: "1rem" }}>
              Retry
            </button>
          </div>
        ) : assessments.length === 0 ? (
          <div className="card">
            <div style={{ textAlign: "center", padding: "4rem 2rem" }}>
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  margin: "0 auto 1.5rem",
                  backgroundColor: "#E8FAF0", // Mint 50
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.5rem",
                }}
              >
                📋
              </div>
              <h2 style={{ color: "#1a1625", marginBottom: "1rem", fontSize: "1.5rem" }}>
                No assessments yet
              </h2>
              <p style={{ color: "#2D7A52", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
                Create your first assessment to get started with AI-powered topic and question
                generation.
              </p>
              <Link 
                href="/assessments/create-new"
                onClick={() => {
                  // Clear any draft from localStorage to ensure a fresh start
                  try {
                    localStorage.removeItem('currentDraftAssessmentId');
                  } catch (err) {
                    console.error("Error clearing draft ID:", err);
                  }
                }}
              >
                <button type="button" className="btn-primary" style={{ marginTop: 0 }}>
                  Create Your First Assessment
                </button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                Your Assessments
              </h2>
              <span
                className="badge badge-mint"
                style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}
              >
                {assessments.length} Total
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
                gap: "1rem",
              }}
            >
              {assessments.map((assessment) => {
                return (
                  <DashboardCard
                    key={assessment.id}
                    {...assessment}
                    type={assessment.type || 'assessment'}
                    isMenuOpen={openMenuId === assessment.id}
                    onMenuToggle={() => setOpenMenuId(openMenuId === assessment.id ? null : assessment.id)}
                    onPause={handlePauseAssessment}
                    onResume={handleResumeAssessment}
                    onDelete={handleDeleteAssessment}
                    onClone={(id, title) => {
                                  setCloneModal({
                                    show: true,
                        assessmentId: id,
                        assessmentTitle: title,
                        newTitle: `${title} (Copy)`,
                                  });
                                  setOpenMenuId(null);
                                }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Clone Confirmation Modal */}
      {cloneModal.show && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            animation: "fadeIn 0.2s ease-out",
          }}
          onClick={() => {
            if (!cloning) {
              setCloneModal({ show: false, assessmentId: null, assessmentTitle: "", newTitle: "" });
            }
          }}
        >
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @keyframes slideUp {
              from {
                opacity: 0;
                transform: translateY(20px) scale(0.95);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
          `}} />
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "1rem",
              padding: "2rem",
              maxWidth: "520px",
              width: "90%",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)",
              animation: "slideUp 0.2s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon Header */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "1rem", 
              marginBottom: "1.25rem" 
            }}>
              <div style={{
                width: "48px",
                height: "48px",
                borderRadius: "0.75rem",
                backgroundColor: "#ecfdf5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </div>
              <div>
                <h2 style={{ 
                  margin: 0, 
                  fontSize: "1.5rem", 
                  color: "#1a1625", 
                  fontWeight: 700,
                  lineHeight: "1.3",
                }}>
                  Clone Assessment
                </h2>
                <p style={{ 
                  margin: "0.25rem 0 0 0", 
                  fontSize: "0.875rem", 
                  color: "#64748b" 
                }}>
                  Create a copy of this assessment
                </p>
              </div>
            </div>

            {/* New Assessment Name Input */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "#1e293b",
                marginBottom: "0.5rem",
              }}>
                New Assessment Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                value={cloneModal.newTitle}
                onChange={(e) => setCloneModal({ ...cloneModal, newTitle: e.target.value })}
                placeholder="Enter assessment name"
                disabled={cloning}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  fontSize: "0.9375rem",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  backgroundColor: cloning ? "#f1f5f9" : "#ffffff",
                  color: "#1e293b",
                  transition: "all 0.15s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#10b981";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(16, 185, 129, 0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e2e8f0";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              {cloneModal.newTitle && cloneModal.newTitle.trim().length < 3 && (
                <p style={{
                  margin: "0.5rem 0 0 0",
                  fontSize: "0.75rem",
                  color: "#ef4444",
                }}>
                  Assessment name must be at least 3 characters
                </p>
              )}
            </div>

            {/* Content */}
            <div style={{
              backgroundColor: "#f8fafc",
              borderRadius: "0.75rem",
              padding: "1.25rem",
              marginBottom: "1.5rem",
              border: "1px solid #e2e8f0",
            }}>
              <p style={{ 
                margin: 0, 
                color: "#475569", 
                lineHeight: "1.7",
                fontSize: "0.9375rem",
              }}>
                This will create a new assessment copy with:
              </p>
              <ul style={{
                margin: "0.75rem 0 0 0",
                paddingLeft: "1.5rem",
                color: "#475569",
                lineHeight: "1.8",
                fontSize: "0.9375rem",
              }}>
                <li>Topics and question rows</li>
                <li>Generated questions</li>
                <li>Scoring and timers</li>
                <li>Section configuration</li>
              </ul>
              <div style={{
                marginTop: "1rem",
                paddingTop: "1rem",
                borderTop: "1px solid #e2e8f0",
              }}>
                <p style={{
                  margin: 0,
                  color: "#64748b",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}>
                  <strong style={{ color: "#dc2626" }}>Note:</strong> Schedule, candidates, and invitation settings will NOT be copied.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div style={{ 
              display: "flex", 
              gap: "0.75rem", 
              justifyContent: "flex-end" 
            }}>
              <button
                type="button"
                onClick={() => {
            if (!cloning) {
              setCloneModal({ show: false, assessmentId: null, assessmentTitle: "", newTitle: "" });
            }
          }}
                disabled={cloning}
                style={{
                  padding: "0.625rem 1.5rem",
                  backgroundColor: cloning ? "#f1f5f9" : "#ffffff",
                  color: cloning ? "#94a3b8" : "#475569",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  cursor: cloning ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                  opacity: cloning ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!cloning) {
                    e.currentTarget.style.backgroundColor = "#f8fafc";
                    e.currentTarget.style.borderColor = "#cbd5e1";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!cloning) {
                    e.currentTarget.style.backgroundColor = "#ffffff";
                    e.currentTarget.style.borderColor = "#e2e8f0";
                  }
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (cloneModal.assessmentId && cloneModal.newTitle && cloneModal.newTitle.trim().length >= 3) {
                    handleCloneAssessment(cloneModal.assessmentId, cloneModal.newTitle);
                  }
                }}
                disabled={cloning || !cloneModal.newTitle || cloneModal.newTitle.trim().length < 3}
                style={{
                  padding: "0.625rem 1.5rem",
                  backgroundColor: (cloning || !cloneModal.newTitle || cloneModal.newTitle.trim().length < 3) ? "#94a3b8" : "#10b981",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "0.5rem",
                  cursor: (cloning || !cloneModal.newTitle || cloneModal.newTitle.trim().length < 3) ? "not-allowed" : "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  boxShadow: (cloning || !cloneModal.newTitle || cloneModal.newTitle.trim().length < 3) ? "none" : "0 1px 2px rgba(16, 185, 129, 0.2)",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  opacity: (cloning || !cloneModal.newTitle || cloneModal.newTitle.trim().length < 3) ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!cloning && cloneModal.newTitle && cloneModal.newTitle.trim().length >= 3) {
                    e.currentTarget.style.backgroundColor = "#059669";
                    e.currentTarget.style.boxShadow = "0 4px 6px rgba(16, 185, 129, 0.3)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!cloning && cloneModal.newTitle && cloneModal.newTitle.trim().length >= 3) {
                    e.currentTarget.style.backgroundColor = "#10b981";
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(16, 185, 129, 0.2)";
                  }
                }}
              >
                {cloning ? (
                  <>
                    <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Cloning...
                  </>
                ) : (
                  "Confirm Clone"
                )}
              </button>
              <style dangerouslySetInnerHTML={{__html: `
                @keyframes spin {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
              `}} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;
