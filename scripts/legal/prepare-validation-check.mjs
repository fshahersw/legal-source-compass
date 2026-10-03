import fs from 'node:fs';
import { legalRecord } from '../../src/lib/legal/schema.ts';
const base = { id: 'njd', type: 'court', id_authority: 'courtlistener', title: 'District of New Jersey', title_source: 'api', jurisdiction: 'US', court_id: 'njd', date: '2026-10-02', date_type: 'retrieved', source_url: 'https://www.courtlistener.com/c/njd/', source_name: 'CourtListener', licence: 'Public Domain Mark 1.0', retrieved_at: '2026-10-02T12:00:00Z', version: '2026-09-30', confidence: 1, extraction_method: 'bulk', identifiers: { courtlistener_court_id: 'njd' }, attributes: {} };
const cases = [];
const add = (name, candidate) => cases.push({ name, candidate, valid: legalRecord.safeParse(candidate).success });
add('valid court', base);
for (const field of Object.keys(base)) {
  const missing = { ...base }; delete missing[field]; add(`missing ${field}`, missing);
  add(`null ${field}`, { ...base, [field]: null });
}
for (const patch of [{ type: 'imagined' }, { date: '2026-02-30' }, { date: '10/2/2026' }, { court_id: 123 }, { id: 'New Jersey' }, { id_authority: 'publisher' }, { licence: 'unknown' }, { source_url: 'https://user:pass@example.com' }, { source_url: 'mailto:a@example.com' }, { confidence: '1' }, { confidence: 1.1 }, { identifiers: { bad: [] } }, { identifiers: { bad: 12 } }, { unexpected: true }, { attributes: { order_class: 'guess' } }, { attributes: { document_role: null } }]) add(JSON.stringify(patch), { ...base, ...patch });
const types = {
  judge: { id: '1394031', id_authority: 'fjc', identifiers: { fjc_nid: '1394031', courtlistener_person_id: '2955' } },
  fr_document: { id: '99-34083', id_authority: 'federal_register', date: '2000-01-03', date_type: 'published', attributes: { fr_document_type: 'NOTICE' } },
  agency: { id: 'food-and-drug-administration', id_authority: 'federal_register', attributes: { parent_agency: 'health-and-human-services-department' } },
  cfr_section: { id: '21 CFR 314.70', id_authority: 'ecfr', attributes: { version_date: '2026-09-30' } },
  usc_section: { id: '21 USC 355', id_authority: 'uscode', version: '118-158', attributes: { release_point: '118-158' } },
  image: { id: 'https://www.njd.uscourts.gov/image.jpg', id_authority: 'publisher', attributes: { alt: 'Court seal', object_key: 'reviewed/seal.jpg', kind: 'court_seal', origin: 'court_website', review_status: 'pending', origin_verified: false } },
};
for (const [type, fields] of Object.entries(types)) {
  const record = { ...base, ...fields, type }; add(`valid ${type}`, record);
  add(`${type} missing metadata`, { ...record, attributes: {}, identifiers: {} });
}
const json = JSON.stringify(cases);
if (json.includes('$cases$')) throw new Error('SQL delimiter collision');
fs.writeFileSync(process.argv[2], `with tests as (select value->>'name' as name, value->'candidate' as candidate, (value->>'valid')::boolean as expected from jsonb_array_elements($cases$${json}$cases$::jsonb)), checked as (select *,legal_atlas.record_errors(candidate) errors from tests) select jsonb_build_object('checks',count(*),'mismatches',coalesce(jsonb_agg(jsonb_build_object('name',name,'expected',expected,'errors',errors)) filter(where expected<>(cardinality(errors)=0)),'[]')) as validation_check from checked;\n`);
console.log(JSON.stringify({ checks: cases.length, prepared_file: process.argv[2] }));
