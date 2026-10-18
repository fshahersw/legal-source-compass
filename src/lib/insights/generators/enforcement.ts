/**
 * Enforcement insights from three published sources, each with its own generator:
 *   - generateCfpbInsights:        CFPB Consumer Complaint Database aggregates (cfpb_complaints_national / companies)
 *   - generateEpaInsights:         EPA ECHO civil enforcement cases, national profile (regulatory_epa_state_profiles)
 *   - generateRulemakingInsights:  Federal Register rule counts by agency (regulatory_federal_register_activity)
 * Complaints are consumer submissions and counts of enforcement cases or rules are activity counts; none of them
 * is a finding of wrongdoing, and the wording says so.
 */
import type { ConsumerComplaints } from "@/lib/external/consumerComplaints.functions";
import type { EpaProfile } from "@/lib/external/enforcement.functions";
import type { AgencyActivity } from "@/lib/external/rulemaking.functions";
import { makeInsight } from "../build";
import {
  clip,
  fmtDec,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSignedPct,
  fmtTimes,
  fmtWords,
  isNum,
  latestCompleteFiscalYear,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
  timesOf,
} from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "enforcement";

// ---------------------------------------------------------------- CFPB

const CFPB_SOURCES: InsightSourceLink[] = [
  {
    label: "CFPB Consumer Complaint Database",
    href: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
  },
];
const CFPB_CAVEAT =
  "Complaints are consumer submissions published by the CFPB after the company responds or after 15 days; they are not findings of wrongdoing.";

