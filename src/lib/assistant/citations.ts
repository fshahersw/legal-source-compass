/**
 * Deterministic extraction of full legal citations from text: case reporters (U.S., S. Ct., F.3d, F. Supp., regional and
 * state reporters, WL and LEXIS numbers), U.S.C., C.F.R., Statutes at Large, public laws and Federal Register pages. Short
 * forms (Id., supra, "576 U.S. at 650") are not citations to check and are skipped. No lookup happens here.
 */
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

/** Canonical reporter abbreviations; spacing between the parts is optional when matching ("F. Supp. 2d" = "F.Supp.2d"). */
const REPORTERS = [
  // Federal
  "U.S.",
  "S. Ct.",
  "L. Ed.",
  "L. Ed. 2d",
  "F.",
  "F.2d",
  "F.3d",
  "F.4th",
  "F. Supp.",
  "F. Supp. 2d",
  "F. Supp. 3d",
  "F. App'x",
  "Fed. App'x",
  "Fed. Appx.",
  "F. Appx.",
  "F. Cas.",
  "F.R.D.",
  "B.R.",
  "Fed. Cl.",
  "Cl. Ct.",
  "Ct. Cl.",
  "Ct. Int'l Trade",
  "C.C.P.A.",
  "T.C.",
  "B.T.A.",
  "Vet. App.",
  "M.J.",
  "C.M.A.",
  "C.M.R.",
  "App. D.C.",
  "U.S. App. D.C.",
  "WL",
  "U.S. LEXIS",
  "U.S. App. LEXIS",
  "U.S. Dist. LEXIS",
  "Bankr. LEXIS",
  // Regional
  "A.",
  "A.2d",
  "A.3d",
  "P.",
  "P.2d",
  "P.3d",
  "N.E.",
  "N.E.2d",
  "N.E.3d",
  "N.W.",
  "N.W.2d",
  "S.E.",
  "S.E.2d",
  "S.W.",
  "S.W.2d",
  "S.W.3d",
  "So.",
  "So. 2d",
  "So. 3d",
  "Cal. Rptr.",
  "Cal. Rptr. 2d",
  "Cal. Rptr. 3d",
  "N.Y.S.",
  "N.Y.S.2d",
  "N.Y.S.3d",
  "Ill. Dec.",
  // State official reporters (most cited)
  "Cal.",
  "Cal. 2d",
  "Cal. 3d",
  "Cal. 4th",
  "Cal. 5th",
  "Cal. App.",
  "Cal. App. 2d",
  "Cal. App. 3d",
  "Cal. App. 4th",
  "Cal. App. 5th",
  "N.Y.",
  "N.Y.2d",
  "N.Y.3d",
  "A.D.",
  "A.D.2d",
  "A.D.3d",
  "Misc.",
  "Misc. 2d",
  "Misc. 3d",
  "Ill.",
  "Ill. 2d",
  "Ill. App.",
  "Ill. App. 2d",
  "Ill. App. 3d",
  "Mass.",
  "Mass. App. Ct.",
  "Pa.",
  "Pa. Super.",
  "Pa. Commw.",
  "N.J.",
  "N.J. Super.",
  "Wash.",
  "Wash. 2d",
  "Wash. App.",
  "Ohio St.",
  "Ohio St. 2d",
  "Ohio St. 3d",
  "Ohio App.",
  "Ohio App. 2d",
  "Ohio App. 3d",
  "Mich.",
  "Mich. App.",
  "Wis.",
  "Wis. 2d",
  "Minn.",
  "Md.",
  "Md. App.",
  "Conn.",
  "Conn. App.",
  "Va.",
  "Va. App.",
  "Ga.",
  "Ga. App.",
  "N.C.",
  "N.C. App.",
  "S.C.",
  "Ariz.",
  "Ariz. App.",
  "Colo.",
  "Or.",
  "Or. App.",
  "Haw.",
  "Kan.",
  "Kan. App. 2d",
  "Mo.",
  "Neb.",
  "Nev.",
  "N.M.",
  "Okla.",
  "Vt.",
  "W. Va.",
  "Wyo.",
  "Ala.",
  "Ark.",
  "Del.",
  "Del. Ch.",
  "Fla.",
  "Ind.",
  "Ind. App.",
  "Ky.",
  "La.",
  "Me.",
  "Miss.",
  "Mont.",
  "N.D.",
  "N.H.",
  "R.I.",
  "S.D.",
  "Tenn.",
  "Tex.",
  "Tex. Crim.",
];

