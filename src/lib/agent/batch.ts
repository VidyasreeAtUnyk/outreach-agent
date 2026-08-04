/**
 * Orchestrates one company through research → confidence scoring →
 * (conditionally) drafting, for the automated batch runner kicked off
 * from /discover — see docs/decisions/09-automated-batch-runs.md.
 *
 * Every phase is independently caught: this function never throws. Each
 * phase's success/failure is reported in the returned result instead, so
 * the caller (POST /api/batch/process-company, and ultimately the
 * client-side batch loop) can always mark this company's status and move
 * on to the next one, exactly the "when errored, update status and
 * continue" behavior the batch feature was built around — a company that
 * fails here should never abort the rest of the run.
 *
 * Unlike the manual review flow (lib/agent/draft.ts's
 * `draftEmailWithScore`, one combined call), this scores *before*
 * drafting via lib/agent/score.ts's `scoreApplication`, and skips
 * drafting entirely when the score's recommendation is 'skip' — the
 * whole point of scoring first in an automated run is to not spend a
 * drafting call on a company nobody would send to anyway.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { researchCompany } from "@/lib/agent/research";
import { matchCompanyToProject } from "@/lib/agent/match";
import { scoreApplication, deriveScoreResult } from "@/lib/agent/score";
import { draftEmail } from "@/lib/agent/draft";
import { getProjectById } from "@/lib/projects";
import { RESEARCH_STATUS, SCORE_RECOMMENDATION } from "@/lib/constants";
import { mapCompanyRow, mapContactRow } from "@/lib/supabase/mappers";
import { logger } from "@/lib/logger";
import type { Company, Contact, ScoreResult } from "@/types";

export interface ProcessCompanyForBatchParams {
  companyId: string;
  userId: string;
  supabase: SupabaseClient;
}

export interface ProcessCompanyForBatchResult {
  companyId: string;
  companyName: string | null;
  researched: boolean;
  researchError: string | null;
  score: ScoreResult | null;
  scoreError: string | null;
  /** True when scoring succeeded but the recommendation was 'skip', so drafting was intentionally never attempted. */
  skippedDraft: boolean;
  drafted: boolean;
  draftId: string | null;
  draftError: string | null;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function findExistingDraftId(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ id: string; confidence_score: number | null; confidence_reason: string | null } | null> {
  const { data } = await supabase
    .from("drafts")
    .select("id, confidence_score, confidence_reason")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findLatestContact(supabase: SupabaseClient, companyId: string): Promise<Contact | null> {
  const { data } = await supabase
    .from("contacts")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? mapContactRow(data) : null;
}

/**
 * Processes one company: researches it if needed, scores the application, and drafts an email unless the score says skip.
 * @param params - the company to process and the authenticated Supabase client/user to run as
 * @returns per-phase success/failure — never throws
 */
export async function processCompanyForBatch(
  params: ProcessCompanyForBatchParams,
): Promise<ProcessCompanyForBatchResult> {
  const { companyId, userId, supabase } = params;

  const result: ProcessCompanyForBatchResult = {
    companyId,
    companyName: null,
    researched: false,
    researchError: null,
    score: null,
    scoreError: null,
    skippedDraft: false,
    drafted: false,
    draftId: null,
    draftError: null,
  };

  const { data: companyRow, error: companyFetchError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();

  if (companyFetchError || !companyRow) {
    result.researchError = `Company not found: ${companyFetchError?.message ?? "unknown error"}`;
    return result;
  }

  let company: Company = mapCompanyRow(companyRow);
  result.companyName = company.name;

  // Idempotent re-run: if this company already has a draft (e.g. a prior
  // batch run reached it before stopping), don't research/score/draft it
  // again — just report what's already there.
  const existingDraft = await findExistingDraftId(supabase, companyId);
  if (existingDraft) {
    result.researched = true;
    result.drafted = true;
    result.draftId = existingDraft.id;
    if (existingDraft.confidence_score !== null) {
      result.score = deriveScoreResult(existingDraft.confidence_score, existingDraft.confidence_reason ?? "");
    }
    return result;
  }

  let contact: Contact | null = null;

  if (company.researchStatus === RESEARCH_STATUS.RESEARCHED) {
    result.researched = true;
    contact = await findLatestContact(supabase, companyId);
  } else {
    try {
      const researched = await researchCompany({ companyUrl: company.url, userId, supabase });
      company = researched.company;
      contact = researched.contact;
      result.researched = true;
    } catch (cause) {
      logger.warn("batch: research failed for company, marking errored and stopping this company", {
        companyId,
        cause: errorMessage(cause),
      });
      result.researchError = errorMessage(cause);
      return result;
    }
  }

  const match = matchCompanyToProject(company);
  const project = getProjectById(match.projectId);

  try {
    const { rawScore, reasoning } = await scoreApplication({ company, project, match });
    result.score = deriveScoreResult(rawScore, reasoning);
  } catch (cause) {
    logger.warn("batch: scoring failed for company, marking errored and stopping this company", {
      companyId,
      cause: errorMessage(cause),
    });
    result.scoreError = errorMessage(cause);
    return result;
  }

  if (result.score.recommendation === SCORE_RECOMMENDATION.SKIP) {
    result.skippedDraft = true;
    return result;
  }

  try {
    const draftContent = await draftEmail({
      company,
      contactName: contact?.name ?? null,
      contactTitle: contact?.title ?? null,
      project,
    });

    const { data: draftRow, error: draftInsertError } = await supabase
      .from("drafts")
      .insert({
        user_id: userId,
        company_id: company.id,
        contact_id: contact?.id ?? null,
        subject: draftContent.subject,
        body: draftContent.body,
        project_matched: project.id,
        match_reasoning: match.reasoning,
        demo_url: project.demo,
        confidence_score: result.score.score,
        confidence_reason: result.score.reasoning,
        needs_demo_customisation: match.needsCustomisation,
        customisation_notes: match.customisationNotes,
      })
      .select("id")
      .single();

    if (draftInsertError || !draftRow) {
      throw new Error(draftInsertError?.message ?? "unknown error");
    }

    result.drafted = true;
    result.draftId = draftRow.id;
  } catch (cause) {
    logger.warn("batch: drafting failed for company, marking errored", {
      companyId,
      cause: errorMessage(cause),
    });
    result.draftError = errorMessage(cause);
  }

  return result;
}
