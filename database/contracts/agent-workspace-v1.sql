-- Agent workspace (2026-10-28): the navigator's own state, kept apart from the research corpus.
--
-- Schema `agent` holds, per owner (a signed-in user id, or a browser's random workspace key, hashed by the site):
--   memories   what the agent has learned: facts the user stated, preferences, and procedures (routines it can reuse)
--   files      its folder: documents, images, figures, notes and data it made or saved (bytes in the private
--              `agent-files` bucket, small text inline)
--   episodes   short summaries of past tasks, for context in later ones
--   schedules  tasks it runs on a schedule; results land in the folder
-- Nothing here is corpus data and no corpus table is written. Every function is SECURITY DEFINER with search_path '',
-- revoked from public/anon/authenticated and granted to service_role only; the site calls them server-side.
--
-- Scheduled runs: pg_cron calls agent.tick() every five minutes. When a schedule is due and the site has registered
-- its address (settings.site_url, set by the site itself), tick() stores a one-time token and posts it to
-- <site_url>/api/agent/tick with pg_net. The site accepts the call only after agent_tick_claim(token) confirms the
-- token (unused, under ten minutes old), so no shared secret has to live in the site's configuration.

create schema if not exists agent;
revoke all on schema agent from public, anon, authenticated;

create table if not exists agent.memories (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('fact', 'preference', 'procedure')),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 4000),
  tags text[] not null default '{}',
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists memories_owner on agent.memories (owner, kind, updated_at desc);

create table if not exists agent.files (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('document', 'image', 'figure', 'note', 'data', 'report')),
  title text not null check (length(title) between 1 and 300),
  mime text not null check (length(mime) <= 120),
  bytes integer not null default 0 check (bytes >= 0 and bytes <= 26214400),
  storage_path text check (storage_path is null or storage_path ~ '^[a-f0-9]{64}/[a-f0-9-]{36}\.[a-z0-9]{1,8}$'),
  text_body text check (text_body is null or length(text_body) <= 400000),
  source text check (source is null or length(source) <= 600),
  meta jsonb not null default '{}'::jsonb,
  unread boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists files_owner on agent.files (owner, created_at desc);

create table if not exists agent.episodes (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner ~ '^[a-f0-9]{64}$'),
  task text not null check (length(task) <= 2000),
  summary text not null check (length(summary) <= 4000),
  pages text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists episodes_owner on agent.episodes (owner, created_at desc);

