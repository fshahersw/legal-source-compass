/**
 * Pure display helpers for the CourtListener collection panel and the district "at a glance" panel.
 * Nothing here estimates a missing value: unknown stays "Not recorded", and a figure that cannot be
 * computed from stored counts is null.
 */
import type {
  ClbBench,
  ClbCitations,
  ClbCitedCourt,
  ClbClusters,
  ClbDocketYear,
  ClbDockets,
  ClbDuration,
  ClbOpinions,
  ClbOral,
  ClbScotusYear,
  ClbShare,
  ClbSource,
  GlanceMeasure,
} from "@/lib/external/clbCourt.functions";

export const NOT_RECORDED = "Not recorded";

export const fmtInt = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : NOT_RECORDED;

export const fmtDec = (n: number | null | undefined, digits = 1) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : NOT_RECORDED;

/** A percentage; a positive share that would round to zero reads "<0.1%", never "0.0%". */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return NOT_RECORDED;
  if (n > 0 && n < 0.5 * 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`;
  return `${fmtDec(n, digits)}%`;
}

/** The stored share is rounded to one decimal, so a stored 0 beside a positive count is "under 0.1%". */
export function shareText(r: { count: number; sharePct: number | null }): string {
  return r.sharePct === 0 && r.count > 0 ? "<0.1%" : fmtPct(r.sharePct);
}

/** share of `whole` as a percentage, or null when either count is missing or the whole is zero. */
export function shareOf(part: number | null | undefined, whole: number | null | undefined) {
  return typeof part === "number" && typeof whole === "number" && whole > 0
    ? (part / whole) * 100
    : null;
}

/** Axis ticks: thousands separators, compact from 10,000. */
export function tick(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Math.abs(value) >= 10_000
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      )
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// ---------------------------------------------------------------------------------------------------
// Dockets
// ---------------------------------------------------------------------------------------------------

/** "RECAP + Scraper", or the stored flag names; a source mask without flags is shown by its code. */
export function sourceMixLabel(s: Pick<ClbSource, "mask" | "flags">): string {
  return s.flags.length ? s.flags.join(" + ") : `Source code ${s.mask}`;
}

export type YearRow = {
  yr: number;
  /** Axis label: the year, with * when the year ends at the snapshot rather than on December 31. */
  label: string;
  dockets: number;
  civil: number;
  criminal: number;
  other: number;
  terminated: number;
  recap: number;
  partial: boolean;
};

/**
 * A filing year is partial when the data ends inside it. `asOf` is the dataset snapshot (or, without
 * one, the court's latest filing date on record): the last year stops there, not at December 31.
 */
export function isPartialYear(yr: number, asOf: string | null): boolean {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return false;
  return Number(asOf.slice(0, 4)) === yr && asOf.slice(5) < "12-31";
}

/**
 * Dockets by filing year. Civil- and criminal-numbered dockets are counted by the case type in the
 * docket number; every other docket (miscellaneous, magistrate, appeal, no recorded type) is "other".
 * When no year has a civil or criminal number (appellate and opinion-sourced courts) the whole count is
 * "other" and `split` is false, so the chart is one series instead of two empty ones.
 */
export function docketYearRows(years: readonly ClbDocketYear[], asOf: string | null) {
  const split = years.some((y) => y.civil > 0 || y.criminal > 0);
  const rows: YearRow[] = years.map((y) => {
    const partial = isPartialYear(y.yr, asOf);
    return {
      yr: y.yr,
      label: partial ? `${y.yr}*` : String(y.yr),
      dockets: y.dockets,
      civil: split ? y.civil : 0,
      criminal: split ? y.criminal : 0,
      other: split ? y.dockets - y.civil - y.criminal : y.dockets,
      terminated: y.terminated,
      recap: y.recap,
      partial,
    };
  });
  return { rows, split, partialYear: rows.find((r) => r.partial)?.yr ?? null };
}

export function docketRange(d: ClbDockets): string | null {
  const first = d.firstFiled?.slice(0, 4);
  const last = d.lastFiled?.slice(0, 4);
  if (!first || !last) return null;
  return first === last ? first : `${first}–${last}`;
}

/** Share of all dockets that carry a nature-of-suit entry (the shares below it are of that subset). */
export function nosCoverage(d: ClbDockets) {
  return { recorded: d.nosRecorded, total: d.total, sharePct: shareOf(d.nosRecorded, d.total) };
}

export type DurationBar = {
  /** Left edge and width of the p25-p75 box, and the median tick, as percentages of the p90 span. */
  boxLeft: number;
  boxWidth: number;
  medianAt: number;
};

/** Positions on a 0..p90 scale, so the box and tick can be drawn without a chart library. */
export function durationBar(d: ClbDuration): DurationBar | null {
  if (!(d.p90 > 0)) return null;
  const at = (v: number) => Math.min(100, Math.max(0, (v / d.p90) * 100));
  return { boxLeft: at(d.p25), boxWidth: at(d.p75) - at(d.p25), medianAt: at(d.median) };
}

// ---------------------------------------------------------------------------------------------------
// Opinion clusters
// ---------------------------------------------------------------------------------------------------

export type DecadeVoteRow = {
  decade: number;
  label: string;
  withVotes: number;
  unanimous: number;
  fiveFour: number;
  other: number;
  unanimousPct: number;
  fiveFourPct: number;
  otherPct: number;
};

/**
 * Supreme Court Database vote classes by decade, only for decisions with a recorded vote split.
 * Each decade's three classes (unanimous, 5-4, all other splits) add up to its decisions with votes.
 */
export function voteDecades(years: readonly ClbScotusYear[]): DecadeVoteRow[] {
  const byDecade = new Map<number, { withVotes: number; unanimous: number; fiveFour: number }>();
  for (const y of years) {
    if (y.withVotes <= 0) continue;
    const decade = Math.floor(y.yr / 10) * 10;
    const acc = byDecade.get(decade) ?? { withVotes: 0, unanimous: 0, fiveFour: 0 };
    acc.withVotes += y.withVotes;
    acc.unanimous += y.unanimous;
    acc.fiveFour += y.fiveFour;
    byDecade.set(decade, acc);
  }
  return [...byDecade.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([decade, a]) => {
      const other = a.withVotes - a.unanimous - a.fiveFour;
      return {
        decade,
        label: `${decade}s`,
        withVotes: a.withVotes,
        unanimous: a.unanimous,
        fiveFour: a.fiveFour,
        other,
        unanimousPct: (a.unanimous / a.withVotes) * 100,
        fiveFourPct: (a.fiveFour / a.withVotes) * 100,
        otherPct: (other / a.withVotes) * 100,
      };
    });
}

/** The last year with a vote-coded decision, so the chart can say where the vote data stops. */
export function lastVoteYear(years: readonly ClbScotusYear[]): number | null {
  let last: number | null = null;
  for (const y of years) if (y.withVotes > 0 && (last == null || y.yr > last)) last = y.yr;
  return last;
}

export function clusterRange(c: ClbClusters): string | null {
  const first = c.firstFiled?.slice(0, 4);
  const last = c.lastFiled?.slice(0, 4);
  if (!first || !last) return null;
  return first === last ? first : `${first}–${last}`;
}

// ---------------------------------------------------------------------------------------------------
// Oral arguments and bench
// ---------------------------------------------------------------------------------------------------

export function transcriptShare(o: ClbOral): number | null {
  return shareOf(o.withTranscript, o.total);
}

/** The bench facts as separate phrases; every phrase names what it counts. */
export function benchPhrases(b: ClbBench): string[] {
  const parts = [
    `${fmtInt(b.positions)} judicial position${b.positions === 1 ? "" : "s"} on record`,
    b.active != null ? `${fmtInt(b.active)} with no recorded end or death date` : null,
    b.persons != null
      ? `held by ${fmtInt(b.persons)} ${b.persons === 1 ? "person" : "people"}`
      : null,
    b.womenActivePct != null
      ? `${fmtPct(b.womenActivePct)} women among those positions with a recorded gender`
      : "Share of women: Not recorded",
    b.medianTenureYearsEnded != null
      ? `median ${fmtDec(b.medianTenureYearsEnded, 1)} years served in positions that have ended`
      : "Median years served: Not recorded",
  ];
  return parts.flatMap((p) => (p ? [p] : []));
}

// ---------------------------------------------------------------------------------------------------
// Opinions on file and citations
// ---------------------------------------------------------------------------------------------------

/** The citation-age measure as the dataset defines it (shown beside every age figure). */
export const CITATION_AGE_DEFINITION =
  "years between the cited opinion's filing and the citing opinion's";

/** What a citation link is and is not; shown in the Citations section wherever its figures appear. */
export const CITATION_LINK_DEFINITION =
  "A citation link is one row of CourtListener's citation map (a citing opinion cites a cited opinion), attributed to the court of each opinion's docket. Only links with a court on both sides are counted, and links between two opinions of the same decision (a separate opinion citing the lead opinion) are set aside. It is an extraction from opinion text, not a census of citations.";

/** Link counts describe citation behaviour in the collection; they are not a quality or good-law signal. */
export const CITATION_NOT_QUALITY =
  "Link counts show where a court's citations go and come from in the collection; they do not measure the quality, authority or current status of a court or an opinion.";

/** A row for the share bars (the same shape as the panel's BarRow). */
export type ShareRow = {
  key: string;
  label: string;
  count: number;
  sharePct: number | null;
  title: string;
  /** Set only for a court row whose stored link named exactly that court (never the profiled court). */
  courtId: string | undefined;
};

/** Labelled opinion types as bar rows; shares stay the stored shares of all opinions. */
export function typeRows(types: readonly ClbShare[]): ShareRow[] {
  return types.map((t) => ({
    key: t.value,
    label: t.label,
    count: t.count,
    sharePct: t.sharePct,
    title: `${t.label} (${t.value})`,
    courtId: undefined,
  }));
}

/** Courts on one side of the citation links as bar rows; the profiled court itself is marked, not linked. */
export function citedCourtRows(rows: readonly ClbCitedCourt[]): ShareRow[] {
  return rows.map((r) => ({
    key: r.courtId,
    label: r.isSelf ? `${r.name} (this court)` : r.name,
    count: r.n,
    sharePct: r.sharePct,
    title: `${r.name} (${r.courtId})`,
    courtId: r.link && !r.isSelf ? r.courtId : undefined,
  }));
}

/**
 * The share of opinions with a recorded author. The stored share has one decimal, so a stored 0 beside
 * listed authors is under 0.05%, never "0.0%".
 */
export function authorPctText(o: Pick<ClbOpinions, "withAuthorPct" | "topAuthors">): string {
  if (o.withAuthorPct === 0 && o.topAuthors.length > 0) return "<0.1%";
  return fmtPct(o.withAuthorPct);
}

/**
 * What the author counts cover. Only an opinion with a recorded author is attributed to anyone, so a low
 * share makes every author count a floor, not a ranking of who wrote the most.
 */
export function authorshipNote(
  o: Pick<ClbOpinions, "total" | "withAuthorPct" | "topAuthors">,
): string {
  if (o.withAuthorPct == null)
    return `The share of opinions with a recorded author is ${NOT_RECORDED} for this court.`;
  // A stored 0 with no author listed: the collection records no author on any of these opinions.
  if (o.withAuthorPct === 0 && o.topAuthors.length === 0)
    return `None of the ${fmtInt(o.total)} opinions has a recorded author in the collection, so no author is listed.`;
  const lead = `${authorPctText(o)} of the ${fmtInt(o.total)} opinions have a recorded author`;
  return o.withAuthorPct < 50
    ? `Only ${lead}, so the author counts are a floor: they cover the opinions where CourtListener recorded an author and say nothing about who wrote the rest.`
    : `${lead}; author counts cover those opinions only.`;
}

export function opinionsSummary(o: ClbOpinions): string {
  return [
    `${fmtInt(o.total)} opinions`,
    o.withAuthorPct != null ? `${authorPctText(o)} with a recorded author` : null,
    o.perCuriam != null ? `${fmtInt(o.perCuriam)} per curiam` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function citationsSummary(c: ClbCitations): string {
  return [
    c.made != null ? `${fmtInt(c.made)} links made` : null,
    c.received != null ? `${fmtInt(c.received)} received` : null,
    c.selfCitationPct != null ? `${fmtPct(c.selfCitationPct)} to its own opinions` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Which courts a list shows and how much of the whole they cover, from the stored link counts: the listed
 * courts' links added up over the total they are shares of. Undefined when there is nothing to describe.
 */
export function shownCourtsNote(
  rows: readonly Pick<ClbCitedCourt, "n">[],
  whole: number | null,
): string | undefined {
  if (whole == null || whole <= 0 || !rows.length) return undefined;
  const covered = rows.reduce((sum, r) => sum + r.n, 0);
  if (covered >= whole)
    return rows.length === 1 ? "the only court with links" : `all ${rows.length} courts with links`;
  const lead = rows.length === 1 ? "the largest court" : `the ${rows.length} largest courts`;
  return `${lead}, together ${fmtPct(shareOf(covered, whole))} of the links`;
}

/** What a court list says when it has no rows: no links in that direction, or courts that are not recorded. */
export function noCourtsText(total: number | null): string {
  if (total == null) return NOT_RECORDED;
  return total === 0
    ? "No links are recorded in this direction."
    : `The courts behind these ${fmtInt(total)} links are ${NOT_RECORDED}.`;
}

/** Years with one decimal and the unit; Not recorded when the age is unknown. */
export function ageYearsText(years: number | null | undefined): string {
  return typeof years === "number" && Number.isFinite(years)
    ? `${fmtDec(years, 1)} years`
    : NOT_RECORDED;
}

/** The definition and basis of the age figures: what is measured, over how many links, and what it is not. */
export function ageBasisNote(c: Pick<ClbCitations, "medianAgeYears" | "ageBasisLinks">): string {
  if (c.medianAgeYears == null || c.ageBasisLinks == null)
    return `The age of cited opinions is ${NOT_RECORDED} for this court.`;
  return `Age is the ${CITATION_AGE_DEFINITION}, over the ${fmtInt(c.ageBasisLinks)} links made where both filing dates are on record and the citing opinion is not older. It shows how far back this court's opinions reach, not whether what they cite is still good law.`;
}

