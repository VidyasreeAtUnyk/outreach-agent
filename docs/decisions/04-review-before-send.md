# 04 — Sending stays manual in Phase 1; Resend is stubbed, not wired up

## Context

[[01-human-in-the-loop]] establishes that no draft sends without human
approval. A separate question is what happens *after* approval: should the
approved email be sent automatically via an email-sending API (Resend), or
does the human still send it manually? These are different decisions —
you could imagine a version of this tool where approval and sending are the
same click, with Resend firing immediately on approve.

## Decision

Approval and sending are kept as two separate, manually-triggered steps in
Phase 1:

1. `POST /api/outreach/approve` sets `drafts.status = 'approved'` and
   `approved_at = now()`. Nothing is sent.
2. The review UI exposes **Copy email** and **Copy subject** buttons so the
   approved text can be pasted into Gmail (where Vidyasree's real sending
   identity, signature, and threading already live).
3. She sends it herself from Gmail, then goes to `/tracker` and marks the
   row `sent` (`sent_at = now()`), which is the only place `status` moves to
   `'sent'`.
4. `lib/integrations/resend.ts` (or equivalent) is written as a typed
   function stub — signature, input/output types, and a
   `throw new Error('not implemented — see docs/decisions/04-review-before-send.md')`
   body — so Phase 2 can wire it up without redesigning the interface, but
   nothing in the app calls it.

## Alternatives rejected

- **Wire up Resend now, gated behind the approval step.** Rejected: sending
  from a transactional-email API (Resend) means the email arrives from a
  different sending domain/identity than Vidyasree's actual Gmail, which
  hurts deliverability and looks less personal for a cold email to a named
  executive — exactly the opposite of what a "direct, human, not salesy"
  outreach email needs. Fixing this properly means domain verification,
  SPF/DKIM setup, and reply-routing back to her real inbox, which is real
  Phase 2 work, not a toggle.
- **Send via a Gmail API integration instead of Resend.** Rejected for
  Phase 1 for the same reason multi-step OAuth integrations are deferred
  generally: it's a legitimate Phase 2/3 direction (also see the Gmail
  webhook note below) but adds OAuth scope management and token refresh
  that isn't justified until manual copy/paste is a proven bottleneck.
- **Skip the Resend stub entirely and revisit the interface later.**
  Rejected: writing the typed stub now, informed by the actual `drafts`
  schema, costs almost nothing and documents the intended contract
  (`sendEmail(draft: Draft): Promise<SendResult>`) so Phase 2 doesn't have
  to re-derive it.

## Deferred to later phases (not built now)

Documented here rather than silently omitted, per the project's
documentation standard:

- **Automated email sending** (wire up the Resend stub for real). Blocked on
  deliverability setup (domain auth) and on manual sending actually proving
  to be a bottleneck.
- ~~**Automatic company discovery**~~ — built in
  [[07-company-discovery]], sooner than originally planned here. It
  intentionally stops short of "AI decides who to email": discovery finds
  and saves *candidates* from a description (`/discover`), but every
  candidate still needs an explicit human "Research now" click before the
  full pipeline (and its OpenAI cost) runs on it, and drafting/sending
  still goes through the same human-in-the-loop review as any other
  company — see [[01-human-in-the-loop]].
- **Gmail webhook for reply detection** (auto-populate `replies` instead of
  pasting reply text into `/tracker`). Phase 3 — requires OAuth + webhook
  infrastructure that isn't justified for a handful of replies a week.
- **LinkedIn scraping** for contact discovery. Deferred indefinitely, not
  just "later" — LinkedIn's terms of service explicitly prohibit automated
  scraping, and enforcement includes account bans. `lib/agent/research.ts`
  only uses Tavily search + Hunter.io, both of which operate through
  sanctioned APIs.
- **Multi-user support.** Not built — see [[03-supabase-for-tracking]]. RLS
  is scoped per-user so it's not architecturally blocked, but there's one
  reviewer today and building team features (assignment, roles, shared
  queues) has no current user to validate against.
- **Analytics dashboard** (reply-rate trends, time-to-response, funnel
  charts over time). Phase 2 — `/tracker` shows current state; historical
  trend analysis is a distinct feature with its own design questions once
  there's enough sent volume to make trends meaningful.

## Consequences

- `drafts.status` has a real, meaningful `'approved'` state distinct from
  `'sent'` — the tracker UI must handle both and the "mark as sent" action
  is a first-class button on `/tracker`, not implicit.
- The review page's copy buttons ([[../architecture]]) are load-bearing
  UI, not a nicety — they're the actual bridge between this tool and Gmail
  until Phase 2.
- `lib/integrations/resend.ts` exists in the codebase (typed, tested for its
  stub behavior) but has zero runtime callers, which is intentional and
  should not be "cleaned up" by removing the unused import — see the stub's
  own header comment.
