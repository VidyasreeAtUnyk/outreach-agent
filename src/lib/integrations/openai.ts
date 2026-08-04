/**
 * Typed wrapper around the OpenAI SDK. This is the only file in the codebase
 * allowed to import the `openai` package directly — lib/agent/* calls
 * `runJsonCompletion` instead of touching the SDK itself, and gets back a
 * value already validated against the Zod schema it supplies (an external
 * API's response is untrusted input, same as a client request body).
 *
 * Every call is metered against a hard budget (the API key in use is capped
 * at 50 total calls) tracked in the `openai_usage` table — see
 * docs/decisions/05-openai-call-budget.md. A call is reserved atomically
 * before the request goes out and only released back if the request itself
 * never got a response; once OpenAI has answered (even with content that
 * fails parsing/validation), the call counts, since it was actually spent.
 */
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServiceClient } from "@/lib/supabase/service";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  cachedClient ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cachedClient;
}

interface UsageReservation {
  allowed: boolean;
  callsUsed: number;
  callBudget: number;
}

/** Atomically reserves one call against the budget. Never throws on budget exhaustion itself — returns allowed: false instead, so the caller can log/report the current counts. */
async function reserveCall(): Promise<UsageReservation> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("increment_openai_usage").single();

  if (error || !data) {
    logger.error("failed to check OpenAI call budget", { error: error?.message });
    throw new IntegrationError("openai", "failed to check the OpenAI call budget", { cause: error });
  }

  const row = data as { calls_used: number; call_budget: number; allowed: boolean };
  return { allowed: row.allowed, callsUsed: row.calls_used, callBudget: row.call_budget };
}

/** Releases a reservation that never reached OpenAI (the request failed before any response), so a network error doesn't burn budget for nothing. Best-effort — logged, not thrown, if it fails. */
async function releaseCall(): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("decrement_openai_usage");
  if (error) {
    logger.error("failed to release an unused OpenAI call reservation", { error: error.message });
  }
}

/**
 * Reads the current OpenAI call budget usage without reserving a call.
 * @param supabase - a request-scoped Supabase client (RLS allows any authenticated user to read this row)
 * @returns calls used, the total budget, and calls remaining
 */
export async function getOpenAiUsage(
  supabase: SupabaseClient,
): Promise<{ callsUsed: number; callBudget: number; remaining: number }> {
  const { data, error } = await supabase
    .from("openai_usage")
    .select("calls_used, call_budget")
    .eq("id", "global")
    .single();

  if (error || !data) {
    logger.warn("failed to read OpenAI usage", { error: error?.message });
    return { callsUsed: 0, callBudget: 0, remaining: 0 };
  }

  return {
    callsUsed: data.calls_used,
    callBudget: data.call_budget,
    remaining: Math.max(0, data.call_budget - data.calls_used),
  };
}

interface RunJsonCompletionParams<T> {
  /** The named prompt constant from lib/prompts.ts describing task, constraints, and output shape. */
  systemPrompt: string;
  /** The per-request dynamic data (research material, project details, etc.) as a plain-text user message. */
  userContent: string;
  /** Validates and types the parsed JSON response. */
  schema: z.ZodType<T>;
  /** Short label used in logs to identify which pipeline step this call belongs to. */
  label: string;
}

/**
 * Runs a single chat completion (model from OPENAI_MODEL) with JSON-object
 * output mode, parses the response, and validates it against the given Zod
 * schema. Reserves one call against the hard budget before making the
 * request and refuses to proceed once exhausted.
 * @param params - system prompt, user content, output schema, and a log label
 * @returns the parsed and validated response, typed as T
 * @throws IntegrationError (code 'budget_exhausted' if our internal call budget is used up, 'rate_limited' if OpenAI's own account-level rate limit was hit) if the budget check fails, the request fails, returns empty content, isn't valid JSON, or fails schema validation
 */
export async function runJsonCompletion<T>(params: RunJsonCompletionParams<T>): Promise<T> {
  const { systemPrompt, userContent, schema, label } = params;

  const reservation = await reserveCall();
  if (!reservation.allowed) {
    logger.error("OpenAI call budget exhausted, refusing to make more calls", {
      label,
      callsUsed: reservation.callsUsed,
      callBudget: reservation.callBudget,
    });
    throw new IntegrationError(
      "openai",
      `call budget exhausted (${reservation.callsUsed}/${reservation.callBudget} used) — refusing to make an OpenAI call for ${label}`,
      { code: "budget_exhausted" },
    );
  }

  let raw: string | null | undefined;
  try {
    const completion = await getClient().chat.completions.create({
      model: env.OPENAI_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    raw = completion.choices[0]?.message?.content;
  } catch (cause) {
    logger.error("openai completion request failed", { label, cause: String(cause) });
    await releaseCall();

    // Distinguish OpenAI's own account-level rate limit (a transient,
    // externally-imposed condition distinct from our internal
    // budget_exhausted check above) so api-utils.ts can surface the
    // upstream message — which already includes a concrete retry-after
    // duration — instead of a generic 500.
    if (cause instanceof OpenAI.APIError && cause.status === 429) {
      throw new IntegrationError("openai", `rate limited for ${label}: ${cause.message}`, {
        cause,
        code: "rate_limited",
      });
    }
    throw new IntegrationError("openai", `completion request failed for ${label}`, { cause });
  }

  if (!raw) {
    throw new IntegrationError("openai", `empty completion response for ${label}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    logger.error("openai response was not valid JSON", { label, raw });
    throw new IntegrationError("openai", `response for ${label} was not valid JSON`, { cause });
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    logger.error("openai response failed schema validation", {
      label,
      issues: result.error.issues,
    });
    throw new IntegrationError(
      "openai",
      `response for ${label} failed schema validation: ${result.error.message}`,
    );
  }

  return result.data;
}
