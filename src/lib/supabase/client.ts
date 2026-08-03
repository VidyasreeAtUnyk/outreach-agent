/**
 * Browser-side Supabase client. Use only from "use client" components that
 * need direct Supabase access (e.g. for Supabase Auth's client-side sign-in
 * flow). Uses the public anon key, which is safe to expose to the browser —
 * RLS (supabase/migrations/001_initial.sql) is what actually enforces access
 * control, not this key being secret.
 *
 * Not parameterized with the hand-written `Database` type from
 * lib/supabase/types.ts: that file exists to type the mapper functions in
 * lib/supabase/mappers.ts (the actual type-safety boundary for query
 * results), not to satisfy supabase-js's generated-types generic contract,
 * which changes shape between SDK versions and is meant to be produced by
 * `supabase gen types typescript` against a live project rather than
 * hand-maintained here.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
