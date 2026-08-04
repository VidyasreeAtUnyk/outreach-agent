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

## Phase 12 — External API budgets (OpenAI 50-call cap, Tavily 1000/month)

**Built:** `supabase/migrations/002_openai_usage.sql` and
`003_tavily_usage.sql` — atomic reserve-before-call Postgres functions
(`increment_openai_usage`/`increment_tavily_usage`, plus matching
`decrement_*` release functions for requests that never got a response).
Wired into `lib/integrations/openai.ts`'s `runJsonCompletion` and
`lib/integrations/tavily.ts`'s `tavilySearch`, the only two call sites for
either API. `getOpenAiUsage`/`getTavilyUsage` expose the counters; the
dashboard shows both as color-shifting stat cards
(`src/app/(dashboard)/page.tsx`'s new `UsageCard`). Added `OPENAI_MODEL`
env var (default `gpt-5.4-mini`) so the model isn't hardcoded. Full
reasoning in `docs/decisions/05-external-api-budgets.md`.

**Decision:** OpenAI exhaustion is a hard failure (`IntegrationError` with
`code: 'budget_exhausted'`, mapped to a `429` in `lib/api-utils.ts`);
Tavily exhaustion degrades silently (returns `[]`, same as any other
Tavily failure) because `tavilySearch` already treated failures as
best-effort before this change — see `docs/architecture.md`'s error-
handling philosophy, which this is consistent with rather than a new
carve-out.

**Decision:** Combined `lib/agent/draft.ts` and `lib/agent/score.ts`'s
OpenAI calls into one (`EMAIL_DRAFT_AND_SCORE` in `lib/prompts.ts`),
cutting every research/regenerate run from 3 calls to 2. Against a
50-call *lifetime* cap this roughly doubles how many companies can be
researched (≈16 → ≈25). `score.ts` is now a pure function
(`deriveScoreResult`) with no OpenAI call — it just clamps the model's
raw score and derives the recommendation deterministically, which was
already its role for the recommendation half before this change.

**Bug found while writing the reserve/release tests:** the two RPC calls
in `lib/integrations/openai.ts`/`tavily.ts` are used two different ways —
`.rpc(name).single()` for the increment (needs the row back) and a bare
`await .rpc(name)` for the decrement (just needs the error, if any). The
initial test mock's fake `.rpc()` only implemented `.single()`, so the
decrement-path tests hung awaiting a non-thenable. **Fix:** the test
double's `.rpc()` result implements both `.single()` and `.then()` so it
works either way tests/unit/openai-budget.test.ts and
tests/unit/tavily-budget.test.ts call it.

**Verification performed:** `tsc --noEmit` (clean), `eslint` (clean),
`vitest run` (41/41 passing, including 8 new reserve/release/skip tests
across the two budget test files), `next build` (clean).

## Phase 13 — Apollo.io as a second contact-lookup provider

**Context:** the Hunter.io account being used couldn't sign in with a
personal email address — an account/provider-side issue, not something
fixable in this codebase. Rather than block the whole app on that, added
Apollo.io as a second provider and made contact lookup degrade across
both instead of failing outright when one is unavailable.

**Built:** `lib/integrations/contact.ts` (shared `ContactLookupResult`
type, including a new `foundVia: 'apollo' | 'hunter'` field, in its own
dependency-free file so `hunter.ts` and `apollo.ts` can both use it
without importing each other), `lib/integrations/apollo.ts` (mirrors
`hunter.ts`'s two entry points — `findExecutiveContact`,
`findEmailForNamedContact` — against Apollo's people-search and
people-match endpoints), `lib/integrations/contact-lookup.ts` (the new
orchestrator: tries Apollo, falls back to Hunter, returns null if neither
finds anything). `lib/agent/research.ts` now imports from
`contact-lookup.ts` instead of `hunter.ts` directly. Made `HUNTER_API_KEY`
optional (was required) and added optional `APOLLO_API_KEY` — each
provider's wrapper returns `null` immediately if its key is unset, so any
combination of zero/one/two configured providers degrades gracefully
rather than failing to start.

**Decision:** Apollo goes first in the try-chain purely because it's the
provider actually reachable right now — not a judgment that Apollo is
better. If Hunter access is restored, both still run; Apollo's result is
just preferred when both would find one. Full reasoning, including why
LinkedIn is still out of scope regardless of this change, in
`docs/decisions/06-apollo-alongside-hunter.md`.

**Decision:** Apollo's API returns masked placeholder emails (e.g.
`email_not_unlocked@domain.com`) instead of erroring when the account's
plan hasn't unlocked a real address. `apollo.ts` explicitly detects and
rejects that pattern rather than saving it as a real contact email.

