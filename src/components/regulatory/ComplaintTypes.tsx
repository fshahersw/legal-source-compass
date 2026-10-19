import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  axisTick,
  MoreToggle,
  Panel,
  Segmented,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getComplaintTypes,
  type Labelled,
  type ReportProduct,
} from "@/lib/external/complaintTypes.functions";
import { n } from "./recallInsights";

type Tab = "consumer" | "vehicles" | "devices" | "drugs";
const TABS: { id: Tab; label: string }[] = [
  { id: "consumer", label: "Consumer products" },
  { id: "vehicles", label: "Vehicles" },
  { id: "devices", label: "Medical devices" },
  { id: "drugs", label: "Drugs" },
];

function Bars({
  rows,
  color = FDA_COLORS[1]!,
  limit = 10,
  id,
}: {
  rows: Labelled[];
  color?: string;
  limit?: number;
  id: string;
}) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div>
      <ul id={id} className="m-0 list-none space-y-1 p-0">
        {shown.map((r) => (
          <li
            key={r.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-xs"
          >
            <span className="min-w-0">
              <span className="block truncate" title={r.label}>
                {r.label}
              </span>
              <span className="mt-0.5 block h-1.5 rounded-full bg-muted">
                <span
                  className="block h-1.5 rounded-full"
                  style={{ width: `${(100 * r.count) / max}%`, background: color }}
                />
              </span>
            </span>
            <span className="font-mono tabular-nums">{n(r.count)}</span>
          </li>
        ))}
      </ul>
      <MoreToggle
        total={rows.length}
        limit={limit}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls={id}
      />
    </div>
  );
}

