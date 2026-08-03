/**
 * Typed wrapper around the OpenAI SDK. This is the only file in the codebase
 * allowed to import the `openai` package directly — lib/agent/* calls
 * `runJsonCompletion` instead of touching the SDK itself, and gets back a
 * value already validated against the Zod schema it supplies (an external
 * API's response is untrusted input, same as a client request body).
 */
import OpenAI from "openai";
import type { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";

const MODEL = "gpt-4o";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  cachedClient ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cachedClient;
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
 * Runs a single chat completion against GPT-4o with JSON-object output mode,
 * parses the response, and validates it against the given Zod schema.
 * @param params - system prompt, user content, output schema, and a log label
 * @returns the parsed and validated response, typed as T
 * @throws IntegrationError if the request fails, returns empty content, isn't valid JSON, or fails schema validation
 */
export async function runJsonCompletion<T>(params: RunJsonCompletionParams<T>): Promise<T> {
  const { systemPrompt, userContent, schema, label } = params;

  let raw: string | null | undefined;
  try {
    const completion = await getClient().chat.completions.create({
      model: MODEL,
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
    throw new IntegrationError("openai", `completion request failed for ${label}`, cause);
  }

  if (!raw) {
    throw new IntegrationError("openai", `empty completion response for ${label}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    logger.error("openai response was not valid JSON", { label, raw });
    throw new IntegrationError("openai", `response for ${label} was not valid JSON`, cause);
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
