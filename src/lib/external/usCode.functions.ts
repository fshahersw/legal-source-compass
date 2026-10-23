/**
 * The United States Code from the Office of the Law Revision Counsel (datasets us_code_titles, us_code_sections,
 * us_code_release_points) and the enacted laws linked to its sections (public_laws_enacted,
 * us_code_amendment_links), built by scripts/enrichment/uscode/. Read-only; malformed values are dropped, never
 * repaired. A section's printed lines are stored once in the record's text column (encoding mirrored from
 * scripts/enrichment/uscode/bodytext.py, see decodeBody).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export type UscTitle = {
  key: string;
  number: string;
  label: string;
  name: string;
  appendix: boolean;
  positiveLaw: boolean;
  units: number;
  byStatus: Record<string, number>;
  release: string | null;
  lawDate: string | null;
  changedInRelease: boolean;
  officialUrl: string | null;
};
export type OutlineNode = {
  index: number;
  parent: number | null;
  depth: number;
  kind: string;
  num: string | null;
  heading: string | null;
  status: string | null;
  total: number;
  direct: number;
};
export type UscTitleDetail = UscTitle & {
  outline: OutlineNode[];
  govinfoYears: number[];
  zip: { url: string; sha256: string | null; bytes: number | null } | null;
};
export type UnitHead = {
  id: string;
  key: string;
  citation: string;
  heading: string;
  status: string | null;
};
export type BodyLine =
  | { indent: number; kind: "p" | "h"; text: string }
  | { indent: number; kind: "tr" | "th"; cells: string[] };
export type UscNote = {
  group: string | null;
  topic: string | null;
  heading: string;
  lines: BodyLine[];
  footnotes: [string, string][];
};
export type PathStep = { index: number; kind: string; num: string | null; heading: string | null };
export type UscSection = {
  id: string;
  title: string;
  key: string;
  kind: "section" | "courtRule" | "reorganizationPlan";
  citation: string;
  num: string | null;
  heading: string;
  status: string | null;
  path: PathStep[];
  lines: BodyLine[];
  footnotes: [string, string][];
  credit: string | null;
  notes: UscNote[];
  url: string;
  urlKind: "section" | "title";
  prev: { key: string; citation: string } | null;
  next: { key: string; citation: string } | null;
  govinfoYears: number[];
  govinfoYearsBasis: "section" | "title";
  release: string;
  lawDate: string | null;
};
export type LinkKind =
  | "source_credit"
  | "amendment_note"
  | "status_note"
  | "law_margin"
  | "law_margin_note"
  | "law_text";
export type SectionLaw = {
  lawId: string;
  label: string;
  title: string | null;
  enacted: string | null;
  statutes: string | null;
  kinds: LinkKind[];
  evidence: [LinkKind, string][];
  govinfo: { label: string; url: string }[];
};
export type SectionLaws = { laws: SectionLaw[]; total: number | null; dropped: number };
export type ReleasePoint = {
  id: string;
  lawDate: string | null;
  lawDateText: string | null;
  titles: string[];
  current: boolean;
  held: boolean;
  changes: {
    from: string;
    added: number;
    changed: number;
    repealed: number;
    removed: number;
  } | null;
  url: string | null;
};
export type TitleHits = { hits: UnitHead[]; total: number | null };

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

/** Title keys: 1-54, appendices with a trailing "a" ("5a"). */
export const TITLE_KEY = /^(?:[1-9]|[1-4][0-9]|5[0-4])a?$/;
/** Unit keys as the builder derives them from OLRC identifiers ("1983", "2000e-2", "courtRules_Civil_rule4"). */
export const UNIT_KEY = /^[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}$/;
export const LAW_ID =
  /^(?:stat-\d{1,3}-(?:\d{1,5}(?:-\d{1,3})?|doc\d{1,6}(?:-\d{1,3})?)|pl-\d{1,3}-\d{1,4}(?:-\d{1,3})?)$/;
const STATUSES = [
  "repealed",
  "omitted",
  "transferred",
  "renumbered",
  "reserved",
  "vacant",
  "unknown",
];
const KINDS: LinkKind[] = [
  "source_credit",
  "amendment_note",
  "status_note",
  "law_margin",
  "law_margin_note",
  "law_text",
];
const OFFICIAL_HOSTS = new Set(["uscode.house.gov", "www.govinfo.gov", "govinfo.gov"]);

