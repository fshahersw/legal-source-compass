/**
 * The AI context of a KPI strip: for each tile its latest value (with period, unit and series) and its change on the
 * period before, exactly as the tile prints them, so the summary and the "Ask AI" panel see what the reader sees.
 * Pure and tested (kpiContext.test.ts).
 */
import { buildSectionContext, type FigureInput } from "@/components/kit/ai/buildSectionContext";
import type { SectionContext } from "@/lib/assistant/sectionContext";
import type { TileState } from "./hubTiles";
import type { Kpi } from "./kpis";

/** The tile's value and, when it has one, its change on the period before. */
export function kpiFigures(kpis: readonly Kpi[]): FigureInput[] {
  const out: FigureInput[] = [];
  for (const k of kpis) {
    // a unit is added only to a bare number, as the tile does; "$3.94 billion" and "4.2%" already carry theirs
    const bare = !!k.value && /^[\d,.]+$/.test(k.value);
    out.push({
      label: k.title,
      value: k.value,
      unit: bare ? k.unit : undefined,
      period: k.periodText ?? undefined,
      note: k.seriesLabel ?? undefined,
    });
    if (k.changeText)
      out.push({
        label: `${k.title}, change on the period before`,
        value: k.changeText,
        period: k.periodText ?? undefined,
      });
  }
  return out;
}

/** Distinct source names in tile order, as one line. */
export function kpiSources(kpis: readonly Kpi[]): string {
  return [...new Set(kpis.map((k) => k.source.label).filter(Boolean))].join("; ");
}

/**
 * The context of a row of tiles. null while any tile is still loading (the figures are not all in), so a summary is
 * never written from half a strip; tiles that failed or are empty are left out.
 */
export function kpiContext(
  title: string,
  states: readonly TileState[],
  scope?: string,
): SectionContext | null {
  if (!states.length || states.some((s) => s.kind === "loading")) return null;
  const kpis = states.flatMap((s) => (s.kind === "ok" ? [s.kpi] : []));
  return buildSectionContext({
    title,
    scope,
    source: kpiSources(kpis),
    figures: kpiFigures(kpis),
  });
}

/** Questions offered with the headline strip's Ask AI button. */
export const HEADLINE_QUESTIONS = [
  "Which headline figure changed most, and by how much?",
  "What should a litigator check before relying on these figures?",
  "How are these headline series defined and sourced?",
];
