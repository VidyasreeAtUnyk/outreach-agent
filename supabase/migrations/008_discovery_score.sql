-- Adds a persisted relevance score to discovered companies, so processing
-- order for automated batch runs (lib/agent/batch.ts) survives page
-- reloads and doesn't depend on re-running discovery. See
-- docs/decisions/09-automated-batch-runs.md.

alter table companies
  add column discovery_score integer;

alter table companies
  add constraint companies_discovery_score_range_check
  check (discovery_score is null or discovery_score between 1 and 10);

comment on column companies.discovery_score is '1-10 relevance to the discovery query that found this company (lib/agent/discover.ts). Null for companies added manually via /research.';
