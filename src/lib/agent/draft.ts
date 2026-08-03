/**
 * Drafts the cold job-application email for a researched company using the
 * matched project as proof of capability. See lib/prompts.ts EMAIL_DRAFT
 * for the full instructions given to the model.
 */
import { z } from "zod";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { PROMPTS } from "@/lib/prompts";
import { PROFILE } from "@/lib/profile";
import { EMAIL_CONSTRAINTS } from "@/lib/constants";
import { logger } from "@/lib/logger";
import type { Project } from "@/lib/projects";
import type { DraftEmailResult } from "@/types";

const draftResponseSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export interface DraftableCompany {
  name: string;
  industry: string | null;
  painPoint: string | null;
  description: string | null;
  techSignals: string[];
  hiringSignals: string[];
  recentNews: string | null;
}

export interface DraftEmailParams {
  company: DraftableCompany;
  contactName: string | null;
  contactTitle: string | null;
  project: Project;
  /** The specific role being applied for, if the human specified one when submitting the company. */
  roleAppliedFor?: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildUserContent(params: DraftEmailParams): string {
  const { company, contactName, contactTitle, project, roleAppliedFor } = params;

  return JSON.stringify({
    company: {
      name: company.name,
      industry: company.industry,
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
  });
}

/**
 * Generates the cold job-application email subject and body for a company/project pair.
 * @param params - the researched company, contact, matched project, and optional role being applied for
 * @returns the drafted subject, body, and computed word count
 */
export async function draftEmail(params: DraftEmailParams): Promise<DraftEmailResult> {
  const response = await runJsonCompletion({
    systemPrompt: PROMPTS.EMAIL_DRAFT,
    userContent: buildUserContent(params),
    schema: draftResponseSchema,
    label: "email-draft",
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
  };
}
