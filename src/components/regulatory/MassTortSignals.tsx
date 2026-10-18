import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ExternalLink } from "lucide-react";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getMassTortSignals, type MassTortSignal } from "@/lib/external/massTortSignals.functions";

export const massTortSignalsQuery = {
  queryKey: ["mass-tort-signals"],
  queryFn: () => getMassTortSignals(),
  staleTime: 10 * 60 * 1000,
};

const KINDS = ["drug", "device", "vehicle", "food", "cosmetic"] as const;
const KIND_LABEL: Record<MassTortSignal["kind"], string> = {
  drug: "Drugs",
  device: "Devices",
  vehicle: "Vehicles",
  food: "Food",
  cosmetic: "Cosmetics",
};
const n = (v: number | null | undefined) =>
  typeof v === "number" ? v.toLocaleString("en-US") : "Not recorded";
const compact = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const FIRST_YEAR = 2010;

function yearly(s: MassTortSignal) {
  const last = new Date().getUTCFullYear();
  const out: { year: string; reports: number }[] = [];
  for (let y = FIRST_YEAR; y <= last; y++)
    out.push({ year: String(y), reports: s.eventsByYear[String(y)] ?? 0 });
  return out;
}

/** Whether a scroll box holds rows below its visible area (re-measured on scroll, resize and data). */
function useMoreBelow(deps: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    setBelow(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, deps]);
  return { ref, below, measure };
}

export function MassTortSignals() {
  const q = useQuery(massTortSignalsQuery);
  const [kind, setKind] = useState<MassTortSignal["kind"] | "">("");
  const [selected, setSelected] = useState<number | null>(null);
  const rows = useMemo(
    () =>
      (q.data ?? []).filter((s) => !kind || s.kind === kind).sort((a, b) => b.pending - a.pending),
    [q.data, kind],
  );
  const scroll = useMoreBelow(rows);
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading product signals">
        <div className="h-24 animate-pulse rounded-md border border-border bg-muted/50" />
        <div className="h-96 animate-pulse rounded-md border border-border bg-muted/50" />
      </div>
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="rounded-md border border-border px-4 py-6 text-sm text-destructive"
      >
        Product signals could not be loaded.
      </p>
    );
  if (!q.data?.length)
    return (
      <p className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground">
        No product signals have been published yet.
      </p>
    );
  const active = rows.find((r) => r.mdl === selected) ?? rows[0] ?? null;
  const counts = Object.fromEntries(
    KINDS.map((k) => [k, q.data.filter((s) => s.kind === k).length]),
  );
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Each products-liability MDL is matched to its product in FDA adverse-event and recall data
        (openFDA) or NHTSA vehicle complaints. {q.data[0]?.caveat}
      </p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Product kind">
        <KindButton active={!kind} onClick={() => setKind("")} label={`All · ${q.data.length}`} />
        {KINDS.filter((k) => counts[k]).map((k) => (
          <KindButton
            key={k}
            active={kind === k}
            onClick={() => setKind(k)}
            label={`${KIND_LABEL[k]} · ${counts[k]}`}
          />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section
          className="relative min-w-0 rounded-md border border-border bg-surface"
          aria-label="Products"
        >
          <p className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              {rows.length.toLocaleString("en-US")} product{rows.length === 1 ? "" : "s"}
              {kind ? ` · ${KIND_LABEL[kind]}` : ""} · most pending actions first
            </span>
            {scroll.below ? (
              <span className="inline-flex shrink-0 items-center gap-0.5">
                Scroll for more
                <ChevronDown className="size-3" aria-hidden />
              </span>
            ) : null}
          </p>
          <div
            ref={scroll.ref}
            onScroll={scroll.measure}
            className="max-h-[720px] overflow-auto focus-visible:outline-2 focus-visible:outline-ring"
            role="region"
            tabIndex={0}
            aria-label={`Products, ${rows.length} rows; scrollable`}
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-surface text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Product · MDL
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Pending
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Reports
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Since 2010
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.mdl}
                    aria-selected={active?.mdl === s.mdl}
                    className={`cursor-pointer border-t border-border/60 ${active?.mdl === s.mdl ? "bg-muted" : "hover:bg-muted/40"}`}
                    onClick={() => setSelected(s.mdl)}
                  >
                    <td className="max-w-[260px] px-3 py-1.5">
                      <button
                        type="button"
                        className="block w-full truncate text-left font-medium focus-visible:outline-2 focus-visible:outline-ring"
                        title={s.product}
                        onClick={() => setSelected(s.mdl)}
                      >
                        {s.product}
                      </button>
                      <div className="text-muted-foreground">
                        MDL {s.mdl} · {KIND_LABEL[s.kind]}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{n(s.pending)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.eventTotal === null ? "—" : compact(s.eventTotal)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Bars s={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scroll.below ? (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-md bg-linear-to-t from-surface to-transparent"
              aria-hidden
            />
          ) : null}
        </section>
        {active ? <Detail s={active} /> : null}
      </div>
    </div>
  );
}

function KindButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted"}`}
    >
      {label}
    </button>
  );
}

function Bars({ s }: { s: MassTortSignal }) {
  const data = yearly(s);
  const max = Math.max(1, ...data.map((d) => d.reports));
  return (
    <div className="flex h-5 items-end gap-px" aria-hidden title="Reports per year since 2010">
      {data.map((d) => (
        <span
          key={d.year}
          className="w-[3px] rounded-sm bg-primary/60"
          style={{ height: `${Math.max(4, (100 * d.reports) / max)}%` }}
        />
      ))}
    </div>
  );
}

