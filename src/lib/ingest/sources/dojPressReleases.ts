/**
 * DOJ press releases (justice.gov News API) → doj_press_releases_<year> (upsert, newest first).
 *
 * Port of scripts/enrichment/enforcement_actions/build_doj.py build_release(), with the extractors of enforcementText.ts
 * (tested equal to extract.py). A scheduled run reads the API sorted by last change, newest first (50 a page), until a
 * whole page changed more than a day before the cursor, at most 6 pages; every release read is built exactly as the
 * builder builds it and written to the partition of its release year when that is the source's year.
 *
 * Rules the builder applies across the whole collection, and how a scheduled run follows them:
 *   - stock paragraphs ("boilerplate"): a dollar figure's sentence repeated verbatim in 25 or more releases is not a
 *     resolution figure. A run uses the key set of the base build (enforcementLookups.ts, computed by
 *     scripts/api_law/enforcement/doj_boilerplate.py with the builder's own functions over the harvested pages); a
 *     sentence that first reaches 25 releases after the base build is marked at the next full build. Each run lists in
 *     its notes how many figures it marked and which base it used.
 *   - partitions: a release whose year is not the source's year (late release of the previous year, or a new year whose
 *     partition is not created yet) is held with that reason; the lead registers the next year's source.
 *   - the index dataset doj_press_releases (counts by year, component, topic) is not changed by scheduled runs.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { pyStrip } from "../py.ts";
import { corpusRecord } from "../rows.ts";
import type { CollectContext, Collected, CorpusRow, HeldRecord, Json, JsonObject, RowContent, SourceAdapter } from "../types.ts";
import { COMPANY_LOOKUP, COURT_LOOKUP, DOJ_BOILERPLATE } from "./enforcementLookups.ts";
import {
  Companies,
  NOT_RECORDED,
  RESOLUTION_CAP_USD,
  RESOLUTION_KINDS,
  STATES,
  amountBucket,
  clip,
  cpLen,
  cleanTitle,
  extractAmounts,
  extractCourts,
  extractDockets,
  extractStatutes,
  factsList,
  headlineFigure,
  htmlToText,
  moneyLabel,
  pyStr,
  rx,
  sentenceSpans,
  titleParties,
  type Headline,
} from "./enforcementText.ts";
import { htmlUnescape } from "./pyHtml.ts";

export const DOJ_API = "https://www.justice.gov/api/v1/press_releases.json";
const EXCERPT = 1500;
const CONTACT_LINE = rx(
  "^(?:CONTACT|Contact|PHONE|Phone|FAX|Fax|E-?MAIL|E-?mail|Email|PRESS OFFICE|Press Office|For Immediate Release|FOR IMMEDIATE RELEASE|Media Contact|MEDIA CONTACT)\\b[^\\n]{0,160}$",
);
const USAO = rx("^USAO - (?P<state>[A-Za-z .]+?)(?:, (?:Northern|Southern|Eastern|Western|Middle|Central))?$");

/* ------------------------------------------------------------------ small Python equivalents */

/** build_doj.epoch_date */
export function epochDate(value: unknown): string | null {
  const s = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^[+-]?\d+$/.test(s)) return null;
  const t = Number(s) * 1000;
  if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** build_doj.time_attr */
export function timeAttr(value: unknown): string | null {
  const m = /datetime="([^"]+)"/.exec(typeof value === "string" ? value : "");
  return m ? m[1]! : null;
}

/** build_doj.names */
export function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is JsonObject => Boolean(v) && typeof v === "object" && Boolean((v as JsonObject)["name"]))
    .map((v) => pyStrip(htmlUnescape(String(v["name"] ?? ""))));
}

/** build_doj.usao_state */
export function usaoState(components: string[]): string | null {
  for (const c of components) {
    const m = USAO.exec(c);
    if (!m) continue;
    let state = pyStrip(m.groups!["state"]!);
    if (state === "District of Columbia") state = "Columbia";
    const code = STATES[state];
    if (code && code !== "nmi") return code.toUpperCase();
  }
  return null;
}

