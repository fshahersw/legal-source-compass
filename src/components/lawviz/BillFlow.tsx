/**
 * From bill to law: a stage flow (Sankey form) of federal bills and joint resolutions, 108th–119th Congress, by
 * Congress and policy area. Every bill moves left to right through introduction, committee report, passage in a
 * chamber, passage in both and enactment, and stops at the last stage its recorded actions show. Stage order is fixed
 * (reached on top, not reached below) so the funnel reads the same for every filter; ribbon geometry is the chart kit's.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChartCanvas, textWidth, type TipSpec } from "@/components/charts/canvas";
import {
  ChartFrame,
  ChartLegend,
  type ChartStatus,
  type TableSpec,
} from "@/components/charts/ChartFrame";
import { seriesVar } from "@/components/charts/palette";
import { ribbonPath } from "@/components/charts/sankeyLayout";
import {
  FIRST_CONGRESS,
  LAST_CONGRESS,
  STAGE_LABEL,
  congressTable,
  congressYears,
  layoutFlow,
  matches,
  ordinal,
  stageFlow,
  type BillFilter,
  type BillFlowData,
  type StageFlow,
} from "@/lib/lawviz/billFlow";
import { getBillFlow } from "@/lib/lawviz/lawviz.functions";
import { builtNote, fmtInt } from "./format";

type BillFlowOk = Extract<BillFlowData, { status: "ok" }>;
const REACHED = seriesVar(0);
const NOT_REACHED = "var(--chart-muted-mark)";
const COLUMNS = ["Introduction", "Committee", "Floor", "Second chamber", "Enactment"];
const control =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring";

function StageFlowChart({ flow, height = 340 }: { flow: StageFlow; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const label = (id: keyof typeof STAGE_LABEL) => STAGE_LABEL[id];
  const value = new Map(flow.nodes.map((n) => [n.id, n.value] as const));
  const describe = (i: number) => {
    const l = flow.links[i]!;
    return `${label(l.source)} to ${label(l.target)}: ${fmtInt(l.value)} bills.`;
  };
  const top = 18;
  return (
    <ChartCanvas
      height={height + top}
      ariaLabel="Stage flow of bills from introduction to enactment."
      count={flow.links.length}
      active={active}
      onActive={setActive}
      describe={describe}
      orientation="vertical"
    >
      {(w) => {
        const right = Math.min(170, Math.max(110, w * 0.17));
        const inner = Math.max(200, w - right - 4);
        const lay = layoutFlow(flow, { width: inner, height, nodeWidth: 10, gap: 16 });
        const activeLink = active !== null ? flow.links[active] : undefined;
        const colW = inner / 4;
        const marks = (
          <g>
            {COLUMNS.map((c, i) => (
              <text
                key={c}
                x={i === 4 ? inner - 10 : (i * (inner - 10)) / 4}
                y={11}
                textAnchor={i === 4 ? "end" : "start"}
                fontSize={10}
                fill="var(--chart-axis)"
              >
                {c}
              </text>
            ))}
            <g transform={`translate(0,${top})`}>
              {lay.links.map((l, i) => {
                const reached = flow.nodes.find((n) => n.id === l.target)?.reached ?? false;
                const idx = flow.links.findIndex(
                  (x) => x.source === l.source && x.target === l.target,
                );
                const on =
                  activeLink && activeLink.source === l.source && activeLink.target === l.target;
                return (
                  <path
                    key={`${l.source}>${l.target}`}
                    d={ribbonPath(l)}
                    fill="none"
                    stroke={reached ? REACHED : NOT_REACHED}
                    strokeOpacity={activeLink ? (on ? 0.62 : 0.12) : reached ? 0.38 : 0.5}
                    strokeWidth={Math.max(1, l.width)}
                    onPointerEnter={() => setActive(idx)}
                    onPointerLeave={() => setActive(null)}
                  />
                );
              })}
              {lay.nodes.map((n) => {
                const h = Math.max(1, n.y1 - n.y0);
                const text = `${n.label} · ${fmtInt(n.value)}`;
                const room = n.column === 4 ? right - 8 : colW - 18;
                const shown =
                  textWidth(text, 10.5) <= room
                    ? text
                    : textWidth(n.label, 10.5) <= room
                      ? n.label
                      : null;
                return (
                  <g key={n.id}>
                    <rect
                      x={n.x0}
                      y={n.y0}
                      width={n.x1 - n.x0}
                      height={h}
                      rx={2}
                      fill={n.reached ? REACHED : "var(--chart-axis)"}
                    />
                    {shown ? (
                      <text
                        x={n.x1 + 5}
                        y={n.y0 + Math.min(h / 2, 9)}
                        dy="0.32em"
                        fontSize={10.5}
                        fill="var(--chart-ink)"
                        stroke="var(--chart-surface)"
                        strokeWidth={3}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {shown}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </g>
        );
        const tooltip: TipSpec | null = activeLink
          ? (() => {
              const laid = lay.links.find(
                (l) => l.source === activeLink.source && l.target === activeLink.target,
              );
              const from = value.get(activeLink.source) ?? 0;
              return {
                x: laid ? (laid.x0 + laid.x1) / 2 : inner / 2,
                y: top + (laid ? (laid.y0 + laid.y1) / 2 : height / 2),
                content: {
                  title: `${label(activeLink.source)} → ${label(activeLink.target)}`,
                  rows: [
                    { key: "n", label: "bills", value: fmtInt(activeLink.value) },
                    {
                      key: "p",
                      label: `of ${fmtInt(from)} at “${label(activeLink.source)}”`,
                      value: from
                        ? `${((activeLink.value / from) * 100).toFixed(1)}%`
                        : "Not recorded",
                    },
                  ],
                },
              };
            })()
          : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

export function BillFlow() {
  const fn = useServerFn(getBillFlow);
  const q = useQuery({
    queryKey: ["lawviz-bill-flow"],
    queryFn: () => fn(),
    staleTime: 30 * 60_000,
  });
  const [filter, setFilter] = useState<BillFilter>({ congress: "all", policy: "all" });
  const got: BillFlowData | undefined = q.data;
  const data: BillFlowOk | null = got && got.status === "ok" ? (got as BillFlowOk) : null;
  const rows = useMemo(
    () => (data ? data.rows.filter((r) => matches(r, filter)) : []),
    [data, filter],
  );
  const flow = useMemo(() => stageFlow(rows), [rows]);
  const resolutions = useMemo(
    () =>
      data ? data.resolutions.filter((r) => matches(r, filter)).reduce((a, r) => a + r.n, 0) : 0,
    [data, filter],
  );
  const congresses = Array.from(
    { length: LAST_CONGRESS - FIRST_CONGRESS + 1 },
    (_, i) => LAST_CONGRESS - i,
  );
  const tableRows = data ? congressTable(data.rows, data.publicLaws, filter.policy) : [];
  const status: ChartStatus = q.isLoading
    ? { kind: "loading" }
    : q.error
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !q.data || q.data.status === "unavailable"
        ? {
            kind: "empty",
            reason:
              "The bill-to-law flow is not available yet: its counts are computed in the database and have not been published. The bill search above is unaffected.",
          }
        : q.data.status === "empty" || !flow.total
          ? { kind: "empty", reason: "No bills or joint resolutions match these filters." }
          : { kind: "ready" };
  const scope =
    filter.congress === "all"
      ? `${ordinal(FIRST_CONGRESS)}–${ordinal(LAST_CONGRESS)} Congress (2003–2026)`
      : `${ordinal(filter.congress)} Congress (${congressYears(filter.congress)})`;
  const lawN = flow.nodes.find((n) => n.id === "law")?.value ?? 0;
  const publicLaws =
    filter.policy === "all"
      ? filter.congress === "all"
        ? Object.values(data?.publicLaws ?? {}).reduce((a, b) => a + b, 0)
        : (data?.publicLaws[filter.congress] ?? null)
      : null;
  const table: TableSpec | undefined = data
    ? {
        caption: `Bills and joint resolutions by Congress${filter.policy === "all" ? "" : `, policy area ${filter.policy || "not recorded"}`}`,
        columns: [
          { label: "Congress", align: "left" },
          { label: "Introduced" },
          { label: "Reported" },
          { label: "Passed a chamber" },
          { label: "Passed both" },
          { label: "Became law" },
          { label: "Public laws (Statutes at Large)" },
        ],
        rows: tableRows.map((r) => ({
          key: String(r.congress),
          muted: filter.congress !== "all" && filter.congress !== r.congress,
          cells: [
            `${ordinal(r.congress)} (${congressYears(r.congress)})`,
            fmtInt(r.introduced),
            fmtInt(r.reported),
            fmtInt(r.passed),
            fmtInt(r.both),
            fmtInt(r.law),
            r.publicLaws === null ? "Not recorded" : fmtInt(r.publicLaws),
          ],
        })),
      }
    : undefined;
  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap items-end gap-3"
        role="group"
        aria-label="Filter the bill-to-law flow"
      >
        <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <label htmlFor="lawviz-bill-congress">Congress</label>
          <select
            id="lawviz-bill-congress"
            className={control}
            value={String(filter.congress)}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                congress: e.target.value === "all" ? "all" : Number(e.target.value),
              }))
            }
            disabled={!data}
          >
            <option value="all">All, 108th–119th</option>
            {congresses.map((c) => (
              <option key={c} value={c}>
                {ordinal(c)} ({congressYears(c)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <label htmlFor="lawviz-bill-policy">Policy area</label>
          <select
            id="lawviz-bill-policy"
            className={`${control} max-w-[18rem]`}
            value={filter.policy === "all" ? "\u0000all" : filter.policy}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                policy: e.target.value === "\u0000all" ? "all" : e.target.value,
              }))
            }
            disabled={!data}
          >
            <option value={"\u0000all"}>All policy areas</option>
            {(data?.policies ?? []).map((p) => (
              <option key={p || "nr"} value={p}>
                {p || "Not recorded"}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ChartFrame
        title="From bill to law"
        unit="bills and joint resolutions"
        period={scope}
        sources={[
          { label: "Bill Status (GovInfo)", url: "https://www.govinfo.gov/bulkdata/BILLSTATUS" },
          { label: "Congress.gov", url: "https://www.congress.gov/" },
          {
            label: "Statutes at Large (GovInfo)",
            url: "https://www.govinfo.gov/app/collection/statute",
          },
        ]}
        status={status}
        table={table}
        minHeight={340}
        partialNotice={
          data?.dropped
            ? `${fmtInt(data.dropped)} stored rows could not be read and are left out.`
            : undefined
        }
        notes={[
          "Each stage comes only from the bill's published actions: reported (committee report action codes), passed a chamber (passage codes or text, a vitiated passage excluded), passed both, became law (public or private law action). A bill stops at the last stage its record shows.",
          "Blue ribbons and nodes reached the stage; grey ones are not recorded as reaching it. Ribbon width is the number of bills.",
          "Hover or use the arrow keys on the chart to read each flow; the table gives the counts by Congress.",
        ]}
        footnotes={[
          ...builtNote(q.data?.builtAt ?? null),
          `${fmtInt(flow.total)} bills and joint resolutions; ${fmtInt(lawN)} became law (${fmtInt(flow.withLawNumber)} with a law number on the record).`,
          ...(publicLaws !== null
            ? [
                `The Statutes at Large table lists ${fmtInt(publicLaws)} public laws for the same Congresses (private laws are not in it).`,
              ]
            : []),
          ...(resolutions
            ? [
                `${fmtInt(resolutions)} simple and concurrent resolutions are not shown: they do not go to the President.`,
              ]
            : []),
          ...(flow.lawWithoutPassage
            ? [
                `${fmtInt(flow.lawWithoutPassage)} recorded as law have no chamber passage recorded; they end at “No passage recorded”.`,
              ]
            : []),
        ]}
      >
        <ChartLegend
          mark="swatch"
          items={[
            { id: "r", label: "Reached the stage", color: REACHED },
            { id: "n", label: "Not recorded as reaching it", color: "var(--chart-axis)" },
          ]}
        />
        <div className="pb-2">
          <StageFlowChart flow={flow} />
        </div>
      </ChartFrame>
    </div>
  );
}