// ---------------------------------------------------------------------------------------------------
// District at a glance
// ---------------------------------------------------------------------------------------------------

function unitFor(value: number, unit: string): string {
  // "1 case", "1 month"; "per judgeship" and the like are left alone.
  return value === 1 && unit.endsWith("s") && !unit.endsWith("ss") ? unit.slice(0, -1) : unit;
}

/** A measure's value as text, with its unit kept apart so the table can set the unit quietly. */
export function measureValue(m: GlanceMeasure): { text: string; unit: string | null } {
  const v = m.value;
  if (v == null) return { text: NOT_RECORDED, unit: null };
  switch (m.unit) {
    case "percent":
      return {
        text: `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`,
        unit: null,
      };
    case "ratio":
      return {
        text: `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`,
        unit: null,
      };
    case "months":
    case "days":
    case "years":
    case "per judgeship":
      return {
        text: v.toLocaleString("en-US", { maximumFractionDigits: 1 }),
        unit: unitFor(v, m.unit),
      };
    default:
      return {
        text: v.toLocaleString("en-US", { maximumFractionDigits: 2 }),
        unit: unitFor(v, m.unit),
      };
  }
}

/** The fiscal year most measures are aligned to ("FY2025"), from their stored periods; null when none is. */
export function glanceFiscalYear(
  measures: readonly Pick<GlanceMeasure, "period">[],
): string | null {
  const tally = new Map<string, number>();
  for (const m of measures) {
    if (/^FY\d{4}$/.test(m.period)) tally.set(m.period, (tally.get(m.period) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [period, n] of tally) {
    if (n > bestN || (n === bestN && best != null && period > best)) {
      best = period;
      bestN = n;
    }
  }
  return best;
}

export function rankText(m: GlanceMeasure): string {
  return m.rank ? `${m.rank.position} of ${m.rank.of}` : m.value == null ? "—" : "Not ranked";
}

/** A correlation coefficient with a true minus sign. */
export function rhoText(rho: number): string {
  const s = Math.abs(rho).toFixed(2);
  return rho < 0 && s !== "0.00" ? `−${s}` : s;
}
