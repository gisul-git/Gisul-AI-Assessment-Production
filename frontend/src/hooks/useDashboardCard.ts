/**
 * Universal Dashboard Card Hook
 * Centralizes all card logic for consistent behavior across all assessment types
 */

import { useMemo } from 'react';
import type { AssessmentType, DisplayStatus } from '../utils/cardConfig';
import { TYPE_BADGES, STATUS_COLORS, getNavigationPaths, getButtonVisibility } from '../utils/cardConfig';

export interface CardInput {
  // Core fields
  id: string;
  title: string;
  type: AssessmentType;
  
  // Status fields (varies by type)
  status?: string;
  is_published?: boolean;
  is_active?: boolean;
  pausedAt?: string;
  isDraft?: boolean;
  
  // Schedule fields
  scheduleStatus?: {
    startTime?: string;
    endTime?: string;
    duration?: number;
    isActive?: boolean;
  } | null;
  hasSchedule?: boolean;
  
  // Metadata
  createdAt?: string;
  updatedAt?: string;
}

export interface CardOutput {
  // Display status
  displayStatus: DisplayStatus;
  
  // Visual styling
  statusColors: {
    bg: string;
    text: string;
    border: string;
    icon?: string;
  };
  
  // Schedule information
  schedule: {
    hasSchedule: boolean;
    isActive: boolean;
    isEndTimePassed: boolean;
    wasCreatedAfterEndTime: boolean;
    startTime?: string;
    endTime?: string;
    duration?: number;
  };
  
  // Card styling
  cardStyle: {
    border: string;
    backgroundColor: string;
    boxShadow: string;
    hoverBoxShadow: string;
  };
  
  // Badge information
  typeBadge: {
    label: string;
    colors: { bg: string; text: string; border: string };
  };
  
  // Action buttons visibility
  actions: {
    showEdit: boolean;
    showAnalytics: boolean;
    showDelete: boolean;
    showPause: boolean;
    showResume: boolean;
    showClone: boolean;
  };
  
  // Navigation
  navigation: {
    editPath: string;
    analyticsPath: string;
  };
  
  // Metadata
  metadata: {
    formattedCreatedAt: string;
    formattedUpdatedAt: string;
  };
}

/**
 * Determine base status from raw assessment data
 */
function determineBaseStatus(assessment: CardInput): DisplayStatus {
  // Priority: pausedAt > is_published > status field > default to draft
  
  if (assessment.pausedAt) {
    return 'paused';
  }
  
  // For DSA/AIML: check is_published
  if (assessment.is_published !== undefined) {
    if (assessment.is_published) {
      return 'active';
    } else {
      // New AIML/DSA tests should have is_published = false, so they should be 'draft'
      if (assessment.type === 'aiml' && assessment.is_published === false) {
        console.log('[useDashboardCard] AIML test with is_published=false, returning draft:', {
          id: assessment.id,
          title: assessment.title,
          is_published: assessment.is_published
        });
      }
      return 'draft';
    }
  }
  
  // For Custom MCQ and regular assessments: use status field
  if (assessment.status) {
    // Map 'published' to 'active' for consistency
    if (assessment.status === 'published') {
      return 'active';
    }
    // Map 'scheduled' to 'draft' - "scheduled" is not a status badge value,
    // it only appears in the schedule indicator. Status badge should show draft/active/paused/completed
    if (assessment.status === 'scheduled') {
      return 'draft';
    }
    // Only allow valid status badge values
    const validStatuses: DisplayStatus[] = ['draft', 'active', 'paused', 'completed'];
    if (validStatuses.includes(assessment.status as DisplayStatus)) {
      return assessment.status as DisplayStatus;
    }
    // For any other status value, default to draft
    return 'draft';
  }
  
  // Check isDraft flag
  if (assessment.isDraft !== undefined) {
    return assessment.isDraft ? 'draft' : 'active';
  }
  
  return 'draft';
}

/**
 * Calculate schedule information
 */
function calculateScheduleInfo(assessment: CardInput) {
  const schedule = assessment.scheduleStatus || {};
  const endTime = schedule.endTime;
  const startTime = schedule.startTime;
  const hasSchedule = assessment.hasSchedule || !!(startTime && endTime);
  
  const now = new Date();
  const isEndTimePassed = endTime ? new Date(endTime) < now : false;
  
  // Check if test was created after endTime (edge case handling)
  const wasCreatedAfterEndTime = endTime && assessment.createdAt 
    ? new Date(assessment.createdAt) > new Date(endTime) 
    : false;
  
  return {
    hasSchedule,
    isActive: schedule.isActive || false,
    isEndTimePassed,
    wasCreatedAfterEndTime,
    startTime,
    endTime,
    duration: schedule.duration || 0
  };
}

