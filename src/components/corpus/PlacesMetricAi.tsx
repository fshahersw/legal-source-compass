/**
 * AI summary and Ask AI for the measure the Places map is shaded by, grounded in the figures the comparison chart
 * shows: the median of the states with a value, the five highest and five lowest, and how many states have a value.
 */
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { buildSectionContext, type FigureInput } from "@/components/kit/ai/buildSectionContext";

export function PlacesMetricAi({
  label,
  unit,
  period,
  source,
  median,
  ranked,
  format,
  total,
}: {
  label: string;
  unit: string;
  period: string | undefined;
  source: string | undefined;
  median: number;
  /** States with a value, highest first. */
  ranked: readonly { name: string; value: number }[];
  format: (v: number) => string;
  /** States the measure covers (50 states and DC). */
  total: number;
}) {
  const figures: FigureInput[] = [
    { label: "Median of states with a value", value: format(median), unit },
    { label: "States with a value", value: `${ranked.length} of ${total}` },
    ...ranked
      .slice(0, 5)
      .map((r, i) => ({ label: `#${i + 1} ${r.name}`, value: format(r.value), unit })),
    ...ranked.slice(-5).map((r, i, a) => ({
      label: `#${ranked.length - a.length + i + 1} ${r.name}`,
      value: format(r.value),
      unit,
    })),
  ];
  const title = `${label} by state`;
  const context = buildSectionContext({
    id: "places-metric",
    title,
    scope: "50 states and DC",
    period: period ?? null,
    source: source ?? null,
    figures,
    maxFigures: figures.length,
  });
  return (
    <AiSummary
      context={context}
      className="mt-3"
      actions={
        <AskAiButton
          sectionId="places-metric"
          title={title}
          context={context}
          questions={[
            "Why might the highest states be so far above the median?",
            "What does this measure count, and what does it leave out?",
            "How should I compare two states on this measure?",
          ]}
        />
      }
    />
  );
}
