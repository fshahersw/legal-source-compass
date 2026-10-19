import { useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExternalLink, MapPin } from "lucide-react";
import { UsMap } from "@/components/corpus/UsMap";
import { numTick } from "@/components/enforcement/listDisplay";
import {
  axisTick,
  MoreToggle,
  Panel,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import { useCorpus } from "@/lib/corpus/store";
import type {
  AdminRow,
  AgencyBudget,
  AgencyProfile,
  AgencySpending,
  AgendaSummary,
  FrDoc,
  OpenComments,
} from "@/lib/external/agencyProfile.functions";
import { cn } from "@/lib/utils";
import { SERIES_COLORS } from "./ActivityChart";
import {
  budgetRows,
  fmt,
  monthName,
  nextActionLabel,
  perResidentByFips,
  spendingConcentration,
  TYPE_LABEL,
  usd,
  USPS_BY_FIPS,
  type MonthRow,
} from "./agencyView";

export const FR_API_DOCS = "https://www.federalregister.gov/developers/documentation/api/v1";
export const NOT_RECORDED = "Not recorded";

function daysUntil(asOf: string, date: string | null) {
  if (!date) return null;
  const d = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

/** External link whose icon flows with wrapped text instead of shrinking beside it. */
export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {children}
      <ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />
    </a>
  );
}

