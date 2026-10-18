import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { niceMax } from "./chartScale";

export type MiniPoint = {
  x: number;
  /** Axis label for the point, e.g. "2024" or "FY2025". */
  label: string;
  y: number | null;
  /** A comparison series (the United States median, terminations beside filings). */
  y2?: number | null;
  /** The figure as the source printed it, shown in the tooltip. */
  text?: string | null;
  /** One extra tooltip line, e.g. the Census vintage behind a per-100K figure. */
  note?: string | null;
};

type TipProps = {
  active?: boolean;
  payload?: { payload?: MiniPoint }[];
  format: (n: number) => string;
  name: string;
  name2?: string | undefined;
};

function MiniTip({ active, payload, format, name, name2 }: TipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] shadow-sm">
      <p className="font-medium">{p.label}</p>
      <p>
        {name}:{" "}
        <span className="font-mono">{p.y == null ? "Not recorded" : (p.text ?? format(p.y))}</span>
      </p>
      {name2 && p.y2 !== undefined ? (
        <p>
          {name2}: <span className="font-mono">{p.y2 == null ? "Not recorded" : format(p.y2)}</span>
        </p>
      ) : null}
      {p.note ? <p className="text-muted-foreground">{p.note}</p> : null}
    </div>
  );
}

const tick = { fontSize: 10, fill: "var(--muted-foreground)" };

/**
 * A small line chart for one measure across editions or fiscal years. Missing points break the line (no
 * interpolation), dashed vertical markers flag editions with a definition notice, and a screen-reader table carries
 * the same figures the chart draws.
 */
export function MiniLine({
  title,
  valueLabel,
  data,
  name,
  name2,
  format,
  axisFormat,
  markers = [],
  height = 92,
  color = FDA_COLORS[1],
  color2 = "var(--muted-foreground)",
}: {
  title: string;
  /** The latest figure, shown beside the title. */
  valueLabel?: string | null | undefined;
  data: readonly MiniPoint[];
  name: string;
  name2?: string | undefined;
  format: (n: number) => string;
  axisFormat?: ((n: number) => string) | undefined;
  /** x values that get a dashed vertical line. */
  markers?: readonly number[];
  height?: number;
  color?: string | undefined;
  color2?: string | undefined;
}) {
  const known = data.filter((d) => d.y != null);
  const summary = known.length
    ? `${title}: ${known.map((d) => `${d.label} ${d.text ?? format(d.y as number)}`).join(", ")}`
    : `${title}: Not recorded`;
  const xs = new Set(data.map((d) => d.x));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="min-w-0 font-medium leading-tight">{title}</span>
        {valueLabel ? (
          <span className="shrink-0 font-mono text-muted-foreground">{valueLabel}</span>
        ) : null}
      </figcaption>
      {known.length ? (
        <div role="img" aria-label={summary} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data as MiniPoint[]} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={tick}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={axisFormat ? 44 : 40}
                tickCount={3}
                domain={[0, niceMax]}
                tickFormatter={axisFormat ?? format}
              />
              {markers
                .filter((m) => xs.has(m))
                .map((m) => {
                  const label = data.find((d) => d.x === m)?.label;
                  return label ? (
                    <ReferenceLine
                      key={m}
                      x={label}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="2 3"
                      strokeOpacity={0.8}
                    />
                  ) : null;
                })}
              <Tooltip
                content={<MiniTip format={format} name={name} name2={name2} />}
                cursor={{ stroke: "var(--border)" }}
              />
              {name2 ? (
                <Line
                  type="monotone"
                  dataKey="y2"
                  stroke={color2}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="y"
                stroke={color}
                strokeWidth={1.75}
                dot={{ r: 2.5, strokeWidth: 0, fill: color }}
                activeDot={{ r: 3.5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-3 text-[11px] text-muted-foreground">Not recorded</p>
      )}
      {name2 && known.length ? (
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[10.5px] text-muted-foreground">
          <span>
            <span
              aria-hidden
              className="mr-1 inline-block h-0.5 w-3 align-middle"
              style={{ background: color }}
            />
            {name}
          </span>
          <span>
            <span
              aria-hidden
              className="mr-1 inline-block w-3 border-t-2 border-dashed align-middle"
              style={{ borderColor: color2 }}
            />
            {name2}
          </span>
        </p>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{name}</th>
            {name2 ? <th scope="col">{name2}</th> : null}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.x}>
              <th scope="row">{d.label}</th>
              <td>{d.y == null ? "Not recorded" : (d.text ?? format(d.y))}</td>
              {name2 ? <td>{d.y2 == null ? "Not recorded" : format(d.y2)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
