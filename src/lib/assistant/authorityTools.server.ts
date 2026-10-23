/**
 * Assistant tools that connect the United States Code and the Code of Federal Regulations through the Parallel Table of
 * Authorities and Rules (corpus dataset ecfr_parallel_authorities, the Office of the Federal Register's table of the
 * rulemaking authority each agency cites for each CFR part):
 *   list_cfr_parts_citing_usc       U.S. Code citation  -> the CFR parts that cite it as authority
 *   list_authorities_for_cfr_part   CFR part citation   -> the statutes, public laws and presidential documents it rests on
 * Read-only. Citations are parsed with the section/part pages' own parsers and matched on exact title + section or exact
 * title + part; a range or "et seq." is reported as printed and never expanded; every result carries the table's
 * edition and revision date so the answer says how current it is.
 */
import {
  AUTHORITIES_DATASET,
  AUTHORITY_SELECT,
  PART_TOKEN,
  inList,
  mergeAuthorities,
  mergeByCfrTitle,
  parseAuthorityRows,
  parseTableMeta,
  partHeading,
  partIds,
  sectionAuthorities,
  sectionKeyId,
  type AuthorityRow,
  type MergedAuthority,
} from "@/lib/external/ecfrAuthorities";
import {
  CFR_PART,
  CFR_TITLE,
  SECTIONS_DATASET,
  parseCitation,
  partRecordId,
} from "@/lib/external/ecfrFull";
import { restGet } from "@/lib/external/rest.server";
import { parseUscCitation } from "./statuteTools.server";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 24000;
const LIST_CAP = 120;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

const CAVEAT =
  "The table lists the rulemaking authority agencies cite in their regulations; the Office of the Federal Register states it cannot be considered all-inclusive and that agencies keep their citations current. A row says an agency cited the authority for the part, not that the part implements every provision of it. Check the part's own authority note for the current citation.";

export const AUTHORITY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_cfr_parts_citing_usc",
    description:
      'List the Code of Federal Regulations parts that cite one United States Code section as their rulemaking authority, from the Parallel Table of Authorities and Rules (e.g. "42 U.S.C. 1395hh" or "21 U.S.C. § 371"). Returns each CFR title with the parts exactly as the table prints them (and whether each part is in the stored eCFR, with its heading), the table page, and, separately, rows printed as a range or "et seq." that begin or end at this section (reported as printed, never expanded). Use it to find which regulations rest on a statute instead of guessing; it states the table\'s edition and revision date.',
    input_schema: {
      type: "object",
      properties: {
        citation: { type: "string", description: "U.S. Code citation, e.g. 42 U.S.C. 1395hh." },
        title: { type: "integer", minimum: 1, maximum: 54 },
        section: {
          type: "string",
          description: "Section number when title is given, e.g. 1395hh.",
        },
      },
    },
  },
  {
    name: "list_authorities_for_cfr_part",
    description:
      'List the statutes and other authorities one CFR part rests on, from the Parallel Table of Authorities and Rules (e.g. "21 CFR part 314" or "40 CFR 63"). Returns the U.S. Code sections the table lists for the part (with each section\'s heading when it is in the stored Code and a link to it), ranges and "et seq." entries as printed, and any Statutes at Large, public law and Presidential document entries, with the table page and the table\'s edition and revision date. Use it before characterising what authorises a regulation.',
    input_schema: {
      type: "object",
      properties: {
        citation: {
          type: "string",
          description: "CFR part citation, e.g. 21 CFR part 314 or 40 CFR 63.",
        },
        title: { type: "integer", minimum: 1, maximum: 50 },
        part: { type: "string", description: "Part number when title is given, e.g. 314." },
      },
    },
  },
];

type Catalog = { ready: boolean; edition: string | null; revisedAsOf: string | null };

async function catalog(): Promise<Catalog> {
  const r = await restGet<{ ready: unknown; metadata: unknown }[]>(
    `corpus_datasets?select=ready,metadata&id=eq.${AUTHORITIES_DATASET}&limit=1`,
  );
  const row = r.rows[0];
  if (!row || row.ready !== true) return { ready: false, edition: null, revisedAsOf: null };
  const m = parseTableMeta(row.metadata);
  return { ready: true, edition: m.edition, revisedAsOf: m.revisedAsOf };
}