function Detail({ s }: { s: MassTortSignal }) {
  const data = yearly(s);
  const series = s.series.map((p) => ({
    date: new Date(p.date + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }),
    pending: p.pending,
  }));
  return (
    <section className="min-w-0 space-y-3" aria-label={`${s.product} detail`}>
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-sans text-base font-semibold">{s.product}</h2>
            <p className="text-xs text-muted-foreground">
              <Link
                to="/records/$dataset/$id"
                params={{ dataset: "mdl_analytics", id: String(s.mdl) }}
                className="text-primary hover:underline"
              >
                MDL {s.mdl}
              </Link>{" "}
              · {s.title.replace(/^IN RE:\s*/i, "")} · {s.district} · {s.judge}
            </p>
          </div>
          {s.eventsQuery ? (
            <a
              href={s.eventsQuery}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Query <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact
            label="Pending actions"
            value={n(s.pending)}
            note={
              s.change12m === null
                ? undefined
                : `${s.change12m > 0 ? "+" : ""}${s.change12m.toLocaleString("en-US")} in 12 months`
            }
          />
          <Fact
            label="Reports mentioning product"
            value={n(s.eventTotal)}
            note={s.source.split(" via ")[0]}
          />
          <Fact
            label="Reports in 2025"
            value={n(s.eventsByYear["2025"] ?? null)}
            note={`2024: ${n(s.eventsByYear["2024"] ?? null)}`}
          />
          <Fact
            label="Recalls matched"
            value={s.kind === "vehicle" ? "See NHTSA recalls" : n(s.recallTotal)}
          />
        </dl>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Reports received per year" subtitle={s.source}>
          <div className="h-52 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={axis} interval={2} />
                <YAxis tick={axis} tickFormatter={compact} width={44} />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-US")} />
                <Bar dataKey="reports" fill={FDA_COLORS[1]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Actions pending in the MDL" subtitle="JPML monthly reports">
          <div className="h-52 px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={axis} minTickGap={24} />
                <YAxis tick={axis} tickFormatter={compact} width={44} />
                <Tooltip formatter={(v: number) => v.toLocaleString("en-US")} />
                <Line
                  dataKey="pending"
                  stroke={FDA_COLORS[2]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title={
            s.kind === "device"
              ? "Most-reported device problems"
              : s.kind === "vehicle"
                ? "Outcomes"
                : "Most-reported reactions"
          }
          subtitle="Counts of reports"
        >
          <ol className="divide-y divide-border/60 text-xs">
            {(s.topTerms.length
              ? s.topTerms
              : Object.entries(s.breakdown).map(([term, count]) => ({ term, count }))
            )
              .slice(0, 10)
              .map((t) => (
                <li key={t.term} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate" title={t.term || "Not stated"}>
                    {t.term || "Not stated"}
                  </span>
                  <span className="tabular-nums">{n(t.count)}</span>
                </li>
              ))}
          </ol>
          {s.kind !== "vehicle" && Object.keys(s.breakdown).length ? (
            <p className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
              {s.kind === "drug" ? "Seriousness" : "Event type"}:{" "}
              {Object.entries(s.breakdown)
                .map(
                  ([k, v]) =>
                    `${s.kind === "drug" ? (k === "1" ? "serious" : k === "2" ? "non-serious" : k) : k || "not stated"} ${v.toLocaleString("en-US")}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </ChartCard>
        <ChartCard
          title="Recent recalls"
          subtitle={
            s.kind === "vehicle"
              ? "NHTSA recalls are listed in the NHTSA recalls collection"
              : "FDA enforcement reports matching the product"
          }
        >
          <ul className="divide-y divide-border/60 text-xs">
            {uniqueRecalls(s.recentRecalls).map((r) => (
              <li
                key={
                  (r.recall_number ?? r.res_event_number ?? "") +
                  (r.report_date ?? r.event_date_initiated ?? "")
                }
                className="px-3 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {r.recall_number ?? r.res_event_number ?? "Recall"}
                  </span>
                  {r.classification ? (
                    <span className="text-muted-foreground">{r.classification}</span>
                  ) : null}
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {fmtDate(r.report_date ?? r.event_date_initiated)}
                  </span>
                </div>
                <div className="truncate text-muted-foreground" title={recallLine(r) || undefined}>
                  {recallLine(r) || "Recalling firm and reason not recorded"}
                </div>
              </li>
            ))}
            {!uniqueRecalls(s.recentRecalls).length ? (
              <li className="px-3 py-4 text-muted-foreground">No matching recalls.</li>
            ) : null}
          </ul>
        </ChartCard>
      </div>
    </section>
  );
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.slice(0, 10);
}

/** "Firm · reason" with a missing part left out, never a dangling separator. */
const recallLine = (r: MassTortSignal["recentRecalls"][number]) =>
  [r.recalling_firm, r.reason_for_recall].filter(Boolean).join(" · ");

function Fact({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/** FDA device recalls list one row per product line of the same recall event; show each event once. */
function uniqueRecalls(recalls: MassTortSignal["recentRecalls"]) {
  const seen = new Set<string>();
  return recalls.filter((r) => {
    const key = r.res_event_number ?? r.recall_number ?? `${r.report_date}-${r.reason_for_recall}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
