/**
 * Derives the final 1-10 confidence score and send/review/skip
 * recommendation from the raw score + reasoning produced alongside the
 * drafted email (see lib/agent/draft.ts's `draftEmailWithScore` — merged
 * into one OpenAI call specifically to conserve the hard call budget, see
 * docs/decisions/05-openai-call-budget.md). This function makes no OpenAI
 * call itself: it only clamps the model's raw score into 1-10 and derives
 * the recommendation deterministically from SCORE_THRESHOLDS, so the
 * send/review/skip bands shown in the UI are always consistent with the
 * number next to them regardless of model drift.
 */
import { SCORE_THRESHOLDS, SCORE_RECOMMENDATION } from "@/lib/constants";
import type { ScoreResult } from "@/types";

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
 * @param rawScore - the model's own 1-10 score from the combined draft+score call
 * @param reasoning - the model's reasoning for that score
 * @returns a clamped 1-10 score, the reasoning, and a deterministic send/review/skip recommendation
 */
export function deriveScoreResult(rawScore: number, reasoning: string): ScoreResult {
  const score = clampScore(rawScore);
  return { score, reasoning, recommendation: recommendationForScore(score) };
}