function reporterPattern(r: string): string {
  const tokens = r.split(" ").flatMap((chunk) => chunk.match(/[^.]+\.|[^.]+$/g) ?? [chunk]);
  return tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]"))
    .join("\\s?");
}

const REPORTER_ALT = [...REPORTERS]
  .sort((a, b) => b.length - a.length)
  .map(reporterPattern)
  .join("|");

const CASE_RE = new RegExp(
  String.raw`(?<![\w.§-])(\d{1,4})\s+(${REPORTER_ALT})\s+(\d{1,7})(?![\w])`,
  "g",
);

// U.S.C. sections: "1983", "78j", "2000e-2", "1320a-7b" (a hyphen follows letters; digit-hyphen-digit is a range).
const USC_SEC = String.raw`\d{1,6}(?:[a-zA-Z]{1,4}(?:-\d{1,4}[a-zA-Z]{0,4})*)?`;
// C.F.R. section after the part: "9", "10b-5", "401(k)-1", never swallowing a following "-63.15" range end.
const CFR_SEC = String.raw`\d{1,6}[a-zA-Z]{0,4}(?:(?:\([a-z0-9]{1,4}\))?-\d{1,4}[a-zA-Z]{0,4}(?!\.\d))*`;
// Subsections are written without spaces ("(a)(2)"); "§ 1983 (2018)" is a year, not a subsection.
const SUBS = String.raw`(?:\([a-zA-Z0-9]{1,5}\))*`;
const RANGE = String.raw`\s*(?:[-–—]|\s(?:to|through)\s)\s*`;
const LIST_SEP = String.raw`\s*(?:,\s*(?:and\s+|or\s+|&\s*)?|(?:and|or|&)\s+)`;
// A list item never starts the next citation ("§§ 1983, 1985 and 18 U.S. 1": the "18" belongs to the case).
const NOT_NEXT_CITE = String.raw`(?![\d\s]*(?:U\.?\s?S\.?\s?C|C\.?\s?F\.?\s?R|Stat\.|Fed\.\s?Reg|F\.\s?R\.|FR\b|(?:${REPORTER_ALT})\s+\d))`;

const USC_ITEM = `${USC_SEC}${SUBS}(?:${RANGE}${USC_SEC}${SUBS})?`;
const USC_RE = new RegExp(
  String.raw`(?<![\w.])(\d{1,2})\s*U\.?\s?S\.?\s?(?:Code|C\.?(?:\s?A\.?|\s?S\.?)?)(?![A-Za-z])\s*(§§|§|[Ss]ecs?\.|[Ss]ections?|[Ss]ec\.)?\s*(${USC_ITEM}(?:${LIST_SEP}${NOT_NEXT_CITE}${USC_ITEM})*)`,
  "g",
);
const USC_ITEM_RE = new RegExp(
  String.raw`(${USC_SEC})(${SUBS})(?:${RANGE}(${USC_SEC})(${SUBS}))?`,
  "g",
);

const CFR_NUM = String.raw`\d{1,4}(?:\.${CFR_SEC})?`;
const CFR_ITEM = `${CFR_NUM}${SUBS}(?:${RANGE}${CFR_NUM}${SUBS})?`;
const CFR_RE = new RegExp(
  String.raw`(?<![\w.])(\d{1,2})\s*C\.?\s?F\.?\s?R\.?(?![A-Za-z])\s*(§§|§|[Ss]ecs?\.|[Ss]ections?|[Pp]arts?|[Pp]ts?\.)?\s*(${CFR_ITEM}(?:${LIST_SEP}${NOT_NEXT_CITE}${CFR_ITEM})*)`,
  "g",
);
const CFR_ITEM_RE = new RegExp(
  String.raw`(\d{1,4})(?:\.(${CFR_SEC}))?(${SUBS})(?:${RANGE}(\d{1,4})(?:\.(${CFR_SEC}))?(${SUBS}))?`,
  "g",
);

const STAT_RE = /(?<![\w.])(\d{1,3})\s+Stat\.\s+(\d{1,5})(?![\w])/g;
const PUBL_RE =
  /(?<![\w.])(?:Pub(?:lic)?\.?\s*L(?:aw)?\.?|P\.\s?L\.)\s*(?:No\.?\s*)?(\d{1,3})\s*[-–‑]\s*(\d{1,4})(?![\w])/g;
