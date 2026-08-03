# 02 — Tavily for research search, not raw Google/Bing APIs

## Context

The research pipeline ([[../architecture]]) needs to answer specific
questions about a company — what it does, what it's hiring for, what funding
it has raised, what pain points it likely has — from live web search. This
has to run unattended as one step in a multi-step pipeline (see
`lib/agent/research.ts`) and hand its output to GPT-4o for synthesis.

Raw search APIs (Google Custom Search JSON API, Bing Web Search API) return a
list of URLs and snippets. Turning that into something an LLM can reason
about requires a second pipeline stage: fetch each URL, strip boilerplate,
extract main content, handle paywalls/JS-rendered pages/timeouts, and truncate
to fit a context window — all before the "real" synthesis step even starts.

## Decision

Use Tavily's search API (`lib/integrations/tavily.ts`) as the sole web-search
integration. Tavily is built specifically for LLM agent consumption: it
returns pre-extracted, cleaned page content (not just snippets) ranked by
relevance to the query, with an option (`include_answer`) to get a direct
synthesized answer alongside sources. This collapses "search + fetch +
extract" into one API call per research question, which is what
`research.ts` needs for steps 1, 3, and 4 (product/features search, hiring
search, funding-news search).

We still do one direct `fetch` of the company's own homepage/about page
(step 2) because Tavily's search index is a step removed from the primary
source — for the company's self-description we want the page itself, not a
search engine's summary of it.

## Alternatives rejected

- **Google Custom Search JSON API.** Rejected: returns snippets only, requires
  a separate scraping/extraction stage, has a low free-tier quota (100
  queries/day) that we'd burn through fast running 3+ searches per company
  researched, and isn't designed for agentic consumption.
- **Bing Web Search API.** Rejected for the same reasons as Google, plus
  Microsoft has been deprecating/restructuring this API's availability.
- **Raw scraping (Puppeteer/Playwright against search result pages).**
  Rejected: fragile against anti-bot measures, against the terms of service
  of search engines, slow (headless browser per query), and reinvents what
  Tavily already does reliably. Not worth building for a tool researching a
  handful of companies a day.
- **Skipping search entirely and only fetching the company homepage.**
  Rejected: homepages rarely mention hiring signals, funding news, or recent
  events — exactly the information that makes a cold email specific instead
  of generic.

## Consequences

- One external dependency (`TAVILY_API_KEY`) and one wrapper
  (`lib/integrations/tavily.ts`) to maintain, with Zod validation on its
  response shape since it's a third-party API we don't control.
- Research pipeline cost is bounded by Tavily's per-search pricing, not by
  scraping infrastructure we'd have to run and maintain ourselves.
- If Tavily has an outage or returns no results for a given query, that
  research step is skipped and the pipeline continues with partial data
  (see error-handling note in [[../architecture]]) rather than failing the
  whole company research.
