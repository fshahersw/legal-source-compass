import type { Measure } from "@/components/analysis/HowToRead";
import type { CensusMeasureDef } from "@/lib/external/censusModel";

/** "How to read this" entries for an ACS trend chart: what is plotted and the limits on reading it. */
export function trendHow(
  def: Pick<CensusMeasureDef, "key" | "label" | "format" | "universe">,
  survey: "acs5" | "acs1",
): Measure[] {
  const out: Measure[] = [
    {
      term: survey === "acs5" ? "Five-year release" : "One-year estimate",
      means:
        survey === "acs5"
          ? "Each point is one release of the American Community Survey 5-year estimates, labelled by its last year (2020 to 2024 is plotted at 2024)."
          : "Each point is one calendar-year ACS estimate. There is no 2020 release, so that year is a gap.",
      caveat:
        survey === "acs5"
          ? "Releases that end within five years of each other share survey years, so neighbouring points are not independent and a small rise or fall between them is not a test of change."
          : "Estimates exist only for areas with 65,000 or more residents.",
    },
    {
      term: "Margin of error",
      means:
        "The shaded band is the Census Bureau's published margin of error (90 percent confidence level) around each estimate.",
      caveat: "Two estimates whose bands overlap may not differ.",
    },
  ];
  if (def.format === "dollars")
    out.push({
      term: "Dollars",
      means: "Each release is in the inflation-adjusted dollars of its last year.",
      caveat:
        "Releases are not adjusted to a common year, so a rise over time includes some inflation.",
    });
  if (def.format === "pct")
    out.push({
      term: def.label,
      means: `A percentage${def.universe ? ` of ${def.universe}` : ""}, computed from published counts.`,
      caveat: "A percentage of a small group can move a lot between releases.",
    });
  out.push({
    term: "Gaps",
    means:
      "A release in which the Bureau published no value for this area is left blank; it is never drawn as zero.",
  });
  return out;
}
