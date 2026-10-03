import fs from 'node:fs';
const sql = fs.readFileSync('database/contracts/legal-atlas-v3.generated.sql', 'utf8');
const definitions = ['record_errors', 'evidence_valid', 'nightly_schema_report'].map(name => {
  const start = sql.indexOf(`create function legal_atlas.${name}(`);
  const end = sql.indexOf('\n$$;', start) + 4;
  if (start < 0 || end < start) throw new Error(`Missing function: ${name}`);
  return sql.slice(start, end).replace('create function', 'create or replace function');
});
const start = sql.indexOf('create view legal_atlas.visible_edges');
const end = sql.indexOf('\n\ncreate function', start);
const enums = ['data_source', 'mdl_section', 'document_role'].map(name => sql.split('\n').find(line => line.startsWith(`create type legal_atlas.${name} `)));
const update = [...enums, ...definitions, sql.slice(start, end).replace('create view', 'create or replace view'),
  'alter table legal_atlas.edges add constraint legal_evidence_span_valid check(legal_atlas.evidence_valid(evidence));',
  'revoke all on function legal_atlas.evidence_valid(jsonb) from public,anon,authenticated;',
  'grant execute on function legal_atlas.evidence_valid(jsonb) to service_role;',
].join('\n\n');
fs.writeFileSync('database/contracts/legal-atlas-v3-validation-update.sql', update + '\n');
