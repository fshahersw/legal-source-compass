/**
 * Court analytics insights from the U.S. Courts Judicial Business tables (datasets court_stats_national,
 * court_stats_district_nos and court_stats_circuits, already validated by components/courts/courtStatsData).
 * Fiscal years end September 30. A district with a missing value for the year is left out of that ranking.
 */
import type { CourtStatsOverview, DistrictRow, Series } from "@/components/courts/courtStatsData";
import { makeInsight } from "../build";
import {
  fmtDec,
  fmtInt,
  fmtPct,
  fmtSignedInt,
  fmtSignedPct,
  isNum,
  joinList,
  median,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
} from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "court";
const court = (id: string) => `/courts/${id}`;
const MIN_DISTRICTS = 85;
/** A share or median from fewer pending civil cases than this says little, so such districts are left out of those rankings. */
const MIN_PENDING = 100;
const MIN_RANKED = 60;

const LISTING =
  "https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts";
const sourcesFor = (listing: string | null): InsightSourceLink[] => [
  { label: "Judicial Business of the United States Courts", href: listing ?? LISTING },
];

const at = (s: Series | undefined, i: number) => (i >= 0 ? (s?.[i] ?? null) : null);

type Cell = { row: DistrictRow; value: number };

function cells(rows: DistrictRow[], pick: (r: DistrictRow) => number | null): Cell[] {
  return rows.flatMap((row) => {
    const value = pick(row);
    return isNum(value) ? [{ row, value }] : [];
  });
}

