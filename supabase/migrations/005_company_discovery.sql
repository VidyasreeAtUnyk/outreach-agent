-- Adds support for company discovery (see docs/decisions/07-company-discovery.md):
-- a company can now exist as a lightweight 'discovered' stub (name + url
-- only, everything else null) before it's fully researched. The existing
-- research pipeline already leaves every research field nullable, so no
-- other schema change is needed beyond a status flag and a way to upsert
-- by URL instead of always inserting a new row.

alter table companies
  add column research_status text not null default 'researched';

alter table companies
  add constraint companies_research_status_check
  check (research_status in ('discovered', 'researched'));

-- Enables lib/agent/research.ts to upsert on (user_id, url): researching a
-- previously-discovered stub updates that same row (promoting it to
-- 'researched') instead of creating a duplicate.
alter table companies
  add constraint companies_user_id_url_key unique (user_id, url);

comment on column companies.research_status is 'discovered = found via lib/agent/discover.ts, not yet researched (most fields null). researched = full research pipeline has run.';
