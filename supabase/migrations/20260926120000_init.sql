-- Agents schema. The phone is a control panel; runs and secrets are written by the
-- server with the service role. Row Level Security limits every client read to
-- the signed-in user. Authorization uses auth.uid(), never user_metadata.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to postgres, service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  );
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan text not null default 'free',
  expo_push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text not null default 'sparkles',
  color text not null default '#F2B544',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  active_version_id uuid,
  draft_graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null,
  graph jsonb not null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

alter table public.agents
  add constraint agents_active_version_fk
  foreign key (active_version_id) references public.agent_versions (id) on delete set null;

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('gmail', 'gcal', 'slack', 'notion', 'excel')),
  nango_connection_id text not null,
  account_label text,
  scopes text[] not null default '{}',
  access_mode text not null default 'read' check (access_mode in ('read', 'read_write')),
  created_at timestamptz not null default now(),
  unique (user_id, provider, nango_connection_id)
);

create table public.triggers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  node_id text not null,
  type text not null,
  config jsonb not null default '{}'::jsonb,
  webhook_secret text,
  cursor jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (agent_id, node_id)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid references public.agent_versions (id) on delete set null,
  trigger_type text not null,
  trigger_node_id text,
  status text not null check (
    status in ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled')
  ),
  input jsonb,
  output jsonb,
  error text,
  token_usage jsonb,
  dry_run boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  node_id text not null,
  node_type text,
  status text not null,
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  node_id text not null,
  action_summary text not null,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.templates (
  id uuid primary key,
  name text not null,
  description text not null,
  category text not null,
  graph jsonb not null,
  required_providers text[] not null default '{}',
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.llm_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  encrypted_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index agents_user_idx on public.agents (user_id, updated_at desc);
create index runs_user_idx on public.runs (user_id, created_at desc);
create index runs_agent_idx on public.runs (agent_id, created_at desc);
create index run_steps_run_idx on public.run_steps (run_id, started_at);
create index approvals_user_status_idx on public.approvals (user_id, status);
create index triggers_enabled_idx on public.triggers (enabled, type);
create index connections_user_idx on public.connections (user_id, provider);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger agents_touch
  before update on public.agents
  for each row execute function public.touch_updated_at();

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.plan := old.plan;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

create or replace function public.protect_agent_runtime()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.status := 'draft';
      new.active_version_id := null;
    else
      new.status := old.status;
      new.active_version_id := old.active_version_id;
      new.user_id := old.user_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger agents_protect_runtime
  before insert or update on public.agents
  for each row execute function public.protect_agent_runtime();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.agent_versions enable row level security;
alter table public.connections enable row level security;
alter table public.triggers enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;
alter table public.approvals enable row level security;
alter table public.templates enable row level security;
alter table public.llm_credentials enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy agents_select on public.agents
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy agents_insert on public.agents
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy agents_update on public.agents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy agents_delete on public.agents
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy versions_select on public.agent_versions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy connections_select on public.connections
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy triggers_select on public.triggers
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy runs_select on public.runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy steps_select on public.run_steps
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy approvals_select on public.approvals
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy templates_select on public.templates
  for select to authenticated
  using (true);

revoke all on public.llm_credentials from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.agents to authenticated;
grant select on public.agent_versions to authenticated;
grant select on public.connections to authenticated;
grant select on public.triggers to authenticated;
grant select on public.runs to authenticated;
grant select on public.run_steps to authenticated;
grant select on public.approvals to authenticated;
grant select on public.templates to authenticated;
