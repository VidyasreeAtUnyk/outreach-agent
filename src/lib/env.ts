/**
 * Validates process.env against a strict Zod schema at import time. Any
 * server code that needs an environment variable should import `env` from
 * here rather than reading `process.env` directly — that way a missing or
 * malformed variable fails the app at startup with a clear message instead
 * of surfacing as a confusing runtime error deep in an API route.
 *
 * Server-only: this module reads secrets (OpenAI/Tavily/Hunter/Supabase
 * service-role keys) that must never reach the client bundle. Never import
 * it from a "use client" component — only from route handlers, server
 * components, and lib/integrations/*.
 */
import { z } from "zod";

if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/env.ts was imported in a client context. It contains server-only secrets and must only be imported from server components, route handlers, or lib/integrations/*.",
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url({
    message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL, e.g. https://xyzcompany.supabase.co",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required").startsWith("sk-", {
    message: "OPENAI_API_KEY should start with 'sk-'",
  }),
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),
  HUNTER_API_KEY: z.string().min(1, "HUNTER_API_KEY is required"),

  // Phase 2 — not called anywhere yet, see docs/decisions/04-review-before-send.md.
  // Optional so Phase 1 setup doesn't require a Resend account.
  RESEND_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${issues}\n\nSee .env.example for the full list of required variables.`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();
