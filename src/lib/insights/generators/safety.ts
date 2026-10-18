/**
 * Product safety insights from published agency report series. Five generators, one per source:
 *   - generateFaersInsights:  FDA drug adverse-event reports, national totals and tracked mass-tort drugs/biologics
 *   - generateMaudeInsights:  FDA device adverse-event reports (MAUDE), national mix and tracked mass-tort devices
 *   - generateCaersInsights:  FDA food, supplement and cosmetic adverse-event reports (CAERS)
 *   - generateCpscInsights:   CPSC recall announcements by year, hazard and country of manufacture
 *   - generateNhtsaInsights:  NHTSA vehicle complaints by make (make/component pairs with 100+ complaints)
 * Every count is a count of reports or recalls. A report says a product was mentioned with an event, not that
 * the product caused it, and counts cannot be turned into rates without exposure data.
 */
import type { CpscAnalytics } from "@/lib/external/enforcement.functions";
import { makeInsight } from "../build";
import {
  clip,
  fmtInt,
  fmtPct,
  fmtSignedInt,
  fmtSignedPct,
  fmtWords,
  isNum,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
} from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "safety";
const REPORTS_NOT_INCIDENCE =
  "Reports are not incidence: a report says a product was mentioned with an adverse event, not that it caused the event, and reporting rises with publicity and litigation.";

// ---------------------------------------------------------------- FAERS

export type ReportYear = {
  year: number;
  reports: number;
  partial: boolean;
  deaths?: number | null;
  serious?: number | null;
  lawyer?: number | null;
};
export type FaersInput = {
  dataThrough: string | null;
  national: ReportYear[];
  products: {
    id: string;
    product: string;
    mdl: number | null;
    years: ReportYear[];
    peak: { year: number; reports: number } | null;
  }[];
};
const FAERS_SOURCES: InsightSourceLink[] = [
  { label: "openFDA drug adverse events (FAERS)", href: "https://open.fda.gov/apis/drug/event/" },
];

const lastComplete = (years: ReportYear[]) =>
  [...years].sort((a, b) => b.year - a.year).find((y) => !y.partial);
const yearOf = (years: ReportYear[], year: number) =>
  years.find((y) => y.year === year && !y.partial);

