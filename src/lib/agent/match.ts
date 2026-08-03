/**
 * Matches a researched company to the strongest-fitting project in
 * lib/projects.ts. Deterministic and synchronous (no LLM call) — the
 * matching signal (industry, pain point, tech stack) is already structured
 * data by the time this runs, so a weighted keyword-overlap score is both
 * cheaper and more testable than asking a model to re-derive the same
 * judgment. See docs/architecture.md for the weighting rationale.
 */
import { PROJECTS, type Project } from "@/lib/projects";
import type { MatchResult } from "@/types";

const PAIN_POINT_WEIGHT = 0.5;
const INDUSTRY_WEIGHT = 0.3;
const TECH_SIGNAL_WEIGHT = 0.2;

export interface MatchableCompany {
  industry: string | null;
  painPoint: string | null;
  description: string | null;
  techSignals: string[];
  hiringSignals: string[];
}

function tagToWords(tag: string): string[] {
  return tag.split("_").filter(Boolean);
}

function textContainsWords(haystack: string, words: string[]): boolean {
  return words.every((word) => haystack.includes(word));
}

/** Fraction (0-1) of a project's relevantPainPoints tags found as word-groups in the company's pain point/description/hiring signals text. */
function scorePainPointMatch(project: Project, company: MatchableCompany): number {
  const haystack = [
    company.painPoint ?? "",
    company.description ?? "",
    ...company.hiringSignals,
  ]
    .join(" ")
    .toLowerCase();

  if (project.relevantPainPoints.length === 0) return 0;

  const hits = project.relevantPainPoints.filter((tag) => textContainsWords(haystack, tagToWords(tag)));
  return hits.length / project.relevantPainPoints.length;
}

/** 1 if the company's classified industry is in the project's relevant industries, else 0. */
function scoreIndustryMatch(project: Project, company: MatchableCompany): number {
  if (!company.industry) return 0;
  return project.relevantIndustries.includes(company.industry) ? 1 : 0;
}

/** Fraction (0-1) of the project's stack entries that appear in the company's detected tech signals. */
function scoreTechSignalMatch(project: Project, company: MatchableCompany): number {
  if (project.stack.length === 0 || company.techSignals.length === 0) return 0;

  const haystack = company.techSignals.join(" ").toLowerCase();
  const hits = project.stack.filter((tech) => haystack.includes(tech.toLowerCase()));
  return hits.length / project.stack.length;
}

function buildReasoning(
  project: Project,
  company: MatchableCompany,
  scores: { painPoint: number; industry: number; tech: number },
): string {
  const parts: string[] = [];

  if (scores.industry > 0) {
    parts.push(`industry (${company.industry}) matches this project's target industries`);
  }
  if (scores.painPoint > 0) {
    parts.push(`the company's pain point overlaps with what this project demonstrates`);
  }
  if (scores.tech > 0) {
    parts.push(`detected tech signals overlap with this project's stack`);
  }

  if (parts.length === 0) {
    return `No strong signal match found; "${project.name}" was selected as the closest available fit by default.`;
  }

  return `"${project.name}" was selected because ${parts.join(", and ")}.`;
}

/**
 * Scores every project in the registry against a researched company and returns the best match.
 * @param company - the researched company's industry, pain point, description, and detected signals
 * @returns the top-scoring project's id, its 0-10 score, human-readable reasoning, and whether its demo needs a customisation note
 */
export function matchCompanyToProject(company: MatchableCompany): MatchResult {
  let best: { project: Project; total: number; painPoint: number; industry: number; tech: number } | null =
    null;

  for (const project of PROJECTS) {
    const painPoint = scorePainPointMatch(project, company);
    const industry = scoreIndustryMatch(project, company);
    const tech = scoreTechSignalMatch(project, company);
    const total = painPoint * PAIN_POINT_WEIGHT + industry * INDUSTRY_WEIGHT + tech * TECH_SIGNAL_WEIGHT;

    if (!best || total > best.total) {
      best = { project, total, painPoint, industry, tech };
    }
  }

  // PROJECTS is a non-empty const array, so best is always assigned above.
  const winner = best as NonNullable<typeof best>;

  const needsCustomisation = winner.project.demo === null || winner.industry === 0;
  const customisationNotes = needsCustomisation
    ? winner.project.demo === null
      ? "No live demo available for this project — lead with the GitHub repo and offer a live walkthrough on the call."
      : "This company's industry doesn't closely match the project's usual domain — consider a line reframing the demo in terms relevant to this company."
    : null;

  return {
    projectId: winner.project.id,
    score: Math.round(winner.total * 10),
    reasoning: buildReasoning(winner.project, company, {
      painPoint: winner.painPoint,
      industry: winner.industry,
      tech: winner.tech,
    }),
    needsCustomisation,
    customisationNotes,
  };
}
