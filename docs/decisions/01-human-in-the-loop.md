# 01 — Human-in-the-loop: no email sends automatically

## Context

OutreachAgent researches UAE tech companies and drafts cold job-application
emails to their CEOs/CTOs on Vidyasree's behalf. The obvious "agentic" version
of this tool would research, draft, and send in one pipeline run. That is
explicitly not what we're building.

Cold outreach to a named executive is a one-shot, high-stakes action. Once an
email lands in a CEO's inbox, it cannot be unsent, and a bad email (wrong
name, hallucinated fact about the company, tone that reads as spam) burns the
relationship permanently — there is no second first impression when you're
job hunting. The AI pipeline (Tavily search results, GPT-4o synthesis) is
also probabilistic: research can be stale or wrong, and email drafts can
hallucinate details that sound plausible but aren't true.

## Decision

Every email requires explicit human review and approval before it is
considered "ready to send." The pipeline's job stops at producing a
`draft` row with `status = 'pending'`. A human must open `/review/[id]`,
read the research summary the AI used, read the drafted email, optionally
edit the subject/body inline, and click **Approve** (or **Reject**) before
the draft is marked `approved`. Even after approval, Phase 1 does not send
anything automatically (see [[04-review-before-send]]) — the human copies
the approved email and sends it manually from Gmail, then marks it `sent`
in the tracker.

Concretely this means:
- No API route or agent function ever transitions a draft directly to `sent`.
- `POST /api/outreach/approve` only ever sets `status = 'approved'`.
- The Resend integration is stubbed (function signature exists, is never
  called) — see [[04-review-before-send]] for why automated sending is
  deferred entirely, not just gated.
- The review UI always shows the research the AI used (pain point, hiring
  signals, tech signals, recent news) side-by-side with the draft, so the
  human is reviewing the AI's reasoning, not just trusting its output.

## Alternatives rejected

- **Auto-send above a confidence threshold (e.g. score ≥ 9).** Rejected
  because confidence score is itself AI-generated and can be wrong in the
  same ways the draft can be wrong — using one uncertain AI output to gate
  another doesn't remove the risk, it just hides it. A single bad auto-sent
  email to a CEO is worse than the time cost of reviewing every draft.
- **Auto-send with a delay + cancel window (e.g. "sends in 10 minutes unless
  you cancel").** Rejected because it optimizes for the tool feeling
  autonomous rather than for correctness, and default-send-on-inaction is
  the wrong default for irreversible actions.
- **Batch approval (approve 10 drafts at once from a list view without
  opening each one).** Rejected for Phase 1 — the review page is designed to
  be read, not rubber-stamped. A list-level "approve all" would recreate the
  auto-send risk one level up.

## Consequences

- Every draft needs a `pending` state and the review queue (`/review`) is a
  first-class page, not an afterthought.
- The single-user assumption ([[03-supabase-for-tracking]]) is reinforced:
  there is exactly one reviewer, so we don't need approval routing/roles.
- Throughput is bounded by how fast Vidyasree can read and approve emails,
  not by API rate limits. This is intentional for a role where sending 3
  excellent, accurate emails a day beats sending 30 generic ones.
- The tracker (`/tracker`) must let her mark `sent` manually after copying
  the approved email to Gmail — see `POST /api/outreach/approve` and the
  tracker page in [[../architecture]].
