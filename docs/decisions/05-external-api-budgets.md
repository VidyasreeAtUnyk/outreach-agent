# 05 — Hard budgets on OpenAI, Tavily, and Apollo, enforced in the database

## Context

The OpenAI API key this tool runs on is capped at **50 calls total, ever**
— not a rate limit that resets, a hard ceiling. The Tavily key is capped at
**1000 search credits per calendar month**. The Apollo key (added in
[[06-apollo-alongside-hunter]]) is capped at **90 credits per billing
cycle**. All three are external constraints on the accounts in use, not
something the app can negotiate around, and all three are worth protecting
deliberately: exceeding any of them means the tool simply stops working
(OpenAI) or degrades until the next reset (Tavily, Apollo).

The existing `lib/ratelimit.ts` (10 requests/user/hour, see its own header
comment) doesn't help here — it's a per-instance, in-memory abuse/runaway-
loop guard, explicitly documented as *not* globally consistent across
serverless instances. A 50-call lifetime cap needs a durable, atomic
counter that survives restarts and can't be raced past by two concurrent
requests both checking "am I under budget?" a moment before either one
actually spends a call.

## Decision

Track usage for all three APIs in Postgres, one table each:

- **`openai_usage`** — a single row (`id = 'global'`), `calls_used` /
  `call_budget` (default 50), never resets.
- **`tavily_usage`** — one row per calendar month (`period = 'YYYY-MM'`),
  `credits_used` / `credit_budget` (default 1000). A new month naturally
  gets a fresh budget the first time that month's row is created — no
  scheduled reset job needed.
- **`apollo_usage`** — same monthly-bucketed shape as `tavily_usage`,
  `credit_budget` defaulting to 90. Apollo's actual billing cycle may not
  align exactly with the calendar month, and its real credit accounting
  may only deduct a credit when an email is genuinely unlocked rather than
  per request — this is a deliberately conservative approximation
  ("1 request = 1 credit"), safer to undercount remaining capacity than to
  overrun the real 90/cycle budget.

All three are enforced through the same pattern, implemented as a Postgres
function per table (`increment_openai_usage`, `increment_tavily_usage`,
`increment_apollo_usage`) that **atomically** increments-and-checks in one
round trip:

```sql
update ... set calls_used = calls_used + 1 where ... and calls_used < call_budget
returning ...
```

If the row isn't found (because the `and calls_used < call_budget` guard
failed), the function returns `allowed: false` without incrementing —
this is a "reserve a slot" pattern, not "check then increment," so two
concurrent requests can't both slip through when only one call remains.
Reservation happens *before* the actual API request in
`lib/integrations/openai.ts`'s `runJsonCompletion`,
`lib/integrations/tavily.ts`'s `tavilySearch`, and
`lib/integrations/apollo.ts`'s two entry points — the only places these
external APIs are ever called from (per the existing one-wrapper-per-API
convention). A matching `decrement_*_usage` function releases a
reservation if the request never reached the provider (a network failure
before any response) — so a transient connection error doesn't
permanently burn budget — but **not** if a response was received and only
failed parsing/schema validation, since that response was actually
spent regardless of whether it was usable.

The three APIs are enforced differently because the constraints are
different in kind:

- **OpenAI is a hard gate.** `runJsonCompletion` throws an
  `IntegrationError` with `code: 'budget_exhausted'` when exhausted, which
  `lib/api-utils.ts`'s `toErrorResponse` maps to a `429` with a clear
  message. This is deliberate — OpenAI calls are load-bearing (there's no
  useful draft/score/synthesis without them), so failing loudly and
  specifically is more honest than silently degrading.
- **Tavily and Apollo are best-effort, matching their existing error
  handling.** `tavilySearch` already treats *any* failure as non-fatal
  (see [[02-tavily-over-raw-search]] and `docs/architecture.md`'s
  error-handling philosophy) — a search failing was never allowed to fail
  the whole research pipeline. Apollo's two entry points already return
  `null` on any failure too, and `contact-lookup.ts` already falls back to
  Hunter regardless of *why* Apollo came back empty (see
  [[06-apollo-alongside-hunter]]). Budget exhaustion is just one more
  reason either might not return a result, so both degrade the same way a
  network timeout would.