/** SHA-1 hex digest of a UTF-8 string (synchronous; build_doj.sentence_key needs it). */
export function sha1Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const ml = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, Math.floor(ml / 2 ** 32));
  view.setUint32(withPad.length - 4, ml >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

/** build_doj.sentence_key */
export function sentenceKey(sentence: string | null | undefined): string {
  return sha1Hex(pyStrip((sentence ?? "").replace(rx("\\s+", "g"), " ")).toLowerCase()).slice(0, 16);
}

/** SHA-256 hex of a UTF-8 string (async: crypto.subtle). */
async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text) as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ rows */

export type DojLookups = { companies: Companies; courts: Record<string, string>; boilerplate: Set<string> };
export const defaultDojLookups = (): DojLookups => ({
  companies: new Companies(COMPANY_LOOKUP.rows),
  courts: COURT_LOOKUP.courts,
  boilerplate: new Set(DOJ_BOILERPLATE.keys),
});

function headlineLabel(h: Headline | null): string | null {
  if (!h) return null;
  const where = h.source === "title" ? "stated in the title" : `first resolution sentence: “${pyStr(h.sentence)}”`;
  return `${h.as_written} (${where})`;
}

/** build_doj.build_release: [year, row, boilerplate figures marked] */
export async function buildRelease(r: JsonObject, lk: DojLookups): Promise<[string, CorpusRow, number]> {
  const bodyHtml = String(r["body"] ?? "") || "";
  const text = htmlToText(bodyHtml);
  const title = cleanTitle(String(r["title"] ?? "") || "");
  const date = epochDate(r["date"]);
  const components = names(r["component"]);
  const topics = names(r["topic"]);
  const spans = sentenceSpans(text);
  const amounts = extractAmounts(text, spans);
  const statutes = extractStatutes(text);
  const dockets = extractDockets(text);
  const courtList = extractCourts(text);
  const parties = titleParties(title, text);
  for (const c of courtList) if (c.court_id && !(c.court_id in lk.courts)) delete c.court_id;
  const companyLinks: JsonObject[] = [];
  for (const p of parties) {
    const m = lk.companies.match(p.as_written);
    if (m) companyLinks.push({ ...m, as_written: p.as_written });
  }
  let marked = 0;
  for (const a of amounts)
    if (a.sentence && lk.boilerplate.has(sentenceKey(a.sentence))) {
      a.boilerplate = true;
      marked++;
    }
  const valued = amounts.filter((a) => a.value_usd !== undefined);
  const resolution = valued
    .filter((a) => a.keyword && RESOLUTION_KINDS.has(a.keyword) && !a.boilerplate && a.value_usd! < RESOLUTION_CAP_USD)
    .map((a) => a.value_usd!);
  const maxRes = resolution.length ? Math.max(...resolution) : null;
  const maxAny = valued.length ? Math.max(...valued.map((a) => a.value_usd!)) : null;
  let headline = headlineFigure(title, amounts, date);
  let noneReason: string | null = null;
  if (headline === null) {
    if (maxRes !== null) noneReason = "only figures about an earlier or separate matter";
  } else headline = { ...headline, differs_from_largest: maxRes !== null && Math.abs(headline.value_usd - maxRes) > 0.005 };
  // the excerpt skips leading press-contact lines
  let start = 0;
  for (const line of text.split("\n").slice(0, 8)) {
    if (CONTACT_LINE.exec(line)) start += cpLen(line) + 1;
    else break;
  }
  const rest = Array.from(text).slice(start).join("");
  const [excerpt, truncated] = clip(rest, EXCERPT);
  const courtIds = [...new Set(courtList.map((c) => c.court_id).filter((x): x is string => Boolean(x)))].sort();
  const state = usaoState(components);
  const uuid = String(r["uuid"]);
  const url = String(r["url"] ?? "") || "";
  const number = pyStrip(String(r["number"] ?? "") || "") || null;
  const created = timeAttr(r["created"]);
  const release: JsonObject = {
    uuid,
    date,
    created,
    changed: timeAttr(r["changed"]),
    number,
    components,
    topics,
    url,
    teaser: clip(htmlToText(String(r["teaser"] ?? "") || ""), 400)[0],
    amounts: amounts.slice(0, 5).map((a) => {
      const o: JsonObject = {};
      for (const k of ["as_written", "value_usd", "keyword", "sentence", "range_start", "ambiguous_as_written", "boilerplate"] as const)
        if (a[k] !== undefined) o[k] = a[k] as Json;
      o["sentence"] = clip(a.sentence ?? null, 220)[0];
      return o;
    }),
    amounts_total: amounts.length,
    max_amount_usd: maxAny,
    max_resolution_amount_usd: maxRes,
    headline_figure: headline as unknown as Json,
    ...(noneReason ? { headline_none_reason: noneReason } : {}),
    statutes: statutes.slice(0, 12).map((s) => ({ cite: s.cite, as_written: s.as_written })),
    statutes_total: statutes.length,
    dockets: dockets.slice(0, 10).map((d) => ({ as_written: d.as_written, form: d.form, ...(d.mdl !== undefined ? { mdl: d.mdl } : {}) })),
    courts: courtList.slice(0, 6).map((c) => ({ as_written: c.as_written, ...(c.court_id ? { court_id: c.court_id } : {}) })),
    parties: parties.slice(0, 6).map((p) => ({ as_written: p.as_written, kind: p.kind })),
    companies: companyLinks,
    office_state: state,
    body_chars: cpLen(text),
    body_sha256: await sha256Hex(bodyHtml),
    excerpt_truncated: truncated,
    excerpt_offset: start,
  };
  const year = (date || (created ?? "").slice(0, 10) || "0000").slice(0, 4);
  if (!date) release["date_basis"] = "DOJ release date not recorded; filed under the year the record was created";
  const links: Json[] = url.startsWith("https://") ? [{ url, label: "DOJ press release (justice.gov)" }] : [];
  for (const cid of courtIds) links.push({ url: `/courts/${cid}`, label: `Court named in the release: ${lk.courts[cid]}` });
  for (const c of companyLinks) links.push({ url: `/companies/${c["cik"]}`, label: `SEC registrant: ${c["registrant"]} (exact name match)` });
  if (state) links.push({ url: `/places/${state}`, label: `Office state (${state}, from the U.S. Attorney's Office component)` });
  const lead = components.find((c) => c.startsWith("USAO")) ?? (components[0] ?? null);
  const facts = factsList([
    ["Date", date],
    ["Components", components],
    ["Topics", topics],
    ["Release number", number],
    ["Headline figure", headlineLabel(headline) || (noneReason ? `None of its own: ${noneReason}` : null)],
    ["Largest resolution figure stated", maxRes !== null ? moneyLabel(maxRes) : null],
    ["Dollar figures stated (as written; first keyword in the sentence)", amounts.slice(0, 5).map((a) => `${a.as_written} (${a.keyword || "no keyword"})`)],
    ["Statutes cited", statutes.slice(0, 12).map((s) => s.cite)],
    ["Case or docket numbers", dockets.slice(0, 10).map((d) => d.as_written)],
    ["Federal courts named", courtList.slice(0, 6).map((c) => c.as_written)],
    ["Named in the title (as written)", parties.slice(0, 6).map((p) => p.as_written)],
    ["Excerpt (first 1,500 characters of the release)", excerpt],
    ["Source", "DOJ News API (justice.gov/api/v1/press_releases.json)"],
  ]);
  const row = corpusRecord(`doj_press_releases_${year}`, `doj-pr:${uuid}`, title || "(untitled release)", {
    source_url: url || DOJ_API,
    subtitle: [date, lead, headline ? headline.as_written : null].filter(Boolean).join(" · "),
    state: state ?? "",
    cells: {
      date: date || NOT_RECORDED,
      title,
      component: lead || NOT_RECORDED,
      amount: headline ? headline.as_written : noneReason ? "None of its own" : "No resolution figure stated",
      largest: maxRes ? moneyLabel(maxRes) : "No resolution figure stated",
    },
    facts: facts as unknown as Json,
    text: [title, release["teaser"] as string | null, parties.map((p) => p.as_written).join(" "), dockets.slice(0, 10).map((d) => d.as_written).join(" ")]
      .filter(Boolean)
      .join(" "),
    filters: {
      year: [year],
      component: components,
      topic: topics,
      amount: [amountBucket(maxRes)],
      has_docket: [dockets.length ? "yes" : "no"],
      court: courtIds,
      state: state ? [state] : [],
      company: companyLinks.map((c) => c["cik"] as string),
    },
    links,
    extra: { release },
  });
  return [year, row, marked];
}

