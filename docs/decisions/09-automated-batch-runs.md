# 09 — Automated batch runs: score-first ordering, client-driven loop, mark-and-continue

## Context

[[07-company-discovery]] made finding candidates cheap (one Tavily search,
one OpenAI call, regardless of how many candidates it finds) but left
turning candidates into drafts an entirely manual, one-click-per-company
process. In practice, a discovery run finding 10-15 candidates meant
10-15 individual "Research now" clicks, each a separate wait, with no way
to say "just process the good ones, in priority order, and let me know
what happened."

The explicit ask: give a search input, discover and rank candidates by
the model's own judgment of fit, process them in that order (best first),
score each one, draft only the ones worth drafting, and show live
progress the whole time — with the human's only remaining touchpoint
being the review/approve/send step ([[01-human-in-the-loop]] unchanged).
The stated reason order matters: an OpenAI rate limit or budget
exhaustion ([[05-external-api-budgets]]) can cut a run short at any
point, and if that happens, the strongest leads should already be done,
not whichever ones happened to be listed first.

## Decision

### Discovery scores candidates as part of the extraction call

`PROMPTS.COMPANY_DISCOVERY` now asks for a `relevanceScore` (1-10) per
candidate in the same single extraction call that already runs for a
discovery search — no added OpenAI cost. `lib/agent/discover.ts` sorts by
that score descending before persisting, and the score is stored on the
`companies` row (`discovery_score`, migration 008) so ordering survives
page reloads and doesn't require re-running discovery.

### Scoring is decoupled from drafting, specifically for batch runs

The manual review flow ([[05-external-api-budgets]]'s
`draftEmailWithScore`) stays exactly as it was: one combined OpenAI call
per company, cheapest option, used when a human is reviewing one company
at a time and will see the score and draft together regardless.

Batch runs use a different, more expensive shape on purpose: confidence
scoring (`lib/agent/score.ts#scoreApplication`, its own OpenAI call via
the revived standalone `PROMPTS.CONFIDENCE_SCORE`) happens *before*
drafting, and `lib/agent/draft.ts#draftEmail` (also revived standalone,
`PROMPTS.EMAIL_DRAFT`) only runs if the score's recommendation isn't
`'skip'`. This costs 2 OpenAI calls for a company that clears the bar (vs.
1 in the manual flow) but 1 call — never a wasted draft — for a company
that doesn't. This was an explicit tradeoff the user chose after being
shown both options and their cost implications: never draft an email for
a company that would be rejected on sight, even though on average it
costs more per company that *does* get drafted. Both prompt variants are
kept as separate named constants (not one parameterized prompt) so each
stays independently reviewable — see `lib/prompts.ts`.

### One new orchestration function, phase-by-phase, never throws

`lib/agent/batch.ts#processCompanyForBatch` composes: fetch company →
(research if not already `research_status = 'researched'`) → match
(no OpenAI call, unchanged from [[../architecture]]) → score → skip or
draft. Every phase is independently wrapped; the function always returns
a result object with per-phase `*Error` fields instead of throwing, so a
failure at any point is reported, not fatal to the run. It's also
idempotent: if a company already has a draft (e.g. from a prior partial
run), it short-circuits and reports that draft instead of re-processing —
re-running a batch after a stop-and-resume doesn't create duplicates or
re-spend budget on already-done companies.

`POST /api/batch/process-company` is a thin wrapper — one company in,
one status object out, always `200` for expected failure modes. It's
deliberately **not** behind `lib/ratelimit.ts`'s shared 10-requests/hour
guard: that limiter is one bucket per user shared across every AI-calling
route, sized for occasional manual actions, and a single discovery run
can hand it 15 candidates to process in one intentional sequence. The
real cost backstop is unchanged — the per-call OpenAI budget check inside
`runJsonCompletion` — which every phase here still goes through.

### The batch loop lives in the browser, not a background job

