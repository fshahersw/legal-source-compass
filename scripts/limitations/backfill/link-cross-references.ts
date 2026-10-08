/**
 * Cross-reference linking for Time Limits rules: tolling and repose notes → the publisher's current code text.
 *
 * Every tolling and repose note on a rule carries a citation (e.g. "K.S.A. § 60-515(a)"). This pass resolves
 * that citation to the exact section(s) the full-code intake landed for the state (reviewed states only,
 * projection on), records the section's native id and text hash, and checks that every period or age the note
 * states ("one year", "eight years", "under 18") is printed in that section's current text.
 *
 * What it records, per note:
 *   sections      the exact section(s) the citation resolves to (nativeId + SHA-256 of heading + text)
 *   termCheck     all_present | not_all_present | none_to_check
 *   terms         the period/age terms taken from the note, each with found: true|false
 *
 * What it never does:
 *   * It never rewrites a note. A note whose terms are not all found is linked and marked for review; the
 *     builder shows that state, a person compares.
 *   * It never resolves across states, never falls back to a "nearest" section, never uses a secondary
 *     reproduction: `publicStatuteSections` returns exact matches in the publisher's own text or nothing.
 *   * A citation that names a court opinion beside the statute is resolved on the statute part only; the
 *     opinion is not a code section.
 *
 * Reads:   LIM_BUNDLE (rules.json)
 * Writes:  LIM_XREF_LINKS (default /tmp/lim/work/cross-reference-links.json)
 * Requires EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY (read-only public RPCs).
 * Options: --states=KS,ND  --limit=N  --rules=id1,id2
 *
 * Run from the project root: bun scripts/limitations/backfill/link-cross-references.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rpcPost } from "@/lib/external/rest.server";
import { exactCitationPaths } from "@/lib/law/exactCitationPath";
import { publicStatuteSections } from "@/lib/law/stateCodeCatalog.server";
import type { LimitationRule } from "@/lib/limitations/types";
import {
  extractPeriodTerms,
  termPresent,
  type CrossReferenceTermCheck,
} from "@/lib/limitations/backfill/crossReferenceTerms";

const bundle = process.env["LIM_BUNDLE"] ?? "/tmp/lim/data/limitations";
const outFile = process.env["LIM_XREF_LINKS"] ?? "/tmp/lim/work/cross-reference-links.json";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const onlyStates = arg("states") ? new Set(arg("states")!.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) : null;
const onlyRules = arg("rules") ? new Set(arg("rules")!.split(",").filter(Boolean)) : null;
const limit = arg("limit") ? Number(arg("limit")) : Infinity;
/** Longest stored section text accepted as one section (the longest real one seen, La. R.S. 40:1231.8, is 42 KB). */
const OVERSIZED_SECTION_BYTES = 50_000;

export type CrossReferenceLink = {
  ruleId: string;
  kind: "tolling" | "repose";
  index: number;
  citation: string;
  status:
    | "linked"
    | "no_exact_section"
    | "state_not_projected"
    | "no_statute_citation"
    | "section_repealed_or_stub"
    | "section_text_oversized";
  checkedAt: string;
  /** How many sections the citation names (exact paths parsed from it); `sections` holds those that resolved. */
  sectionsNamed: number;
  sections: { nativeId: string; textSha256: string; sourceUrl: string | null; heading: string | null; textBytes: number }[];
  /** Sections that resolved but hold only a repeal or placeholder stub; kept out of `sections`, listed for review. */
  stubsExcluded: { nativeId: string; heading: string | null; text: string }[];
  termCheck: CrossReferenceTermCheck | null;
  terms: { term: string; found: boolean; foundIn?: string }[];
  intakeRunId: string | null;
};

type CoverageRow = {
  jurisdiction?: string;
  public_projection_allowed?: boolean;
  last_run?: string | null;
};

/** Character references an intake may leave undecoded are rendering, not words (same table as the code recheck). */
const CP1252: Record<number, string> = {
  130: "\u201a", 132: "\u201e", 133: "\u2026", 145: "\u2018", 146: "\u2019", 147: "\u201c", 148: "\u201d",
  149: "\u2022", 150: "\u2013", 151: "\u2014", 153: "\u2122", 160: "\u00a0",
};
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", sect: "\u00a7", ndash: "\u2013",
  mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", para: "\u00b6", hellip: "\u2026",
};
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code)) return whole;
      if (CP1252[code]) return CP1252[code];
      return code >= 32 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The statute half of a citation. A note may cite "Ind. Code § 34-11-5-1; Alldredge v. Good Samaritan Home
 * (Ind. 2014)" or "Miss. Code Ann. § 15-1-63 (as quoted in Darville v. Mejia …)": only the part before the
 * opinion is a code citation. Nothing is added; a citation without a section sign or section number is skipped.
 */
