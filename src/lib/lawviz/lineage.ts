/**
 * Regulatory lineage model (pure, isomorphic) for one CFR part: which U.S. Code sections authorize it, which Federal
 * Register documents cite it, and when its sections changed. Parses `lawviz_part_lineage_v1`
 * (database/contracts/lawviz-v1.sql) and the part's printed authority line.
 *
 * Authority resolution is exact: a citation becomes a U.S. Code section id only when it names one title and one section
 * ("42 U.S.C. 264", "21 U.S.C. 371(a)" -> section 371). "et seq.", ranges ("1451–1461"), "note" references and appendix
 * citations are shown as printed and never expanded or guessed.
 */

export type LineageLaw = {
  id: string;
  label: string;
  enacted: string | null;
  kinds: string[];
  title: string | null;
};
export type LineageStatute = {
  id: string;
  citation: string;
  heading: string | null;
  status: string | null;
  url: string | null;
  laws: LineageLaw[];
  lawsTotal: number;
};
export type FrDoc = {
  id: string;
  date: string;
  type: string;
  citation: string | null;
  title: string;
  url: string | null;
};
export type FrRef = { citation: string; url: string | null };
export type VersionLane = {
  id: string;
  identifier: string;
  title: string;
  removed: boolean;
  changes: number;
  dates: { date: string; fr: FrRef[] }[];
};
export type Lineage = {
  status: "ok";
  title: string;
  part: string;
  part_record: { title: string | null; asOf: string | null } | null;
  fr: {
    total: number;
    undated: number;
    months: { month: string; type: string; n: number }[];
    docs: FrDoc[];
    complete: boolean;
  };
  versions: {
    sections: number;
    removed: number;
    dates: { date: string; n: number }[];
    lanes: VersionLane[];
    selection: "all" | "most_changed";
  };
  statutes: LineageStatute[];
  missing: string[];
  empty: boolean;
  dropped: number;
};
export type LineageView = Lineage | { status: "unavailable" | "invalid" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const USC_ID = /^(?:[1-9]|[1-4]\d|5[0-4])a?:[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}$/;
const LAW_ID =
  /^(?:stat-\d{1,3}-(?:\d{1,5}(?:-\d{1,3})?|doc\d{1,6}(?:-\d{1,3})?)|pl-\d{1,3}-\d{1,4}(?:-\d{1,3})?)$/;
const FR_HOSTS = new Set(["www.federalregister.gov", "federalregister.gov", "www.govinfo.gov"]);
const USC_HOSTS = new Set(["uscode.house.gov", "www.govinfo.gov", "govinfo.gov"]);

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const str = (v: unknown, max = 400) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const nat = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const iso = (v: unknown) => (typeof v === "string" && ISO.test(v) ? v : null);

/** An https URL on one of the allowed hosts, else null. */
export function safeUrl(v: unknown, hosts: Set<string>): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && hosts.has(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseLineage(raw: unknown): LineageView {
  const r = obj(raw);
  if (!r) return { status: "unavailable" };
  if (r["status"] === "invalid") return { status: "invalid" };
  if (r["status"] !== "ok") return { status: "unavailable" };
  let dropped = 0;
  const fr = obj(r["fr"]) ?? {};
  const months: Lineage["fr"]["months"] = [];
  for (const m of arr(fr["months"])) {
    const a = arr(m);
    const month = typeof a[0] === "string" && MONTH.test(a[0]) ? a[0] : null;
    const type = str(a[1], 60);
    const n = nat(a[2]);
    if (month && type && n) months.push({ month, type, n });
    else dropped++;
  }
  const docs: FrDoc[] = [];
  for (const d of arr(fr["docs"])) {
    const a = arr(d);
    const id = str(a[0], 40);
    const date = iso(a[1]);
    if (!id || !date) {
      dropped++;
      continue;
    }
    docs.push({
      id,
      date,
      type: str(a[2], 60) ?? "Not recorded",
      citation: str(a[3], 60),
      title: str(a[4], 200) ?? "Not recorded",
      url: safeUrl(a[5], FR_HOSTS),
    });
  }
  const ver = obj(r["versions"]) ?? {};
  const dates: Lineage["versions"]["dates"] = [];
  for (const d of arr(ver["dates"])) {
    const a = arr(d);
    const date = iso(a[0]);
    const n = nat(a[1]);
    if (date && n) dates.push({ date, n });
    else dropped++;
  }
  const lanes: VersionLane[] = [];
  for (const l of arr(ver["lanes"])) {
    const a = arr(l);
    const id = str(a[0], 220);
    if (!id || !id.startsWith("cfr:")) {
      dropped++;
      continue;
    }
    const ds: VersionLane["dates"] = [];
    for (const x of arr(a[5])) {
      const y = arr(x);
      const date = iso(y[0]);
      if (!date) continue;
      const fr: FrRef[] = [];
      for (const f of arr(y[1])) {
        const g = arr(f);
        const citation = str(g[0], 60);
        if (citation) fr.push({ citation, url: safeUrl(g[1], FR_HOSTS) });
      }
      ds.push({ date, fr });
    }
    lanes.push({
      id,
      identifier: str(a[1], 120) ?? id,
      title: str(a[2], 200) ?? id,
      removed: a[3] === true,
      changes: nat(a[4]) ?? ds.length,
      dates: ds,
    });
  }
  const statutes: LineageStatute[] = [];
  for (const s of arr(r["statutes"])) {
    const a = arr(s);
    const id = str(a[0], 140);
    if (!id || !USC_ID.test(id)) {
      dropped++;
      continue;
    }
    const laws: LineageLaw[] = [];
    for (const l of arr(a[5])) {
      const b = arr(l);
      const lawId = str(b[0], 40);
      if (!lawId || !LAW_ID.test(lawId)) {
        dropped++;
        continue;
      }
      laws.push({
        id: lawId,
        label: str(b[1], 120) ?? lawId,
        enacted: iso(b[2]),
        kinds: arr(b[3]).filter((k): k is string => typeof k === "string"),
        title: str(b[4], 200),
      });
    }
    statutes.push({
      id,
      citation: str(a[1], 120) ?? id,
      heading: str(a[2], 300),
      status: str(a[3], 40),
      url: safeUrl(a[4], USC_HOSTS),
      laws,
      lawsTotal: nat(a[6]) ?? laws.length,
    });
  }
  const pr = obj(r["part_record"]);
  return {
    status: "ok",
    title: str(r["title"], 4) ?? "",
    part: str(r["part"], 60) ?? "",
    part_record: pr ? { title: str(pr["title"], 300), asOf: iso(pr["as_of"]) } : null,
    fr: {
      total: nat(fr["total"]) ?? docs.length,
      undated: nat(fr["undated"]) ?? 0,
      months,
      docs,
      complete: fr["complete"] === true,
    },
    versions: {
      sections: nat(ver["sections"]) ?? 0,
      removed: nat(ver["removed"]) ?? 0,
      dates,
      lanes,
      selection: ver["selection"] === "most_changed" ? "most_changed" : "all",
    },
    statutes,
    missing: arr(r["missing"]).filter((x): x is string => typeof x === "string" && USC_ID.test(x)),
    empty: r["empty"] === true,
    dropped,
  };
}

// ------------------------------------------------------------------------------------------------ authority line
export type AuthorityCite = {
  /** As printed ("42 U.S.C. 264", "21 U.S.C. 301 et seq."). */
  printed: string;
  /** Exact stored-section id when the citation names one title and one section; else null. */
  id: string | null;
  reason: "exact" | "et_seq" | "range" | "note" | "appendix" | "other_form";
};

const SECTION_TOKEN = /^([0-9]+[A-Za-z0-9]*(?:-[0-9A-Za-z]+)*)((?:\([^)]{1,20}\))*)$/;
const USC_CITE = /^(\d{1,2})\s+U\.\s?S\.\s?C\.?\s+(App\.?\s+)?(.+)$/i;

function classify(title: string, appendix: boolean, raw: string): AuthorityCite | null {
  const tok = raw.trim().replace(/\.$/, "").trim();
  if (!tok) return null;
  const printed = `${title} U.S.C. ${appendix ? "App. " : ""}${tok}${/et\s+seq$/i.test(tok) ? "." : ""}`;
  if (appendix) return { printed, id: null, reason: "appendix" };
  if (/et\s+seq/i.test(tok)) return { printed, id: null, reason: "et_seq" };
  if (/\bnote\b/i.test(tok)) return { printed, id: null, reason: "note" };
  if (/[–—]|\bthrough\b|\bto\b/i.test(tok)) return { printed, id: null, reason: "range" };
  const plainRange = /^(\d+)-(\d+)$/.exec(tok);
  if (plainRange && Number(plainRange[2]) > Number(plainRange[1]))
    return { printed, id: null, reason: "range" };
  const s = SECTION_TOKEN.exec(tok.replace(/\s+/g, ""));
  const id = s ? `${title}:${s[1]}` : null;
  return id && USC_ID.test(id)
    ? { printed, id, reason: "exact" }
    : { printed, id: null, reason: "other_form" };
}

/**
 * "Authority: 15 U.S.C. 1453, 1454; 21 U.S.C. 321 note, 371 et seq.; Pub. L. 104-4." -> one entry per U.S. Code
 * citation, each resolved only when exact. Non-Code authorities (public laws, Statutes at Large, Executive Orders) are
 * left to the Parallel Table rows and not returned here. A hyphenated pair of plain numbers ("1451-1461") is read as a
 * range, never as one section.
 */
export function parseAuthorityLine(text: string): AuthorityCite[] {
  const out: AuthorityCite[] = [];
  const body = text
    .replace(/^\s*Authority:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  for (const clause of body.split(";")) {
    for (const piece of clause.split(/,?\s*(?=\b\d{1,2}\s+U\.\s?S\.\s?C\.)/)) {
      const m = USC_CITE.exec(piece.trim());
      if (!m) continue;
      const title = String(Number(m[1]));
      if (Number(title) < 1 || Number(title) > 54) continue;
      for (const raw of m[3]!.replace(/,?\s+and\s+/gi, ", ").split(",")) {
        const c = classify(title, !!m[2], raw);
        if (c) out.push(c);
      }
    }
  }
  return out;
}

/** Unique ids in first-seen order, at most `max` (the RPC accepts 24). */
export function uniqueIds(ids: (string | null | undefined)[], max = 24): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || !USC_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Federal Register document types grouped into lanes; everything else is "Other documents". */
export const FR_LANES = [
  { id: "Rule", label: "Rules" },
  { id: "Proposed Rule", label: "Proposed rules" },
  { id: "Notice", label: "Notices" },
  { id: "other", label: "Other documents" },
] as const;
export const frLane = (type: string) =>
  type === "Rule" || type === "Proposed Rule" || type === "Notice" ? type : "other";
