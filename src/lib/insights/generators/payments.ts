/**
 * Industry payments insights from CMS Open Payments (datasets company_payments_manufacturers and
 * company_payments_states, already validated by openPayments.functions). Payments are as reported by drug and
 * device manufacturers to CMS, by program year. A payment is a disclosure; it is not evidence of influence or
 * wrongdoing, and the wording says so.
 */
import type { ManufacturerPayments, StatePayments } from "@/lib/external/openPayments.functions";
import { makeInsight } from "../build";
import {
  clip,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSignedPct,
  fmtTimes,
  fmtWords,
  isNum,
  median,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
} from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "payments";
const SOURCES: InsightSourceLink[] = [
  { label: "CMS Open Payments data", href: "https://openpaymentsdata.cms.gov/" },
];
const DISCLOSURE =
  "Figures are payments as reported by manufacturers to CMS; a reported payment is not evidence of influence or wrongdoing.";

export type PaymentsInput = {
  national: StatePayments | null;
  states: StatePayments[];
  manufacturers: ManufacturerPayments[];
  /** state -> { "YYYY": residents } from the Census series in state_metrics_profiles, when published. */
  population: Record<string, Record<string, number>> | null;
};

const general = (y: { general: number | null } | undefined) =>
  isNum(y?.general) ? y!.general : null;
const yearRow = <T extends { year: number }>(rows: T[], year: number) =>
  rows.find((r) => r.year === year);

