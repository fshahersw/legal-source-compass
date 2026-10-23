/**
 * GovInfo collections (wave 1025, api-law): bill text versions (BILLS, grouped per bill), congressional hearings (CHRG),
 * committee prints (CPRT) and GAO reports and Comptroller General decisions (GAOREPORTS, 1994-2008), as corpus rows.
 * One implementation for the full load (scripts/api_law/govinfo/*.mjs) and the scheduled refresh
 * (supabase/functions/ingest-govinfo).
 *
 * Rows come from GovInfo's collection listing (package id, title, issue date, Congress, document class, last modified)
 * and, where read, the package summary (held dates, chamber, session, pages, committees, issuing division). A field not
 * read yet is "Not recorded". Links are GovInfo's own: the details page and the content files of the package id
 * (https://www.govinfo.gov/content/pkg/<id>/{pdf,html,xml}/<id>.{pdf,htm,xml}). A bill version links to congress_bills
 * only when its Congress, type and number name a held bill; a hearing links to a committee only by GovInfo's
 * committee authority id equal to a congress_committees system code.
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type { CollectContext, Collected, CorpusRow, HeldRecord, Json, JsonObject, RowContent, SourceAdapter, StoredRow } from "../types.ts";

export const GI_API = "https://api.govinfo.gov";
export const GI_SITE = "https://www.govinfo.gov";
export const GI_DOCS = "https://api.govinfo.gov/docs/";
export const NOT_RECORDED = "Not recorded";
export const GI_DATASETS = {
  BILLS: "govinfo_bill_versions",
  CHRG: "govinfo_hearings",
  CPRT: "govinfo_committee_prints",
  GAOREPORTS: "govinfo_gao_reports",
} as const;
export type Collection = keyof typeof GI_DATASETS;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const obj = (v: unknown): JsonObject | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null);
const arr = (v: unknown): JsonObject[] => (Array.isArray(v) ? (v.filter((x) => obj(x)) as JsonObject[]) : []);
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export const detailsUrl = (id: string) => `${GI_SITE}/app/details/${id}`;
export const contentUrl = (id: string, kind: "pdf" | "html" | "xml") =>
  `${GI_SITE}/content/pkg/${id}/${kind}/${id}.${kind === "html" ? "htm" : kind}`;
export const summaryUrl = (id: string) => `${GI_API}/packages/${id}/summary`;
export const collectionUrl = (c: Collection, since: string, offsetMark = "*", pageSize = 1000, until?: string) =>
  `${GI_API}/collections/${c}/${since}${until ? `/${until}` : ""}?pageSize=${pageSize}&offsetMark=${encodeURIComponent(offsetMark)}`;

/** A package of a collection listing, values as published. */
export type Listed = {
  packageId: string;
  title: string | null;
  dateIssued: string | null;
  congress: string | null;
  docClass: string | null;
  lastModified: string | null;
};
export function normalizeListed(p: JsonObject): Listed | null {
  const id = str(p["packageId"]);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9_.-]{3,120}$/.test(id)) return null;
  return {
    packageId: id,
    title: str(p["title"]),
    dateIssued: day(p["dateIssued"]),
    congress: str(p["congress"]),
    docClass: str(p["docClass"]),
    lastModified: str(p["lastModified"]),
  };
}

/** The summary fields kept (as published). */
export type Summary = {
  title: string | null;
  session: string | null;
  chamber: string | null;
  pages: string | null;
  heldDates: string[];
  committees: { name: string | null; authorityId: string | null }[];
  author: string | null;
  documentNumber: string | null;
  suDocClassNumber: string | null;
};
export function normalizeSummary(s: JsonObject | null): Summary | null {
  if (!s || !str(s["packageId"])) return null;
  return {
    title: str(s["title"]),
    session: str(s["session"]),
    chamber: str(s["chamber"]),
    pages: str(s["pages"]),
    heldDates: (Array.isArray(s["heldDates"]) ? (s["heldDates"] as Json[]) : []).map(day).filter((x): x is string => Boolean(x)),
    committees: arr(s["committees"]).map((c) => ({ name: str(c["committeeName"]), authorityId: str(c["authorityId"]) })),
    author: str(s["governmentAuthor2"]),
    documentNumber: str(s["documentNumber"]),
    suDocClassNumber: str(s["suDocClassNumber"]),
  };
}

