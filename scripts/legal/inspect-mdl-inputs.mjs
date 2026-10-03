import { DatabaseSync } from 'node:sqlite';
const [database, docketId] = process.argv.slice(2);
const db = new DatabaseSync(database, { readOnly: true });
let total = 0; const selected = [];
for (const row of db.prepare("select native_id,raw_json from inputs where native_type in ('docket-entries','docket_entries')").iterate()) {
  const d = JSON.parse(row.raw_json).data;
  if (String(d.docket_id ?? d.docket).replace(/\/$/, '').split('/').at(-1) !== docketId) continue;
  total++;
  if (/lead|appoint|steering|counsel|case management|daubert/i.test(d.description ?? '')) selected.push({ id: row.native_id, date: d.date_filed, entry: d.entry_number, description: d.description, documents: d.recap_documents });
}
console.log(JSON.stringify({ total, selected }, null, 2)); db.close();