export function generateCfpbInsights(data: ConsumerComplaints): Insight[] {
  const out: (Insight | null)[] = [];
  const last = [...data.years].reverse().find((y) => y.complete);
  const prev = last ? data.years.find((y) => y.year === last.year - 1 && y.complete) : undefined;

  // 1. Latest complete year
  if (last && prev) {
    const pct = pctChange(last.complaints, prev.complaints);
    const published = last.yoyPct;
    const consistent = pct != null && (published == null || Math.abs(published - pct) <= 0.5);
    const otherNow = isNum(last.creditReporting) ? last.complaints - last.creditReporting : null;
    const otherThen = isNum(prev.creditReporting) ? prev.complaints - prev.creditReporting : null;
    const otherPct = pctChange(otherNow, otherThen);
    if (pct != null && consistent)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "cfpb-annual",
          kind: "mover",
          headline: `The CFPB received ${fmtWords(last.complaints)} consumer complaints in ${last.year}, ${moved(pct, 0)} from ${prev.year}`,
          summary: [
            `The Consumer Complaint Database lists ${fmtInt(last.complaints)} complaints received in ${last.year}, compared with ${fmtInt(prev.complaints)} in ${prev.year}.`,
            isNum(last.creditReportingSharePct)
              ? `${fmtPct(last.creditReportingSharePct)} of the ${last.year} complaints were about credit reporting${isNum(prev.creditReportingSharePct) ? `, compared with ${fmtPct(prev.creditReportingSharePct)} in ${prev.year}` : ""}.`
              : null,
            otherNow != null && otherThen != null && otherPct != null
              ? `Leaving credit reporting out, complaints were ${fmtInt(otherNow)} in ${last.year} and ${fmtInt(otherThen)} in ${prev.year} (${moved(otherPct)}).`
              : null,
            isNum(last.timelyRate)
              ? `Companies responded on time to ${fmtPct(last.timelyRate)} of ${last.year} complaints${isNum(last.reliefRate) ? `, and ${fmtPct(last.reliefRate)} of responded complaints were closed with some relief` : ""}.`
              : null,
          ],
          points: [
            {
              label: `Complaints, ${last.year}`,
              value: fmtInt(last.complaints),
              note: fmtSignedPct(pct),
            },
            { label: `Complaints, ${prev.year}`, value: fmtInt(prev.complaints) },
            isNum(last.creditReportingSharePct)
              ? { label: "Credit reporting share", value: fmtPct(last.creditReportingSharePct) }
              : null,
            otherPct != null
              ? { label: "Change excluding credit reporting", value: fmtSignedPct(otherPct) }
              : null,
            isNum(last.timelyRate)
              ? { label: "Timely company response", value: fmtPct(last.timelyRate, 2) }
              : null,
          ],
          caveat: CFPB_CAVEAT,
          sources: CFPB_SOURCES,
          dataThrough: String(last.year),
          score: 84,
        }),
      );
  }

  // 2. Year to date
  const ytd = data.ytd;
  if (ytd && ytd.previousComplaints > 0) {
    const pct = pctChange(ytd.complaints, ytd.previousComplaints);
    const priorYear = ytd.from.slice(0, 4) !== "" ? String(Number(ytd.from.slice(0, 4)) - 1) : null;
    if (pct != null && priorYear && last)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "cfpb-year-to-date",
          kind: "mover",
          headline: `CFPB complaints received so far in ${ytd.from.slice(0, 4)} are ${moved(pct, 0)} from the same stretch of ${priorYear}`,
          summary: [
            `From ${ytd.from} to ${ytd.to}, the database lists ${fmtInt(ytd.complaints)} complaints, compared with ${fmtInt(ytd.previousComplaints)} for the same dates in ${priorYear}.`,
            ytd.complaints > last.complaints
              ? `That is already more than the ${fmtInt(last.complaints)} received in all of ${last.year}.`
              : `The full ${last.year} total was ${fmtInt(last.complaints)}.`,
            `The most recent weeks are still filling in, so the current-year figure is likely to rise.`,
          ],
          points: [
            { label: `${ytd.from} to ${ytd.to}`, value: fmtInt(ytd.complaints) },
            { label: `Same dates in ${priorYear}`, value: fmtInt(ytd.previousComplaints) },
            { label: "Change", value: fmtSignedPct(pct) },
            { label: `All of ${last.year}`, value: fmtInt(last.complaints) },
          ],
          caveat: `${ytd.note ? `${ytd.note}. ` : ""}${CFPB_CAVEAT}`,
          sources: CFPB_SOURCES,
          dataThrough: ytd.to,
          score: 70,
        }),
      );
  }

  // 3. Product mix shift
  const rows = sortDesc(data.productShift.rows, (r) => Math.abs(r.shiftPp));
  const [s1, s2, s3] = rows;
  if (s1 && s2 && s3 && data.productShift.from && data.productShift.to) {
    const { from, to } = data.productShift;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "cfpb-product-shift",
        kind: "mix_shift",
        headline: `${s1.product} went from ${fmtPct(s1.share2024Pct)} to ${fmtPct(s1.share2025Pct)} of CFPB complaints between ${from} and ${to}`,
        summary: [
          `Comparing each product's share of all complaints, the biggest shift from ${from} to ${to} was ${s1.product}: ${fmtPct(s1.share2024Pct, 2)} to ${fmtPct(s1.share2025Pct, 2)} (${s1.shiftPp > 0 ? "+" : ""}${fmtDec(s1.shiftPp, 1)} percentage points; ${fmtInt(s1.complaints2024)} to ${fmtInt(s1.complaints2025)} complaints).`,
          `Next were ${s2.product} (${s2.shiftPp > 0 ? "+" : ""}${fmtDec(s2.shiftPp, 1)} points) and ${s3.product} (${s3.shiftPp > 0 ? "+" : ""}${fmtDec(s3.shiftPp, 1)} points).`,
          `A share can fall even when the count rises, if another product grows faster.`,
        ],
        points: [
          {
            label: s1.product,
            value: `${s1.shiftPp > 0 ? "+" : ""}${fmtDec(s1.shiftPp, 1)} points`,
            note: `${fmtPct(s1.share2024Pct)} to ${fmtPct(s1.share2025Pct)}`,
          },
          {
            label: s2.product,
            value: `${s2.shiftPp > 0 ? "+" : ""}${fmtDec(s2.shiftPp, 1)} points`,
            note: `${fmtPct(s2.share2024Pct)} to ${fmtPct(s2.share2025Pct)}`,
          },
          {
            label: s3.product,
            value: `${s3.shiftPp > 0 ? "+" : ""}${fmtDec(s3.shiftPp, 1)} points`,
            note: `${fmtPct(s3.share2024Pct)} to ${fmtPct(s3.share2025Pct)}`,
          },
        ],
        caveat: `Only the two most recent complete years, which use the same product names, are compared. ${CFPB_CAVEAT}`,
        sources: CFPB_SOURCES,
        dataThrough: to,
        score: 66,
      }),
    );
  }

  // 4. Companies named most often
  const companies = sortDesc(data.topCompanies, (c) => c.complaints);
  const [c1, c2, c3] = companies;
  if (c1 && c2 && c3 && data.complaints > 0) {
    const top3 = sum([c1, c2, c3].map((c) => c.complaints));
    const share = sharePct(top3, data.complaints);
    if (share != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "cfpb-companies",
          kind: "concentration",
          headline: `Three company names account for ${fmtPct(share, 0)} of all CFPB consumer complaints`,
          summary: [
            `Since ${data.from}, the database lists ${fmtInt(data.complaints)} complaints against ${fmtInt(data.companies)} company names. ${clip(c1.company, 50)} is named in ${fmtInt(c1.complaints)}, ${clip(c2.company, 50)} in ${fmtInt(c2.complaints)} and ${clip(c3.company, 50)} in ${fmtInt(c3.complaints)}.`,
            `Together that is ${fmtPct(share)} of every complaint received.`,
            `Company names are counted exactly as recorded, so a company filed under several spellings is split across them.`,
          ],
          points: [
            {
              label: clip(c1.company, 44),
              value: fmtInt(c1.complaints),
              note: fmtPct(sharePct(c1.complaints, data.complaints) ?? 0),
            },
            {
              label: clip(c2.company, 44),
              value: fmtInt(c2.complaints),
              note: fmtPct(sharePct(c2.complaints, data.complaints) ?? 0),
            },
            {
              label: clip(c3.company, 44),
              value: fmtInt(c3.complaints),
              note: fmtPct(sharePct(c3.complaints, data.complaints) ?? 0),
            },
            { label: "Top three combined", value: fmtPct(share) },
            { label: "Company names in the database", value: fmtInt(data.companies) },
          ],
          caveat: `Being named in many complaints reflects a company's size and the products it sells as well as its conduct. ${CFPB_CAVEAT}`,
          sources: CFPB_SOURCES,
          dataThrough: data.to,
          score: 62,
        }),
      );
  }

  // 5. Relief and timeliness
  const complete = data.years.filter((y) => y.complete);
  const recent = complete.slice(-3);
  if (recent.length === 3 && recent.every((y) => isNum(y.reliefRate) && isNum(y.timelyRate))) {
    const [a, b, c] = recent as [(typeof recent)[0], (typeof recent)[0], (typeof recent)[0]];
    const delta = c.reliefRate! - a.reliefRate!;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "cfpb-relief-rate",
        kind: "trend",
        headline: `${fmtPct(c.reliefRate!, 0)} of CFPB complaints were closed with relief in ${c.year}, compared with ${fmtPct(a.reliefRate!, 0)} in ${a.year}`,
        summary: [
          `Of complaints that received a company response, ${fmtPct(a.reliefRate!)} in ${a.year}, ${fmtPct(b.reliefRate!)} in ${b.year} and ${fmtPct(c.reliefRate!)} in ${c.year} were closed with monetary or non-monetary relief.`,
          `Over the same three years the share answered on time was ${fmtPct(a.timelyRate!, 1)}, ${fmtPct(b.timelyRate!, 1)} and ${fmtPct(c.timelyRate!, 1)}.`,
          `The relief rate moved ${delta >= 0 ? "up" : "down"} ${fmtDec(Math.abs(delta), 1)} percentage points between ${a.year} and ${c.year}.`,
        ],
        points: [
          { label: `Relief rate, ${a.year}`, value: fmtPct(a.reliefRate!) },
          { label: `Relief rate, ${b.year}`, value: fmtPct(b.reliefRate!) },
          { label: `Relief rate, ${c.year}`, value: fmtPct(c.reliefRate!) },
          { label: `Timely response, ${c.year}`, value: fmtPct(c.timelyRate!, 2) },
        ],
        caveat: `Relief rate is complaints closed with relief divided by complaints with a company response. ${CFPB_CAVEAT}`,
        sources: CFPB_SOURCES,
        dataThrough: String(c.year),
        score: 56,
      }),
    );
  }
  return out.filter((i): i is Insight => i !== null);
}

