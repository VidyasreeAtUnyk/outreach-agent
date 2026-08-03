/**
 * Shared test doubles for app/api/** route handler integration tests.
 * Routes call requireUser() (lib/api-utils.ts), which calls
 * lib/supabase/server.ts's createClient() — each route test mocks that
 * module so no real Supabase project or next/headers request context is
 * needed, and queues canned {data, error} responses for the sequence of
 * `.single()`/`.maybeSingle()` calls the route under test is expected to make.
 */
import { vi } from "vitest";

export interface QueuedResponse {
  data: unknown;
  error: unknown;
}

/** A minimal fake Supabase client: every query-builder method is chainable and returns queued responses in call order. */
export function createMockSupabase(queue: QueuedResponse[]) {
  let index = 0;
  const next = (): QueuedResponse => queue[index++] ?? { data: null, error: null };

  const builder: Record<string, unknown> = {};
  const chainable = ["select", "insert", "update", "eq", "in", "order", "limit"];
  for (const method of chainable) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => next());
  builder.maybeSingle = vi.fn(async () => next());

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "vidya@example.com" } } })),
    },
    from: vi.fn(() => builder),
  };
}

export const TEST_USER_ID = "user-1";
