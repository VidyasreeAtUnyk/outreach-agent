/**
 * Shared domain types for OutreachAgent. Database row types mirror
 * supabase/migrations/001_initial.sql exactly; pipeline result types
 * describe the shape produced by src/lib/agent/*.
 */
import type {
  COMPANY_SIZE,
  COMPANY_STAGE,
  CONTACT_SOURCE,
  DRAFT_STATUS,
  INDUSTRY,
  REPLY_STATUS,
  RESEARCH_STATUS,
  SCORE_RECOMMENDATION,
  SENTIMENT,
} from "@/lib/constants";

export type CompanySize = (typeof COMPANY_SIZE)[keyof typeof COMPANY_SIZE];
export type CompanyStage = (typeof COMPANY_STAGE)[keyof typeof COMPANY_STAGE];
export type Industry = (typeof INDUSTRY)[keyof typeof INDUSTRY];
export type ContactSource = (typeof CONTACT_SOURCE)[keyof typeof CONTACT_SOURCE];
export type DraftStatus = (typeof DRAFT_STATUS)[keyof typeof DRAFT_STATUS];
export type ReplyStatus = (typeof REPLY_STATUS)[keyof typeof REPLY_STATUS];
export type ResearchStatus = (typeof RESEARCH_STATUS)[keyof typeof RESEARCH_STATUS];
export type Sentiment = (typeof SENTIMENT)[keyof typeof SENTIMENT];
export type ScoreRecommendation =
  (typeof SCORE_RECOMMENDATION)[keyof typeof SCORE_RECOMMENDATION];

/** `companies` table row. */
export interface Company {
  id: string;
  userId: string;
  name: string;
  url: string;
  industry: Industry | null;
  size: CompanySize | null;
  stage: CompanyStage | null;
  location: string | null;
  description: string | null;
  painPoint: string | null;
  techSignals: string[];
  hiringSignals: string[];
  recentNews: string | null;
  /** 'discovered' = found via lib/agent/discover.ts, not yet researched (most fields null). 'researched' = full pipeline has run. */
  researchStatus: ResearchStatus;
  /** 1-10 relevance to the discovery query that found this company, from lib/agent/discover.ts. Null for companies added manually via /research. Drives batch-run processing order — see lib/agent/batch.ts. */
  discoveryScore: number | null;
  createdAt: string;
  updatedAt: string;
}

/** `contacts` table row. */
export interface Contact {
  id: string;
  userId: string;
  companyId: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  emailVerified: boolean;
  foundVia: ContactSource | null;
  createdAt: string;
}

/** `drafts` table row. */
export interface Draft {
  id: string;
  userId: string;
  companyId: string;
  contactId: string | null;
  subject: string;
  body: string;
  projectMatched: string | null;
  matchReasoning: string | null;
  demoUrl: string | null;
  confidenceScore: number | null;
  confidenceReason: string | null;
  needsDemoCustomisation: boolean;
  customisationNotes: string | null;
  status: DraftStatus;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `replies` table row. */
export interface Reply {
  id: string;
  userId: string;
  draftId: string;
  receivedAt: string | null;
  body: string;
  sentiment: Sentiment | null;
  suggestedResponse: string | null;
  status: ReplyStatus;
  createdAt: string;
}

/** A `Draft` joined with its parent `Company` and `Contact`, as consumed by the review pages. */
export interface DraftWithRelations extends Draft {
  company: Company;
  contact: Contact | null;
}

/** Output of lib/agent/research.ts — everything gathered and synthesized about one company. */
export interface ResearchResult {
  company: {
    name: string;
    url: string;
    industry: Industry | null;
    size: CompanySize | null;
    stage: CompanyStage | null;
    location: string | null;
    description: string | null;
    painPoint: string | null;
    techSignals: string[];
    hiringSignals: string[];
    recentNews: string | null;
  };
  contact: {
    name: string;
    title: string | null;
    email: string | null;
    emailVerified: boolean;
    foundVia: ContactSource | null;
  } | null;
  /** Which research steps failed and were skipped, for transparency in the review UI. */
  incompleteSteps: string[];
}

/** Output of lib/agent/match.ts — the best-fit project for a researched company. */
export interface MatchResult {
  projectId: string;
  score: number;
  reasoning: string;
  needsCustomisation: boolean;
  customisationNotes: string | null;
}

/** Output of lib/agent/score.ts — confidence that this application is worth sending. */
export interface ScoreResult {
  score: number;
  reasoning: string;
  recommendation: ScoreRecommendation;
}

/** One candidate found by lib/agent/discover.ts, persisted as a 'discovered' companies row. */
export interface DiscoveredCompany {
  id: string;
  name: string;
  url: string;
  /** Why this candidate matched the discovery query, from the model's extraction. */
  reason: string;
  /** 1-10 relevance to the discovery query, clamped. The `discovered` array returned by discoverCompanies is already sorted by this, descending. */
  score: number;
  /** True if this candidate matched an existing company row rather than being newly inserted. */
  alreadyKnown: boolean;
}

/** Output of lib/agent/discover.ts. */
export interface DiscoverCompaniesOutput {
  discovered: DiscoveredCompany[];
  incompleteSteps: string[];
}