/** Federal Register documents as a compact list: date, title link, citation, CFR parts, effective date. */
export function DocList({ docs, empty }: { docs: FrDoc[]; empty: string }) {
  if (!docs.length) return <p className="px-3 py-3 text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border/60">
      {docs.map((d) => (
        <li
          key={d.url}
          className="grid gap-x-3 px-3 py-1.5 text-xs sm:grid-cols-[5.5rem_minmax(0,1fr)]"
        >
          <span className="font-mono text-[11px] text-muted-foreground">
            {d.date ?? NOT_RECORDED}
          </span>
          <span className="min-w-0">
            <ExtLink href={d.url}>
              <span className="font-medium">{d.title}</span>
            </ExtLink>
            <span className="block text-[11px] text-muted-foreground">
              {[
                d.citation,
                d.cfr.slice(0, 3).join(", ") || null,
                d.rins.length ? `RIN ${d.rins.join(", ")}` : null,
                d.effectiveOn ? `effective ${d.effectiveOn}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AdminTable({
  rows,
  showExecutiveOrders = false,
}: {
  rows: AdminRow[];
  showExecutiveOrders?: boolean;
}) {
  if (!rows.length)
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        Administration totals are {NOT_RECORDED.toLowerCase()}.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Federal Register documents by administration</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr className="border-b border-border/70">
            <th scope="col" className="px-2 py-1.5 font-medium">
              Administration
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Final rules
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              a year
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Proposed
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Significant final
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              a year
            </th>
            {showExecutiveOrders ? (
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Executive orders
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.key} className={cn(r.current && "bg-muted/30")}>
              <th scope="row" className="px-2 py-1 text-left font-normal">
                <span className="font-medium">{r.label}</span>
                <span className="block font-mono text-[10.5px] text-muted-foreground">
                  {r.start} to {r.end}
                  {r.current ? " (to date)" : ""}
                </span>
              </th>
              <td className="px-2 py-1 text-right font-mono">{fmt(r.RULE)}</td>
              <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                {r.rulesPerYear != null ? r.rulesPerYear.toLocaleString("en-US") : NOT_RECORDED}
              </td>
              <td className="px-2 py-1 text-right font-mono">{fmt(r.PRORULE)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(r.significantRules)}</td>
              <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                {r.significantRulesPerYear != null
                  ? r.significantRulesPerYear.toLocaleString("en-US")
                  : NOT_RECORDED}
              </td>
              {showExecutiveOrders ? (
                <td className="px-2 py-1 text-right font-mono">{fmt(r.executiveOrders)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyChart({ rows }: { rows: MonthRow[] }) {
  if (!rows.length)
    return <p className="px-3 py-3 text-xs text-muted-foreground">No monthly counts recorded.</p>;
  if (rows.every((r) => r.RULE + r.PRORULE === 0))
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        No final or proposed rules published in these {rows.length} months.
      </p>
    );
  return (
    <div className="h-52 px-1 pb-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={axisTick}
            interval={5}
            tickFormatter={(m: string) => `${monthName(m)} ${m.slice(2, 4)}`}
          />
          <YAxis tick={axisTick} allowDecimals={false} tickFormatter={numTick} width={40} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(m: string) =>
              `${monthName(m)} ${m.slice(0, 4)}${rows.find((r) => r.month === m)?.partial ? " (partial)" : ""}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {(["RULE", "PRORULE"] as const).map((t) => (
            <Bar
              key={t}
              dataKey={t}
              name={TYPE_LABEL[t]}
              stackId="m"
              fill={SERIES_COLORS[t]}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.month} fillOpacity={r.partial ? 0.4 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CommentsTable({
  comments,
  limit = 10,
}: {
  comments: OpenComments;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!comments.count)
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        No document lists a comment period open on {comments.asOf}.
      </p>
    );
  const shown = expanded ? comments.items : comments.items.slice(0, limit);
  return (
    <div className="px-1 pb-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs" id={id}>
          <caption className="sr-only">Documents with open comment periods</caption>
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr className="border-b border-border/70">
              <th scope="col" className="px-2 py-1.5 font-medium">
                Closes
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Document
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Type
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Docket
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map((d) => {
              const left = daysUntil(comments.asOf, d.commentsCloseOn);
              return (
                <tr key={d.url} className="align-top">
                  <td className="whitespace-nowrap px-2 py-1 font-mono">
                    {d.commentsCloseOn ?? NOT_RECORDED}
                    {left != null ? (
                      <span
                        className={cn(
                          "block text-[10.5px]",
                          left <= 14 ? "text-warning-foreground" : "text-muted-foreground",
                        )}
                      >
                        {left === 0 ? "closes today" : left === 1 ? "1 day" : `${left} days`}
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-md px-2 py-1">
                    <ExtLink href={d.url}>{d.title}</ExtLink>
                    {d.significant ? (
                      <span className="ml-1 rounded border border-border px-1 text-[10px] text-muted-foreground">
                        significant
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{d.type ?? NOT_RECORDED}</td>
                  <td className="px-2 py-1 font-mono text-[11px]">
                    {d.dockets[0] ?? NOT_RECORDED}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <MoreToggle
          total={comments.items.length}
          limit={limit}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          controls={id}
          noun="documents"
        />
        {comments.count > comments.items.length ? (
          <span className="text-[11px] text-muted-foreground">
            Showing the {comments.items.length} closing soonest of {fmt(comments.count)}.
          </span>
        ) : null}
      </div>
    </div>
  );
}

const STAGES: { key: string; label: string; tone: string }[] = [
  { key: "Prerule Stage", label: "Prerule", tone: "bg-muted-foreground/40" },
  { key: "Proposed Rule Stage", label: "Proposed rule", tone: "bg-primary/45" },
  { key: "Final Rule Stage", label: "Final rule", tone: "bg-primary" },
  { key: "Long-Term Actions", label: "Long-term", tone: "bg-border-strong" },
  { key: "Completed Actions", label: "Completed", tone: "bg-muted-foreground/20" },
];

/** One stacked bar of agenda actions by stage, every segment named and counted in the legend. */
export function StageBar({ byStage, total }: { byStage: Record<string, number>; total: number }) {
  const segs = STAGES.map((s) => ({ ...s, value: byStage[s.key] ?? 0 })).filter((s) => s.value > 0);
  const sum = segs.reduce((a, s) => a + s.value, 0);
  if (!sum) return null;
  const summary = segs.map((s) => `${s.label} ${fmt(s.value)}`).join("; ");
  return (
    <div className="min-w-0">
      <div
        role="img"
        aria-label={`Agenda actions by stage: ${summary}`}
        className="flex h-2 overflow-hidden rounded-full bg-muted"
      >
        {segs.map((s) => (
          <span
            key={s.key}
            className={cn("h-full", s.tone)}
            style={{ width: `${(100 * s.value) / sum}%` }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-sm", s.tone)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-mono font-medium tabular-nums">{fmt(s.value)}</span>
          </li>
        ))}
        {total > sum ? (
          <li className="text-muted-foreground">{fmt(total - sum)} with another stage</li>
        ) : null}
      </ul>
    </div>
  );
}

export function AgendaPanelBody({
  agenda,
  agencyId,
}: {
  agenda: AgendaSummary;
  agencyId: number | null;
}) {
  return (
    <div className="space-y-2 px-3 py-2">
      <StageBar byStage={agenda.byStage} total={agenda.total} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {[
          ["Economically significant", agenda.byPriority["Economically Significant"] ?? 0],
          ["Other significant", agenda.byPriority["Other Significant"] ?? 0],
          ["Major (CRA)", agenda.major],
          ["With a legal deadline", agenda.withLegalDeadline],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="font-mono">{fmt(value as number)}</dd>
          </div>
        ))}
      </dl>
      {agenda.items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Unified Agenda actions, most significant first</caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr className="border-b border-border/70">
                <th scope="col" className="px-2 py-1.5 font-medium">
                  RIN
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Action
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Stage
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Priority
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Next scheduled
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {agenda.items.map((e) => (
                <tr key={e.rin} className="align-top">
                  <td className="whitespace-nowrap px-2 py-1 font-mono">
                    <ExtLink href={e.url}>{e.rin}</ExtLink>
                  </td>
                  <td className="max-w-sm px-2 py-1">
                    {e.title}
                    {e.agency ? (
                      <span className="block text-[10.5px] text-muted-foreground">{e.agency}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{e.stage.replace(" Stage", "")}</td>
                  <td className="px-2 py-1">{e.priority}</td>
                  <td className="min-w-[8rem] px-2 py-1 font-mono text-[11px]">
                    {nextActionLabel(e.nextAction)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {agencyId != null && agenda.total > agenda.items.length ? (
        <Link
          to="/data/$dataset"
          params={{ dataset: "unified_agenda_pipeline" }}
          search={{ f: { agency: String(agencyId) } }}
          className="inline-block text-[11px] text-primary hover:underline"
        >
          All {fmt(agenda.total)} agenda actions →
        </Link>
      ) : null}
    </div>
  );
}

export function BudgetPanelBody({ budget }: { budget: AgencyBudget }) {
  const rows = budgetRows(budget).map((r) => ({
    ...r,
    resourcesM: r.resources != null ? r.resources / 1e6 : null,
    obligatedM: r.obligated != null ? r.obligated / 1e6 : null,
    outlayedM: r.outlayed != null ? r.outlayed / 1e6 : null,
  }));
  const partial = rows.filter((r) => r.partial);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const subs = expanded ? budget.subAgencies : budget.subAgencies.slice(0, 8);
  return (
    <div className="grid gap-3 p-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="fy" tick={axisTick} />
              <YAxis tick={axisTick} width={56} tickFormatter={(v: number) => usd(v * 1e6)} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, name: string) => [usd(v * 1e6), name]}
                labelFormatter={(fy: string) => {
                  const r = rows.find((x) => x.fy === fy);
                  return r?.partial ? `${fy} (through period ${r.period ?? "?"} of 12)` : fy;
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="resourcesM"
                name="Budgetary resources"
                fill={SERIES_COLORS.ALL}
                isAnimationActive={false}
              >
                {rows.map((r) => (
                  <Cell key={r.fy} fillOpacity={r.partial ? 0.4 : 1} />
                ))}
              </Bar>
              <Bar
                dataKey="obligatedM"
                name="Obligations"
                fill={SERIES_COLORS.RULE}
                isAnimationActive={false}
              >
                {rows.map((r) => (
                  <Cell key={r.fy} fillOpacity={r.partial ? 0.4 : 1} />
                ))}
              </Bar>
              <Bar
                dataKey="outlayedM"
                name="Outlays"
                fill={SERIES_COLORS.NOTICE}
                isAnimationActive={false}
              >
                {rows.map((r) => (
                  <Cell key={r.fy} fillOpacity={r.partial ? 0.4 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {partial.length ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {partial.map((r) => `${r.fy} through period ${r.period ?? "?"} of 12`).join("; ")}{" "}
            (lighter bars).
          </p>
        ) : null}
      </div>
      <div className="min-w-0">
        <h4 className="px-1 text-[11px] font-medium text-muted-foreground">
          FY2025 obligations by sub-agency ({fmt(budget.subAgencyCount)})
        </h4>
        {budget.subAgencies.length ? (
          <>
            <ul id={id} className="divide-y divide-border/60 text-xs">
              {subs.map((s) => (
                <li key={s.name} className="flex items-baseline justify-between gap-2 px-1 py-1">
                  <span className="min-w-0 truncate" title={s.name}>
                    {s.frAgencyId != null ? (
                      <Link
                        to="/agencies/$id"
                        params={{ id: String(s.frAgencyId) }}
                        className="text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                    ) : (
                      s.name
                    )}
                  </span>
                  <span className="shrink-0 font-mono">{usd(s.obligations)}</span>
                </li>
              ))}
            </ul>
            <MoreToggle
              total={budget.subAgencies.length}
              limit={8}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              controls={id}
              noun="sub-agencies"
            />
          </>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">No sub-agency obligations recorded.</p>
        )}
      </div>
    </div>
  );
}

export function SpendingPanelBody({ spending }: { spending: AgencySpending }) {
  const corpus = useCorpus();
  const navigate = useNavigate();
  const values = useMemo(() => perResidentByFips(spending), [spending]);
  const ranked = useMemo(
    () =>
      [...spending.states]
        .filter((s) => s.perResident != null)
        .sort((a, b) => (b.perResident ?? 0) - (a.perResident ?? 0)),
    [spending],
  );
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const shown = expanded ? ranked : ranked.slice(0, 10);
  const concentration = useMemo(() => spendingConcentration(spending), [spending]);
  return (
    <div className="grid gap-3 p-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {concentration && concentration.ratio >= 5 ? (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11.5px] leading-4 lg:col-span-2"
        >
          Concentrated: {concentration.top.name} records {usd(concentration.top.perResident)} per
          resident, {concentration.ratio.toLocaleString("en-US", { maximumFractionDigits: 0 })}× the
          state median ({usd(concentration.median)}). Place of performance is where the awarded work
          is done, which for claims-processing and similar contracts is the contractor's site, so
          this ranking does not show where residents benefit.
        </p>
      ) : null}
      {corpus.geo ? (
        <UsMap
          geo={corpus.geo}
          values={values}
          valueLabel={`FY${spending.fiscalYear} award obligations per resident`}
          heading="Obligations per resident by state"
          hint="Hover a state for its amount per resident; the table ranks them."
          stateAction="Open"
          formatValue={(v) => usd(v)}
          legendNote="Shading scales with obligations per resident (place of performance)."
          onState={(fips) => {
            const code = USPS_BY_FIPS.get(fips);
            if (code) void navigate({ to: "/places/$state", params: { state: code } });
          }}
        />
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-6 opacity-50" aria-hidden />
          {corpus.error ? "The map is unavailable; use the table." : "Preparing the map…"}
        </div>
      )}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full text-xs" id={id}>
          <caption className="sr-only">States ranked by obligations per resident</caption>
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr className="border-b border-border/70">
              <th scope="col" className="px-2 py-1.5 font-medium">
                #
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                State
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Per resident
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                FY{spending.fiscalYear}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                vs FY{spending.fiscalYear - 1}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map((s) => (
              <tr key={s.code}>
                <td className="px-2 py-1 font-mono text-muted-foreground">
                  {s.perResidentRank ?? ""}
                </td>
                <td className="px-2 py-1">
                  <Link
                    to="/places/$state"
                    params={{ state: s.code }}
                    className="text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                </td>
                <td className="px-2 py-1 text-right font-mono">{usd(s.perResident)}</td>
                <td className="px-2 py-1 text-right font-mono">{usd(s.fy2025)}</td>
                <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                  {s.changePct == null
                    ? NOT_RECORDED
                    : `${s.changePct > 0 ? "+" : s.changePct < 0 ? "−" : ""}${Math.abs(s.changePct).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <MoreToggle
          total={ranked.length}
          limit={10}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          controls={id}
          noun="states"
        />
      </div>
    </div>
  );
}

export function CfrPanelBody({ profile }: { profile: AgencyProfile }) {
  const parts = profile.cfrParts;
  const refs = profile.ecfr?.refs ?? [];
  const max = Math.max(1, ...(parts?.top ?? []).map((p) => p.docs));
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const shown = expanded ? (parts?.top ?? []) : (parts?.top ?? []).slice(0, 10);
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0">
        <h4 className="text-[11px] font-medium text-muted-foreground">
          CFR chapters assigned to this agency (eCFR)
        </h4>
        {refs.length ? (
          <ul className="mt-1 space-y-1 text-xs">
            {refs.map((r) => (
              <li key={r.url}>
                <ExtLink href={r.url}>
                  {r.title} CFR{r.chapter ? ` chapter ${r.chapter}` : ""}
                </ExtLink>
                {r.titleName ? (
                  <span className="text-muted-foreground"> · {r.titleName}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            The eCFR agency list assigns no CFR chapter to this agency name.
          </p>
        )}
        {parts?.titles.length ? (
          <>
            <h4 className="mt-3 text-[11px] font-medium text-muted-foreground">
              CFR titles cited ({fmt(parts.distinctTitles)})
            </h4>
            <ul className="mt-1 space-y-0.5 text-xs">
              {parts.titles.slice(0, 6).map((t) => (
                <li key={t.title} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    Title {t.title}
                    {t.titleName ? ` · ${t.titleName}` : ""}
                  </span>
                  <span className="shrink-0 font-mono">{fmt(t.partCitations)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <div className="min-w-0">
        <h4 className="text-[11px] font-medium text-muted-foreground">
          CFR parts most cited by its rules and proposed rules
          {parts ? ` (${fmt(parts.distinctParts)} parts)` : ""}
        </h4>
        {parts?.top.length ? (
          <>
            <ul id={id} className="mt-1 space-y-1">
              {shown.map((p) => (
                <li
                  key={`${p.title}:${p.part}`}
                  className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
                >
                  <ExtLink href={p.url}>
                    {p.title} CFR {p.part}
                  </ExtLink>
                  <span className="h-2 rounded-sm bg-muted" title={`${p.first}–${p.last}`}>
                    <span
                      className="block h-2 rounded-sm bg-primary"
                      style={{ width: `${(p.docs / max) * 100}%` }}
                    />
                  </span>
                  <Link
                    to="/data/$dataset"
                    params={{ dataset: "federal_register_history" }}
                    search={{ f: { agency: String(profile.id), cfr_pair: `${p.title}:${p.part}` } }}
                    className="text-right font-mono text-primary hover:underline"
                    title={`Open the ${fmt(p.docs)} documents (${p.first}–${p.last})`}
                  >
                    {fmt(p.docs)}
                  </Link>
                </li>
              ))}
            </ul>
            <MoreToggle
              total={parts.top.length}
              limit={10}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              controls={id}
              noun="parts"
            />
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            No rule or proposed rule in the saved Federal Register index cites a CFR part for this
            agency.
          </p>
        )}
      </div>
    </div>
  );
}

export function StructurePanelBody({ profile }: { profile: AgencyProfile }) {
  const gm = profile.govman;
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-2 text-xs">
        {profile.parent ? (
          <p>
            <span className="text-muted-foreground">Part of </span>
            <Link
              to="/agencies/$id"
              params={{ id: String(profile.parent.id) }}
              className="text-primary hover:underline"
            >
              {profile.parent.name}
            </Link>
          </p>
        ) : null}
        <div>
          <h4 className="text-[11px] font-medium text-muted-foreground">
            Components listed by the Federal Register ({fmt(profile.children.length)})
          </h4>
          {profile.children.length ? (
            <ul className="mt-1 columns-1 gap-4 sm:columns-2">
              {profile.children.map((c) => (
                <li key={c.id} className="break-inside-avoid py-0.5">
                  <Link
                    to="/agencies/$id"
                    params={{ id: String(c.id) }}
                    className="text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">None listed.</p>
          )}
        </div>
        {gm?.mission ? (
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground">
              Mission (Government Manual)
            </h4>
            <p className="mt-1 leading-relaxed">{gm.mission}</p>
          </div>
        ) : profile.usaspending?.mission ? (
          <div>
            <h4 className="text-[11px] font-medium text-muted-foreground">
              Mission (USAspending agency profile)
            </h4>
            <p className="mt-1 leading-relaxed">{profile.usaspending.mission}</p>
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        {gm ? (
          <div className="space-y-2 text-xs">
            <h4 className="text-[11px] font-medium text-muted-foreground">
              U.S. Government Manual ({gm.edition} edition){gm.category ? ` · ${gm.category}` : ""}
            </h4>
            {gm.components.length ? (
              <div>
                <h5 className="text-[11px] text-muted-foreground">Units the Manual describes</h5>
                <p className="mt-0.5 leading-relaxed">{gm.components.join(" · ")}</p>
              </div>
            ) : null}
            {gm.legalAuthority ? (
              <div>
                <h5 className="text-[11px] text-muted-foreground">Legal authority</h5>
                <p className="mt-0.5 leading-relaxed">{gm.legalAuthority}</p>
              </div>
            ) : null}
            <p className="text-[11px] leading-4 text-muted-foreground">
              Current officials: see the agency's own leadership pages
              {profile.agencyUrl ? (
                <>
                  {" "}
                  (<ExtLink href={profile.agencyUrl}>official website</ExtLink>)
                </>
              ) : null}
              . The Manual's officer lists are not shown because the 2025 edition still prints
              officials who left office before it was dated.{" "}
              <ExtLink href={gm.pageUrl}>Manual on GovInfo</ExtLink>
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            The 2025 Government Manual has no entry with this agency's name.
            {profile.agencyUrl ? (
              <>
                {" "}
                Leadership: <ExtLink href={profile.agencyUrl}>official website</ExtLink>.
              </>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}

export function EnforcementPanelBody({ profile }: { profile: AgencyProfile }) {
  const enf = profile.enforcement;
  if (!enf || !enf.datasets.length)
    return (
      <StateNote>
        No enforcement or program dataset built from this agency's own data is in the corpus yet.
      </StateNote>
    );
  return (
    <div className="space-y-2 p-3">
      {enf.page ? (
        <Link
          to={enf.page.to}
          search={enf.page.search as never}
          className="inline-block text-xs font-medium text-primary hover:underline"
        >
          Open the {profile.shortName ?? profile.name} analysis page →
        </Link>
      ) : null}
      <ul className="grid gap-1 sm:grid-cols-2">
        {enf.datasets.map((d) => (
          <li
            key={d.id}
            className="flex items-baseline justify-between gap-2 rounded border border-border px-2 py-1 text-xs"
          >
            <Link
              to="/data/$dataset"
              params={{ dataset: d.id }}
              className="min-w-0 truncate text-primary hover:underline"
              title={d.label}
            >
              {d.label}
            </Link>
            <span className="shrink-0 font-mono text-muted-foreground">{fmt(d.records)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Record counts are the corpus's stored rows for each collection.
      </p>
    </div>
  );
}

export { Panel };
