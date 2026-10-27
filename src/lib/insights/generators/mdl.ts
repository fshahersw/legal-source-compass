/**
 * MDL and mass-tort analytics insights from the JPML monthly pending-MDL reports (dataset mdl_analytics)
 * and the JPML terminated-MDL history (dataset mdl_terminated_history). "Actions" are individual cases
 * listed in an MDL; "pending" means still open in the transferee court on the report date.
 */
import { makeInsight } from "../build";
import {
  clip,
  fmtInt,
  fmtPct,
  fmtSignedInt,
  fmtSignedPct,
  isNum,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
} from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "mdl";

export type MdlMover = { mdl: number; title: string; pending: number; change12m: number };
export type MdlGroup = {
  key: string;
  mdls: number;
  pending: number;
  total: number;
  change12m: number;
};
export type MdlPortfolioPoint = {
  date: string;
  pending: number;
  mdls: number;
  massTortPending: number;
  massTortMdls: number;
};
export type MdlRowLite = {
  mdl: number;
  title: string;
  type: string | null;
  status: "pending" | "terminated" | "no_longer_listed";
  pending: number;
  total: number;
  change12m: number | null;
  ageYears: number | null;
  rank: number | null;
  sharePct: number | null;
};
export type TerminatedLite = {
  mdl: number;
  caption: string;
  district: string;
  year: number;
  closed: number;
  remanded: number;
};
export type MdlInput = {
  asOf: string;
  reports: number;
  firstReport: string;
  pendingMdls: number;
  pendingActions: number;
  massTortMdls: number;
  massTortActions: number;
  top10SharePct: number | null;
  medianAgeYears: number | null;
  newMdlsInSeries: number | null;
  leftSeries: number | null;
  portfolio: MdlPortfolioPoint[];
  fastestGrowing: MdlMover[];
  fastestDeclining: MdlMover[];
  byType: MdlGroup[];
  byDistrict: MdlGroup[];
  rows: MdlRowLite[];
  terminated: TerminatedLite[];
};

const SOURCES: InsightSourceLink[] = [
  {
    label: "JPML pending MDL reports",
    href: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
  },
];
const mdlPage = (mdl: number) => `/matters/${mdl}`;
/** "MDL 3140 (Depo-Provera)": the MDL number plus a short, balanced version of the stored title. */
export function mdlName(mdl: number, title: string): string {
  let t = title
    .replace(/^IN RE:?\s*/i, "")
    .replace(/\s+Litigation\s*(\(No\.\s*[IVX]+\))?\s*$/i, "")
    .replace(/\s+Products Liability\s*$/i, "")
    .trim();
  if (t.length > 44 && t.includes(" (")) t = t.slice(0, t.indexOf(" (")).trim();
  t = clip(t || "title not recorded", 56);
  const open = (t.match(/\(/g) ?? []).length;
  const close = (t.match(/\)/g) ?? []).length;
  if (open > close) t = t.slice(0, t.lastIndexOf("(")).replace(/[\s\u2026]+$/, "");
  return `MDL ${mdl} (${t})`;
}
const mdlWord = (n: number) => (n === 1 ? "MDL" : "MDLs");

/** The same month one year earlier, as `YYYY-MM-DD`. */
function yearBefore(date: string): string | null {
  const m = /^(\d{4})(-\d{2}-\d{2})$/.exec(date);
  return m ? `${Number(m[1]) - 1}${m[2]}` : null;
}