**Verification performed:** `tsc --noEmit` (clean), `eslint` (clean),
`vitest run` (50/50 passing — added `tests/unit/apollo.test.ts`,
`tests/unit/contact-lookup.test.ts`, and updated
`tests/unit/research.test.ts`'s mock path from `hunter` to
`contact-lookup`).

## Phase 14 — Apollo credit budget (90/cycle)

**Context:** the newly-added Apollo.io key turned out to also have a
tight, real limit — 90 credits per billing cycle — so it needed the same
tracked-budget treatment as OpenAI and Tavily from
`docs/decisions/05-external-api-budgets.md`, applied immediately rather
than left as a gap.

**Built:** `supabase/migrations/004_apollo_usage.sql` — same
monthly-bucketed shape as `tavily_usage`, with
`increment_apollo_usage()`/`decrement_apollo_usage()` atomic
reserve/release functions. Wired into both entry points of
`lib/integrations/apollo.ts` (restructured to split the network-request
try/catch, which releases the reservation, from the response-processing
try/catch, which doesn't — matching the pattern already used in
`tavily.ts`). Added `getApolloUsage` and a third dashboard `UsageCard`
(grid widened from 2 to 3 columns).

**Decision:** treats every Apollo request as costing 1 credit, regardless
of whether it actually unlocks a new email. This is a deliberate
overestimate — Apollo's real accounting may only deduct credits on a
genuine reveal — chosen because undercounting remaining budget in the
dashboard is a minor inconvenience, while overrunning the real 90/cycle
cap is the failure mode actually worth avoiding. Documented as a rejected
alternative ("precise Apollo credit accounting") in
`docs/decisions/05-external-api-budgets.md` rather than silently assumed.

**Decision:** budget exhaustion for Apollo returns `null` (not a thrown
error) — same as any other Apollo failure — since `contact-lookup.ts`
already falls back to Hunter regardless of why Apollo came back empty.
No behavior change needed in the orchestrator itself.

**Verification performed:** `tsc --noEmit` (clean), `eslint` (clean),
`vitest run` (53/53 passing — extended `tests/unit/apollo.test.ts` with a
credit-budget mock and 3 new reserve/release/skip tests, mirroring
`tests/unit/tavily-budget.test.ts`), `next build` (clean).

## Phase 15 — Company discovery, and research surviving downstream failures

**Context:** before running the app for the first time, walked through
what happens if the OpenAI/Tavily/Apollo budgets run out mid-session.
Found a real gap: `POST /api/research` ran research then match/draft/score
in one request — if drafting threw after research had already persisted
the company, the route still propagated the failure and the human had no
way to see or use the research that *did* succeed. Also decided, after
clarifying the request, to build "automatic company discovery" now
instead of leaving it deferred (see `docs/decisions/04-review-before-send.md`'s
original deferred-features list) — with the explicit constraint that
discovery must not itself become a way to blow through the 50-call OpenAI
budget.

**Built:**
- `supabase/migrations/005_company_discovery.sql` — `companies.research_status`
  (`'discovered' | 'researched'`, default `'researched'` so existing rows
  are unaffected) and a `unique (user_id, url)` constraint.
- `lib/agent/discover.ts` — one Tavily search + exactly one OpenAI call
  (`PROMPTS.COMPANY_DISCOVERY`) to extract clean company name/URL/reason
  triples from noisy search results, persisted immediately as
  `'discovered'` stub rows, deduped against existing companies by domain.
  `POST /api/discover` (rate-limited like the other AI-calling routes).
- `lib/agent/research.ts` now `upsert`s the company on `(user_id, url)`
  instead of always inserting, so researching a discovered stub promotes
  that same row instead of creating a duplicate.
- `POST /api/research` now catches match/draft/score failures separately
  from research failures: research failing still fails the whole request
  (nothing useful to save), but a downstream failure after research
  succeeded now returns 200 with the saved `companyId`/`contactId`,
  `draftId: null`, and a `draftError` message.
- Three new pages: `/discover` (query form + results), `/companies` (every
  company regardless of state, with the one action that makes sense for
  each — Research now / Generate draft / View draft, via a shared
  `CompanyActions` client component), `/companies/[id]` (single-company
  detail, reusing a `CompanyResearchPanel` extracted from `/review/[id]`
  so research looks identical with or without a draft attached).
  `CompanyForm.tsx` now redirects to the company detail page instead of a
  dead end when drafting fails.
