/**
 * POST /api/research
 * Runs the research pipeline for a new (or previously-discovered) company,
 * then attempts to match + draft + score it. Rate limited to
 * RATE_LIMIT.MAX_REQUESTS_PER_WINDOW per user per hour, since every call
 * makes several OpenAI/Tavily/Apollo/Hunter requests.
 *
 * Research and drafting are allowed to fail independently in the response:
 * once `researchCompany` has persisted the company (and optional contact),
 * that result is never thrown away because a later step failed. If
 * matching/drafting/scoring throws (most notably a `budget_exhausted`
 * IntegrationError once the OpenAI call cap is hit), the response still
 * returns 200 with the company/contact ids and `draftId: null` plus a
 * `draftError` message — the caller can view the saved research
 * immediately and draft the email manually or retry
 * `POST /api/draft` once the budget resets, instead of losing the research
 * entirely to a downstream credit failure. See
 * docs/decisions/07-company-discovery.md.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWithinRateLimit, toErrorResponse, ApiError } from "@/lib/api-utils";
import { researchCompany } from "@/lib/agent/research";
import { matchCompanyToProject } from "@/lib/agent/match";
import { draftEmailWithScore } from "@/lib/agent/draft";
import { deriveScoreResult } from "@/lib/agent/score";
import { getProjectById } from "@/lib/projects";
import { logger } from "@/lib/logger";

const requestSchema = z.object({
  companyUrl: z.string().url("companyUrl must be a valid URL"),
  contactName: z.string().min(1).optional(),
  contactTitle: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    requireWithinRateLimit(user.id);

    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { companyUrl, contactName, contactTitle, role } = parsed.data;

    // Research is the one step allowed to fail the whole request — a
    // company record with no synthesized understanding isn't useful to
    // save, so there's nothing to preserve if this throws.
    const { company, contact, incompleteSteps } = await researchCompany({
      companyUrl,
      contactName,
      contactTitle,
      userId: user.id,
      supabase,
    });

    try {
      const match = matchCompanyToProject(company);
      const project = getProjectById(match.projectId);

      const draftContent = await draftEmailWithScore({
        company,
        contactName: contact?.name ?? contactName ?? null,
        contactTitle: contact?.title ?? contactTitle ?? null,
        project,
        match,
        roleAppliedFor: role,
      });
      const score = deriveScoreResult(draftContent.rawScore, draftContent.scoreReasoning);

      const { data: draftRow, error: draftError } = await supabase
        .from("drafts")
        .insert({
          user_id: user.id,
          company_id: company.id,
          contact_id: contact?.id ?? null,
          subject: draftContent.subject,
          body: draftContent.body,
          project_matched: project.id,
          match_reasoning: match.reasoning,
          demo_url: project.demo,
          confidence_score: score.score,
          confidence_reason: score.reasoning,
          needs_demo_customisation: match.needsCustomisation,
          customisation_notes: match.customisationNotes,
        })
        .select("id")
        .single();

      if (draftError || !draftRow) {
        throw new Error(`Failed to save draft: ${draftError?.message ?? "unknown error"}`);
      }

      logger.info("research + draft pipeline completed", {
        companyId: company.id,
        draftId: draftRow.id,
        incompleteSteps,
      });

      return NextResponse.json({
        companyId: company.id,
        contactId: contact?.id ?? null,
        draftId: draftRow.id,
        draftError: null,
        incompleteSteps,
      });
    } catch (draftFailure) {
      logger.warn("research succeeded but match/draft/score failed — returning partial result", {
        companyId: company.id,
        error: String(draftFailure),
      });

      return NextResponse.json({
        companyId: company.id,
        contactId: contact?.id ?? null,
        draftId: null,
        draftError: draftFailure instanceof Error ? draftFailure.message : "Drafting failed.",
        incompleteSteps,
      });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
