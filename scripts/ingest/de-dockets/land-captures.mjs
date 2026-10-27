// Lands DocketBird connector captures (get_docket_sheet answers) in the private acquisition directory, read-only with respect to production.
// Sources: answers the session harness saved verbatim to files (--files) and answers that came back inline, read verbatim from the session
// transcript (--transcript, tool_result blocks whose text is a docket-sheet JSON object). Nothing is retyped.
// Each landed capture: <acq>/docketbird-sheets/<case>__<sort>__<sha12>.json (signed PDF query strings removed) + one line in index.jsonl.
//   node scripts/ingest/de-dockets/land-captures.mjs --acq=<dir> [--files=<f1,f2,...>] [--transcript=<session jsonl>]
import fs from "node:fs";
import path from "node:path";
import { normalizeCapture, sha256 } from "./docketbird-capture.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (!args.acq) throw new Error("--acq is required");
const outDir = path.join(path.resolve(args.acq), "docketbird-sheets");
fs.mkdirSync(outDir, { recursive: true });
const indexFile = path.join(outDir, "index.jsonl");
const seen = new Set(
  fs.existsSync(indexFile)
    ? fs
        .readFileSync(indexFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l).source_sha256)
    : [],
);

/** Yields {text, retrievedAt, origin} for every candidate capture. */
function* sources() {
  for (const f of String(args.files ?? "")
    .split(",")
    .filter(Boolean)) {
    yield {
      text: fs.readFileSync(f, "utf8"),
      retrievedAt: fs.statSync(f).mtime.toISOString(),
      origin: `file:${path.basename(f)}`,
    };
  }
  if (args.transcript) {
    for (const line of fs.readFileSync(args.transcript, "utf8").split("\n")) {
      if (!line.includes("remaining_today") || !line.includes("tool_result")) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const blocks = rec?.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks) {
        if (b?.type !== "tool_result") continue;
        const parts =
          typeof b.content === "string"
            ? [b.content]
            : Array.isArray(b.content)
              ? b.content.filter((x) => x?.type === "text").map((x) => x.text)
              : [];
        for (const t of parts)
          if (/^\s*\{"remaining_today"/.test(t) && /"documents"\s*:/.test(t))
            yield {
              text: t,
              retrievedAt: rec.timestamp ?? null,
              origin: `transcript:${rec.uuid ?? "unknown"}`,
            };
      }
    }
  }
}

const landed = [];
for (const s of sources()) {
  const sourceSha = sha256(s.text);
  if (seen.has(sourceSha)) {
    landed.push({ origin: s.origin, skipped: "already landed" });
    continue;
  }
  let cap;
  try {
    cap = normalizeCapture(s.text, { retrievedAt: s.retrievedAt });
  } catch (e) {
    landed.push({ origin: s.origin, error: e.message });
    continue;
  }
  const name = `${cap.case_id.replace(/[^A-Za-z0-9-]/g, "_")}__${cap.sort}__${cap.source_sha256.slice(0, 12)}.json`;
  const body = JSON.stringify(cap, null, 1);
  fs.writeFileSync(path.join(outDir, name), body, { flag: "wx" });
  const line = {
    file: name,
    case_id: cap.case_id,
    sort: cap.sort,
    retrieved_at: cap.retrieved_at,
    source_sha256: cap.source_sha256,
    source_bytes: cap.source_bytes,
    stored_sha256: sha256(body),
    entries_total: cap.entries_total,
    entries_returned: cap.entries_returned,
    documents: cap.documents.length,
    origin: s.origin,
  };
  fs.appendFileSync(indexFile, JSON.stringify(line) + "\n");
  seen.add(sourceSha);
  landed.push(line);
}
for (const l of landed) console.log(JSON.stringify(l));