create table if not exists agent.schedules (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner ~ '^[a-f0-9]{64}$'),
  title text not null check (length(title) between 1 and 200),
  task text not null check (length(task) between 1 and 2000),
  cadence text not null check (cadence in ('hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'once')),
  at_time text not null default '08:00' check (at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekday integer check (weekday between 0 and 6),
  monthday integer check (monthday between 1 and 28),
  tz text not null default 'America/Chicago' check (length(tz) <= 60),
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_file uuid,
  locked_until timestamptz,
  runs integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists schedules_due on agent.schedules (next_run_at) where active;

create table if not exists agent.ticks (
  token text primary key check (token ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists agent.settings (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  value text not null check (length(value) <= 400),
  updated_at timestamptz not null default now()
);

alter table agent.memories enable row level security;
alter table agent.files enable row level security;
alter table agent.episodes enable row level security;
alter table agent.schedules enable row level security;
alter table agent.ticks enable row level security;
alter table agent.settings enable row level security;
revoke all on all tables in schema agent from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('agent-files', 'agent-files', false, 26214400)
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------------------------- memories

create or replace function public.agent_memory_put(
  p_owner text, p_id uuid, p_kind text, p_title text, p_body text, p_tags text[] default '{}'
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare r agent.memories;
begin
  if p_id is null then
    if (select count(*) from agent.memories where owner = p_owner) >= 500 then
      raise exception 'Memory is full (500 items). Forget something first.' using errcode = '54000';
    end if;
    insert into agent.memories (owner, kind, title, body, tags)
    values (p_owner, p_kind, left(p_title, 200), left(p_body, 4000), coalesce(p_tags[1:12], '{}'))
    returning * into r;
  else
    update agent.memories
       set kind = p_kind, title = left(p_title, 200), body = left(p_body, 4000),
           tags = coalesce(p_tags[1:12], '{}'), updated_at = now()
     where id = p_id and owner = p_owner
    returning * into r;
    if r.id is null then raise exception 'No such memory.' using errcode = 'P0002'; end if;
  end if;
  return to_jsonb(r) - 'owner';
end $$;

create or replace function public.agent_memory_list(p_owner text, p_kind text default null, p_limit integer default 200)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(m) - 'owner' order by m.kind, m.updated_at desc), '[]'::jsonb)
    from (select * from agent.memories
           where owner = p_owner and (p_kind is null or kind = p_kind)
           order by updated_at desc limit least(greatest(p_limit, 1), 500)) m
$$;

create or replace function public.agent_memory_delete(p_owner text, p_id uuid)
returns boolean language sql security definer set search_path to '' as $$
  with d as (delete from agent.memories where owner = p_owner and id = p_id returning 1) select exists (select 1 from d)
$$;

create or replace function public.agent_memory_touch(p_owner text, p_ids uuid[])
returns void language sql security definer set search_path to '' as $$
  update agent.memories set uses = uses + 1, last_used_at = now() where owner = p_owner and id = any (p_ids)
$$;

-- ------------------------------------------------------------------------------------------------- files

create or replace function public.agent_file_put(
  p_owner text, p_kind text, p_title text, p_mime text, p_bytes integer, p_storage_path text,
  p_text text, p_source text, p_meta jsonb default '{}'::jsonb, p_unread boolean default false
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare r agent.files;
begin
  if (select count(*) from agent.files where owner = p_owner) >= 2000 then
    raise exception 'The agent folder is full (2,000 files). Delete some first.' using errcode = '54000';
  end if;
  insert into agent.files (owner, kind, title, mime, bytes, storage_path, text_body, source, meta, unread)
  values (p_owner, p_kind, left(p_title, 300), p_mime, coalesce(p_bytes, 0), p_storage_path, p_text,
          left(p_source, 600), coalesce(p_meta, '{}'::jsonb), coalesce(p_unread, false))
  returning * into r;
  return to_jsonb(r) - 'owner' - 'text_body';
end $$;

create or replace function public.agent_file_list(
  p_owner text, p_kind text default null, p_limit integer default 60, p_offset integer default 0
) returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'total', (select count(*) from agent.files where owner = p_owner and (p_kind is null or kind = p_kind)),
    'unread', (select count(*) from agent.files where owner = p_owner and unread),
    'rows', coalesce((select jsonb_agg(x order by x.pinned desc, x.created_at desc) from (
        select f.id, f.kind, f.title, f.mime, f.bytes, f.source, f.meta, f.unread, f.pinned, f.created_at,
               f.storage_path is not null as stored, left(f.text_body, 240) as snippet
          from agent.files f
         where f.owner = p_owner and (p_kind is null or f.kind = p_kind)
         order by f.pinned desc, f.created_at desc
         limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb))
$$;

create or replace function public.agent_file_get(p_owner text, p_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select to_jsonb(f) - 'owner' from agent.files f where f.owner = p_owner and f.id = p_id
$$;

create or replace function public.agent_file_update(
  p_owner text, p_id uuid, p_title text default null, p_pinned boolean default null, p_unread boolean default null
) returns jsonb language sql security definer set search_path to '' as $$
  update agent.files
     set title = coalesce(left(p_title, 300), title), pinned = coalesce(p_pinned, pinned), unread = coalesce(p_unread, unread)
   where owner = p_owner and id = p_id
  returning to_jsonb(files) - 'owner' - 'text_body'
$$;

create or replace function public.agent_file_delete(p_owner text, p_id uuid)
returns jsonb language sql security definer set search_path to '' as $$
  with d as (delete from agent.files where owner = p_owner and id = p_id returning storage_path)
  select jsonb_build_object('deleted', exists (select 1 from d), 'storage_path', (select storage_path from d))
$$;

-- ------------------------------------------------------------------------------------------------- episodes

create or replace function public.agent_episode_put(p_owner text, p_task text, p_summary text, p_pages text[])
returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into agent.episodes (owner, task, summary, pages)
  values (p_owner, left(p_task, 2000), left(p_summary, 4000), coalesce(p_pages[1:20], '{}'));
  delete from agent.episodes where owner = p_owner and id in (
    select id from agent.episodes where owner = p_owner order by created_at desc offset 200);
end $$;

create or replace function public.agent_episode_list(p_owner text, p_limit integer default 20)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(e) - 'owner' order by e.created_at desc), '[]'::jsonb)
    from (select * from agent.episodes where owner = p_owner order by created_at desc
           limit least(greatest(p_limit, 1), 200)) e
$$;

-- ------------------------------------------------------------------------------------------------- schedules

create or replace function public.agent_schedule_put(
  p_owner text, p_id uuid, p_title text, p_task text, p_cadence text, p_at_time text, p_weekday integer,
  p_monthday integer, p_tz text, p_active boolean, p_next_run_at timestamptz
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare r agent.schedules;
begin
  if p_id is null then
    if (select count(*) from agent.schedules where owner = p_owner) >= 20 then
      raise exception 'Up to 20 scheduled tasks. Delete one first.' using errcode = '54000';
    end if;
    insert into agent.schedules (owner, title, task, cadence, at_time, weekday, monthday, tz, active, next_run_at)
    values (p_owner, left(p_title, 200), left(p_task, 2000), p_cadence, p_at_time, p_weekday, p_monthday,
            coalesce(p_tz, 'America/Chicago'), coalesce(p_active, true), p_next_run_at)
    returning * into r;
  else
    update agent.schedules
       set title = left(p_title, 200), task = left(p_task, 2000), cadence = p_cadence, at_time = p_at_time,
           weekday = p_weekday, monthday = p_monthday, tz = coalesce(p_tz, tz), active = coalesce(p_active, active),
           next_run_at = p_next_run_at
     where id = p_id and owner = p_owner
    returning * into r;
    if r.id is null then raise exception 'No such scheduled task.' using errcode = 'P0002'; end if;
  end if;
  return to_jsonb(r) - 'owner';
end $$;

create or replace function public.agent_schedule_list(p_owner text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(s) - 'owner' order by s.created_at), '[]'::jsonb)
    from agent.schedules s where s.owner = p_owner
$$;

create or replace function public.agent_schedule_get(p_owner text, p_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select to_jsonb(s) - 'owner' from agent.schedules s where s.owner = p_owner and s.id = p_id
$$;

create or replace function public.agent_schedule_delete(p_owner text, p_id uuid)
returns boolean language sql security definer set search_path to '' as $$
  with d as (delete from agent.schedules where owner = p_owner and id = p_id returning 1) select exists (select 1 from d)
$$;

-- Due schedules, locked for ten minutes so overlapping ticks never run one twice. Returns the owner with each row.
create or replace function public.agent_schedules_claim(p_limit integer default 2)
returns jsonb language sql security definer set search_path to '' as $$
  with due as (
    select id from agent.schedules
     where active and next_run_at is not null and next_run_at <= now()
       and (locked_until is null or locked_until < now())
     order by next_run_at
     limit least(greatest(p_limit, 1), 5)
     for update skip locked
  ), upd as (
    update agent.schedules s set locked_until = now() + interval '10 minutes'
      from due where s.id = due.id
    returning s.*
  )
  select coalesce(jsonb_agg(to_jsonb(upd)), '[]'::jsonb) from upd
$$;

create or replace function public.agent_schedule_finish(
  p_id uuid, p_status text, p_file uuid, p_next_run_at timestamptz
) returns void language sql security definer set search_path to '' as $$
  update agent.schedules
     set last_run_at = now(), last_status = left(p_status, 300), last_file = p_file, runs = runs + 1,
         next_run_at = p_next_run_at, active = active and p_next_run_at is not null, locked_until = null
   where id = p_id
$$;

-- ------------------------------------------------------------------------------------------------- ticks and settings

create or replace function public.agent_tick_claim(p_token text)
returns boolean language sql security definer set search_path to '' as $$
  with c as (
    update agent.ticks set used_at = now()
     where token = p_token and used_at is null and created_at > now() - interval '10 minutes'
    returning 1)
  select exists (select 1 from c)
$$;

create or replace function public.agent_settings_set(p_key text, p_value text)
returns void language sql security definer set search_path to '' as $$
  insert into agent.settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now()
   where agent.settings.value is distinct from excluded.value
$$;

create or replace function agent.tick() returns void language plpgsql security definer set search_path to '' as $$
declare site text; tok text;
begin
  delete from agent.ticks where created_at < now() - interval '1 day';
  select value into site from agent.settings where key = 'site_url';
  if site is null or site !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' then return; end if;
  if not exists (select 1 from agent.schedules where active and next_run_at <= now()
                   and (locked_until is null or locked_until < now())) then return; end if;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into agent.ticks (token) values (tok);
  perform net.http_post(
    url := site || '/api/agent/tick',
    body := jsonb_build_object('token', tok),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 290000);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'agent_memory_put(text,uuid,text,text,text,text[])', 'agent_memory_list(text,text,integer)',
    'agent_memory_delete(text,uuid)', 'agent_memory_touch(text,uuid[])',
    'agent_file_put(text,text,text,text,integer,text,text,text,jsonb,boolean)', 'agent_file_list(text,text,integer,integer)',
    'agent_file_get(text,uuid)', 'agent_file_update(text,uuid,text,boolean,boolean)', 'agent_file_delete(text,uuid)',
    'agent_episode_put(text,text,text,text[])', 'agent_episode_list(text,integer)',
    'agent_schedule_put(text,uuid,text,text,text,text,integer,integer,text,boolean,timestamptz)',
    'agent_schedule_list(text)', 'agent_schedule_get(text,uuid)', 'agent_schedule_delete(text,uuid)',
    'agent_schedules_claim(integer)', 'agent_schedule_finish(uuid,text,uuid,timestamptz)',
    'agent_tick_claim(text)', 'agent_settings_set(text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function agent.tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'agent-tick';
select cron.schedule('agent-tick', '*/5 * * * *', 'select agent.tick()');