const FR_RE =
  /(?<![\w.])(\d{1,3})\s+(?:Fed\.\s?Reg\.|F\.\s?R\.|FR)(?![A-Za-z.])\s+(\d{1,3}(?:,\d{3})+|\d{1,6})(?![\w])/g;

const PIN_RE = /^,\s*((?:at\s+)?\d{1,7}(?:\s*[-–—]\s*\d{1,7})?(?:\s*n\.\s*\d{1,3})?)/;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const subsOf = (s: string | undefined) => (s ? s.replace(/\s+/g, "") : "");
/** Lists ("§§ 1331, 1332 and 1367", "parts 210 and 211") only follow a plural label; after "§" only the first item counts. */
const plural = (label: string | undefined) =>
  !!label && /^(§§|secs\.|sections|parts|pts\.)$/i.test(label);

/** The part of a statutory match actually used: up to the last list item taken, so nothing after it is swallowed. */
function usedSpan(m: RegExpExecArray, items: RegExpExecArray[]) {
  const bodyStart = m[0].length - m[3]!.length;
  const last = items.at(-1);
  const length = last ? bodyStart + last.index + last[0].length : m[0].length;
  return { written: squash(m[0].slice(0, length)), end: m.index + length };
}

type Raw = Omit<ExtractedCitation, "group">;

function caseCitations(text: string): Raw[] {
  const out: Raw[] = [];
  for (const m of text.matchAll(CASE_RE)) {
    const volume = Number(m[1]);
    const page = Number(m[3]);
    // Typographic apostrophes ("F. App’x") are looked up in the plain form the reporter tables use.
    const reporter = squash(m[2]!).replace(/’/g, "'");
    const written = squash(m[0]);
    out.push({
      kind: "case",
      text: written,
      key: `case:${volume} ${reporter.replace(/\s+/g, "").replace(/’/g, "'")} ${page}`,
      normalized: `${volume} ${reporter} ${page}`,
      start: m.index,
      end: m.index + m[0].length,
      pin: null,
      volume,
      reporter,
      page,
    });
  }
  return out;
}

function uscCitations(text: string): Raw[] {
  const out: Raw[] = [];
  for (const m of text.matchAll(USC_RE)) {
    const title = Number(m[1]);
    const items = [...m[3]!.matchAll(USC_ITEM_RE)].slice(0, plural(m[2]) ? 20 : 1);
    const { written, end } = usedSpan(m, items);
    for (const item of items) {
      const section = item[1]!;
      const sectionEnd = item[3] ?? null;
      const pin = subsOf(item[2]) || subsOf(item[4]) || null;
      out.push({
        kind: "usc",
        text: written,
        key: `usc:${title}:${section}${sectionEnd ? `:${sectionEnd}` : ""}`,
        normalized: sectionEnd
          ? `${title} U.S.C. §§ ${section}–${sectionEnd}`
          : `${title} U.S.C. § ${section}`,
        start: m.index,
        end,
        pin,
        title,
        section,
        sectionEnd,
      });
    }
  }
  return out;
}

function cfrCitations(text: string): Raw[] {
  const out: Raw[] = [];
  for (const m of text.matchAll(CFR_RE)) {
    const title = Number(m[1]);
    const items = [...m[3]!.matchAll(CFR_ITEM_RE)].slice(0, plural(m[2]) ? 20 : 1);
    const { written, end: spanEnd } = usedSpan(m, items);
    for (const item of items) {
      const part = Number(item[1]);
      const section = item[2] ?? null;
      const endPart = item[4] ? Number(item[4]) : null;
      const endSection = item[5] ?? null;
      const pin = subsOf(item[3]) || subsOf(item[6]) || null;
      if (section) {
        const end = endPart !== null && endSection ? `${endPart}.${endSection}` : null;
        out.push({
          kind: "cfr",
          text: written,
          key: `cfr:${title}:${part}.${section}${end ? `:${end}` : ""}`,
          normalized: end
            ? `${title} C.F.R. §§ ${part}.${section}–${end}`
            : `${title} C.F.R. § ${part}.${section}`,
          start: m.index,
          end: spanEnd,
          pin,
          title,
          part,
          section,
          sectionEnd: end,
        });
      } else {
        // "21 C.F.R. Part 11", "21 CFR 11" and "parts 210-211" name whole parts.
        const parts =
          endPart !== null && endPart > part && endPart - part <= 1 ? [part, endPart] : [part];
        const range = endPart !== null && endPart - part > 1 ? endPart : null;
        for (const p of parts)
          out.push({
            kind: "cfr",
            text: written,
            key: `cfr-part:${title}:${p}${range ? `:${range}` : ""}`,
            normalized: range ? `${title} C.F.R. parts ${p}–${range}` : `${title} C.F.R. part ${p}`,
            start: m.index,
            end: spanEnd,
            pin,
            title,
            part: p,
            sectionEnd: range ? String(range) : null,
          });
      }
    }
  }
  return out;
}

