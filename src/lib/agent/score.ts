/**
 * Scores overall confidence (1-10) that a drafted application is worth
 * sending. Distinct from lib/agent/match.ts's project-fit score: this asks
 * "how strong is this whole application" (folding in company size and
 * hiring signals), not "which project fits best." See
 * docs/architecture.md for why these stay two separate scores instead of
 * one blended number.
 *
 * The model supplies the numeric score and its reasoning; the send/review/
 * skip recommendation is always derived deterministically from
 * SCORE_THRESHOLDS here rather than trusted from the model, so the bands
 * shown in the UI are guaranteed consistent with the number next to them.
 */
import { z } from "zod";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { PROMPTS } from "@/lib/prompts";
import { PROFILE } from "@/lib/profile";
import { SCORE_THRESHOLDS, SCORE_RECOMMENDATION } from "@/lib/constants";
import type { Project } from "@/lib/projects";
import type { MatchResult, ScoreResult } from "@/types";

const scoreResponseSchema = z.object({
  score: z.number(),
  reasoning: z.string().min(1),
});

export interface ScorableCompany {
  name: string;
  industry: string | null;
  size: string | null;
  painPoint: string | null;
  hiringSignals: string[];
}

export interface ScoreApplicationParams {
  company: ScorableCompany;
  project: Project;
  match: MatchResult;
}

function clampScore(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score)));
}

function recommendationForScore(score: number): ScoreResult["recommendation"] {
  if (score >= SCORE_THRESHOLDS.SEND_MIN) return SCORE_RECOMMENDATION.SEND;
  if (score >= SCORE_THRESHOLDS.REVIEW_MIN) return SCORE_RECOMMENDATION.REVIEW;
  return SCORE_RECOMMENDATION.SKIP;
}

/**
 * Scores how strong a company/project application pairing is overall.
 * @param params - the researched company, matched project, and match result to evaluate
 * @returns a 1-10 confidence score, the model's reasoning, and a deterministic send/review/skip recommendation
 */
export async function scoreApplication(params: ScoreApplicationParams): Promise<ScoreResult> {
  const { company, project, match } = params;

  const userContent = JSON.stringify({
    company: {
      name: company.name,
      industry: company.industry,
      size: company.size,
      painPoint: company.painPoint,
      hiringSignals: company.hiringSignals,
    },
    applicant: {
      coreStrengths: PROFILE.coreStrengths,
      background: PROFILE.background,
    },
    matchedProject: {
      name: project.name,
      relevantIndustries: project.relevantIndustries,
      relevantPainPoints: project.relevantPainPoints,
    },
    matchResult: {
      score: match.score,
      reasoning: match.reasoning,
    },
  });

  const response = await runJsonCompletion({
    systemPrompt: PROMPTS.CONFIDENCE_SCORE,
    userContent,
    schema: scoreResponseSchema,
    label: "confidence-score",
  });

  const score = clampScore(response.score);

  return {
    score,
    reasoning: response.reasoning,
    recommendation: recommendationForScore(score),
  };
}
