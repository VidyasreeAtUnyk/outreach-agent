# 03 — Supabase for storage, auth, and tracking

## Context

OutreachAgent needs to persist researched companies, contacts, drafted
emails, their review status, and any replies received — and needs a review
UI backed by that data ([[01-human-in-the-loop]]). It's a single-user tool
today but runs as a deployed Next.js app on Vercel, not a local script, so
state needs to live somewhere durable and queryable, and the deployed app
needs some form of auth so it isn't a public, unauthenticated write surface
for anyone who finds the URL.

## Decision

Use Supabase for both the database and auth:

- **Postgres** for `companies`, `contacts`, `drafts`, and `replies`
  ([[../architecture]] has the full schema), accessed through typed
  wrappers in `lib/supabase/` (`client.ts` for browser components,
  `server.ts` for server components/route handlers using the request's
  cookies, `service.ts` for privileged server-only operations using the
  service-role key).
- **Row Level Security** on every table, scoped to `auth.uid()`, even though
  there is only one user today (see [[../architecture]] for the exact
  policies). RLS is the enforcement mechanism, not an afterthought — it means
  a bug in application code can't leak or corrupt data across users, and it
  costs nothing extra to set up correctly now versus retrofitting it later.
- **Supabase Auth** (email/password to start) for the single login gate at
  `/login`, rather than rolling custom session handling.

## Alternatives rejected

- **Local SQLite / a flat file.** Rejected: the app is deployed to Vercel,
  which has an ephemeral, read-only-except-`/tmp` filesystem — state
  wouldn't survive a redeploy or persist across serverless function
  invocations.
- **Firebase/Firestore.** Rejected: document model is a worse fit for the
  relational structure here (companies → contacts → drafts → replies, with
  filtering/sorting by confidence score, status, industry) than Postgres,
  and we'd still need a separate auth decision.
- **Raw Postgres (e.g. Neon/Supabase-without-the-platform) plus a
  hand-rolled auth library (NextAuth/Lucia).** Rejected for Phase 1: more
  moving parts for no real benefit at single-user scale. Supabase bundles
  Postgres + auth + RLS + a JS client with typed query building, which is
  exactly the surface area this project needs and nothing more.
- **No auth at all (rely on the Vercel deployment URL being obscure).**
  Rejected outright — "security through obscurity" isn't security, and this
  tool writes data (approves drafts, stores contact emails) that shouldn't
  be publicly writable.

## Consequences

- Every table needs `created_at`/`updated_at` and RLS policies from the
  first migration (`supabase/migrations/001_initial.sql`), not added later.
- `lib/supabase/service.ts` (service-role key) is the only place allowed to
  bypass RLS, and it's server-only — never imported into client components
  or exposed to the browser.
- Multi-user support, if ever needed, is mostly "turn on sign-up" rather
  than a schema rewrite, because RLS is already scoped per-user. That said,
  multi-user is explicitly out of scope for Phase 1 (see
  [[04-review-before-send]] and the project README's phase list).
