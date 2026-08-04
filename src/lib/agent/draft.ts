/**
 * Two ways to draft the cold job-application email, for two different
 * callers:
 *
 * - `draftEmailWithScore` — one OpenAI call that writes the email AND
 *   scores the application together (`PROMPTS.EMAIL_DRAFT_AND_SCORE`).
 *   Used by the manual, one-company-at-a-time review flow, where the
 *   human sees both together and decides for themselves — this is the
 *   cheaper default (see docs/decisions/05-openai-call-budget.md for why
 *   it's combined).
 * - `draftEmail` — draft-only (`PROMPTS.EMAIL_DRAFT`), no score in the
 *   output. Used by the automated batch flow (lib/agent/batch.ts), which
 *   already has a confidence score from a separate
 *   `lib/agent/score.ts#scoreApplication` call before deciding whether
 *   drafting is even worth doing — see
 *   docs/decisions/09-automated-batch-runs.md.
 *
 * `draftEmailWithScore`'s raw score/reasoning still needs to go through
 * lib/agent/score.ts's `deriveScoreResult` to get the final clamped score
 * and deterministic send/review/skip recommendation, same as
 * `scoreApplication`'s output does.
 */
import { z } from "zod";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { PROMPTS } from "@/lib/prompts";
import { PROFILE } from "@/lib/profile";
import { EMAIL_CONSTRAINTS } from "@/lib/constants";
import { logger } from "@/lib/logger";
import type { Project } from "@/lib/projects";

const draftAndScoreResponseSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  score: z.number(),
  scoreReasoning: z.string().min(1),
});

const draftOnlyResponseSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export interface DraftableCompany {
  name: string;
  industry: string | null;
  size: string | null;
  painPoint: string | null;
  description: string | null;
  techSignals: string[];
  hiringSignals: string[];
  recentNews: string | null;
}

interface DraftContext {
  company: DraftableCompany;
  contactName: string | null;
  contactTitle: string | null;
  project: Project;
  /** The specific role being applied for, if the human specified one when submitting the company. */
  roleAppliedFor?: string;
}

export interface DraftEmailWithScoreParams extends DraftContext {
  /** The match score/reasoning from lib/agent/match.ts, given as context for the scoring half of this call. */
  match: { score: number; reasoning: string };
}

export type DraftEmailParams = DraftContext;

export interface DraftResult {
  subject: string;
  body: string;
  wordCount: number;
}

export interface DraftAndScoreResult extends DraftResult {
  /** Raw 1-10 score from the model — pass through lib/agent/score.ts's deriveScoreResult before persisting or displaying. */
  rawScore: number;
  scoreReasoning: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildBaseUserContent(context: DraftContext): Record<string, unknown> {
  const { company, contactName, contactTitle, project, roleAppliedFor } = context;

  return {
    company: {
      name: company.name,
      industry: company.industry,
      size: company.size,
      painPoint: company.painPoint,
      description: company.description,
      techSignals: company.techSignals,
      hiringSignals: company.hiringSignals,
      recentNews: company.recentNews,
    },
    contact: {
      name: contactName,
      title: contactTitle,
    },
    roleAppliedFor: roleAppliedFor ?? null,
    applicant: {
      name: PROFILE.name,
      title: PROFILE.title,
      location: PROFILE.location,
      yearsExperience: PROFILE.yearsExperience,
      github: PROFILE.github,
      coreStrengths: PROFILE.coreStrengths,
      background: PROFILE.background,
      voice: PROFILE.voice,
      neverSay: PROFILE.neverSay,
    },
    matchedProject: {
      name: project.name,
      subtitle: project.subtitle,
      headline: project.headline,
      technicalDepth: project.technicalDepth,
      github: project.github,
      demo: project.demo,
    },
  };
}

/** Logs (doesn't throw) if the drafted body breaks the word-count constraint or uses a forbidden phrase — the human catches these in review either way, this is just for visibility. */
function logDraftQualityWarnings(companyName: string, body: string): void {
  const wordCount = countWords(body);
  if (wordCount > EMAIL_CONSTRAINTS.MAX_WORD_COUNT) {
    logger.warn("drafted email exceeded the word count constraint", {
      company: companyName,
      wordCount,
      limit: EMAIL_CONSTRAINTS.MAX_WORD_COUNT,
    });
  }

  const usedForbiddenPhrase = PROFILE.neverSay.find((phrase) => body.toLowerCase().includes(phrase.toLowerCase()));
  if (usedForbiddenPhrase) {
    logger.warn("drafted email used a forbidden phrase from PROFILE.neverSay", {
      company: companyName,
      phrase: usedForbiddenPhrase,
    });
  }
}

/**
 * Generates the cold job-application email and a raw confidence score for a company/project pair in one OpenAI call.
 * @param params - the researched company, contact, matched project, match result, and optional role being applied for
 * @returns the drafted subject/body/word count, plus the raw score and reasoning for lib/agent/score.ts to finalize
 */
export async function draftEmailWithScore(
  params: DraftEmailWithScoreParams,
): Promise<DraftAndScoreResult> {
  const userContent = JSON.stringify({
    ...buildBaseUserContent(params),
    matchResult: { score: params.match.score, reasoning: params.match.reasoning },
  });

  const response = await runJsonCompletion({
    systemPrompt: PROMPTS.EMAIL_DRAFT_AND_SCORE,
    userContent,
    schema: draftAndScoreResponseSchema,
    label: "email-draft-and-score",
  });

  logDraftQualityWarnings(params.company.name, response.body);

  return {
    subject: response.subject,
    body: response.body,
    wordCount: countWords(response.body),
    rawScore: response.score,
    scoreReasoning: response.scoreReasoning,
  };
}

/**
 * Generates the cold job-application email only, in its own OpenAI call, with no score in the output.
 * Used by the automated batch flow, which already knows the confidence score (from a prior
 * lib/agent/score.ts#scoreApplication call) before deciding to draft at all.
 * @param params - the researched company, contact, matched project, and optional role being applied for
 * @returns the drafted subject/body/word count
 */
export async function draftEmail(params: DraftEmailParams): Promise<DraftResult> {
  const userContent = JSON.stringify(buildBaseUserContent(params));

  const response = await runJsonCompletion({
    systemPrompt: PROMPTS.EMAIL_DRAFT,
    userContent,
    schema: draftOnlyResponseSchema,
    label: "email-draft",
  });

  logDraftQualityWarnings(params.company.name, response.body);

  return {
    subject: response.subject,
    body: response.body,
    wordCount: countWords(response.body),
  };
}
