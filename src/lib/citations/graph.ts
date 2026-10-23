/**
 * citations/2 read shapes for the site (citation map, document citations, cited-by, top authorities, co-citation, authority
 * profile): parsers of the RPC answers of database/contracts/citations-v2.sql into typed values, and the site link of a
 * resolved authority. Pure (no I/O); the server functions are in citations.functions.ts.
 */

export const AUTHORITY_KINDS = [
  "case", "usc", "cfr", "cfr_part", "federal_register", "statutes_at_large", "public_law", "constitution_us",
  "constitution_state", "federal_rule", "local_rule", "state_statute", "state_regulation",
] as const;
export type AuthorityKind = (typeof AUTHORITY_KINDS)[number] | "mdl" | "docket";

export const KIND_LABELS: Record<AuthorityKind, string> = {
  case: "Case law", usc: "U.S. Code", cfr: "C.F.R. section", cfr_part: "C.F.R. part", federal_register: "Federal Register",
  statutes_at_large: "Statutes at Large", public_law: "Public law", constitution_us: "U.S. Constitution",
  constitution_state: "State constitution", federal_rule: "Federal rule", local_rule: "Local rule", state_statute: "State statute",
  state_regulation: "State regulation", mdl: "MDL (mention)", docket: "Docket number (mention)",
};

export type Resolution = "resolved" | "ambiguous" | "unresolved" | "not_in_corpus" | "pending";

export type AuthorityTarget = { dataset: string; id: string; title: string | null; href: string | null };

export type AuthorityNode = {
  /** graph node: "<dataset>/<record id>" when resolved (parallel citations of one decision are one node), else "key/<key>" */
  node: string;
  key: string;
  kind: AuthorityKind;
  label: string;
  resolution: Resolution;
  reason: string | null;
  target: AuthorityTarget | null;
  candidates: string[];
};

export type DocumentRef = {
  id: string;
  title: string | null;
  filedDate: string | null;
  docType: string | null;
  courtId: string | null;
  mdl: string | null;
  sourceUrl: string | null;
};

export type CitationMap = {
  mdl: string;
  kinds: AuthorityKind[] | null;
  documentsTotal: number;
  documentsCiting: number;
  truncated: boolean;
  authorities: (AuthorityNode & { documents: number; mentions: number })[];
  documents: (DocumentRef & { node: string; authorities: number })[];
  links: { source: string; target: string; mentions: number }[];
};

export type DocumentCitations = {
  document: DocumentRef;
  textServed: boolean;
  pagesExtracted: number;
  extractorVersions: string[];
  totalAuthorities: number;
  byKind: Partial<Record<AuthorityKind, number>>;
  byResolution: Partial<Record<Resolution, number>>;
  shortFormsUnlinked: number;
  authorities: (AuthorityNode & {
    relation: "cites" | "mentions";
    mentions: number;
    fullMentions: number;
    shortMentions: number;
    firstPage: number;
    pages: number[];
    pins: string[];
  })[];
};

export type Pair = [string, number];
export type CitedBy = {
  authority: AuthorityNode;
  keys: string[];
  documents: number;
  mentions: number;
  byMdl: Pair[];
  byCourt: Pair[];
  byYear: [number, number][];
  undated: number;
  list: (DocumentRef & { mentions: number; firstPage: number | null; pins: string[] })[];
};

export type AuthorityProfile = CitedBy & {
  coCited: (AuthorityNode & { documentsTogether: number })[];
  occurrences: number;
  firstFiled: string | null;
  lastFiled: string | null;
};

export type TopAuthorities = {
  mdl: string | null;
  kind: AuthorityKind | null;
  documentsWithCitations: number;
  authorities: (AuthorityNode & { documents: number; mentions: number; firstYear: number | null; lastYear: number | null })[];
};

export type CoCitations =
  | { mode: "authority"; authority: AuthorityNode; documents: number; coCited: (AuthorityNode & { documentsTogether: number })[] }
  | { mode: "mdl"; mdl: string; documents: number; pairs: { a: AuthorityNode; b: AuthorityNode; documentsTogether: number }[] };

// ------------------------------------------------------------------------------------------------ helpers
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const KINDS = new Set<string>([...AUTHORITY_KINDS, "mdl", "docket"]);
const RESOLUTIONS = new Set<string>(["resolved", "ambiguous", "unresolved", "not_in_corpus", "pending"]);