function ProductTable({ rows, kind }: { rows: ReportProduct[]; kind: "devices" | "drugs" }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-xs">
        <thead className="text-[11px] text-muted-foreground">
          <tr className="border-b border-border/70">
            <th scope="col" className="px-3 py-1.5 font-medium">
              Product
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Reports
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              {kind === "drugs" ? "Serious" : "Injuries"}
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Deaths
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              {kind === "drugs" ? "Filed by lawyers" : "Most reported problem"}
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Peak
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.mdl}-${p.product}`} className="border-b border-border/40 last:border-0">
              <th scope="row" className="px-3 py-1.5 font-normal">
                {p.mdl ? (
                  <Link
                    to="/matters/lens/$mdl"
                    params={{ mdl: String(p.mdl) }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {p.product}
                  </Link>
                ) : (
                  p.product
                )}
              </th>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{n(p.reports)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                {(kind === "drugs" ? p.serious : p.injuries) === null
                  ? "Not recorded"
                  : n((kind === "drugs" ? p.serious : p.injuries)!)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                {p.deaths === null ? "Not recorded" : n(p.deaths)}
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {kind === "drugs"
                  ? p.lawyerShare === null
                    ? "Not recorded"
                    : `${p.lawyerShare}%`
                  : (p.topProblem ?? "Not recorded")}
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">
                {p.peakYear ?? "Not recorded"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Complaint and report types from the consumer, vehicle, device and drug report sources in the corpus. */
export function ComplaintTypes() {
  const [tab, setTab] = useState<Tab>("consumer");
  const q = useQuery({
    queryKey: ["complaint-types"],
    queryFn: () => getComplaintTypes(),
    staleTime: 60 * 60 * 1000,
  });
  const d = q.data;
  return (
    <Panel
      title="Complaints and adverse-event reports"
      subtitle="What people report, by type. Reports are not incidence and do not establish that a product caused harm."
      actions={<Segmented label="Report source" value={tab} options={TABS} onChange={setTab} />}
      footnote={
        tab === "consumer"
          ? "SaferProducts.gov reports are unverified submissions; hazard themes are keyword classifications of the report text."
          : tab === "vehicles"
            ? "NHTSA owner complaints received 2020 onward, summed over makes; one complaint can name several components."
            : tab === "devices"
              ? "MAUDE reports by event type as filed; manufacturers file most reports, and reporting rises with litigation."
              : "FAERS reports mentioning each tracked product; lawyer-filed share from the reporter field."
      }
    >
      {q.isLoading ? (
        <div
          className="m-3 h-56 animate-pulse rounded-md bg-muted/40"
          aria-busy="true"
          aria-label="Loading report types"
        />
      ) : q.isError || !d ? (
        <div className="p-3">
          <StateNote
            tone="error"
            action={
              <button
                type="button"
                className="text-primary underline"
                onClick={() => void q.refetch()}
              >
                Retry
              </button>
            }
          >
            Report types could not be loaded.
          </StateNote>
        </div>
      ) : tab === "consumer" ? (
        <div className="grid gap-4 p-3 lg:grid-cols-2">
          <section>
            <h4 className="mb-1.5 text-xs font-semibold">Hazard themes across all reports</h4>
            <Bars rows={d.consumer.themes} id="consumer-themes" color={FDA_COLORS[2]!} />
          </section>
          <section>
            <h4 className="mb-1.5 text-xs font-semibold">Product categories</h4>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {d.consumer.categories.slice(0, 9).map((c) => (
                <li key={c.name} className="text-xs">
                  <p className="m-0 flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="font-mono tabular-nums">
                      {n(c.reports)}
                      {c.changePct !== null ? (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {c.changePct > 0 ? "+" : ""}
                          {c.changePct.toFixed(0)}%
                        </span>
                      ) : null}
                    </span>
                  </p>
                  <p className="m-0 text-[11px] text-muted-foreground">
                    {c.injuries !== null ? `${n(c.injuries)} injuries` : "Injuries not recorded"}
                    {c.deaths !== null ? ` · ${n(c.deaths)} deaths` : ""}
                    {c.themes.length
                      ? ` · mostly ${c.themes
                          .slice(0, 3)
                          .map((t) => t.label.toLowerCase())
                          .join(", ")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : tab === "vehicles" ? (
        <div className="grid gap-4 p-3 lg:grid-cols-2">
          <section>
            <h4 className="mb-1.5 text-xs font-semibold">
              Complaints by component ({n(d.vehicles.total)} component mentions)
            </h4>
            <Bars
              rows={d.vehicles.components.map((c) => ({ label: c.component, count: c.complaints }))}
              id="vehicle-components"
            />
          </section>
          <section>
            <h4 className="mb-1.5 text-xs font-semibold">Crashes, fires and deaths reported</h4>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {[...d.vehicles.components]
                .sort((a, b) => b.crashes + b.fires - (a.crashes + a.fires))
                .slice(0, 8)
                .map((c) => (
                  <li key={c.component} className="text-xs">
                    <p className="m-0 font-medium">{c.component}</p>
                    <p className="m-0 text-[11px] text-muted-foreground">
                      {n(c.crashes)} crashes · {n(c.fires)} fires · {n(c.injured)} injured ·{" "}
                      {n(c.deaths)} deaths · most named:{" "}
                      {c.topMakes
                        .slice(0, 3)
                        .map((m) => m.label)
                        .join(", ")}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      ) : tab === "devices" ? (
        <div className="space-y-3 p-3">
          {d.devices.national.length ? (
            <div className="h-56" aria-label="MAUDE reports by event type and year">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={d.devices.national.filter((y) => !y.partial)}
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="year" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis
                    tick={axisTick}
                    width={56}
                    tickFormatter={(v) =>
                      v >= 1e6
                        ? `${(v / 1e6).toFixed(1)}M`
                        : v >= 1e3
                          ? `${Math.round(v / 1e3)}k`
                          : String(v)
                    }
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [n(Number(v)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="malfunction"
                    name="Malfunction"
                    stackId="a"
                    stroke={FDA_COLORS[0]!}
                    fill={FDA_COLORS[0]!}
                    fillOpacity={0.55}
                  />
                  <Area
                    type="monotone"
                    dataKey="injury"
                    name="Injury"
                    stackId="a"
                    stroke={FDA_COLORS[2]!}
                    fill={FDA_COLORS[2]!}
                    fillOpacity={0.55}
                  />
                  <Area
                    type="monotone"
                    dataKey="death"
                    name="Death"
                    stackId="a"
                    stroke={FDA_COLORS[4]!}
                    fill={FDA_COLORS[4]!}
                    fillOpacity={0.7}
                  />
                  <Area
                    type="monotone"
                    dataKey="other"
                    name="Other or unclassified"
                    stackId="a"
                    stroke={FDA_COLORS[5]!}
                    fill={FDA_COLORS[5]!}
                    fillOpacity={0.4}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <ProductTable rows={d.devices.products} kind="devices" />
        </div>
      ) : (
        <div className="p-0 pb-1">
          <ProductTable rows={d.drugs.products} kind="drugs" />
        </div>
      )}
      {d && d.dropped ? (
        <p className="m-0 px-3 pb-2 text-[11px] text-muted-foreground">
          {d.dropped} stored rows could not be read and are not shown.
        </p>
      ) : null}
    </Panel>
  );
}
