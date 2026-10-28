/**
 * How large EPA penalties are: every published case record (federal penalty of $100,000 or more) on one log-dollar
 * axis, one row per case type, with each row's median taken from the records. Answers "do judicial cases settle for
 * more than administrative ones, and how far up the tail do they go?" without pooling another agency's amounts.
 */
import { useMemo } from "react";
import { scaleLog } from "d3-scale";
import { ChartCard } from "@/components/kit/ChartCard";
import { useWidth } from "@/components/charts/d3/charts";
import { chartTokens, seriesVar } from "@/components/charts/palette";
import type { EpaCaseRow } from "@/lib/external/enforcement.functions";
import { count, usd } from "./enforcementView";
import {
  EPA_FLOOR,
  decadeCeiling,
  epaPenaltySizes,
  logHistogram,
  type EpaCaseType,
} from "./penaltyDistribution";

const TYPE_LABEL: Record<EpaCaseType, string> = {
  judicial: "Judicial",
  administrative: "Administrative",
  other: "Other type",
};
const TYPE_SLOT: Record<EpaCaseType, number> = { judicial: 0, administrative: 1, other: 3 };
const ROW = 58;
const GAP = 14;
const AXIS = 24;
const TICK = "fill-muted-foreground text-[11px] tabular-nums";

export function EpaPenaltySizes({
  rows,
  pending,
  error,
  onRetry,
  fromFy,
  toFy,
  state,
  scopeName,
  sourceHref,
}: {
  rows: readonly EpaCaseRow[] | undefined;
  pending: boolean;
  error: boolean;
  onRetry: () => void;
  fromFy: number;
  toFy: number;
  state?: string | undefined;
  scopeName: string;
  sourceHref: string;
}) {
  const sizes = useMemo(
    () => epaPenaltySizes(rows ?? [], { fromFy, toFy, state }),
    [rows, fromFy, toFy, state],
  );
  const types = (["judicial", "administrative", "other"] as const).filter(
    (t) => sizes.count[t] > 0,
  );
  const mJ = sizes.median.judicial;
  const mA = sizes.median.administrative;
  const title =
    mJ != null && mA != null
      ? `Median penalty: ${usd(mJ)} in judicial cases, ${usd(mA)} in administrative ones`
      : sizes.median.all != null
        ? `Median penalty ${usd(sizes.median.all)}`
        : "Size of EPA federal penalties";
  const period = `FY${fromFy}–FY${toFy}`;
  const source = {
    source: { label: "U.S. EPA, ECHO enforcement case data", href: sourceHref },
    period,
    about: (
      <>
        <p>
          Each row is a histogram of the published EPA case records (a federal penalty of $100,000
          or more with a settlement in FY2017 or later), binned four to a power of ten. The penalty
          is the case&rsquo;s total federal penalty across its settlements, placed in the fiscal
          year of its latest settlement. Smaller penalties are not published as case records, so
          these medians describe large cases only.
        </p>
        <p className="mt-1.5">
          A national case recorded as several regional records sharing one penalty counts once, at
          the combined penalty
          {sizes.mergedNational ? ` (${count(sizes.mergedNational)} such cases here)` : ""}. Each
          row is scaled to its own tallest bar so the shapes can be compared; the case counts are
          printed beside each row.
        </p>
      </>
    ),
  };
  return (
    <ChartCard
      id="epa-penalty-sizes"
      title={title}
      subtitle={`${scopeName} · ${count(sizes.count.all)} cases with a federal penalty of $100K or more, settled ${period}`}
      aiScope={state ? `Facility state ${state}` : undefined}
      source={source}
      state={pending ? "loading" : error ? "error" : sizes.count.all ? "ready" : "empty"}
      emptyText="No published case with a federal penalty of $100,000 or more settled in this window."
      onRetry={onRetry}
      height={types.length * (ROW + GAP) + AXIS + 8}
      data={{
        title: "EPA cases by federal penalty",
        rows: [...sizes.cases].sort((a, b) => b.penalty - a.penalty),
        rowKey: (c) => c.key,
        columns: [
          { key: "name", label: "Case", value: (c) => c.name },
          { key: "key", label: "Case number", value: (c) => c.key },
          { key: "type", label: "Type", value: (c) => TYPE_LABEL[c.type] },
          { key: "penalty", label: "Federal penalty (USD)", value: (c) => c.penalty },
          { key: "fy", label: "Settlement FY", value: (c) => c.settlementFy },
          { key: "records", label: "Regional records", value: (c) => c.records },
        ],
        source,
      }}
    >
      <Ridges sizes={sizes} types={types} />
    </ChartCard>
  );
}

