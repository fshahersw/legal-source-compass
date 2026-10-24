/**
 * A KPI tile's change as a delta pill plus the rest of the sentence, every figure exactly as the model printed it
 * ("+12,700 (+4.4%) vs FY2024" → pill "+4.4%", detail "+12,700 vs FY2024"). The pill's direction is the model's own
 * direction of the absolute change; it carries no good/bad tone (none of these metrics has an agreed good direction).
 */
import { splitChangeText } from "@/components/kit/format";
import type { KpiDelta } from "@/components/kit/KpiCard";
import type { Kpi } from "./kpis";

export function kpiDelta(kpi: Kpi): KpiDelta | null {
  if (!kpi.changeText) return null;
  const parts = splitChangeText(kpi.changeText);
  const sign =
    kpi.direction === "up"
      ? 1
      : kpi.direction === "down"
        ? -1
        : kpi.direction === "flat"
          ? 0
          : null;
  const detail = [
    parts.percent ? parts.change : null,
    parts.comparison ? `vs ${parts.comparison}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { value: sign, text: parts.percent ?? parts.change, detail: detail || undefined };
}
