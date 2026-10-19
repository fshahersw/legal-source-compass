import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, ChevronRight, MessageCircle } from "lucide-react";
import { askAssistant, interpretQuestion } from "@/components/assistant/askAssistant";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  axisTick,
  Kpi,
  LoadingBlock,
  MoreToggle,
  Panel,
  Segmented,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getRecallDomain,
  type Anomaly,
  type RecallDomain,
  type RecallDomainData,
  type RecallItem,
  type RecallOverview,
} from "@/lib/external/recallPatterns.functions";
import { RecallDetailSheet } from "./RecallDetailSheet";
import { dayLabel, monthLabel, n, RECALL_DOMAIN_OPTIONS, recallInsights } from "./recallInsights";
import { ComplaintTypes } from "./ComplaintTypes";

const yearSpan = (a: string | null, b: string | null) =>
  !a
    ? "Not recorded"
    : !b || a.slice(0, 4) === b.slice(0, 4)
      ? a.slice(0, 4)
      : `${a.slice(0, 4)}–${b.slice(0, 4)}`;
const pct = (v: number | null) => (v === null ? "Not recorded" : `${v.toFixed(1)}%`);

function kpis(o: RecallOverview) {
  const class1 = o.classMix.find((c) => c.label === "Class I")?.count ?? null;
  const classified = o.classMix.reduce((s, c) => s + c.count, 0);
  const latestClass = o.daysToClassification.at(-1);
  const list: { label: string; value: string; note?: string | undefined }[] = [
    {
      label: "Recalls",
      value: n(o.events),
      note: o.first && o.last ? `${o.first.slice(0, 4)}–${o.last.slice(0, 4)}` : undefined,
    },
    { label: o.domain === "cpsc" ? "Firms named" : "Recalling firms", value: n(o.firms) },
  ];
  if (o.domain.startsWith("fda")) {
    list.push(
      {
        label: "Products recalled",
        value: o.productRows === null ? "Not recorded" : n(o.productRows),
        note: "product rows in the reports",
      },
      {
        label: "Class I share",
        value: class1 !== null && classified ? pct((100 * class1) / classified) : "Not recorded",
        note: "most serious class",
      },
      {
        label: "Days to classification",
        value: latestClass ? n(latestClass.days) : "Not recorded",
        note: latestClass ? `median, recalls reported in ${latestClass.year}` : undefined,
      },
      {
        label: "Distributed nationwide",
        value: pct(o.nationwideShare),
        note: "as the distribution field states",
      },
    );
  } else if (o.domain === "cpsc") {
    const china = o.chinaShareByYear.at(-1);
    list.push(
      {
        label: "Mention a death",
        value: o.deathMentions === null ? "Not recorded" : n(o.deathMentions),
      },
      {
        label: "Made in China",
        value: china ? pct(china.share) : "Not recorded",
        note: china ? `share of ${china.year} recalls` : undefined,
      },
      {
        label: "Product types",
        value: n(o.productTypes.length),
        note: "most frequent shown below",
      },
      { label: "Hazard themes", value: n(o.themes.length) },
    );
  } else {
    const units = o.unitsByYear.reduce((s, y) => s + y.count, 0);
    list.push(
      {
        label: "Units potentially affected",
        value: units ? n(units) : "Not recorded",
        note: "sum of campaign counts",
      },
      { label: "Component groups", value: n(o.themes.length) },
      { label: "Unusual months", value: n(o.anomalies.length) },
      { label: "Latest report", value: o.last ? dayLabel(o.last) : "Not recorded" },
    );
  }
  return list;
}

