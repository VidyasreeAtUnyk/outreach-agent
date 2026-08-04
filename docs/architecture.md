# Architecture

OutreachAgent is a Next.js 14 App Router application. It has exactly one
human user (Vidyasree) and exactly one job: turn a company (found either
by description or by URL) into a reviewed, human-approved cold
job-application email.

## System overview

```
                    ┌─────────────────────────────────────────────┐
                    │                Next.js app                  │
                    │                                              │
  /discover  ──────▶│  POST /api/discover                          │
  (describe target)  │    │                                        │
                    │    ▼                                        │
                    │  lib/agent/discover.ts                       │
                    │    ├─▶ tavily.ts (1 search)                  │
                    │    └─▶ openai.ts (1 call, extract candidates)│
                    │    ▼                                        │
                    │  supabase: companies (research_status=       │
                    │            'discovered', name+url only)      │
                    │                                              │
  /companies ◀──────│  human browses discovered + researched       │
  /companies/[id]    │  companies, picks which to research          │
                    │    │                                        │
                    │    ├──── "Process all" (batch, in score order)
                    │    │      │                                 │
                    │    │      ▼                                 │
                    │    │    POST /api/batch/process-company     │
                    │    │      (called once per company by a     │
                    │    │       client-side loop in DiscoverForm; │
                    │    │       not rate-limited — see            │
                    │    │       decisions/09)                    │
                    │    │      │                                 │
                    │    │      ▼                                 │
                    │    │    lib/agent/batch.ts                  │
                    │    │      ├─▶ research.ts (if not researched)│
                    │    │      ├─▶ match.ts    (no OpenAI call)   │
                    │    │      ├─▶ score.ts#scoreApplication      │
                    │    │      │   (OpenAI call, BEFORE drafting) │
                    │    │      └─▶ draft.ts#draftEmail            │
                    │    │          (OpenAI call — skipped         │
                    │    │           entirely if score says skip)  │
                    │    │      any phase failing marks this       │
                    │    │      company errored and the loop moves │
                    │    │      on — never stops the whole run     │
                    │    │                                        │
  /research  ──────▶│  POST /api/research  (manual, one company)  │
  (submit/pick URL)  │    │                                        │
                    │    ▼                                        │
                    │  lib/agent/research.ts (orchestrator)        │
                    │    │                                        │
                    │    ├─▶ lib/integrations/tavily.ts  (search)  │
                    │    ├─▶ fetch()                     (homepage)│
                    │    ├─▶ lib/integrations/openai.ts  (synth)   │
                    │    └─▶ contact-lookup.ts (Apollo→Hunter)     │
                    │    │                                        │
                    │    ▼                                        │
                    │  supabase: companies (upsert on user+url,    │
                    │            research_status='researched'),    │
                    │            contacts                          │
                    │    │                                        │
                    │    ├─▶ lib/agent/match.ts   (pick project,   │
                    │    │                          no OpenAI call)│
                    │    ├─▶ lib/agent/draft.ts    (write email +  │
                    │    │                          raw score, one │
                    │    │                          OpenAI call)   │
                    │    └─▶ lib/agent/score.ts    (finalize score,│
                    │                               no OpenAI call)│
                    │    │                                        │
                    │    ▼ (if this half fails, e.g. budget        │
                    │       exhausted, the company above is        │
                    │       already saved — see below)             │
                    │  supabase: drafts (status='pending')         │
                    │                                              │
  /review    ◀──────│  human reviews, edits, approves/rejects      │
  /review/[id]       │    │                                        │
                    │    ▼                                        │
                    │  POST /api/outreach/{approve,edit,reject}    │
                    │  supabase: drafts.status updated              │
                    │                                              │
  (Gmail, manual) ◀──── human copies approved email, sends by hand │
                    │                                              │
  /tracker   ──────▶│  human marks 'sent', logs replies             │
                    │  POST /api/tracker/reply                      │
                    │    └─▶ lib/integrations/openai.ts (suggest)   │
                    └─────────────────────────────────────────────┘
```

See [[decisions/01-human-in-the-loop]] for why the approve/send boundary
exists, [[decisions/04-review-before-send]] for why sending itself stays
manual in Phase 1, [[decisions/07-company-discovery]] for the discovery
step and why a drafting failure never discards a successful research
result, and [[decisions/09-automated-batch-runs]] for the batch flow —
including why it scores before drafting (costing more per successful
draft, in exchange for never drafting a rejected company) while the
manual `/research` flow keeps the cheaper combined draft+score call.

## Layering rules

