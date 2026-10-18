import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExternalLink } from "lucide-react";
import { ChartCard, ChartUnavailable } from "@/components/fda-analytics/FdaCharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import type { Matter, MdlIntel } from "@/lib/external/mdlIntel.functions";
import { sessionPlace } from "@/lib/external/mdlIntelView";
import { cn } from "@/lib/utils";
import { axis, n, OUTCOME_COLOR, OUTCOME_LABEL, OUTCOME_ORDER, title } from "./intelFormat";

const countTick = (v: number) => n(v);
const countTooltip = (v: unknown) => n(Number(v));

const SOURCE_LABEL: Record<string, string> = {
  govinfo: "GovInfo order",
  jpml_panel_orders_page: "JPML Panel Orders",
  jpml_archive_order: "JPML archive order",
  jpml_pending_report: "JPML pending report",
};
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });

/** Hearing sessions (2021–2026): Section A outcomes per session, transferee districts chosen and GovInfo coverage. */
export function HearingOutcomes({ data }: { data: MdlIntel }) {
  const [section, setSection] = useState<"A" | "B">("A");
  const [open, setOpen] = useState<string | null>(null);
  const sessions = [...data.sessions].sort((a, b) => a.date.localeCompare(b.date));
  const matters = data.matters.filter((m) => m.section === section);
  const outcomes = OUTCOME_ORDER.filter((o) => matters.some((m) => m.outcome === o));
  const chart = sessions.map((s) => {
    const row: Record<string, string | number> = { session: shortDate(s.date), date: s.date };
    for (const o of outcomes)
      row[o] = matters.filter((m) => m.session === s.date && m.outcome === o).length;
    return row;
  });
  const decidedA = data.matters.filter(
    (m) => m.section === "A" && (m.outcome === "granted" || m.outcome === "denied"),
  );
  const grantedA = decidedA.filter((m) => m.outcome === "granted").length;
  const coverage = data.coverage.filter((c) => c.year >= 2010 && c.year <= 2025);
  const unreadable = sessions.filter((s) => !s.machineReadable).map((s) => s.date);
  const byMdlSession = useMemo(() => {
    const map = new Map<string, Matter[]>();
    for (const m of matters) map.set(m.session, [...(map.get(m.session) ?? []), m]);
    return map;
  }, [matters]);

  return (
    <section aria-labelledby="hearing-h" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="hearing-h" className="text-sm font-semibold">
            Hearing sessions and outcomes
          </h2>
          <p className="text-xs text-muted-foreground">
            Every docket on the Panel&rsquo;s published Schedule of Matters,{" "}
            {sessions[0]?.date ?? "—"} to {sessions.at(-1)?.date ?? "—"}. Outcomes come only from a
            published order or JPML report; otherwise “Not found”.
          </p>
        </div>
        <div
          role="group"
          aria-label="Schedule section"
          className="flex rounded-md border border-border bg-surface p-0.5"
        >
          {(["A", "B"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={section === s}
              onClick={() => setSection(s)}
              className={cn(
                "rounded px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-ring",
                section === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {s === "A" ? "Section A · centralization motions" : "Section B · CTO oppositions"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title={
            section === "A"
              ? "Centralization motions by session outcome"
              : "CTO and other matters by session outcome"
          }
          subtitle={
            section === "A"
              ? `${n(grantedA)} of ${n(decidedA.length)} decided Section A motions centralized (${decidedA.length ? ((100 * grantedA) / decidedA.length).toFixed(0) : "—"}%)`
              : "Most Section B rulings are not published as written opinions on GovInfo, so many read “Not found”"
          }
          footnote={
            <>
              Sources:{" "}
              <a
                className="underline underline-offset-2"
                href="https://www.jpml.uscourts.gov/hearing-session-orders-archive"
                target="_blank"
                rel="noreferrer"
              >
                JPML hearing-session notices
              </a>
              , JPML Panel Orders, GovInfo USCOURTS (JPML) and the JPML pending-MDL report of
              10/1/2026.{" "}
              {unreadable.length
                ? `No bar for ${unreadable.join(", ")}: the published schedule PDF uses a font encoding that does not extract as text.`
                : null}
            </>
          }
        >
          {chart.length ? (
            <div className="h-64 px-2 py-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="session"
                    tick={axis}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={44}
                  />
                  <YAxis tick={axis} width={28} allowDecimals={false} tickFormatter={countTick} />
                  <Tooltip
                    labelFormatter={(_, p) => `Session of ${String(p?.[0]?.payload?.date ?? "")}`}
                    formatter={countTooltip}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {outcomes.map((o) => (
                    <Bar
                      key={o}
                      dataKey={o}
                      name={OUTCOME_LABEL[o] ?? o}
                      stackId="o"
                      fill={OUTCOME_COLOR[o]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <ChartUnavailable reason="No hearing-session schedules were parsed." />
          )}
        </ChartCard>
        <div className="grid gap-3">
          <ChartCard
            title="Where centralized dockets were sent"
            subtitle="Transferee district named in the order, Section A matters centralized"
          >
            {data.grantedDistricts.length ? (
              <div className="h-48 px-2 py-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.grantedDistricts.slice(0, 10)}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
                  >
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={axis}
                      allowDecimals={false}
                      tickFormatter={countTick}
                    />
                    <YAxis
                      type="category"
                      dataKey="district"
                      tick={axis}
                      width={150}
                      interval={0}
                    />
                    <Tooltip formatter={countTooltip} />
                    <Bar
                      dataKey="count"
                      name="Dockets"
                      fill={FDA_COLORS[1]}
                      radius={[0, 3, 3, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartUnavailable reason="No transferee district was named in the resolved orders." />
            )}
          </ChartCard>
          <ChartCard
            title="Published-order coverage check"
            subtitle="JPML motions granted vs initial transfer orders found on GovInfo, per year"
            footnote={`GovInfo's sitemaps omit many JPML dockets, so ${n(data.govinfoProbed)} packages were recovered by probing GovInfo package ids directly. A remaining gap means the order was not located on GovInfo by these methods; it is not evidence that no order exists.`}
          >
            {coverage.length ? (
              <div className="h-40 px-2 py-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={coverage} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="year" tick={axis} minTickGap={8} />
                    <YAxis tick={axis} width={28} allowDecimals={false} tickFormatter={countTick} />
                    <Tooltip formatter={countTooltip} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="jpmlGranted"
                      name="JPML granted"
                      fill={FDA_COLORS[0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="govinfoTransfers"
                      name="GovInfo transfer orders"
                      fill={FDA_COLORS[3]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <ChartUnavailable />
            )}
          </ChartCard>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {/* relative: the sr-only caption is absolutely positioned and must not escape the scroll box. */}
        <div className="relative max-w-full overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs">
            <caption className="sr-only">Hearing sessions</caption>
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Session
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Location
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Matters (§{section})
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Outcomes
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Notice
                </th>
              </tr>
            </thead>
            <tbody>
              {[...sessions].reverse().map((s) => {
                const list = byMdlSession.get(s.date) ?? [];
                const isOpen = open === s.date;
                return (
                  <SessionRows
                    key={s.date}
                    session={s}
                    list={list}
                    open={isOpen}
                    onToggle={() => setOpen(isOpen ? null : s.date)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SessionRows({
  session,
  list,
  open,
  onToggle,
}: {
  session: MdlIntel["sessions"][number];
  list: Matter[];
  open: boolean;
  onToggle: () => void;
}) {
  const counts = OUTCOME_ORDER.map(
    (o) => [o, list.filter((m) => m.outcome === o).length] as const,
  ).filter(([, c]) => c);
  return (
    <>
      <tr className="border-t border-border/60">
        <th scope="row" className="px-2 py-1 text-left font-medium tabular-nums">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            disabled={!list.length}
            className="rounded underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:no-underline"
          >
            {session.date}
          </button>
        </th>
        <td
          className="max-w-[300px] px-2 py-1 text-muted-foreground"
          title={
            session.locationLines.length ? session.locationLines.join(" · ") : sessionPlace(session)
          }
        >
          <span className="line-clamp-2">{sessionPlace(session)}</span>
        </td>
        <td className="px-2 py-1 tabular-nums">
          {session.machineReadable ? list.length : "Schedule not machine-readable"}
        </td>
        <td className="px-2 py-1">
          <span className="flex flex-wrap gap-1">
            {counts.map(([o, c]) => (
              <span
                key={o}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px"
              >
                <span
                  className="size-2 rounded-sm"
                  style={{ background: OUTCOME_COLOR[o] }}
                  aria-hidden="true"
                />
                {OUTCOME_LABEL[o]} {c}
              </span>
            ))}
          </span>
        </td>
        <td className="px-2 py-1">
          <a
            href={session.noticeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
          >
            PDF <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </td>
      </tr>
      {open
        ? list.map((m, i) => (
            <tr key={`${m.mdl}-${i}`} className="bg-muted/30 text-[11.5px]">
              <td className="px-2 py-1 pl-5 tabular-nums">
                <Link
                  to="/matters/lens/$mdl"
                  params={{ mdl: String(m.mdl) }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  MDL {m.mdl}
                </Link>
              </td>
              <td className="px-2 py-1" colSpan={2}>
                {title(m.title)}
                {m.requestedDistrict ? (
                  <span className="text-muted-foreground"> · asked for {m.requestedDistrict}</span>
                ) : null}
              </td>
              <td className="px-2 py-1">
                {OUTCOME_LABEL[m.outcome] ?? m.outcomeLabel}
                {m.district ? <span className="text-muted-foreground"> → {m.district}</span> : null}
              </td>
              <td className="px-2 py-1">
                {m.evidenceUrl ? (
                  <a
                    href={m.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {SOURCE_LABEL[m.evidenceSource ?? ""] ?? "Source"}
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))
        : null}
    </>
  );
}
