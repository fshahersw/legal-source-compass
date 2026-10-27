/**
 * Label and caveat fixes applied to published state metric definitions until the state_metrics packet carries them
 * (scripts/enrichment/state_metrics/build_state_metrics.py now writes the same text). Each rule is idempotent: once the
 * packet has the HQ wording or the year span, the definition passes through unchanged.
 */
import type { MetricDef } from "@/lib/external/stateMetrics.functions";

export const FDA_HQ_CAVEAT =
  "Recalling-firm headquarters state — not where products were distributed or consumers were exposed.";
const HQ = /\bHQ\b|headquarters/i;
const SPAN = /\(\d{4}(?:[–-]\d{4})?\)/;

function causeSpan(def: MetricDef): string | null {
  const years = def.years;
  if (!years) return def.latestYear != null ? String(def.latestYear) : null;
  return years[0] === years[1] ? String(years[0]) : `${years[0]}–${years[1]}`;
}

/** One definition with the FDA HQ-state basis and the leading-cause year span made explicit. */
export function curateMetricDef(def: MetricDef): MetricDef {
  if (def.key.startsWith("fda_")) {
    const label = HQ.test(def.label) ? def.label : `${def.label} (recalling firm's HQ state)`;
    const caveats = def.caveats.some((c) => /headquarters/i.test(c))
      ? def.caveats
      : [FDA_HQ_CAVEAT, ...def.caveats];
    return label === def.label && caveats === def.caveats ? def : { ...def, label, caveats };
  }
  if (def.key.startsWith("cause_") && !SPAN.test(def.label)) {
    const span = causeSpan(def);
    if (!span) return def;
    const end = span.slice(-4);
    return {
      ...def,
      label: `${def.label} (${span})`,
      short: /\(to \d{4}\)/.test(def.short) ? def.short : `${def.short} (to ${end})`,
      caveats: def.caveats.some((c) => c.includes(`ends in ${end}`))
        ? def.caveats
        : [
            `The NCHS leading-causes series ends in ${end}; later years are not recorded.`,
            ...def.caveats,
          ],
    };
  }
  return def;
}

export const curateMetricDefs = (defs: MetricDef[]): MetricDef[] => defs.map(curateMetricDef);

/** A bundle or panel payload with its metric definitions curated. */
export function curateMetrics<T extends { metrics: MetricDef[] }>(payload: T): T {
  return { ...payload, metrics: curateMetricDefs(payload.metrics) };
}
