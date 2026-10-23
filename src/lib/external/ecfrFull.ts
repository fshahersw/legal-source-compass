/**
 * Pure helpers for the Code of Federal Regulations pages (datasets ecfr_sections_full and ecfr_section_versions,
 * built by scripts/enrichment/ecfr_full/). Server functions live in ecfrFull.functions.ts; everything here is
 * isomorphic and tested without the network. Malformed stored values are dropped, never repaired; stored text is
 * never dropped (a layout that does not fit the text falls back to one paragraph per line).
 */
import type { EcfrLayoutEntry, EcfrNoteKind } from "./ecfrXml";

export const CFR_TITLE = /^(?:[1-9]|[1-4]\d|50)$/;
/** Section and appendix identifiers as the eCFR prints them ("314.70", "Appendix A-1 to Part 60", "240.15Fb1-1"). */
export const CFR_IDENTIFIER = /^[\p{L}\p{N}][\p{L}\p{N} .,;:()'’§&\-–—/]{0,199}$/u;
export const CFR_PART = /^[\p{L}\p{N}][\p{L}\p{N} .\-–—]{0,59}$/u;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The eCFR point-in-time record starts on this date. */
export const POINT_IN_TIME_START = "2017-01-03";
export const SECTIONS_DATASET = "ecfr_sections_full";
export const VERSIONS_DATASET = "ecfr_section_versions";

export type CfrKind = "section" | "appendix" | "part";
export type CfrCell = { text: string; colspan: number; rowspan: number; header: boolean };
export type CfrBlock =
  | { kind: "p"; depth: number; flag: "" | "x" | "f" | "i"; text: string }
  | { kind: "h"; level: number; flag: "" | "x" | "f"; text: string }
  | { kind: "table"; rows: CfrCell[][] }
  | { kind: "graphic"; src: string; url: string | null };
export type CfrNote = { kind: EcfrNoteKind; label: string; text: string; scope: string | null };
export type CfrPathNode = { type: string; identifier: string; label: string };

const NOTE_LABEL: Record<EcfrNoteKind, string> = {
  source: "Source",
  authority: "Authority",
  omb: "OMB approval",
  editorial: "Editorial note",
  effective_date: "Effective date note",
  amendment: "Pending amendment",
  cross_reference: "Cross reference",
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
export const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const nat = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;

export function recordId(title: string, identifier: string, part?: string | null): string {
  return part ? `cfr:${title}:${identifier}@part-${part}` : `cfr:${title}:${identifier}`;
}
export const partRecordId = (title: string, part: string) => `cfr:${title}:part-${part}`;

/** Graphics are served by the eCFR under /graphics/<file>; only that exact shape becomes a link. */
export function graphicUrl(src: string): string | null {
  const m = /^\/?graphics\/([A-Za-z0-9._-]{1,80}\.(?:gif|png|jpe?g|pdf))$/i.exec(src.trim());
  return m ? `https://www.ecfr.gov/graphics/${m[1]}` : null;
}

function layoutEntry(raw: unknown): EcfrLayoutEntry | null {
  const e = arr(raw);
  const kind = e[0];
  if (kind === "p" || kind === "h") {
    const n = nat(e[1], 12);
    const flag = e[2] === undefined ? "" : e[2];
    if (n === null || typeof flag !== "string" || !["", "x", "f", "i"].includes(flag)) return null;
    return flag ? [kind, n, flag] : [kind, n];
  }
  if (kind === "t") {
    const rows = arr(e[1]);
    if (!rows.length) return null;
    const spec: (number | [number, number, number][])[] = [];
    for (const r of rows) {
      if (typeof r === "number") {
        if (!Number.isInteger(r) || r < 1 || r > 400) return null;
        spec.push(r);
      } else {
        const cells = arr(r).map((c) => arr(c));
        if (
          !cells.length ||
          cells.some((c) => c.length !== 3 || c.some((x) => nat(x, 400) === null))
        )
          return null;
        spec.push(cells as [number, number, number][]);
      }
    }
    return ["t", spec];
  }
  if (kind === "g" && typeof e[1] === "string") return ["g", e[1].slice(0, 200)];
  return null;
}

/** Stored text (one block per line) + layout → render blocks. Falls back to plain paragraphs if they disagree. */
export function decodeBody(
  text: string,
  rawLayout: unknown,
): { blocks: CfrBlock[]; exact: boolean } {
  const layout = arr(rawLayout).map(layoutEntry);
  const lines = layout.length ? text.split("\n") : text ? text.split("\n") : [];
  const fallback = (): { blocks: CfrBlock[]; exact: boolean } => ({
    blocks: lines
      .filter((l) => l.trim())
      .map((l) => ({ kind: "p", depth: 0, flag: "", text: l.replace(/\t/g, " · ") })),
    exact: false,
  });
  if (!layout.length) return fallback();
  if (layout.some((e) => e === null)) return fallback();
  const blocks: CfrBlock[] = [];
  let at = 0;
  for (const e of layout as EcfrLayoutEntry[]) {
    if (e[0] === "t") {
      const rows: CfrCell[][] = [];
      for (const spec of e[1]) {
        const line = lines[at++];
        if (line === undefined) return fallback();
        const cells = line.split("\t");
        const want = typeof spec === "number" ? spec : spec.length;
        if (cells.length !== want) return fallback();
        rows.push(
          cells.map((t, k) => {
            const s = typeof spec === "number" ? null : spec[k]!;
            return {
              text: t,
              colspan: s ? Math.max(1, s[0]) : 1,
              rowspan: s ? Math.max(1, s[1]) : 1,
              header: s ? s[2] === 1 : false,
            };
          }),
        );
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    const line = lines[at++];
    if (line === undefined) return fallback();
    if (e[0] === "g") blocks.push({ kind: "graphic", src: e[1], url: graphicUrl(e[1]) });
    else if (e[0] === "h")
      blocks.push({ kind: "h", level: e[1], flag: (e[2] ?? "") as "" | "x" | "f", text: line });
    else
      blocks.push({
        kind: "p",
        depth: e[1],
        flag: (e[2] ?? "") as "" | "x" | "f" | "i",
        text: line,
      });
  }
  if (at !== lines.length) return fallback();
  return { blocks, exact: true };
}

/** Plain text of decoded blocks (for copying): paragraphs and rows on their own lines, table cells separated by tabs. */
export function blocksToText(blocks: CfrBlock[]): string {
  return blocks
    .map((b) =>
      b.kind === "table"
        ? b.rows.map((r) => r.map((c) => c.text).join("\t")).join("\n")
        : b.kind === "graphic"
          ? `[Graphic ${b.src.split("/").pop()}]`
          : b.text,
    )
    .join("\n\n");
}

/** Text runs with the builder's ^(..) and _(..) fallbacks for super/subscripts that have no Unicode character. */
export type Run = { t: "text" | "sup" | "sub"; s: string };
export function scriptRuns(s: string): Run[] {
  const out: Run[] = [];
  const re = /([\^_])\(([^()]{1,40})\)/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > at) out.push({ t: "text", s: s.slice(at, m.index) });
    out.push({ t: m[1] === "^" ? "sup" : "sub", s: m[2]! });
    at = m.index! + m[0].length;
  }
  if (at < s.length) out.push({ t: "text", s: s.slice(at) });
  return out;
}

const NOTE_KINDS = new Set(Object.keys(NOTE_LABEL));
export function parseNotes(raw: unknown): CfrNote[] {
  const out: CfrNote[] = [];
  for (const n of arr(raw)) {
    const a = arr(n);
    const kind = a[0];
    const text = str(a[1], 200_000);
    if (typeof kind !== "string" || !NOTE_KINDS.has(kind) || !text) continue;
    out.push({
      kind: kind as EcfrNoteKind,
      label: NOTE_LABEL[kind as EcfrNoteKind],
      text,
      scope: str(a[2], 300),
    });
  }
  return out;
}

export function parsePath(raw: unknown): CfrPathNode[] {
  return arr(raw).flatMap((p) => {
    const a = arr(p);
    const type = str(a[0], 30);
    const identifier = str(a[1], 200);
    const label = str(a[2], 600);
    return type && identifier ? [{ type, identifier, label: label ?? identifier }] : [];
  });
}

const ECFR_URL = /^https:\/\/www\.ecfr\.gov\/current\/title-\d{1,2}\/[^\s"<>]{1,600}$/;
const GOVINFO_URL =
  /^https:\/\/www\.govinfo\.gov\/bulkdata\/ECFR\/title-\d{1,2}\/ECFR-title\d{1,2}\.xml$/;
export const ecfrUrl = (v: unknown) => (typeof v === "string" && ECFR_URL.test(v) ? v : null);
export const govinfoUrl = (v: unknown) => (typeof v === "string" && GOVINFO_URL.test(v) ? v : null);

export type CfrSection = {
  id: string;
  kind: "section" | "appendix";
  title: string;
  titleNumber: string;
  identifier: string;
  citation: string;
  heading: string;
  part: string | null;
  subpart: string | null;
  path: CfrPathNode[];
  reserved: boolean;
  asOf: string;
  blocks: CfrBlock[];
  layoutExact: boolean;
  text: string;
  notes: CfrNote[];
  ecfrUrl: string | null;
  sourceUrl: string | null;
  sourceSha256: string | null;
  qualification: string | null;
};

export function parseSectionRow(row: unknown): CfrSection | null {
  const r = obj(row);
  const d = obj(r?.["detail"]);
  if (!r || !d) return null;
  const id = str(r["id"], 600);
  const kind = d["kind"];
  const titleNumber = str(d["title_number"], 3);
  const identifier = str(d["identifier"], 200);
  const asOf = str(d["as_of"], 10);
  const text = typeof r["text"] === "string" ? (r["text"] as string) : null;
  if (
    !id ||
    (kind !== "section" && kind !== "appendix") ||
    !titleNumber ||
    !CFR_TITLE.test(titleNumber)
  )
    return null;
  if (!identifier || !asOf || !ISO_DATE.test(asOf) || text === null) return null;
  const { blocks, exact } = decodeBody(text, d["layout"]);
  const source = obj(d["source"]);
  return {
    id,
    kind,
    title: str(r["title"], 800) ?? `${titleNumber} CFR ${identifier}`,
    titleNumber,
    identifier,
    citation: str(d["citation"], 300) ?? `${titleNumber} CFR ${identifier}`,
    heading: str(d["heading"], 800) ?? "",
    part: str(d["part"], 60),
    subpart: str(d["subpart"], 60),
    path: parsePath(d["path"]),
    reserved: d["reserved"] === true,
    asOf,
    blocks,
    layoutExact: exact,
    text,
    notes: parseNotes(d["notes"]),
    ecfrUrl: ecfrUrl(d["ecfr_url"]),
    sourceUrl: govinfoUrl(r["source_url"]),
    sourceSha256: str(source?.["sha256"], 64),
    qualification: str(d["qualification"], 2000),
  };
}

export type CfrPart = {
  id: string;
  title: string;
  titleNumber: string;
  part: string;
  heading: string;
  path: CfrPathNode[];
  reserved: boolean;
  asOf: string;
  notes: CfrNote[];
  blocks: CfrBlock[];
  sections: number | null;
  range: string | null;
  ecfrUrl: string | null;
  sourceUrl: string | null;
};

export function parsePartRow(row: unknown): CfrPart | null {
  const r = obj(row);
  const d = obj(r?.["detail"]);
  if (!r || !d || d["kind"] !== "part") return null;
  const id = str(r["id"], 300);
  const titleNumber = str(d["title_number"], 3);
  const part = str(d["identifier"], 60);
  const asOf = str(d["as_of"], 10);
  if (!id || !titleNumber || !CFR_TITLE.test(titleNumber) || !part || !asOf || !ISO_DATE.test(asOf))
    return null;
  const text = typeof r["text"] === "string" ? (r["text"] as string) : "";
  return {
    id,
    title: str(r["title"], 800) ?? `${titleNumber} CFR part ${part}`,
    titleNumber,
    part,
    heading: str(d["heading"], 800) ?? "",
    path: parsePath(d["path"]),
    reserved: d["reserved"] === true,
    asOf,
    notes: parseNotes(d["notes"]),
    blocks: decodeBody(text, d["layout"]).blocks,
    sections: nat(d["sections"], 100_000),
    range: str(d["range"], 120),
    ecfrUrl: ecfrUrl(d["ecfr_url"]),
    sourceUrl: govinfoUrl(r["source_url"]),
  };
}

export type CfrListItem = {
  id: string;
  kind: CfrKind;
  identifier: string;
  title: string;
  part: string | null;
  reserved: boolean;
  characters: number | null;
  sections: number | null;
  subpart: string | null;
};

/** A listing row (select=id,title,c:item->cells,s:filters->subpart). */
export function parseListRow(row: unknown): CfrListItem | null {
  const r = obj(row);
  const c = obj(r?.["c"]);
  const id = str(r?.["id"], 600);
  const title = str(r?.["title"], 800);
  const kind = c?.["kind"];
  const identifier = str(c?.["identifier"], 200);
  if (
    !id ||
    !title ||
    !c ||
    !identifier ||
    (kind !== "section" && kind !== "appendix" && kind !== "part")
  )
    return null;
  return {
    id,
    kind,
    identifier,
    title,
    part: str(c["part"], 60),
    reserved: c["reserved"] === true,
    characters: nat(c["characters"], 50_000_000),
    sections: nat(c["sections"], 100_000),
    subpart: str(arr(r!["s"])[0], 60),
  };
}

export type FrRef = {
  documentNumber: string;
  citation: string | null;
  publicationDate: string | null;
  url: string;
};
export type CfrVersion = {
  date: string;
  amendmentDate: string | null;
  issueDate: string | null;
  substantive: boolean;
  removed: boolean;
  name: string | null;
  frBasis: "source_note" | "only_rule_for_part_on_date" | "rules_for_part_on_date" | "none";
  fr: FrRef[];
};
export type CfrHistory = {
  id: string;
  kind: "section" | "appendix";
  part: string | null;
  versions: CfrVersion[];
  basisLabels: Record<string, string>;
  qualification: string | null;
  asOf: string | null;
};

const FR_URL = /^https:\/\/www\.federalregister\.gov\/d\/[0-9A-Za-z-]{4,40}$/;
const BASES = [
  "source_note",
  "only_rule_for_part_on_date",
  "rules_for_part_on_date",
  "none",
] as const;

export function parseVersionsRow(row: unknown): CfrHistory | null {
  const r = obj(row);
  const d = obj(r?.["detail"]);
  const id = str(r?.["id"], 600);
  if (!r || !d || !id || (d["kind"] !== "section" && d["kind"] !== "appendix")) return null;
  const versions: CfrVersion[] = [];
  for (const raw of arr(d["versions"])) {
    const v = obj(raw);
    const date = str(v?.["date"], 10);
    if (!v || !date || !ISO_DATE.test(date)) continue;
    const basis = BASES.find((b) => b === v["fr_basis"]) ?? "none";
    const fr = arr(v["fr"]).flatMap((x) => {
      const f = obj(x);
      const num = str(f?.["document_number"], 40);
      const url =
        typeof f?.["url"] === "string" && FR_URL.test(f["url"] as string)
          ? (f["url"] as string)
          : null;
      return num && url
        ? [
            {
              documentNumber: num,
              citation: str(f!["citation"], 40),
              publicationDate: str(f!["publication_date"], 10),
              url,
            },
          ]
        : [];
    });
    const dateOr = (k: string) => {
      const s = str(v[k], 10);
      return s && ISO_DATE.test(s) ? s : null;
    };
    versions.push({
      date,
      amendmentDate: dateOr("amendment_date"),
      issueDate: dateOr("issue_date"),
      substantive: v["substantive"] === true,
      removed: v["removed"] === true,
      name: str(v["name"], 800),
      frBasis: fr.length ? basis : "none",
      fr,
    });
  }
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(d["basis_labels"]) ?? {}))
    if (typeof v === "string") labels[k] = v.slice(0, 300);
  return {
    id,
    kind: d["kind"] as "section" | "appendix",
    part: str(d["part"], 60),
    versions,
    basisLabels: labels,
    qualification: str(d["qualification"], 2000),
    asOf: str(d["as_of"], 10),
  };
}

/** Distinct version dates, newest first: each is a date on which the text changed (or the record begins). */
export function versionDates(h: CfrHistory | null): string[] {
  if (!h) return [];
  return [...new Set(h.versions.map((v) => v.date))].sort().reverse();
}

/** "21 CFR 314.70", "21 C.F.R. § 314.70", "40 CFR part 60", "40 CFR 60" → route target. */
export function parseCitation(
  input: string,
): { title: string; section?: string; part?: string } | null {
  const s = input.trim().replace(/\s+/g, " ");
  const m =
    /^(\d{1,2})\s*C\.?\s*F\.?\s*R\.?\s*(?:§+\s*|sec(?:tion)?\.?\s*)?(part\s+)?([0-9][0-9A-Za-z.-]*)$/i.exec(
      s,
    );
  if (!m || !CFR_TITLE.test(m[1]!)) return null;
  const rest = m[3]!.replace(/\.$/, "");
  if (m[2] || !rest.includes(".")) return { title: m[1]!, part: rest };
  return { title: m[1]!, section: rest };
}

/** Validates an "as of" date for the live eCFR view: a real calendar date from 2017-01-03 to today. */
export function validAsOfDate(date: string, today: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return false;
  return date >= POINT_IN_TIME_START && date <= today;
}

/** URL of the eCFR Versioner `full` endpoint for one section or appendix at a date (the only live host used). */
export function asOfUrl(a: {
  date: string;
  title: string;
  part: string | null;
  kind: "section" | "appendix";
  identifier: string;
}): string {
  const q = new URLSearchParams();
  if (a.part) q.set("part", a.part);
  q.set(a.kind, a.identifier);
  return `https://www.ecfr.gov/api/versioner/v1/full/${a.date}/title-${a.title}.xml?${q.toString()}`;
}

/** The eCFR's own page for a section as of a date (for the reader to compare). */
export function ecfrOnDateUrl(
  date: string,
  title: string,
  identifier: string,
  kind: "section" | "appendix",
  part: string | null,
) {
  return kind === "section"
    ? `https://www.ecfr.gov/on/${date}/title-${title}/section-${encodeURIComponent(identifier)}`
    : `https://www.ecfr.gov/on/${date}/title-${title}${part ? `/part-${encodeURIComponent(part)}` : ""}/appendix-${encodeURIComponent(identifier)}`;
}
