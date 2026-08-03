-- OutreachAgent initial schema
--
-- Four tables: companies -> contacts -> drafts -> replies.
-- Every table is owned by a single authenticated user (user_id, defaulted
-- to auth.uid()) and locked down with RLS so a user can only ever read or
-- write their own rows. See docs/decisions/03-supabase-for-tracking.md for
-- why RLS is applied from the first migration rather than retrofitted.

create extension if not exists "pgcrypto";

-- ============================================================================
-- companies
-- ============================================================================
create table companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  industry text,
  size text,               -- startup / scaleup / enterprise
  stage text,               -- seed / series-a / series-b / public
  location text,
  description text,         -- AI-generated summary
  pain_point text,          -- identified pain point
  tech_signals text[] not null default '{}',
  hiring_signals text[] not null default '{}',
  recent_news text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table companies is 'Researched companies, one row per company.';

create index companies_user_id_idx on companies (user_id);
create index companies_created_at_idx on companies (created_at desc);

alter table companies enable row level security;

create policy "companies_select_own" on companies
  for select using (auth.uid() = user_id);
create policy "companies_insert_own" on companies
  for insert with check (auth.uid() = user_id);
create policy "companies_update_own" on companies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "companies_delete_own" on companies
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- contacts
-- ============================================================================
create table contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  title text,
  email text,
  linkedin_url text,
  email_verified boolean not null default false,
  found_via text,            -- hunter / apollo / manual
  created_at timestamptz not null default now()
);

comment on table contacts is 'People at a researched company, usually the CEO/CTO being emailed.';

create index contacts_user_id_idx on contacts (user_id);
create index contacts_company_id_idx on contacts (company_id);

alter table contacts enable row level security;

create policy "contacts_select_own" on contacts
  for select using (auth.uid() = user_id);
create policy "contacts_insert_own" on contacts
  for insert with check (auth.uid() = user_id);
create policy "contacts_update_own" on contacts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "contacts_delete_own" on contacts
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- drafts
-- ============================================================================
create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  subject text not null,
  body text not null,
  project_matched text,       -- which project id was selected, see src/lib/projects.ts
  match_reasoning text,        -- why that project was selected, from lib/agent/match.ts
  demo_url text,               -- which demo link was included
  confidence_score integer,    -- 1-10
  confidence_reason text,
  needs_demo_customisation boolean not null default false,
  customisation_notes text,
  status text not null default 'pending',
  -- pending / approved / edited / rejected / sent
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drafts_status_check check (
    status in ('pending', 'approved', 'edited', 'rejected', 'sent')
  ),
  constraint drafts_confidence_score_check check (
    confidence_score is null or (confidence_score between 1 and 10)
  )
);

comment on table drafts is 'Drafted cold-outreach emails. Never transitions to sent automatically — see docs/decisions/01-human-in-the-loop.md.';

create index drafts_user_id_idx on drafts (user_id);
create index drafts_company_id_idx on drafts (company_id);
create index drafts_status_idx on drafts (status);
create index drafts_created_at_idx on drafts (created_at desc);

alter table drafts enable row level security;

create policy "drafts_select_own" on drafts
  for select using (auth.uid() = user_id);
create policy "drafts_insert_own" on drafts
  for insert with check (auth.uid() = user_id);
create policy "drafts_update_own" on drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "drafts_delete_own" on drafts
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- replies
-- ============================================================================
create table replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  draft_id uuid not null references drafts(id) on delete cascade,
  received_at timestamptz,
  body text not null,
  sentiment text,             -- positive / neutral / negative
  suggested_response text,
  status text not null default 'unread',
  -- unread / responded / archived
  created_at timestamptz not null default now(),
  constraint replies_status_check check (
    status in ('unread', 'responded', 'archived')
  ),
  constraint replies_sentiment_check check (
    sentiment is null or sentiment in ('positive', 'neutral', 'negative')
  )
);

comment on table replies is 'Replies received on sent drafts, logged manually by pasting the reply body.';

create index replies_user_id_idx on replies (user_id);
create index replies_draft_id_idx on replies (draft_id);

alter table replies enable row level security;

create policy "replies_select_own" on replies
  for select using (auth.uid() = user_id);
create policy "replies_insert_own" on replies
  for insert with check (auth.uid() = user_id);
create policy "replies_update_own" on replies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "replies_delete_own" on replies
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

create trigger drafts_set_updated_at
  before update on drafts
  for each row execute function set_updated_at();
