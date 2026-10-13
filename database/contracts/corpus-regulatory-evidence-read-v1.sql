-- Read-only source evidence snapshot for a browser-local workspace. No firm work product is received or written.
-- Install after corpus-regulatory-monitor-v1.sql.
begin;
update corpus_regulatory.sources set enabled=false,
  qualification='Adapter not configured; no monitoring cadence or capture coverage is established. Manufacturer communications are not necessarily recalls or defect findings.'
  where id='nhtsa_communications';
update corpus_regulatory.sources set count_unit='CPSC RSS recall notice entries',
  qualification='Recent official CPSC RSS feed only; GUID-based source identities are not crosswalked to API recall IDs. The returned feed is not a complete date-window or historical recall inventory. The removed injury collection remains excluded. Counts do not measure injury incidence.'
  where id='cpsc_recalls';
update corpus_regulatory.sources set qualification=qualification||' Records without a published recall number remain in retained originals and are withheld from the indexed records. The collection scope reports publisher totals, excluded counts and the dated source release; this is not a current public-alert service.'
  where id in ('openfda_enforcement_drug','openfda_enforcement_device','openfda_enforcement_food')
    and position('Records without a published recall number' in qualification)=0;
create or replace function public.corpus_regulatory_evidence_v1(p_event_ids jsonb,p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manifest jsonb; selected jsonb; digest text; now_at timestamptz:=now(); n bigint;
begin
  if jsonb_typeof(p_event_ids) is distinct from 'array' or jsonb_array_length(p_event_ids) not between 1 and 50
    or exists(select 1 from jsonb_array_elements(p_event_ids) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{64}$') then
    raise exception 'Bounded exact source-event IDs required' using errcode='22023';
  end if;
  perform corpus_regulatory.validate_query(p_query);
  select count(*),jsonb_agg(corpus_regulatory.event_json(e) order by e.detected_at,e.id) into n,selected
    from corpus_regulatory.events e where e.id in(select jsonb_array_elements_text(p_event_ids));
  if n<>jsonb_array_length(p_event_ids) then raise exception 'Every selected source event must exist exactly once' using errcode='22023'; end if;
    manifest:=jsonb_build_object('version','regulatory-brief/1','generatedAt',now_at,'title','Regulatory source evidence','query',p_query,'events',selected,
      'sources',(select jsonb_agg(corpus_regulatory.source_json(s.id) order by s.id) from corpus_regulatory.sources s where s.id in
        (select e.source_id from corpus_regulatory.events e where e.id in(select jsonb_array_elements_text(p_event_ids)))),
      'evidence',(select jsonb_agg(jsonb_build_object('eventId',e.id,'runId',o.run_id,'payloadSha256',o.payload_sha256,'rawSha256',o.source_sha256,
        'captureSourceUrl',o.source_url,'retrievedAt',o.retrieved_at,'recordPointer',o.provenance->>'record_pointer','parser',o.provenance->>'parser','currentPayloadSha256',(select cr.payload_sha256 from corpus_regulatory.records cr where cr.source_id=e.source_id and cr.native_id=e.native_id)) order by e.id,o.source_url)
        from corpus_regulatory.events e join corpus_ingest.observations o on o.run_id=e.run_id and o.source_system='regulatory:'||e.source_id
          and o.entity_type='regulatory-record' and o.native_id=e.native_id and o.payload_sha256=e.payload_sha256
        where e.id in(select jsonb_array_elements_text(p_event_ids))),
      'coverageRuns',(select jsonb_agg(jsonb_build_object('id',r.id,'source',r.source_id,'mode',r.mode,'status',r.status,'startedAt',r.started_at,'finishedAt',r.finished_at,
        'windowFrom',r.window_from,'windowTo',r.window_to,'expectedCount',r.expected_count,'observedCount',r.observed_count,'errorCode',r.error_code,'scope',r.scope) order by r.started_at,r.id)
        from corpus_regulatory.runs r where r.id in(select e.run_id from corpus_regulatory.events e where e.id in(select jsonb_array_elements_text(p_event_ids)))),
      'qualifications',jsonb_build_array('Evidence is pinned to the selected retained source versions; this document does not establish current legal status, causation or liability.',
      'Event counts and dates describe source records and observations, not injury incidence. Initial and backfilled records are explicitly labeled.',
      'Native references are source assertions; entity labels do not establish case membership or unique person/product identity.'));
    if pg_column_size(manifest)>1500000 then raise exception 'Selected brief evidence exceeds the bounded export size; select fewer events' using errcode='22023'; end if;
    digest:=corpus_ingest.canonical_integer_jsonb_sha256_v1(manifest);
  return jsonb_build_object('manifest',manifest,'manifestSha256',digest);
end;
$$;
revoke all on function public.corpus_regulatory_evidence_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.corpus_regulatory_evidence_v1(jsonb,jsonb) to service_role;
comment on function public.corpus_regulatory_evidence_v1(jsonb,jsonb) is 'Read-only bounded source snapshot for local briefs. No user identity, private title, notes or investigation state are accepted.';
commit;
