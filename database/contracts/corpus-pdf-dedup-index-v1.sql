-- Read-only, service-role-only keyset pages of what private PDF storage already holds, so the transfer worker can register a
-- source-native association WITHOUT downloading bytes that were already hash-verified. No writes; no source payload, party or
-- contact data. 'objects' returns the immutable byte identities (SHA-256, SHA-1, size, first verification time);
-- 'assets' returns, per CourtListener-family source document, the SHA-256 values it was verified as (for the public-locator
-- family the native_document_id is the exact RECAP file URL).
create or replace function public.corpus_admin_pdf_dedup_index_v1(p_kind text, p_after text default '', p_limit integer default 5000)
returns jsonb language plpgsql stable security definer set search_path='' as $pdf_dedup_index_v1$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_kind is null or p_kind not in ('objects','assets')
  or p_limit is null or p_limit not between 1 and 10000 or length(coalesce(p_after,''))>700 then
  raise exception 'Bounded private PDF dedup index request required' using errcode='22023';
 end if;
 if p_kind='objects' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('sha256',t.sha256,'sha1',t.sha1,'bytes',t.bytes,'first_verified_at',t.first_verified_at) order by t.sha256 collate "C"),'[]'::jsonb),
   'last',max(t.sha256 collate "C")) into result
  from (select o.sha256,o.sha1,o.bytes,o.first_verified_at from corpus_ingest.pdf_objects o
        where o.sha256 collate "C">coalesce(p_after,'') collate "C" order by o.sha256 collate "C" limit p_limit) t;
 else
  select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('source_system',t.source_system,'native_document_id',t.native_document_id,'sha256s',t.sha256s,'first_verified_at',t.first_verified_at) order by t.k collate "C"),'[]'::jsonb),
   'last',max(t.k collate "C")) into result
  from (select a.source_system,a.native_document_id,a.source_system||'|'||a.native_document_id as k,array_agg(distinct a.sha256) as sha256s,min(a.verified_at) as first_verified_at
        from corpus_ingest.pdf_document_assets a
        where a.source_system in ('courtlistener','courtlistener-public-locator')
         and (a.source_system||'|'||a.native_document_id) collate "C">coalesce(p_after,'') collate "C"
        group by a.source_system,a.native_document_id
        order by (a.source_system||'|'||a.native_document_id) collate "C" limit p_limit) t;
 end if;
 return result;
end $pdf_dedup_index_v1$;
revoke all on function public.corpus_admin_pdf_dedup_index_v1(text,text,integer) from public,anon,authenticated;
grant execute on function public.corpus_admin_pdf_dedup_index_v1(text,text,integer) to service_role;
