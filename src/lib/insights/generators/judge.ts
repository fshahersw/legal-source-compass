/**
 * Judge analytics insights from the FJC x JPML cross-analysis (datasets judge_cross_profiles and
 * judge_cross_districts). "Pending actions" are the individual cases listed as pending in the JPML's
 * pending-MDL report as of the dataset date. Party figures are the party of the appointing president, a
 * biographical fact and not a statement about any judge's views.
 */
import { makeInsight } from "../build";
import { circuitLabel, fmtInt, fmtPct, isNum, joinList, sharePct, sortDesc, sum } from "../format";
import type { Insight, InsightSourceLink } from "../types";

const SECTION = "judge";

export type JudgePointLite = {
  nid: string;
  name: string;
  courtId: string | null;
  party: string | null;
  pendingMdls: number;
  pendingActions: number;
  historicalMdls: number;
  totalActions: number;
  sharePct: number | null;
  profileId: string | null;
};
export type JudgeDistrictLite = {
  courtId: string;
  name: string;
  pendingMdls: number;
  pendingActions: number;
  judgeships: number | null;
  sharePct: number | null;
};
export type JudgeInput = {
  asOf: string;
  pendingMdls: number;
  pendingActions: number;
  judges: number;
  judgesWithPending: number;
  judgesHistoryOnly: number;
  judgesMultiPending: number;
  top10SharePct: number | null;
  medianYearsPendingJudges: number | null;
  points: JudgePointLite[];
  national: {
    asOf: string;
    districts: number;
    sitting: number;
    active: number;
    senior: number;
    partyActive: Record<string, number>;
    tenure: Record<string, number>;
    medianYearsActive: number | null;
    districtsWithPending: number;
    top5DistrictSharePct: number | null;
    pendingActions: number;
    /** Keyed by the circuit number as printed ("0" is the D.C. Circuit). */
    circuits: Record<
      string,
      { active: number; senior: number; pendingMdls: number; pendingActions: number }
    >;
    rows: JudgeDistrictLite[];
  } | null;
};

const SOURCES: InsightSourceLink[] = [
  {
    label: "FJC Biographical Directory of Federal Judges",
    href: "https://www.fjc.gov/sites/default/files/history/judges.csv",
  },
  {
    label: "JPML pending MDL reports",
    href: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
  },
];
const judgeLink = (p: JudgePointLite) => (p.profileId ? `/judges/${p.profileId}` : undefined);
const courtLink = (id: string | null) => (id ? `/courts/${id}` : undefined);
const mdlWord = (n: number) => (n === 1 ? "MDL" : "MDLs");

