/**
 * Assistant tool that reads one United States Code section from the corpus's stored Office of the Law Revision Counsel text
 * (us_code_sections): the section's own words, its status (repealed, transferred…), source credit and notes, the release
 * point it is current through, the official uscode.house.gov link and the in-app section page. Read-only; the citation is
 * parsed with the section page's own parser before any read, a requested subsection such as "(a)(1)" is never guessed into
 * the text, and long sections (with their notes) come in windows.
 */
import { restGet } from "@/lib/external/rest.server";
import {
  parseCitationQuery,
  parseSection,
  unitId,
  type BodyLine,
  type UscSection,
} from "@/lib/external/usCode.functions";
import { pageWindow } from "./textWindow";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const MAX_RESULT = 30000;
const clip = (s: string, n = MAX_RESULT) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const enc = encodeURIComponent;

export type UscCitation = { title: string; key: string; subsection: string | null };

/** "42 U.S.C. § 1983", "42 USC 2000e-2(a)(1)", "15 U.S.C. 78j(b) et seq." or title + section. */
export function parseUscCitation(
  citation: string,
  title?: unknown,
  section?: unknown,
): UscCitation | null {
  let q = citation.trim().replace(/\s+et\s+seq\.?$/i, "");
  if (!q && typeof title === "number" && Number.isInteger(title) && typeof section === "string")
    q = `${title} U.S.C. ${section.trim().replace(/^§+\s*/, "")}`;
  const sub = /((?:\([0-9A-Za-z]{1,6}\))+)$/.exec(q);
  const parsed = parseCitationQuery(sub ? q.slice(0, q.length - sub[1]!.length) : q);
  return parsed ? { ...parsed, subsection: sub ? sub[1]! : null } : null;
}

const lineText = (l: BodyLine) =>
  "  ".repeat(l.indent) + ("cells" in l ? l.cells.join(" | ") : l.text);

/** The section as one readable document: text, footnotes, source credit, then each note under its heading. */
export function sectionDocument(s: UscSection): string {
  const parts = [s.lines.map(lineText).join("\n")];
  if (s.footnotes.length) parts.push(s.footnotes.map(([m, t]) => `${m} ${t}`).join("\n"));
  if (s.credit) parts.push(`Source credit: ${s.credit}`);
  for (const n of s.notes)
    parts.push(
      [n.group ? `${n.group} — ${n.heading}` : n.heading, ...n.lines.map(lineText)]
        .filter(Boolean)
        .join("\n"),
    );
  return parts.filter((p) => p.trim()).join("\n\n");
}

export const STATUTE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_usc_section",
    description:
      'Read one United States Code section from the stored official text of the Office of the Law Revision Counsel by citation (e.g. "42 U.S.C. § 1983" or "15 USC 78j(b)"). Returns the section\'s own words, its status (repealed, transferred, omitted…), source credit and notes (amendments, effective dates, short titles), the release point and public law it is current through, the official uscode.house.gov link and the section page in this workspace. Use it to quote or rely on a statute instead of paraphrasing from memory; long sections come in windows (start / find search the text and the notes).',
    input_schema: {
      type: "object",
      properties: {
        citation: { type: "string", description: "U.S. Code citation, e.g. 28 U.S.C. 1407." },
        title: { type: "integer", minimum: 1, maximum: 54 },
        section: { type: "string", description: "Section number when title is given, e.g. 1407." },
        start: { type: "integer", minimum: 0 },
        find: { type: "string", description: "Word or phrase to locate in the text or notes." },
      },
    },
  },
];

async function readUscSectionTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  const c = parseUscCitation(str(input["citation"], 200), input["title"], input["section"]);
  if (!c)
    throw new Error("give a U.S. Code citation such as 42 U.S.C. 1983 (title and section number)");
  const r = await restGet<unknown[]>(
    `corpus_records?select=id,text,source_url,u:detail->usc&dataset=eq.us_code_sections&id=eq.${enc(
      unitId(c.title, c.key),
    )}&limit=1`,
  );
  const s = r.rows.length === 1 ? parseSection(r.rows[0]) : null;
  const cited = `${c.title} U.S.C. § ${c.key}${c.subsection ?? ""}`;
  if (!s) {
    return {
      content: JSON.stringify({
        found: false,
        citation: cited,
        note: "No stored U.S. Code section has this number (it may be a note, an appendix section, or not a current section). Use search_corpus or the official site; do not quote it from memory.",
      }),
      sources: [],
      label: "Looked up a U.S. Code section",
      detail: `${cited} · not in the stored Code`,
    };
  }
  const page = `/law/uscode/${enc(s.title)}/${enc(s.key)}`;
  const window = pageWindow(
    sectionDocument(s),
    typeof input["start"] === "number" ? input["start"] : 0,
    str(input["find"], 120),
  );
  return {
    content: clip(
      JSON.stringify({
        found: true,
        citation: s.citation,
        heading: s.heading,
        status: s.status ?? "current",
        subsection_requested: c.subsection,
        current_through: { release_point: s.release, law_date: s.lawDate },
        note_headings: s.notes
          .map((n) => n.heading)
          .filter(Boolean)
          .slice(0, 40),
        official_url: s.url,
        page,
        ...window,
      }),
    ),
    sources: [
      { title: s.citation, url: s.url, internal: false },
      { title: `${s.citation} in the workspace`, url: page, internal: true },
    ],
    label: "Read a U.S. Code section",
    detail: `${s.citation} · release point ${s.release}`,
  };
}

export const STATUTE_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  read_usc_section: readUscSectionTool,
};