export function generateCourtInsights(data: CourtStatsOverview): Insight[] {
  const L = data.years.length - 1;
  const year = data.years[L];
  if (year === undefined || L < 1) return [];
  const fy = `FY${year}`;
  const prevFy = `FY${year - 1}`;
  const SOURCES = sourcesFor(data.national.listing);
  const out: (Insight | null)[] = [];

  const natPl = data.national.series["pl_total"];
  const natCivil = data.national.series["civil_filed"];
  const natShare = data.national.series["pl_share_pct"];
  const natPlNow = at(natPl, L);

  // 1. National product liability filings
  const plPrev = at(natPl, L - 1);
  const plPct = pctChange(natPlNow, plPrev);
  const peak = sortDesc(
    (natPl ?? []).flatMap((v, i) => (isNum(v) ? [{ v, year: data.years[i]! }] : [])),
    (x) => x.v,
  )[0];
  if (natPlNow != null && plPrev != null && plPct != null && peak) {
    out.push(
      makeInsight({
        section: SECTION,
        slug: "pl-filings-national",
        kind: "mover",
        headline: `Product liability filings in federal district courts were ${fmtInt(natPlNow)} in ${fy}, ${moved(plPct)} from ${prevFy}`,
        summary: [
          `Federal district courts recorded ${fmtInt(natPlNow)} product liability filings in ${fy}, compared with ${fmtInt(plPrev)} in ${prevFy}.`,
          isNum(at(natShare, L))
            ? `That is ${fmtPct(at(natShare, L)!)} of all civil filings in ${fy}${isNum(at(natShare, L - 1)) ? ` (${fmtPct(at(natShare, L - 1)!)} in ${prevFy})` : ""}.`
            : null,
          peak.year !== year
            ? `The highest year since FY${data.years[0]} was FY${peak.year}, with ${fmtInt(peak.v)} filings.`
            : `${fy} is the highest year since FY${data.years[0]}.`,
          `Large swings usually come from a few multidistrict dockets assigned to one district rather than from changes spread across the country.`,
        ],
        points: [
          { label: `Filings, ${fy}`, value: fmtInt(natPlNow) },
          { label: `Filings, ${prevFy}`, value: fmtInt(plPrev) },
          { label: `Change, ${prevFy} to ${fy}`, value: fmtSignedPct(plPct) },
          { label: `Peak year: FY${peak.year}`, value: fmtInt(peak.v) },
          isNum(at(natShare, L))
            ? { label: `Share of civil filings, ${fy}`, value: fmtPct(at(natShare, L)!) }
            : null,
          isNum(at(natCivil, L))
            ? { label: `All civil filings, ${fy}`, value: fmtInt(at(natCivil, L)!) }
            : null,
        ],
        caveat: data.national.notes[1] ?? undefined,
        sources: SOURCES,
        dataThrough: fy,
        score: 80,
      }),
    );
  }

  // 2. Concentration of product liability filings
  const pl = cells(data.districts, (r) => at(r.pl, L));
  if (pl.length >= MIN_DISTRICTS && natPlNow != null && natPlNow > 0) {
    const desc = sortDesc(pl, (c) => c.value);
    const top5 = desc.slice(0, 5);
    const top5Share = sharePct(sum(top5.map((c) => c.value)), natPlNow);
    const first = desc[0];
    const published = at(data.national.series["pl_top5_share_pct"], L);
    const consistent =
      published == null || (top5Share != null && Math.abs(published - top5Share) <= 1);
    if (first && top5.length === 5 && top5Share != null && consistent) {
      const firstShare = sharePct(first.value, natPlNow)!;
      out.push(
        makeInsight({
          section: SECTION,
          slug: "pl-filings-concentration",
          kind: "concentration",
          headline: `Five districts received ${fmtPct(top5Share, 0)} of product liability filings in ${fy}`,
          summary: [
            `In ${fy}, ${joinList(top5.map((c) => c.row.name))} together received ${fmtInt(sum(top5.map((c) => c.value)))} of the ${fmtInt(natPlNow)} product liability filings nationwide (${fmtPct(top5Share)}).`,
            `${first.row.name} alone had ${fmtInt(first.value)} (${fmtPct(firstShare)}).`,
            `${pl.filter((c) => c.value === 0).length} of the ${pl.length} districts with a recorded figure reported none.`,
          ],
          points: [
            ...top5.slice(0, 3).map((c) => ({
              label: c.row.name,
              value: fmtInt(c.value),
              note: fmtPct(sharePct(c.value, natPlNow)!),
              href: court(c.row.id),
            })),
            {
              label: "Top five combined",
              value: fmtInt(sum(top5.map((c) => c.value))),
              note: fmtPct(top5Share),
            },
            { label: "National total", value: fmtInt(natPlNow) },
          ],
          caveat:
            "Filings include cases transferred to a multidistrict-litigation (MDL) judge, so the busiest districts are usually where large MDL dockets sit.",
          sources: SOURCES,
          dataThrough: fy,
          score: 74,
        }),
      );
    }
  }

  // 3. Biggest year-over-year changes by district
  const changes = data.districts.flatMap((row) => {
    const now = at(row.pl, L);
    const before = at(row.pl, L - 1);
    return isNum(now) && isNum(before) ? [{ row, now, before, delta: now - before }] : [];
  });
  if (changes.length >= MIN_DISTRICTS) {
    const risers = sortDesc(changes, (c) => c.delta).filter((c) => c.delta > 0);
    const fallers = sortAsc(changes, (c) => c.delta).filter((c) => c.delta < 0);
    const top = risers[0];
    const second = risers[1];
    const third = risers[2];
    const drop = fallers[0];
    if (top && second && drop) {
      const topPct = pctChange(top.now, top.before);
      out.push(
        makeInsight({
          section: SECTION,
          slug: "pl-filings-movers",
          kind: "mover",
          headline: `${top.row.name} had the largest rise in product liability filings in ${fy} (${fmtSignedInt(top.delta)}); ${drop.row.name} had the largest fall (${fmtSignedInt(drop.delta)})`,
          summary: [
            `${top.row.name} went from ${fmtInt(top.before)} product liability filings in ${prevFy} to ${fmtInt(top.now)} in ${fy}${topPct != null ? ` (${fmtSignedPct(topPct, 0)})` : ""}.`,
            `${drop.row.name} fell from ${fmtInt(drop.before)} to ${fmtInt(drop.now)}.`,
            `Of the ${changes.length} districts with both years recorded, ${risers.length} had more filings than the year before and ${fallers.length} had fewer.`,
          ],
          points: [
            {
              label: `Largest rise: ${top.row.name}`,
              value: fmtSignedInt(top.delta),
              note: `${fmtInt(top.before)} to ${fmtInt(top.now)}`,
              href: court(top.row.id),
            },
            {
              label: `Second: ${second.row.name}`,
              value: fmtSignedInt(second.delta),
              href: court(second.row.id),
            },
            third
              ? {
                  label: `Third: ${third.row.name}`,
                  value: fmtSignedInt(third.delta),
                  href: court(third.row.id),
                }
              : null,
            {
              label: `Largest fall: ${drop.row.name}`,
              value: fmtSignedInt(drop.delta),
              note: `${fmtInt(drop.before)} to ${fmtInt(drop.now)}`,
              href: court(drop.row.id),
            },
            { label: "Districts up / down", value: `${risers.length} / ${fallers.length}` },
          ],
          caveat:
            "Counts are filings of all kinds of product liability cases, including cases sent to a district as part of an MDL.",
          sources: SOURCES,
          dataThrough: fy,
          score: 70,
        }),
      );
    }
  }

  // 4. Product liability filings per judgeship
  const perJudge = cells(data.districts, (r) => at(r.plPerJudgeship, L));
  if (perJudge.length >= MIN_DISTRICTS) {
    const desc = sortDesc(perJudge, (c) => c.value);
    const [a, b, c] = desc;
    const mid = median(perJudge.map((x) => x.value));
    if (a && b && c && mid != null && mid > 0) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "pl-per-judgeship",
          kind: "outlier",
          headline: `${a.row.name} had ${fmtDec(a.value, 1)} product liability filings per authorized judgeship in ${fy}, the most of any district (median district: ${fmtDec(mid, 1)})`,
          summary: [
            `Dividing product liability filings by authorized judgeships, ${a.row.name} had ${fmtDec(a.value, 1)} per judgeship in ${fy}, followed by ${b.row.name} (${fmtDec(b.value, 1)}) and ${c.row.name} (${fmtDec(c.value, 1)}).`,
            `The middle district (the median) had ${fmtDec(mid, 1)} per judgeship.`,
            `A high figure points to a heavy product liability docket for the number of judges; it does not show how long cases take.`,
          ],
          points: [
            { label: a.row.name, value: fmtDec(a.value, 1), href: court(a.row.id) },
            { label: b.row.name, value: fmtDec(b.value, 1), href: court(b.row.id) },
            { label: c.row.name, value: fmtDec(c.value, 1), href: court(c.row.id) },
            { label: "Median district", value: fmtDec(mid, 1) },
          ],
          caveat:
            "Judgeships are authorized positions from Table X-1A; vacancies and senior judges are not counted.",
          sources: SOURCES,
          dataThrough: fy,
          score: 58,
        }),
      );
    }
  }

  // 5. Time to disposition
  const months = cells(data.districts, (r) =>
    (at(r.pending, L) ?? 0) >= MIN_PENDING ? at(r.median, L) : null,
  );
  if (months.length >= MIN_RANKED) {
    const slow = sortDesc(months, (c) => c.value);
    const [a, b, c] = slow;
    const fast = sortAsc(months, (x) => x.value)[0];
    const mid = median(months.map((x) => x.value));
    const earlier = median(data.districts.map((r) => at(r.median, 0)));
    if (a && b && c && fast && mid != null) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "time-to-disposition",
          kind: "outlier",
          headline: `Median time to resolve a civil case ranged from ${fmtDec(fast.value, 1)} months in ${fast.row.name} to ${fmtDec(a.value, 1)} months in ${a.row.name} in ${fy}`,
          summary: [
            `In ${fy}, the median time from filing to disposition of a civil case was longest in ${a.row.name} (${fmtDec(a.value, 1)} months), ${b.row.name} (${fmtDec(b.value, 1)}) and ${c.row.name} (${fmtDec(c.value, 1)}), and shortest in ${fast.row.name} (${fmtDec(fast.value, 1)}).`,
            `The middle district (the median) took ${fmtDec(mid, 1)} months${earlier != null ? `, compared with ${fmtDec(earlier, 1)} months in FY${data.years[0]}` : ""}.`,
            `A district's figure can be pushed up by a single very large MDL docket, so the median of district values is the fairer benchmark.`,
          ],
          points: [
            {
              label: `Slowest: ${a.row.name}`,
              value: `${fmtDec(a.value, 1)} months`,
              href: court(a.row.id),
            },
            {
              label: `Next: ${b.row.name}`,
              value: `${fmtDec(b.value, 1)} months`,
              href: court(b.row.id),
            },
            {
              label: `Fastest: ${fast.row.name}`,
              value: `${fmtDec(fast.value, 1)} months`,
              href: court(fast.row.id),
            },
            { label: "Median district", value: `${fmtDec(mid, 1)} months` },
            earlier != null
              ? {
                  label: `Median district, FY${data.years[0]}`,
                  value: `${fmtDec(earlier, 1)} months`,
                }
              : null,
          ],
          caveat: `Districts with fewer than ${MIN_PENDING} pending civil cases are left out of this ranking. ${data.national.notes.find((n) => n.startsWith("Time-to-disposition")) ?? ""}`,
          sources: SOURCES,
          dataThrough: fy,
          score: 66,
        }),
      );
    }
  }

  // 6. Aging backlog
  const aging = cells(data.districts, (r) =>
    (at(r.pending, L) ?? 0) >= MIN_PENDING ? at(r.over3, L) : null,
  );
  if (aging.length >= MIN_RANKED) {
    const desc = sortDesc(aging, (c) => c.value);
    const [a, b, c] = desc;
    const mid = median(aging.map((x) => x.value));
    const worst = a ? at(a.row.pending, L) : null;
    if (a && b && c && mid != null && a.value > mid) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "aging-backlog",
          kind: "outlier",
          headline: `${fmtPct(a.value, 0)} of pending civil cases in ${a.row.name} were three or more years old at the end of ${fy}`,
          summary: [
            `At the end of ${fy}, ${a.row.name} had the highest share of pending civil cases that had been open for three years or more (${fmtPct(a.value)}), followed by ${b.row.name} (${fmtPct(b.value)}) and ${c.row.name} (${fmtPct(c.value)}).`,
            `The middle district (the median) had ${fmtPct(mid)}.`,
            worst != null
              ? `${a.row.name} had ${fmtInt(worst)} civil cases pending in total.`
              : null,
          ],
          points: [
            { label: a.row.name, value: fmtPct(a.value), href: court(a.row.id) },
            { label: b.row.name, value: fmtPct(b.value), href: court(b.row.id) },
            { label: c.row.name, value: fmtPct(c.value), href: court(c.row.id) },
            { label: "Median district", value: fmtPct(mid) },
          ],
          caveat: `Districts with fewer than ${MIN_PENDING} pending civil cases are left out of this ranking. Old pending cases are often MDL member cases waiting on a coordinated process, not individually neglected files.`,
          sources: SOURCES,
          dataThrough: fy,
          score: 62,
        }),
      );
    }
  }

  // 7. Courts of appeals
  const appeals = data.circuits.flatMap((c) => {
    const now = at(c.appealsFiled, L);
    const before = at(c.appealsFiled, L - 1);
    return isNum(now) ? [{ circuit: c, now, before }] : [];
  });
  if (appeals.length >= 11) {
    const total = sum(appeals.map((a) => a.now));
    const totalBefore = appeals.every((a) => isNum(a.before))
      ? sum(appeals.map((a) => a.before))
      : null;
    const pct = pctChange(total, totalBefore);
    const desc = sortDesc(appeals, (a) => a.now);
    const [a, b, c] = desc;
    const lastCircuit = desc[desc.length - 1];
    if (a && b && c && lastCircuit && pct != null && totalBefore != null) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "appeals-filed",
          kind: "mover",
          headline: `Appeals filed in the regional courts of appeals were ${moved(pct)} in ${fy} (${fmtInt(total)})`,
          summary: [
            `The twelve regional circuits recorded ${fmtInt(total)} appeals filed in ${fy}, compared with ${fmtInt(totalBefore)} in ${prevFy}.`,
            `The ${a.circuit.name} had the most (${fmtInt(a.now)}, ${fmtPct(sharePct(a.now, total)!)} of the total), then the ${b.circuit.name} (${fmtInt(b.now)}) and the ${c.circuit.name} (${fmtInt(c.now)}).`,
            `The ${lastCircuit.circuit.name} had the fewest (${fmtInt(lastCircuit.now)}).`,
          ],
          points: [
            { label: `Total, ${fy}`, value: fmtInt(total), note: fmtSignedPct(pct) },
            { label: a.circuit.name, value: fmtInt(a.now), note: fmtPct(sharePct(a.now, total)!) },
            { label: b.circuit.name, value: fmtInt(b.now) },
            { label: c.circuit.name, value: fmtInt(c.now) },
            { label: lastCircuit.circuit.name, value: fmtInt(lastCircuit.now) },
          ],
          caveat:
            "Counts cover the twelve regional courts of appeals; the Federal Circuit is not included.",
          sources: SOURCES,
          dataThrough: fy,
          score: 52,
        }),
      );
    }
  }

  // 8. MDL link
  const corr = data.national.mdlCorrelation;
  const mdlRows = cells(data.districts, (r) => r.mdl?.plActions ?? null);
  if (isNum(corr.rho) && isNum(corr.n) && corr.n >= 30 && mdlRows.length >= MIN_DISTRICTS) {
    const desc = sortDesc(mdlRows, (c) => c.value);
    const [a, b, c] = desc;
    if (a && b && c && a.value > 0) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "mdl-and-filings",
          kind: "trend",
          headline: `Districts with more pending product liability MDL actions also tend to receive more product liability filings`,
          summary: [
            `Ranking ${fmtInt(corr.n)} districts by ${fy} product liability filings and by pending product liability MDL actions gives a rank correlation of ${fmtDec(corr.rho, 2)} (1.00 would be a perfect match).`,
            `As of ${corr.asOf ?? "the report date"}, ${a.row.name} had the most pending product liability MDL actions (${fmtInt(a.value)}), then ${b.row.name} (${fmtInt(b.value)}) and ${c.row.name} (${fmtInt(c.value)}).`,
            `A correlation shows two rankings move together; it does not show that one causes the other.`,
          ],
          points: [
            { label: "Rank correlation", value: fmtDec(corr.rho, 2) },
            { label: "Districts compared", value: fmtInt(corr.n) },
            {
              label: `Most pending PL MDL actions: ${a.row.name}`,
              value: fmtInt(a.value),
              href: court(a.row.id),
            },
            { label: b.row.name, value: fmtInt(b.value), href: court(b.row.id) },
            { label: c.row.name, value: fmtInt(c.value), href: court(c.row.id) },
          ],
          caveat:
            "MDL actions are counted from the JPML pending-dockets report, which is dated separately from the fiscal-year filing counts.",
          sources: [
            ...SOURCES,
            { label: "MDL analytics (JPML monthly reports)", href: "/matters/analytics" },
          ],
          dataThrough: fy,
          score: 56,
        }),
      );
    }
  }
  return out.filter((i): i is Insight => i !== null);
}
