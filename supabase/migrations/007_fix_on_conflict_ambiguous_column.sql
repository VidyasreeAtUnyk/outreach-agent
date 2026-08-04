-- Follow-up to 006_fix_ambiguous_budget_columns.sql, which qualified every
-- ambiguous column reference in increment_tavily_usage/increment_apollo_usage
-- EXCEPT one: `insert into ..._usage (period) values (...) on conflict
-- (period) do nothing`. Unlike a WHERE or SET clause, an `ON CONFLICT`
-- target list is a bare column-name list — `on conflict (tavily_usage.period)`
-- is not valid syntax, so there was no way to qualify it. As long as the
-- function also had a `period` OUT parameter, that bare `period` in the
-- conflict target stayed ambiguous, and 006 didn't actually fix these two
-- functions (increment_openai_usage has no INSERT/ON CONFLICT at all, so
-- it was fixed correctly by 006 — this bug is specific to the two
-- monthly-bucketed tables).
--
-- Fix: drop `period` from each function's RETURNS TABLE — neither
-- lib/integrations/tavily.ts's getTavilyUsage nor
-- lib/integrations/apollo.ts's getApolloUsage ever read it from the RPC
-- result (both query the table directly instead), so it was dead output.
-- Removing the OUT parameter removes the colliding variable, which
-- resolves the `on conflict (period)` ambiguity at its root instead of
-- trying to route around it.
--
-- CREATE OR REPLACE FUNCTION cannot change a function's return type — the
-- row type here is defined by its OUT parameters, and dropping `period`
-- changes that row type — so each function must be dropped first
-- (PostgreSQL error 42P13: "cannot change return type of existing
-- function... Use DROP FUNCTION ... first").

drop function if exists increment_tavily_usage();

create function increment_tavily_usage()
returns table (credits_used integer, credit_budget integer, allowed boolean)
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
    return query select updated_row.credits_used, updated_row.credit_budget, true;
  else
    return query
      select tavily_usage.credits_used, tavily_usage.credit_budget, false
      from tavily_usage
      where tavily_usage.period = current_period;
  end if;
end;
$$;

drop function if exists increment_apollo_usage();

create function increment_apollo_usage()
returns table (credits_used integer, credit_budget integer, allowed boolean)
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
    return query select updated_row.credits_used, updated_row.credit_budget, true;
  else
    return query
      select apollo_usage.credits_used, apollo_usage.credit_budget, false
      from apollo_usage
      where apollo_usage.period = current_period;
  end if;
end;
$$;
