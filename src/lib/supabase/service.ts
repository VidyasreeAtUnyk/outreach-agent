/**
 * Privileged Supabase client using the service-role key, which bypasses RLS
 * entirely. Server-only, and deliberately not used by any app/api route —
 * every route runs as the authenticated user via lib/supabase/server.ts so
 * RLS stays the actual enforcement layer (see docs/decisions/03-supabase-for-tracking.md).
 * This client exists for the one legitimate case that has no authenticated
 * request context to inherit: scripts/seed.ts, run directly from the CLI.
 *
 * Not parameterized with the hand-written `Database` type — see the comment
 * in lib/supabase/client.ts for why.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/service.ts uses the service-role key and must never be imported into client code.",
  );
}

export function createServiceClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