export function generateMdlInsights(d: MdlInput): Insight[] {
  const out: (Insight | null)[] = [];
  const asOf = d.asOf;
  const pendingRows = d.rows.filter((r) => r.status === "pending");

  // 1. Pending actions over time
  const now = d.portfolio.find((p) => p.date === asOf);
  const yearAgoDate = yearBefore(asOf);
  const yearAgo = d.portfolio.find((p) => p.date === yearAgoDate);
  const first = d.portfolio[0];
  const peak = sortDesc(d.portfolio, (p) => p.pending)[0];
  if (now && first && first.date !== now.date && peak && now.pending === d.pendingActions) {
    const sinceFirst = pctChange(now.pending, first.pending);
    const sinceYear = yearAgo ? pctChange(now.pending, yearAgo.pending) : null;
    if (sinceFirst != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "pending-actions-trend",
          kind: "trend",
          headline: `Pending actions in federal MDLs stood at ${fmtInt(now.pending)} on ${asOf}, ${moved(sinceFirst, 0)} from ${first.date}`,
          summary: [
            `The JPML's ${asOf} report lists ${fmtInt(now.pending)} pending actions in ${fmtInt(now.mdls)} pending MDLs, compared with ${fmtInt(first.pending)} actions in ${fmtInt(first.mdls)} MDLs in the ${first.date} report.`,
            sinceYear != null && yearAgo
              ? `Over the last twelve months the total is ${moved(sinceYear)} (${fmtInt(yearAgo.pending)} on ${yearAgo.date}).`
              : null,
            peak.date !== now.date
              ? `The highest month in the ${fmtInt(d.reports)} reports was ${peak.date}, with ${fmtInt(peak.pending)} pending actions.`
              : `${asOf} is the highest month in the ${fmtInt(d.reports)} reports.`,
            isNum(d.newMdlsInSeries) && isNum(d.leftSeries)
              ? `Over the same period ${fmtInt(d.newMdlsInSeries)} MDLs entered the pending list and ${fmtInt(d.leftSeries)} left it.`
              : null,
          ],
          points: [
            { label: asOf, value: fmtInt(now.pending), note: `${fmtInt(now.mdls)} MDLs` },
            yearAgo
              ? {
                  label: yearAgo.date,
                  value: fmtInt(yearAgo.pending),
                  note: `${fmtInt(yearAgo.mdls)} MDLs`,
                }
              : null,
            { label: first.date, value: fmtInt(first.pending), note: `${fmtInt(first.mdls)} MDLs` },
            { label: `Highest month: ${peak.date}`, value: fmtInt(peak.pending) },
            { label: `Change since ${first.date}`, value: fmtSignedPct(sinceFirst, 0) },
          ],
          caveat: `Covers the ${fmtInt(d.reports)} monthly JPML reports from ${first.date}. An MDL that closes or leaves the report removes all of its actions at once, so one large docket can move the total sharply.`,
          sources: SOURCES,
          dataThrough: asOf,
          score: 82,
        }),
      );
  }

  // 2. Concentration
  const ranked = sortDesc(
    pendingRows.filter((r) => isNum(r.rank)),
    (r) => r.pending,
  );
  const [r1, r2, r3] = ranked;
  if (r1 && r2 && r3 && isNum(d.top10SharePct) && d.pendingActions > 0) {
    const s1 = sharePct(r1.pending, d.pendingActions);
    const top3 = sharePct(sum([r1, r2, r3].map((r) => r.pending)), d.pendingActions);
    if (s1 != null && top3 != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "docket-concentration",
          kind: "concentration",
          headline: `The ten largest MDLs hold ${fmtPct(d.top10SharePct, 0)} of all pending MDL actions`,
          summary: [
            `On ${asOf}, ${fmtInt(d.pendingMdls)} MDLs were pending with ${fmtInt(d.pendingActions)} actions; the ten largest hold ${fmtPct(d.top10SharePct)} of them.`,
            `The largest, ${mdlName(r1.mdl, r1.title)}, has ${fmtInt(r1.pending)} pending actions (${fmtPct(s1)} of the total). The next two are MDL ${r2.mdl} (${fmtInt(r2.pending)}) and MDL ${r3.mdl} (${fmtInt(r3.pending)}).`,
            `The top three together hold ${fmtPct(top3)}.`,
          ],
          points: [
            {
              label: `MDL ${r1.mdl}`,
              value: fmtInt(r1.pending),
              note: fmtPct(s1),
              href: mdlPage(r1.mdl),
            },
            { label: `MDL ${r2.mdl}`, value: fmtInt(r2.pending), href: mdlPage(r2.mdl) },
            { label: `MDL ${r3.mdl}`, value: fmtInt(r3.pending), href: mdlPage(r3.mdl) },
            { label: "Top three combined", value: fmtPct(top3) },
            { label: "Top ten combined", value: fmtPct(d.top10SharePct) },
          ],
          caveat:
            "Counts are individual actions; an MDL with many claimants can have more actions than all small MDLs combined.",
          sources: SOURCES,
          dataThrough: asOf,
          score: 76,
        }),
      );
  }

  // 3. Fastest growing
  const growers = sortDesc(
    d.fastestGrowing.filter((m) => m.change12m > 0),
    (m) => m.change12m,
  );
  const [g1, g2, g3] = growers;
  if (g1 && g2 && g3) {
    const growing = pendingRows.filter((r) => isNum(r.change12m) && r.change12m > 0).length;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "fastest-growing",
        kind: "mover",
        headline: `${mdlName(g1.mdl, g1.title)} added the most pending actions in the last 12 months (${fmtSignedInt(g1.change12m)})`,
        summary: [
          `Over the 12 months to ${asOf}, the pending list of MDL ${g1.mdl} grew by ${fmtInt(g1.change12m)} to ${fmtInt(g1.pending)}.`,
          `The next largest increases were MDL ${g2.mdl} (${fmtSignedInt(g2.change12m)}, to ${fmtInt(g2.pending)}) and MDL ${g3.mdl} (${fmtSignedInt(g3.change12m)}, to ${fmtInt(g3.pending)}).`,
          growing > 0
            ? `${fmtInt(growing)} of the ${fmtInt(pendingRows.length)} pending MDLs grew over the year.`
            : null,
        ],
        points: [
          {
            label: `MDL ${g1.mdl}`,
            value: fmtSignedInt(g1.change12m),
            note: `now ${fmtInt(g1.pending)}`,
            href: mdlPage(g1.mdl),
          },
          {
            label: `MDL ${g2.mdl}`,
            value: fmtSignedInt(g2.change12m),
            note: `now ${fmtInt(g2.pending)}`,
            href: mdlPage(g2.mdl),
          },
          {
            label: `MDL ${g3.mdl}`,
            value: fmtSignedInt(g3.change12m),
            note: `now ${fmtInt(g3.pending)}`,
            href: mdlPage(g3.mdl),
          },
          growing > 0
            ? {
                label: "MDLs that grew",
                value: `${fmtInt(growing)} of ${fmtInt(pendingRows.length)}`,
              }
            : null,
        ],
        caveat:
          "Growth is the net change in pending actions (new actions added minus actions closed or remanded), not the number of new filings alone.",
        sources: SOURCES,
        dataThrough: asOf,
        score: 72,
      }),
    );
  }

  // 4. Fastest declining
  const decliners = sortAsc(
    d.fastestDeclining.filter((m) => m.change12m < 0),
    (m) => m.change12m,
  );
  const [x1, x2, x3] = decliners;
  if (x1 && x2 && x3) {
    out.push(
      makeInsight({
        section: SECTION,
        slug: "fastest-declining",
        kind: "mover",
        headline: `${mdlName(x1.mdl, x1.title)} cleared the most pending actions in the last 12 months (${fmtSignedInt(x1.change12m)})`,
        summary: [
          `Over the 12 months to ${asOf}, the pending list of MDL ${x1.mdl} fell by ${fmtInt(Math.abs(x1.change12m))} to ${fmtInt(x1.pending)}.`,
          `The next largest decreases were MDL ${x2.mdl} (${fmtSignedInt(x2.change12m)}, to ${fmtInt(x2.pending)}) and MDL ${x3.mdl} (${fmtSignedInt(x3.change12m)}, to ${fmtInt(x3.pending)}).`,
          `A fall means actions were closed, remanded or transferred out; the report does not say why.`,
        ],
        points: [
          {
            label: `MDL ${x1.mdl}`,
            value: fmtSignedInt(x1.change12m),
            note: `now ${fmtInt(x1.pending)}`,
            href: mdlPage(x1.mdl),
          },
          {
            label: `MDL ${x2.mdl}`,
            value: fmtSignedInt(x2.change12m),
            note: `now ${fmtInt(x2.pending)}`,
            href: mdlPage(x2.mdl),
          },
          {
            label: `MDL ${x3.mdl}`,
            value: fmtSignedInt(x3.change12m),
            note: `now ${fmtInt(x3.pending)}`,
            href: mdlPage(x3.mdl),
          },
        ],
        caveat:
          "The list covers MDLs that remain on the pending report; MDLs that left it entirely are counted in the overall trend, not here.",
        sources: SOURCES,
        dataThrough: asOf,
        score: 68,
      }),
    );
  }

  // 5. Case-type mix
  const types = sortDesc(d.byType, (g) => g.pending);
  const [t1, t2] = types;
  if (t1 && t2 && d.pendingActions > 0) {
    const s1 = sharePct(t1.pending, d.pendingActions);
    const mass = sharePct(d.massTortActions, d.pendingActions);
    if (s1 != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "case-type-mix",
          kind: "mix_shift",
          headline: `${t1.key} MDLs hold ${fmtPct(s1, 0)} of pending MDL actions`,
          summary: [
            `${fmtInt(t1.mdls)} ${t1.key} MDLs hold ${fmtInt(t1.pending)} of the ${fmtInt(d.pendingActions)} pending actions on ${asOf} (${fmtPct(s1)}).`,
            `The next largest type, ${t2.key}, holds ${fmtInt(t2.pending)} in ${fmtInt(t2.mdls)} MDLs (${fmtPct(sharePct(t2.pending, d.pendingActions) ?? 0)}).`,
            mass != null
              ? `The dataset flags ${fmtInt(d.massTortMdls)} pending MDLs as mass torts; together they hold ${fmtInt(d.massTortActions)} actions (${fmtPct(mass)}).`
              : null,
          ],
          points: [
            {
              label: t1.key,
              value: fmtInt(t1.pending),
              note: `${fmtInt(t1.mdls)} MDLs · ${fmtPct(s1)}`,
            },
            { label: t2.key, value: fmtInt(t2.pending), note: `${fmtInt(t2.mdls)} MDLs` },
            types[2]
              ? {
                  label: types[2].key,
                  value: fmtInt(types[2].pending),
                  note: `${fmtInt(types[2].mdls)} MDLs`,
                }
              : null,
            mass != null
              ? {
                  label: "Flagged mass torts",
                  value: fmtInt(d.massTortActions),
                  note: `${fmtInt(d.massTortMdls)} MDLs`,
                }
              : null,
          ],
          caveat:
            "Types are the JPML's own case-type labels; the mass-tort flag is this dataset's classification of the MDL.",
          sources: SOURCES,
          dataThrough: asOf,
          score: 60,
        }),
      );
  }

  // 6. Transferee districts
  const districts = sortDesc(d.byDistrict, (g) => g.pending);
  const [d1, d2, d3] = districts;
  if (d1 && d2 && d3 && d.pendingActions > 0) {
    const s1 = sharePct(d1.pending, d.pendingActions);
    const s3 = sharePct(sum([d1, d2, d3].map((g) => g.pending)), d.pendingActions);
    if (s1 != null && s3 != null)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "district-concentration",
          kind: "concentration",
          headline: `Transferee district ${d1.key} holds ${fmtPct(s1, 0)} of pending MDL actions`,
          summary: [
            `By the JPML's district code, ${d1.key} has ${fmtInt(d1.pending)} pending actions in ${fmtInt(d1.mdls)} ${mdlWord(d1.mdls)} (${fmtPct(s1)} of ${fmtInt(d.pendingActions)}).`,
            `${d2.key} (${fmtInt(d2.pending)}) and ${d3.key} (${fmtInt(d3.pending)}) follow; the three together hold ${fmtPct(s3)}.`,
            `Over the last twelve months ${d1.key}'s pending total changed by ${fmtSignedInt(d1.change12m)}.`,
          ],
          points: [
            {
              label: d1.key,
              value: fmtInt(d1.pending),
              note: `${fmtInt(d1.mdls)} MDLs · ${fmtPct(s1)}`,
            },
            { label: d2.key, value: fmtInt(d2.pending), note: `${fmtInt(d2.mdls)} MDLs` },
            { label: d3.key, value: fmtInt(d3.pending), note: `${fmtInt(d3.mdls)} MDLs` },
            { label: "Top three combined", value: fmtPct(s3) },
          ],
          caveat:
            "District labels are the JPML's own codes for the court where the MDL sits; one very large MDL can account for most of a district's total.",
          sources: SOURCES,
          dataThrough: asOf,
          score: 62,
        }),
      );
  }

  // 7. Age of pending MDLs
  const aged = sortDesc(
    pendingRows.filter((r) => isNum(r.ageYears)),
    (r) => r.ageYears,
  );
  const [o1, o2, o3] = aged;
  if (o1 && o2 && o3 && isNum(d.medianAgeYears)) {
    const over10 = aged.filter((r) => r.ageYears! >= 10).length;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "mdl-age",
        kind: "outlier",
        headline: `The median pending MDL is ${d.medianAgeYears.toLocaleString("en-US", { maximumFractionDigits: 1 })} years old; ${fmtInt(over10)} have been pending for ten years or more`,
        summary: [
          `Counting from the transfer order, the median pending MDL on ${asOf} is ${d.medianAgeYears.toLocaleString("en-US", { maximumFractionDigits: 1 })} years old.`,
          `${fmtInt(over10)} of the ${fmtInt(aged.length)} pending MDLs with a recorded age are ten years old or more.`,
          `The oldest are ${mdlName(o1.mdl, o1.title)} (${o1.ageYears!.toLocaleString("en-US", { maximumFractionDigits: 1 })} years), MDL ${o2.mdl} (${o2.ageYears!.toLocaleString("en-US", { maximumFractionDigits: 1 })}) and MDL ${o3.mdl} (${o3.ageYears!.toLocaleString("en-US", { maximumFractionDigits: 1 })}).`,
        ],
        points: [
          {
            label: "Median age",
            value: `${d.medianAgeYears.toLocaleString("en-US", { maximumFractionDigits: 1 })} years`,
          },
          { label: "Pending 10+ years", value: fmtInt(over10), note: `of ${fmtInt(aged.length)}` },
          {
            label: `Oldest: MDL ${o1.mdl}`,
            value: `${o1.ageYears!.toLocaleString("en-US", { maximumFractionDigits: 1 })} years`,
            note: `${fmtInt(o1.pending)} pending`,
            href: mdlPage(o1.mdl),
          },
          {
            label: `MDL ${o2.mdl}`,
            value: `${o2.ageYears!.toLocaleString("en-US", { maximumFractionDigits: 1 })} years`,
            href: mdlPage(o2.mdl),
          },
          {
            label: `MDL ${o3.mdl}`,
            value: `${o3.ageYears!.toLocaleString("en-US", { maximumFractionDigits: 1 })} years`,
            href: mdlPage(o3.mdl),
          },
        ],
        caveat:
          "Age is measured from the date of the MDL's transfer order to the report date; a long-lived MDL may now hold only a few actions.",
        sources: SOURCES,
        dataThrough: asOf,
        score: 50,
      }),
    );
  }

  // 8. Terminated history
  if (d.terminated.length >= 100) {
    const closed = sum(d.terminated.map((t) => t.closed));
    const remanded = sum(d.terminated.map((t) => t.remanded));
    const total = closed + remanded;
    const remandShare = sharePct(remanded, total);
    const years = d.terminated.map((t) => t.year);
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    const big = sortDesc(d.terminated, (t) => t.closed + t.remanded)[0];
    if (remandShare != null && big && total > 0)
      out.push(
        makeInsight({
          section: SECTION,
          slug: "terminated-history",
          kind: "trend",
          headline: `${fmtPct(100 - remandShare, 0)} of actions in terminated MDLs were closed in the MDL court and ${fmtPct(remandShare, 0)} remanded (${lo} to ${hi})`,
          summary: [
            `The JPML's terminated-MDL history lists ${fmtInt(d.terminated.length)} MDLs that ended between ${lo} and ${hi}, covering ${fmtInt(total)} actions that were closed or remanded.`,
            `${fmtInt(remanded)} actions (${fmtPct(remandShare)}) were remanded to the courts where they were first filed; ${fmtInt(closed)} were closed in the MDL court.`,
            `The largest terminated MDL was ${clip(big.caption.replace(/^IN RE:?\s*/i, ""), 70)} (${fmtInt(big.closed + big.remanded)} actions, ended ${big.year}).`,
          ],
          points: [
            {
              label: "Terminated MDLs",
              value: fmtInt(d.terminated.length),
              note: `${lo} to ${hi}`,
            },
            { label: "Actions closed or remanded", value: fmtInt(total) },
            { label: "Remanded", value: fmtInt(remanded), note: fmtPct(remandShare) },
            {
              label: "Closed in the MDL court",
              value: fmtInt(closed),
              note: fmtPct(100 - remandShare),
            },
            {
              label: `Largest: MDL ${big.mdl}`,
              value: fmtInt(big.closed + big.remanded),
              note: `ended ${big.year}`,
              href: mdlPage(big.mdl),
            },
          ],
          caveat:
            "The history counts actions at the time the MDL ended; it does not say how each action was finally resolved after remand.",
          sources: SOURCES,
          dataThrough: String(hi),
          score: 54,
        }),
      );
  }

  // 9. Turnover of the pending list
  if (isNum(d.newMdlsInSeries) && isNum(d.leftSeries) && d.reports > 1) {
    const firstDate = d.portfolio[0]?.date ?? d.firstReport;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "list-turnover",
        kind: "coverage",
        headline: `${fmtInt(d.newMdlsInSeries)} MDLs joined and ${fmtInt(d.leftSeries)} left the JPML pending list between ${firstDate} and ${asOf}`,
        summary: [
          `Across the ${fmtInt(d.reports)} monthly JPML reports from ${firstDate} to ${asOf}, ${fmtInt(d.newMdlsInSeries)} MDLs appeared that were not in the first report and ${fmtInt(d.leftSeries)} MDLs from the first report are no longer listed.`,
          `${fmtInt(d.pendingMdls)} MDLs are pending in the latest report, ${fmtInt(d.massTortMdls)} of them flagged as mass torts in this dataset.`,
          `An MDL leaves the list when it closes or its remaining actions are sent back; the report does not give the reason.`,
        ],
        points: [
          { label: "Joined the list", value: fmtInt(d.newMdlsInSeries) },
          { label: "Left the list", value: fmtInt(d.leftSeries) },
          { label: "Pending MDLs now", value: fmtInt(d.pendingMdls) },
          { label: "Flagged mass torts", value: fmtInt(d.massTortMdls) },
        ],
        caveat: `Only the ${fmtInt(d.reports)} reports in this dataset are compared; an MDL created and closed between two reports would not appear.`,
        sources: SOURCES,
        dataThrough: asOf,
        score: 44,
      }),
    );
  }
  return out.filter((i): i is Insight => i !== null);
}