export function generateJudgeInsights(d: JudgeInput): Insight[] {
  const out: (Insight | null)[] = [];
  const withPending = sortDesc(
    d.points.filter((p) => p.pendingActions > 0),
    (p) => p.pendingActions,
  );
  const date = d.asOf;

  // 1. Concentration of pending MDL actions among judges
  const top = withPending[0];
  const topTen = withPending.slice(0, 10);
  const computedTop10 = sharePct(sum(topTen.map((p) => p.pendingActions)), d.pendingActions);
  if (
    top &&
    topTen.length === 10 &&
    isNum(d.top10SharePct) &&
    computedTop10 != null &&
    Math.abs(computedTop10 - d.top10SharePct) <= 1
  ) {
    const topShare = sharePct(top.pendingActions, d.pendingActions);
    out.push(
      makeInsight({
        section: SECTION,
        slug: "pending-concentration",
        kind: "concentration",
        headline: `Ten judges oversee ${fmtPct(d.top10SharePct, 0)} of the ${fmtInt(d.pendingActions)} actions pending in federal MDLs`,
        summary: [
          `As of ${date}, ${fmtInt(d.judgesWithPending)} judges oversee the ${fmtInt(d.pendingMdls)} pending MDLs, which together contain ${fmtInt(d.pendingActions)} pending actions.`,
          `The ten judges with the most pending actions hold ${fmtPct(d.top10SharePct)} of them.`,
          topShare != null
            ? `${top.name} alone has ${fmtInt(top.pendingActions)} (${fmtPct(topShare)}) across ${fmtInt(top.pendingMdls)} ${mdlWord(top.pendingMdls)}.`
            : null,
          `Because a single large docket can hold tens of thousands of actions, the share reflects a few dockets more than the judges' overall workload.`,
        ],
        points: [
          {
            label: `Most pending actions: ${top.name}`,
            value: fmtInt(top.pendingActions),
            note: topShare != null ? fmtPct(topShare) : undefined,
            href: judgeLink(top),
          },
          { label: "Top ten judges' share", value: fmtPct(d.top10SharePct) },
          { label: "Judges with a pending MDL", value: fmtInt(d.judgesWithPending) },
          { label: "Pending MDLs", value: fmtInt(d.pendingMdls) },
          { label: "Pending actions", value: fmtInt(d.pendingActions) },
        ],
        caveat:
          "Counts come from the JPML pending-MDL report; an MDL is counted for the judge shown as its transferee judge.",
        sources: SOURCES,
        dataThrough: date,
        score: 78,
      }),
    );
  }

  // 2. Judges with several pending MDLs
  const multi = sortDesc(
    d.points.filter((p) => p.pendingMdls >= 2),
    (p) => p.pendingMdls * 1_000_000 + p.pendingActions,
  );
  if (multi.length >= 3 && multi.length === d.judgesMultiPending) {
    const [a, b, c] = multi;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "multi-mdl-judges",
        kind: "leader",
        headline: `${fmtInt(multi.length)} judges oversee two or more pending MDLs; ${a!.name} has ${fmtInt(a!.pendingMdls)}`,
        summary: [
          `Of the ${fmtInt(d.judgesWithPending)} judges with a pending MDL as of ${date}, ${fmtInt(multi.length)} (${fmtPct(sharePct(multi.length, d.judgesWithPending) ?? 0)}) have more than one.`,
          `${a!.name} oversees ${fmtInt(a!.pendingMdls)} (${fmtInt(a!.pendingActions)} pending actions), ${b!.name} oversees ${fmtInt(b!.pendingMdls)} and ${c!.name} oversees ${fmtInt(c!.pendingMdls)}.`,
          `Most judges with a pending MDL oversee exactly one.`,
        ],
        points: [
          {
            label: a!.name,
            value: `${fmtInt(a!.pendingMdls)} MDLs`,
            note: `${fmtInt(a!.pendingActions)} actions`,
            href: judgeLink(a!),
          },
          {
            label: b!.name,
            value: `${fmtInt(b!.pendingMdls)} MDLs`,
            note: `${fmtInt(b!.pendingActions)} actions`,
            href: judgeLink(b!),
          },
          {
            label: c!.name,
            value: `${fmtInt(c!.pendingMdls)} MDLs`,
            note: `${fmtInt(c!.pendingActions)} actions`,
            href: judgeLink(c!),
          },
          { label: "Judges with 2+ pending MDLs", value: fmtInt(multi.length) },
        ],
        caveat:
          "Pending counts are as of the JPML report date; a judge may also have closed MDLs not counted here.",
        sources: SOURCES,
        dataThrough: date,
        score: 54,
      }),
    );
  }

  const nat = d.national;
  // 3. Districts
  if (nat && nat.rows.length >= 50 && isNum(nat.top5DistrictSharePct) && nat.pendingActions > 0) {
    const rows = sortDesc(nat.rows, (r) => r.pendingActions);
    const top5 = rows.slice(0, 5);
    const computed = sharePct(sum(top5.map((r) => r.pendingActions)), nat.pendingActions);
    const [a, b, c] = top5;
    if (a && b && c && computed != null && Math.abs(computed - nat.top5DistrictSharePct) <= 1) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "district-concentration",
          kind: "concentration",
          headline: `Five districts host ${fmtPct(nat.top5DistrictSharePct, 0)} of pending MDL actions; ${a.name} alone hosts ${fmtPct(sharePct(a.pendingActions, nat.pendingActions) ?? 0, 0)}`,
          summary: [
            `Of ${fmtInt(nat.districts)} federal districts, ${fmtInt(nat.districtsWithPending)} currently have at least one pending MDL assigned to a judge there.`,
            `The five districts with the most pending actions (${joinList(top5.map((r) => r.name))}) hold ${fmtPct(nat.top5DistrictSharePct)} of the ${fmtInt(nat.pendingActions)} pending actions.`,
            `${a.name} has ${fmtInt(a.pendingActions)} pending actions in ${fmtInt(a.pendingMdls)} ${mdlWord(a.pendingMdls)}.`,
          ],
          points: [
            {
              label: a.name,
              value: fmtInt(a.pendingActions),
              note: `${fmtInt(a.pendingMdls)} ${mdlWord(a.pendingMdls)}`,
              href: courtLink(a.courtId),
            },
            { label: b.name, value: fmtInt(b.pendingActions), href: courtLink(b.courtId) },
            { label: c.name, value: fmtInt(c.pendingActions), href: courtLink(c.courtId) },
            { label: "Top five districts", value: fmtPct(nat.top5DistrictSharePct) },
            {
              label: "Districts with a pending MDL",
              value: `${fmtInt(nat.districtsWithPending)} of ${fmtInt(nat.districts)}`,
            },
          ],
          caveat: "One very large docket can account for most of a district's total.",
          sources: SOURCES,
          dataThrough: nat.asOf,
          score: 66,
        }),
      );
    }
  }

  // 4. Circuits
  if (nat && nat.pendingActions > 0) {
    const circuits = Object.entries(nat.circuits).flatMap(([key, v]) => {
      const label = circuitLabel(Number(key));
      return label && key.trim() !== "" ? [{ label, ...v }] : [];
    });
    const desc = sortDesc(circuits, (c) => c.pendingActions);
    const [a, b, c] = desc;
    if (circuits.length >= 11 && a && b && c) {
      const share = sharePct(a.pendingActions, nat.pendingActions);
      if (share != null)
        out.push(
          makeInsight({
            section: SECTION,
            slug: "circuit-load",
            kind: "leader",
            headline: `The ${a.label} holds ${fmtPct(share, 0)} of pending MDL actions`,
            summary: [
              `By the circuit of the transferee judge, the ${a.label} has the most pending MDL actions (${fmtInt(a.pendingActions)} across ${fmtInt(a.pendingMdls)} MDLs, ${fmtPct(share)} of the total), followed by the ${b.label} (${fmtInt(b.pendingActions)}) and the ${c.label} (${fmtInt(c.pendingActions)}).`,
              `It has ${fmtInt(a.active)} active and ${fmtInt(a.senior)} senior district judges.`,
            ],
            points: [
              { label: a.label, value: fmtInt(a.pendingActions), note: fmtPct(share) },
              { label: b.label, value: fmtInt(b.pendingActions) },
              { label: c.label, value: fmtInt(c.pendingActions) },
              { label: `Pending MDLs in the ${a.label}`, value: fmtInt(a.pendingMdls) },
            ],
            caveat:
              "A circuit's total can be dominated by one very large MDL assigned to one of its district judges.",
            sources: SOURCES,
            dataThrough: nat.asOf,
            score: 56,
          }),
        );
    }
  }

  // 5. Bench size and tenure
  if (nat && nat.sitting > 0) {
    const bucketTotal = sum(Object.values(nat.tenure));
    const longest = nat.tenure["30+ yrs"];
    const newest = nat.tenure["Under 5 yrs"];
    if (
      bucketTotal > 0 &&
      isNum(longest) &&
      isNum(newest) &&
      isNum(nat.medianYearsActive) &&
      nat.active + nat.senior === nat.sitting
    ) {
      out.push(
        makeInsight({
          section: SECTION,
          slug: "bench-tenure",
          kind: "mix_shift",
          headline: `Of ${fmtInt(nat.sitting)} sitting federal district judges, ${fmtPct(sharePct(longest, bucketTotal) ?? 0, 0)} have served 30 years or more`,
          summary: [
            `As of ${nat.asOf}, ${fmtInt(nat.sitting)} district judges are sitting: ${fmtInt(nat.active)} active and ${fmtInt(nat.senior)} on senior status.`,
            `${fmtInt(longest)} (${fmtPct(sharePct(longest, bucketTotal) ?? 0)}) have served 30 years or more, and ${fmtInt(newest)} (${fmtPct(sharePct(newest, bucketTotal) ?? 0)}) fewer than 5 years.`,
            `The median active judge has served ${nat.medianYearsActive.toLocaleString("en-US", { maximumFractionDigits: 1 })} years.`,
          ],
          points: [
            { label: "Sitting judges", value: fmtInt(nat.sitting) },
            { label: "Active / senior", value: `${fmtInt(nat.active)} / ${fmtInt(nat.senior)}` },
            {
              label: "Served 30+ years",
              value: fmtInt(longest),
              note: fmtPct(sharePct(longest, bucketTotal) ?? 0),
            },
            {
              label: "Served under 5 years",
              value: fmtInt(newest),
              note: fmtPct(sharePct(newest, bucketTotal) ?? 0),
            },
            {
              label: "Median years, active judges",
              value: nat.medianYearsActive.toLocaleString("en-US", { maximumFractionDigits: 1 }),
            },
          ],
          caveat: `Tenure is years since commission; percentages use the ${fmtInt(bucketTotal)} judges with a recorded commission date.`,
          sources: SOURCES,
          dataThrough: nat.asOf,
          score: 50,
        }),
      );
    }
  }

  // 6. Appointing party
  const dem = nat?.partyActive["Democratic"];
  const rep = nat?.partyActive["Republican"];
  const pendingByParty = (party: string) =>
    d.points.filter((p) => p.party === party && p.pendingActions > 0);
  const pd = pendingByParty("Democratic");
  const pr = pendingByParty("Republican");
  if (nat && isNum(dem) && isNum(rep) && dem + rep > 0 && pd.length + pr.length >= 20) {
    const actionsD = sum(pd.map((p) => p.pendingActions));
    const actionsR = sum(pr.map((p) => p.pendingActions));
    out.push(
      makeInsight({
        section: SECTION,
        slug: "appointing-party",
        kind: "mix_shift",
        headline: `${fmtInt(dem)} active district judges were appointed by Democratic presidents and ${fmtInt(rep)} by Republican presidents`,
        summary: [
          `Among ${fmtInt(dem + rep)} active federal district judges with a recorded appointing president, ${fmtInt(dem)} (${fmtPct(sharePct(dem, dem + rep) ?? 0)}) were appointed by a Democratic president and ${fmtInt(rep)} (${fmtPct(sharePct(rep, dem + rep) ?? 0)}) by a Republican president.`,
          `Among the ${fmtInt(pd.length + pr.length)} judges with a pending MDL, ${fmtInt(pd.length)} were appointed by Democratic and ${fmtInt(pr.length)} by Republican presidents; they oversee ${fmtInt(actionsD)} and ${fmtInt(actionsR)} pending actions.`,
          `The party is that of the appointing president. It says nothing about how a judge rules.`,
        ],
        points: [
          { label: "Active judges, Democratic appointees", value: fmtInt(dem) },
          { label: "Active judges, Republican appointees", value: fmtInt(rep) },
          {
            label: "Judges with a pending MDL (D / R)",
            value: `${fmtInt(pd.length)} / ${fmtInt(pr.length)}`,
          },
          { label: "Pending actions (D / R)", value: `${fmtInt(actionsD)} / ${fmtInt(actionsR)}` },
        ],
        caveat:
          "Pending actions are dominated by a few very large dockets, so the action split can change sharply when one is reassigned or closes.",
        sources: SOURCES,
        dataThrough: nat.asOf,
        score: 48,
      }),
    );
  }

  // 7. Experience
  const experienced = sortDesc(d.points, (p) => p.totalActions);
  const [e1, e2, e3] = experienced;
  if (e1 && e2 && e3 && e1.totalActions > 0) {
    out.push(
      makeInsight({
        section: SECTION,
        slug: "mdl-experience",
        kind: "leader",
        headline: `${e1.name} has handled the most MDL actions of any judge in the dataset (${fmtInt(e1.totalActions)})`,
        summary: [
          `Counting pending MDLs and those that have ended, ${e1.name} has handled ${fmtInt(e1.totalActions)} MDL actions across ${fmtInt(e1.pendingMdls + e1.historicalMdls)} ${mdlWord(e1.pendingMdls + e1.historicalMdls)}.`,
          `${e2.name} follows with ${fmtInt(e2.totalActions)} and ${e3.name} with ${fmtInt(e3.totalActions)}.`,
          `${fmtInt(d.judges)} judges appear in the dataset, ${fmtInt(d.judgesHistoryOnly)} of them only through MDLs that have ended.`,
        ],
        points: [
          {
            label: e1.name,
            value: fmtInt(e1.totalActions),
            note: `${fmtInt(e1.pendingMdls + e1.historicalMdls)} ${mdlWord(e1.pendingMdls + e1.historicalMdls)}`,
            href: judgeLink(e1),
          },
          {
            label: e2.name,
            value: fmtInt(e2.totalActions),
            note: `${fmtInt(e2.pendingMdls + e2.historicalMdls)} ${mdlWord(e2.pendingMdls + e2.historicalMdls)}`,
            href: judgeLink(e2),
          },
          {
            label: e3.name,
            value: fmtInt(e3.totalActions),
            note: `${fmtInt(e3.pendingMdls + e3.historicalMdls)} ${mdlWord(e3.pendingMdls + e3.historicalMdls)}`,
            href: judgeLink(e3),
          },
          { label: "Judges in the dataset", value: fmtInt(d.judges) },
        ],
        caveat:
          "Historical MDLs come from the JPML terminated-MDL history; an MDL shared between judges is counted for each.",
        sources: SOURCES,
        dataThrough: date,
        score: 52,
      }),
    );
  }

  // 8. Most judges with MDL history have none pending
  if (d.judges > 0 && d.judgesHistoryOnly > 0 && d.judgesWithPending > 0) {
    const medYears = d.medianYearsPendingJudges;
    out.push(
      makeInsight({
        section: SECTION,
        slug: "history-only-judges",
        kind: "coverage",
        headline: `Only ${fmtInt(d.judgesWithPending)} of ${fmtInt(d.judges)} judges with MDL experience have a pending MDL today`,
        summary: [
          `The dataset records ${fmtInt(d.judges)} judges who have been assigned an MDL: ${fmtInt(d.judgesWithPending)} (${fmtPct(sharePct(d.judgesWithPending, d.judges) ?? 0)}) have at least one pending now and ${fmtInt(d.judgesHistoryOnly)} (${fmtPct(sharePct(d.judgesHistoryOnly, d.judges) ?? 0)}) only through MDLs that have ended.`,
          medYears != null
            ? `The judges with a pending MDL have a median of ${medYears.toLocaleString("en-US", { maximumFractionDigits: 1 })} years since their commission.`
            : null,
          `${fmtInt(d.judgesMultiPending)} judges oversee more than one pending MDL.`,
        ],
        points: [
          { label: "Judges in the dataset", value: fmtInt(d.judges) },
          { label: "With a pending MDL", value: fmtInt(d.judgesWithPending) },
          { label: "Only ended MDLs", value: fmtInt(d.judgesHistoryOnly) },
          { label: "With 2+ pending MDLs", value: fmtInt(d.judgesMultiPending) },
          medYears != null
            ? {
                label: "Median years since commission",
                value: medYears.toLocaleString("en-US", { maximumFractionDigits: 1 }),
              }
            : null,
        ],
        caveat:
          "History comes from the JPML terminated-MDL report, which lists a judge only when the report names one.",
        sources: SOURCES,
        dataThrough: date,
        score: 46,
      }),
    );
  }
  return out.filter((i): i is Insight => i !== null);
}
