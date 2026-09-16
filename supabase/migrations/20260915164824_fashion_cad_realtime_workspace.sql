-- Fashion CAD Studio remote workspace.
--
-- This schema intentionally stores only user-created workspace data and
-- explicitly approved knowledge packets. Private books, OCR output, local
-- SQLite, LanceDB and model weights never belong in this database.

create schema if not exists app_private;

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.design_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  product_type text not null check (product_type in ('upper_garment', 'laptop_bag')),
  mode text not null default 'local_private'
    check (mode in ('local_private', 'hybrid', 'cloud_creative')),
  description text not null default '' check (char_length(description) <= 4000),
  measurements_mm jsonb not null default '{}'::jsonb,
  materials jsonb not null default '[]'::jsonb,
  components jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  approval_state text not null default 'draft'
    check (approval_state in ('draft', 'review', 'approved')),
  confidence text not null default 'local_assisted'
    check (confidence in ('manual', 'local_assisted', 'cloud_assisted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.design_revisions (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.design_projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision integer not null check (revision >= 1),
  operation jsonb not null default '{}'::jsonb,
  snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (design_id, revision)
);

create table public.knowledge_packets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 300),
  body text not null check (char_length(body) between 1 and 12000),
  source_label text not null default 'Nota aprobada por el usuario'
    check (char_length(source_label) <= 500),
  source_page integer check (source_page is null or source_page > 0),
  tags text[] not null default '{}',
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index design_projects_owner_updated_idx
  on public.design_projects (owner_id, updated_at desc);
create index design_revisions_design_revision_idx
  on public.design_revisions (design_id, revision desc);
create index knowledge_packets_owner_created_idx
  on public.knowledge_packets (owner_id, created_at desc);
create index knowledge_packets_search_idx
  on public.knowledge_packets using gin (search_vector);

create trigger set_design_projects_updated_at
before update on public.design_projects
for each row execute function app_private.set_updated_at();

create trigger set_knowledge_packets_updated_at
before update on public.knowledge_packets
for each row execute function app_private.set_updated_at();

alter table public.design_projects enable row level security;
alter table public.design_revisions enable row level security;
alter table public.knowledge_packets enable row level security;

create policy "Users can read their own designs"
on public.design_projects for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create their own designs"
on public.design_projects for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can update their own designs"
on public.design_projects for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own designs"
on public.design_projects for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can read their own revisions"
on public.design_revisions for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create their own revisions"
on public.design_revisions for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.design_projects projects
    where projects.id = design_id and projects.owner_id = (select auth.uid())
  )
);

create policy "Users can read their own approved packets"
on public.knowledge_packets for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create their own approved packets"
on public.knowledge_packets for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can update their own approved packets"
on public.knowledge_packets for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own approved packets"
on public.knowledge_packets for delete to authenticated
using ((select auth.uid()) = owner_id);

-- Automatic exposure is disabled in project settings. Grant only the tables
-- that the authenticated browser and future remote MCP need, and rely on RLS
-- for per-user row isolation. Anonymous browser sessions have no access.
revoke all on public.design_projects, public.design_revisions, public.knowledge_packets from anon;
grant select, insert, update, delete on public.design_projects to authenticated;
grant select, insert on public.design_revisions to authenticated;
grant select, insert, update, delete on public.knowledge_packets to authenticated;

-- The client submits an already validated snapshot. The database increments
-- revisions atomically so browser and remote MCP edits are traceable.
create or replace function public.apply_design_revision(
  p_design_id uuid,
  p_operation jsonb,
  p_snapshot jsonb
)
returns public.design_projects
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  saved_project public.design_projects;
begin
  update public.design_projects
  set
    name = coalesce(p_snapshot ->> 'name', name),
    product_type = coalesce(p_snapshot ->> 'product_type', product_type),
    mode = coalesce(p_snapshot ->> 'mode', mode),
    description = coalesce(p_snapshot ->> 'description', description),
    measurements_mm = coalesce(p_snapshot -> 'measurements_mm', measurements_mm),
    materials = coalesce(p_snapshot -> 'materials', materials),
    components = coalesce(p_snapshot -> 'components', components),
    approval_state = coalesce(p_snapshot ->> 'approval_state', approval_state),
    confidence = coalesce(p_snapshot ->> 'confidence', confidence),
    revision = revision + 1
  where id = p_design_id and owner_id = (select auth.uid())
  returning * into saved_project;

  if not found then
    raise exception 'Design not found or not owned by the current user';
  end if;

  insert into public.design_revisions (design_id, owner_id, revision, operation, snapshot)
  values (saved_project.id, saved_project.owner_id, saved_project.revision, p_operation, p_snapshot);

  return saved_project;
end;
$$;

create or replace function public.search_knowledge_packets(p_query text)
returns table (
  id uuid,
  title text,
  body text,
  source_label text,
  source_page integer,
  tags text[],
  score real
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    packets.id,
    packets.title,
    packets.body,
    packets.source_label,
    packets.source_page,
    packets.tags,
    ts_rank(packets.search_vector, websearch_to_tsquery('simple', left(trim(p_query), 256)))::real as score
  from public.knowledge_packets packets
  where packets.owner_id = (select auth.uid())
    and packets.search_vector @@ websearch_to_tsquery('simple', left(trim(p_query), 256))
  order by score desc, packets.updated_at desc
  limit 8;
$$;

grant execute on function public.apply_design_revision(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.search_knowledge_packets(text) to authenticated;
revoke all on function public.apply_design_revision(uuid, jsonb, jsonb) from anon;
revoke all on function public.search_knowledge_packets(text) from anon;

-- Realtime uses the same RLS policies as the Data API. It publishes metadata
-- and design revisions, never the local book library.
alter publication supabase_realtime add table public.design_projects;
alter publication supabase_realtime add table public.design_revisions;