export const unitId = (title: string, key: string) => `${title}:${key}`;

/** Only official publisher addresses (uscode.house.gov, GovInfo) are linked. */
export function officialLink(v: unknown): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !OFFICIAL_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const statusOf = (v: unknown) => (typeof v === "string" && STATUSES.includes(v) ? v : null);

/** OLRC prints chapter and court-rule headings in capitals; title-case them for display (roman numerals kept). */
const SMALL = new Set(
  "a an and as at but by for from in into nor of on or per the to under upon via with within without".split(
    " ",
  ),
);
const ROMAN = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/;
export function smartTitle(text: string): string {
  if (!text || /[a-z]/.test(text)) return text;
  let first = true;
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => {
    const isFirst = first;
    first = false;
    if (ROMAN.test(w) && (w !== "I" || !isFirst)) return w;
    if (SMALL.has(w.toLowerCase()) && !isFirst) return w.toLowerCase();
    return w[0]!.toUpperCase() + w.slice(1).toLowerCase();
  });
}

/**
 * OLRC marks some levels (most subparts) `class="small-caps"` and stores their text in lower case ("subpart i—" /
 * "general"); its own pages print them in small capitals. Those are the only levels whose printed number starts with a
 * lower-case letter, so that is the test.
 */
export function containerSmallCaps(num: string | null): boolean {
  return /^\[?[a-z]/.test((num ?? "").trim());
}

/**
 * "CHAPTER 21—" + "CIVIL RIGHTS" -> "CHAPTER 21—CIVIL RIGHTS": the designation and heading exactly as OLRC prints
 * them (capitals stay capitals; nothing is re-cased). A level with neither is "Not recorded".
 */
export function containerLabel(num: string | null, heading: string | null): string {
  const n = (num ?? "").trim();
  const h = (heading ?? "").trim();
  if (!n) return h || "Not recorded";
  return /[—–-]$/.test(n) ? `${n}${h}` : `${n} ${h}`.trim();
}

/** Decode a section's stored lines (see scripts/enrichment/uscode/bodytext.py). */
export function decodeBody(text: unknown): BodyLine[] {
  if (typeof text !== "string" || !text) return [];
  const out: BodyLine[] = [];
  for (const raw of text.split("\n")) {
    let indent = 0;
    while (raw[indent] === "\t") indent++;
    const body = raw.slice(indent);
    const lead = body[0];
    if (lead === "\x1d" || lead === "\x1c")
      out.push({ indent, kind: lead === "\x1c" ? "th" : "tr", cells: body.slice(1).split("\x1f") });
    else if (lead === "\x1e") out.push({ indent, kind: "h", text: body.slice(1) });
    else if (body) out.push({ indent, kind: "p", text: body });
  }
  return out;
}

/** Lines as stored in notes: [indent, text] | [indent, text, "h"] | [indent, cells, "tr" | "th"]. */
export function parseLines(v: unknown): BodyLine[] {
  if (!Array.isArray(v)) return [];
  const out: BodyLine[] = [];
  for (const l of v) {
    if (!Array.isArray(l)) continue;
    const indent = int(l[0]) ?? 0;
    const kind = l[2];
    if ((kind === "tr" || kind === "th") && Array.isArray(l[1]))
      out.push({ indent, kind, cells: l[1].map((c) => (typeof c === "string" ? c : "")) });
    else if (typeof l[1] === "string" && l[1])
      out.push({ indent, kind: kind === "h" ? "h" : "p", text: l[1] });
  }
  return out;
}

const footnotes = (v: unknown): [string, string][] =>
  Array.isArray(v)
    ? v
        .filter(
          (f): f is [string, string] =>
            Array.isArray(f) && typeof f[0] === "string" && typeof f[1] === "string",
        )
        .map((f) => [f[0], f[1]])
    : [];
const years = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((y): y is number => Number.isInteger(y) && y >= 1994 && y <= 2100)
    : [];

export function parseTitleSummary(id: unknown, raw: unknown): UscTitle | null {
  const t = obj(raw);
  const key = str(id, 4);
  const name = str(t?.["name"], 300);
  if (!t || !key || !TITLE_KEY.test(key) || t["key"] !== key || !name) return null;
  const byStatus: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(t["by_status"]) ?? {})) {
    const c = int(n);
    if (c !== null && (k === "none" || STATUSES.includes(k))) byStatus[k] = c;
  }
  return {
    key,
    number: str(t["number"], 3) ?? key.replace(/a$/, ""),
    label: str(t["label"], 40) ?? `Title ${key}`,
    name,
    appendix: t["appendix"] === true,
    positiveLaw: t["positive_law"] === true,
    units: int(t["units"]) ?? 0,
    byStatus,
    release: str(t["release"], 20),
    lawDate: str(t["law_date"], 10),
    changedInRelease: t["changed_in_release"] === true,
    officialUrl: officialLink(t["official_url"]),
  };
}