- Extracted `extractDomain` (previously duplicated in `hunter.ts` and
  `apollo.ts`) into `lib/utils.ts` since `discover.ts` needed it too — a
  third occurrence crossed the threshold for pulling it out.
- Dashboard now splits "Researched" from "Discovered" in its stats instead
  of counting all `companies` rows as researched.

**Decision:** discovery costs one OpenAI call per *search run*, never per
candidate — auto-researching every discovered candidate was explicitly
rejected (would burn 20-30+ calls per discovery run against the 50-call
lifetime cap). The human picks which candidates are worth a full research
pass. Full reasoning in `docs/decisions/07-company-discovery.md`.

**Decision:** reused the `companies` table for discovery stubs (every
research field was already nullable) rather than a separate table —
promoting a stub to fully-researched is a plain `UPDATE` via the new
upsert, not a cross-table migration.

**Verification performed:** `tsc --noEmit` (clean), `eslint` (clean),
`vitest run` (60/60 passing — added `tests/unit/discover.test.ts`,
`tests/integration/discover.route.test.ts`, a new partial-success test in
`tests/integration/research.route.test.ts`, and fixed the fake Supabase
client in `tests/unit/research.test.ts` to support `.upsert()`), `next build`
(clean, 20 routes).

## Phase 16 — Fix dev-mode CSP breaking all client JS, and ambiguous-column bug in the budget functions

**Bug found (reported: "sign up link doesn't work"):** `next.config.mjs`'s
CSP had `script-src 'self' 'unsafe-inline'` with no `'unsafe-eval'`. Next.js
dev-mode bundles run through `eval()` for fast rebuilds; without
`'unsafe-eval'` the browser silently blocked all application JS from
executing — scripts loaded (200 OK) but never ran, so nothing hydrated:
no click handlers, no form interception, no console error explaining why.
Confirmed by checking for `__reactFiber*`/`__reactProps*` own-properties on
a button DOM node (none found — React had never attached) and by curling
the actual response headers to see the deployed policy. **Fix:** allow
`'unsafe-eval'` only when `NODE_ENV !== 'production'`; production is
unaffected since prod builds don't use `eval()`. Also added a missing
`catch` block to `LoginForm.tsx`'s submit handler — a network-level auth
failure (bad Supabase URL, offline) was throwing uncaught instead of
setting a visible error.

**Bug found (reported: Postgres errors on `/discover` — "column reference
\"period\"/\"calls_used\" is ambiguous"):** all three
`increment_{openai,tavily,apollo}_usage()` functions (002-004) declare
`returns table (calls_used integer, ...)` (or `credits_used`/
`credit_budget`/`period`) — those OUT parameter names are identical to the
columns on the table each function updates. Inside the function body,
unqualified references to e.g. `calls_used` are ambiguous between "the OUT
parameter" and "the column," and Postgres correctly refuses to guess
rather than pick one silently. **Fix:** qualify every such reference with
the table name (`openai_usage.calls_used`, etc.) inside the `UPDATE`'s
`SET`/`WHERE` clauses — the only place the ambiguity actually occurred (the
`RETURNING *` and the OUT-column `SELECT`s were already fine). Fixed both
at the source in 002-004 (so a fresh setup never hits it) and added
`006_fix_ambiguous_budget_columns.sql` (`CREATE OR REPLACE FUNCTION`, safe
to re-run) for any database that already applied the broken versions —
migrations already applied can't be un-applied, and editing 002-004 alone
wouldn't reach a database that ran them before the fix.

**Lesson:** don't name a PL/pgSQL function's `RETURNS TABLE` output columns
identically to the columns of the table it operates on unless every
reference inside the function body is qualified — safer to qualify
defensively from the start than to rely on remembering this each time.

**Verification performed:** could not run the corrected SQL against a live
Postgres instance (no `psql`/Docker/Supabase CLI available in this
environment, and no direct DB connection string — only the REST-facing
Supabase keys). Verified by careful manual review of every reference in
each function body instead; the user needs to apply
`006_fix_ambiguous_budget_columns.sql` via the Supabase SQL editor and
confirm `/discover` works end-to-end. `tsc --noEmit`, `eslint` unaffected
(SQL-only + two small TS files already covered above).