/** The builder's partition order: release date, then created, both descending. */
export function sortReleases(rows: CorpusRow[]): CorpusRow[] {
  const key = (r: CorpusRow) => {
    const rel = (r.item["release"] ?? {}) as JsonObject;
    return [String(rel["date"] ?? ""), String(rel["created"] ?? "")] as const;
  };
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => (a.k[0] !== b.k[0] ? (a.k[0] < b.k[0] ? 1 : -1) : a.k[1] !== b.k[1] ? (a.k[1] < b.k[1] ? 1 : -1) : a.i - b.i))
    .map((x) => x.r);
}

export const dojPageUrl = (page: number) => `${DOJ_API}?sort=changed&direction=DESC&pagesize=50&page=${page}`;
const MAX_PAGES = 6;
const OVERLAP_MS = 86400_000;

/** One source per yearly partition (ingest.sources.dataset is fixed). */
export function dojPressReleases(year: number): SourceAdapter {
  const dataset = `doj_press_releases_${year}`;
  return {
    source: `doj_press_releases_${year}`,
    dataset,
    mode: "upsert",
    ordinalPolicy: "prepend",
    functionName: "ingest-doj-press-releases",
    limits: { maxRequests: MAX_PAGES, minIntervalMs: 1000 },
    secrets: [],

    async collect(ctx: CollectContext): Promise<Collected> {
      const lk = defaultDojLookups();
      const cursor = (ctx.cursor ?? {}) as JsonObject;
      let since = typeof cursor["changed_through"] === "string" ? Date.parse(String(cursor["changed_through"])) : NaN;
      if (!Number.isFinite(since)) {
        // first scheduled run: from the newest change the full build holds
        const top = await ctx.corpus.query(
          `corpus_records?select=v:item->release->>changed&dataset=eq.${dataset}&order=item->release->>changed.desc.nullslast&limit=1`,
        );
        since = Date.parse(String(top[0]?.["v"] ?? ""));
        if (!Number.isFinite(since)) throw new Error(`${dataset} has no stored change time to continue from`);
      }
      const floor = since - OVERLAP_MS;
      const held: HeldRecord[] = [];
      const rows = new Map<string, CorpusRow>();
      let fetched = 0;
      let newest = since;
      let complete = true;
      let marked = 0;
      const notes: JsonObject = { boilerplate_base: { keys: DOJ_BOILERPLATE.keys.length, releases: DOJ_BOILERPLATE.releases } };
      try {
        for (let page = 0; ; page++) {
          if (page >= MAX_PAGES) {
            complete = false;
            break;
          }
          const res = await ctx.http.getText(dojPageUrl(page));
          if (res.status !== 200) throw new Error(`justice.gov HTTP ${res.status}`);
          const doc = JSON.parse(res.text) as { results?: JsonObject[] };
          const results = Array.isArray(doc.results) ? doc.results : [];
          let anyRecent = false;
          for (const r of results) {
            fetched++;
            const changed = Date.parse(timeAttr(r["changed"]) ?? "");
            if (Number.isFinite(changed)) {
              if (changed >= floor) anyRecent = true;
              if (changed > newest) newest = changed;
              if (changed < floor) continue;
            }
            if (!r["uuid"]) {
              held.push({ key: String(r["url"] ?? "?"), reason: "release without a uuid" });
              continue;
            }
            const [y, row, m] = await buildRelease(r, lk);
            if (y !== String(year)) {
              held.push({ key: row.id, reason: `release year ${y}: belongs to doj_press_releases_${y}, not this source's partition` });
              continue;
            }
            marked += m;
            rows.set(row.id, row);
          }
          if (!results.length || !anyRecent) break;
        }
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          notes["stopped"] = error.message;
        } else throw error;
      }
      notes["boilerplate_figures_marked"] = marked;
      notes["read_back_to"] = new Date(floor).toISOString();
      return {
        rows: sortReleases([...rows.values()]),
        fetched,
        held,
        cursorAfter: complete ? { changed_through: new Date(newest).toISOString() } : ctx.cursor,
        complete,
        notes,
      };
    },

    comparable: (c: RowContent) => c as unknown as Json,
  };
}

export const dojPressReleases2026 = dojPressReleases(2026);
export const dojPressReleases2027 = dojPressReleases(2027);