export function parseOutline(v: unknown): OutlineNode[] {
  if (!Array.isArray(v)) return [];
  const out: OutlineNode[] = [];
  for (const n of v) {
    if (!Array.isArray(n)) continue;
    const index = int(n[0]);
    const kind = str(n[3], 30);
    if (index === null || !kind) continue;
    out.push({
      index,
      parent: n[1] === null ? null : int(n[1]),
      depth: int(n[2]) ?? 0,
      kind,
      num: str(n[4], 200),
      heading: str(n[5], 600),
      status: statusOf(n[6]),
      total: int(n[7]) ?? 0,
      direct: int(n[8]) ?? 0,
    });
  }
  return out;
}

export function parseTitleDetail(id: unknown, raw: unknown): UscTitleDetail | null {
  const base = parseTitleSummary(id, raw);
  const t = obj(raw);
  if (!base || !t) return null;
  const zip = obj(t["zip"]);
  const zipUrl = officialLink(zip?.["url"]);
  return {
    ...base,
    outline: parseOutline(t["outline"]),
    govinfoYears: years(t["govinfo_years"]),
    zip: zipUrl
      ? { url: zipUrl, sha256: str(zip?.["sha256"], 64), bytes: int(zip?.["bytes"]) }
      : null,
  };
}

export function parseUnitHead(
  id: unknown,
  cells: unknown,
  status: unknown,
  title: string,
): UnitHead | null {
  const rid = str(id, 200);
  const c = obj(cells);
  const citation = str(c?.["citation"], 300);
  if (!rid || !c || !citation || !rid.startsWith(`${title}:`)) return null;
  const key = rid.slice(title.length + 1);
  if (!UNIT_KEY.test(key)) return null;
  const st = Array.isArray(status) ? statusOf(status[0]) : statusOf(status);
  return { id: rid, key, citation, heading: str(c["heading"], 600) ?? "", status: st };
}

const neighbour = (v: unknown) =>
  Array.isArray(v) && typeof v[0] === "string" && UNIT_KEY.test(v[0]) && typeof v[1] === "string"
    ? { key: v[0], citation: v[1] }
    : null;

export function parseSection(row: unknown): UscSection | null {
  const r = obj(row);
  const u = obj(r?.["u"]);
  const id = str(r?.["id"], 200);
  const title = str(u?.["title"], 4);
  const key = str(u?.["key"], 120);
  const citation = str(u?.["citation"], 300);
  const kind = u?.["kind"];
  const url = officialLink(u?.["url"]) ?? officialLink(r?.["source_url"]);
  if (!r || !u || !id || !title || !TITLE_KEY.test(title) || !key || !UNIT_KEY.test(key))
    return null;
  if (id !== unitId(title, key) || !citation || !url) return null;
  if (kind !== "section" && kind !== "courtRule" && kind !== "reorganizationPlan") return null;
  const notes: UscNote[] = Array.isArray(u["notes"])
    ? u["notes"]
        .map((n) => obj(n))
        .filter((n): n is Record<string, unknown> => !!n)
        .map((n) => ({
          group: str(n["g"], 200),
          topic: str(n["t"], 60),
          heading: str(n["h"], 600) ?? "",
          lines: parseLines(n["l"]),
          footnotes: footnotes(n["f"]),
        }))
    : [];
  const path: PathStep[] = Array.isArray(u["path"])
    ? u["path"]
        .filter(
          (p): p is unknown[] =>
            Array.isArray(p) && int(p[0]) !== null && p[0] !== 0 && typeof p[1] === "string",
        )
        .map((p) => ({
          index: p[0] as number,
          kind: p[1] as string,
          num: str(p[2], 200),
          heading: str(p[3], 600),
        }))
    : [];
  const ownYears = years(u["govinfo_years"]);
  return {
    id,
    title,
    key,
    kind,
    citation,
    num: str(u["num"], 100),
    heading: str(u["heading"], 2000) ?? "",
    status: statusOf(u["status"]),
    path,
    lines: decodeBody(r["text"]),
    footnotes: footnotes(u["footnotes"]),
    credit: str(u["credit"], 20000),
    notes,
    url,
    urlKind: u["url_kind"] === "section" ? "section" : "title",
    prev: neighbour(u["prev"]),
    next: neighbour(u["next"]),
    govinfoYears: ownYears,
    govinfoYearsBasis: u["govinfo_basis"] === "section" ? "section" : "title",
    release: str(u["release"], 20) ?? "",
    lawDate: str(u["law_date"], 10),
  };
}