export function generateFaersInsights(d: FaersInput): Insight[] {
  const out: (Insight | null)[] = [];
  const cur = lastComplete(d.national);
  const prev = cur ? yearOf(d.national, cur.year - 1) : undefined;
  if (!cur || !prev) return [];
  const L = cur.year;
  const pct = pctChange(cur.reports, prev.reports);
  const peak = sortDesc(
    d.national.filter((y) => !y.partial),
    (y) => y.reports,
  )[0];
  const first = Math.min(...d.national.map((y) => y.year));
  const through = d.dataThrough ?? undefined;

  if (pct != null && peak)
    out.push(
      makeInsight({
        section: SECTION,
        slug: "faers-national",
        kind: "trend",
        headline: `FDA received ${fmtWords(cur.reports)} drug adverse-event reports in ${L}, ${moved(pct)} from ${L - 1}`,
        summary: [
          `FAERS holds ${fmtInt(cur.reports)} reports with a ${L} receive date, compared with ${fmtInt(prev.reports)} in ${L - 1}.`,
          isNum(cur.deaths) && isNum(cur.serious)
            ? `${fmtInt(cur.deaths)} (${fmtPct(sharePct(cur.deaths, cur.reports) ?? 0)}) listed death among the outcomes and ${fmtInt(cur.serious)} (${fmtPct(sharePct(cur.serious, cur.reports) ?? 0)}) were classed as serious.`
            : null,
          peak.year !== L
            ? `The highest complete year since ${first} was ${peak.year}, with ${fmtInt(peak.reports)} reports.`
            : `${L} is the highest complete year since ${first}.`,
          isNum(cur.lawyer)
            ? `${fmtInt(cur.lawyer)} of the ${L} reports (${fmtPct(sharePct(cur.lawyer, cur.reports) ?? 0)}) came from lawyers.`
            : null,
        ],
        points: [
          { label: `Reports, ${L}`, value: fmtInt(cur.reports), note: fmtSignedPct(pct) },
          { label: `Reports, ${L - 1}`, value: fmtInt(prev.reports) },
          isNum(cur.deaths)
            ? { label: `Reports listing death, ${L}`, value: fmtInt(cur.deaths) }
            : null,
          isNum(cur.serious)
            ? { label: `Serious reports, ${L}`, value: fmtInt(cur.serious) }
            : null,
          { label: `Highest year: ${peak.year}`, value: fmtInt(peak.reports) },
        ],
        caveat: REPORTS_NOT_INCIDENCE,
        sources: FAERS_SOURCES,
        dataThrough: through ?? String(L),
        score: 72,
      }),
    );

  // Tracked mass-tort drugs and biologics
  const tracked = d.products.flatMap((p) => {
    const y = yearOf(p.years, L);
    const before = yearOf(p.years, L - 1);
    return y ? [{ p, now: y.reports, before: before?.reports ?? null }] : [];
  });
  const ranked = sortDesc(tracked, (t) => t.now);
  const [a, b, c] = ranked;
  if (a && b && c && cur.reports > 0 && a.now > 0) {
    const combined = sum(tracked.map((t) => t.now));
    out.push(
      makeInsight({
        section: SECTION,
        slug: "faers-tracked-products",
        kind: "leader",
        headline: `Among ${fmtInt(tracked.length)} tracked mass-tort drugs, ${a.p.product} had the most FDA adverse-event reports in ${L} (${fmtInt(a.now)})`,
        summary: [
          `Of the ${fmtInt(tracked.length)} drugs and biologics tied to product-liability MDLs in this dataset, ${a.p.product} had the most FAERS reports received in ${L} (${fmtInt(a.now)}), followed by ${b.p.product} (${fmtInt(b.now)}) and ${c.p.product} (${fmtInt(c.now)}).`,
          `Together the tracked products account for ${fmtInt(combined)} of the ${fmtInt(cur.reports)} reports received in ${L} (${fmtPct(sharePct(combined, cur.reports) ?? 0)}).`,
          a.p.peak
            ? `${a.p.product} reports peaked in ${a.p.peak.year} at ${fmtInt(a.p.peak.reports)}.`
            : null,
        ],
        points: [
          {
            label: a.p.product,
            value: fmtInt(a.now),
            note: a.p.mdl ? `MDL ${a.p.mdl}` : undefined,
            href: a.p.mdl ? `/matters/lens/${a.p.mdl}` : undefined,
          },
          {
            label: b.p.product,
            value: fmtInt(b.now),
            note: b.p.mdl ? `MDL ${b.p.mdl}` : undefined,
            href: b.p.mdl ? `/matters/lens/${b.p.mdl}` : undefined,
          },
          {
            label: c.p.product,
            value: fmtInt(c.now),
            note: c.p.mdl ? `MDL ${c.p.mdl}` : undefined,
            href: c.p.mdl ? `/matters/lens/${c.p.mdl}` : undefined,
          },
          {
            label: "All tracked products",
            value: fmtInt(combined),
            note: fmtPct(sharePct(combined, cur.reports) ?? 0),
          },
        ],
        caveat: `${REPORTS_NOT_INCIDENCE} Only products matched to an MDL in this dataset are tracked; a drug with many users will have more reports.`,
        sources: FAERS_SOURCES,
        dataThrough: through ?? String(L),
        score: 66,
      }),
    );
  }

  // Movers among tracked products
  const movers = tracked.flatMap((t) => {
    const change = pctChange(t.now, t.before);
    return t.before != null && t.before >= 500 && change != null ? [{ ...t, change }] : [];
  });
  if (movers.length >= 5) {
    const up = sortDesc(movers, (m) => m.change);
    const down = sortAsc(movers, (m) => m.change);
    const [u1, u2] = up;
    const d1 = down[0];
    if (u1 && u2 && d1 && u1.change > 0 && d1.change < 0)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "faers-product-movers",
          kind: "mover",
          headline: `FDA reports for ${u1.p.product} rose ${fmtPct(u1.change, 0)} in ${L}; reports for ${d1.p.product} fell ${fmtPct(Math.abs(d1.change), 0)}`,
          summary: [
            `Among the ${fmtInt(movers.length)} tracked drugs with at least 500 reports in ${L - 1}, ${u1.p.product} rose most: ${fmtInt(u1.before!)} reports in ${L - 1} to ${fmtInt(u1.now)} in ${L}.`,
            `${u2.p.product} rose ${fmtPct(u2.change, 0)} (${fmtInt(u2.before!)} to ${fmtInt(u2.now)}). ${d1.p.product} fell most, from ${fmtInt(d1.before!)} to ${fmtInt(d1.now)}.`,
            `${movers.filter((m) => m.change > 0).length} of the ${movers.length} rose and ${movers.filter((m) => m.change < 0).length} fell.`,
          ],
          points: [
            {
              label: `Largest rise: ${u1.p.product}`,
              value: fmtSignedPct(u1.change, 0),
              note: `${fmtInt(u1.before!)} to ${fmtInt(u1.now)}`,
            },
            {
              label: `Next: ${u2.p.product}`,
              value: fmtSignedPct(u2.change, 0),
              note: `${fmtInt(u2.before!)} to ${fmtInt(u2.now)}`,
            },
            {
              label: `Largest fall: ${d1.p.product}`,
              value: fmtSignedPct(d1.change, 0),
              note: `${fmtInt(d1.before!)} to ${fmtInt(d1.now)}`,
            },
            { label: "Products compared", value: fmtInt(movers.length) },
          ],
          caveat: `${REPORTS_NOT_INCIDENCE} A rise often follows litigation or news coverage rather than a change in safety.`,
          sources: FAERS_SOURCES,
          dataThrough: through ?? String(L),
          score: 64,
        }),
      );
  }
  return out.filter((i): i is Insight => i !== null);
}