// ---------------------------------------------------------------- EPA

export type EpaNationalInput = { fileDate: string | null; national: EpaProfile };

const EPA_SOURCES: InsightSourceLink[] = [
  {
    label: "EPA ECHO enforcement case data dictionary",
    href: "https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary",
  },
];

export function generateEpaInsights(input: EpaNationalInput): Insight[] {
  const L = latestCompleteFiscalYear(input.fileDate);
  if (L == null) return [];
  const out: (Insight | null)[] = [];
  const years = new Map(input.national.years.map((y) => [y.fy, y]));
  const cur = years.get(L);
  const prev = years.get(L - 1);
  const earlier = [L - 5, L - 4, L - 3, L - 2, L - 1].map((fy) => years.get(fy));
  const ledgerNote = `Dollars are counted in the fiscal year a settlement was entered; FY${L} is the latest year in the ECHO file (dated ${input.fileDate}) and can still rise as settlements are recorded. Cases are enforcement actions, not findings about any party beyond the settlement terms.`;

  // 1. Federal penalties
  if (cur && prev && earlier.every((y) => y !== undefined)) {
    const avg = sum(earlier.map((y) => y!.fedPenalty)) / 5;
    const vsAvg = timesOf(cur.fedPenalty, avg);
    if (avg > 0 && vsAvg != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "epa-penalties",
          kind: "mover",
          headline: `EPA settlements assessed ${fmtMoney(cur.fedPenalty)} in federal penalties in FY${L}, against an average of ${fmtMoney(avg)} over FY${L - 5} to FY${L - 1}`,
          summary: [
            `Federal civil penalties in EPA enforcement settlements entered in FY${L} came to ${fmtMoney(cur.fedPenalty)}, compared with ${fmtMoney(prev.fedPenalty)} in FY${L - 1}.`,
            `The average for the five years FY${L - 5} to FY${L - 1} was ${fmtMoney(avg)}, so FY${L} was ${vsAvg >= 1 ? fmtTimes(vsAvg) : `${fmtPct(100 * vsAvg, 0)} of`} that average.`,
            `${fmtInt(cur.penaltySettlements)} settlements in FY${L} carried a federal penalty.`,
          ],
          points: [
            { label: `Federal penalties, FY${L}`, value: fmtMoney(cur.fedPenalty) },
            { label: `Federal penalties, FY${L - 1}`, value: fmtMoney(prev.fedPenalty) },
            { label: `Average, FY${L - 5} to FY${L - 1}`, value: fmtMoney(avg) },
            { label: `Settlements with a penalty, FY${L}`, value: fmtInt(cur.penaltySettlements) },
          ],
          caveat: `A few very large settlements can dominate a year, so compare multi-year totals. ${ledgerNote}`,
          sources: EPA_SOURCES,
          dataThrough: `FY${L}`,
          score: 74,
        }),
      );
  }

  // 2. Cases opened
  if (cur && prev && prev.cases > 0 && cur.cases > 0) {
    const pct = pctChange(cur.cases, prev.cases);
    const five = [L - 4, L - 3, L - 2, L - 1, L].map((fy) => years.get(fy));
    const adminShare = sharePct(cur.administrative, cur.cases);
    if (pct != null && adminShare != null && five.every((y) => y !== undefined))
      out.push(
        makeInsight({
          section: SECTION,
          slug: "epa-cases-opened",
          kind: "mover",
          headline: `EPA opened ${fmtInt(cur.cases)} enforcement cases in FY${L}, ${moved(pct, 0)} from FY${L - 1}`,
          summary: [
            `EPA's ECHO data show ${fmtInt(cur.cases)} civil enforcement cases opened in FY${L}, compared with ${fmtInt(prev.cases)} in FY${L - 1}.`,
            `${fmtPct(adminShare)} of the FY${L} cases were administrative actions; ${fmtInt(cur.judicial)} were judicial cases filed in court.`,
            `Over the five years FY${L - 4} to FY${L}, EPA opened ${fmtInt(sum(five.map((y) => y!.cases)))} cases, an average of ${fmtInt(sum(five.map((y) => y!.cases)) / 5)} a year.`,
          ],
          points: [
            { label: `Cases opened, FY${L}`, value: fmtInt(cur.cases), note: fmtSignedPct(pct) },
            { label: `Cases opened, FY${L - 1}`, value: fmtInt(prev.cases) },
            { label: "Administrative share", value: fmtPct(adminShare) },
            { label: "Judicial cases", value: fmtInt(cur.judicial) },
          ],
          caveat: `Cases are counted in the fiscal year they were opened. ${ledgerNote}`,
          sources: EPA_SOURCES,
          dataThrough: `FY${L}`,
          score: 66,
        }),
      );
  }

  // 3. Statutes
  const window = [L - 4, L];
  const statutes = input.national.statutes.flatMap((s) => {
    const cases = sum(
      s.years.filter((y) => y.fy >= window[0]! && y.fy <= window[1]!).map((y) => y.cases),
    );
    return s.name && s.name !== "Not recorded"
      ? [
          {
            name: s.name,
            cases,
            penalty: sum(
              s.years
                .filter((y) => y.fy >= window[0]! && y.fy <= window[1]!)
                .map((y) => y.fedPenalty),
            ),
          },
        ]
      : [];
  });
  const totalCases = sum(statutes.map((s) => s.cases));
  const top = sortDesc(statutes, (s) => s.cases);
  const [a, b, c] = top;
  if (a && b && c && totalCases > 0 && a.cases > 0) {
    const share = sharePct(a.cases, totalCases);
    if (share != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "epa-statutes",
          kind: "mix_shift",
          headline: `${clip(a.name, 80)} was the main statute in ${fmtPct(share, 0)} of EPA cases opened in FY${window[0]} to FY${window[1]}`,
          summary: [
            `Among cases opened from FY${window[0]} to FY${window[1]} with a recorded main statute, ${clip(a.name, 90)} accounted for ${fmtInt(a.cases)} of ${fmtInt(totalCases)} (${fmtPct(share)}).`,
            `Next were ${clip(b.name, 90)} (${fmtInt(b.cases)}) and ${clip(c.name, 90)} (${fmtInt(c.cases)}).`,
            `The leading statute's federal penalties for those cases, by settlement year, totaled ${fmtMoney(a.penalty)}.`,
          ],
          points: [
            { label: clip(a.name, 52), value: fmtInt(a.cases), note: fmtPct(share) },
            {
              label: clip(b.name, 52),
              value: fmtInt(b.cases),
              note: fmtPct(sharePct(b.cases, totalCases) ?? 0),
            },
            {
              label: clip(c.name, 52),
              value: fmtInt(c.cases),
              note: fmtPct(sharePct(c.cases, totalCases) ?? 0),
            },
            { label: "Cases with a main statute", value: fmtInt(totalCases) },
          ],
          caveat: `Each case is assigned one main statute; the penalty figure follows settlement dates, which can fall outside the window a case was opened in. ${ledgerNote}`,
          sources: EPA_SOURCES,
          dataThrough: `FY${L}`,
          score: 58,
        }),
      );
  }

  // 4. Largest cases
  const big = sortDesc(input.national.topCases, (t) => t.fedPenalty);
  const [t1, t2, t3] = big;
  const allTime = input.national.totals.fedPenalty;
  if (t1 && t2 && t3 && allTime > 0) {
    const share = sharePct(t1.fedPenalty, allTime);
    if (share != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "epa-largest-cases",
          kind: "concentration",
          headline: `The largest federal penalty in EPA's case data is ${fmtMoney(t1.fedPenalty)}, ${fmtPct(share, 0)} of all EPA federal penalties recorded`,
          summary: [
            `${clip(t1.name, 90)}${t1.fy ? ` (opened FY${t1.fy})` : ""} has the largest federal penalty in the data at ${fmtMoney(t1.fedPenalty)}, ${fmtPct(share)} of the ${fmtMoney(allTime)} in federal penalties recorded across all EPA cases.`,
            `The next two are ${clip(t2.name, 80)} (${fmtMoney(t2.fedPenalty)}) and ${clip(t3.name, 80)} (${fmtMoney(t3.fedPenalty)}).`,
            `The three largest together are ${fmtPct(sharePct(t1.fedPenalty + t2.fedPenalty + t3.fedPenalty, allTime) ?? 0)} of the total.`,
          ],
          points: [
            {
              label: clip(t1.name, 48),
              value: fmtMoney(t1.fedPenalty),
              note: t1.fy ? `FY${t1.fy}` : undefined,
            },
            {
              label: clip(t2.name, 48),
              value: fmtMoney(t2.fedPenalty),
              note: t2.fy ? `FY${t2.fy}` : undefined,
            },
            {
              label: clip(t3.name, 48),
              value: fmtMoney(t3.fedPenalty),
              note: t3.fy ? `FY${t3.fy}` : undefined,
            },
            { label: "All EPA federal penalties", value: fmtMoney(allTime) },
          ],
          caveat: `Cases recorded as several regional records are counted once. ${ledgerNote}`,
          sources: EPA_SOURCES,
          dataThrough: `FY${L}`,
          score: 60,
        }),
      );
  }
  return out.filter((i): i is Insight => i !== null);
}

