# Build log

Phase-by-phase record of what was built, decisions made along the way, and
bugs found and fixed. Written as the tool was built, not reconstructed
afterward — see the project's documentation standard in the root spec.

## Phase 0 — Scaffold

**Built:** Ran `create-next-app` to scaffold the project. It defaulted to
Next.js 16 / React 19 / Tailwind v4 (latest at time of scaffolding), which
doesn't match the project's pinned stack (Next.js 14, and shadcn/ui's CLI
and component output are built against Tailwind v3's config-file model).

**Decision:** Repinned `package.json` to `next@^14.2.18`, `react@^18.3.1`,
`react-dom@^18.3.1`, `tailwindcss@^3.4.13` + `autoprefixer`, and
`eslint-config-next@^14.2.18` (which needs ESLint 8, not the flat-config
ESLint 9 the scaffold installed). Rewrote `postcss.config.mjs` for the v3
`tailwindcss`/`autoprefixer` plugin pair, added `tailwind.config.ts` with
the shadcn/ui CSS-variable color/radius theme, rewrote `globals.css` from
Tailwind v4's `@import "tailwindcss"` + `@theme inline` syntax to v3's
`@tailwind base/components/utilities` + `:root`/`.dark` HSL variables, and
switched ESLint from the generated flat `eslint.config.mjs` to a legacy
`.eslintrc.json` (`next/core-web-vitals`, `next/typescript`) since
`eslint-config-next@14` targets that convention.

**Bug found:** none yet at this stage — caught the version mismatch before
writing any application code by checking `next/package.json` right after
scaffolding.

## Phase 1 — Documentation

**Built:** `docs/decisions/01`–`04` (human-in-the-loop, Tavily over raw
search, Supabase for tracking, review-before-send/deferred phases),
`docs/architecture.md` (system diagram, layering rules, error-handling
philosophy, data model summary, matching/scoring logic, rate limiting), and
this build log — all written before any `lib/` or `app/` code, per the
"docs before code" standard.

**Decision:** Folded "what we're explicitly not building in Phase 1" into
decision 04 rather than a separate document, since the reasoning for
deferring automated sending and the reasoning for deferring the other
Phase 2/3 features (auto-discovery, Gmail webhook, LinkedIn scraping,
multi-user, analytics) share the same shape (why-not-now, not just a list)
and read better together than split across files.

## Phase 2 — Database migration

**Built:** `supabase/migrations/001_initial.sql` — `companies`, `contacts`,
`drafts`, `replies`, all with `user_id default auth.uid()`, RLS policies
scoped to `auth.uid()` on every table, an `updated_at` trigger, and CHECK
constraints mirroring the enums used in `src/lib/constants.ts` (`status`,
`sentiment`, confidence score range).

**Decision:** Added a `drafts.match_reasoning` column that wasn't in the
original schema spec (which only listed `confidence_reason`). The review
UI mockup needs a separate "Why was this project picked" line distinct
from "Why this confidence score" — `confidence_reason` alone can't carry
both without conflating `lib/agent/match.ts`'s reasoning with
`lib/agent/score.ts`'s. Since this is the project's own first migration
(no live data to preserve), extending it directly was simpler and more
honest than shoehorning both reasons into one text field. See
`docs/architecture.md`'s data model section.

## Phase 3 — Environment, types, constants

**Built:** `src/lib/env.ts` (Zod-validated `process.env`, throws a
readable multi-issue error at import time, guarded against client-side
import), `src/types/index.ts` (domain types mirroring the schema, plus
pipeline result types), `src/lib/constants.ts` (status enums, industry
enum, rate limit numbers, route paths — every string reused across more
than one file).

## Phase 4 — Cross-cutting lib utilities

**Built:** `src/lib/logger.ts` (structured JSON log lines, one sanctioned
`console.*` call site in the whole app), `src/lib/ratelimit.ts` (in-process
sliding-window limiter, 10 req/user/hour), `src/lib/profile.ts` and
`src/lib/projects.ts` (typed constants from the spec), `src/lib/prompts.ts`
(all four OpenAI prompts as named system-prompt constants).

**Decision:** Prompts are system-prompt instructions only; per-request
dynamic data (company research, project details, contact name) is built
by the calling `lib/agent/*` function as the user message. Keeps the
prompt constants stable and readable instead of template-stringing data
into them.

**Decision:** `lib/ratelimit.ts` is an in-memory Map, explicitly
documented as a per-instance approximation, not a globally consistent
limit — correct behavior for a single-user tool guarding against runaway
loops, wrong if this ever needs to defend against a determined multi-
instance abuser. See the file's own header comment.

## Phase 5 — Supabase client wrappers

**Built:** `lib/supabase/client.ts` (browser), `server.ts` (request-scoped,
cookie-based), `service.ts` (service-role, seed-script-only), plus
`lib/supabase/types.ts` (hand-written row types) and `mappers.ts`
(snake_case → camelCase at the query boundary).

**Bug found:** The installed `@supabase/supabase-js` resolved to `2.111.0`
(package.json only pinned `^2.45.4`), whose `SupabaseClient` generic
contract expects a `Database` shape matching what `supabase gen types
typescript` produces against a live project (including an internal
`PostgrestVersion` marker), not a hand-rolled `GenericSchema`. Fighting
that contract by hand was fragile and version-specific. **Fix:** dropped
the `Database` generic parameter from all three client constructors —
the real type-safety boundary is `lib/supabase/mappers.ts`, whose
functions are typed against `lib/supabase/types.ts`'s row interfaces
regardless of what the client itself returns. Documented in each file's
header comment so it isn't "fixed" back to a broken generic later.

## Phase 6 — Integrations

**Built:** `lib/integrations/openai.ts` (JSON-mode completions + Zod
validation of the parsed response), `tavily.ts` (search, best-effort —
returns `[]` on failure rather than throwing), `hunter.ts` (executive
contact lookup by domain, and named-contact lookup), `webpage.ts` (direct
homepage fetch/strip, no API key), `resend.ts` (Phase 2 stub, throws if
ever called), `errors.ts` (shared `IntegrationError`).

## Phase 7 — Agent pipeline

**Built:** `lib/agent/match.ts` (deterministic weighted keyword-overlap
scoring — no LLM call), `lib/agent/draft.ts` and `score.ts` (both call
`runJsonCompletion`), `lib/agent/research.ts` (orchestrates Tavily ×3 +
homepage fetch + OpenAI synthesis + Hunter + Supabase persistence).

**Decision:** `match.ts` is synchronous and LLM-free. The matching signal
(industry classification, pain-point text, tech signals) is already
structured data by the time this runs — asking a model to re-derive a
project-fit judgment from it would cost latency and money for a decision
that a weighted keyword-overlap score makes just as legibly, and
deterministic scoring is trivially unit-testable without mocking OpenAI.

**Decision:** `score.ts` takes the model's numeric score and reasoning,
but always derives the `send`/`review`/`skip` recommendation itself from
`SCORE_THRESHOLDS`, ignoring whatever recommendation string the model
might also produce. Guarantees the bands shown in the UI are always
consistent with the number next to them, regardless of model drift.

**Bug found:** Initial `lib/projects.ts` used `as const` on the whole
`PROJECTS` array, which gave every project's `relevantIndustries` /
`relevantPainPoints` / `stack` arrays literal-length readonly tuple types.
TypeScript then treated comparisons like `project.stack.length === 0`
as comparing incompatible numeric literal types (e.g. `4` vs `0`) across
the five different project shapes, since `Project` was inferred per-array
rather than as one shared interface. **Fix:** defined an explicit
`Project` interface with `readonly string[]` array fields and annotated
`PROJECTS: readonly Project[]`, which widens the literal tuples to plain
arrays while still checking each object against the shared shape.

## Phase 8 — API routes

**Built:** `POST /api/research` (full pipeline, rate limited),
`POST /api/draft` (regenerate for an existing company, rate limited),
`POST /api/outreach/{approve,edit,reject}`, `POST /api/tracker/reply`
(rate limited), `POST /api/tracker/mark-sent`, `GET /api/health`. Shared
`lib/api-utils.ts` (`requireUser`, `requireWithinRateLimit`,
`toErrorResponse`) so each route's own code is just validation +
composition.

**Decision:** Added `/api/tracker/mark-sent` and `/api/health`, neither
of which was in the original route list. `mark-sent` is the only place
`drafts.status` becomes `'sent'` (the tracker page's "mark as sent"
button needs *some* endpoint, and folding it into `approve` would blur
the approve/send boundary the human-in-the-loop decision depends on).
`health` gives the auth middleware an unauthenticated path to exclude,
and something for uptime checks to hit.

## Phase 9 — UI

**Built:** shadcn/ui primitives (button, card, badge, input, textarea,
label, select, dialog) hand-written rather than via the `shadcn` CLI —
the CLI needs an interactive/network init step, and with the Radix
peer deps and CSS variables already in place by Phase 0's Tailwind
setup, writing the (standard, well-known) component output directly was
faster and produces identical files. `(auth)/login`, `(dashboard)`
layout + `page.tsx` (dashboard), `research`, `review`, `review/[id]`,
`tracker` pages, each with its own `error.tsx` boundary (sharing a
`RouteError` component for consistent logging/UI), plus
`src/middleware.ts` for the auth redirect.

**Decision:** `/research`'s progress indicator is a client-side cycling
staged message (`CompanyForm.tsx`), not real SSE progress from
`/api/research`. The pipeline runs as one synchronous request taking on
the order of tens of seconds; true streaming progress would mean
restructuring the route as SSE and threading a progress callback through
every `lib/agent/*` function, which isn't justified yet for a tool
researching a handful of companies a day. Documented in the component's
own header comment as a trade-off to revisit if the pipeline gets slower
or the single-request UX starts feeling wrong.

## Phase 10 — Tests and CI

**Built:** Vitest unit tests for `match.ts` (pure), `score.ts` and
`draft.ts` (mocked `runJsonCompletion`), `research.ts` (mocked
integrations + a fake chainable Supabase client). Integration tests for
all seven mutating API routes plus rate-limit/validation edge cases,
using a shared `tests/integration/helpers.ts` mock Supabase client.
Playwright `tests/e2e/review-flow.spec.ts` for the sign-in → review →
edit → approve → tracker → mark-sent path — skips itself when
`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` aren't set, since it runs against a
real (test) Supabase project rather than mocking auth. GitHub Actions
`ci.yml`: lint + typecheck + unit/integration tests + build always; e2e
job gated behind a repo variable since it needs real secrets.

## Phase 11 — Seed data and final verification

**Built:** `scripts/seed.ts` (service-role client; 3 companies at
different confidence levels, 2 drafts, 1 reply — matches the spec's seed
data exactly), `.env.example` documenting every variable.

**Verification performed:** `tsc --noEmit` (strict, clean), `eslint`
(clean), `vitest run` (30/30 passing), `next build` (clean, all 17
routes compile). Smoke-tested the running dev server in a browser
against placeholder env vars: confirmed the auth middleware redirects
`/` → `/login`, the login page renders with no console errors, and
`/api/health` bypasses auth as designed. Did **not** verify the live
research/review/tracker flow end-to-end — that needs real Supabase,
OpenAI, Tavily, and Hunter credentials, which weren't available in this
environment. That's the first thing to do manually after filling in
`.env.local` with real keys.
