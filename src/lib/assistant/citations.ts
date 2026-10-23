/**
 * Full legal citations of a text for the assistant's cite checker: case reporters (every reporter of the Free Law Project
 * reporters-db, WL and LEXIS numbers, public-domain citations), U.S.C., C.F.R., Statutes at Large, public laws and Federal
 * Register pages. Short forms (Id., supra, "576 U.S. at 650") are not citations to check and are left out. No lookup
 * happens here.
 *
 * Reading is delegated to the canonical citation extractor (src/lib/citations: one pattern table shared with the Python
 * engine, measured on a hand-verified gold set); this module only keeps the shape the cite checker uses.
 */
import { extractCitations as canonical } from "@/lib/citations/engine";
import type { Citation } from "@/lib/citations/types";
import type { CitationKind } from "./protocol";

export type ExtractedCitation = {
  kind: CitationKind;
  /** As written (whitespace collapsed), without the pin cite. Items from one statutory list share the whole list text. */
  text: string;
  /** Stable identity for de-duplication and caching. */
  key: string;
  /** Canonical display form of the one item looked up. */
  normalized: string;
  start: number;
  end: number;
  /** Pin cite or subsection as written, e.g. "651-52" or "(a)(2)". */
  pin: string | null;
  /** Parallel case citations of the same decision share a group number. */
  group: number | null;
  volume?: number;
  reporter?: string;
  page?: number;
  title?: number;
  part?: number;
  /** U.S.C. section, or the C.F.R. section number after the part ("9" in 101.9). */
  section?: string;
  sectionEnd?: string | null;
  congress?: number;
  law?: number;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const int = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : undefined);

/** UTF-16 offsets (what String.slice uses) of the canonical code-point offsets. */
function utf16(text: string): (cp: number) => number {
  if (!/[\uD800-\uDFFF]/.test(text)) return (cp) => cp;
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    at.push(i);
    i += ch.length;
  }
  at.push(i);
  return (cp) => at[cp] ?? i;
}

/**
 * Every full citation in `text`, in reading order, at most `limit`. Case citations carry their pin cite and a group shared
 * with parallel citations of the same decision ("576 U.S. 644, 135 S. Ct. 2584").
 */
export function extractCitations(text: string, limit = 200): ExtractedCitation[] {
  const source = text.slice(0, 200_000);
  const off = utf16(source);
  const out: ExtractedCitation[] = [];
  let group = 0;
  let lastCaseGroup: number | null = null;
  let lastWasCase = false;
  for (const c of canonical(source) as Citation[]) {
    if (c.form !== "full" || !c.key) continue;
    const f = c.fields;
    const start = off(c.start);
    const end = off(c.end);
    const spanText = squash(source.slice(off(c.span[0]), off(c.span[1])));
    const listed = c.span[0] !== c.start || c.span[1] !== c.end;
    // the cite checker's pin is the ", 651" form after the citation; a star page read after "at" ("2021 WL 1234567, at *3")
    // is not one (kept identical to scripts/documents/citations.py, which shares the parity fixture)
    const atPin = /^\s*,?\s*at\s/.test(source.slice(end, end + 12));
    const base = { text: squash(c.matched), key: c.key, normalized: c.normalized, start, end, pin: atPin ? null : c.pin, group: null };
    if (c.kind === "case") {
      if (!(lastWasCase && c.group !== null && c.group === lastCaseGroup)) group += 1;
      lastCaseGroup = c.group;
      lastWasCase = true;
      const reporter = f["reporter"] ?? "";
      const written = f["reporter_as_written"] ?? reporter;
      out.push({
        ...base,
        kind: "case",
        key: `case:${f["volume"]} ${reporter.replace(/\s+/g, "")} ${f["page"]}`,
        normalized: `${f["volume"]} ${written} ${f["page"]}`,
        volume: int(f["volume"]),
        reporter,
        page: int(f["page"]),
        group,
      });
      continue;
    }
    lastWasCase = false;
    if (c.kind === "usc") {
      if (c.key.startsWith("usc-ch:")) continue; // a Code chapter is not a provision to check
      out.push({
        ...base, kind: "usc", text: listed ? spanText : base.text, start: listed ? off(c.span[0]) : start, end: listed ? off(c.span[1]) : end,
        title: int(f["title"]), section: f["section"], sectionEnd: f["section_end"] ?? null,
      });
    } else if (c.kind === "cfr" || c.kind === "cfr_part") {
      out.push({
        ...base, kind: "cfr", text: listed ? spanText : base.text, start: listed ? off(c.span[0]) : start, end: listed ? off(c.span[1]) : end,
        title: int(f["title"]), part: int(f["part"]), ...(c.kind === "cfr" ? { section: f["section"] } : {}), sectionEnd: f["section_end"] ?? null,
      });
    } else if (c.kind === "statutes_at_large") {
      out.push({ ...base, kind: "statute", volume: int(f["volume"]), page: int(f["page"]) });
    } else if (c.kind === "public_law") {
      out.push({ ...base, kind: "public_law", congress: int(f["congress"]), law: int(f["law"]) });
    } else if (c.kind === "federal_register") {
      out.push({ ...base, kind: "federal_register", volume: int(f["volume"]), page: int(f["page"]) });
    }
  }
  return out.slice(0, limit);
}

/** First occurrence of each citation (by key), in order. */
export function uniqueCitations(list: ExtractedCitation[]): ExtractedCitation[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}
