/** A sample section context for tests (not imported by application code). */
import { buildSectionContext } from "@/components/kit/ai/buildSectionContext";

export function buildSectionContextForTest(over: { cases?: number } = {}) {
  return buildSectionContext({
    title: "Federal civil cases filed",
    scope: "United States",
    period: "FY2025",
    source: "Federal Judicial Center, Integrated Database",
    figures: [
      { label: "Cases filed", value: over.cases ?? 303716, unit: "cases", period: "FY2025" },
      { label: "Change on FY2024", value: 4.4, unit: "%", decimals: 1, period: "FY2025" },
      { label: "Cases filed", value: 290980, unit: "cases", period: "FY2024" },
    ],
  });
}