export type GiProv = { listing_url: string; retrieved_at: string; summary_url: string | null; summary_retrieved_at: string | null };

/* ------------------------------------------------------------------ hearings, prints, GAO reports */

const COLLECTION_LABEL: Record<Exclude<Collection, "BILLS">, { noun: string; name: string }> = {
  CHRG: { noun: "Hearing", name: "Congressional Hearings" },
  CPRT: { noun: "Committee print", name: "Congressional Committee Prints" },
  GAOREPORTS: { noun: "GAO report", name: "GAO Reports and Comptroller General Decisions" },
};
const CLASS_LABEL: Record<string, string> = {
  HHRG: "House hearing",
  SHRG: "Senate hearing",
  JHRG: "Joint hearing",
  HPRT: "House committee print",
  SPRT: "Senate committee print",
  JPRT: "Joint committee print",
  REPORT: "Report",
  DECISION: "Comptroller General decision",
};

/** Jacket number of a hearing package (CHRG-118hhrg51658 → 51658); null when the id has another form. */
export function hearingJacket(id: string): string | null {
  const m = /^CHRG-\d{2,3}[hsj]hrg(\d{3,6})/.exec(id);
  return m ? m[1]! : null;
}

export function packageRow(
  c: Exclude<Collection, "BILLS">,
  p: Listed,
  s: Summary | null,
  knownCommittees: Set<string>,
  prov: GiProv,
): CorpusRow {
  const label = COLLECTION_LABEL[c];
  const cls = p.docClass ? (CLASS_LABEL[p.docClass] ?? p.docClass) : null;
  const congress = p.congress && /^\d+$/.test(p.congress) ? Number(p.congress) : null;
  const title = s?.title ?? p.title ?? `${label.noun} ${p.packageId}`;
  const links: Json[] = [
    { url: detailsUrl(p.packageId), label: "Details on GovInfo" },
    { url: contentUrl(p.packageId, "pdf"), label: "PDF (GovInfo)" },
  ];
  for (const cm of s?.committees ?? [])
    if (cm.authorityId && knownCommittees.has(cm.authorityId))
      links.push({ url: `/law/legislation/committees/${cm.authorityId}`, label: `Committee: ${cm.name ?? cm.authorityId}` });
  const jacket = c === "CHRG" ? hearingJacket(p.packageId) : null;
  const year = (s?.heldDates[0] ?? p.dateIssued ?? "").slice(0, 4);
  const facts: [string, string][] = [
    ["GovInfo package", p.packageId],
    ["Collection", label.name],
    ["Document class", cls ?? NOT_RECORDED],
    ["Title (as published)", title],
    ["Date issued", p.dateIssued ?? NOT_RECORDED],
  ];
  if (c === "CHRG") {
    facts.push(["Held on", s ? (s.heldDates.length ? s.heldDates.join("; ") : "Not stated in the summary") : NOT_RECORDED]);
    facts.push(["Jacket number", jacket ?? NOT_RECORDED]);
  }
  if (c !== "GAOREPORTS") {
    facts.push(["Congress and session", congress ? `${ordinal(congress)} Congress${s?.session ? `, session ${s.session}` : ""}` : NOT_RECORDED]);
    facts.push(["Chamber", s?.chamber ?? NOT_RECORDED]);
    facts.push([
      "Committees (GovInfo)",
      s ? (s.committees.length ? s.committees.map((x) => `${x.name ?? ""}${x.authorityId ? ` (${x.authorityId})` : ""}`).join("; ") : "Not listed in the summary") : NOT_RECORDED,
    ]);
  } else {
    facts.push(["Issuing unit", s?.author ?? NOT_RECORDED]);
    facts.push(["SuDoc class", s?.suDocClassNumber ?? NOT_RECORDED]);
  }
  facts.push(["Pages", s?.pages ?? NOT_RECORDED]);
  facts.push(["Summary read", s ? "yes" : "no (listing entry only)"]);
  facts.push(["Last modified on GovInfo", p.lastModified ?? NOT_RECORDED]);
  facts.push(["Source", `GovInfo API, collection ${c} (${GI_DOCS})`]);
  return corpusRecord(GI_DATASETS[c], p.packageId, title, {
    source_url: detailsUrl(p.packageId),
    subtitle: [cls, s?.heldDates.length ? `held ${s.heldDates[0]}` : p.dateIssued ? `issued ${p.dateIssued}` : null, congress ? `${ordinal(congress)} Congress` : null]
      .filter(Boolean)
      .join(" · "),
    cells: {
      package: p.packageId,
      class: cls ?? NOT_RECORDED,
      issued: p.dateIssued ?? NOT_RECORDED,
      congress: congress ? String(congress) : NOT_RECORDED,
      ...(c === "CHRG" ? { held: s ? (s.heldDates[0] ?? "Not stated") : NOT_RECORDED } : {}),
      ...(c === "GAOREPORTS" ? { unit: s?.author ?? NOT_RECORDED } : {}),
    },
    facts: facts as unknown as Json,
    badges: cls ? [cls] : [],
    links,
    text: [p.packageId, s?.committees.map((x) => x.name).join(" "), s?.author, s?.suDocClassNumber].filter(Boolean).join(" "),
    filters: {
      class: p.docClass ? [p.docClass.toLowerCase()] : [],
      congress: congress ? [String(congress)] : [],
      year: /^\d{4}$/.test(year) ? [year] : [],
      committee: (s?.committees ?? []).map((x) => x.authorityId).filter((x): x is string => Boolean(x)),
      summary: [s ? "yes" : "no"],
      ...(jacket ? { jacket: [jacket] } : {}),
    },
    extra: { kind: c.toLowerCase(), package: p as unknown as JsonObject, summary: s as unknown as JsonObject, provenance: prov as unknown as JsonObject },
  });
}

