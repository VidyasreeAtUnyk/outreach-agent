/**
 * Typed wrapper around the Tavily search API. Tavily returns pre-extracted
 * page content ranked by relevance (not just snippets), which is why it's
 * used instead of a raw search API — see
 * docs/decisions/02-tavily-over-raw-search.md. This is the only file that
 * calls Tavily directly; lib/agent/research.ts calls `tavilySearch`.
 */
import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

const tavilyResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number().optional(),
});

const tavilyResponseSchema = z.object({
  query: z.string(),
  answer: z.string().nullable().optional(),
  results: z.array(tavilyResultSchema),
});

export type TavilySearchResult = z.infer<typeof tavilyResultSchema>;

interface TavilySearchOptions {
  /** Maximum number of results to return. Defaults to 5. */
  maxResults?: number;
  /** Whether Tavily should also return a synthesized direct answer. Defaults to false. */
  includeAnswer?: boolean;
}

/**
 * Runs one Tavily web search.
 * @param query - the search query, e.g. "Bayut UAE product features"
 * @param options - result count and answer-synthesis options
 * @returns the search results, or an empty array if the request fails — callers treat search failure as best-effort, not fatal (see docs/architecture.md)
 */
export async function tavilySearch(
  query: string,
  options: TavilySearchOptions = {},
): Promise<TavilySearchResult[]> {
  const { maxResults = 5, includeAnswer = false } = options;

  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: maxResults,
        include_answer: includeAnswer,
        search_depth: "basic",
      }),
    });

    if (!response.ok) {
      throw new IntegrationError(
        "tavily",
        `search request failed with status ${response.status} for query "${query}"`,
      );
    }

    const json: unknown = await response.json();
    const parsed = tavilyResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new IntegrationError(
        "tavily",
        `search response failed schema validation for query "${query}": ${parsed.error.message}`,
      );
    }

    return parsed.data.results;
  } catch (cause) {
    logger.warn("tavily search failed, continuing without these results", {
      query,
      cause: String(cause),
    });
    return [];
  }
}
