-- Tracks Tavily search credit usage against a monthly quota (1000
-- credits/month on the plan in use). Unlike openai_usage (a one-time,
-- never-resetting cap — see 002_openai_usage.sql), this is bucketed by
-- calendar month (period = 'YYYY-MM'), so a new month naturally starts a
-- fresh budget without needing a scheduled reset job. See
-- docs/decisions/05-external-api-budgets.md.

create table tavily_usage (
  period text primary key,
  credits_used integer not null default 0,
  credit_budget integer not null default 1000,
  updated_at timestamptz not null default now(),
  constraint tavily_usage_credits_used_non_negative check (credits_used >= 0)
);

comment on table tavily_usage is 'Monthly-bucketed counter for the Tavily search credit quota. Written only via increment/decrement_tavily_usage, called through the service-role client in lib/integrations/tavily.ts.';

alter table tavily_usage enable row level security;

create policy "tavily_usage_select_authenticated" on tavily_usage
  for select using (auth.role() = 'authenticated');

-- Atomically reserves one credit for the current calendar month, creating
-- that month's row on first use. Returns allowed = false (without
-- incrementing) once that month's budget is exhausted — callers treat this
-- the same as any other Tavily failure and skip the search (see
-- lib/integrations/tavily.ts, which already treats search failures as
-- best-effort, not fatal).
create or replace function increment_tavily_usage()
returns table (credits_used integer, credit_budget integer, allowed boolean, period text)
language plpgsql
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
  updated_row tavily_usage%rowtype;
begin
  insert into tavily_usage (period) values (current_period)
  on conflict (period) do nothing;

  -- Column references below are qualified with the table name because
  -- this function's own OUT parameters (credits_used, credit_budget,
  -- period) share names with these columns — see
  -- 006_fix_ambiguous_budget_columns.sql.
  update tavily_usage
  set credits_used = tavily_usage.credits_used + 1, updated_at = now()
  where tavily_usage.period = current_period
    and tavily_usage.credits_used < tavily_usage.credit_budget
  returning * into updated_row;

  if found then
    return query select updated_row.credits_used, updated_row.credit_budget, true, updated_row.period;
  else
    return query
      select tavily_usage.credits_used, tavily_usage.credit_budget, false, tavily_usage.period
      from tavily_usage
      where tavily_usage.period = current_period;
  end if;
end;
$$;

-- Releases a reserved credit that never reached Tavily (the request itself
-- failed before any response), so a network error doesn't burn quota for
-- nothing. Never called once a response was received, even an invalid one.
create or replace function decrement_tavily_usage()
returns void
language plpgsql
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
begin
  update tavily_usage
  set credits_used = greatest(credits_used - 1, 0), updated_at = now()
  where tavily_usage.period = current_period;
end;
$$;