export function parseLink(
  row: unknown,
  sectionId: string,
): { lawId: string; kinds: LinkKind[]; evidence: [LinkKind, string][] } | null {
  const l = obj(obj(row)?.["l"]);
  const lawId = str(l?.["law"], 40);
  if (!l || l["section"] !== sectionId || !lawId || !LAW_ID.test(lawId)) return null;
  const kinds = Array.isArray(l["kinds"])
    ? l["kinds"].filter((k): k is LinkKind => KINDS.includes(k as LinkKind))
    : [];
  if (!kinds.length) return null;
  const evidence = Array.isArray(l["evidence"])
    ? l["evidence"]
        .filter(
          (e): e is [LinkKind, string] =>
            Array.isArray(e) && KINDS.includes(e[0]) && typeof e[1] === "string",
        )
        .map((e) => [e[0], e[1].slice(0, 300)] as [LinkKind, string])
    : [];
  return { lawId, kinds, evidence };
}

export function parseLaw(row: unknown): Omit<SectionLaw, "kinds" | "evidence"> | null {
  const r = obj(row);
  const id = str(r?.["id"], 40);
  const law = obj(r?.["l"]);
  const label = str(law?.["label"], 120);
  if (!r || !id || !LAW_ID.test(id) || !law || !label) return null;
  const stat = obj(law["stat"]);
  const vol = int(stat?.["volume"]);
  const page = int(stat?.["page"]);
  const govinfo = Array.isArray(law["govinfo"])
    ? law["govinfo"]
        .map((g) => obj(g))
        .map((g) => ({ label: str(g?.["label"], 120), url: officialLink(g?.["url"]) }))
        .filter((g): g is { label: string; url: string } => !!g.label && !!g.url)
    : [];
  return {
    lawId: id,
    label,
    title: str(law["title"], 1000),
    enacted: str(law["enacted"], 10),
    statutes: vol !== null && page !== null ? `${vol} Stat. ${page}` : null,
    govinfo,
  };
}

export function parseReleasePoint(
  id: unknown,
  raw: unknown,
  sourceUrl: unknown,
): ReleasePoint | null {
  const p = obj(raw);
  const rid = str(id, 30);
  if (!p || !rid || !/^\d{2,3}-\d{1,4}(?:not\d{1,4})*$/.test(rid) || p["id"] !== rid) return null;
  const ch = obj(p["changes"]);
  const changes =
    ch && typeof ch["from"] === "string"
      ? {
          from: ch["from"] as string,
          added: int(ch["added"]) ?? 0,
          changed: int(ch["changed"]) ?? 0,
          repealed: int(ch["repealed"]) ?? 0,
          removed: int(ch["removed"]) ?? 0,
        }
      : null;
  return {
    id: rid,
    lawDate: str(p["law_date"], 10),
    lawDateText: str(p["law_date_text"], 40),
    titles: Array.isArray(p["titles_affected"])
      ? p["titles_affected"].filter(
          (t): t is string => typeof t === "string" && /^\d{1,2}[A-Za-z]?$/.test(t),
        )
      : [],
    current: p["current"] === true,
    held: p["held"] === true,
    changes,
    url: officialLink(sourceUrl),
  };
}

/** "42 U.S.C. 1983", "42 USC § 2000e-2", "26 usc 1" -> {title, key}; null when it is not a citation. */
export function parseCitationQuery(q: string): { title: string; key: string } | null {
  const m = q
    .trim()
    .replace(/–|—/g, "-")
    .match(
      /^(\d{1,2})\s*(?:U\.?\s*S\.?\s*C\.?(?:\s*A\.?)?|USC)\s*(?:§+\s*)?([0-9][0-9A-Za-z.-]*)$/i,
    );
  if (!m) return null;
  const title = String(Number(m[1]));
  const key = m[2]!.replace(/\.$/, "");
  return TITLE_KEY.test(title) && UNIT_KEY.test(key) ? { title, key } : null;
}

