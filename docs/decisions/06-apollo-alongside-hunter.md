# 06 — Apollo.io alongside Hunter.io for contact lookup

## Context

The research pipeline needs a CEO/CTO email address for each company (see
`lib/agent/research.ts` step 6). Hunter.io was the only contact-lookup
provider in Phase 1. In practice, the account being used to run this tool
was unable to sign in to Hunter.io with a personal email address — Hunter,
like several other B2B tools, doesn't reliably support onboarding/login
through personal (Gmail/Yahoo/Outlook-style) email domains on its free
tier. Blocking the whole app on that account issue isn't acceptable: the
research pipeline already treats a missing contact as non-fatal (the
contact gets flagged for manual entry — see `docs/architecture.md`'s
error-handling philosophy), but with zero working providers configured,
*every* research run would fall back to manual entry, which defeats the
point of automating contact discovery at all.

LinkedIn was considered and rejected as a data source — see
[[04-review-before-send]], which already documents this as deferred
indefinitely: LinkedIn's terms of service prohibit automated scraping,
and company websites themselves rarely list a named executive's direct
email (only generic `info@`/`contact@` addresses), which is exactly the
gap tools like Hunter and Apollo exist to fill using permission-compliant
public data plus verified-pattern matching.

## Decision

Add Apollo.io (`lib/integrations/apollo.ts`) as a second contact-lookup
provider, with the same two entry points as Hunter
(`findExecutiveContact`, `findEmailForNamedContact`), and introduce
`lib/integrations/contact-lookup.ts` as a thin orchestrator that tries
Apollo first, then falls back to Hunter:

```
apollo.findExecutiveContact() → found? return it
                               → not found/not configured → hunter.findExecutiveContact()
```

`lib/agent/research.ts` now imports from `contact-lookup.ts` instead of
`hunter.ts` directly, and no longer needs to know how many providers exist
or in what order — that's the orchestrator's job, isolating this decision
to one small module.

Both `APOLLO_API_KEY` and `HUNTER_API_KEY` are optional environment
variables (previously `HUNTER_API_KEY` was required — loosened here since
requiring a key the user can't obtain would just move the blocker from
"can't log in" to "app won't start"). Each provider's wrapper checks its
own key at the top of each function and returns `null` immediately if
unset, identical to any other "not found" outcome. If neither key is
configured, contact lookup is skipped entirely and every contact is
flagged for manual entry — the same degraded-but-functional path that
already existed for a single Hunter failure, just now covering "zero
providers available" too.

A shared `ContactLookupResult` type
(`lib/integrations/contact.ts`) — with a `foundVia: 'apollo' | 'hunter'`
field — lives in its own file with no dependencies, so `hunter.ts` and
`apollo.ts` can both use it without either importing the other. The
`foundVia` value flows straight through to `contacts.found_via`, so the
tracker/review UI can still show which provider actually found a given
contact.

Apollo is tried *first*, not Hunter, for the practical reason that started
this decision: Apollo is the provider actually reachable right now.
Nothing about the ordering is otherwise load-bearing — if Hunter access is
restored later, both still run, Apollo's result is simply preferred when
both would find something.

Apollo's API returns masked placeholder emails (e.g.
`email_not_unlocked@domain.com`) when the calling account's plan/credits
haven't "unlocked" a real address, rather than an error. `apollo.ts`
explicitly checks for and rejects this pattern (`isUsableEmail`), treating
it the same as "not found" — otherwise a garbage placeholder string would
get saved to `contacts.email` and silently break outreach.

## Alternatives rejected

- **Require the user to fix Hunter access before continuing.** Rejected:
  the account issue is with Hunter.io itself (their signup/login policy),
  not something fixable from this codebase, and this tool has a designed
  fallback (manual entry) specifically for exactly this kind of provider
  failure — adding a second provider uses that same resilience rather than
  blocking on a third-party support ticket.
- **Replace Hunter entirely instead of adding Apollo alongside it.**
  Rejected: Hunter may become usable again (a different email, a
  workaround, a paid plan), and the orchestrator pattern costs nothing to
  support both — removing Hunter now would just mean re-adding it later
  if circumstances change.
- **LinkedIn scraping as a contact source.** Rejected outright, not
  reconsidered here — see [[04-review-before-send]]. ToS risk doesn't
  change based on which other providers are or aren't working.
- **A single provider-agnostic "contact provider" interface with a runtime
  registry/plugin system.** Rejected as over-engineering for two
  providers — the orchestrator's four-line try-then-fallback is easier to
  read and modify than an abstraction built for N providers that doesn't
  exist yet.

## Consequences

- Adding a third provider later (if ever needed) means adding
  `lib/integrations/<name>.ts` with the same two function signatures,
  adding it to `contact-lookup.ts`'s try-chain, and adding its value to
  `ContactLookupResult['foundVia']` and the `CONTACT_SOURCE`/`found_via`
  enum (`lib/constants.ts`, `supabase/migrations/001_initial.sql`).
- `.env.example` documents both keys as optional with a note that the app
  degrades to manual entry if neither is set — this is expected behavior,
  not a misconfiguration warning.
- Apollo's own credit limit (90/cycle) turned out to matter immediately —
  it's now tracked the same way as OpenAI/Tavily usage, added shortly
  after this decision. See [[05-external-api-budgets]] for the tracking
  mechanism; `apollo.ts`'s reserve-before-call happens *in addition to*
  the Apollo-then-Hunter fallback described here, not instead of it — a
  budget-exhausted Apollo is just one more reason it might return `null`.