/* ------------------------------------------------------------------ bill text versions */

export const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;
const TYPE_LABEL: Record<string, string> = {
  hr: "H.R.",
  s: "S.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hconres: "H.Con.Res.",
  sconres: "S.Con.Res.",
  hres: "H.Res.",
  sres: "S.Res.",
};
/** GPO bill version codes (GovInfo help, "Bill versions"); a code not listed shows as "Version <CODE>". */
export const VERSION_LABEL: Record<string, string> = {
  ih: "Introduced in House",
  is: "Introduced in Senate",
  rh: "Reported in House",
  rs: "Reported in Senate",
  eh: "Engrossed in House",
  es: "Engrossed in Senate",
  enr: "Enrolled Bill",
  renr: "Re-enrolled Bill",
  rfh: "Referred in House",
  rfs: "Referred in Senate",
  rdh: "Received in House",
  rds: "Received in Senate",
  pch: "Placed on Calendar House",
  pcs: "Placed on Calendar Senate",
  ath: "Agreed to House",
  ats: "Agreed to Senate",
  eah: "Engrossed Amendment House",
  eas: "Engrossed Amendment Senate",
  cph: "Considered and Passed House",
  cps: "Considered and Passed Senate",
  rch: "Reference Change House",
  rcs: "Reference Change Senate",
  rah: "Referred with Amendments House",
  ras: "Referred with Amendments Senate",
  lth: "Laid on Table in House",
  lts: "Laid on Table in Senate",
  iph: "Indefinitely Postponed in House",
  ips: "Indefinitely Postponed in Senate",
  fph: "Failed Passage House",
  fps: "Failed Passage Senate",
  hdh: "Held at Desk House",
  hds: "Held at Desk Senate",
  pp: "Public Print",
  pap: "Printed as Passed",
  sc: "Sponsor Change",
};

export type BillVersion = { code: string; date: string | null; packageId: string; title: string | null; lastModified: string | null };
export type ParsedBill = { congress: number; type: string; number: number; code: string };

export function parseBillPackage(id: string): ParsedBill | null {
  const m = /^BILLS-(\d{2,3})(hr|s|hjres|sjres|hconres|sconres|hres|sres)(\d{1,5})([a-z]{1,5})$/.exec(id);
  return m ? { congress: Number(m[1]), type: m[2]!, number: Number(m[3]), code: m[4]! } : null;
}
export const billKey = (b: Pick<ParsedBill, "congress" | "type" | "number">) => `${b.congress}-${b.type}-${b.number}`;

