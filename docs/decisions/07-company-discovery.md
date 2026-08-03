# 07 — Company discovery, and making research survive downstream failures

## Context

Phase 1 originally deferred "automatic company discovery" entirely (see
[[04-review-before-send]]): the tool assumed a human would supply a
company URL, and the agent's job was to research and draft for that one
company. In practice, the most valuable and most protected step turned
out to be different from what that design assumed: finding *which*
companies are worth researching in the first place is the step the human
most wants to keep even when everything downstream of it is unreliable —
specifically, when the OpenAI budget (50 calls, ever — see
[[05-external-api-budgets]]) or Apollo/Hunter contact lookup is degraded
or exhausted mid-session.

Two related problems needed solving together:

1. **No way to find companies without already knowing their URL.** A
   description like "AI agent companies with UAE presence" had no path
   into the tool at all.
2. **A downstream failure destroyed an upstream success.** Before this
   change, `POST /api/research` ran research, then match, then draft+score,
   then inserted the draft — all in one request. `researchCompany` already
   persisted the company (and contact) to Supabase *before* drafting ran,
   but if drafting then threw (most commonly `budget_exhausted`), the route
   propagated that error and returned a failure response for the *whole*
   request. The company was actually saved, but the human had no way to
   know that or find it — the UI just showed an error.

## Decision

### Discovery is search, not a second research pass

`lib/agent/discover.ts`'s `discoverCompanies` takes a natural-language
query, runs **one** Tavily search, and makes **exactly one** OpenAI call
(`PROMPTS.COMPANY_DISCOVERY`) to extract a clean, deduplicated list of
company name/URL/reason triples from the (noisy — directory pages, news
articles) search results. It does **not** run the full research pipeline
on every candidate it finds. Each candidate is persisted immediately as a
lightweight `companies` row with `research_status = 'discovered'` — name
and URL only, every research field left `null` (they were already
nullable; no new columns needed there). The human then chooses which
candidates are worth spending an actual research pass (and its OpenAI
call) on, via a "Research now" button per candidate.

This keeps discovery cheap and repeatable regardless of the OpenAI budget's
state: finding 15 candidates costs the same one OpenAI call as finding 2.
Researching those candidates is a separate, explicit, per-company action
that the human controls — exactly the "I decide when to spend budget"
posture the 50-call cap already demands elsewhere in this app.

### Companies upsert on (user_id, url), not always insert

`supabase/migrations/005_company_discovery.sql` adds a unique constraint
on `(user_id, url)` and a `research_status` column
(`'discovered' | 'researched'`, default `'researched'` so existing rows
are unaffected). `lib/agent/research.ts`'s `researchCompany` now
`upsert`s on that constraint instead of always `insert`ing: researching a
company that already exists as a `'discovered'` stub updates that same
row (promoting it to `'researched'`) rather than creating a duplicate.
This also means re-submitting a URL you've already researched refreshes
that row instead of accumulating duplicate company records — a gap that
existed before this change too, closed as a side effect.

### Research results are never thrown away by a downstream failure

`POST /api/research` now wraps match+draft+score+draft-insert in its own
try/catch, separate from the `researchCompany` call. If `researchCompany`
itself throws, the whole request still fails — a company with no
synthesized understanding isn't useful to save, unchanged from before. But
if drafting fails *after* research succeeded, the route returns **200**
with the company/contact ids, `draftId: null`, and a `draftError` message,
instead of propagating the failure. The frontend (`CompanyForm.tsx`)
redirects to the new company detail page in that case instead of showing
a dead-end error — the human can read the saved research immediately, and
either draft it manually (their own stated fallback) or hit "Generate
draft" later via `POST /api/draft` once the budget resets.

### New pages make "phase 1" results browsable, not just reachable via redirect

- `/discover` — the query form and the current run's results.
- `/companies` — every company regardless of status (discovered vs.
  researched) or whether a draft exists, each with the one action that
  makes sense for its state (Research now / Generate draft / View draft),
  via a shared `CompanyActions` client component.
- `/companies/[id]` — full detail for one company, reusing the same
  `CompanyResearchPanel` component `/review/[id]` uses, so research
  findings look identical whether you're looking at them with or without
  a draft attached.

## Alternatives rejected

- **Auto-research every discovered candidate.** Rejected: with a 50-call
  lifetime OpenAI cap, a single discovery run finding 10-15 candidates
  would burn 20-30 calls (synthesis + draft&score per candidate) before
  the human even looked at the list. Discovery would stop being a cheap,
  repeatable "browse" action and become a budget-defining decision made
  implicitly by how the search phrased its query.
- **Pure Tavily-only extraction (no OpenAI call) for discovery.** Rejected:
  reliably turning noisy listicle/news-article search results into clean
  company name + homepage URL pairs needs judgment a keyword/regex
  approach can't provide — the same reasoning that put a model in
  `RESEARCH_SYNTHESIS` in the first place. One OpenAI call per discovery
  *run* (not per candidate) is a reasonable, bounded cost.
  A separate `discovery_usage` budget table (mirroring
  `openai_usage`/`tavily_usage`/`apollo_usage`) was considered and
  rejected as redundant — discovery's OpenAI and Tavily calls already
  count against those existing budgets, so a third counter would just
  double-book the same spend.
- **A separate `discovered_companies` table instead of reusing
  `companies`.** Rejected: every research field on `companies` was already
  nullable, so a "discovered" row is just a `companies` row with most
  fields empty — no schema duplication needed, and promoting a stub to
  fully-researched is a natural `UPDATE` rather than a delete-from-one-
  table-insert-into-another migration.
- **Returning a non-200 status (e.g. 207 Multi-Status) for the
  research-succeeded-but-draft-failed case.** Rejected in favor of a
  200 with an explicit `draftId: null` / `draftError` field: simpler for
  the frontend to branch on a parsed field than to special-case an
  uncommon HTTP status, and the response is genuinely a *success* of the
  operation the human actually asked for (research this company) with an
  honestly-reported partial outcome, not an error.

## Consequences

- `supabase/migrations/005_company_discovery.sql` must run after
  `001`-`004`. If a user already has duplicate `(user_id, url)` company
  rows from before this migration (e.g. from manually re-researching the
  same company), the unique constraint will fail to apply until those are
  deduplicated manually — not expected in this single-user tool's actual
  usage so far, but worth knowing before running it against a populated
  database.
- `CompanyActions` (the shared research/generate-draft/view-draft button)
  is now the one place that branches on a company's state — extending
  that state machine (e.g. a future "archived" status) means updating one
  component, not every page that renders a company row.
- The dashboard's "X companies researched" stat now filters on
  `research_status = 'researched'` and shows a separate "Discovered" count,
  rather than conflating the two the way an unfiltered `companies.length`
  would have.
