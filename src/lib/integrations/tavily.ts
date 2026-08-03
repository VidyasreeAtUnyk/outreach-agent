/**
 * Typed wrapper around the Tavily search API. Tavily returns pre-extracted
 * page content ranked by relevance (not just snippets), which is why it's
 * used instead of a raw search API — see
 * docs/decisions/02-tavily-over-raw-search.md. This is the only file that
 * calls Tavily directly; lib/agent/research.ts calls `tavilySearch`.
 *
 * Every search is metered against a monthly credit quota (1000/month on the
 * plan in use) tracked in the `tavily_usage` table — see
 * docs/decisions/05-external-api-budgets.md. A credit is reserved
 * atomically before the request goes out; once a month's quota is
 * exhausted, `tavilySearch` returns `[]` rather than throwing, the same as
 * any other Tavily failure (see docs/architecture.md's error-handling
 * philosophy) — a thin/missing search result shouldn't fail the whole
 * research pipeline.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServiceClient } from "@/lib/supabase/service";

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
  /** Maximum number of results to return. Defaults to 3 — kept lean since this also feeds directly into the OpenAI synthesis prompt (see docs/decisions/05-external-api-budgets.md). */
  maxResults?: number;
  /** Whether Tavily should also return a synthesized direct answer. Defaults to false. */
  includeAnswer?: boolean;
}

interface CreditReservation {
  allowed: boolean;
  creditsUsed: number;
  creditBudget: number;
}

/** Atomically reserves one credit against the current month's quota. Never throws on exhaustion — returns allowed: false so the caller can skip the search gracefully. */
async function reserveCredit(): Promise<CreditReservation> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("increment_tavily_usage").single();

  if (error || !data) {
    logger.warn("failed to check Tavily credit budget, proceeding without metering this call", {
      error: error?.message,
    });
    return { allowed: true, creditsUsed: 0, creditBudget: 0 };
  }

  const row = data as { credits_used: number; credit_budget: number; allowed: boolean };
  return { allowed: row.allowed, creditsUsed: row.credits_used, creditBudget: row.credit_budget };
}

/** Releases a reservation that never reached Tavily (the request failed before any response). Best-effort — logged, not thrown, if it fails. */
async function releaseCredit(): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("decrement_tavily_usage");
  if (error) {
    logger.warn("failed to release an unused Tavily credit reservation", { error: error.message });
  }
}

/**
 * Reads the current month's Tavily credit usage without reserving a credit.
 * @param supabase - a request-scoped Supabase client (RLS allows any authenticated user to read this row)
 * @returns credits used this month, the monthly budget, and credits remaining
 */
export async function getTavilyUsage(
  supabase: SupabaseClient,
): Promise<{ creditsUsed: number; creditBudget: number; remaining: number }> {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const { data, error } = await supabase
    .from("tavily_usage")
    .select("credits_used, credit_budget")
    .eq("period", currentPeriod)
    .maybeSingle();

  if (error) {
    logger.warn("failed to read Tavily usage", { error: error.message });
    return { creditsUsed: 0, creditBudget: 0, remaining: 0 };
  }

  // No row yet this month means nobody has searched since the month rolled over — full quota available.
  const creditsUsed = data?.credits_used ?? 0;
  const creditBudget = data?.credit_budget ?? 1000;

  return { creditsUsed, creditBudget, remaining: Math.max(0, creditBudget - creditsUsed) };
}

/**
 * Runs one Tavily web search.
 * @param query - the search query, e.g. "Bayut UAE product features"
 * @param options - result count and answer-synthesis options
 * @returns the search results, or an empty array if the request fails or the monthly credit quota is exhausted — callers treat search failure as best-effort, not fatal (see docs/architecture.md)
 */
export async function tavilySearch(
  query: string,
  options: TavilySearchOptions = {},
): Promise<TavilySearchResult[]> {
  const { maxResults = 3, includeAnswer = false } = options;

  const reservation = await reserveCredit();
  if (!reservation.allowed) {
    logger.warn("tavily credit budget exhausted for this month, skipping search", {
      query,
      creditsUsed: reservation.creditsUsed,
      creditBudget: reservation.creditBudget,
    });
    return [];
  }

  let response: Response;
  try {
    response = await fetch(TAVILY_ENDPOINT, {
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
  } catch (cause) {
    await releaseCredit();
    logger.warn("tavily search request failed, continuing without these results", {
      query,
      cause: String(cause),
    });
    return [];
  }

  try {
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
    // A response was received (even if it wasn't usable), so the credit was
    // actually spent — do not release it.
    logger.warn("tavily search failed, continuing without these results", {
      query,
      cause: String(cause),
    });
    return [];
  }
}