function simpleCitations(text: string): Raw[] {
  const out: Raw[] = [];
  for (const m of text.matchAll(STAT_RE)) {
    const volume = Number(m[1]);
    const page = Number(m[2]);
    out.push({
      kind: "statute",
      text: squash(m[0]),
      key: `stat:${volume}:${page}`,
      normalized: `${volume} Stat. ${page}`,
      start: m.index,
      end: m.index + m[0].length,
      pin: null,
      volume,
      page,
    });
  }
  for (const m of text.matchAll(PUBL_RE)) {
    const congress = Number(m[1]);
    const law = Number(m[2]);
    out.push({
      kind: "public_law",
      text: squash(m[0]),
      key: `pl:${congress}:${law}`,
      normalized: `Pub. L. No. ${congress}-${law}`,
      start: m.index,
      end: m.index + m[0].length,
      pin: null,
      congress,
      law,
    });
  }
  for (const m of text.matchAll(FR_RE)) {
    const volume = Number(m[1]);
    const page = Number(m[2]!.replace(/,/g, ""));
    out.push({
      kind: "federal_register",
      text: squash(m[0]),
      key: `fr:${volume}:${page}`,
      normalized: `${volume} Fed. Reg. ${page}`,
      start: m.index,
      end: m.index + m[0].length,
      pin: null,
      volume,
      page,
    });
  }
  return out;
}

/**
 * Every full citation in `text`, in reading order, at most `limit`. Overlapping matches keep the earliest. Case citations
 * get their pin cite and a group shared with parallel citations of the same decision ("576 U.S. 644, 135 S. Ct. 2584").
 */
export function extractCitations(text: string, limit = 200): ExtractedCitation[] {
  const source = text.slice(0, 200_000);
  const all = [
    ...caseCitations(source),
    ...uscCitations(source),
    ...cfrCitations(source),
    ...simpleCitations(source),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Raw[] = [];
  let spanStart = -1;
  let spanEnd = -1;
  for (const c of all) {
    // Items split out of one statutory list share its span; anything else overlapping an earlier match is dropped.
    if (c.start === spanStart && c.end === spanEnd) {
      kept.push(c);
      continue;
    }
    if (c.start < spanEnd) continue;
    kept.push(c);
    spanStart = c.start;
    spanEnd = c.end;
  }
  const out: ExtractedCitation[] = [];
  let group = 0;
  let previousCaseEnd = -1;
  for (let i = 0; i < kept.length; i += 1) {
    const c = kept[i]!;
    const pinned = c.kind === "case" || c.kind === "statute" || c.kind === "federal_register";
    const next = kept.slice(i + 1).find((n) => n.start > c.start);
    // A pin cite is ", 651" or ", 651-52" after the page, unless that number starts the next (parallel) citation.
    const pin = pinned ? PIN_RE.exec(source.slice(c.end, c.end + 40)) : null;
    let tail = c.end;
    let pinText: string | null = c.pin;
    if (pin && !(next && next.start < c.end + pin[0].length)) {
      pinText = pin[1]!.replace(/\s+/g, " ");
      tail = c.end + pin[0].length;
    }
    if (c.kind !== "case") {
      out.push({ ...c, pin: pinText, group: null });
      previousCaseEnd = -1;
      continue;
    }
    const joined = previousCaseEnd >= 0 && /^\s*,\s*$/.test(source.slice(previousCaseEnd, c.start));
    if (!joined) group += 1;
    out.push({ ...c, pin: pinText, group });
    previousCaseEnd = tail;
  }
  return out.slice(0, limit);
}

/** First occurrence of each citation (by key), in order. */
export function uniqueCitations(list: ExtractedCitation[]): ExtractedCitation[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}
