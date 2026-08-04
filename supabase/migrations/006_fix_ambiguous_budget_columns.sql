-- Fixes a bug in increment_openai_usage/increment_tavily_usage/increment_apollo_usage
-- (002-004): each function's `returns table (calls_used integer, ...)` (or
-- `credits_used`/`credit_budget`/`period`) declares OUT parameters with the
-- exact same names as columns on the table being updated. Inside the
-- function body, unqualified references to those names are ambiguous
-- between "the OUT parameter" and "the table column" — Postgres correctly
-- refuses to guess, raising e.g. 'column reference "calls_used" is
-- ambiguous' at call time. Fixed by qualifying every such reference with
-- the table name. The functions' signatures (parameter/column names
-- returned to callers) are unchanged — only the fix inside the function
-- bodies — so no application code needs to change.

create or replace function increment_openai_usage()
returns table (calls_used integer, call_budget integer, allowed boolean)
language plpgsql
as $$
declare
  updated_row openai_usage%rowtype;
begin
  update openai_usage
  set calls_used = openai_usage.calls_used + 1, updated_at = now()
  where openai_usage.id = 'global' and openai_usage.calls_used < openai_usage.call_budget
  returning * into updated_row;

  if found then
    return query select updated_row.calls_used, updated_row.call_budget, true;
  else
    return query
      select openai_usage.calls_used, openai_usage.call_budget, false
      from openai_usage
      where openai_usage.id = 'global';
  end if;
end;
$$;

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

create or replace function increment_apollo_usage()
returns table (credits_used integer, credit_budget integer, allowed boolean, period text)
language plpgsql
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
  updated_row apollo_usage%rowtype;
begin
  insert into apollo_usage (period) values (current_period)
  on conflict (period) do nothing;

  update apollo_usage
  set credits_used = apollo_usage.credits_used + 1, updated_at = now()
  where apollo_usage.period = current_period
    and apollo_usage.credits_used < apollo_usage.credit_budget
  returning * into updated_row;

  if found then
    return query select updated_row.credits_used, updated_row.credit_budget, true, updated_row.period;
  else
    return query
      select apollo_usage.credits_used, apollo_usage.credit_budget, false, apollo_usage.period
      from apollo_usage
      where apollo_usage.period = current_period;
  end if;
end;
$$;
