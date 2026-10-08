/**
 * Third currency route for limitations sources whose official host does not answer the review environment
 * directly and whose jurisdiction has no reviewed code text in the corpus to match against.
 *
 * The same official URL is fetched again through a fetch proxy (`--proxy=firecrawl|tavily`, via `capture.py --via`):
 * only listed official hosts, never a publisher terms gate, raw proxy response retained byte-for-byte, page
 * text normalised to plain text. The passages the release relies on from that source (rule excerpt, period
 * words, tolling text — only those the retained capture itself contains) are then re-matched literally.
 *
 *   every passage found  -> proxied_evidence_intact      (builder: confirmed_evidence_intact, route "proxied")
 *   nothing quoted       -> proxied_no_evidence_tracked  (builder: confirmed_evidence_intact, "no passage compared")
 *   passage(s) missing   -> proxied_passage_missing      (builder: stays not_rechecked, listed for manual review;
 *                           this route never issues evidence_lost on its own — an extraction difference, not an
 *                           amendment, can hide a passage)
 *   proxy failed/refused -> proxy_failed                 (builder: stays not_rechecked, reason recorded)
 *
 * Reads:   --bundle (rules.json, sources.json, text/)        default /tmp/lim/out-r3/limitations
 * Writes:  --out results JSON                               default /tmp/lim/recheck/results-proxy.json
 *          --review manual-review JSON                      default /tmp/lim/recheck/proxy-review.json
 *          --captures flat <sourceId>.{raw,txt,json} copies default /tmp/lim/recheck/captures-proxy
 *          and the capture tool's own files under $LIM_WORK/captures/<ST>/rc-<sourceId>.* (staged as raw objects)
 * Options: --only=id1,id2  --concurrency=N (default 2; proxies rate-limit, 429/5xx back off 15 s × attempt)  --include-statuses=not_rechecked (default)
 * Requires FIRECRAWL_API_KEY (plus LOVABLE_API_KEY for a gateway connection key) or TAVILY_API_KEY in the
 * environment; never printed. Already-rechecked ids in --out are skipped unless --redo=true is given;
 * --reuse=true re-compares against capture files already on disk instead of fetching again.
 *
 * Run from the project root: bun scripts/limitations/backfill/recheck-via-proxy.ts
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { containsLiteral, normalizeText } from "@/lib/limitations/backfill/entries";
import type { LimitationRule, LimitationSource } from "@/lib/limitations/types";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
) as Record<string, string>;

const bundle = args["bundle"] ?? "/tmp/lim/out-r3/limitations";
const outFile = args["out"] ?? "/tmp/lim/recheck/results-proxy.json";
const reviewFile = args["review"] ?? "/tmp/lim/recheck/proxy-review.json";
const capturesOut = args["captures"] ?? "/tmp/lim/recheck/captures-proxy";
const work = process.env["LIM_WORK"] ?? "/tmp/lim/work";
const concurrency = Math.max(1, Number(args["concurrency"] ?? 2));
const only = args["only"] ? new Set(args["only"].split(",")) : null;
const includeStatuses = new Set((args["include-statuses"] ?? "not_rechecked").split(","));
const proxy = (args["proxy"] ?? "firecrawl") as "firecrawl" | "tavily";
if (proxy !== "firecrawl" && proxy !== "tavily") {
  console.error("--proxy must be firecrawl or tavily");
  process.exit(2);
}
const keyName = proxy === "firecrawl" ? "FIRECRAWL_API_KEY" : "TAVILY_API_KEY";
const captureTool = new URL("./capture.py", import.meta.url).pathname;

if (!process.env[keyName]) {
  console.error(`${keyName} is not set in the environment`);
  process.exit(2);
}

const rules: LimitationRule[] = JSON.parse(readFileSync(join(bundle, "rules.json"), "utf8")).rules;
const sources: LimitationSource[] = JSON.parse(readFileSync(join(bundle, "sources.json"), "utf8")).sources;

const retainedText = (s: LimitationSource) => {
  const p = join(bundle, s.textPath.replace(/^\/data\/limitations\//, ""));
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

type Needle = { ruleId: string; kind: "excerpt" | "period" | "tolling"; text: string };
/** Passages the release relies on from a source: only those its retained capture literally contains. */
function needlesFor(source: LimitationSource): Needle[] {
  const retained = retainedText(source);
  const out: Needle[] = [];
  for (const rule of rules) {
    if (!rule.sourceIds.includes(source.id) || !rule.provenance) continue;
    const p = rule.provenance;
    const candidates: Needle[] = [
      { ruleId: rule.id, kind: "excerpt", text: p.excerpt },
      { ruleId: rule.id, kind: "period", text: p.periodEvidence },
      ...p.tolling.map((t) => ({ ruleId: rule.id, kind: "tolling" as const, text: t.text })),
    ];
    for (const c of candidates) if (c.text && containsLiteral(retained, c.text)) out.push(c);
  }
  return out;
}

