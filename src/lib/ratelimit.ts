/**
 * Sliding-window rate limiter for AI-calling API routes: 10 requests per
 * user per hour (see RATE_LIMIT in lib/constants.ts). Backed by an
 * in-process Map, which is deliberately simple for a single-user tool —
 * see the caveat below before reusing this for anything at multi-instance
 * scale.
 *
 * Caveat: on Vercel's serverless runtime each invocation can land on a
 * different warm instance, so this counter is per-instance, not globally
 * consistent. For a single authenticated user making a handful of requests
 * an hour, that's an acceptable approximation of the limit rather than a
 * cryptographically enforced one — its purpose is to catch runaway loops
 * and accidental double-submits, not to defend against a determined abuser.
 * If this tool grows beyond single-user, replace the Map below with a
 * shared store (e.g. Supabase table or Upstash Redis) behind this same
 * function signature.
 */
import { RATE_LIMIT } from "@/lib/constants";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

const requestLog = new Map<string, number[]>();

/**
 * Checks and records one request attempt for the given user.
 * @param userId - the authenticated user's id, used as the rate-limit key
 * @returns whether the request is allowed, how many requests remain in the current window, and when the window resets
 */
export function checkRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.WINDOW_MS;

  const existing = requestLog.get(userId) ?? [];
  const withinWindow = existing.filter((timestamp) => timestamp > windowStart);

  const allowed = withinWindow.length < RATE_LIMIT.MAX_REQUESTS_PER_WINDOW;

  if (allowed) {
    withinWindow.push(now);
  }
  requestLog.set(userId, withinWindow);

  const oldestInWindow = withinWindow[0] ?? now;
  const resetAt = new Date(oldestInWindow + RATE_LIMIT.WINDOW_MS);
  const remaining = Math.max(0, RATE_LIMIT.MAX_REQUESTS_PER_WINDOW - withinWindow.length);

  return { allowed, remaining, resetAt };
}