function statutePart(citation: string): string | null {
  let text = citation.split(/;\s*(?=[A-Z][\w.'’-]+(?:\s+[\w.'’-]+)*\s+v\.\s)/)[0] ?? citation;
  text = text.replace(/\s*\((?:as\s+)?(?:quoted|cited|applied)\s+in\b[^)]*\)\s*$/i, "");
  text = text.replace(/\s*\((?:\d{4}|[A-Z][a-z.]+\s+\d{4})\)\s*$/, "");
  if (!/\d/.test(text)) return null;
  if (/\bv\.\s/.test(text)) return null;
  return text.trim();
}

/** True when a section's text is only a repeal or placeholder stub rather than operative language. */
export function isStub(heading: string | null, text: string): boolean {
  const body = text.replace(/\s+/g, " ").trim();
  const withoutHeading = heading ? body.replace(heading.replace(/\s+/g, " ").trim(), "").trim() : body;
  if (/\b(?:REPEALED|RESERVED|RENUMBERED|TRANSFERRED|OMITTED)\b/i.test(body) && body.length <= 160) return true;
  return withoutHeading.replace(/^§?\s*[\w.-]+\.?\s*/, "").length < 20;
}

async function coverage(): Promise<Map<string, CoverageRow>> {
  const payload = await rpcPost<{ states?: CoverageRow[] }>("corpus_publisher_code_coverage_v2", { p_recount: false });
  const map = new Map<string, CoverageRow>();
  for (const row of payload.states ?? []) {
    const state = row.jurisdiction?.toUpperCase();
    if (state && (!map.has(state) || row.public_projection_allowed === true)) map.set(state, row);
  }
  return map;
}

