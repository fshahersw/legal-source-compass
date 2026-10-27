// Read-only probe of the DocketBird REST account: which master dockets can the account already read (GET /cases, GET /cases/<id>)?
// Never follows a case (a follow can be billed) and never downloads a PDF. Raw responses are kept content-addressed in --acq.
//   node --use-system-ca scripts/ingest/de-dockets/probe-docketbird.mjs --acq=<private acq dir> [--case=<docketbird id>]
import fs from "node:fs/promises";
import path from "node:path";
import { DocketBird } from "../gap-fill/clients.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (!args.acq) throw new Error("--acq is required");
const acq = path.resolve(args.acq);
await fs.mkdir(path.join(acq, "docketbird-raw"), { recursive: true });
const db = new DocketBird({
  cacheDir: path.join(acq, "docketbird-raw"),
  maxRequests: Number(args["max-requests"] ?? 3),
  minGapMs: 1000,
});
const shape = (v) =>
  Array.isArray(v)
    ? `array(${v.length})`
    : v && typeof v === "object"
      ? `object{${Object.keys(v).slice(0, 25).join(",")}}`
      : typeof v;
if (args.case) {
  const r = await db.get(`/cases/${args.case}`);
  console.log(
    JSON.stringify({
      case: args.case,
      untracked: !!r.untracked,
      notFound: !!r.notFound,
      data: shape(r.data),
      case_keys: shape(r.data?.case),
      status: r.receipt.http_status,
    }),
  );
} else {
  const r = await db.get("/cases", {});
  const list = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.cases) ? r.data.cases : [];
  console.log(
    JSON.stringify({
      data: shape(r.data),
      first: shape(list[0]),
      status: r.receipt.http_status,
      sha256: r.receipt.source_sha256,
    }),
  );
  console.log(JSON.stringify(list.map((c) => c.id ?? c.case_id ?? null)));
}
