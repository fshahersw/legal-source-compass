-- documents_for_entries_v1: the documents-layer files of given docket entries of one MDL's master docket.
--
-- Read by src/lib/matters/command.server.ts (loadOrderDocuments) to link classified orders (CMOs, PTOs, Rule 702
-- rulings...) to their PDFs. The join is exact: mdl + court_id + docket_number + entry_number, never entry_number
-- alone (feature brief mdl-command, accuracy safeguards). Withheld documents (withheld_reason set) are never returned.
--
-- Depends on database/contracts/documents-v1.sql (schema documents, table documents.documents). Idempotent.
-- SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to service_role.
-- Lead applies; workers never write to production.

create or replace function public.documents_for_entries_v1(
  p_mdl text, p_court text, p_docket text, p_entries integer[]
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_mdl is null or p_mdl !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid mdl' using errcode = '22023'; end if;
  if p_court is null or p_court !~ '^[a-z0-9_-]{1,40}$' then raise exception 'Invalid court' using errcode = '22023'; end if;
  if p_docket is null or p_docket !~ '^[0-9A-Za-z:.-]{3,40}$' then raise exception 'Invalid docket' using errcode = '22023'; end if;
  if p_entries is null or cardinality(p_entries) not between 1 and 500 then
    raise exception 'Invalid entries' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'mdl', d.mdl, 'court_id', d.court_id, 'docket_number', d.docket_number,
      'entry_number', d.entry_number, 'attachment', d.attachment, 'document_number', d.document_number,
      'filed_date', d.filed_date, 'title', d.title, 'doc_type', d.doc_type, 'page_count', d.page_count,
      'pages_with_text', d.pages_with_text, 'text_status', d.text_status, 'source_url', d.source_url)
      order by d.entry_number, d.attachment nulls first, d.id), '[]'::jsonb)
    into v
    from documents.documents d
   where d.mdl = p_mdl
     and d.court_id = p_court
     and d.docket_number = p_docket
     and d.entry_number = any (p_entries)
     and d.withheld_reason is null;
  return v;
end $$;

revoke all on function public.documents_for_entries_v1(text, text, text, integer[]) from public, anon, authenticated;
grant execute on function public.documents_for_entries_v1(text, text, text, integer[]) to service_role;
