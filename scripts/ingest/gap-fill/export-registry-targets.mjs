// docket_key is the registry's own key from the row id (FJC civil convention when the printed number carries no case type).
// Read-only export of registry dockets (id, court, docket number, filed, terminated, native case ids) for local bulk matching.
import fs from 'node:fs/promises';
import {Live} from './gap-analysis-live.mjs';
import {pageAll} from './plan-internal-crosswalk.mjs';
const rows = await pageAll(new Live(), 'sw_matter_dockets_v1', 'id,cells:item->cells,native:filters->native_case_id');
await fs.writeFile(process.argv[2], rows.filter(r => r.cells).map(r => JSON.stringify({id: r.id, docket_key: (r.id.match(/^sw-md:[^:]+:(.+)$/) ?? [])[1] ?? null, court_id: r.cells.court_id, docket_number: r.cells.docket_number, filed: r.cells.filed, terminated: r.cells.terminated, native_case_ids: r.native ?? []})).join('\n') + '\n');
console.log(JSON.stringify({rows: rows.length}));
