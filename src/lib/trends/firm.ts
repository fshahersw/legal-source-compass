/**
 * Pure builders for the law-firm page's trend cards. Counsel entries on MDL master dockets carry no date of their own,
 * so the only time dimension is the year each MDL was filed: a year here is a group of master dockets, not a period in
 * which firms were active. A year with no registry MDL is a gap, and an MDL with no recorded filing year is not plotted.
 * The card leads with the total over every plotted year, not with the newest year and its change, which would read as a
 * trend in firm activity.
 */
import { assembleBlock, formatCount, yearPoints, type TrendBlockData } from "@/lib/analytics/trend";
import { emptyPeriods, totalSeries } from "./summary";

export type MdlSideAppearances = {
  /** Year the MDL was filed; null when the registry does not record it. */
  year: number | null;
  plaintiff: number | null;
  defense: number | null;
};

export function toSideAppearances(
  mdls: readonly {
    year: number | null;
    plaintiff: { appearances: number | null };
    defense: { appearances: number | null };
  }[],
): MdlSideAppearances[] {
  return mdls.map((m) => ({
    year: m.year,
    plaintiff: m.plaintiff.appearances,
    defense: m.defense.appearances,
  }));
}

const READING =
  "Counsel entries carry no date, so each bar groups the master dockets of MDLs filed that year. It describes which MDLs the registry holds counsel records for, not how firm activity changed: one large master docket can make a year look busy.";

/** Counsel appearances on the registry's MDL master dockets, by the year the MDL was filed, split by the side represented. */
export function buildFirmLandscapeYears(input: {
  mdls: readonly MdlSideAppearances[];
}): TrendBlockData | null {
  const dated = input.mdls.filter((m) => m.year !== null);
  const undated = input.mdls.length - dated.length;
  if (!dated.length) return null;
  const sum = (key: "plaintiff" | "defense") => {
    const byYear = new Map<number, number>();
    for (const m of dated) {
      const v = m[key];
      if (v !== null) byYear.set(m.year!, (byYear.get(m.year!) ?? 0) + v);
    }
    return byYear;
  };
  const years = [...new Set(dated.map((m) => m.year!))];
  const part = (id: string, label: string, by: Map<number, number>) => ({
    id,
    label,
    points: yearPoints(years.map((y) => ({ year: y, value: by.get(y) ?? null }))),
  });
  const parts = [
    part("plaintiff", "Plaintiff side", sum("plaintiff")),
    part("defense", "Defense side", sum("defense")),
  ];
  const lead = totalSeries({ label: "All plotted master dockets", from: parts });
  const mdlCount = dated.length;
  const block = assembleBlock({
    id: "firm-landscape-years",
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "appearances",
    series: parts,
    ...(lead ? { latestFrom: lead } : {}),
    source: {
      label: "Matter registry, law-firm landscape per MDL",
      url: "/data/firm_matter_overview",
    },
    asOf: null,
    notes: [
      "One appearance is one counsel entry for one party on an MDL master docket; member dockets are not counted.",
      READING,
      `${formatCount(mdlCount)} master ${mdlCount === 1 ? "docket" : "dockets"} with a recorded filing year ${mdlCount === 1 ? "is" : "are"} plotted.${undated ? ` ${formatCount(undated)} with no recorded filing year ${undated === 1 ? "is" : "are"} left out.` : ""}`,
    ],
  });
  return { ...block, gaps: emptyPeriods(parts) };
}

export type FirmMdlAppearance = {
  year: number | null;
  appearances: number;
};

/** One firm's appearances, grouped by the year of each MDL it appears in. */
export function buildFirmProfileYears(input: {
  id: string;
  rows: readonly FirmMdlAppearance[];
}): TrendBlockData | null {
  const dated = input.rows.filter((r) => r.year !== null);
  const undated = input.rows.length - dated.length;
  const years = new Set(dated.map((r) => r.year));
  if (years.size < 2) return null;
  const by = new Map<number, number>();
  for (const r of dated) by.set(r.year!, (by.get(r.year!) ?? 0) + r.appearances);
  const series = [
    {
      id: "appearances",
      label: "Appearances",
      points: yearPoints([...by].map(([year, value]) => ({ year, value }))),
    },
  ];
  const lead = totalSeries({ label: "All plotted MDLs", from: series });
  return assembleBlock({
    id: `firm-profile-years-${input.id}`,
    xKind: "year",
    chart: "bar",
    unit: "appearances",
    series,
    ...(lead ? { latestFrom: lead } : {}),
    source: { label: "Matter registry, firm profile", url: `/records/firm_profiles/${input.id}` },
    asOf: null,
    notes: [
      "One appearance is one counsel entry for one party on an MDL master docket; member dockets are not counted.",
      READING,
      ...(undated
        ? [
            `${formatCount(undated)} ${undated === 1 ? "MDL has" : "MDLs have"} no recorded filing year and ${undated === 1 ? "is" : "are"} left out.`,
          ]
        : []),
    ],
  });
}