function YearChart({ o }: { o: RecallOverview }) {
  const second = o.domain.startsWith("fda")
    ? new Map(o.class1ByYear.map((y) => [y.year, y.count]))
    : o.domain === "cpsc"
      ? new Map(o.chinaShareByYear.map((y) => [y.year, y.share]))
      : null;
  const secondLabel = o.domain.startsWith("fda") ? "Class I" : "Made in China (%)";
  const data = o.byYear.map((y) => ({
    year: y.year,
    count: y.count,
    second: second?.get(y.year) ?? null,
  }));
  return (
    <div className="h-56 px-2 py-2" aria-label="Recalls by year">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="year" tick={axisTick} interval="preserveStartEnd" />
          <YAxis yAxisId="a" tick={axisTick} allowDecimals={false} width={46} />
          {second && o.domain === "cpsc" ? (
            <YAxis yAxisId="b" orientation="right" tick={axisTick} width={34} domain={[0, 100]} />
          ) : null}
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, name) => [
              name === "count" ? n(Number(v)) : `${Number(v).toLocaleString("en-US")}`,
              name === "count" ? "Recalls" : secondLabel,
            ]}
          />
          <Bar yAxisId="a" dataKey="count" fill={FDA_COLORS[0]!} radius={[2, 2, 0, 0]} />
          {second ? (
            <Line
              yAxisId={o.domain === "cpsc" ? "b" : "a"}
              dataKey="second"
              stroke={FDA_COLORS[2]!}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ThemeRows({ items, onOpen }: { items: RecallItem[]; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...items.map((i) => i.events));
  const shown = all ? items : items.slice(0, 10);
  return (
    <div className="px-3 py-2">
      <ul id="recall-themes" className="m-0 list-none space-y-1 p-0">
        {shown.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded px-1 py-1 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium" title={t.title}>
                  {t.title}
                </span>
                <span className="mt-0.5 block h-1.5 rounded-full bg-muted">
                  <span
                    className="block h-1.5 rounded-full"
                    style={{ width: `${(100 * t.events) / max}%`, background: FDA_COLORS[1] }}
                  />
                </span>
              </span>
              <span className="flex items-center gap-2 text-[11px] tabular-nums">
                {t.growth && t.growth.changePct !== null ? (
                  <span
                    className={
                      t.growth.changePct >= 20
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    }
                    title={`${t.growth.recentYears} vs ${t.growth.priorYears}`}
                  >
                    {t.growth.changePct > 0 ? "+" : ""}
                    {Math.round(t.growth.changePct)}%
                  </span>
                ) : null}
                <span className="w-12 text-right font-mono">{n(t.events)}</span>
                <ChevronRight
                  className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100"
                  aria-hidden
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <MoreToggle
        total={items.length}
        limit={10}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls="recall-themes"
        noun="themes"
      />
    </div>
  );
}

function AnomalyList({ items }: { items: Anomaly[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => b.month.localeCompare(a.month));
  const shown = all ? sorted : sorted.slice(0, 6);
  if (!items.length)
    return (
      <p className="m-0 px-3 py-3 text-xs text-muted-foreground">No month met the spike rule.</p>
    );
  return (
    <div className="px-3 py-2">
      <ul id="recall-anomalies" className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {shown.map((a) => (
          <li
            key={`${a.month}-${a.measure}`}
            className="rounded-md border border-border/70 px-2.5 py-2 text-xs leading-snug"
          >
            <p className="m-0 flex items-baseline justify-between gap-2">
              <span className="font-semibold">{monthLabel(a.month)}</span>
              <span className="text-[11px] text-muted-foreground">{a.measureLabel}</span>
            </p>
            <p className="m-0 mt-0.5">
              <span className="font-mono">{n(a.count)}</span>
              <span className="text-muted-foreground">
                {" "}
                against a usual {n(a.trailingMedian)} (
                {(a.count / Math.max(1, a.trailingMedian)).toFixed(1)}×)
              </span>
            </p>
            {a.topFirms[0] ? (
              <p className="m-0 mt-0.5 text-muted-foreground">
                {a.pattern === "one firm" ? "Mostly one firm: " : `${n(a.firms)} firms; largest: `}
                <span className="text-foreground">{a.topFirms[0].firm}</span>
                {a.topFirmShare !== null ? ` (${Math.round(a.topFirmShare)}%)` : ""}
              </p>
            ) : null}
            {a.topThemes.length ? (
              <p className="m-0 mt-0.5 text-[11px] text-muted-foreground">
                {a.topThemes.map((t) => t.label).join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <MoreToggle
        total={sorted.length}
        limit={6}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls="recall-anomalies"
        noun="months"
      />
    </div>
  );
}

function FirmTable({ items, onOpen }: { items: RecallItem[]; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 12);
  return (
    <div className="overflow-x-auto">
      <table id="recall-firms" className="w-full min-w-[30rem] text-left text-xs">
        <thead className="text-[11px] text-muted-foreground">
          <tr className="border-b border-border/70">
            <th scope="col" className="px-3 py-1.5 font-medium">
              Firm
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Recalls
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Years
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Repeated theme
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f) => (
            <tr key={f.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
              <th scope="row" className="max-w-[16rem] px-3 py-1.5 font-normal">
                <button
                  type="button"
                  onClick={() => onOpen(f.id)}
                  className="truncate text-left text-primary underline-offset-2 hover:underline"
                  title={f.title}
                >
                  {f.title}
                </button>
                {f.label ? (
                  <span className="ml-1 text-[10px] text-muted-foreground">{f.label}</span>
                ) : null}
              </th>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{n(f.events)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                {f.first && f.last
                  ? `${f.first.slice(0, 4)}–${f.last.slice(0, 4)}`
                  : "Not recorded"}
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {f.repeatThemes[0]
                  ? `${f.repeatThemes[0].label} (${n(f.repeatThemes[0].events)})`
                  : "None repeated 3+ times"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 pb-2">
        <MoreToggle
          total={items.length}
          limit={12}
          expanded={all}
          onToggle={() => setAll((v) => !v)}
          controls="recall-firms"
          noun="firms"
        />
      </div>
    </div>
  );
}

function GroupCards({
  items,
  onOpen,
  kind,
}: {
  items: RecallItem[];
  onOpen: (id: string) => void;
  kind: "cluster" | "supplier";
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 9);
  return (
    <div className="px-3 py-2">
      <ul
        id={`recall-${kind}s`}
        className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3"
      >
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="h-full w-full rounded-md border border-border/70 px-2.5 py-2 text-left text-xs leading-snug hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{c.title}</span>
                <ArrowUpRight
                  className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </span>
              <span className="mt-0.5 block text-muted-foreground">
                {kind === "cluster"
                  ? `${n(c.firms ?? 0)} firms · ${n(c.events)} recalls · ${c.spanDays ?? 0} days from ${dayLabel(c.first)}`
                  : `${n(c.firms ?? 0)} recalling firms · ${n(c.events)} recalls · ${yearSpan(c.first, c.last)}`}
              </span>
              {kind === "cluster" ? (
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {c.suppliers[0]
                    ? `Supplier named: ${c.suppliers[0]}`
                    : "No supplier named in the reasons"}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <MoreToggle
        total={items.length}
        limit={9}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls={`recall-${kind}s`}
        noun={kind === "cluster" ? "clusters" : "suppliers"}
      />
    </div>
  );
}

function Breakdown({
  title,
  subtitle,
  footnote,
  rows,
  limit = 12,
}: {
  title: string;
  subtitle?: string;
  footnote?: string | undefined;
  rows: { label: string; count: number }[];
  limit?: number;
}) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel title={title} subtitle={subtitle} footnote={footnote}>
      <ul className="m-0 list-none space-y-1 px-3 py-2">
        {rows.slice(0, limit).map((r) => (
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
                  style={{ width: `${(100 * r.count) / max}%`, background: FDA_COLORS[3] }}
                />
              </span>
            </span>
            <span className="font-mono tabular-nums">{n(r.count)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function DomainView({ data, onOpen }: { data: RecallDomainData; onOpen: (id: string) => void }) {
  const o = data.overview!;
  const insights = recallInsights(data);
  const themeNoun =
    o.domain === "cpsc"
      ? "Hazard themes"
      : o.domain === "nhtsa"
        ? "Component groups"
        : "Problem themes";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpis(o).map((k) => (
          <Kpi key={k.label} label={k.label} value={k.value} note={k.note} />
        ))}
      </div>
      {insights.length ? (
        <Panel
          title="What stands out"
          subtitle="Statements computed from the recall records; open one for the records behind it"
          actions={
            <button
              type="button"
              onClick={() =>
                askAssistant(
                  interpretQuestion(
                    `${o.domainLabel}: what stands out`,
                    o.first && o.last ? `${o.first.slice(0, 4)}–${o.last.slice(0, 4)}` : undefined,
                    insights.map((i) => i.text),
                  ),
                  `Interpret: ${o.domainLabel}, what stands out`,
                )
              }
              className="inline-flex items-center gap-1 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              title="Ask the research assistant to interpret these findings"
            >
              <MessageCircle className="size-3" aria-hidden />
              Interpret
            </button>
          }
        >
          <ul className="m-0 list-none space-y-1.5 px-3 py-2.5">
            {insights.map((i) => (
              <li key={i.id} className="flex items-start gap-2 text-[13px] leading-snug">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ background: FDA_COLORS[2] }}
                  aria-hidden
                />
                {i.target ? (
                  <button
                    type="button"
                    onClick={() => onOpen(i.target!)}
                    className="text-left underline-offset-2 hover:underline"
                  >
                    {i.text}
                  </button>
                ) : (
                  <span>{i.text}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Recalls by year"
          subtitle={
            o.domain.startsWith("fda")
              ? `Recall events by report year; line: Class I${o.last ? `. ${o.last.slice(0, 4)} runs to ${dayLabel(o.last)}` : ""}`
              : o.domain === "cpsc"
                ? `Recalls by year; line: share naming China as country of manufacture${o.last ? `. ${o.last.slice(0, 4)} runs to ${dayLabel(o.last)}` : ""}`
                : `Campaigns by report year${o.last ? `. ${o.last.slice(0, 4)} runs to ${dayLabel(o.last)}` : ""}`
          }
        >
          <YearChart o={o} />
        </Panel>
        <Panel
          title={themeNoun}
          subtitle={`Recalls per theme; change compares ${o.lastFullYear ? `${o.lastFullYear - 2}–${o.lastFullYear}` : "the last three full years"} with the three years before`}
        >
          <ThemeRows items={data.themes} onOpen={onOpen} />
        </Panel>
      </div>
      <Panel
        title="Unusual months"
        subtitle="At least 1.8× the trailing 24-month median (recalls) or 3× (products, units), with a robust z-score test"
      >
        <AnomalyList items={o.anomalies} />
      </Panel>
      {data.clusters.length ? (
        <Panel
          title="Multi-firm clusters"
          subtitle="Three or more firms recalling the same commodity for the same pathogen or contaminant within 90 days"
          footnote="Co-occurrence only. A shared source is established only where a recall reason names the supplier."
        >
          <GroupCards items={data.clusters} onOpen={onOpen} kind="cluster" />
        </Panel>
      ) : null}
      {data.suppliers.length ? (
        <Panel
          title="Suppliers named in recall reasons"
          subtitle="Companies a recalling firm names as its supplier or as the firm whose recall prompted its own"
        >
          <GroupCards items={data.suppliers} onOpen={onOpen} kind="supplier" />
        </Panel>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Firms with repeated recalls"
          subtitle="Names merged only by case, punctuation and corporate suffix"
        >
          <FirmTable items={data.firms} onOpen={onOpen} />
        </Panel>
        {o.domain === "cpsc" ? (
          <Breakdown title="Most frequent product types" rows={o.productTypes} />
        ) : o.domain.startsWith("fda") ? (
          <Breakdown
            title="Days from recall start to FDA classification"
            subtitle="Median per report year"
            rows={[...o.daysToClassification]
              .reverse()
              .map((y) => ({ label: y.year, count: y.days }))}
            limit={15}
            footnote={
              o.medianDaysToTermination !== null
                ? `Recalls FDA has terminated took a median ${n(o.medianDaysToTermination)} days from start to termination (${n(o.terminatedEvents ?? 0)} recalls).`
                : undefined
            }
          />
        ) : (
          <Breakdown
            title="Units potentially affected by year"
            rows={[...o.unitsByYear].reverse().map((y) => ({ label: y.year, count: y.count }))}
          />
        )}
      </div>
    </div>
  );
}

/** Recall patterns across FDA, CPSC and NHTSA recalls, with complaint and report types below. */
export function RecallPatterns({
  domain,
  onDomain,
}: {
  domain: RecallDomain;
  onDomain: (d: RecallDomain) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["recall-patterns", domain],
    queryFn: () => getRecallDomain({ data: { domain } }),
    staleTime: 30 * 60 * 1000,
  });
  return (
    <div className="space-y-3" aria-label="Recall patterns">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Recall domain"
          value={domain}
          options={RECALL_DOMAIN_OPTIONS}
          onChange={onDomain}
        />
        <p className="m-0 text-[11px] text-muted-foreground">
          Themes are keyword rules over the agency&apos;s reason text, not agency categories.
        </p>
      </div>
      {q.isLoading ? (
        <LoadingBlock label="Loading recall patterns" />
      ) : q.isError ? (
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
          Recall patterns could not be loaded.
        </StateNote>
      ) : !q.data?.overview ? (
        <StateNote>No recall patterns are recorded for this domain.</StateNote>
      ) : (
        <DomainView data={q.data} onOpen={setOpen} />
      )}
      <ComplaintTypes />
      <RecallDetailSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
