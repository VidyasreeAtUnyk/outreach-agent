# OutreachAgent

A personal tool for a Senior AI Engineer's targeted UAE job search. It
researches a company, drafts a cold job-application email in her voice,
puts it in front of her for review, and tracks what happened after she
sends it. It does not send anything automatically — see
[decisions/01-human-in-the-loop.md](decisions/01-human-in-the-loop.md).

## What it does

1. **(Optional) You describe what you're looking for** on `/discover` —
   e.g. "AI agent companies with UAE presence" — and it searches the web
   and saves a list of candidate companies (name + URL) for you to review.
   This step is cheap: one search and one AI call no matter how many
   candidates it finds. Nothing gets fully researched automatically.
2. **You give it a company URL** — either by picking a discovered
   candidate on `/companies` or pasting one yourself on `/research`
   (optionally a contact name and title, and the role you're applying
   for).
3. **It researches the company**: web search for product/features, the
   company's own homepage, hiring signals, and recent funding news, then
   synthesizes all of that with GPT-4o into a pain point, tech signals,
   industry classification, and growth stage. It looks up a CEO/CTO email
   via Apollo, falling back to Hunter.io, if you didn't provide a contact.
4. **It matches the company to one of your portfolio projects** and drafts
   a short (<150 word), specific, non-salesy cold email in your voice. If
   this step fails partway (most often a spent AI budget — see below),
   the research from step 3 is never lost: you land on `/companies/[id]`
   with everything it found, and can draft manually or retry once your
   budget resets.
5. **It shows you everything** on `/review/[id]` — the research it used,
   why it picked that project, the confidence score and why — next to the
   editable draft.
6. **You approve, edit-then-approve, or reject.** Approving does not send
   anything. You copy the email (buttons for "Copy email" / "Copy subject")
   and send it yourself from Gmail.
7. **You track it** on `/tracker` — mark it sent, log a reply when one comes
   in (the AI drafts a suggested response for you to review), and see
   what's gone cold.

`/companies` is the browsable home for everything you've discovered or
researched, regardless of what state it's in — see
[decisions/07-company-discovery.md](decisions/07-company-discovery.md).

## Why it's built this way

Every non-obvious decision has a written record in
[decisions/](decisions/), each following Context → Decision → Alternatives
rejected → Consequences:

- [01-human-in-the-loop.md](decisions/01-human-in-the-loop.md) — why every
  email requires a human click before it's "approved," and why the pipeline
  never sends.
- [02-tavily-over-raw-search.md](decisions/02-tavily-over-raw-search.md) —
  why research uses Tavily instead of Google/Bing search APIs.
- [03-supabase-for-tracking.md](decisions/03-supabase-for-tracking.md) — why
  Supabase for the database, auth, and RLS.
- [04-review-before-send.md](decisions/04-review-before-send.md) — why
  sending stays manual (Resend stubbed, not wired up) and what's explicitly
  deferred to later phases.
- [05-external-api-budgets.md](decisions/05-external-api-budgets.md) — how
  the hard 50-call OpenAI cap, 1000/month Tavily quota, and 90/cycle
  Apollo quota are tracked and enforced, and why drafting + scoring share
  one OpenAI call.
- [06-apollo-alongside-hunter.md](decisions/06-apollo-alongside-hunter.md)
  — why Apollo.io was added as a second contact-lookup provider (tried
  before Hunter), and why LinkedIn is still not a data source.
- [07-company-discovery.md](decisions/07-company-discovery.md) — why
  discovery costs one AI call per search run (not per candidate found),
  and why a drafting failure never discards a successful research result.

[architecture.md](architecture.md) has the full system diagram, layering
rules, data model, and matching/scoring logic. [prompts.md](prompts.md) is
the build log — phase by phase, written as the tool was built, not after.

## Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- API keys: [OpenAI](https://platform.openai.com), [Tavily](https://tavily.com)
- Contact lookup (both optional, but at least one recommended):
  [Apollo.io](https://apollo.io) and/or [Hunter.io](https://hunter.io) —
  see [decisions/06-apollo-alongside-hunter.md](decisions/06-apollo-alongside-hunter.md)
- (Phase 2, not required yet) A [Resend](https://resend.com) API key

### 1. Install

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in every variable listed in `.env.example`. The app validates these
with Zod at startup (`src/lib/env.ts`) and **fails fast with a clear error**
if anything is missing or malformed — it will not silently run with a
half-configured environment.

### 3. Set up the database

Run the migration against your Supabase project:

```bash
# using the Supabase CLI, from the project root
supabase db push
```

or paste the contents of each file in `supabase/migrations/` (in order)
into the Supabase SQL editor. `001_initial.sql` creates `companies`,
`contacts`, `drafts`, `replies`, and their RLS policies; `002_openai_usage.sql`,
`003_tavily_usage.sql`, and `004_apollo_usage.sql` create the external API
usage-tracking tables described in
[decisions/05-external-api-budgets.md](decisions/05-external-api-budgets.md);
`005_company_discovery.sql` adds discovery support described in
[decisions/07-company-discovery.md](decisions/07-company-discovery.md).

### 4. (Optional) Seed sample data

```bash
npm run seed
```

Creates 3 sample companies (Bayut — high-confidence proptech match, Ziina —
medium-confidence fintech match, a government entity — low-confidence "skip"
example), 2 drafts (one approved, one pending), and 1 reply on the approved
draft. Useful for exercising the review UI without burning real API calls.

### 5. Run it

```bash
npm run dev
```

Open `http://localhost:3000`, log in (Supabase Auth — create a user in the
Supabase dashboard under Authentication, or enable sign-up), and go to
`/discover` or `/research` to find or research your first company.

## How to use it day-to-day

0. Check the dashboard's usage cards before a research session — the
   OpenAI budget never resets (50 calls total, 2 per research/regenerate),
   while Tavily's 1000 credits/month and Apollo's 90 credits/cycle both
   reset periodically. All three turn amber then red as they run low.
1. Find a company you want to apply to — either describe what you're
   looking for on `/discover` and pick from the candidates it saves to
   `/companies`, or go straight to `/research` and paste a URL you already
   have.
2. Wait for research + drafting to finish (progress shown live), then you
   land on `/review/[id]` automatically.
3. Read the research panel — does the pain point actually make sense? Read
   the draft — does it sound like you, and is everything in it true?
4. Edit inline if needed, then **Approve** (or **Reject** if the match is
   weak — the confidence score's `skip` recommendation is a hint, not a
   rule).
5. Click **Copy email**, paste into Gmail, send it, then go to `/tracker`
   and mark it **Sent**.
6. When a reply comes in, paste it into the tracker row's **Log reply**
   button — you'll get an AI-suggested response to review before you send
   your actual reply (also manual — see
   [decisions/04-review-before-send.md](decisions/04-review-before-send.md)).

## Testing

```bash
npm run test        # unit tests (Vitest) — every lib/ function
npm run test:e2e     # Playwright — core review/approve flow
npm run typecheck    # tsc --noEmit, strict mode
npm run lint         # eslint
```

CI runs all of the above on every push — see
`.github/workflows/ci.yml`.

## What this tool intentionally does not do (yet)

See [decisions/04-review-before-send.md](decisions/04-review-before-send.md)
for the full reasoning. In short, deferred to later phases: automated
sending, automatic company discovery, Gmail webhook reply detection,
LinkedIn scraping (deferred indefinitely — ToS risk), multi-user support,
and an analytics dashboard.
