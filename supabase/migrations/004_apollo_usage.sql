-- Tracks Apollo.io credit usage against a per-cycle quota (90 credits per
-- billing cycle on the plan in use). Bucketed by calendar month
-- (period = 'YYYY-MM'), same pattern as tavily_usage
-- (003_tavily_usage.sql) — see docs/decisions/05-external-api-budgets.md.
--
-- Note: Apollo's actual credit accounting may only deduct a credit when a
-- new email is genuinely unlocked, not for every search/match request. This
-- schema (and lib/integrations/apollo.ts, which reserves one credit per
-- request regardless of outcome) takes the conservative approximation of
-- "1 request = 1 credit" — safer to undercount remaining capacity than to
-- overrun the real 90/cycle budget.

create table apollo_usage (
  period text primary key,
  credits_used integer not null default 0,
  credit_budget integer not null default 90,
  updated_at timestamptz not null default now(),
  constraint apollo_usage_credits_used_non_negative check (credits_used >= 0)
);

comment on table apollo_usage is 'Monthly-bucketed counter for the Apollo.io credit quota. Written only via increment/decrement_apollo_usage, called through the service-role client in lib/integrations/apollo.ts.';

alter table apollo_usage enable row level security;

create policy "apollo_usage_select_authenticated" on apollo_usage
  for select using (auth.role() = 'authenticated');

-- Atomically reserves one credit for the current calendar month, creating
-- that month's row on first use. Returns allowed = false (without
-- incrementing) once that month's budget is exhausted — callers treat this
-- the same as any other Apollo failure and skip the lookup (see
-- lib/integrations/apollo.ts, which already treats failures as best-effort,
-- not fatal — contact-lookup.ts falls back to Hunter regardless).
-- No `period` in the OUT signature (lib/integrations/apollo.ts never reads
-- it — getApolloUsage queries the table directly instead). That's not just
-- unused-field cleanup: an `on conflict (period)` target list can't be
-- table-qualified the way WHERE/SET can, so a `period` OUT parameter/
-- variable would still collide with the table's `period` column even
-- after qualifying every other reference — see
-- 007_fix_on_conflict_ambiguous_column.sql for the incident this avoids.
create or replace function increment_apollo_usage()
returns table (credits_used integer, credit_budget integer, allowed boolean)
language plpgsql
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
  updated_row apollo_usage%rowtype;
begin
  insert into apollo_usage (period) values (current_period)
  on conflict (period) do nothing;

  -- Column references below are qualified with the table name because
  -- this function's own OUT parameters (credits_used, credit_budget)
  -- share names with these columns — see
  -- 006_fix_ambiguous_budget_columns.sql.
  update apollo_usage
  set credits_used = apollo_usage.credits_used + 1, updated_at = now()
  where apollo_usage.period = current_period
    and apollo_usage.credits_used < apollo_usage.credit_budget
  returning * into updated_row;

  if found then
    return query select updated_row.credits_used, updated_row.credit_budget, true;
  else
    return query
      select apollo_usage.credits_used, apollo_usage.credit_budget, false
      from apollo_usage
      where apollo_usage.period = current_period;
  end if;
end;
$$;

-- Releases a reserved credit that never reached Apollo (the request itself
-- failed before any response), so a network error doesn't burn quota for
-- nothing. Never called once a response was received, even an invalid one.
create or replace function decrement_apollo_usage()
returns void
language plpgsql
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
begin
  update apollo_usage
  set credits_used = greatest(credits_used - 1, 0), updated_at = now()
  where apollo_usage.period = current_period;
end;
$$;