/** A bare section number typed inside a title's search box ("1983", "§ 2000e–2"). */
export function sectionNumberQuery(q: string): string | null {
  const m = q
    .trim()
    .replace(/–/g, "-")
    .match(/^(?:§+\s*)?([0-9][0-9A-Za-z.-]{0,30})$/);
  return m && UNIT_KEY.test(m[1]!) ? m[1]! : null;
}

/** Prefix terms for the simple full-text configuration: letters and digits only, at most 8 terms. */
export function ftsTerms(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.slice(0, 8).map((w) => w.slice(0, 40));
  return terms.length ? terms.map((t) => `${t}:*`).join("&") : null;
}

export function titleSearchPath(title: string, q: string): string | null {
  const fts = ftsTerms(q);
  if (!fts) return null;
  return `corpus_records?${[
    "select=id,cells:item->cells,st:filters->status",
    "dataset=eq.us_code_sections",
    `filters=cs.${cs({ title: [title] })}`,
    `search_vector=fts(simple).${enc(fts)}`,
    "order=ordinal.asc",
  ].join("&")}`;
}

const SUMMARY_SELECT = "id,t:detail->usc_title";
/** Summary fields of a title record, read without its (large) outline. */
const SUMMARY_FIELDS = [
  "key",
  "number",
  "label",
  "name",
  "appendix",
  "positive_law",
  "units",
  "by_status",
  "release",
  "law_date",
  "changed_in_release",
  "official_url",
];

export function titleListPath(): string {
  const fields = SUMMARY_FIELDS.map((f) => `${f}:detail->usc_title->${f}`).join(",");
  return `corpus_records?select=id,${fields}&dataset=eq.us_code_titles&order=ordinal.asc&limit=80`;
}

export const listUsCodeTitles = createServerFn({ method: "GET" }).handler(
  async (): Promise<UscTitle[]> => {
    const rows = await restGet<Record<string, unknown>[]>(titleListPath());
    return rows.rows
      .map((row) => parseTitleSummary(row["id"], row))
      .filter((t): t is UscTitle => !!t);
  },
);

const titleInput = z.object({ title: z.string().regex(TITLE_KEY) });

export const getUsCodeTitle = createServerFn({ method: "GET" })
  .inputValidator((d) => titleInput.parse(d))
  .handler(async ({ data }): Promise<UscTitleDetail | null> => {
    const r = await restGet<{ id: unknown; t: unknown }[]>(
      `corpus_records?select=${SUMMARY_SELECT}&dataset=eq.us_code_titles&id=eq.${enc(data.title)}&limit=1`,
    );
    return r.rows.length === 1 ? parseTitleDetail(r.rows[0]!.id, r.rows[0]!.t) : null;
  });

export const getUsCodeContainerUnits = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        title: z.string().regex(TITLE_KEY),
        container: z.number().int().min(0).max(100_000),
      })
      .parse(d),
  )
  .handler(
    async ({ data }): Promise<{ units: UnitHead[]; total: number | null; dropped: number }> => {
      const r = await restGet<{ id: unknown; cells: unknown; st: unknown }[]>(
        `corpus_records?select=id,cells:item->cells,st:filters->status&dataset=eq.us_code_sections&filters=cs.${cs(
          {
            parent: [`${data.title}:${data.container}`],
          },
        )}&order=ordinal.asc`,
        { count: true, range: [0, 1999] },
      );
      const units = r.rows
        .map((row) => parseUnitHead(row.id, row.cells, row.st, data.title))
        .filter((u): u is UnitHead => !!u);
      return { units, total: r.total, dropped: r.rows.length - units.length };
    },
  );

const unitInput = z.object({ title: z.string().regex(TITLE_KEY), key: z.string().regex(UNIT_KEY) });

export const getUsCodeSection = createServerFn({ method: "GET" })
  .inputValidator((d) => unitInput.parse(d))
  .handler(async ({ data }): Promise<UscSection | null> => {
    const r = await restGet<unknown[]>(
      `corpus_records?select=id,text,source_url,u:detail->usc&dataset=eq.us_code_sections&id=eq.${enc(
        unitId(data.title, data.key),
      )}&limit=1`,
    );
    return r.rows.length === 1 ? parseSection(r.rows[0]) : null;
  });