const sectionCache = new Map<string, Awaited<ReturnType<typeof publicStatuteSections>>>();
async function sectionsFor(state: string, citation: string) {
  const key = `${state}|${citation}`;
  if (!sectionCache.has(key)) {
    for (let attempt = 0; ; attempt++) {
      try {
        sectionCache.set(key, await publicStatuteSections(state, citation));
        break;
      } catch (error) {
        if (attempt >= 3) {
          console.error(`section lookup failed for ${key}: ${String(error)}`);
          sectionCache.set(key, []);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
    }
  }
  return sectionCache.get(key)!;
}

async function main() {
  const rules = (JSON.parse(readFileSync(join(bundle, "rules.json"), "utf8")).rules as LimitationRule[]).filter(
    (r) => r.provenance && (!onlyStates || onlyStates.has(r.jurisdiction)) && (!onlyRules || onlyRules.has(r.id)),
  );
  const cov = await coverage();
  const checkedAt = new Date().toISOString();
  const links: CrossReferenceLink[] = [];
  const tally: Record<string, number> = {};
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  let n = 0;

  for (const rule of rules) {
    if (links.length >= limit) break;
    const state = rule.jurisdiction.toUpperCase();
    const row = cov.get(state);
    const projected = row?.public_projection_allowed === true;
    const notes: { kind: "tolling" | "repose"; index: number; citation: string; text: string }[] = [
      ...rule.provenance!.tolling.map((t, index) => ({ kind: "tolling" as const, index, citation: t.citation, text: t.text })),
      // A repose note's period lives in `years`, its start in `trigger`; both are checked against the section.
      ...rule.provenance!.repose.map((r, index) => ({
        kind: "repose" as const,
        index,
        citation: r.citation,
        text: `${r.years} years from ${r.trigger}`,
      })),
    ];
    for (const note of notes) {
      const base = {
        ruleId: rule.id,
        kind: note.kind,
        index: note.index,
        citation: note.citation,
        checkedAt,
        sectionsNamed: 0,
        sections: [] as CrossReferenceLink["sections"],
        stubsExcluded: [] as CrossReferenceLink["stubsExcluded"],
        termCheck: null as CrossReferenceTermCheck | null,
        terms: [] as CrossReferenceLink["terms"],
        intakeRunId: row?.last_run ?? null,
      };
      if (!projected) {
        links.push({ ...base, status: "state_not_projected" });
        bump(`state_not_projected:${state}`);
        continue;
      }
      const statute = statutePart(note.citation);
      if (!statute) {
        links.push({ ...base, status: "no_statute_citation" });
        bump("no_statute_citation");
        continue;
      }
      const sectionsNamed = exactCitationPaths(state, statute)?.length ?? 0;
      const resolved = (await sectionsFor(state, statute)).filter((s) => s.text && s.text.trim().length > 0);
      if (!resolved.length) {
        links.push({ ...base, sectionsNamed, status: "no_exact_section" });
        bump("no_exact_section");
        continue;
      }
      // A section whose whole text is a repeal or placeholder stub ("§2902. Regulations (REPEALED)") is not the
      // provision the note describes, even when its number matches: it is withheld and listed for review.
      const stubs = resolved.filter((s) => isStub(s.heading ?? null, s.text ?? ""));
      // A stored "section" far longer than any statute section (a PDF split that ran on into the following
      // sections, e.g. WY 34.1-2-725 at 106 KB) would make every term check pass; it is withheld for review.
      const oversized = resolved.filter((s) => !stubs.includes(s) && (s.text ?? "").length > OVERSIZED_SECTION_BYTES);
      if (oversized.length) {
        links.push({
          ...base,
          sectionsNamed,
          status: "section_text_oversized",
          stubsExcluded: oversized.map((s) => ({ nativeId: s.nativeId, heading: s.heading ?? null, text: `${(s.text ?? "").length} bytes` })),
        });
        bump("section_text_oversized");
        continue;
      }
      const sections = resolved.filter((s) => !stubs.includes(s));
      const stubsExcluded = stubs.map((s) => ({ nativeId: s.nativeId, heading: s.heading ?? null, text: (s.text ?? "").slice(0, 200) }));
      if (!sections.length) {
        links.push({ ...base, sectionsNamed, stubsExcluded, status: "section_repealed_or_stub" });
        bump("section_repealed_or_stub");
        continue;
      }
      const body = sections.map((s) => decodeEntities(`${s.heading ?? ""}\n${s.text ?? ""}`)).join("\n");
      const terms = extractPeriodTerms(note.text);
      const checked: CrossReferenceLink["terms"] = terms.map((term) => ({ term, found: termPresent(body, term) }));
      // A term the cited section does not print may come from another section the note itself names
      // ("subject to the six-year cap in 5-230"). Only sections the note cites in the same state are read,
      // and the term is recorded as found *there*, never silently as found in the cited section.
      if (checked.some((t) => !t.found)) {
        const own = new Set(sections.map((s) => s.nativeId));
        const others = exactCitationPaths(state, note.text)?.length
          ? (await sectionsFor(state, note.text)).filter(
              (s) => !own.has(s.nativeId) && s.text && !isStub(s.heading ?? null, s.text) && s.text.length <= OVERSIZED_SECTION_BYTES,
            )
          : [];
        for (const other of others) {
          const otherBody = decodeEntities(`${other.heading ?? ""}\n${other.text ?? ""}`);
          for (const t of checked) if (!t.found && termPresent(otherBody, t.term)) Object.assign(t, { found: true, foundIn: other.nativeId });
        }
      }
      const termCheck: CrossReferenceTermCheck =
        checked.length === 0 ? "none_to_check" : checked.every((t) => t.found) ? "all_present" : "not_all_present";
      links.push({
        ...base,
        status: "linked",
        sectionsNamed,
        stubsExcluded,
        sections: sections.map((s) => ({
          nativeId: s.nativeId,
          textSha256: sha256(`${s.heading ?? ""}\n${s.text ?? ""}`),
          sourceUrl: s.sourceUrl,
          heading: s.heading ?? null,
          textBytes: (s.text ?? "").length,
        })),
        termCheck,
        terms: checked,
      });
      bump(`linked:${termCheck}`);
    }
    n++;
    if (n % 50 === 0) console.log(`rules ${n}/${rules.length} · notes ${links.length} · ${JSON.stringify(tally)}`);
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ checkedAt, bundle, tally, links }, null, 1));
  console.log(JSON.stringify({ rules: n, notes: links.length, tally }));
}

await main();