const unavailable = (what: string): ToolOutcome => ({
  content: JSON.stringify({
    found: false,
    unavailable: true,
    note: "The Parallel Table of Authorities and Rules is not loaded in this workspace, so this link cannot be listed. Read the part's own authority note (read_cfr_section) or the official eCFR instead; do not answer from memory.",
  }),
  sources: [],
  label: "Looked up statute-regulation links",
  detail: `${what} · table not loaded`,
});

const tablePdf = (edition: string | null) =>
  edition && /^\d{4}$/.test(edition)
    ? `https://www.govinfo.gov/content/pkg/GPO-CFR-INDEX-${edition}/pdf/GPO-CFR-INDEX-${edition}-4.pdf`
    : null;

const tableTitle = (c: Catalog) =>
  `Parallel Table of Authorities and Rules${c.edition ? `, CFR Index and Finding Aids ${c.edition}` : ""}`;

async function parts(rows: AuthorityRow[]): Promise<Map<string, string | null>> {
  const ids = partIds(
    rows.flatMap((r) => r.cfr.partsStored.map((p) => `${r.cfr.title}:${p}`)),
  ).slice(0, 360);
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 120) {
    const chunk = ids.slice(i, i + 120);
    const r = await restGet<{ id: unknown; title: unknown }[]>(
      `corpus_records?select=id,title&dataset=eq.${SECTIONS_DATASET}&id=${enc(inList(chunk))}&limit=${chunk.length}`,
    );
    for (const x of r.rows) {
      const m = typeof x.id === "string" ? /^cfr:(\d{1,2}):part-(.+)$/.exec(x.id) : null;
      if (m) out.set(`${m[1]}:${m[2]}`, partHeading(typeof x.title === "string" ? x.title : null));
    }
  }
  return out;
}