export const getUsCodeSectionLaws = createServerFn({ method: "GET" })
  .inputValidator((d) => unitInput.parse(d))
  .handler(async ({ data }): Promise<SectionLaws> => {
    const sid = unitId(data.title, data.key);
    const links = await restGet<unknown[]>(
      `corpus_records?select=l:detail->link&dataset=eq.us_code_amendment_links&filters=cs.${cs({ section: [sid] })}&order=ordinal.asc`,
      { count: true, range: [0, 399] },
    );
    const parsed = links.rows
      .map((row) => parseLink(row, sid))
      .filter((l): l is NonNullable<typeof l> => !!l);
    if (!parsed.length) return { laws: [], total: links.total, dropped: links.rows.length };
    const byId = new Map(parsed.map((l) => [l.lawId, l]));
    const laws: SectionLaw[] = [];
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await restGet<unknown[]>(
        `corpus_records?select=id,l:detail->law&dataset=eq.public_laws_enacted&id=in.(${chunk
          .map((id) => enc(`"${id}"`))
          .join(",")})`,
      );
      for (const row of r.rows) {
        const law = parseLaw(row);
        const link = law ? byId.get(law.lawId) : undefined;
        if (law && link) laws.push({ ...law, kinds: link.kinds, evidence: link.evidence });
      }
    }
    laws.sort(
      (a, b) => (b.enacted ?? "").localeCompare(a.enacted ?? "") || a.label.localeCompare(b.label),
    );
    return { laws, total: links.total, dropped: links.rows.length - laws.length };
  });

export const searchUsCodeTitle = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        title: z.string().regex(TITLE_KEY),
        q: z.string().min(1).max(200),
        offset: z.number().int().min(0).max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<TitleHits> => {
    const exact = sectionNumberQuery(data.q);
    const hits: UnitHead[] = [];
    if (exact && data.offset === 0) {
      const r = await restGet<{ id: unknown; cells: unknown; st: unknown }[]>(
        `corpus_records?select=id,cells:item->cells,st:filters->status&dataset=eq.us_code_sections&id=eq.${enc(
          unitId(data.title, exact),
        )}&limit=1`,
      );
      for (const row of r.rows) {
        const u = parseUnitHead(row.id, row.cells, row.st, data.title);
        if (u) hits.push(u);
      }
    }
    const path = titleSearchPath(data.title, data.q);
    if (!path) return { hits, total: hits.length };
    const r = await restGet<{ id: unknown; cells: unknown; st: unknown }[]>(path, {
      count: true,
      range: [data.offset, data.offset + 29],
    });
    for (const row of r.rows) {
      const u = parseUnitHead(row.id, row.cells, row.st, data.title);
      if (u && !hits.some((h) => h.id === u.id)) hits.push(u);
    }
    return { hits, total: r.total };
  });

export const listUsCodeReleasePoints = createServerFn({ method: "GET" }).handler(
  async (): Promise<ReleasePoint[]> => {
    const r = await restGet<{ id: unknown; p: unknown; source_url: unknown }[]>(
      "corpus_records?select=id,source_url,p:detail->release_point&dataset=eq.us_code_release_points&order=ordinal.asc&limit=200",
    );
    return r.rows
      .map((row) => parseReleasePoint(row.id, row.p, row.source_url))
      .filter((p): p is ReleasePoint => !!p);
  },
);

/** GovInfo link service URL of a section in one annual edition (HTML rendition). */
export function govinfoEditionUrl(title: string, key: string, year: number): string {
  return `https://www.govinfo.gov/link/uscode/${title}/${encodeURIComponent(key)}?year=${year}&type=usc&link-type=html`;
}

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  source_credit: "Source credit",
  amendment_note: "Amendments note",
  status_note: "Status heading",
  law_margin: "Law's margin note",
  law_margin_note: "Law's margin note (set out as a note)",
  law_text: "Cited in the law's text",
};

export const STATUS_LABELS: Record<string, string> = {
  repealed: "Repealed",
  omitted: "Omitted",
  transferred: "Transferred",
  renumbered: "Renumbered",
  reserved: "Reserved",
  vacant: "Vacant",
  unknown: "Status marked unknown",
};
