/**
 * MDL lifecycle lanes: every MDL as one compact lane on a shared time axis — the pending-actions line (JPML monthly
 * reports and fiscal-year ends, each lane scaled to its own peak), a strip of docket entries or filings collected per
 * year (one shared logarithmic shade), and its centralization and closing dates. Sort, filter, and open a lane in place
 * for its detailed tracks.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartFrame, type TableSpec } from "@/components/charts/ChartFrame";
import {
  LaneRows,
  LaneTracks,
  laneDomain,
  type LaneRowSpec,
  type LaneTrack,
} from "@/components/charts/Lanes";
import { metricFormatter } from "@/components/charts/format";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/matters/common";
import {
  filterLanes,
  laneFacets,
  sortLanes,
  type LaneFilter,
  type LaneSort,
  type LaneSummary,
} from "@/lib/litviz/lanes";
import { bySeries, dayLabel, monthLabel, STATUS_LABEL, type SeriesRow } from "@/lib/litviz/model";
import { MdlLaneDetail, todayIndex } from "./MdlLaneDetail";
import { lanesQuery } from "./queries";
import { lanePoints, mdlMarkers, seriesBins, yearBins } from "./tracks";

const count = metricFormatter("count");
const SORTS: { value: LaneSort; label: string }[] = [
  { value: "size", label: "Actions pending now" },
  { value: "peak", label: "Peak pending" },
  { value: "start", label: "Centralization date" },
  { value: "activity", label: "Docket entries, last 12 months" },
  { value: "number", label: "MDL number" },
];
const FROM = [1990, 2000, 2010, 2020] as const;
/** Lanes listed at first; the reader shows more on request (the page scrolls, never a box inside it). */
const PAGE = 30;

const shortTitle = (t: string) => t.replace(/^IN RE:?\s*/i, "").replace(/^In re\s+/, "");

function rowSpec(l: LaneSummary, strip: "docket" | "filings"): LaneRowSpec {
  const latestText = l.latest ? count.full(l.latest.value) : undefined;
  const when = l.latest
    ? l.latest.fy
      ? `FY${Math.floor(l.latest.t / 12)} end`
      : monthLabel(l.latest.t)
    : null;
  const sub = [l.court.label ?? "Court not recorded", l.judge.name ?? "Judge not recorded"].join(
    " · ",
  );
  return {
    id: l.mdl,
    label: `MDL ${l.mdl}`,
    title: shortTitle(l.title),
    sublabel: sub,
    aside: latestText,
    asideNote: when ?? STATUS_LABEL[l.status],
    line: lanePoints(l),
    strip: yearBins(strip === "docket" ? l.docket : l.filings),
    // compact lanes mark centralization and closing; the motion date is in the detail
    markers: mdlMarkers(l).filter((m) => m.kind !== "mark"),
    summary: `MDL ${l.mdl}, ${l.title}. ${STATUS_LABEL[l.status]}. ${
      l.dates.centralized ? `Centralized ${dayLabel(l.dates.centralized)}. ` : ""
    }${latestText ? `${latestText} actions pending (${when}). ` : "Pending actions not recorded. "}${
      l.peak ? `Peak ${count.full(l.peak.value)}. ` : ""
    }${l.activity12 !== null ? `${count.full(l.activity12)} docket entries collected in the last 12 months.` : ""}`,
  };
}

function lanesTable(lanes: readonly LaneSummary[]): TableSpec {
  const runTotal = (r: LaneSummary["filings"]) =>
    r ? r.values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  return {
    caption: "MDL lanes: one row per MDL in the current filter and order",
    columns: [
      { label: "MDL" },
      { label: "Title", align: "left" },
      { label: "Transferee court", align: "left" },
      { label: "Judge", align: "left" },
      { label: "Status", align: "left" },
      { label: "Centralized", align: "left" },
      { label: "Actions pending", align: "right" },
      { label: "As of", align: "left" },
      { label: "Peak pending", align: "right" },
      { label: "Docket entries, last 12 months", align: "right" },
      { label: "Dated filings collected", align: "right" },
    ],
    rows: lanes.map((l) => ({
      key: l.mdl,
      cells: [
        l.mdl,
        l.title,
        l.court.label ?? "Not recorded",
        l.judge.name ?? "Not recorded",
        STATUS_LABEL[l.status],
        l.dates.centralized ?? "Not recorded",
        l.latest ? count.full(l.latest.value) : "Not recorded",
        l.latest
          ? l.latest.fy
            ? `FY${Math.floor(l.latest.t / 12)} end`
            : monthLabel(l.latest.t)
          : "Not recorded",
        l.peak ? count.full(l.peak.value) : "Not recorded",
        l.activity12 !== null ? count.full(l.activity12) : "Not recorded",
        runTotal(l.filings) !== null ? count.full(runTotal(l.filings)) : "Not recorded",
      ],
    })),
  };
}