// ---------------------------------------------------------------- MAUDE

export type MaudeYear = ReportYear & { death: number; injury: number; malfunction: number };
export type MaudeInput = {
  dataThrough: string | null;
  total: number | null;
  mix: { label: string; count: number; share: number }[];
  national: MaudeYear[];
  devices: {
    id: string;
    product: string;
    mdl: number | null;
    years: ReportYear[];
    peak: { year: number; reports: number } | null;
  }[];
};
const MAUDE_SOURCES: InsightSourceLink[] = [
  {
    label: "openFDA device adverse events (MAUDE)",
    href: "https://api.fda.gov/device/event.json?count=date_received",
  },
];

export function generateMaudeInsights(d: MaudeInput): Insight[] {
  const out: (Insight | null)[] = [];
  const through = d.dataThrough ?? undefined;
  const mix = Object.fromEntries(d.mix.map((m) => [m.label, m]));
  const mal = mix["Malfunction"];
  const inj = mix["Injury"];
  const dea = mix["Death"];
  const complete = d.national.filter((y) => !y.partial).sort((a, b) => b.year - a.year);
  const cur = complete[0];
  const prev = cur ? complete.find((y) => y.year === cur.year - 1) : undefined;
  const firstYear = d.national.length ? Math.min(...d.national.map((y) => y.year)) : null;

  if (mal && inj && dea && isNum(d.total) && d.total > 0 && cur && prev && firstYear != null) {
    const pct = pctChange(cur.reports, prev.reports);
    if (pct != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "maude-event-mix",
          kind: "mix_shift",
          headline: `${fmtPct(mal.share * 100, 0)} of FDA device adverse-event reports describe malfunctions; ${fmtPct(inj.share * 100, 0)} describe injuries and ${fmtPct(dea.share * 100, 1)} deaths`,
          summary: [
            `MAUDE holds ${fmtInt(d.total)} device reports received from ${firstYear} onward: ${fmtInt(mal.count)} malfunctions, ${fmtInt(inj.count)} injuries and ${fmtInt(dea.count)} listing a death.`,
            `In ${cur.year}, ${fmtInt(cur.reports)} reports were received, ${moved(pct)} from ${prev.year} (${fmtInt(prev.reports)}).`,
            sharePct(cur.injury, cur.reports) != null
              ? `Injury reports were ${fmtPct(sharePct(cur.injury, cur.reports)!)} of the ${cur.year} total and malfunctions ${fmtPct(sharePct(cur.malfunction, cur.reports) ?? 0)}.`
              : null,
          ],
          points: [
            {
              label: "Malfunction reports",
              value: fmtInt(mal.count),
              note: fmtPct(mal.share * 100),
            },
            { label: "Injury reports", value: fmtInt(inj.count), note: fmtPct(inj.share * 100) },
            { label: "Death reports", value: fmtInt(dea.count), note: fmtPct(dea.share * 100, 2) },
            {
              label: `Reports received, ${cur.year}`,
              value: fmtInt(cur.reports),
              note: fmtSignedPct(pct),
            },
          ],
          caveat: `${REPORTS_NOT_INCIDENCE} Manufacturers file most reports, and a malfunction report does not mean a patient was harmed.`,
          sources: MAUDE_SOURCES,
          dataThrough: through ?? String(cur.year),
          score: 60,
        }),
      );
  }

  const L = cur?.year;
  if (L != null) {
    const tracked = d.devices.flatMap((p) => {
      const y = yearOf(p.years, L);
      return y ? [{ p, now: y.reports }] : [];
    });
    const ranked = sortDesc(tracked, (t) => t.now);
    const [a, b, c] = ranked;
    if (a && b && c && a.now > 0) {
      const peakRatio = a.p.peak && a.p.peak.reports > 0 ? sharePct(a.now, a.p.peak.reports) : null;
      out.push(
        makeInsight({
          section: SECTION,
          slug: "maude-tracked-devices",
          kind: "leader",
          headline: `Among ${fmtInt(tracked.length)} tracked mass-tort devices, ${clip(a.p.product, 50)} drew the most FDA device reports in ${L} (${fmtInt(a.now)})`,
          summary: [
            `Of the ${fmtInt(tracked.length)} devices tied to product-liability MDLs in this dataset, ${a.p.product} had the most MAUDE reports received in ${L} (${fmtInt(a.now)}), followed by ${b.p.product} (${fmtInt(b.now)}) and ${c.p.product} (${fmtInt(c.now)}).`,
            a.p.peak
              ? `${a.p.product} reports peaked in ${a.p.peak.year} at ${fmtInt(a.p.peak.reports)}${peakRatio != null && a.p.peak.year !== L ? `, so ${L} is ${fmtPct(peakRatio, 0)} of the peak` : ""}.`
              : null,
            `Together the tracked devices account for ${fmtInt(sum(tracked.map((t) => t.now)))} of the ${fmtInt(cur?.reports ?? 0)} device reports received in ${L}.`,
          ],
          points: [
            {
              label: clip(a.p.product, 46),
              value: fmtInt(a.now),
              note: a.p.mdl ? `MDL ${a.p.mdl}` : undefined,
              href: a.p.mdl ? `/matters/lens/${a.p.mdl}` : undefined,
            },
            {
              label: clip(b.p.product, 46),
              value: fmtInt(b.now),
              note: b.p.mdl ? `MDL ${b.p.mdl}` : undefined,
              href: b.p.mdl ? `/matters/lens/${b.p.mdl}` : undefined,
            },
            {
              label: clip(c.p.product, 46),
              value: fmtInt(c.now),
              note: c.p.mdl ? `MDL ${c.p.mdl}` : undefined,
              href: c.p.mdl ? `/matters/lens/${c.p.mdl}` : undefined,
            },
            { label: "Tracked devices", value: fmtInt(tracked.length) },
          ],
          caveat: `${REPORTS_NOT_INCIDENCE} Counts depend on how each device's brand names were matched; they are a floor, not a total.`,
          sources: MAUDE_SOURCES,
          dataThrough: through ?? String(L),
          score: 58,
        }),
      );
    }
  }
  return out.filter((i): i is Insight => i !== null);
}

