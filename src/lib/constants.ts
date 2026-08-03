/**
 * Central home for values that would otherwise be hardcoded strings
 * scattered across routes, components, and lib functions. If a string is
 * compared, matched against a DB constraint, or reused in more than one
 * file, it belongs here instead of being retyped.
 */

/** Draft lifecycle states. Must match the `drafts_status_check` constraint in supabase/migrations/001_initial.sql. */
export const DRAFT_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  EDITED: "edited",
  REJECTED: "rejected",
  SENT: "sent",
} as const;

/** Reply triage states. Must match the `replies_status_check` constraint. */
export const REPLY_STATUS = {
  UNREAD: "unread",
  RESPONDED: "responded",
  ARCHIVED: "archived",
} as const;

/** Reply sentiment classification. Must match the `replies_sentiment_check` constraint. */
export const SENTIMENT = {
  POSITIVE: "positive",
  NEUTRAL: "neutral",
  NEGATIVE: "negative",
} as const;

/** Confidence-score recommendation bands. Score 1-10 maps to exactly one of these. */
export const SCORE_RECOMMENDATION = {
  SEND: "send",
  REVIEW: "review",
  SKIP: "skip",
} as const;

/** Company growth stage. */
export const COMPANY_SIZE = {
  STARTUP: "startup",
  SCALEUP: "scaleup",
  ENTERPRISE: "enterprise",
} as const;

/** Funding stage. */
export const COMPANY_STAGE = {
  SEED: "seed",
  SERIES_A: "series-a",
  SERIES_B: "series-b",
  PUBLIC: "public",
} as const;

/** Fixed industry classification enum used by research synthesis and project matching. */
export const INDUSTRY = {
  PROPTECH: "proptech",
  REAL_ESTATE: "real_estate",
  FINTECH: "fintech",
  ISLAMIC_FINANCE: "islamic_finance",
  SALES: "sales",
  CRM: "crm",
  B2B: "b2b",
  SAAS: "saas",
  ENTERPRISE: "enterprise",
  HR_TECH: "hr_tech",
  OPERATIONS: "operations",
  GOVERNMENT: "government",
  PUBLIC_SECTOR: "public_sector",
  HEALTHCARE: "healthcare",
  SOCIAL_IMPACT: "social_impact",
  UAE_SPECIFIC: "uae_specific",
  CONSUMER: "consumer",
  MOBILE: "mobile",
  RETAIL: "retail",
  DISTRIBUTION: "distribution",
  FINANCE: "finance",
  OTHER: "other",
} as const;

/** Where a contact's email was sourced from. */
export const CONTACT_SOURCE = {
  HUNTER: "hunter",
  APOLLO: "apollo",
  MANUAL: "manual",
} as const;

/** Rate limit applied to every AI-calling API route. See lib/ratelimit.ts. */
export const RATE_LIMIT = {
  MAX_REQUESTS_PER_WINDOW: 10,
  WINDOW_MS: 60 * 60 * 1000, // 1 hour
} as const;

/** Hard constraints the drafting prompt must honor, enforced again after generation. */
export const EMAIL_CONSTRAINTS = {
  MAX_WORD_COUNT: 150,
} as const;

/** Client-facing route paths, kept in one place so links and redirects can't drift. */
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  RESEARCH: "/research",
  REVIEW: "/review",
  REVIEW_DETAIL: (id: string) => `/review/${id}`,
  TRACKER: "/tracker",
} as const;

/** Confidence-score thresholds used by lib/agent/score.ts to pick a recommendation band. */
export const SCORE_THRESHOLDS = {
  SEND_MIN: 8,
  REVIEW_MIN: 5,
} as const;
