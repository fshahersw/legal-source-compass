/**
 * Court hierarchy explorer: the Supreme Court → the courts of appeals → the district courts in each circuit → their
 * sitting judges, and the state court systems held (highest and intermediate appellate courts). Each node carries an
 * inline bar for the chosen metric from the insights layer (its latest complete period), compared with its siblings.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChartFrame, type ChartSource, type TableSpec } from "@/components/charts/ChartFrame";
import { TreeExplorer, type TreeChildren, type TreeItem } from "@/components/charts/TreeExplorer";
import { metricFormatter } from "@/components/charts/format";
import type { MetricFormat } from "@/lib/insights/contract";
import {
  childLevel,
  COURT_METRICS,
  judgeNote,
  metricFor,
  nodeKey,
  type CourtLevel,
  type CourtNode,
  type MetricInfo,
} from "@/lib/litviz/courtTree";
import { courtLevelQuery } from "./queries";

const FORMATS = new Set([
  "count",
  "rate_per_100k",
  "percent",
  "currency_usd",
  "months",
  "days",
  "ratio",
]);
const fmt = (info: MetricInfo | undefined) =>
  metricFormatter((info && FORMATS.has(info.format) ? info.format : "count") as MetricFormat);

const COURT_TYPE: Record<string, string> = {
  F: "federal appellate",
  FD: "district court",
  S: "highest court",
  TS: "highest court (territory)",
  SA: "intermediate appellate",
  TA: "intermediate appellate (territory)",
};

const sublabel = (n: CourtNode): string | null => {
  if (
    n.type === "judges" ||
    n.type === "states" ||
    n.type === "other_courts" ||
    n.type === "state" ||
    n.type === "circuit"
  )
    return n.children
      ? `${n.children.toLocaleString("en-US")} ${n.type === "judges" ? (n.id === "scotus" ? "justices" : "judges") : n.type === "states" ? "systems" : n.type === "circuit" ? "below" : "courts"}`
      : null;
  if (n.type === "court" && n.courtType) return COURT_TYPE[n.courtType] ?? null;
  return null;
};

function periodText(info: MetricInfo | undefined, period: string | null): string | null {
  if (!period) return null;
  if (info?.periodType === "twelve_months_ending") return `12 months ending ${period}`;
  if (info?.periodType === "snapshot") return `as of ${period}`;
  return period;
}

type Levels = Map<string, TreeChildren & { level?: CourtLevel }>;

export function CourtHierarchy() {
  const [metric, setMetric] = useState<string>("usc_civil_pending");
  const root = useQuery(courtLevelQuery("root", null));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [levels, setLevels] = useState<Levels>(new Map());
  const [nodes, setNodes] = useState<Map<string, CourtNode>>(new Map());

  const catalog: Record<string, MetricInfo> = useMemo(() => {
    const all: Record<string, MetricInfo> = { ...(root.data?.catalog ?? {}) };
    for (const l of levels.values()) Object.assign(all, l.level?.catalog ?? {});
    return all;
  }, [root.data, levels]);
  const info = catalog[metric];
  const formatter = fmt(info);

  const toItems = useCallback(
    (list: readonly CourtNode[]): TreeItem[] => {
      const values = metricFor(list, metric);
      return list.map((n) => {
        const v = values.get(nodeKey(n))!;
        const showsMetric = n.type === "court" || n.type === "circuit";
        return {
          id: nodeKey(n),
          label: n.label,
          sublabel: sublabel(n),
          hasChildren: childLevel(n) !== null,
          detail: judgeNote(n)
            ? `${judgeNote(n)} (JPML report of ${n.judge?.asOf ?? "the latest month"})`
            : null,
          metric: showsMetric
            ? {
                value: v.value,
                text: v.value === null ? "Not recorded" : formatter.full(v.value),
                note:
                  v.value === null
                    ? `No ${info?.label.toLowerCase() ?? "value"} is recorded for this court.`
                    : `${periodText(info, v.period)}${v.stale ? " (an earlier period than its siblings)" : ""}`,
                muted: v.stale,
              }
            : null,
        };
      });
    },
    [metric, formatter, info],
  );

  const remember = (list: readonly CourtNode[]) =>
    setNodes((prev) => {
      const next = new Map(prev);
      for (const n of list) next.set(nodeKey(n), n);
      return next;
    });

  const load = (item: TreeItem) => {
    const n = lookup.get(item.id);
    const lvl = n ? childLevel(n) : null;
    if (!lvl) return;
    setLevels((prev) => new Map(prev).set(item.id, { status: "loading" }));
    qc.fetchQuery(courtLevelQuery(lvl.type, lvl.id))
      .then((level) => {
        remember(level.nodes);
        setLevels((prev) => new Map(prev).set(item.id, { status: "ready", items: [], level }));
      })
      .catch(() =>
        setLevels((prev) =>
          new Map(prev).set(item.id, {
            status: "error",
            message: "This level could not be read just now.",
          }),
        ),
      );
  };

  const getChildren = useCallback(
    (id: string): TreeChildren => {
      const l = levels.get(id);
      if (!l) return { status: "idle" };
      if (l.status === "ready") return { status: "ready", items: toItems(l.level?.nodes ?? []) };
      return l;
    },
    [levels, toItems],
  );

  const rootItems = useMemo(() => toItems(root.data?.nodes ?? []), [root.data, toItems]);
  /** Every node seen so far (root level and every level opened), by tree id. */
  const lookup = useMemo(() => {
    const m = new Map(nodes);
    for (const n of root.data?.nodes ?? []) m.set(nodeKey(n), n);
    return m;
  }, [nodes, root.data]);

  const table: TableSpec | undefined = root.data
    ? {
        caption: `Courts and judges opened so far, with ${info?.label ?? "the chosen metric"}`,
        columns: [
          { label: "Court or judge" },
          { label: "Level", align: "left" },
          { label: info?.label ?? "Value", align: "right" },
          { label: "Period", align: "left" },
        ],
        rows: [root.data.nodes, ...[...levels.values()].map((l) => l.level?.nodes ?? [])]
          .flat()
          .map((n) => {
            const f = n.metrics[metric];
            return {
              key: nodeKey(n),
              cells: [
                n.label,
                n.type === "court"
                  ? (COURT_TYPE[n.courtType ?? ""] ?? "court")
                  : n.type.replace("_", " "),
                n.type === "court" || n.type === "circuit"
                  ? f
                    ? formatter.full(f.value)
                    : "Not recorded"
                  : "",
                f ? (periodText(info, f.period) ?? "") : "",
              ],
            };
          }),
      }
    : undefined;

  const sources: ChartSource[] = [
    ...(info?.sources ?? []),
    { label: "Courts and judges (insights entity spine)", url: "/insights" },
  ];

  return (
    <ChartFrame
      title="Court hierarchy"
      headingLevel="h2"
      unit={info?.unit}
      sources={sources}
      minHeight={260}
      status={
        root.isPending
          ? { kind: "loading" }
          : root.isError
            ? {
                kind: "error",
                message: "The court hierarchy could not be read just now.",
                onRetry: () => void root.refetch(),
              }
            : !root.data?.nodes.length
              ? { kind: "empty", reason: "No court structure is published yet." }
              : { kind: "ready" }
      }
      actions={
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          Bars show
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="h-8 max-w-[16rem] rounded-md border border-input bg-background px-2 text-[12px] text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {COURT_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.short}
              </option>
            ))}
          </select>
        </label>
      }
      partialNotice={
        root.data && "basis" in root.data && root.data.basis === "live"
          ? "Read live from the insights layer; levels open a little more slowly until the precomputed hierarchy is published."
          : undefined
      }
      notes={[
        "Open a court to see the courts or judges below it: the Supreme Court, the courts of appeals, the district courts of each circuit, then their sitting judges; state systems list their highest and intermediate appellate courts.",
        "A bar compares a court with its siblings only, on its latest complete period; a muted value is from an earlier period than its siblings'. A hatched stub means the value is not recorded for that court.",
        "A judge's pending MDLs are those whose JPML record names that judge with an exact match.",
      ]}
      table={table}
    >
      {root.data ? (
        <TreeExplorer
          roots={rootItems}
          getChildren={getChildren}
          onExpand={load}
          onRetry={load}
          nameLabel="Court or judge"
          metricLabel={info ? `${info.label}` : "Value"}
          ariaLabel="Court hierarchy: use the arrow keys to move, right to open a court, left to close it, Enter to open its page."
          renderLabel={(item) => {
            const n = lookup.get(item.id);
            return n?.href ? (
              <Link
                to={n.href as never}
                tabIndex={-1}
                className="text-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span>{item.label}</span>
            );
          }}
          onActivate={(item) => {
            const n = lookup.get(item.id);
            if (n?.href) void navigate({ to: n.href as never });
          }}
        />
      ) : null}
    </ChartFrame>
  );
}
