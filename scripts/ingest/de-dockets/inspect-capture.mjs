// Prints the shape of a saved DocketBird connector capture (get_docket_sheet JSON) without printing signed links.
//   node scripts/ingest/de-dockets/inspect-capture.mjs <file>
import fs from "node:fs";
import { parseConnectorCapture } from "./docketbird-capture.mjs";

for (const file of process.argv.slice(2)) {
  const cap = parseConnectorCapture(fs.readFileSync(file, "utf8"));
  const docs = cap.documents ?? [];
  const keys = new Set();
  for (const d of docs) for (const k of Object.keys(d)) keys.add(k);
  const dates = docs
    .map((d) => d.filing_date ?? d.date_filed)
    .filter(Boolean)
    .sort();
  console.log(
    JSON.stringify({
      file: file.split(/[\\/]/).pop(),
      top: Object.keys(cap),
      remaining_today: cap.remaining_today,
      entries_total: cap.entries_total,
      entries_returned: cap.entries_returned,
      docs: docs.length,
      doc_keys: [...keys],
      min_date: dates[0] ?? null,
      max_date: dates.at(-1) ?? null,
      sample: docs
        .slice(0, 2)
        .map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !/url/i.test(k)))),
    }),
  );
}