/** Versions in reading order: issue date, then package id. */
export function sortVersions(vs: BillVersion[]): BillVersion[] {
  return [...vs].sort((a, b) => ((a.date ?? "") !== (b.date ?? "") ? ((a.date ?? "") < (b.date ?? "") ? -1 : 1) : a.packageId < b.packageId ? -1 : a.packageId > b.packageId ? 1 : 0));
}

export function billVersionsRow(
  b: Pick<ParsedBill, "congress" | "type" | "number">,
  versions: BillVersion[],
  billHeld: boolean,
  prov: { listing_urls: string[]; retrieved_at: string },
): CorpusRow {
  const vs = sortVersions(versions);
  const id = billKey(b);
  const cite = `${TYPE_LABEL[b.type] ?? b.type} ${b.number}`;
  const latest = vs[vs.length - 1]!;
  const titleText = vs.map((v) => v.title).filter(Boolean).pop() ?? null;
  const label = (code: string) => VERSION_LABEL[code] ?? `Version ${code.toUpperCase()}`;
  const links: Json[] = [];
  if (billHeld) links.push({ url: `/law/legislation/federal/${b.congress}/${b.type}/${b.number}`, label: `Bill in this atlas: ${cite}` });
  links.push({ url: detailsUrl(latest.packageId), label: `Latest text on GovInfo (${label(latest.code)})` });
  return corpusRecord(GI_DATASETS.BILLS, id, `${cite}, ${ordinal(b.congress)} Congress${titleText ? `: ${titleText}` : ""}`, {
    source_url: detailsUrl(latest.packageId),
    subtitle: `${vs.length} text version${vs.length === 1 ? "" : "s"} · latest ${label(latest.code)}${latest.date ? ` (${latest.date})` : ""}`,
    cells: {
      bill: cite,
      congress: String(b.congress),
      versions: String(vs.length),
      latest: label(latest.code),
      latest_date: latest.date ?? NOT_RECORDED,
    },
    facts: [
      ["Bill", `${cite}, ${ordinal(b.congress)} Congress`],
      ["Text versions on GovInfo", vs.map((v) => `${label(v.code)} (${v.code})${v.date ? `, ${v.date}` : ""}`).join("; ")],
      ["Bill record in this atlas", billHeld ? `Yes (${id})` : "No (outside the 108th-119th Congress set or not held)"],
      ["Source", `GovInfo API, collection BILLS (${GI_DOCS})`],
    ] as unknown as Json,
    badges: [label(latest.code)],
    links,
    text: [cite, titleText, vs.map((v) => v.code).join(" ")].filter(Boolean).join(" "),
    filters: {
      congress: [String(b.congress)],
      type: [b.type],
      version: [...new Set(vs.map((v) => v.code))],
      enrolled: [vs.some((v) => v.code === "enr") ? "yes" : "no"],
      held_bill: [billHeld ? "yes" : "no"],
    },
    extra: {
      kind: "bill_versions",
      bill: { congress: b.congress, type: b.type, number: b.number },
      versions: vs.map((v) => ({
        ...v,
        label: label(v.code),
        details: detailsUrl(v.packageId),
        pdf: contentUrl(v.packageId, "pdf"),
        html: contentUrl(v.packageId, "html"),
        xml: contentUrl(v.packageId, "xml"),
      })) as unknown as Json,
      provenance: prov as unknown as JsonObject,
    },
  });
}

/* ------------------------------------------------------------------ scheduled runs */

const KEY = "X-Api-Key";
async function gi(ctx: CollectContext, url: string): Promise<{ body: JsonObject; url: string; at: string; status: number }> {
  const res = await ctx.http.getText(url, { headers: { [KEY]: ctx.env("DATA_GOV_API_KEY") ?? "" } });
  if (res.status === 404) return { body: {}, url: res.record.url, at: res.record.retrieved_at, status: 404 };
  if (res.status !== 200) throw new Error(`GovInfo HTTP ${res.status}`);
  return { body: JSON.parse(res.text) as JsonObject, url: res.record.url, at: res.record.retrieved_at, status: 200 };
}

