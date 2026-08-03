/**
 * Request-scoped Supabase client for server components and route handlers.
 * Reads the session from the incoming request's cookies, so every query
 * made through this client runs as the logged-in user and is subject to
 * that user's RLS policies (supabase/migrations/001_initial.sql) — this is
 * the client almost everything in app/ should use.
 *
 * Not parameterized with the hand-written `Database` type — see the comment
 * in lib/supabase/client.ts for why.
 */
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll is called from a Server Component during render, where
            // cookies can't be mutated — safe to ignore because middleware
            // refreshes the session on every request instead.
          }
        },
      },
    },
  );
}
