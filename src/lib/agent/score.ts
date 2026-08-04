/**
 * Two ways to get from a matched project to a confidence score, for two
 * different callers:
 *
 * - `deriveScoreResult` — pure, no OpenAI call. Finalizes a raw score
 *   (from wherever it came from) into the clamped 1-10 + deterministic
 *   send/review/skip recommendation shown in the UI. Used by both callers
 *   below.
 * - `scoreApplication` — makes its own OpenAI call (`PROMPTS.CONFIDENCE_SCORE`)
 *   to produce that raw score *before* any email is drafted. Used only by
 *   the automated batch flow (lib/agent/batch.ts), which needs to decide
 *   whether a company is worth drafting for before spending a second call
 *   writing the email — see docs/decisions/09-automated-batch-runs.md.
 *   The manual review flow doesn't use this: it gets its raw score for
 *   free as part of `lib/agent/draft.ts`'s combined
 *   `draftEmailWithScore` call instead, which stays the cheaper default
 *   for one-company-at-a-time use.
 */
import { z } from "zod";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { PROMPTS } from "@/lib/prompts";
import { PROFILE } from "@/lib/profile";
import { SCORE_THRESHOLDS, SCORE_RECOMMENDATION } from "@/lib/constants";
import type { Project } from "@/lib/projects";
import type { ScoreResult } from "@/types";

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
  /** The match score/reasoning from lib/agent/match.ts, given as context for scoring. */
  match: { score: number; reasoning: string };
}

export interface RawScoreResult {
  rawScore: number;
  reasoning: string;
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
 * Finalizes a raw model score into the confidence result persisted and shown in the review UI.
 * @param rawScore - the model's own 1-10 score, from either draftEmailWithScore or scoreApplication
 * @param reasoning - the model's reasoning for that score
 * @returns a clamped 1-10 score, the reasoning, and a deterministic send/review/skip recommendation
 */
export function deriveScoreResult(rawScore: number, reasoning: string): ScoreResult {
  const score = clampScore(rawScore);
  return { score, reasoning, recommendation: recommendationForScore(score) };
}

/**
 * Scores how strong a company/project application pairing is, in its own OpenAI call, before any email is drafted.
 * @param params - the researched company, matched project, and match result to evaluate
 * @returns the model's raw 1-10 score and reasoning — pass through deriveScoreResult to finalize
 */
export async function scoreApplication(params: ScoreApplicationParams): Promise<RawScoreResult> {
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

  return { rawScore: response.score, reasoning: response.reasoning };
}
