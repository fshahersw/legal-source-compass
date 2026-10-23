/** Shared controls and notices of the Insights pages: labelled selects, segmented toggles, data-state notices. */
import type { ReactNode } from "react";
import { FlaskConical, Info } from "lucide-react";
import type { EntityType, MetricDef, Topic } from "@/lib/insights/contract";
import { cn } from "@/lib/utils";
import { TOPIC_LABEL, TOPIC_ORDER } from "./kpis";
import type { CatalogResult } from "./types";

export const controlClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring";

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <label
      className={cn(
        "block min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

export const ENTITY_LABEL: Record<EntityType, { one: string; many: string }> = {
  nation: { one: "United States", many: "United States" },
  // the state entities include DC and the territories (insights.geo_states), so the plural says so
  state: { one: "state", many: "states, DC and territories" },
  county: { one: "county", many: "counties" },
  circuit: { one: "circuit", many: "circuits" },
  court: { one: "court", many: "courts" },
  judge: { one: "judge", many: "judges" },
  mdl: { one: "MDL", many: "MDLs" },
  company: { one: "company", many: "companies" },
  firm: { one: "law firm", many: "law firms" },
  agency: { one: "agency", many: "agencies" },
  product: { one: "product", many: "products" },
  law_unit: { one: "law", many: "laws" },
};

/** Metric select grouped by topic. */
export function MetricSelect({
  label,
  metrics,
  value,
  onChange,
}: {
  label: string;
  metrics: readonly MetricDef[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const byTopic = new Map<Topic, MetricDef[]>();
  for (const m of metrics) byTopic.set(m.topic, [...(byTopic.get(m.topic) ?? []), m]);
  return (
    <Field label={label}>
      <select
        className={controlClass}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value ? <option value="">Choose a metric</option> : null}
        {TOPIC_ORDER.filter((t) => byTopic.has(t)).map((t) => (
          <optgroup key={t} label={TOPIC_LABEL[t]}>
            {byTopic.get(t)!.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly {
    id: T;
    label: string;
    disabled?: boolean | undefined;
    title?: string | undefined;
  }[];
  value: T;
  onChange: (v: T) => void;
  className?: string | undefined;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap gap-1 rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
            value === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Banner on every Insights page while the dev fixtures are on (dev server only). */
export function FixtureBanner({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-warning/60 bg-warning/15 px-3 py-2 text-xs leading-5"
    >
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong>Development fixtures are on.</strong> Metrics labelled [Fixture] are generated test
        values, not data. This mode exists only on a development server started with
        VITE_INSIGHTS_FIXTURES=1.
      </span>
    </p>
  );
}

/** Quiet note when the insights data layer is not published yet or a bridged reader failed. */
export function CatalogNotice({ catalog }: { catalog: CatalogResult | undefined }) {
  if (!catalog) return null;
  const parts: string[] = [];
  if (catalog.layer === "not_ready")
    parts.push(
      "The platform's own metric layer is not published yet; the metrics here come from published state series and JPML reports.",
    );
  if (catalog.layer === "failed")
    parts.push(
      "The platform's metric layer could not be read just now; the other metrics are unaffected.",
    );
  if (catalog.bridgeFailures.length)
    parts.push(
      `Could not read: ${catalog.bridgeFailures.join(", ")}. Their metrics are missing from the lists.`,
    );
  if (!parts.length) return null;
  return (
    <p role="note" className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
      <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>{parts.join(" ")}</span>
    </p>
  );
}

/** Metric facts for the "How to read this" list: denominator, method and the metric's own caveats. */
export function metricNotes(def: MetricDef): string[] {
  const out: string[] = [];
  out.push(`What is counted: ${def.numerator}.`);
  if (def.denominator) out.push(`Rate denominator: ${def.denominator}.`);
  if (def.method) out.push(`Method: ${def.method.replace(/\.?$/, ".")}`);
  for (const c of def.caveats) out.push(c);
  out.push(
    "A period the source does not record is a gap (Not recorded), never zero. Partial periods are marked * and dashed.",
  );
  return out;
}
