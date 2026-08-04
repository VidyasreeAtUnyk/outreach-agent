/**
 * Finds candidate companies matching a natural-language description (e.g.
 * "AI agent companies with UAE presence") and persists each as a
 * lightweight 'discovered' companies row — name, URL, and a relevance
 * score, everything else null — for the human to review and selectively
 * send through the full research pipeline (lib/agent/research.ts), or to
 * feed into an automated batch run that processes candidates in score
 * order (see lib/agent/batch.ts).
 *
 * Deliberately does NOT research every candidate automatically: one
 * discovery run costs one Tavily search plus exactly one OpenAI call (to
 * extract clean company names/URLs *and* a relevance score from the noisy
 * search results), no matter how many candidates it finds. Fully
 * researching a candidate is a separate, explicit action, which is what
 * actually spends OpenAI budget — see docs/decisions/07-company-discovery.md
 * for why this split matters against a 50-call lifetime OpenAI cap.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tavilySearch } from "@/lib/integrations/tavily";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { PROMPTS } from "@/lib/prompts";
import { logger } from "@/lib/logger";
import { extractDomain } from "@/lib/utils";
import { RESEARCH_STATUS } from "@/lib/constants";
import type { DiscoverCompaniesOutput, DiscoveredCompany } from "@/types";

const discoveryResponseSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string().min(1),
      url: z.string().min(1),
      reason: z.string().min(1),
      relevanceScore: z.number(),
    }),
  ),
});

export interface DiscoverCompaniesParams {
  /** Natural-language description of the kind of company to find, e.g. "AI agent companies with UAE presence". */
  query: string;
  userId: string;
  supabase: SupabaseClient;
}

function clampScore(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score)));
}

/**
 * Searches for and persists candidate companies matching a description, sorted by relevance score descending.
 * @param params - the discovery query and the authenticated Supabase client/user to save under
 * @returns the discovered (or already-known) candidates in priority order, plus which steps were skipped due to upstream failures
 */
export async function discoverCompanies(params: DiscoverCompaniesParams): Promise<DiscoverCompaniesOutput> {
  const { query, userId, supabase } = params;
  const incompleteSteps: string[] = [];

  const searchResults = await tavilySearch(`${query} company UAE`, { maxResults: 8 });
  if (searchResults.length === 0) {
    incompleteSteps.push("discovery_search");
    return { discovered: [], incompleteSteps };
  }

  const extraction = await runJsonCompletion({
    systemPrompt: PROMPTS.COMPANY_DISCOVERY,
    userContent: JSON.stringify({
      targetDescription: query,
      searchResults: searchResults.map((r) => ({ title: r.title, url: r.url, content: r.content })),
    }),
    schema: discoveryResponseSchema,
    label: "company-discovery",
  });

  if (extraction.companies.length === 0) {
    incompleteSteps.push("no_candidates_extracted");
    return { discovered: [], incompleteSteps };
  }

  const sortedCandidates = [...extraction.companies].sort((a, b) => b.relevanceScore - a.relevanceScore);

  const { data: existingRows, error: existingError } = await supabase
    .from("companies")
    .select("id, name, url")
    .eq("user_id", userId);

  if (existingError) {
    logger.warn("failed to load existing companies for discovery dedup, may create duplicates", {
      error: existingError.message,
    });
  }

  const existingByDomain = new Map(
    (existingRows ?? []).map((row: { id: string; name: string; url: string }) => [extractDomain(row.url), row]),
  );

  const discovered: DiscoveredCompany[] = [];

  for (const candidate of sortedCandidates) {
    const domain = extractDomain(candidate.url);
    const existing = existingByDomain.get(domain);
    const score = clampScore(candidate.relevanceScore);

    if (existing) {
      discovered.push({
        id: existing.id,
        name: existing.name,
        url: existing.url,
        reason: candidate.reason,
        score,
        alreadyKnown: true,
      });
      continue;
    }

    const { data: row, error: insertError } = await supabase
      .from("companies")
      .insert({
        user_id: userId,
        name: candidate.name,
        url: candidate.url,
        research_status: RESEARCH_STATUS.DISCOVERED,
        discovery_score: score,
      })
      .select("id, name, url")
      .single();

    if (insertError || !row) {
      logger.warn("failed to save a discovered candidate, skipping it", {
        candidate: candidate.name,
        error: insertError?.message,
      });
      continue;
    }

    discovered.push({ id: row.id, name: row.name, url: row.url, reason: candidate.reason, score, alreadyKnown: false });
    existingByDomain.set(domain, row);
  }

  return { discovered, incompleteSteps };
}