const SELECT =
  "h-8 max-w-[15rem] rounded-md border border-input bg-background px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-ring";

export function MdlLanesOverview() {
  const [scope, setScope] = useState<"reported" | "historical">("reported");
  const [decade, setDecade] = useState<number | null>(null);
  const [sort, setSort] = useState<LaneSort>("size");
  const [filter, setFilter] = useState<LaneFilter>({});
  const [strip, setStrip] = useState<"docket" | "filings">("docket");
  const [from, setFrom] = useState<number>(2000);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const q = useQuery(lanesQuery(scope, decade));
  const data = q.data;

  const facets = useMemo(() => laneFacets(data?.lanes ?? []), [data]);
  const shown = useMemo(
    () => sortLanes(filterLanes(data?.lanes ?? [], filter), sort),
    [data, filter, sort],
  );
  const today = todayIndex(data?.today ?? null);
  const effectiveFrom =
    scope === "historical" && data?.decade ? Math.min(from, data.decade - 10) : from;
  const domain: [number, number] = [effectiveFrom * 12, (Math.floor(today / 12) + 1) * 12];
  const stripMax = useMemo(() => {
    let m = 0;
    for (const l of shown)
      for (const v of (strip === "docket" ? l.docket : l.filings)?.values ?? [])
        m = Math.max(m, v ?? 0);
    return m;
  }, [shown, strip]);
  const stripScale = (v: number) => (stripMax > 0 ? Math.log1p(v) / Math.log1p(stripMax) : 0);
  const rows = useMemo(
    () => shown.slice(0, limit).map((l) => rowSpec(l, strip)),
    [shown, strip, limit],
  );
  const byId = useMemo(() => new Map(shown.map((l) => [l.mdl, l] as const)), [shown]);

  const readout = (id: string, t: number) => {
    const l = byId.get(id);
    if (!l) return null;
    const y = Math.floor(t / 12);
    const pts = lanePoints(l).filter((p) => Math.floor(p.t / 12) === y);
    const last = pts[pts.length - 1];
    const run = (r: LaneSummary["docket"]) =>
      r && y >= r.start && y < r.start + r.values.length ? r.values[y - r.start] : null;
    const dk = run(l.docket);
    const fl = run(l.filings);
    return {
      title: `MDL ${l.mdl} · ${y}`,
      subtitle: shortTitle(l.title),
      rows: [
        {
          key: "p",
          label: last ? `actions pending (${last.label})` : "actions pending",
          value: last ? count.full(last.v) : "Not recorded",
        },
        {
          key: "d",
          label: `docket entries collected${l.docket?.partial === y ? " (partial year)" : ""}`,
          value: dk === null || dk === undefined ? "Not recorded" : count.full(dk),
        },
        {
          key: "f",
          label: `dated filings collected${l.filings?.partial === y ? " (partial year)" : ""}`,
          value: fl === null || fl === undefined ? "Not recorded" : count.full(fl),
        },
      ],
      footer:
        mdlMarkers(l)
          .filter((m) => Math.floor(m.t / 12) === y)
          .map((m) => m.label)
          .join(" · ") || undefined,
    };
  };

  const set = (k: keyof LaneFilter, v: string) => {
    setLimit(PAGE);
    setFilter((f) => ({ ...f, [k]: v || undefined }));
  };
  const filtered = Object.values(filter).some(Boolean);
  const status =
    q.isPending && !data
      ? ({ kind: "loading" } as const)
      : q.isError && !data
        ? ({
            kind: "error",
            message: "The MDL lanes could not be read just now.",
            onRetry: () => void q.refetch(),
          } as const)
        : !data?.lanes.length
          ? ({ kind: "empty", reason: "No MDL lanes are published for this view." } as const)
          : ({ kind: "ready" } as const);

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter and sort the MDL lanes"
      >
        <SegmentedControl
          label="Which MDLs"
          value={scope}
          options={[
            {
              value: "reported",
              label: "In JPML reports since Oct 2024",
              hint: "MDLs in the monthly pending reports or the current MDL list",
            },
            {
              value: "historical",
              label: "Earlier MDLs",
              hint: "MDLs known only from the fiscal-year statistics or the terminated-litigation tables",
            },
          ]}
          onChange={(v) => {
            setScope(v);
            setLimit(PAGE);
            setExpanded(null);
            setFilter({});
            setFrom(v === "historical" ? 1990 : 2000);
          }}
        />
        {scope === "historical" && data?.decades?.length ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Decade
            <select
              className={SELECT}
              value={data.decade ?? ""}
              onChange={(e) => setDecade(Number(e.target.value))}
            >
              {data.decades.map(([d, n]) => (
                <option key={d} value={d}>
                  {d ? `${d}s` : "Not recorded"} ({n})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Input
          value={filter.q ?? ""}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search title or MDL number"
          aria-label="Search the MDL lanes by title or number"
          className="h-8 w-56 text-[12px]"
        />
        <select
          aria-label="Transferee court"
          className={SELECT}
          value={filter.court ?? ""}
          onChange={(e) => set("court", e.target.value)}
        >
          <option value="">All courts</option>
          {facets.court.map(([k, n]) => (
            <option key={k} value={k}>
              {k} ({n})
            </option>
          ))}
        </select>
        <select
          aria-label="Transferee judge"
          className={SELECT}
          value={filter.judge ?? ""}
          onChange={(e) => set("judge", e.target.value)}
        >
          <option value="">All judges</option>
          {facets.judge.map(([k, n]) => (
            <option key={k} value={k}>
              {k} ({n})
            </option>
          ))}
        </select>
        <select
          aria-label="Litigation type"
          className={SELECT}
          value={filter.type ?? ""}
          onChange={(e) => set("type", e.target.value)}
        >
          <option value="">All types</option>
          {facets.type.map(([k, n]) => (
            <option key={k} value={k}>
              {k} ({n})
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={SELECT}
          value={filter.status ?? ""}
          onChange={(e) => set("status", e.target.value)}
        >
          <option value="">Any status</option>
          {facets.status.map(([k, n]) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k as LaneSummary["status"]] ?? k} ({n})
            </option>
          ))}
        </select>
        {filtered ? (
          <button
            type="button"
            onClick={() => setFilter({})}
            className="rounded text-[12px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <ChartFrame
        title="MDL lifecycle lanes"
        headingLevel="h2"
        unit="actions pending, per lane; docket entries or filings collected, per year"
        period={`${effectiveFrom}–${Math.floor(today / 12)}`}
        asOf={data?.today ? dayLabel(data.today) : undefined}
        minHeight={360}
        status={status}
        partialNotice={data?.notices.length ? data.notices.join(" ") : undefined}
        sources={[
          {
            label: "JPML pending MDL reports",
            url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
          },
          {
            label: "JPML statistical analyses",
            url: "https://www.jpml.uscourts.gov/statistics-info",
          },
          { label: "Court filings collected", url: "/litigation/documents" },
          { label: "Master dockets (CourtListener)", url: "https://www.courtlistener.com/" },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              Sort
              <select
                className={SELECT}
                value={sort}
                onChange={(e) => setSort(e.target.value as LaneSort)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              Strip
              <select
                className={SELECT}
                value={strip}
                onChange={(e) => setStrip(e.target.value as "docket" | "filings")}
              >
                <option value="docket">Docket entries per year</option>
                <option value="filings">Dated filings per year</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              From
              <select
                className={SELECT}
                value={from}
                onChange={(e) => setFrom(Number(e.target.value))}
              >
                {FROM.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
        notes={[
          "Each lane's line is scaled to that MDL's own peak; the number at the right is its latest pending count. Compare sizes with the sort or the table.",
          "The line joins the JPML's fiscal-year totals (September 30) and its monthly reports; a missing report leaves a gap. Fiscal-year lines the JPML extraction could not attribute with certainty are not drawn.",
          "The strip shades docket entries (or dated filings) collected per calendar year on one logarithmic scale for every lane; an empty strip means none are held, not zero. A hatched cell is the year in progress.",
          "Vertical ticks: centralization (thin) and closing (thick) where the JPML records them. Open a lane for its detailed tracks.",
        ]}
        footnotes={
          data
            ? [
                `${count.full(shown.length)} of ${count.full(data.lanes.length)} MDLs shown.`,
                ...(scope === "historical"
                  ? [
                      "Earlier MDLs come from the JPML fiscal-year statistics (FY1992 onward) and terminated-litigation tables; the monthly reports begin in October 2024.",
                    ]
                  : []),
              ]
            : undefined
        }
        table={data ? lanesTable(shown) : undefined}
      >
        <div
          className={q.isFetching && data ? "opacity-60 transition-opacity" : undefined}
          aria-busy={q.isFetching && data ? true : undefined}
        >
          {rows.length ? (
            <div>
              <LaneRows
                nameLabel="MDL"
                asideLabel="Pending"
                rows={rows}
                domain={domain}
                ariaLabel={`MDL lanes, ${rows.length} MDLs, sorted by ${SORTS.find((s) => s.value === sort)?.label.toLowerCase()}. Use the up and down arrow keys to move between MDLs and Enter to open one.`}
                stripScale={stripScale}
                readout={readout}
                expanded={expanded}
                onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
                renderExpanded={(id) => <MdlLaneDetail mdl={id} showPageLink />}
              />
              {shown.length > rows.length ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-1 py-2 text-[12px]">
                  <span className="text-muted-foreground">
                    {count.full(rows.length)} of {count.full(shown.length)} lanes listed
                  </span>
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + PAGE)}
                    className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Show {Math.min(PAGE, shown.length - rows.length)} more
                  </button>
                  <button
                    type="button"
                    onClick={() => setLimit(shown.length)}
                    className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Show all
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p role="status" className="py-6 text-center text-[12px] text-muted-foreground">
              No MDL matches these filters.
            </p>
          )}
        </div>
      </ChartFrame>
      {data?.national.length ? (
        <NationalContext rows={data.national} today={today} from={effectiveFrom} />
      ) : null}
    </div>
  );
}

function NationalContext({
  rows,
  today,
  from,
}: {
  rows: SeriesRow[];
  today: number;
  from: number;
}) {
  const s = bySeries(rows);
  const pending = (s.get("jpml_fy_pending") ?? []).filter((r) => r.value !== null);
  const granted = s.get("jpml_motions_granted") ?? [];
  const tracks: LaneTrack[] = [
    {
      kind: "line",
      id: "national_pending",
      label: "Actions pending in MDLs at fiscal-year end (JPML)",
      unit: "actions",
      formatter: count,
      points: pending.map((r, i) => {
        const fy = Number(r.month.slice(0, 4));
        const prev = pending[i - 1];
        return {
          t: fy * 12 + 8 + 29 / 30,
          v: r.value!,
          link: !!prev && Number(prev.month.slice(0, 4)) === fy - 1,
          label: `FY${fy} end, September 30`,
        };
      }),
      reach: 6,
    },
    {
      kind: "bins",
      id: "granted",
      label: "Centralization motions granted per calendar year (JPML)",
      unit: "motions",
      formatter: count,
      bins: seriesBins(granted),
    },
  ];
  const full = laneDomain(
    tracks.map((t) =>
      t.kind === "line" ? { points: t.points } : t.kind === "bins" ? { bins: t.bins } : {},
    ),
    [],
    today,
  );
  if (!full) return null;
  const domain: [number, number] = [Math.max(full[0], from * 12), full[1]];
  return (
    <ChartFrame
      title="MDLs nationally"
      unit="actions pending; motions granted"
      period={`${Math.floor(domain[0] / 12)}–${Math.floor(domain[1] / 12) - 1}`}
      sources={[
        {
          label: "JPML statistical analyses",
          url: "https://www.jpml.uscourts.gov/statistics-info",
        },
        ...(granted[0]?.source_url
          ? [{ label: "JPML calendar-year statistics", url: granted[0].source_url }]
          : []),
      ]}
      status={{ kind: "ready" }}
      notes={[
        "Each band has its own scale. FY1992 covers 15 months (July 1991 to September 1992).",
      ]}
      table={{
        caption: "MDLs nationally",
        columns: [
          { label: "Series" },
          { label: "Period", align: "left" },
          { label: "Value", align: "right" },
        ],
        rows: [
          ...pending.map((r) => ({
            key: `p${r.month}`,
            cells: [tracks[0]!.label, `FY${r.month.slice(0, 4)}`, count.full(r.value)],
          })),
          ...granted.map((r) => ({
            key: `g${r.month}`,
            cells: [tracks[1]!.label, r.month.slice(0, 4), count.full(r.value)],
          })),
        ],
      }}
    >
      <LaneTracks
        tracks={tracks}
        domain={domain}
        ariaLabel="MDLs nationally: actions pending at fiscal-year end and centralization motions granted per year."
      />
    </ChartFrame>
  );
}