- **`app/`** — routing and composition only. Pages fetch data (via server
  components calling `lib/supabase/server.ts`) and render components; they
  do not contain business logic. API routes (`app/api/**/route.ts`) validate
  input with Zod, call into `lib/`, and shape the HTTP response — they don't
  implement the logic themselves.
- **`components/`** — presentation. No direct calls to OpenAI/Tavily/
  Apollo/Hunter/Supabase from a component; components receive data as props or call
  `/api/*` routes, they never import `lib/integrations/*` directly. This is
  enforced by convention (see `docs/decisions` for the reasoning) and
  checked in code review — see the project's engineering standards.
- **`lib/`** — all business logic:
  - `lib/integrations/*` — one wrapper per external API. Each wrapper is the
    *only* place that API's SDK/fetch calls happen, validates the response
    shape with Zod (external APIs are untrusted input), and translates
    provider errors into a small typed error the rest of the app can handle
    uniformly.
  - `lib/agent/*` — the research/match/draft/score pipeline. Pure
    orchestration and business rules; calls `lib/integrations/*` for actual
    I/O.
  - `lib/supabase/*` — three entry points (`client.ts` browser, `server.ts`
    request-scoped server, `service.ts` privileged service-role) so it's
    always obvious which auth context a query runs under.
  - `lib/env.ts`, `lib/logger.ts`, `lib/ratelimit.ts`, `lib/projects.ts`,
    `lib/profile.ts`, `lib/prompts.ts` — cross-cutting config and utilities.

## Error handling philosophy

The research pipeline (`lib/agent/research.ts`) is the one place in the app
that calls multiple third-party APIs in sequence for a single operation.
Any one of Tavily, the homepage fetch, or the Apollo/Hunter contact lookup
can fail independently (timeout, rate limit, no results, a provider not
being configured at all) without that being a bug — company websites go
down, neither Apollo nor Hunter has every email. The pipeline therefore
treats each step as best-effort:

- Every step is wrapped so a thrown error is caught, logged via
  `lib/logger.ts` with which step failed and why, and turned into a
  `null`/empty result for that step rather than propagating.
- OpenAI synthesis (the one step that must succeed for the pipeline to be
  useful at all) receives whatever partial data is available and is
  prompted to say so explicitly (e.g. "recent news: unknown") rather than
  inventing detail to fill gaps.
- Contact lookup (`lib/integrations/contact-lookup.ts`) tries Apollo, then
  Hunter, and treats "not configured" the same as "not found" — see
  [[decisions/06-apollo-alongside-hunter]]. If neither finds a verified
  email, the contact is still saved with `email = null`,
  `email_verified = false`, and the review UI flags it for manual entry
  instead of blocking the whole company from being researched.
- The orchestrator only throws (failing the whole `POST /api/research` call)
  if the OpenAI synthesis step itself fails, since a company record with no
  synthesized understanding isn't useful to save.
- Match/draft/score failing *after* research succeeds does not discard that
  research: `POST /api/research` catches that failure separately and
  returns the saved company/contact ids with `draftId: null` and a
  `draftError` message instead of failing the whole request — see
  [[decisions/07-company-discovery]].

## Data model

Four tables, all with RLS scoped to `auth.uid()` — see
[[decisions/03-supabase-for-tracking]] for why Supabase, and
`supabase/migrations/001_initial.sql` for the authoritative schema (this
section is a summary, not the source of truth):

- **`companies`** — one row per company, either a `research_status='discovered'`
  stub (name + url + `discovery_score`, from `lib/agent/discover.ts`) or
  `'researched'` (identity fields — name, url, industry, size, stage,
  location — AI-generated `description` and `pain_point`, and array
  fields for `tech_signals` / `hiring_signals`). Unique on `(user_id,
  url)`, so researching a discovered stub upserts it in place — see
  [[decisions/07-company-discovery]]. `discovery_score` (1-10, nullable —
  null for companies added manually via `/research`) drives the order an
  automated batch run processes candidates in — see
  [[decisions/09-automated-batch-runs]].
- **`contacts`** — one row per person at a company (usually the CEO/CTO),
  linked by `company_id`, with `email_verified` reflecting whether Apollo,
  Hunter, or manual entry confirmed the address, and `found_via` recording
  which.