/**
 * Second, disclosed comparison for extracted copies: the same words in the same order, ignoring spaces that an
 * extractor puts before punctuation ("injury , not"), after an opening bracket, and line-break hyphenation
 * ("mali- cious" / "mali-cious"; every letter-hyphen-lowercase join is applied to both sides alike). Recorded as
 * matchMode "spacing_normalized".
 */
function spacingNormalized(value: string): string {
  return normalizeText(value)
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/(\p{L})-\s?(\p{Ll})/gu, "$1$2");
}
type MatchMode = "literal" | "spacing_normalized";
function matchPassage(haystack: string, needle: string): MatchMode | null {
  if (containsLiteral(haystack, needle)) return "literal";
  const n = spacingNormalized(needle);
  return n.length >= 8 && spacingNormalized(haystack).includes(n) ? "spacing_normalized" : null;
}

export type ProxyRecheckResult = {
  url: string;
  sourceIds: string[];
  checkedAt: string;
  status: "proxied_evidence_intact" | "proxied_no_evidence_tracked" | "proxied_passage_missing" | "proxy_failed";
  route: "proxied";
  proxy: "firecrawl" | "tavily";
  captureId?: string;
  captureState?: string;
  rawSha256?: string;
  textSha256?: string;
  textBytes?: number;
  sameText?: boolean;
  http?: number;
  error?: string;
  attempts: number;
  evidence: { sourceId: string; ruleId: string; kind: string; found: boolean; matchMode?: MatchMode }[];
};

const GATED = ["lexisnexis.com", "lexis.com", "westlaw.com", "casetext.com", "fastcase.com", "vlex.com"];