function Ridges({
  sizes,
  types,
}: {
  sizes: ReturnType<typeof epaPenaltySizes>;
  types: readonly EpaCaseType[];
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const hi = decadeCeiling(
    sizes.cases.map((c) => c.penalty),
    EPA_FLOOR,
  );
  const left = W < 480 ? 96 : 128;
  const x = scaleLog()
    .domain([EPA_FLOOR, hi])
    .range([left, Math.max(left + 40, W - 16)]);
  const decades: number[] = [];
  for (let v = EPA_FLOOR; v <= hi * 1.0001; v *= 10) decades.push(v);
  const height = types.length * (ROW + GAP) + AXIS;
  // On narrow cards a decade can be narrower than its label: label every other decade (grid lines stay).
  const step = x(EPA_FLOOR * 10) - x(EPA_FLOOR) < 52 ? 2 : 1;
  const tick = (v: number) => usd(v, 0).replace(".0", "");
  return (
    <div ref={box} className="min-w-0 px-4 pb-3">
      <svg
        style={chartTokens}
        width={W}
        height={height}
        className="block"
        role="img"
        aria-label={`Federal penalties by case type on a log scale: ${types
          .map((t) => `${TYPE_LABEL[t]} ${sizes.count[t]} cases, median ${usd(sizes.median[t])}`)
          .join("; ")}`}
      >
        {decades.map((d) => (
          <g key={d}>
            <line
              x1={x(d)}
              x2={x(d)}
              y1={0}
              y2={height - AXIS}
              style={{ stroke: "var(--chart-grid)" }}
            />
            {decades.indexOf(d) % step === 0 ? (
              <text x={x(d)} y={height - 8} textAnchor="middle" className={TICK}>
                {tick(d)}
              </text>
            ) : null}
          </g>
        ))}
        {types.map((t, ti) => {
          const values = sizes.cases.filter((c) => c.type === t).map((c) => c.penalty);
          const bins = logHistogram(values, EPA_FLOOR, hi, 4);
          const max = Math.max(1, ...bins.map((b) => b.count));
          const top = ti * (ROW + GAP) + 4;
          const base = top + ROW;
          const med = sizes.median[t];
          const fill = seriesVar(TYPE_SLOT[t]);
          return (
            <g key={t}>
              <text x={0} y={top + 14} className="fill-foreground text-[12px] font-medium">
                {TYPE_LABEL[t]}
              </text>
              <text x={0} y={top + 30} className={TICK}>
                {count(sizes.count[t])} cases
              </text>
              <line
                x1={left}
                x2={x(hi)}
                y1={base}
                y2={base}
                style={{ stroke: "var(--chart-axis, var(--chart-grid))" }}
              />
              {bins.map((b) =>
                b.count ? (
                  <rect
                    key={b.x0}
                    x={x(b.x0) + 0.75}
                    width={Math.max(1, x(b.x1) - x(b.x0) - 1.5)}
                    y={base - (ROW - 14) * (b.count / max)}
                    height={(ROW - 14) * (b.count / max)}
                    rx={1.5}
                    style={{ fill, opacity: 0.85 }}
                  >
                    <title>{`${TYPE_LABEL[t]} · ${usd(b.x0)}–${usd(b.x1)}: ${count(b.count)} cases`}</title>
                  </rect>
                ) : null,
              )}
              {med != null ? (
                <g>
                  <line
                    x1={x(med)}
                    x2={x(med)}
                    y1={top + 6}
                    y2={base}
                    style={{ stroke: "var(--foreground)", strokeWidth: 1.5 }}
                    strokeDasharray="3 2"
                  />
                  <text
                    x={x(med) + (x(med) > W - 140 ? -5 : 5)}
                    y={top + 12}
                    textAnchor={x(med) > W - 140 ? "end" : "start"}
                    className="fill-foreground text-[11px] font-medium tabular-nums"
                  >
                    median {usd(med)}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
