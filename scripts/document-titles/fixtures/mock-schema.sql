-- TEST FIXTURE ONLY: synthetic rows in a throwaway in-memory PGlite database. Mirrors only the columns the contract touches.
create role service_role; create role anon; create role authenticated;
create schema corpus_ingest; create schema auth;
create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
create table corpus_ingest.runs (id uuid primary key, contract_version text not null default 'corpus-ingest/1',
  status text not null check (status in ('running','partial','completed','failed')), scope jsonb not null,
  started_at timestamptz not null default now(), finished_at timestamptz, counts jsonb not null default '{}');
create table corpus_ingest.cleanup_decisions (dataset text not null, record_id text not null, issue text not null,
  disposition text not null check (disposition in ('review','canonical_alias','quarantine','label_override')),
  reason text not null, evidence jsonb not null, original_record jsonb not null, replacement jsonb,
  reviewed_at timestamptz not null default now(), run_id uuid not null references corpus_ingest.runs(id), primary key(dataset,record_id,issue));
create table public.corpus_datasets(id text primary key, imported_records bigint);
create table public.corpus_records(dataset text not null, id text not null, ordinal bigint, title text, state text, category text, source_url text, text text,
  item jsonb default '{}', detail jsonb default '{}', filters jsonb default '{}', county_geoids text[] default '{}',
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(title,''))) stored, primary key(dataset,id));