const targets = sources.filter((s) => {
  if (only) return only.has(s.id);
  if (!includeStatuses.has(s.currency?.status ?? "none")) return false;
  if (!/^https:\/\//.test(s.url)) return false;
  const host = new URL(s.url).hostname;
  return !GATED.some((g) => host.endsWith(g));
});
console.log(`proxy recheck: ${targets.length} source(s) from ${bundle}`);

const captureId = (id: string) => `rc-${id.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`.slice(0, 80);

function runCapture(state: string, cid: string, url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("python3", [captureTool, state, cid, url, "--via", proxy], {
      env: { ...process.env, LIM_WORK: work },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (out += String(d)));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recheck(source: LimitationSource): Promise<ProxyRecheckResult> {
  const state = source.state.toUpperCase();
  const cid = captureId(source.id);
  const needles = needlesFor(source);
  let attempts = 0;
  let last: { code: number; out: string } = { code: 1, out: "" };
  const reuse = args["reuse"] === "true" && existsSync(join(work, "captures", state, `${cid}.json`));
  if (reuse) last = { code: 0, out: "reused" };
  while (!reuse && attempts < 5) {
    attempts++;
    last = await runCapture(state, cid, source.url);
    if (last.code === 0) break;
    const m = /"status":\s*(\d+)/.exec(last.out);
    const http = m ? Number(m[1]) : 0;
    if (http === 429 || http >= 500) {
      await sleep(15000 * attempts);
      continue;
    }
    break;
  }
  const checkedAt = new Date().toISOString();
  const base = { url: source.url, sourceIds: [source.id], checkedAt, route: "proxied" as const, proxy, attempts };
  if (last.code !== 0) {
    const m = /"status":\s*(\d+)/.exec(last.out);
    return {
      ...base,
      status: "proxy_failed",
      ...(m ? { http: Number(m[1]) } : {}),
      error: last.out.replace(/\s+/g, " ").trim().slice(0, 240),
      evidence: needles.map((n) => ({ sourceId: source.id, ruleId: n.ruleId, kind: n.kind, found: false })),
    };
  }
  const dir = join(work, "captures", state);
  const meta = JSON.parse(readFileSync(join(dir, `${cid}.json`), "utf8")) as {
    rawSha256: string;
    textSha256: string;
    textBytes: number;
  };
  const fresh = readFileSync(join(dir, `${cid}.txt`), "utf8");
  mkdirSync(capturesOut, { recursive: true });
  for (const ext of ["raw", "txt", "json"]) copyFileSync(join(dir, `${cid}.${ext}`), join(capturesOut, `${source.id}.${ext}`));
  const evidence = needles.map((n) => {
    const mode = matchPassage(fresh, n.text);
    return { sourceId: source.id, ruleId: n.ruleId, kind: n.kind, found: mode !== null, ...(mode ? { matchMode: mode } : {}) };
  });
  const missing = evidence.filter((e) => !e.found).length;
  const status: ProxyRecheckResult["status"] =
    evidence.length === 0 ? "proxied_no_evidence_tracked" : missing ? "proxied_passage_missing" : "proxied_evidence_intact";
  return {
    ...base,
    status,
    captureId: cid,
    captureState: state,
    rawSha256: meta.rawSha256,
    textSha256: meta.textSha256,
    textBytes: meta.textBytes,
    sameText: meta.textSha256 === source.sha256,
    http: 200,
    evidence,
  };
}

const previous: ProxyRecheckResult[] =
  existsSync(outFile) && args["redo"] !== "true" ? JSON.parse(readFileSync(outFile, "utf8")) : [];
const done = new Set(previous.filter((r) => r.status !== "proxy_failed").map((r) => r.sourceIds[0]));
const pending = targets.filter((s) => !done.has(s.id));
console.log(`${done.size} already rechecked in ${outFile}; ${pending.length} to do`);
const results: ProxyRecheckResult[] = previous.filter((r) => done.has(r.sourceIds[0]!));
let next = 0;
async function worker() {
  while (next < pending.length) {
    const s = pending[next++]!;
    const r = await recheck(s);
    results.push(r);
    const found = r.evidence.filter((e) => e.found).length;
    const tolerant = r.evidence.filter((e) => e.matchMode === "spacing_normalized").length;
    console.log(`${r.status.padEnd(28)} ${s.id.padEnd(34)} passages ${found}/${r.evidence.length}${tolerant ? ` (${tolerant} spacing-normalized)` : ""}${r.error ? `  ${r.error.slice(0, 100)}` : ""}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

mkdirSync(join(outFile, ".."), { recursive: true });
results.sort((a, b) => a.sourceIds[0]!.localeCompare(b.sourceIds[0]!));
writeFileSync(outFile, JSON.stringify(results, null, 1) + "\n");
const review = results
  .filter((r) => r.status === "proxied_passage_missing")
  .map((r) => ({
    sourceId: r.sourceIds[0],
    url: r.url,
    captureId: r.captureId,
    missing: r.evidence.filter((e) => !e.found),
  }));
writeFileSync(reviewFile, JSON.stringify(review, null, 1) + "\n");
const tally: Record<string, number> = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(JSON.stringify({ targets: targets.length, ...tally, out: outFile, review: reviewFile }));