export function generatePaymentsInsights(d: PaymentsInput): Insight[] {
  const out: (Insight | null)[] = [];
  const nat = d.national;
  if (!nat) return [];
  const years = nat.years.filter((y) => isNum(y.general) && isNum(y.research)).map((y) => y.year);
  const L = years.length ? Math.max(...years) : null;
  if (L == null) return [];
  const cur = yearRow(nat.years, L);
  const prev = yearRow(nat.years, L - 1);
  const first = [...nat.years].filter((y) => isNum(y.general)).sort((a, b) => a.year - b.year)[0];
  if (!cur || !isNum(cur.general) || !isNum(cur.research)) return [];

  // 1. National trend
  if (
    prev &&
    isNum(prev.general) &&
    isNum(prev.research) &&
    first &&
    isNum(first.general) &&
    first.year < L
  ) {
    const gp = pctChange(cur.general, prev.general);
    const rp = pctChange(cur.research, prev.research);
    const sinceFirst = pctChange(cur.general, first.general);
    if (gp != null && rp != null && sinceFirst != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "national-payments",
          kind: "trend",
          headline: `Manufacturers reported ${fmtMoney(cur.general)} in general payments to clinicians in ${L}, ${moved(gp)} from ${L - 1}`,
          summary: [
            `For program year ${L}, drug and device manufacturers reported ${fmtMoney(cur.general)} in general payments (fees, meals, travel, royalties and similar), compared with ${fmtMoney(prev.general)} in ${L - 1}.`,
            `Research payments were ${fmtMoney(cur.research)}, ${moved(rp)} from ${fmtMoney(prev.research)}.`,
            `General payments in ${L} are ${moved(sinceFirst, 0)} compared with ${first.year} (${fmtMoney(first.general)}).`,
            isNum(cur.generalRecords)
              ? `They were reported in ${fmtWords(cur.generalRecords)} payment records.`
              : null,
          ],
          points: [
            {
              label: `General payments, ${L}`,
              value: fmtMoney(cur.general),
              note: fmtSignedPct(gp),
            },
            { label: `General payments, ${L - 1}`, value: fmtMoney(prev.general) },
            {
              label: `Research payments, ${L}`,
              value: fmtMoney(cur.research),
              note: fmtSignedPct(rp),
            },
            { label: `General payments, ${first.year}`, value: fmtMoney(first.general) },
            isNum(cur.generalRecords)
              ? { label: `Payment records, ${L}`, value: fmtInt(cur.generalRecords) }
              : null,
          ],
          caveat: DISCLOSURE,
          sources: SOURCES,
          dataThrough: `Program year ${L}`,
          score: 80,
        }),
      );

    // 3. Research versus general
    const totalNow = cur.general + cur.research;
    const totalFirst = first.general + (isNum(first.research) ? first.research : NaN);
    const shareNow = sharePct(cur.research, totalNow);
    const shareFirst = sharePct(first.research, totalFirst);
    if (shareNow != null && shareFirst != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "research-share",
          kind: "mix_shift",
          headline: `Research payments were ${fmtPct(shareNow, 0)} of all reported payments in ${L}, compared with ${fmtPct(shareFirst, 0)} in ${first.year}`,
          summary: [
            `Of ${fmtMoney(totalNow)} in combined general and research payments for ${L}, ${fmtMoney(cur.research)} (${fmtPct(shareNow)}) went to research and ${fmtMoney(cur.general)} to general payments.`,
            `In ${first.year}, research was ${fmtPct(shareFirst)} of ${fmtMoney(totalFirst)}.`,
            `Research payments fund studies and are usually paid to institutions or study teams; general payments go to individual clinicians and teaching hospitals.`,
          ],
          points: [
            { label: `Research share, ${L}`, value: fmtPct(shareNow) },
            { label: `Research share, ${first.year}`, value: fmtPct(shareFirst) },
            { label: `Research payments, ${L}`, value: fmtMoney(cur.research) },
            { label: `General payments, ${L}`, value: fmtMoney(cur.general) },
          ],
          caveat: DISCLOSURE,
          sources: SOURCES,
          dataThrough: `Program year ${L}`,
          score: 54,
        }),
      );
  }

  // 2. Concentration among the listed manufacturers
  const makers = d.manufacturers.flatMap((m) => {
    const y = yearRow(m.years, L);
    return y && isNum(y.general)
      ? [{ m, now: y.general, before: general(yearRow(m.years, L - 1)) }]
      : [];
  });
  const ranked = sortDesc(makers, (x) => x.now);
  const top10 = ranked.slice(0, 10);
  const [k1, k2, k3] = ranked;
  if (top10.length === 10 && k1 && k2 && k3 && cur.general > 0) {
    const share = sharePct(sum(top10.map((x) => x.now)), cur.general);
    if (share != null && share <= 100)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "manufacturer-concentration",
          kind: "concentration",
          headline: `Ten manufacturers account for ${fmtPct(share, 0)} of general payments reported for ${L}; ${titleCase(k1.m.name)} is largest`,
          summary: [
            `Among the ${fmtInt(makers.length)} manufacturers listed in the dataset, the ten with the highest ${L} general payments reported ${fmtMoney(sum(top10.map((x) => x.now)))}, ${fmtPct(share)} of the ${fmtMoney(cur.general)} national total.`,
            `${titleCase(k1.m.name)} reported ${fmtMoney(k1.now)}, ${titleCase(k2.m.name)} ${fmtMoney(k2.now)} and ${titleCase(k3.m.name)} ${fmtMoney(k3.now)}.`,
            `Research payments are reported separately and are not part of these figures.`,
          ],
          points: [
            {
              label: titleCase(k1.m.name),
              value: fmtMoney(k1.now),
              note: fmtPct(sharePct(k1.now, cur.general) ?? 0),
            },
            {
              label: titleCase(k2.m.name),
              value: fmtMoney(k2.now),
              note: fmtPct(sharePct(k2.now, cur.general) ?? 0),
            },
            {
              label: titleCase(k3.m.name),
              value: fmtMoney(k3.now),
              note: fmtPct(sharePct(k3.now, cur.general) ?? 0),
            },
            {
              label: "Top ten combined",
              value: fmtMoney(sum(top10.map((x) => x.now))),
              note: fmtPct(share),
            },
          ],
          caveat: `The dataset lists the ${fmtInt(makers.length)} largest manufacturers; smaller payers are inside the national total. ${DISCLOSURE}`,
          sources: SOURCES,
          dataThrough: `Program year ${L}`,
          score: 68,
        }),
      );
  }

  // 4. Biggest movers among manufacturers
  const moves = makers.flatMap((x) =>
    x.before != null && x.before >= 1_000_000
      ? [{ ...x, before: x.before, delta: x.now - x.before }]
      : [],
  );
  if (moves.length >= 10) {
    const up = sortDesc(moves, (x) => x.delta)[0];
    const down = sortAsc(moves, (x) => x.delta)[0];
    if (up && down && up.delta > 0 && down.delta < 0)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "manufacturer-movers",
          kind: "mover",
          headline: `${titleCase(up.m.name)} raised general payments most in ${L} (${fmtMoney(up.delta)} more); ${titleCase(down.m.name)} cut them most (${fmtMoney(Math.abs(down.delta))} less)`,
          summary: [
            `Among ${fmtInt(moves.length)} manufacturers that reported at least $1 million in general payments for ${L - 1}, ${titleCase(up.m.name)} showed the largest increase: ${fmtMoney(up.before)} to ${fmtMoney(up.now)} (${fmtSignedPct(pctChange(up.now, up.before) ?? 0, 0)}).`,
            `${titleCase(down.m.name)} showed the largest decrease: ${fmtMoney(down.before)} to ${fmtMoney(down.now)} (${fmtSignedPct(pctChange(down.now, down.before) ?? 0, 0)}).`,
            `${moves.filter((x) => x.delta > 0).length} of the ${moves.length} increased and ${moves.filter((x) => x.delta < 0).length} decreased.`,
          ],
          points: [
            {
              label: `Largest increase: ${titleCase(up.m.name)}`,
              value: fmtMoney(up.delta),
              note: `${fmtMoney(up.before)} to ${fmtMoney(up.now)}`,
            },
            {
              label: `Largest decrease: ${titleCase(down.m.name)}`,
              value: `-${fmtMoney(Math.abs(down.delta))}`,
              note: `${fmtMoney(down.before)} to ${fmtMoney(down.now)}`,
            },
            {
              label: "Manufacturers up / down",
              value: `${moves.filter((x) => x.delta > 0).length} / ${moves.filter((x) => x.delta < 0).length}`,
            },
          ],
          caveat: `A single large royalty, license or acquisition-related payment can account for a manufacturer's whole change. ${DISCLOSURE}`,
          sources: SOURCES,
          dataThrough: `Program year ${L}`,
          score: 62,
        }),
      );
  }

  // 5. Nature of payment
  const natures = (nat.natureByYear[String(L)] ?? []).filter((n) => n.amount > 0);
  const natureTotal = sum(natures.map((n) => n.amount));
  const sortedNature = sortDesc(natures, (n) => n.amount);
  const [n1, n2, n3] = sortedNature;
  if (n1 && n2 && n3 && natureTotal > 0)
    out.push(
      makeInsight({
        section: SECTION,
        slug: "payment-types",
        kind: "mix_shift",
        headline: `${clip(n1.label, 60)} made up ${fmtPct(sharePct(n1.amount, natureTotal) ?? 0, 0)} of general payments by value in ${L}`,
        summary: [
          `Sorted by what the payment was for, "${clip(n1.label, 90)}" was the largest category of ${L} general payments at ${fmtMoney(n1.amount)} (${fmtPct(sharePct(n1.amount, natureTotal) ?? 0)}).`,
          `"${clip(n2.label, 90)}" followed at ${fmtMoney(n2.amount)} and "${clip(n3.label, 90)}" at ${fmtMoney(n3.amount)}.`,
          `The ${fmtInt(natures.length)} categories reported add up to ${fmtMoney(natureTotal)}.`,
        ],
        points: [
          {
            label: clip(n1.label, 52),
            value: fmtMoney(n1.amount),
            note: fmtPct(sharePct(n1.amount, natureTotal) ?? 0),
          },
          {
            label: clip(n2.label, 52),
            value: fmtMoney(n2.amount),
            note: fmtPct(sharePct(n2.amount, natureTotal) ?? 0),
          },
          {
            label: clip(n3.label, 52),
            value: fmtMoney(n3.amount),
            note: fmtPct(sharePct(n3.amount, natureTotal) ?? 0),
          },
          { label: "All categories", value: fmtMoney(natureTotal) },
        ],
        caveat: `Shares use the total of the categories CMS reports for the year. ${DISCLOSURE}`,
        sources: SOURCES,
        dataThrough: `Program year ${L}`,
        score: 58,
      }),
    );

  // 6. Payments per resident by state
  const pop = d.population;
  if (pop) {
    const perResident = d.states.flatMap((s) => {
      const amount = general(yearRow(s.years, L));
      const residents = pop[s.state]?.[String(L)];
      return amount != null && isNum(residents) && residents > 0
        ? [{ s, amount, residents, rate: amount / residents }]
        : [];
    });
    if (perResident.length >= 45) {
      const desc = sortDesc(perResident, (x) => x.rate);
      const [a, b, c] = desc;
      const mid = median(perResident.map((x) => x.rate));
      const low = desc[desc.length - 1];
      if (a && b && c && low && mid != null && mid > 0)
        out.push(
          makeInsight({
            section: SECTION,
            slug: "state-per-resident",
            kind: "outlier",
            headline: `General payments per resident in ${L} were highest in ${a.s.name} ($${fmtInt(a.rate)}) and lowest in ${low.s.name} ($${fmtInt(low.rate)})`,
            summary: [
              `Dividing ${L} general payments to recipients in each state by its Census July 1 population, ${a.s.name} had $${fmtInt(a.rate)} per resident (${fmtMoney(a.amount)} in total), followed by ${b.s.name} ($${fmtInt(b.rate)}) and ${c.s.name} ($${fmtInt(c.rate)}).`,
              `The middle state (the median) had $${fmtInt(mid)} per resident, and ${low.s.name} had $${fmtInt(low.rate)}.`,
              `${a.s.name}'s rate was ${fmtTimes(a.rate / mid)} the median.`,
            ],
            points: [
              {
                label: a.s.name,
                value: `$${fmtInt(a.rate)}`,
                note: fmtMoney(a.amount),
                href: `/places/${a.s.state}`,
              },
              { label: b.s.name, value: `$${fmtInt(b.rate)}`, href: `/places/${b.s.state}` },
              { label: c.s.name, value: `$${fmtInt(c.rate)}`, href: `/places/${c.s.state}` },
              { label: "Median state", value: `$${fmtInt(mid)}` },
              { label: low.s.name, value: `$${fmtInt(low.rate)}`, href: `/places/${low.s.state}` },
            ],
            caveat: `State is the recipient's reported address, so teaching hospitals and large royalty or license payments can dominate a state's total. ${DISCLOSURE}`,
            sources: SOURCES,
            dataThrough: `Program year ${L}`,
            score: 60,
          }),
        );
    }
  }

  // 7. Reporting companies
  const entities = Object.entries(nat.reportingEntities)
    .map(([y, n]) => ({ year: Number(y), n }))
    .filter((e) => Number.isInteger(e.year) && isNum(e.n))
    .sort((a, b) => a.year - b.year);
  const eNow = entities.find((e) => e.year === L);
  const ePrev = entities.find((e) => e.year === L - 1);
  const eFirst = entities[0];
  const ePeak = sortDesc(entities, (e) => e.n)[0];
  if (eNow && ePrev && eFirst && ePeak && entities.length >= 4 && eFirst.year < L - 1)
    out.push(
      makeInsight({
        section: SECTION,
        slug: "reporting-companies",
        kind: "coverage",
        headline: `${fmtInt(eNow.n)} companies reported payments for ${L}, ${eNow.n < ePrev.n ? "down" : "up"} from ${fmtInt(ePrev.n)} the year before`,
        summary: [
          `CMS counts ${fmtInt(eNow.n)} reporting entities (drug and device manufacturers and group purchasing organizations) in the ${L} program year, against ${fmtInt(ePrev.n)} in ${L - 1} and ${fmtInt(eFirst.n)} in ${eFirst.year}.`,
          ePeak.year !== L
            ? `The highest count in the series was ${fmtInt(ePeak.n)} in ${ePeak.year}.`
            : `${L} is the highest count in the series.`,
          `Dollar totals can rise or fall with this number as well as with each company's own spending.`,
        ],
        points: [
          { label: `Reporting entities, ${L}`, value: fmtInt(eNow.n) },
          { label: `Reporting entities, ${L - 1}`, value: fmtInt(ePrev.n) },
          { label: `Reporting entities, ${eFirst.year}`, value: fmtInt(eFirst.n) },
          { label: `Highest: ${ePeak.year}`, value: fmtInt(ePeak.n) },
        ],
        caveat:
          "Entity counts come from the CMS Open Payments dashboard and cover the years it publishes.",
        sources: SOURCES,
        dataThrough: `Program year ${L}`,
        score: 44,
      }),
    );
  return out.filter((i): i is Insight => i !== null);
}

/** "PFIZER INC." -> "Pfizer Inc."; keeps vowel-less short tokens (LLC, LP), tokens with digits or "&" as printed. */
export function titleCase(name: string): string {
  const small = new Set(["and", "of", "the", "for", "de"]);
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      if (/[\d&]/.test(w)) return w;
      if (/^[A-Z.,]{2,5}$/.test(w) && !/[AEIOU]/.test(w)) return w;
      if (/^(SE|AG|SA|NV|BV|PLC|LLC|LLP|LP|KK|AB|AS|SRL|SPA|GMBH)[.,]?$/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