/** Site page of a resolved record (null when the site has no page for that dataset's records). */
export function targetHref(dataset: string, id: string): string | null {
  const enc = encodeURIComponent;
  let m: RegExpMatchArray | null;
  switch (dataset) {
    case "us_code_sections":
      m = id.match(/^(\d{1,2}):([0-9A-Za-z.-]{1,40})$/);
      return m ? `/law/uscode/${m[1]}/${enc(m[2]!)}` : null;
    case "ecfr_sections_full":
    case "federal_regulations_sections":
    case "federal_regulations_parts":
      if ((m = id.match(/^cfr:(\d{1,2}):part-(\d{1,5})$/))) return `/law/cfr/${m[1]}/part/${m[2]}`;
      if (dataset === "federal_regulations_parts" && (m = id.match(/^cfr:(\d{1,2}):(\d{1,5})$/))) return `/law/cfr/${m[1]}/part/${m[2]}`;
      if ((m = id.match(/^cfr:(\d{1,2}):(\d{1,5}\.[0-9A-Za-z().-]{1,40})$/))) return `/law/cfr/${m[1]}/${enc(m[2]!)}`;
      return null;
    case "caselaw":
      return /^[1-9]\d{0,11}$/.test(id) ? `/cases/${id}` : null;
    default:
      return /^[a-z0-9_]{1,80}$/.test(dataset) && id.length <= 160 ? `/records/${dataset}/${enc(id)}` : null;
  }
}

export function parseNode(v: unknown): AuthorityNode | null {
  if (!isObj(v)) return null;
  const key = str(v["key"]);
  const kind = str(v["kind"]);
  const node = str(v["node"]) ?? str(v["id"]);
  if (!key || !node || !kind || !KINDS.has(kind)) return null;
  const res = str(v["resolution"]) ?? "pending";
  const t = isObj(v["target"]) ? v["target"] : null;
  const dataset = t ? str(t["dataset"]) : null;
  const id = t ? (typeof t["id"] === "number" ? String(t["id"]) : str(t["id"])) : null;
  return {
    node,
    key,
    kind: kind as AuthorityKind,
    label: str(v["label"]) ?? key,
    resolution: (RESOLUTIONS.has(res) ? res : "pending") as Resolution,
    reason: str(v["reason"]),
    target: dataset && id ? { dataset, id, title: str(t!["title"]), href: targetHref(dataset, id) } : null,
    candidates: strs(v["candidates"]).length ? strs(v["candidates"]) : arr(v["candidates"]).map(String),
  };
}

export function parseDocRef(v: unknown): DocumentRef | null {
  if (!isObj(v) || !str(v["id"]) || !/^d_[0-9a-f]{24}$/.test(String(v["id"]))) return null;
  return {
    id: String(v["id"]),
    title: str(v["title"]),
    filedDate: str(v["filed_date"]),
    docType: str(v["doc_type"]),
    courtId: str(v["court_id"]),
    mdl: str(v["mdl"]),
    sourceUrl: str(v["source_url"]) && /^https:\/\//.test(String(v["source_url"])) ? String(v["source_url"]) : null,
  };
}

const pairs = (v: unknown): Pair[] =>
  arr(v).flatMap((p) => (Array.isArray(p) && p.length === 2 && p[0] !== null ? [[String(p[0]), num(p[1])] as Pair] : []));

// ------------------------------------------------------------------------------------------------ parsers
export function parseCitationMap(v: unknown): CitationMap | null {
  if (!isObj(v) || !str(v["mdl"])) return null;
  const authorities: CitationMap["authorities"] = [];
  const documents: CitationMap["documents"] = [];
  for (const n of arr(v["nodes"])) {
    if (!isObj(n)) continue;
    if (n["type"] === "authority") {
      const a = parseNode(n);
      if (a) authorities.push({ ...a, documents: num(n["documents"]), mentions: num(n["mentions"]) });
    } else if (n["type"] === "document") {
      const d = parseDocRef(n["document"]);
      if (d) documents.push({ ...d, node: String(n["id"]), authorities: num(n["authorities"]) });
    }
  }
  const ids = new Set([...authorities.map((a) => a.node), ...documents.map((d) => d.node)]);
  const links = arr(v["links"]).flatMap((l) =>
    isObj(l) && ids.has(String(l["source"])) && ids.has(String(l["target"]))
      ? [{ source: String(l["source"]), target: String(l["target"]), mentions: num(l["mentions"]) }]
      : [],
  );
  const kinds = strs(v["kinds"]).filter((k) => KINDS.has(k)) as AuthorityKind[];
  return {
    mdl: String(v["mdl"]),
    kinds: Array.isArray(v["kinds"]) ? kinds : null,
    documentsTotal: num(v["documents_total"]),
    documentsCiting: num(v["documents_citing"]),
    truncated: v["truncated"] === true,
    authorities,
    documents,
    links,
  };
}