`DiscoverForm.tsx`'s "Process all" button runs a plain client-side
sequential loop: for each candidate (already in score order), `await` one
call to `/api/batch/process-company`, update that company's status in
component state, move to the next. No SSE, no WebSocket, no job queue,
no new backend infrastructure. Progress is inherently live because the
browser tab *is* the loop — there's nothing to poll or subscribe to.

This trades resumability-across-tab-close for simplicity: if the tab
closes or the page navigates away mid-run, the loop stops where it was.
That's an acceptable tradeoff here because every company already
processed is durably saved (each `/api/batch/process-company` call
persists its result immediately), and the idempotent re-run behavior
above means clicking "Process all" again later — from `/discover` or by
individually hitting "Research now"/"Generate draft" per company from
`/companies` — picks up exactly where it left off rather than redoing
work. A background job/queue would remove that one tradeoff at the cost
of real new infrastructure (a jobs table, a worker, a way to trigger it)
that a single-user tool processing a handful of companies at a time
doesn't need yet.

### Errors mark and continue, by explicit choice

Any per-company failure (research, scoring, or drafting) marks that
company `errored` in the UI and the loop proceeds to the next candidate,
rather than aborting the whole run. This was an explicit instruction, not
an assumption: a transient failure (most notably an OpenAI per-minute
rate limit, which resets on its own) doesn't necessarily still apply by
the time the next company's Tavily/homepage-fetch steps have run and
it's that company's turn to hit OpenAI — stopping the whole run on the
first hiccup would be needlessly pessimistic. A true, longer-duration
budget exhaustion (the 50-call lifetime cap, or an hours-long TPM
lockout) will simply show up as most or all subsequent companies erroring
in sequence, which is still informative — the human can see exactly
where the run stopped being productive, per-company, rather than getting
one generic "batch failed" message.

## Alternatives rejected

- **Auto-research every discovered candidate as part of discovery
  itself.** Already rejected in [[07-company-discovery]]; unchanged here
  — discovery stays cheap and separate from the (now automated, but still
  explicitly triggered) processing step.
- **Keep scoring bundled with drafting for batch runs too.** Rejected
  after presenting the cost tradeoff directly — the user chose to spend
  more per successful draft in exchange for never drafting a rejected
  company. Documented here specifically so a future pass doesn't
  "simplify" this back to one call without knowing that was a deliberate,
  informed choice.
- **Stop the whole batch on the first error.** Rejected per explicit
  instruction — see "Errors mark and continue" above.
- **A background job/queue for resumable, close-the-tab-safe batch
  runs.** Rejected for now as more infrastructure than a single-user tool
  processing a handful of companies needs; the idempotent-reprocessing
  design gets most of the practical benefit (safe to re-run, no duplicate
  work) without it. Revisit if batch sizes or run durations grow enough
  that "keep the tab open" becomes a real burden.
- **Server-Sent Events or WebSockets for progress.** Rejected as
  unnecessary — the client-driven loop already has live progress for
  free, and this matches the existing precedent in
  `components/research/CompanyForm.tsx`'s header comment, which
  explicitly deferred SSE for the same reason on the single-company flow.

## Consequences

- `lib/prompts.ts` now carries two prompt variants each for drafting
  (`EMAIL_DRAFT_AND_SCORE`, `EMAIL_DRAFT`) and scoring
  (bundled-in-`EMAIL_DRAFT_AND_SCORE`, standalone `CONFIDENCE_SCORE`) —
  more prompts to keep in sync if the applicant's voice/scoring criteria
  change, since editing one doesn't automatically update the other. Keep
  both in mind when revising either.
- `supabase/migrations/008_discovery_score.sql` must run before
  discovery scores persist (existing companies simply have
  `discovery_score = null`, which the UI and sort already handle).
- A batch run's actual OpenAI spend is now less predictable per company
  (1 or 2 calls, depending on whether it clears the score bar) — worth
  remembering when estimating how many companies a given remaining
  budget can cover.