type GiCursor = { since?: string };
const isoBack = (iso: string, ms: number) => new Date(Date.parse(iso) - ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function readListing(ctx: CollectContext, c: Collection, since: string, pages: number) {
  const out: { p: Listed; url: string; at: string }[] = [];
  let mark = "*";
  let complete = true;
  for (let i = 0; i < pages; i++) {
    const r = await gi(ctx, collectionUrl(c, since, mark));
    for (const raw of arr(r.body["packages"])) {
      const p = normalizeListed(raw);
      if (p) out.push({ p, url: r.url, at: r.at });
    }
    const next = str(r.body["nextPage"]);
    if (!next) return { out, complete };
    const m = /offsetMark=([^&]+)/.exec(next);
    mark = m ? decodeURIComponent(m[1]!) : "";
    if (!mark) return { out, complete };
    if (i === pages - 1) complete = false;
  }
  return { out, complete };
}

/** Hearings, committee prints, GAO reports: packages modified since the cursor (a day of overlap); summaries for them. */
function packageAdapter(c: Exclude<Collection, "BILLS">, schedulePages: number, summaries: number): SourceAdapter {
  const dataset = GI_DATASETS[c];
  return {
    source: dataset,
    dataset,
    mode: "upsert",
    ordinalPolicy: "prepend",
    functionName: "ingest-govinfo",
    limits: { maxRequests: schedulePages + summaries, minIntervalMs: 500 },
    secrets: ["DATA_GOV_API_KEY"],
    async collect(ctx: CollectContext): Promise<Collected> {
      const cur = (ctx.cursor ?? {}) as GiCursor;
      const since = isoBack(cur.since ?? isoBack(ctx.now.toISOString(), 3 * 86400_000), 86400_000);
      const held: HeldRecord[] = [];
      try {
        const { out, complete: listed } = await readListing(ctx, c, since, schedulePages);
        let complete = listed;
        const stored = new Map<string, StoredRow>();
        for (const r of await ctx.corpus.rowsBy(dataset, "id", out.map((x) => x.p.packageId), "id,item")) stored.set(r.id, r);
        const rows: CorpusRow[] = [];
        const committees = new Set<string>();
        const sums = new Map<string, { s: Summary | null; url: string; at: string }>();
        let n = 0;
        for (const x of out) {
          if (n >= summaries || ctx.http.remaining < 1) {
            complete = false;
            break;
          }
          const r = await gi(ctx, summaryUrl(x.p.packageId));
          n++;
          sums.set(x.p.packageId, { s: normalizeSummary(r.body), url: r.url, at: r.at });
        }
        const codes = [...sums.values()].flatMap((v) => (v.s?.committees ?? []).map((cm) => cm.authorityId).filter((z): z is string => Boolean(z)));
        if (codes.length) for (const r of await ctx.corpus.rowsBy("congress_committees", "id", codes, "id")) committees.add(r.id);
        for (const x of out) {
          const sm = sums.get(x.p.packageId);
          // a package whose summary was not read this run keeps the summary its stored row has
          const keep = !sm ? (stored.get(x.p.packageId)?.item["summary"] as unknown as Summary | null | undefined) ?? null : sm.s;
          const keepProv = stored.get(x.p.packageId)?.item["provenance"] as JsonObject | undefined;
          rows.push(
            packageRow(c, x.p, keep, committees, {
              listing_url: x.url,
              retrieved_at: x.at,
              summary_url: sm ? sm.url : ((keepProv?.["summary_url"] as string | undefined) ?? null),
              summary_retrieved_at: sm ? sm.at : ((keepProv?.["summary_retrieved_at"] as string | undefined) ?? null),
            }),
          );
        }
        rows.sort((a, b) => (String(a.filters["year"] ?? "") < String(b.filters["year"] ?? "") ? 1 : -1));
        const newest = out.reduce((m, x) => (x.p.lastModified && x.p.lastModified > m ? x.p.lastModified : m), since);
        return { rows, fetched: out.length, held, cursorAfter: complete ? { since: newest } : ctx.cursor, complete, notes: { since, listed: out.length, summaries: n } };
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited)
          return { rows: [], fetched: 0, held, cursorAfter: ctx.cursor, complete: false, notes: { since, stopped: error.message } };
        throw error;
      }
    },
    comparable: (cc: RowContent) => {
      const item = { ...(cc.item as JsonObject) };
      delete item["provenance"];
      const p = { ...((item["package"] ?? {}) as JsonObject) };
      delete p["lastModified"];
      item["package"] = p;
      return { ...(cc as unknown as JsonObject), item, detail: maskLastModified(cc.detail) } as Json;
    },
  };
}

