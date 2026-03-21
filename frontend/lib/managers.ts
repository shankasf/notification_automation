/**
 * Category configuration for sourcing managers.
 * Each category maps to one sourcing manager who handles all hiring requests in that area.
 *
 * - label: Human-readable category name shown in the UI
 * - shortName: 3-letter abbreviation used in badges and request IDs (e.g. REQ-ENG-001)
 * - color: Badge/avatar color
 * - icon: Lucide icon name
 */
export const MANAGER_CONFIG = {
  ENGINEERING_CONTRACTORS: {
    label: "Engineering Contractors",
    shortName: "ENG",
    color: "#3B82F6",
    icon: "Code2",
  },
  CONTENT_TRUST_SAFETY: {
    label: "Content & Trust Safety",
    shortName: "CTS",
    color: "#EF4444",
    icon: "Shield",
  },
  DATA_OPERATIONS: {
    label: "Data Operations",
    shortName: "DOP",
    color: "#10B981",
    icon: "Database",
  },
  MARKETING_CREATIVE: {
    label: "Marketing & Creative",
    shortName: "MKT",
    color: "#F59E0B",
    icon: "Palette",
  },
  CORPORATE_SERVICES: {
    label: "Corporate Services",
    shortName: "COR",
    color: "#8B5CF6",
    icon: "Building2",
  },
} as const;

export type CategoryKey = keyof typeof MANAGER_CONFIG;

/** Tailwind class strings for requisition status badges. */
export const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800",
  SOURCING: "bg-yellow-100 text-yellow-800",
  INTERVIEWING: "bg-purple-100 text-purple-800",
  OFFER: "bg-indigo-100 text-indigo-800",
  ONBOARDING: "bg-cyan-100 text-cyan-800",
  ACTIVE: "bg-green-100 text-green-800",
  COMPLETED: "bg-gray-100 text-gray-800",
  CANCELLED: "bg-red-100 text-red-800",
};

/** Tailwind class strings for priority level badges. */
export const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  LOW: "bg-green-100 text-green-800",
};

/** Tailwind class strings for change type badges in the change log. */
export const CHANGE_TYPE_COLORS: Record<string, string> = {
  CREATED: "bg-green-100 text-green-800",
  UPDATED: "bg-blue-100 text-blue-800",
  STATUS_CHANGE: "bg-purple-100 text-purple-800",
  RATE_CHANGE: "bg-orange-100 text-orange-800",
  HEADCOUNT_CHANGE: "bg-cyan-100 text-cyan-800",
  BUDGET_CHANGE: "bg-yellow-100 text-yellow-800",
  BULK_IMPORT: "bg-indigo-100 text-indigo-800",
};

/** Tailwind class strings for notification type badges and icon backgrounds. */
export const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
  CHANGE_SUMMARY: "bg-blue-100 text-blue-800",
  ANOMALY_ALERT: "bg-red-100 text-red-800",
  BUDGET_WARNING: "bg-yellow-100 text-yellow-800",
  MILESTONE: "bg-green-100 text-green-800",
};