- **`drafts`** — one row per drafted email, linked to both `company_id` and
  `contact_id`. Carries the matched project, confidence score + reasoning,
  and a `status` state machine: `pending → approved|rejected`, and
  separately `approved → sent` once marked sent from `/tracker`. `edited`
  is used when the human changed subject/body before approving (see
  `POST /api/outreach/approve`'s optional `subject`/`body` override). Carries
  both `match_reasoning` (why this project, from `lib/agent/match.ts`) and
  `confidence_reason` (why this score, from `lib/agent/score.ts`) as two
  separate text fields, shown as two separate "Why" lines in the review UI.
- **`replies`** — one row per reply received on a sent draft, linked by
  `draft_id`, storing the raw reply body, an AI-classified `sentiment`, and
  an AI-drafted `suggested_response` for the human to review before
  responding (manually — replying is not automated either).

## Matching and scoring logic

`lib/projects.ts` is a static, typed registry of Vidyasree's five portfolio
projects, each tagged with `relevantIndustries` and `relevantPainPoints`.
`lib/agent/match.ts` scores every project against a researched company:

- pain-point match: 50% of the score
- industry match: 30%
- tech-signal overlap: 20%

and returns the top-scoring project plus a human-readable `reasoning`
string (used directly in the review UI's "Why" line) and whether the
project's demo needs a customization note before it's sent (e.g. adding a
UAE-specific example). This runs synchronously with no OpenAI call — the
matching signal is already structured data by the time it runs, so a
weighted keyword-overlap score is cheaper and more testable than asking a
model to re-derive the same judgment.

Confidence scoring asks a different question than matching — not "which
project fits best" but "how strong is this whole application," folding in
company size fit and hiring signals that `match.ts` doesn't consider. It
has two shapes depending on caller: the manual `/research` flow gets it
generated by the model *in the same OpenAI call as the email draft*
(`lib/agent/draft.ts`'s `draftEmailWithScore`, using the
`EMAIL_DRAFT_AND_SCORE` prompt), specifically to conserve the hard OpenAI
call budget — see [[decisions/05-external-api-budgets]]. The automated
batch flow (`lib/agent/batch.ts`) instead calls
`lib/agent/score.ts#scoreApplication` (`PROMPTS.CONFIDENCE_SCORE`) on its
own, *before* deciding whether to draft at all, then
`lib/agent/draft.ts#draftEmail` (`PROMPTS.EMAIL_DRAFT`, draft-only) —
two OpenAI calls instead of one, in exchange for never drafting a company
that scores as `'skip'`. Either way, `lib/agent/score.ts`'s
`deriveScoreResult` takes the raw score and reasoning and deterministically
clamps it to 1-10 and derives the send/review/skip recommendation — it
makes no OpenAI call itself, regardless of which path produced the raw
score. See [[decisions/09-automated-batch-runs]] for the full reasoning
behind the two-call batch shape. Keeping match reasoning and confidence
reasoning as two separate text fields (rather than one blended score)
means the review UI can show "why this project" and "why this confidence"
as independently understandable numbers instead of one opaque blend.

## Rate limiting

All AI-calling routes except `/api/batch/process-company` (`/api/discover`,
`/api/research`, `/api/draft`, `/api/tracker/reply`) go through
`lib/ratelimit.ts` — 10 requests per user per hour, enforced server-side
before any external API is called. This exists primarily as a
cost/runaway-loop guard for a single-user tool, not as an anti-abuse
measure against outside traffic (the app is authenticated — see
[[decisions/03-supabase-for-tracking]]). The batch route is deliberately
exempt — see [[decisions/09-automated-batch-runs]] — since it's called
once per company in an intentional sequence that can legitimately exceed
10/hour, and the per-call OpenAI budget check remains the real backstop.

This is a different mechanism from, and in addition to, the hard OpenAI/
Tavily usage budgets described next — the rate limit throttles *how fast*
one user can fire requests; the budgets track *how much of a finite,
external quota* is left, in-memory vs. database-backed, per-hour vs.
lifetime-or-monthly. Both apply to the same routes.

## External API usage budgets

The OpenAI key in use is capped at 50 calls total (not recurring); the
Tavily key at 1000 search credits per calendar month. Both are tracked in
Postgres (`openai_usage`, `tavily_usage`) with atomic reserve-before-call
functions, so the counters can't be raced past and survive serverless
restarts — see [[decisions/05-external-api-budgets]] for the full
reasoning, including why OpenAI exhaustion is a hard `429` failure while
Tavily exhaustion degrades silently (consistent with Tavily search already
being best-effort per the error-handling philosophy above). The
`lib/agent/draft.ts` + `lib/agent/score.ts` split also changed as part of
this: drafting and scoring now happen in one combined OpenAI call instead
of two, to conserve the 50-call budget. Both remaining/used counts are
shown on the dashboard.
