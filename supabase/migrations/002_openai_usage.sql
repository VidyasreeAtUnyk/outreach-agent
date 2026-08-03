-- Tracks OpenAI API call usage against a hard budget (the API key in use is
-- capped at 50 total calls). A single global row, since the constraint is on
-- the API key/account, not per-app-user. See
-- docs/decisions/05-openai-call-budget.md for why this is DB-backed rather
-- than in-memory (see lib/ratelimit.ts's header comment for the same
-- serverless-instance caveat that would otherwise apply).

create table openai_usage (
  id text primary key default 'global',
  calls_used integer not null default 0,
  call_budget integer not null default 50,
  updated_at timestamptz not null default now(),
  constraint openai_usage_single_row check (id = 'global'),
  constraint openai_usage_calls_used_non_negative check (calls_used >= 0)
);

comment on table openai_usage is 'Single-row counter for the hard OpenAI call budget. Written only via increment/decrement_openai_usage, called through the service-role client in lib/integrations/openai.ts.';

insert into openai_usage (id, calls_used, call_budget) values ('global', 0, 50);

alter table openai_usage enable row level security;

-- Any authenticated user of this (single-user) app can read the counter to
-- display it (see the dashboard's usage stat card). Only the service-role
-- client (which bypasses RLS) can write to it, via the functions below.
create policy "openai_usage_select_authenticated" on openai_usage
  for select using (auth.role() = 'authenticated');

-- Atomically reserves one call: increments calls_used only if under budget,
-- in a single round trip so concurrent requests can't both slip through a
-- check-then-increment race. Returns allowed = false (without incrementing)
-- once the budget is exhausted.
create or replace function increment_openai_usage()
returns table (calls_used integer, call_budget integer, allowed boolean)
language plpgsql
as $$
declare
  updated_row openai_usage%rowtype;
begin
  update openai_usage
  set calls_used = calls_used + 1, updated_at = now()
  where id = 'global' and calls_used < call_budget
  returning * into updated_row;

  if found then
    return query select updated_row.calls_used, updated_row.call_budget, true;
  else
    return query
      select openai_usage.calls_used, openai_usage.call_budget, false
      from openai_usage
      where id = 'global';
  end if;
end;
$$;

-- Releases a reserved call that didn't actually reach OpenAI (the request
-- itself failed before any response was received), so a network error
-- doesn't silently burn budget. Never called for calls that got a response,
-- even an invalid one — see lib/integrations/openai.ts.
create or replace function decrement_openai_usage()
returns void
language sql
as $$
  update openai_usage
  set calls_used = greatest(calls_used - 1, 0), updated_at = now()
  where id = 'global';
$$;
