/**
 * Drafts the cold job-application email for a researched company AND scores
 * the overall application in the same OpenAI call — see lib/prompts.ts
 * EMAIL_DRAFT_AND_SCORE. Combined deliberately to spend one call instead of
 * two against the hard OpenAI call budget (see
 * docs/decisions/05-openai-call-budget.md). The raw score/reasoning this
 * returns still needs to go through lib/agent/score.ts's
 * `deriveScoreResult` to get the final clamped score and deterministic
 * send/review/skip recommendation.
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

export interface DraftEmailWithScoreParams {
  company: DraftableCompany;
  contactName: string | null;
  contactTitle: string | null;
  project: Project;
  /** The match score/reasoning from lib/agent/match.ts, given as context for the scoring half of this call. */
  match: { score: number; reasoning: string };
  /** The specific role being applied for, if the human specified one when submitting the company. */
  roleAppliedFor?: string;
}

export interface DraftAndScoreResult {
  subject: string;
  body: string;
  wordCount: number;
  /** Raw 1-10 score from the model — pass through lib/agent/score.ts's deriveScoreResult before persisting or displaying. */
  rawScore: number;
  scoreReasoning: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildUserContent(params: DraftEmailWithScoreParams): string {
  const { company, contactName, contactTitle, project, match, roleAppliedFor } = params;

  return JSON.stringify({
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
    matchResult: {
      score: match.score,
      reasoning: match.reasoning,
    },
  });
}

/**
 * Generates the cold job-application email and a raw confidence score for a company/project pair in one OpenAI call.
 * @param params - the researched company, contact, matched project, match result, and optional role being applied for
 * @returns the drafted subject/body/word count, plus the raw score and reasoning for lib/agent/score.ts to finalize
 */
export async function draftEmailWithScore(
  params: DraftEmailWithScoreParams,
): Promise<DraftAndScoreResult> {
  const response = await runJsonCompletion({
    systemPrompt: PROMPTS.EMAIL_DRAFT_AND_SCORE,
    userContent: buildUserContent(params),
    schema: draftAndScoreResponseSchema,
    label: "email-draft-and-score",
  });

  const wordCount = countWords(response.body);

  if (wordCount > EMAIL_CONSTRAINTS.MAX_WORD_COUNT) {
    logger.warn("drafted email exceeded the word count constraint", {
      company: params.company.name,
      wordCount,
      limit: EMAIL_CONSTRAINTS.MAX_WORD_COUNT,
    });
  }

  const usedForbiddenPhrase = PROFILE.neverSay.find((phrase) =>
    response.body.toLowerCase().includes(phrase.toLowerCase()),
  );
  if (usedForbiddenPhrase) {
    logger.warn("drafted email used a forbidden phrase from PROFILE.neverSay", {
      company: params.company.name,
      phrase: usedForbiddenPhrase,
    });
  }

  return {
    subject: response.subject,
    body: response.body,
    wordCount,
    rawScore: response.score,
    scoreReasoning: response.scoreReasoning,
  };
}