export function parseDocumentCitations(v: unknown): DocumentCitations | null {
  if (!isObj(v)) return null;
  const document = parseDocRef(v["document"]);
  if (!document) return null;
  const authorities: DocumentCitations["authorities"] = [];
  for (const x of arr(v["authorities"])) {
    const a = parseNode(x);
    if (!a || !isObj(x)) continue;
    authorities.push({
      ...a,
      relation: x["relation"] === "mentions" ? "mentions" : "cites",
      mentions: num(x["mentions"]),
      fullMentions: num(x["full_mentions"]),
      shortMentions: num(x["short_mentions"]),
      firstPage: num(x["first_page"]),
      pages: arr(x["pages"]).map(num),
      pins: strs(x["pins"]),
    });
  }
  const counts = (o: unknown) => (isObj(o) ? Object.fromEntries(Object.entries(o).map(([k, n]) => [k, num(n)])) : {});
  return {
    document,
    textServed: v["text_served"] === true,
    pagesExtracted: num(v["pages_extracted"]),
    extractorVersions: strs(v["extractor_versions"]),
    totalAuthorities: num(v["total_authorities"]),
    byKind: counts(v["by_kind"]),
    byResolution: counts(v["by_resolution"]),
    shortFormsUnlinked: num(v["short_forms_unlinked"]),
    authorities,
  };
}

export function parseCitedBy(v: unknown): CitedBy | null {
  if (!isObj(v)) return null;
  const authority = parseNode(v["authority"]);
  if (!authority) return null;
  return {
    authority,
    keys: strs(v["keys"]),
    documents: num(v["documents"]),
    mentions: num(v["mentions"]),
    byMdl: pairs(v["by_mdl"]),
    byCourt: pairs(v["by_court"]),
    byYear: arr(v["by_year"]).flatMap((p) => (Array.isArray(p) && p.length === 2 ? [[num(p[0]), num(p[1])] as [number, number]] : [])),
    undated: num(v["undated"]),
    list: arr(v["list"]).flatMap((x) => {
      const d = parseDocRef(x);
      return d && isObj(x) ? [{ ...d, mentions: num(x["mentions"]), firstPage: numOrNull(x["first_page"]), pins: strs(x["pins"]) }] : [];
    }),
  };
}

const coCited = (v: unknown) =>
  arr(v).flatMap((x) => {
    const a = parseNode(x);
    return a && isObj(x) ? [{ ...a, documentsTogether: num(x["documents_together"]) }] : [];
  });

export function parseAuthorityProfile(v: unknown): AuthorityProfile | null {
  const base = parseCitedBy(v);
  if (!base || !isObj(v)) return null;
  return { ...base, coCited: coCited(v["co_cited"]), occurrences: num(v["occurrences"]), firstFiled: str(v["first_filed"]), lastFiled: str(v["last_filed"]) };
}

export function parseTopAuthorities(v: unknown): TopAuthorities | null {
  if (!isObj(v)) return null;
  const kind = str(v["kind"]);
  return {
    mdl: str(v["mdl"]),
    kind: kind && KINDS.has(kind) ? (kind as AuthorityKind) : null,
    documentsWithCitations: num(v["documents_with_citations"]),
    authorities: arr(v["authorities"]).flatMap((x) => {
      const a = parseNode(x);
      return a && isObj(x)
        ? [{ ...a, documents: num(x["documents"]), mentions: num(x["mentions"]), firstYear: numOrNull(x["first_year"]), lastYear: numOrNull(x["last_year"]) }]
        : [];
    }),
  };
}

export function parseCoCitations(v: unknown): CoCitations | null {
  if (!isObj(v)) return null;
  if (v["authority"] !== undefined) {
    const authority = parseNode(v["authority"]);
    return authority ? { mode: "authority", authority, documents: num(v["documents"]), coCited: coCited(v["co_cited"]) } : null;
  }
  if (!str(v["mdl"])) return null;
  return {
    mode: "mdl",
    mdl: String(v["mdl"]),
    documents: num(v["documents"]),
    pairs: arr(v["pairs"]).flatMap((p) => {
      if (!isObj(p)) return [];
      const a = parseNode(p["a"]);
      const b = parseNode(p["b"]);
      return a && b ? [{ a, b, documentsTogether: num(p["documents_together"]) }] : [];
    }),
  };
}
