/**
 * POST /api/research
 * Runs the full research + match + draft + score pipeline for a new
 * company and returns the ids needed to redirect straight to its review
 * page. Rate limited to RATE_LIMIT.MAX_REQUESTS_PER_WINDOW per user per
 * hour, since every call makes several OpenAI/Tavily/Hunter requests.
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

    const { company, contact, incompleteSteps } = await researchCompany({
      companyUrl,
      contactName,
      contactTitle,
      userId: user.id,
      supabase,
    });

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
      throw new ApiError(500, `Failed to save draft: ${draftError?.message ?? "unknown error"}`);
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
      incompleteSteps,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
