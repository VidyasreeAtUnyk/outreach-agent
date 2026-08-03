/**
 * POST /api/draft
 * Re-runs the match + draft + score pipeline for a company that's already
 * been researched, producing a new pending draft. Used to regenerate a
 * draft (e.g. after editing the company's research data) without
 * re-running the search/synthesis steps. Rate limited like /api/research
 * since it also calls OpenAI.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWithinRateLimit, toErrorResponse, ApiError } from "@/lib/api-utils";
import { matchCompanyToProject } from "@/lib/agent/match";
import { draftEmailWithScore } from "@/lib/agent/draft";
import { deriveScoreResult } from "@/lib/agent/score";
import { getProjectById } from "@/lib/projects";
import { mapCompanyRow, mapContactRow } from "@/lib/supabase/mappers";

const requestSchema = z.object({
  companyId: z.string().uuid("companyId must be a valid UUID"),
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
    const { companyId } = parsed.data;

    const { data: companyRow, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    if (companyError || !companyRow) {
      throw new ApiError(404, "Company not found.");
    }
    const company = mapCompanyRow(companyRow);

    const { data: contactRow } = await supabase
      .from("contacts")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contact = contactRow ? mapContactRow(contactRow) : null;

    const match = matchCompanyToProject(company);
    const project = getProjectById(match.projectId);

    const draftContent = await draftEmailWithScore({
      company,
      contactName: contact?.name ?? null,
      contactTitle: contact?.title ?? null,
      project,
      match,
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

    return NextResponse.json({ draftId: draftRow.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
