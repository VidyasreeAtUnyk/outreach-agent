/**
 * Small shared helpers for app/api/** route handlers: authenticating the
 * request, checking the rate limit, and shaping consistent JSON error
 * responses, so each route stays focused on its own input validation and
 * business-logic composition instead of repeating this boilerplate.
 */
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Resolves the authenticated user for the current request via Supabase, or throws a 401 ApiError.
 * @returns the authenticated Supabase client and user
 */
export async function requireUser(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ApiError(401, "Not authenticated.");
  }

  return { supabase, user };
}

/**
 * Enforces the per-user AI rate limit, or throws a 429 ApiError.
 * @param userId - the authenticated user's id
 */
export function requireWithinRateLimit(userId: string): void {
  const result = checkRateLimit(userId);
  if (!result.allowed) {
    throw new ApiError(
      429,
      `Rate limit exceeded. Try again after ${result.resetAt.toISOString()}.`,
    );
  }
}

/**
 * Converts a thrown error into a JSON error response with an appropriate status code, logging unexpected errors.
 * @param error - the caught error
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (
    error instanceof IntegrationError &&
    (error.code === "budget_exhausted" || error.code === "rate_limited")
  ) {
    return NextResponse.json({ error: error.message }, { status: 429 });
  }

  logger.error("unhandled API route error", { error: String(error) });
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}
