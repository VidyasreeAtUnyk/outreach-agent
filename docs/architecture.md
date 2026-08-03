# Architecture

OutreachAgent is a Next.js 14 App Router application. It has exactly one
human user (Vidyasree) and exactly one job: turn a company URL into a
reviewed, human-approved cold job-application email.

## System overview

```
                    ┌─────────────────────────────────────────────┐
                    │                Next.js app                  │
                    │                                              │
  /research  ──────▶│  POST /api/research                         │
  (submit URL)       │    │                                        │
                    │    ▼                                        │
                    │  lib/agent/research.ts (orchestrator)        │
                    │    │                                        │
                    │    ├─▶ lib/integrations/tavily.ts  (search)  │
                    │    ├─▶ fetch()                     (homepage)│
                    │    ├─▶ lib/integrations/openai.ts  (synth)   │
                    │    └─▶ lib/integrations/hunter.ts  (email)   │
                    │    │                                        │
                    │    ▼                                        │
                    │  supabase: companies, contacts               │
                    │    │                                        │
                    │    ▼                                        │
                    │  POST /api/draft                             │
                    │    │                                        │
                    │    ├─▶ lib/agent/match.ts   (pick project)   │
                    │    ├─▶ lib/agent/draft.ts    (write email)   │
                    │    └─▶ lib/agent/score.ts    (confidence)    │
                    │    │                                        │
                    │    ▼                                        │
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
exists and [[decisions/04-review-before-send]] for why sending itself stays
manual in Phase 1.

## Layering rules

- **`app/`** — routing and composition only. Pages fetch data (via server
  components calling `lib/supabase/server.ts`) and render components; they
  do not contain business logic. API routes (`app/api/**/route.ts`) validate
  input with Zod, call into `lib/`, and shape the HTTP response — they don't
  implement the logic themselves.
- **`components/`** — presentation. No direct calls to OpenAI/Tavily/Hunter/
  Supabase from a component; components receive data as props or call
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
that calls three separate third-party APIs in sequence for a single
operation. Any one of Tavily, the homepage fetch, or Hunter can fail
independently (timeout, rate limit, no results) without that being a bug —
company websites go down, Hunter doesn't have every email. The pipeline
therefore treats each step as best-effort:

- Every step is wrapped so a thrown error is caught, logged via
  `lib/logger.ts` with which step failed and why, and turned into a
  `null`/empty result for that step rather than propagating.
- OpenAI synthesis (the one step that must succeed for the pipeline to be
  useful at all) receives whatever partial data is available and is
  prompted to say so explicitly (e.g. "recent news: unknown") rather than
  inventing detail to fill gaps.
- If Hunter finds no verified email, the contact is still saved with
  `email = null`, `email_verified = false`, and the review UI flags it for
  manual entry instead of blocking the whole company from being researched.
- The orchestrator only throws (failing the whole `POST /api/research` call)
  if the OpenAI synthesis step itself fails, since a company record with no
  synthesized understanding isn't useful to save.

## Data model

Four tables, all with RLS scoped to `auth.uid()` — see
[[decisions/03-supabase-for-tracking]] for why Supabase, and
`supabase/migrations/001_initial.sql` for the authoritative schema (this
section is a summary, not the source of truth):

- **`companies`** — one row per researched company: identity fields (name,
  url, industry, size, stage, location), AI-generated `description` and
  `pain_point`, and array fields for `tech_signals` / `hiring_signals`.
- **`contacts`** — one row per person at a company (usually the CEO/CTO),
  linked by `company_id`, with `email_verified` reflecting whether Hunter
  (or manual entry) confirmed the address.
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
UAE-specific example). `lib/agent/score.ts` is a separate, differently
weighted scoring function — it doesn't ask "which project fits best," it
asks "how strong is this whole application," folding in company size fit
and hiring signals that `match.ts` doesn't consider. Keeping these as two
functions (rather than one combined score) means the review UI can show
"why this project" and "why this confidence" as independently understandable
numbers instead of one opaque blended score.

## Rate limiting

All AI-calling routes (`/api/research`, `/api/draft`, `/api/tracker/reply`)
go through `lib/ratelimit.ts` — 10 requests per user per hour, enforced
server-side before any external API is called. This exists primarily as a
cost/runaway-loop guard for a single-user tool, not as an anti-abuse
measure against outside traffic (the app is authenticated — see
[[decisions/03-supabase-for-tracking]]).
