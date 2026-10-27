/** Shared formatting and small controls for the exposure-geography blocks. */
import type { ReactNode } from "react";
import { NOT_RECORDED } from "@/components/charts/format";

export const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
export const fmtPct = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
export const fmtShare = (v: number) =>
  `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
export const fmtNgl = (v: number) =>
  `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ng/L`;
export const orNR = (v: number | null | undefined, f: (n: number) => string) =>
  typeof v === "number" && Number.isFinite(v) ? f(v) : NOT_RECORDED;

/** UCMR 5 period: sample dates (years only when `short`) and the EPA data file they come from. */
export function ucmrPeriod(
  s: { firstSample: string | null; lastSample: string | null; fileDate: string | null },
  short = false,
): string {
  const range =
    s.firstSample && s.lastSample
      ? short
        ? `${s.firstSample.slice(0, 4)}–${s.lastSample.slice(0, 4)}`
        : `${s.firstSample} to ${s.lastSample}`
      : "UCMR 5";
  return s.fileDate ? `${range} (EPA file of ${s.fileDate})` : range;
}

/** Partial-period note for UCMR 5: EPA is still adding results, so counts are not final. */
export function ucmrPartial(s: { fileDate: string | null }): string {
  return s.fileDate
    ? `EPA data file of ${s.fileDate}; EPA may add results, so these counts are not final.`
    : "EPA may add results, so these counts are not final.";
}

const selectClass =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring";

export function Picker({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "About this data" list. */
export function AboutList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export const PARTD_ABOUT: readonly ReactNode[] = [
  "Claims are Medicare Part D prescription fills, including refills, for the drugs the MDL title names (or the drug class it names, by FDA pharmacologic class).",
  "The state is where the prescriber practices, not where the patient lives.",
  'CMS leaves out rows with fewer than 11 claims. Where a product is missing for a state, the total is shown as "at least": the true figure is at most 10 claims higher per missing product.',
  "States (50 and DC) are ranked on those ranges. A rank such as 3–4 means a hidden product could change the order; a wider range is shown as Not ranked.",
  "MDLs that name the same drugs (such as the two GLP-1 MDLs) count the same prescriptions and share one bar.",
  "Part D only: no Medicaid, commercial or cash prescriptions, and no clinic-administered (Part B) doses.",
  "These are prescriptions, not people with a claim, and never plaintiffs.",
];

export const PLACES_ABOUT: readonly ReactNode[] = [
  "Model-based county estimates of adults from the 2023 Behavioral Risk Factor Surveillance System, published by CDC in the 2025 PLACES release.",
  "Each estimate has a 95% confidence interval; small counties have wide intervals.",
  "A condition is shown here only when an FDA label states the named drug treats it, or the MDL title names the injury.",
  "A condition count is a population at risk or treated, never a count of plaintiffs.",
];

export const PFAS_ABOUT: readonly ReactNode[] = [
  "EPA's fifth Unregulated Contaminant Monitoring Rule (UCMR 5) tested public water systems for 29 PFAS; the sample dates shown are the first and last in EPA's file.",
  "A detection is a result at or above EPA's minimum reporting level. It shows occurrence only and does not identify a source; it is not evidence of firefighting foam.",
  "4.0 ng/L is the value of the 2024 PFOA and PFOS drinking-water standards. Single results above it are not compliance findings, which use annual averages.",
  "UCMR 5 tested every system serving more than 3,300 people but only a national sample of smaller systems, so a state's share of all tested systems depends on its sample. States are compared on large systems (more than 10,000 people), which were all tested.",
  "Population served comes from EPA's SDWIS by exact water-system ID and is summed over community water systems. Non-community systems (schools, workplaces) count people on a typical day and are left out of that sum; systems that buy water from another system can still overlap.",
  "EPA keeps adding UCMR 5 results; the file date shown is the version used.",
];