async function listCfrPartsCitingUsc(input: Record<string, unknown>): Promise<ToolOutcome> {
  const raw = str(input["citation"], 200);
  const c = parseUscCitation(raw, input["title"], input["section"]);
  if (!c)
    throw new Error(
      "give a U.S. Code citation such as 42 U.S.C. 1395hh (title and section number)",
    );
  const sid = sectionKeyId(c.title, c.key);
  const cited = `${c.title} U.S.C. § ${c.key}`;
  if (!sid) throw new Error("that is not a U.S. Code section designation");
  const cat = await catalog();
  if (!cat.ready) return unavailable(cited);
  const q = (field: "usc" | "usc_edge") =>
    restGet<unknown[]>(
      `corpus_records?${AUTHORITY_SELECT}&dataset=eq.${AUTHORITIES_DATASET}&filters=cs.${cs({ [field]: [sid] })}&order=ordinal.asc&limit=300`,
    );
  const [a, b, stored] = await Promise.all([
    q("usc"),
    q("usc_edge"),
    restGet<{ id: unknown }[]>(
      `corpus_records?select=id&dataset=eq.us_code_sections&id=eq.${enc(sid)}&limit=1`,
    ),
  ]);
  const exact = parseAuthorityRows(a.rows).rows;
  const edge = parseAuthorityRows(b.rows).rows;
  const headings = await parts([...exact, ...edge]);
  const pdf = tablePdf(cat.edition);
  const page = `/law/uscode/${enc(c.title)}/${enc(c.key)}`;
  const byTitle = mergeByCfrTitle(exact).map((g) => ({
    cfr_title: g.cfrTitle,
    parts: g.parts.slice(0, LIST_CAP).map((p) => ({
      part: p.part,
      in_stored_ecfr: p.stored,
      heading: p.stored ? (headings.get(`${g.cfrTitle}:${p.part}`) ?? null) : null,
      page: p.stored ? `/law/cfr/${g.cfrTitle}/part/${enc(p.part)}` : null,
    })),
    parts_not_listed_here: Math.max(0, g.parts.length - LIST_CAP),
    part_ranges_as_printed: g.ranges,
    unparsed_as_printed: g.unparsed,
    table_pages: g.pages,
  }));
  const notes = exact.filter((r) => r.link.state === "resolved_note").length;
  const found = byTitle.length > 0;
  const mergedEdge = mergeAuthorities(edge);
  const content = {
    found,
    citation: cited,
    et_seq_requested: /\bet\s+seq\b/i.test(raw),
    section_in_stored_code: stored.rows.length === 1,
    section_page: stored.rows.length === 1 ? page : null,
    table: { name: tableTitle(cat), edition: cat.edition, revised_as_of: cat.revisedAsOf },
    cfr_parts_citing_this_section: byTitle,
    printed_as_note_to_this_section: notes,
    printed_as_range_or_et_seq_at_this_section: mergedEdge.slice(0, LIST_CAP).map((m) => ({
      printed_as: m.citation,
      cfr_titles: m.cfrTitles,
      table_pages: m.pages,
      rows: edge
        .filter((r) => `${r.category}|${r.heading}|${r.authority}` === m.key)
        .map((r) => ({ cfr_title: r.cfr.title, parts_as_printed: r.cfr.partsText.slice(0, 600) })),
    })),
    note: found
      ? `${CAVEAT} Ranges and "et seq." entries are not expanded: the rows listed separately begin or end at this section, and the table does not say which sections inside the range each part cites.`
      : `The table lists no CFR part under this exact section. ${CAVEAT}${mergedEdge.length ? ' Rows printed as a range or "et seq." at this section are listed separately.' : ""}`,
    source_url: pdf,
  };
  return {
    content: clip(JSON.stringify(content)),
    sources: [
      ...(pdf ? [{ title: tableTitle(cat), url: pdf, internal: false }] : []),
      ...(stored.rows.length === 1
        ? [{ title: `${cited} in the workspace`, url: page, internal: true }]
        : []),
    ],
    label: "Looked up CFR parts citing a statute",
    detail: found
      ? `${cited} · ${byTitle.reduce((n, g) => n + g.parts.length + g.parts_not_listed_here, 0)} CFR parts in ${byTitle.length} title${byTitle.length === 1 ? "" : "s"}`
      : `${cited} · no CFR part under this exact section`,
  };
}

const group = (items: MergedAuthority[]) =>
  items.slice(0, LIST_CAP).map((m) => ({ printed_as: m.citation, table_pages: m.pages }));