function maskLastModified(detail: JsonObject): JsonObject {
  const facts = Array.isArray(detail["facts"])
    ? (detail["facts"] as Json[]).filter((f) => !(Array.isArray(f) && f[0] === "Last modified on GovInfo"))
    : detail["facts"];
  return { ...detail, facts: facts ?? null };
}

/** Bill text versions: new or changed BILLS packages since the cursor are merged into their bill's row. */
export const govinfoBillVersions: SourceAdapter = {
  source: GI_DATASETS.BILLS,
  dataset: GI_DATASETS.BILLS,
  mode: "upsert",
  ordinalPolicy: "prepend",
  functionName: "ingest-govinfo",
  limits: { maxRequests: 6, minIntervalMs: 500 },
  secrets: ["DATA_GOV_API_KEY"],
  async collect(ctx: CollectContext): Promise<Collected> {
    const cur = (ctx.cursor ?? {}) as GiCursor;
    const since = isoBack(cur.since ?? isoBack(ctx.now.toISOString(), 3 * 86400_000), 86400_000);
    const held: HeldRecord[] = [];
    try {
      const { out, complete } = await readListing(ctx, "BILLS", since, 6);
      const byBill = new Map<string, { b: ParsedBill; vs: BillVersion[] }>();
      for (const x of out) {
        const b = parseBillPackage(x.p.packageId);
        if (!b) {
          held.push({ key: x.p.packageId, reason: "package id is not a bill version id" });
          continue;
        }
        const k = billKey(b);
        const g = byBill.get(k) ?? { b, vs: [] };
        g.vs.push({ code: b.code, date: x.p.dateIssued, packageId: x.p.packageId, title: x.p.title, lastModified: x.p.lastModified });
        byBill.set(k, g);
      }
      const keys = [...byBill.keys()];
      const stored = new Map<string, StoredRow>();
      for (const r of await ctx.corpus.rowsBy(GI_DATASETS.BILLS, "id", keys, "id,item")) stored.set(r.id, r);
      const heldBills = new Set((await ctx.corpus.rowsBy("congress_bills", "id", keys, "id")).map((r) => r.id));
      const at = out[0]?.at ?? ctx.now.toISOString();
      const rows: CorpusRow[] = [];
      for (const [k, g] of byBill) {
        const old = (stored.get(k)?.item["versions"] as unknown as (BillVersion & JsonObject)[] | undefined) ?? [];
        const merged = new Map<string, BillVersion>();
        for (const v of old) merged.set(v.packageId, { code: v.code, date: v.date, packageId: v.packageId, title: v.title, lastModified: v.lastModified });
        for (const v of g.vs) merged.set(v.packageId, v);
        rows.push(billVersionsRow(g.b, [...merged.values()], heldBills.has(k), { listing_urls: [...new Set(out.map((x) => x.url))].slice(0, 6), retrieved_at: at }));
      }
      const newest = out.reduce((m, x) => (x.p.lastModified && x.p.lastModified > m ? x.p.lastModified : m), since);
      return { rows, fetched: out.length, held, cursorAfter: complete ? { since: newest } : ctx.cursor, complete, notes: { since, packages: out.length, bills: rows.length } };
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited)
        return { rows: [], fetched: 0, held, cursorAfter: ctx.cursor, complete: false, notes: { since, stopped: error.message } };
      throw error;
    }
  },
  comparable: (cc: RowContent) => {
    const item = { ...(cc.item as JsonObject) };
    delete item["provenance"];
    item["versions"] = ((item["versions"] ?? []) as JsonObject[]).map((v) => {
      const o = { ...v };
      delete o["lastModified"];
      return o;
    }) as unknown as Json;
    return { ...(cc as unknown as JsonObject), item } as Json;
  },
};

export const govinfoHearings = packageAdapter("CHRG", 3, 60);
export const govinfoCommitteePrints = packageAdapter("CPRT", 2, 30);
export const govinfoGaoReports = packageAdapter("GAOREPORTS", 2, 30);
