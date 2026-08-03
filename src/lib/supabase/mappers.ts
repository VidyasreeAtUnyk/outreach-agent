/**
 * Maps snake_case Postgres rows (src/lib/supabase/types.ts) to the
 * camelCase domain types the rest of the app works with (src/types/index.ts).
 * Keeping this mapping in one place means a schema-column rename only
 * requires updating the corresponding mapper function, not every call site.
 */
import type { Company, Contact, Draft, Reply } from "@/types";
import type { Database } from "@/lib/supabase/types";

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type DraftRow = Database["public"]["Tables"]["drafts"]["Row"];
type ReplyRow = Database["public"]["Tables"]["replies"]["Row"];

export function mapCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    url: row.url,
    industry: row.industry as Company["industry"],
    size: row.size as Company["size"],
    stage: row.stage as Company["stage"],
    location: row.location,
    description: row.description,
    painPoint: row.pain_point,
    techSignals: row.tech_signals,
    hiringSignals: row.hiring_signals,
    recentNews: row.recent_news,
    researchStatus: row.research_status as Company["researchStatus"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapContactRow(row: ContactRow): Contact {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    name: row.name,
    title: row.title,
    email: row.email,
    linkedinUrl: row.linkedin_url,
    emailVerified: row.email_verified,
    foundVia: row.found_via as Contact["foundVia"],
    createdAt: row.created_at,
  };
}

export function mapDraftRow(row: DraftRow): Draft {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    contactId: row.contact_id,
    subject: row.subject,
    body: row.body,
    projectMatched: row.project_matched,
    matchReasoning: row.match_reasoning,
    demoUrl: row.demo_url,
    confidenceScore: row.confidence_score,
    confidenceReason: row.confidence_reason,
    needsDemoCustomisation: row.needs_demo_customisation,
    customisationNotes: row.customisation_notes,
    status: row.status as Draft["status"],
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapReplyRow(row: ReplyRow): Reply {
  return {
    id: row.id,
    userId: row.user_id,
    draftId: row.draft_id,
    receivedAt: row.received_at,
    body: row.body,
    sentiment: row.sentiment as Reply["sentiment"],
    suggestedResponse: row.suggested_response,
    status: row.status as Reply["status"],
    createdAt: row.created_at,
  };
}
