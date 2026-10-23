/**
 * Assistant tool that reads one Code of Federal Regulations section from the corpus's stored eCFR text (ecfr_sections_full):
 * the section's own words with its "current as of" date, the printed notes (authority, source), recent amendments from the
 * change history, and the official eCFR link to cite. Read-only; the citation is parsed and validated before any read, a
 * requested paragraph such as "(c)(1)" is never guessed into the text, and long sections come in windows.
 */
import { restGet } from "@/lib/external/rest.server";
import {
  CFR_IDENTIFIER,
  CFR_TITLE,
  SECTIONS_DATASET,
  VERSIONS_DATASET,
  blocksToText,
  parseNotes,
  parseSectionRow,
  parseVersionsRow,
  partRecordId,
  recordId,
  scopedPartNotes,
} from "@/lib/external/ecfrFull";
import { pageWindow } from "./textWindow";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 30000; // a full 14,000-character text window plus notes and history always fits
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const enc = encodeURIComponent;

export type CfrCitation = { title: string; identifier: string; paragraph: string | null };

/**
 * "21 CFR 314.80", "21 C.F.R. § 314.80(c)(1)", "40 CFR 63.7 " or title + section. A trailing paragraph designation is kept
 * apart (the stored section is read whole); identifiers that carry parentheses themselves (26 CFR 1.1031(a)-1) are tried
 * as written first by the caller.
 */
export function parseCfrCitation(
  citation: string,
  title?: unknown,
  section?: unknown,
): CfrCitation | null {
  let t = "";
  let id = "";
  const m =
    /^\s*(\d{1,2})\s*C\.?\s*F\.?\s*R\.?\s*(?:§{1,2}|sec(?:tion|\.)?|part)?\s*(.+?)\s*$/i.exec(
      citation,
    );
  if (m) {
    t = m[1]!;
    id = m[2]!;
  } else if (typeof title === "number" && Number.isInteger(title) && typeof section === "string") {
    t = String(title);
    id = section.trim().replace(/^§+\s*/, "");
  } else return null;
  if (!CFR_TITLE.test(t) || !/^\d+[A-Za-z]?\.\d/.test(id) || !CFR_IDENTIFIER.test(id)) return null;
  const para = /^(\d+[A-Za-z]?\.[0-9A-Za-z-]+?)((?:\([0-9A-Za-z]{1,6}\))+)$/.exec(id);
  return para
    ? { title: t, identifier: id, paragraph: para[2]! }
    : { title: t, identifier: id, paragraph: null };
}

/** Identifiers to try, in order: as written, then without a trailing paragraph designation. */
export function candidateIdentifiers(c: CfrCitation): string[] {
  if (!c.paragraph) return [c.identifier];
  const base = c.identifier.slice(0, c.identifier.length - c.paragraph.length);
  return [c.identifier, base];
}

async function oneRow(dataset: string, id: string, select: string): Promise<unknown | null> {
  const r = await restGet<unknown[]>(
    `corpus_records?${select}&dataset=eq.${dataset}&id=eq.${enc(id)}&limit=2`,
  );
  return r.rows.length === 1 ? r.rows[0]! : null;
}

export const REGULATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_cfr_section",
    description:
      'Read one Code of Federal Regulations section from the stored official eCFR text by citation (e.g. "21 CFR 314.80" or "29 C.F.R. § 1910.1200(g)"). Returns the section\'s own words with the date the text is current as of, its authority and source notes, recent amendments with Federal Register citations, and the official eCFR link to cite. Use it to quote or rely on a regulation instead of paraphrasing from memory; long sections come in windows (start / find, as for read_web_page).',
    input_schema: {
      type: "object",
      properties: {
        citation: { type: "string", description: "CFR citation, e.g. 40 CFR 63.7." },
        title: { type: "integer", minimum: 1, maximum: 50 },
        section: {
          type: "string",
          description: "Section number when title is given, e.g. 314.80.",
        },
        start: { type: "integer", minimum: 0 },
        find: { type: "string", description: "Word or phrase to locate in the section." },
      },
    },
  },
];

async function readCfrSectionTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const raw = str(input["citation"], 200);
  const c = parseCfrCitation(raw, input["title"], input["section"]);
  if (!c) throw new Error("give a CFR citation such as 21 CFR 314.80 (title and section number)");
  const tried = candidateIdentifiers(c);
  let row: unknown | null = null;
  let identifier = tried[0]!;
  for (const id of tried) {
    row = await oneRow(
      SECTIONS_DATASET,
      recordId(c.title, id),
      "select=id,title,source_url,text,detail",
    );
    if (row) {
      identifier = id;
      break;
    }
  }
  const section = row ? parseSectionRow(row) : null;
  const officialUrl = `https://www.ecfr.gov/current/title-${c.title}/section-${enc(identifier)}`;
  if (!section) {
    return {
      content: JSON.stringify({
        found: false,
        citation: `${c.title} CFR ${c.identifier}`,
        tried: tried.map((id) => `${c.title} CFR ${id}`),
        note: "No stored eCFR text for this section (it may be reserved, an appendix, or not a section number). Use search_ecfr or the official link; do not quote it from memory.",
        official_url: officialUrl,
      }),
      sources: [],
      label: "Looked up a CFR section",
      detail: `${c.title} CFR ${c.identifier} · not in the stored text`,
    };
  }
  const [histRow, partRow] = await Promise.all([
    oneRow(VERSIONS_DATASET, section.id, "select=id,detail"),
    section.part
      ? oneRow(SECTIONS_DATASET, partRecordId(c.title, section.part), "select=id,detail->notes")
      : Promise.resolve(null),
  ]);
  const partNotes = scopedPartNotes(
    parseNotes((partRow as { notes?: unknown } | null)?.notes),
    section.subpart,
  ).filter((n, i, all) => all.findIndex((o) => o.kind === n.kind && o.text === n.text) === i);
  const history = histRow ? parseVersionsRow(histRow) : null;
  const text = blocksToText(section.blocks);
  const window = pageWindow(
    text,
    typeof input["start"] === "number" ? input["start"] : 0,
    str(input["find"], 120),
  );
  const recent = (history?.versions ?? [])
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 5)
    .map((v) => ({
      date: v.date,
      amendment_date: v.amendmentDate,
      substantive: v.substantive,
      removed: v.removed,
      federal_register: v.fr.slice(0, 4),
    }));
  const cite = section.ecfrUrl ?? officialUrl;
  return {
    content: clip(
      JSON.stringify({
        found: true,
        citation: section.citation,
        heading: section.heading,
        reserved: section.reserved,
        current_as_of: section.asOf,
        paragraph_requested: c.paragraph && identifier !== c.identifier ? c.paragraph : null,
        notes: section.notes
          .slice(0, 6)
          .map((n) => ({ label: n.label, text: n.text.slice(0, 1500) })),
        part_notes: partNotes
          .slice(0, 4)
          .map((n) => ({ label: n.label, text: n.text.slice(0, 1500) })),
        qualification: section.qualification,
        recent_amendments: recent,
        versions_recorded: history?.versions.length ?? null,
        official_url: cite,
        ...window,
      }),
    ),
    sources: [{ title: section.citation, url: cite, internal: false }],
    label: "Read a CFR section",
    detail: `${section.citation} · current as of ${section.asOf}`,
  };
}

export const REGULATION_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  read_cfr_section: readCfrSectionTool,
};