All three counters are readable by any authenticated user (RLS `select`
policy) but writable only through their functions, called via the
service-role client — the same client/pattern already used by
`scripts/seed.ts`, extended here to a second legitimate server-only use.
`getOpenAiUsage`/`getTavilyUsage`/`getApolloUsage` expose the current
counts for display — the dashboard shows all three as a stat card with a
color that shifts from neutral to warning to critical as the remaining
share shrinks.

### Efficiency: one call instead of two per drafted email

Combining `lib/agent/draft.ts` and `lib/agent/score.ts`'s OpenAI calls into
a single `EMAIL_DRAFT_AND_SCORE` prompt (see `lib/prompts.ts`) cuts every
research/regenerate run from 3 OpenAI calls (synthesis, draft, score) to 2
(synthesis, draft+score). Against a 50-call *lifetime* budget, that's the
difference between researching roughly 16 companies and roughly 25 —
worth doing given the model output for both halves depends on the same
input context anyway (company research + matched project). `score.ts` no
longer calls OpenAI at all; it's now a pure function
(`deriveScoreResult`) that clamps the model's raw score and derives the
send/review/skip recommendation deterministically, which was already true
before this change and didn't need to move.

Tavily's `tavilySearch` also dropped its default `maxResults` from 5 to 3
— Tavily's basic search tier is priced per request, not per result count,
so this doesn't save credits directly, but it shrinks what gets fed into
the OpenAI synthesis prompt, which helps the (much scarcer) OpenAI budget
indirectly.

## Alternatives rejected

- **In-memory counters (like `lib/ratelimit.ts`).** Rejected: explicitly
  wrong for a hard, never-resetting cap — a serverless cold start would
  silently reset the count to zero, and the whole point of tracking this
  is that it must not undercount.
- **Check-then-increment from application code (read the row, compare in
  JS, write the increment).** Rejected: a race window between the read
  and the write means two near-simultaneous requests can both observe
  "1 call remaining" and both proceed, over-spending the budget by one.
  The atomic `update ... where ... < budget returning ...` closes that
  window entirely inside Postgres.
- **A single combined "external API usage" table for all services.**
  Rejected: they have genuinely different shapes (global vs.
  monthly-bucketed, hard-stop vs. soft-degrade) — forcing them into one
  schema would mean nullable columns that only apply to some row types,
  which is worse than three small, honest tables.
- **Scheduled monthly reset job for Tavily/Apollo.** Rejected: the
  `period`-keyed row design gets the same effect for free — a new
  month's first search/lookup just creates a new row via
  `insert ... on conflict do nothing`, so there's nothing to schedule or
  forget to run.
- **Precise Apollo credit accounting (only count a credit when an email is
  actually unlocked).** Rejected for now: without confirmed access to
  Apollo's exact billing rules, "1 request = 1 credit" is a safe
  overestimate. Undercounting *remaining* budget in the dashboard is a
  minor inconvenience; overrunning the real 90/cycle cap is the failure
  mode actually worth avoiding.

## Consequences

- `supabase/migrations/002_openai_usage.sql`, `003_tavily_usage.sql`, and
  `004_apollo_usage.sql` must run before the app can make any OpenAI,
  Tavily, or Apollo call — each wrapper throws/degrades if its row or
  function doesn't exist yet, which will surface immediately and
  obviously in local dev rather than silently overspending.
- The dashboard's usage cards are load-bearing UI, not a nicety — for a
  50-call lifetime OpenAI budget especially, seeing "3 remaining" before
  starting a batch of research is the difference between planning around
  it and running out mid-session with no warning.
- If any of these plans' actual limits change, update the
  `call_budget`/`credit_budget` column directly via SQL (there's no admin
  UI for this yet, and it's a rare enough event not to need one).
- `OPENAI_MODEL` is configurable via environment variable (defaulting to
  `gpt-5.4-mini`) rather than hardcoded, since which model is available
  or most cost-effective on a constrained-budget key can change
  independently of this decision.