async function listAuthoritiesForCfrPart(input: Record<string, unknown>): Promise<ToolOutcome> {
  const raw = str(input["citation"], 200);
  let title = "";
  let part = "";
  let derivedFrom: string | null = null;
  const parsed = raw ? parseCitation(raw) : null;
  if (parsed?.part) {
    title = parsed.title;
    part = parsed.part;
  } else if (parsed?.section) {
    // "21 CFR 314.80" names a section; its part is the number before the dot (a part is never guessed beyond that).
    title = parsed.title;
    part = parsed.section.split(".")[0]!;
    derivedFrom = `${parsed.title} CFR ${parsed.section}`;
  } else if (
    typeof input["title"] === "number" &&
    Number.isInteger(input["title"]) &&
    typeof input["part"] === "string"
  ) {
    title = String(input["title"]);
    part = input["part"].trim().replace(/^part\s+/i, "");
  }
  if (!CFR_TITLE.test(title) || !CFR_PART.test(part) || !PART_TOKEN.test(part))
    throw new Error("give a CFR part citation such as 21 CFR part 314 (title and part number)");
  const cited = `${title} CFR part ${part}`;
  const cat = await catalog();
  if (!cat.ready) return unavailable(cited);
  const [r, partRow] = await Promise.all([
    restGet<unknown[]>(
      `corpus_records?${AUTHORITY_SELECT}&dataset=eq.${AUTHORITIES_DATASET}&filters=cs.${cs({ cfr_part: [`${title}:${part}`] })}&order=ordinal.asc&limit=500`,
    ),
    restGet<{ id: unknown; title: unknown }[]>(
      `corpus_records?select=id,title&dataset=eq.${SECTIONS_DATASET}&id=eq.${enc(partRecordId(title, part))}&limit=1`,
    ),
  ]);
  const rows = parseAuthorityRows(r.rows).rows;
  const merged = mergeAuthorities(rows);
  const sec = sectionAuthorities(merged);
  const ids = [
    ...new Set(sec.statutes.map((m) => m.link.id).filter((x): x is string => !!x)),
  ].slice(0, 300);
  const headings = new Map<string, { citation: string; heading: string; status: string }>();
  for (let i = 0; i < ids.length; i += 120) {
    const chunk = ids.slice(i, i + 120);
    const s = await restGet<{ id: unknown; c: unknown }[]>(
      `corpus_records?select=id,c:item->cells&dataset=eq.us_code_sections&id=${enc(inList(chunk))}&limit=${chunk.length}`,
    );
    for (const x of s.rows) {
      const c = (x.c && typeof x.c === "object" ? x.c : {}) as Record<string, unknown>;
      if (typeof x.id === "string")
        headings.set(x.id, {
          citation: str(c["citation"], 120),
          heading: str(c["heading"], 300),
          status: str(c["status"], 40),
        });
    }
  }
  const pdf = tablePdf(cat.edition);
  const partStored = partRow.rows.length === 1;
  const partPage = `/law/cfr/${title}/part/${enc(part)}`;
  const found = merged.length > 0;
  const content = {
    found,
    citation: cited,
    part_derived_from_section: derivedFrom,
    part_in_stored_ecfr: partStored,
    part_heading: partStored
      ? partHeading(
          typeof partRow.rows[0]!.title === "string" ? (partRow.rows[0]!.title as string) : null,
        )
      : null,
    part_page: partStored ? partPage : null,
    table: { name: tableTitle(cat), edition: cat.edition, revised_as_of: cat.revisedAsOf },
    us_code_sections: sec.statutes.slice(0, LIST_CAP).map((m) => {
      const h = m.link.id ? headings.get(m.link.id) : undefined;
      return {
        printed_as: m.citation,
        printed_as_note: m.link.state === "resolved_note",
        in_stored_code: m.link.state === "resolved" || m.link.state === "resolved_note",
        stored_citation: h?.citation || null,
        heading: h?.heading || null,
        status: h?.status || null,
        page:
          m.link.title && m.link.key ? `/law/uscode/${enc(m.link.title)}/${enc(m.link.key)}` : null,
        table_pages: m.pages,
      };
    }),
    us_code_ranges_et_seq_and_other_forms_as_printed: group(sec.rangesAndOther),
    statutes_at_large: group(sec.statutesAtLarge),
    public_laws: group(sec.publicLaws),
    presidential_documents: group(sec.presidential),
    row_counts: { table_rows: rows.length, authorities: merged.length },
    note: found
      ? `${CAVEAT} Ranges and "et seq." entries are listed as printed and are not expanded into sections.`
      : `The table lists no authority for this exact part. ${CAVEAT}`,
    source_url: pdf,
  };
  const n = (x: unknown[]) => x.length;
  return {
    content: clip(JSON.stringify(content)),
    sources: [
      ...(pdf ? [{ title: tableTitle(cat), url: pdf, internal: false }] : []),
      ...(partStored
        ? [{ title: `${cited} in the workspace`, url: partPage, internal: true }]
        : []),
    ],
    label: "Looked up the authorities for a CFR part",
    detail: found
      ? `${cited} · ${n(sec.statutes)} U.S. Code sections, ${n(sec.rangesAndOther)} ranges or et seq., ${n(sec.statutesAtLarge) + n(sec.publicLaws) + n(sec.presidential)} other`
      : `${cited} · no authority listed`,
  };
}

export const AUTHORITY_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  list_cfr_parts_citing_usc: listCfrPartsCitingUsc,
  list_authorities_for_cfr_part: listAuthoritiesForCfrPart,
};