// ---------------------------------------------------------------- CAERS

export type CaersInput = {
  dataThrough: string | null;
  total: number | null;
  years: ReportYear[];
  industries: { name: string; reports: number }[];
};
const CAERS_SOURCES: InsightSourceLink[] = [
  {
    label: "openFDA food adverse events (CAERS)",
    href: "https://api.fda.gov/food/event.json?count=date_created",
  },
];

export function generateCaersInsights(d: CaersInput): Insight[] {
  const cur = lastComplete(d.years);
  if (!cur) return [];
  const L = cur.year;
  const prev = yearOf(d.years, L - 1);
  const before = yearOf(d.years, L - 2);
  if (!prev || !before) return [];
  const pct = pctChange(cur.reports, prev.reports);
  const prevPct = pctChange(prev.reports, before.reports);
  const top = sortDesc(d.industries, (i) => i.reports).slice(0, 3);
  if (pct == null || prevPct == null) return [];
  const topShare =
    isNum(d.total) && top.length === 3 ? sharePct(sum(top.map((t) => t.reports)), d.total) : null;
  const out = makeInsight({
    section: SECTION,
    slug: "caers-trend",
    kind: "trend",
    headline: `FDA food, supplement and cosmetic complaint reports were ${fmtInt(cur.reports)} in ${L}, ${moved(pct, 0)} from ${L - 1}`,
    summary: [
      `CAERS received ${fmtInt(cur.reports)} reports in ${L}, compared with ${fmtInt(prev.reports)} in ${L - 1} and ${fmtInt(before.reports)} in ${L - 2}.`,
      `That is ${moved(pct)} for ${L} after a change of ${fmtSignedPct(prevPct)} the year before.`,
      isNum(cur.deaths)
        ? `${fmtInt(cur.deaths)} of the ${L} reports (${fmtPct(sharePct(cur.deaths, cur.reports) ?? 0)}) listed death among the outcomes.`
        : null,
      topShare != null
        ? `Across all years, ${joinNames(top.map((t) => t.name))} account for ${fmtPct(topShare, 0)} of the ${fmtInt(d.total!)} reports on file.`
        : null,
    ],
    points: [
      { label: `Reports, ${L}`, value: fmtInt(cur.reports), note: fmtSignedPct(pct) },
      { label: `Reports, ${L - 1}`, value: fmtInt(prev.reports), note: fmtSignedPct(prevPct) },
      { label: `Reports, ${L - 2}`, value: fmtInt(before.reports) },
      isNum(cur.deaths)
        ? { label: `Reports listing death, ${L}`, value: fmtInt(cur.deaths) }
        : null,
      isNum(d.total) ? { label: "All reports on file", value: fmtInt(d.total) } : null,
    ],
    caveat: `${REPORTS_NOT_INCIDENCE} CAERS is voluntary for consumers, so volumes track awareness as much as problems.`,
    sources: CAERS_SOURCES,
    dataThrough: d.dataThrough ?? String(L),
    score: 52,
  });
  return out ? [out] : [];
}

const joinNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names
        .slice(0, -1)
        .map((n) => clip(n, 40))
        .join(", ")} and ${clip(names[names.length - 1]!, 40)}`;

// ---------------------------------------------------------------- CPSC

const CPSC_SOURCES: InsightSourceLink[] = [
  {
    label: "CPSC Recalls API",
    href: "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information",
  },
];

export function generateCpscInsights(d: CpscAnalytics): Insight[] {
  const out: (Insight | null)[] = [];
  const complete = d.years.filter((y) => !y.partial).sort((a, b) => b.year - a.year);
  const cur = complete[0];
  const prev = cur ? complete.find((y) => y.year === cur.year - 1) : undefined;
  if (!cur || !prev) return [];
  const L = cur.year;
  const open = d.years.find((y) => y.partial && y.year > L);
  const pct = pctChange(cur.recalls, prev.recalls);
  const asOf = d.asOf ?? undefined;

  if (pct != null && cur.recalls > 0)
    out.push(
      makeInsight({
        section: SECTION,
        slug: "cpsc-recalls",
        kind: "mover",
        headline: `The CPSC announced ${fmtInt(cur.recalls)} product recalls in ${L}, ${moved(pct, 0)} from ${L - 1}${open ? `; ${open.year} has already reached ${fmtInt(open.recalls)}` : ""}`,
        summary: [
          `The Consumer Product Safety Commission announced ${fmtInt(cur.recalls)} recalls in ${L}, compared with ${fmtInt(prev.recalls)} in ${L - 1}.`,
          open
            ? `${open.year} is not over: ${fmtInt(open.recalls)} recalls were listed by ${asOf ?? "the latest update"}${open.recalls > cur.recalls ? ", already more than in all of " + L : ""}.`
            : null,
          cur.unitsParsed > 0
            ? `For ${fmtInt(cur.unitsParsed)} of the ${L} recalls the notice states how many units were affected, adding up to ${fmtWords(cur.unitsSum)}.`
            : null,
        ],
        points: [
          { label: `Recalls, ${L}`, value: fmtInt(cur.recalls), note: fmtSignedPct(pct) },
          { label: `Recalls, ${L - 1}`, value: fmtInt(prev.recalls) },
          open
            ? {
                label: `${open.year} so far`,
                value: fmtInt(open.recalls),
                note: asOf ? `to ${asOf}` : undefined,
              }
            : null,
          cur.unitsParsed > 0
            ? {
                label: `Units stated, ${L}`,
                value: fmtWords(cur.unitsSum),
                note: `${fmtInt(cur.unitsParsed)} recalls`,
              }
            : null,
        ],
        caveat:
          "A recall count measures announcements, not the number of products or injuries; unit totals include only notices that state a quantity.",
        sources: CPSC_SOURCES,
        dataThrough: asOf ?? String(L),
        score: 76,
      }),
    );

  // Hazards
  const labels = d.hazardLabels;
  const hazards = Object.entries(cur.hazards)
    .filter(([key]) => key !== "other" && labels[key])
    .map(([key, count]) => ({ key, label: labels[key]!, count, before: prev.hazards[key] ?? 0 }));
  const topH = sortDesc(hazards, (h) => h.count);
  const [h1, h2, h3] = topH;
  const rise = sortDesc(
    hazards.filter((h) => h.count - h.before > 0),
    (h) => h.count - h.before,
  )[0];
  if (h1 && h2 && h3 && cur.recalls > 0 && rise)
    out.push(
      makeInsight({
        section: SECTION,
        slug: "cpsc-hazards",
        kind: "mix_shift",
        headline: `${h1.label} was the most common hazard in ${L} CPSC recalls (${fmtPct(sharePct(h1.count, cur.recalls) ?? 0, 0)}); ${rise.label.toLowerCase()} recalls rose from ${fmtInt(rise.before)} to ${fmtInt(rise.count)}`,
        summary: [
          `Of ${fmtInt(cur.recalls)} recalls announced in ${L}, ${fmtInt(h1.count)} (${fmtPct(sharePct(h1.count, cur.recalls) ?? 0)}) involved ${h1.label.toLowerCase()}, ${fmtInt(h2.count)} involved ${h2.label.toLowerCase()} and ${fmtInt(h3.count)} involved ${h3.label.toLowerCase()}.`,
          `The largest increase from ${L - 1} was in ${rise.label.toLowerCase()}, from ${fmtInt(rise.before)} to ${fmtInt(rise.count)} recalls.`,
          `A recall can fall under more than one hazard, so the shares add up to more than 100%.`,
        ],
        points: [
          {
            label: h1.label,
            value: fmtInt(h1.count),
            note: fmtPct(sharePct(h1.count, cur.recalls) ?? 0),
          },
          {
            label: h2.label,
            value: fmtInt(h2.count),
            note: fmtPct(sharePct(h2.count, cur.recalls) ?? 0),
          },
          {
            label: h3.label,
            value: fmtInt(h3.count),
            note: fmtPct(sharePct(h3.count, cur.recalls) ?? 0),
          },
          {
            label: `Largest rise: ${rise.label}`,
            value: fmtSignedInt(rise.count - rise.before),
            note: `${fmtInt(rise.before)} to ${fmtInt(rise.count)}`,
          },
        ],
        caveat:
          "Hazard categories are assigned by keyword rules applied to each recall's hazard text, not by the CPSC.",
        sources: CPSC_SOURCES,
        dataThrough: asOf ?? String(L),
        score: 62,
      }),
    );

  // Country of manufacture
  const countries = (y: typeof cur) =>
    Object.entries(y.countries).map(([country, count]) => ({ country, count }));
  const china = cur.countries["China"];
  const chinaPrev = prev.countries["China"];
  if (isNum(china) && isNum(chinaPrev) && cur.withCountry > 0 && prev.withCountry > 0) {
    const share = sharePct(china, cur.withCountry);
    const shareBefore = sharePct(chinaPrev, prev.withCountry);
    const us = cur.countries["United States"];
    const others = sortDesc(
      countries(cur).filter((c) => c.country !== "China"),
      (c) => c.count,
    );
    const [o1, o2] = others;
    if (share != null && shareBefore != null && o1 && o2)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "cpsc-origin",
          kind: "concentration",
          headline: `${fmtPct(share, 0)} of ${L} CPSC recalls named China as a country of manufacture, up from ${fmtPct(shareBefore, 0)} in ${L - 1}`,
          summary: [
            `Of ${fmtInt(cur.withCountry)} recalls in ${L} that name where the product was made, ${fmtInt(china)} (${fmtPct(share)}) list China, compared with ${fmtInt(chinaPrev)} of ${fmtInt(prev.withCountry)} (${fmtPct(shareBefore)}) in ${L - 1}.`,
            `The next most frequent are ${o1.country} (${fmtInt(o1.count)}) and ${o2.country} (${fmtInt(o2.count)})${isNum(us) ? `; ${fmtInt(us)} name the United States` : ""}.`,
            `A recall may name several countries, so the shares can add up to more than 100%.`,
          ],
          points: [
            { label: `China, ${L}`, value: fmtInt(china), note: fmtPct(share) },
            { label: `China, ${L - 1}`, value: fmtInt(chinaPrev), note: fmtPct(shareBefore) },
            { label: o1.country, value: fmtInt(o1.count) },
            { label: o2.country, value: fmtInt(o2.count) },
            isNum(us) ? { label: "United States", value: fmtInt(us) } : null,
          ],
          caveat:
            "Countries are as written in each recall notice; a manufacturing location is not a finding about product quality.",
          sources: CPSC_SOURCES,
          dataThrough: asOf ?? String(L),
          score: 56,
        }),
      );
  }
  return out.filter((i): i is Insight => i !== null);
}

// ---------------------------------------------------------------- NHTSA

export type NhtsaInput = {
  /** Last year with a full year of complaints (the file's final year is still filling in). */
  latestCompleteYear: number;
  rows: { make: string; component: string; total: number; years: Record<string, number> }[];
};
const NHTSA_SOURCES: InsightSourceLink[] = [
  { label: "NHTSA datasets and APIs", href: "https://www.nhtsa.gov/nhtsa-datasets-and-apis" },
];

export function generateNhtsaInsights(d: NhtsaInput): Insight[] {
  const L = d.latestCompleteYear;
  const byMake = new Map<string, { now: number; before: number }>();
  let pairsWithBoth = 0;
  for (const r of d.rows) {
    const now = r.years[String(L)];
    const before = r.years[String(L - 1)];
    if (!isNum(now) || !isNum(before)) continue;
    pairsWithBoth++;
    const cur = byMake.get(r.make) ?? { now: 0, before: 0 };
    cur.now += now;
    cur.before += before;
    byMake.set(r.make, cur);
  }
  const makes = [...byMake.entries()].map(([make, v]) => ({ make, ...v }));
  const top = sortDesc(makes, (m) => m.now);
  const [a, b, c] = top;
  const risers = sortDesc(
    makes.filter((m) => m.before >= 2000).map((m) => ({ ...m, pct: pctChange(m.now, m.before) })),
    (m) => m.pct,
  );
  const r1 = risers[0];
  if (!a || !b || !c || !r1 || r1.pct == null || r1.pct <= 0 || pairsWithBoth < 100) return [];
  const total = sum(makes.map((m) => m.now));
  const nice = (s: string) => (s.length <= 3 ? s : s.charAt(0) + s.slice(1).toLowerCase());
  const out = makeInsight({
    section: SECTION,
    slug: "nhtsa-complaints-by-make",
    kind: "leader",
    headline:
      r1.make === a.make
        ? `NHTSA complaints in ${L}: ${nice(a.make)} had the most (${fmtInt(a.now)}) and also rose most among larger makes (${fmtSignedPct(r1.pct, 0)})`
        : `NHTSA complaints in ${L}: ${nice(a.make)} had the most (${fmtInt(a.now)}); ${nice(r1.make)} rose most among larger makes (${fmtSignedPct(r1.pct, 0)})`,
    summary: [
      `Counting the make-and-component pairs that drew at least 100 NHTSA vehicle-safety complaints between 2020 and 2026, ${nice(a.make)} had the most complaints received in ${L} (${fmtInt(a.now)}), followed by ${nice(b.make)} (${fmtInt(b.now)}) and ${nice(c.make)} (${fmtInt(c.now)}).`,
      `${nice(r1.make)} rose most among makes with 2,000 or more such complaints in ${L - 1}: ${fmtInt(r1.before)} to ${fmtInt(r1.now)}.`,
      `The ${fmtInt(makes.length)} makes in the table account for ${fmtInt(total)} complaints in ${L}.`,
    ],
    points: [
      { label: nice(a.make), value: fmtInt(a.now), note: `${L - 1}: ${fmtInt(a.before)}` },
      { label: nice(b.make), value: fmtInt(b.now), note: `${L - 1}: ${fmtInt(b.before)}` },
      { label: nice(c.make), value: fmtInt(c.now), note: `${L - 1}: ${fmtInt(c.before)}` },
      {
        label: `Largest rise: ${nice(r1.make)}`,
        value: fmtSignedPct(r1.pct, 0),
        note: `${fmtInt(r1.before)} to ${fmtInt(r1.now)}`,
      },
    ],
    caveat: `Only make-and-component pairs with 100 or more complaints are published, so each make's figure is a floor. Complaints are reports from owners, and larger makes sell more vehicles. A complaint is not a finding of a defect.`,
    sources: NHTSA_SOURCES,
    dataThrough: String(L),
    score: 60,
  });
  return out ? [out] : [];
}