// ---------------------------------------------------------------- Rulemaking

export type RulemakingInput = { asOf: string | null; agencies: AgencyActivity[] };

export function generateRulemakingInsights(input: RulemakingInput): Insight[] {
  const rows = input.agencies.flatMap((a) => {
    const f = a.flags["RULE"];
    return f && f.baselineAnnual > 0 && f.window && f.baselineWindow
      ? [
          {
            short: a.short,
            name: a.name,
            slug: a.slug,
            recent: f.recent,
            base: f.baselineAnnual,
            ratio: f.recent / f.baselineAnnual,
            window: f.window,
            baseWindow: f.baselineWindow,
          },
        ]
      : [];
  });
  if (rows.length < 5 || new Set(rows.map((r) => r.window)).size !== 1) return [];
  const up = sortDesc(rows, (r) => r.ratio);
  const down = sortAsc(rows, (r) => r.ratio);
  const [u1, u2] = up;
  const [d1, d2] = down;
  const window = rows[0]!.window;
  const baseWindow = rows[0]!.baseWindow;
  if (!u1 || !u2 || !d1 || !d2 || u1.ratio <= 1 || d1.ratio >= 1) return [];
  const link = (slug: string) => `https://www.federalregister.gov/agencies/${slug}`;
  const out = makeInsight({
    section: SECTION,
    slug: "rulemaking-output",
    kind: "mover",
    headline: `Federal Register final rules: ${u1.short} up to ${fmtInt(u1.recent)} in the latest 12 months; ${d1.short} down to ${fmtInt(d1.recent)}`,
    summary: [
      `In the 12 months ${window}, ${u1.short} published ${fmtInt(u1.recent)} final rules in the Federal Register, ${fmtTimes(u1.ratio)} its yearly average of ${fmtDec(u1.base, 1)} for ${baseWindow}; ${u2.short} published ${fmtInt(u2.recent)} against ${fmtDec(u2.base, 1)}.`,
      `At the other end, ${d1.short} published ${fmtInt(d1.recent)} against an average of ${fmtDec(d1.base, 1)} (${fmtPct(100 * d1.ratio, 0)} of normal), and ${d2.short} ${fmtInt(d2.recent)} against ${fmtDec(d2.base, 1)}.`,
      `${rows.filter((r) => r.ratio > 1).length} of the ${rows.length} tracked agencies published more final rules than their yearly average and ${rows.filter((r) => r.ratio < 1).length} fewer.`,
    ],
    points: [
      {
        label: `${u1.short}: final rules, latest 12 months`,
        value: fmtInt(u1.recent),
        note: `average ${fmtDec(u1.base, 1)}`,
        href: link(u1.slug),
      },
      {
        label: `${u2.short}: final rules, latest 12 months`,
        value: fmtInt(u2.recent),
        note: `average ${fmtDec(u2.base, 1)}`,
        href: link(u2.slug),
      },
      {
        label: `${d1.short}: final rules, latest 12 months`,
        value: fmtInt(d1.recent),
        note: `average ${fmtDec(d1.base, 1)}`,
        href: link(d1.slug),
      },
      {
        label: `${d2.short}: final rules, latest 12 months`,
        value: fmtInt(d2.recent),
        note: `average ${fmtDec(d2.base, 1)}`,
        href: link(d2.slug),
      },
    ],
    caveat: `Counts are Federal Register documents of type Rule, which include routine technical and administrative rules, for the ${rows.length} agencies tracked. A count says how active an agency was, not how significant its rules were.`,
    sources: [{ label: "Federal Register", href: "https://www.federalregister.gov/" }],
    dataThrough: window.replace(/^.* to /, ""),
    score: 64,
  });
  return out ? [out] : [];
}