/**
 * Determine final display status (applying completion logic)
 */
function determineDisplayStatus(
  baseStatus: DisplayStatus,
  scheduleInfo: ReturnType<typeof calculateScheduleInfo>
): DisplayStatus {
  // CRITICAL: Draft and paused tests should NEVER show as "completed"
  // This guard must come first to prevent any edge cases
  if (baseStatus === 'draft' || baseStatus === 'paused') {
    // Debug: Log if a draft test has a past endTime (should not show as completed)
    if (baseStatus === 'draft' && scheduleInfo.isEndTimePassed) {
      console.log('[useDashboardCard] Draft test has past endTime but will remain draft (not completed)', {
        baseStatus,
        isEndTimePassed: scheduleInfo.isEndTimePassed,
        endTime: scheduleInfo.endTime
      });
    }
    return baseStatus;
  }
  
  // Only mark as "completed" if:
  // 1. Status is "active" or "published" (NOT draft or paused)
  // 2. End time has passed
  // 3. Test was not created after endTime
  if ((baseStatus === 'active' || baseStatus === 'published') && scheduleInfo.isEndTimePassed) {
    if (!scheduleInfo.wasCreatedAfterEndTime) {
      return 'completed';
    }
  }
  
  return baseStatus;
}

/**
 * Get card container styling
 */
function getCardStyle(displayStatus: DisplayStatus) {
  const isPaused = displayStatus === 'paused';
  
  return {
    border: isPaused 
      ? '2px solid #fbbf24' 
      : '1.5px solid #A8E8BC',
    backgroundColor: isPaused 
      ? '#fffbeb' 
      : '#ffffff',
    boxShadow: isPaused
      ? '0 2px 8px rgba(251, 191, 36, 0.2), 0 0 0 1px rgba(251, 191, 36, 0.1)'
      : '0 2px 6px rgba(168, 232, 188, 0.15), 0 0 0 1px rgba(168, 232, 188, 0.1)',
    hoverBoxShadow: isPaused
      ? '0 8px 20px rgba(251, 191, 36, 0.3), 0 0 0 1px rgba(251, 191, 36, 0.2)'
      : '0 6px 16px rgba(168, 232, 188, 0.3), 0 0 0 1px rgba(168, 232, 188, 0.15)'
  };
}

/**
 * Format date string
 */
function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Universal Dashboard Card Hook
 * 
 * @param assessment - Assessment data
 * @returns Computed card properties and styling
 */
export function useDashboardCard(assessment: CardInput): CardOutput {
  // Memoize expensive calculations
  const baseStatus = useMemo(() => 
    determineBaseStatus(assessment), 
    [
      assessment.type, 
      assessment.status, 
      assessment.is_published, 
      assessment.pausedAt, 
      assessment.isDraft
    ]
  );
  
  const scheduleInfo = useMemo(() => 
    calculateScheduleInfo(assessment), 
    [
      assessment.scheduleStatus, 
      assessment.hasSchedule, 
      assessment.createdAt
    ]
  );
  
  const displayStatus = useMemo(() => 
    determineDisplayStatus(baseStatus, scheduleInfo), 
    [baseStatus, scheduleInfo]
  );
  
  const statusColors = useMemo(() => 
    STATUS_COLORS[displayStatus] || STATUS_COLORS.draft, 
    [displayStatus]
  );
  
  const cardStyle = useMemo(() => 
    getCardStyle(displayStatus), 
    [displayStatus]
  );
  
  const typeBadge = useMemo(() => 
    TYPE_BADGES[assessment.type], 
    [assessment.type]
  );
  
  const actions = useMemo(() => 
    getButtonVisibility(displayStatus), 
    [displayStatus]
  );
  
  const navigation = useMemo(() => 
    getNavigationPaths(assessment.type, displayStatus, assessment.id), 
    [assessment.type, displayStatus, assessment.id]
  );
  
  const metadata = useMemo(() => ({
    formattedCreatedAt: formatDate(assessment.createdAt),
    formattedUpdatedAt: formatDate(assessment.updatedAt)
  }), [assessment.createdAt, assessment.updatedAt]);
  
  return {
    displayStatus,
    statusColors,
    schedule: scheduleInfo,
    cardStyle,
    typeBadge,
    actions,
    navigation,
    metadata
  };
}

