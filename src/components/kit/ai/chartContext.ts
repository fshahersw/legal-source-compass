/**
 * chartContext: the Ask AI context for one chart card, built only from the rows the card already shows in its
 * "View data" table. Each row becomes figures labelled "<row label> · <column>", so the assistant receives exactly the
 * figures on screen (missing values read "Not recorded"), plus the page topic, period and source. Pure and tested.
 */
import type { CsvValue } from "@/lib/export";
import { buildSectionContext, type FigureInput } from "./buildSectionContext";
import type { SectionContext } from "@/lib/assistant/sectionContext";

type Column<T> = { key: string; label: string; value: (row: T) => CsvValue };

export function chartContext<T>(input: {
  title: string;
  topic?: string | undefined;
  period?: string | undefined;
  source?: string | undefined;
  columns: readonly Column<T>[];
  rows: readonly T[];
  maxFigures?: number | undefined;
}): SectionContext {
  const [labelCol, ...valueCols] = input.columns;
  const figures: FigureInput[] = [];
  if (labelCol) {
    for (const row of input.rows) {
      const head = labelCol.value(row);
      const name = head === null || head === undefined ? "Not recorded" : String(head);
      if (valueCols.length === 0) figures.push({ label: labelCol.label, value: name });
      for (const col of valueCols) {
        const v = col.value(row);
        figures.push({
          label: `${name} · ${col.label}`,
          value: typeof v === "number" || typeof v === "string" ? v : null,
        });
      }
    }
  }
  return buildSectionContext({
    title: input.title,
    scope: input.topic ?? null,
    period: input.period ?? null,
    source: input.source ?? null,
    figures,
    maxFigures: input.maxFigures ?? 40,
  });
}
