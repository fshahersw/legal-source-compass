/**
 * /insights/signals: patterns that need more than one series — time to MDL termination (Kaplan–Meier), growth of new
 * MDLs aligned on their first transfer order, gross new-filing waves of product-liability MDLs (FJC IDB), the
 * recall-to-MDL event study (insights data layer), where member actions were first filed, co-counsel networks and,
 * last and labelled exploratory, clusters of states. Each section states its method; every figure is a
 * historical count or rate with its n, never a prediction.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getMdlHierarchy } from "@/lib/external/mdlNetwork.functions";
import { getFirmNetwork } from "@/lib/external/firmIntel.functions";
import { STATES } from "@/lib/corpus/geo";
import {
  ChartFrame,
  DistributionStrip,
  Heatmap,
  LineTrend,
  Network,
  Sankey,
  SurvivalCurve,
  longDate,
  metricFormatter,
  type ChartStatus,
  type PeriodAxis,
} from "@/components/charts";
import { alignedSummary, kaplanMeier, median } from "@/components/charts/stats";
import { Button } from "@/components/ui/button";
import { FixtureBanner, Field, Segmented, controlClass } from "./controls";
import {
  catalogQuery,
  eventStudyQuery,
  fixturesOn,
  InsightsLayerNotReady,
  mdlQuery,
  stateBundleQuery,
} from "./data";
import {
  JPML_SOURCE,
  coCounselNetwork,
  mdlGrowthAligned,
  mdlSurvival,
  originSankey,
} from "./bridge/mdl";
import { DEFAULT_FEATURES, clusterInput, clusterStates } from "./clusters";
import { FilingWaves } from "./FilingWaves";

const count = metricFormatter("count");
const STATE_NAME = new Map(STATES.map((s) => [s.usps, s.name] as const));

const SECTIONS = [
  { id: "termination", label: "Time to termination" },
  { id: "growth", label: "Growth after centralization" },
  { id: "waves", label: "New-filing waves" },
  { id: "recalls", label: "Recall to MDL" },
  { id: "origins", label: "Where actions were filed" },
  { id: "cocounsel", label: "Co-counsel network" },
  // Demoted (kept, not removed): an exploratory grouping, last on the page.
  { id: "clusters", label: "State clusters (exploratory)" },
] as const;

function statusOf(
  q: { isPending: boolean; isError: boolean; refetch: () => unknown },
  empty: string | null,
): ChartStatus {
  if (q.isPending) return { kind: "loading" };
  if (q.isError) return { kind: "error", onRetry: () => void q.refetch() };
  if (empty) return { kind: "empty", reason: empty };
  return { kind: "ready" };
}

function Termination() {
  const q = useQuery(mdlQuery);
  const [split, setSplit] = useState<"all" | "type">("all");
  const input = useMemo(() => (q.data ? mdlSurvival(q.data) : null), [q.data]);
  const groups = useMemo(() => {
    if (!input) return [];
    if (split === "all")
      return [
        { id: "all", label: "All MDLs", km: kaplanMeier(input.subjects), subjects: input.subjects },
      ];
    const mt = input.subjects.filter((s) => input.massTort.has(s.id));
    const other = input.subjects.filter((s) => !input.massTort.has(s.id));
    return [
      { id: "other", label: "Not mass torts", km: kaplanMeier(other), subjects: other },
      { id: "mt", label: "Mass torts", km: kaplanMeier(mt), subjects: mt },
    ];
  }, [input, split]);
  const empty =
    q.data === null
      ? "MDL reports are not published yet."
      : input && !input.subjects.length
        ? "No MDL has a usable transfer date."
        : null;
  return (
    <ChartFrame
      id="termination"
      title="Share of MDLs not yet terminated, by years since creation"
      unit="share of MDLs under observation"
      period={
        input
          ? `Observed ${longDate(input.window.from)} to ${longDate(input.window.to)}`
          : undefined
      }
      sources={[JPML_SOURCE]}
      status={statusOf(q, empty)}
      headingLevel="h2"
      minHeight={300}
      actions={
        <Segmented
          label="Groups"
          value={split}
          onChange={setSplit}
          options={[
            { id: "all", label: "All" },
            { id: "type", label: "Mass tort or not" },
          ]}
        />
      }
      notes={[
        "Kaplan–Meier estimate: at each termination, the share still pending is multiplied by (1 − terminations ÷ MDLs under observation then). Years run from the MDL's first transfer order.",
        "The reports cover a two-year window only. An MDL created before the window enters the estimate at the age it had when the reports begin (delayed entry), so the curve uses only what the window observed.",
        "A tick (|) marks an MDL still pending at the latest report (censored): its end is not yet known. The band is a 95% interval (Greenwood, log scale).",
        "A historical base rate from these MDLs, not a forecast for any one MDL.",
      ]}
      footnotes={
        input
          ? [
              ...groups.map(
                (g) =>
                  `${g.label}: n = ${g.km.n}, ${g.km.events} terminated in the window, ${g.km.censored} still pending; median ${g.km.medianTime === null ? "not reached" : `${g.km.medianTime.toFixed(1)} years`}.`,
              ),
              ...(input.dropped.length
                ? [
                    `${input.dropped.length} MDLs left out: ${[...new Set(input.dropped.map((d) => d.reason))].join("; ")}.`,
                  ]
                : []),
            ]
          : undefined
      }
      table={
        groups.length
          ? {
              caption: "Kaplan–Meier steps",
              columns: [
                { label: "Group" },
                { label: "Years", align: "right" },
                { label: "Under observation", align: "right" },
                { label: "Terminated", align: "right" },
                { label: "Not yet terminated", align: "right" },
                { label: "95% interval", align: "right" },
              ],
              rows: groups.flatMap((g) =>
                g.km.steps.map((s, i) => ({
                  key: `${g.id}-${i}`,
                  cells: [
                    g.label,
                    s.time.toFixed(2),
                    String(s.atRisk),
                    String(s.events),
                    `${(s.survival * 100).toFixed(1)}%`,
                    s.lower !== null && s.upper !== null
                      ? `${(s.lower * 100).toFixed(1)}–${(s.upper * 100).toFixed(1)}%`
                      : "Not computed",
                  ],
                })),
              ),
            }
          : undefined
      }
    >
      {groups.length ? (
        <SurvivalCurve
          groups={groups}
          timeUnit="years since creation"
          eventLabel="termination"
          ariaLabel="MDLs not yet terminated by years since creation"
          height={320}
        />
      ) : null}
    </ChartFrame>
  );
}

function Growth() {
  const q = useQuery(mdlQuery);
  const [only, setOnly] = useState<"all" | "mt">("all");
  const data = useMemo(
    () => (q.data ? mdlGrowthAligned(q.data, { massTortOnly: only === "mt" }) : null),
    [q.data, only],
  );
  const summary = useMemo(
    () =>
      data ? alignedSummary(data.rows.map((r) => ({ offset: r.offset, value: r.pending }))) : [],
    [data],
  );
  const axis: PeriodAxis = useMemo(() => {
    const max = summary.length ? summary[summary.length - 1]!.offset : 0;
    const keys = Array.from({ length: max + 1 }, (_, i) => String(i));
    return { keys, label: (k) => `Month ${k} after the first transfer order`, tick: (k) => k };
  }, [summary]);
  const at = new Map(summary.map((s) => [String(s.offset), s] as const));
  const series = [
    {
      id: "q3",
      label: "75th percentile",
      points: axis.keys.map((k) => ({
        key: k,
        value: at.get(k)?.q3 ?? null,
        n: at.get(k)?.n ?? null,
      })),
    },
    {
      id: "median",
      label: "Median",
      points: axis.keys.map((k) => ({
        key: k,
        value: at.get(k)?.median ?? null,
        n: at.get(k)?.n ?? null,
      })),
    },
    {
      id: "q1",
      label: "25th percentile",
      points: axis.keys.map((k) => ({
        key: k,
        value: at.get(k)?.q1 ?? null,
        n: at.get(k)?.n ?? null,
      })),
    },
  ];
  const empty =
    q.data === null
      ? "MDL reports are not published yet."
      : data && !data.cases.length
        ? "No MDL was created inside the report window."
        : null;
  return (
    <ChartFrame
      id="growth"
      title="Actions pending in new MDLs, by months since the first transfer order"
      unit="actions pending"
      period={
        q.data
          ? `MDLs created ${longDate(q.data.overview.first_report)} to ${longDate(q.data.overview.as_of)}`
          : undefined
      }
      sources={[JPML_SOURCE]}
      status={statusOf(q, empty)}
      headingLevel="h2"
      minHeight={280}
      actions={
        <Segmented
          label="MDLs"
          value={only}
          onChange={setOnly}
          options={[
            { id: "all", label: "All" },
            { id: "mt", label: "Mass torts only" },
          ]}
        />
      }
      notes={[
        "Event-aligned: every MDL created inside the report window is lined up on the calendar month of its first transfer order (month 0), so growth is compared from the same starting point.",
        "The middle line is the median of the MDLs observed at that month; the outer lines are the 25th and 75th percentiles. Later months rest on fewer MDLs (n in the tooltip and table), because newer MDLs have not reached them yet.",
        "MDLs created before the reports begin are left out: their first months were not observed.",
      ]}
      footnotes={
        data
          ? [
              `${data.cases.length} MDLs; n at month 0: ${at.get("0")?.n ?? 0}, at the last month shown: ${summary[summary.length - 1]?.n ?? 0}.`,
            ]
          : undefined
      }
      table={
        data
          ? {
              caption: "MDLs in the event study",
              columns: [
                { label: "MDL" },
                { label: "First transfer order", align: "right" },
                { label: "Months observed", align: "right" },
                { label: "Pending at latest report", align: "right" },
              ],
              rows: data.cases.map((c) => ({
                key: String(c.mdl),
                cells: [
                  <Link
                    key="l"
                    to={`/matters/lens/${c.mdl}` as never}
                    className="text-primary hover:underline"
                  >
                    {c.label}
                  </Link>,
                  longDate(c.transferred),
                  String(c.months),
                  count.full(c.latestPending),
                ],
              })),
            }
          : undefined
      }
    >
      {summary.length ? (
        <LineTrend
          series={series}
          axis={axis}
          formatter={count}
          unit="actions pending"
          ariaLabel="Median and quartiles of pending actions by months since transfer"
          highlight="median"
          height={280}
          directLabels
        />
      ) : null}
    </ChartFrame>
  );
}

function RecallStudy() {
  const q = useQuery(eventStudyQuery);
  const notReady = q.error instanceof InsightsLayerNotReady;
  const study = q.data ?? null;
  const months = study?.cases.map((c) => c.months) ?? [];
  const med = median(months);
  return (
    <ChartFrame
      id="recalls"
      title={study?.title ?? "Months from a product's first recall to the creation of its MDL"}
      unit="months"
      period={study ? `${study.cases.length} cases` : undefined}
      sources={study?.sources ?? []}
      status={
        q.isPending
          ? { kind: "loading" }
          : notReady
            ? {
                kind: "empty",
                reason:
                  "This study needs the exact product–MDL links of the platform's metric layer (publisher-stated or exact-identifier links only). The layer is not published yet; the section fills in when it is.",
              }
            : q.isError
              ? { kind: "error", onRetry: () => void q.refetch() }
              : !study?.cases.length
                ? { kind: "empty", reason: "No product has an exact link to an MDL yet." }
                : { kind: "ready" }
      }
      headingLevel="h2"
      notes={[
        "Each case is one MDL linked exactly to a product (never by caption, product name or judge); month 0 is the product's first recall.",
        "Negative months mean the MDL came first. The spread is descriptive: it is not a forecast of when an MDL follows a recall.",
        ...(study ? [study.method] : []),
      ]}
      table={
        study
          ? {
              caption: "Cases",
              columns: [
                { label: "MDL" },
                { label: "Event" },
                { label: "Event date", align: "right" },
                { label: "MDL created", align: "right" },
                { label: "Months", align: "right" },
                { label: "Link evidence", align: "left" },
              ],
              rows: study.cases.map((c) => ({
                key: c.id,
                cells: [
                  c.label,
                  c.eventLabel,
                  longDate(c.eventDate),
                  longDate(c.outcomeDate),
                  String(c.months),
                  `${c.evidence.evidence} (${c.evidence.sourceDataset})`,
                ],
              })),
            }
          : undefined
      }
    >
      {study ? (
        <>
          <FixtureBanner on={fixturesOn} />
          <DistributionStrip
            items={study.cases.map((c) => ({ id: c.id, label: c.label, value: c.months }))}
            formatter={{
              ...count,
              full: (v) => (v === null || v === undefined ? "Not recorded" : `${v} months`),
            }}
            ariaLabel="Months from first recall to MDL creation"
            references={med !== null ? [{ label: "Median", value: med }] : []}
            height={130}
            zero
          />
        </>
      ) : null}
    </ChartFrame>
  );
}

function Clusters() {
  const bundle = useQuery(stateBundleQuery);
  const catalog = useQuery(catalogQuery);
  const [k, setK] = useState(4);
  const [features, setFeatures] = useState<string[]>([...DEFAULT_FEATURES]);
  const options = (catalog.data?.metrics ?? []).filter(
    (m) =>
      m.id.startsWith("sm.") &&
      (m.format === "rate_per_100k" ||
        m.format === "percent" ||
        m.format === "ratio" ||
        m.id === "sm.per_capita_income" ||
        m.id === "sm.gdp_per_capita"),
  );
  const labelOf = (id: string) => catalog.data?.metrics.find((m) => m.id === id)?.label ?? id;
  const input = useMemo(
    () => (bundle.data ? clusterInput(bundle.data, features) : null),
    [bundle.data, features],
  );
  const result = useMemo(() => (input ? clusterStates(input, k) : null), [input, k]);
  const empty = !input
    ? null
    : !input.year
      ? "The chosen metrics share no complete year."
      : !result
        ? "Too few states record every chosen metric for this many clusters."
        : null;
  return (
    <ChartFrame
      id="clusters"
      title="Exploratory: states grouped by similar values of the chosen metrics"
      unit="mean z-score in each cluster"
      period={input?.year ?? undefined}
      sources={[
        {
          label: "State metrics (Census, BEA, BLS, CDC, NHTSA, openFDA)",
          url: "/places/analytics",
        },
      ]}
      status={statusOf(bundle, empty)}
      headingLevel="h2"
      actions={
        <Field label="Clusters" className="w-24">
          <select className={controlClass} value={k} onChange={(e) => setK(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      }
      notes={[
        `k-means (k-means++ seeding from a fixed seed, best of 25 starts) on z-scores: each metric is rescaled to mean 0 and standard deviation 1 across the states so no unit dominates. Same data, same clusters.`,
        "A cluster says the states' figures for these metrics look alike in this year; it is not a ranking, a finding about causes, or about the people in the states. Change the metrics and the clusters change.",
        "The silhouette (−1 to 1) says how well separated the clusters are; below about 0.25 the grouping is weak.",
      ]}
      footnotes={
        input && result
          ? [
              `${input.states.length} states and DC clustered; silhouette ${result.fit.silhouette === null ? "not computed" : result.fit.silhouette.toFixed(2)}.`,
              ...(input.excluded.length
                ? [
                    `Left out (a chosen metric not recorded): ${input.excluded.map((e) => STATE_NAME.get(e.usps) ?? e.usps).join(", ")}.`,
                  ]
                : []),
            ]
          : undefined
      }
      table={
        input && result
          ? {
              caption: "Cluster profiles (unweighted mean of the states' values)",
              columns: [
                { label: "Cluster" },
                { label: "States", align: "right" },
                ...input.features.map((f) => ({ label: labelOf(f), align: "right" as const })),
              ],
              rows: result.profileRaw.map((row, c) => ({
                key: String(c),
                cells: [
                  `Cluster ${c + 1}`,
                  String(result.members[c]!.length),
                  ...row.map((v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 })),
                ],
              })),
            }
          : undefined
      }
    >
      <fieldset className="mb-2">
        <legend className="mb-1 text-[11px] font-medium text-muted-foreground">
          Metrics used ({features.length})
        </legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {options.map((m) => (
            <label key={m.id} className="inline-flex items-center gap-1 text-[11px]">
              <input
                type="checkbox"
                checked={features.includes(m.id)}
                onChange={(e) =>
                  setFeatures((prev) =>
                    e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                  )
                }
                disabled={!features.includes(m.id) && features.length >= 8}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {input && result ? (
        <div className="space-y-3">
          <Heatmap
            rows={result.profileZ.map((_, c) => ({
              id: String(c),
              label: `Cluster ${c + 1} (${result.members[c]!.length})`,
            }))}
            columns={input.features.map((f) => ({ id: f, label: labelOf(f) }))}
            value={(r, c) => result.profileZ[Number(r)]![input.features.indexOf(c)] ?? null}
            formatter={{
              full: (v) =>
                v === null || v === undefined
                  ? "Not recorded"
                  : `${v > 0 ? "+" : ""}${v.toFixed(2)} SD from the mean of states`,
              tick: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`,
              delta: (d) => d.toFixed(2),
            }}
            ariaLabel="Cluster profiles"
            scale="diverging"
            domain={[-2, 2]}
            cellLabels
            cellHeight={24}
          />
          <ol className="grid gap-2 sm:grid-cols-2">
            {result.members.map((m, c) => (
              <li
                key={c}
                className="rounded border border-border/70 px-2 py-1.5 text-[11px] leading-4"
              >
                <p className="font-semibold">
                  Cluster {c + 1} · {m.length} {m.length === 1 ? "state" : "states"}
                </p>
                <p className="text-muted-foreground">
                  {m.map((u, i) => (
                    <span key={u}>
                      {i ? ", " : ""}
                      <Link
                        to={`/places/${u}` as never}
                        className="hover:text-foreground hover:underline"
                      >
                        {STATE_NAME.get(u) ?? u}
                      </Link>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </ChartFrame>
  );
}

function Origins() {
  const mdl = useQuery(mdlQuery);
  const top = useMemo(
    () =>
      [...(mdl.data?.mdls ?? [])]
        .filter((r) => r.status === "pending")
        .filter(hasPending)
        .sort((a, b) => b.pending - a.pending)
        .slice(0, 8)
        .map((r) => r.mdl),
    [mdl.data],
  );
  const hs = useQueries({
    queries: top.map((n) => ({
      queryKey: ["insights", "mdl-hierarchy", n],
      queryFn: () => getMdlHierarchy({ data: { mdl: n } }),
      staleTime: 10 * 60 * 1000,
      retry: 1,
    })),
  });
  const pending = mdl.isPending || hs.some((h) => h.isPending);
  const records = hs.flatMap((h) => (h.data && h.data.origin ? [h.data] : [])).slice(0, 5);
  const sankey = useMemo(() => originSankey(records, 6), [records.map((r) => r.mdl).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = hs.filter((h) => h.isError).length;
  return (
    <ChartFrame
      id="origins"
      title="Where member actions of the largest MDLs were first filed"
      unit="originating dockets"
      period={
        records.length
          ? `${records.length} of the largest pending MDLs with a recorded origin`
          : undefined
      }
      sources={[
        {
          label: "Matter registry (MDL hierarchy), CourtListener dockets",
          url: "/matters/analytics",
        },
        JPML_SOURCE,
      ]}
      status={
        pending
          ? { kind: "loading" }
          : mdl.isError
            ? { kind: "error", onRetry: () => void mdl.refetch() }
            : records.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "None of the largest MDLs has a recorded origin yet." }
      }
      partialNotice={
        failed
          ? `${failed} MDL record${failed === 1 ? "" : "s"} could not be read; the others are shown.`
          : undefined
      }
      headingLevel="h2"
      minHeight={360}
      notes={[
        "Each ribbon is a count of member dockets whose originating court is recorded in the matter registry by exact docket identifier (membership needs explicit evidence; it is never inferred from a caption).",
        "The six largest originating courts of each MDL are drawn; 'Other originating courts' is the MDL's recorded total minus those six. Coverage is the registry's, not every action the Panel counts.",
      ]}
      table={{
        caption: "Originating dockets by court and MDL",
        columns: [
          { label: "Originating court" },
          { label: "MDL" },
          { label: "Dockets", align: "right" },
        ],
        rows: sankey.links.map((l) => ({
          key: `${l.source}-${l.target}`,
          cells: [
            sankey.nodes.find((n) => n.id === l.source)?.label ?? l.source,
            sankey.nodes.find((n) => n.id === l.target)?.label ?? l.target,
            count.full(l.value),
          ],
        })),
      }}
    >
      {records.length ? (
        <Sankey
          nodes={sankey.nodes}
          links={sankey.links}
          formatter={count}
          unit="originating dockets"
          ariaLabel="Originating courts into MDLs"
          height={Math.max(320, sankey.nodes.length * 16)}
        />
      ) : null}
    </ChartFrame>
  );
}

function CoCounsel() {
  const q = useQuery({
    queryKey: ["insights", "firm-network"],
    queryFn: () => getFirmNetwork(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const net = useMemo(() => (q.data ? coCounselNetwork(q.data) : null), [q.data]);
  return (
    <ChartFrame
      id="cocounsel"
      title="Law firms that represented the same parties in MDLs (co-counsel)"
      unit="parties represented together"
      period={net ? `${net.edges.length} strongest pairs` : undefined}
      sources={[{ label: "MDL counsel appearances (firm network)", url: "/courts/firms" }]}
      status={statusOf(q, net && !net.edges.length ? "No co-counsel pair is recorded yet." : null)}
      headingLevel="h2"
      minHeight={380}
      notes={[
        "Two firms are linked when both have a counsel entry for the same party; the line's weight is the number of such parties. Only pairs sharing at least three parties are recorded, and the 30 strongest are drawn.",
        "Firm names are as recorded on the docket entries; firms are not merged by similar names. Distance on the page carries no meaning.",
      ]}
      table={
        q.data
          ? {
              caption: "Co-counsel pairs",
              columns: [
                { label: "Firm" },
                { label: "Firm", align: "left" },
                { label: "Parties together", align: "right" },
              ],
              rows: q.data.cocounsel.map((p) => ({
                key: `${p.a.firm}|${p.b.firm}`,
                cells: [p.a.firm, p.b.firm, count.full(p.weight)],
              })),
            }
          : undefined
      }
    >
      {net && net.edges.length ? (
        <Network
          nodes={net.nodes}
          edges={net.edges}
          formatter={count}
          edgeUnit="parties together"
          nodeUnit="pairs shown"
          ariaLabel="Co-counsel network"
          height={440}
        />
      ) : null}
    </ChartFrame>
  );
}

export function SignalsView() {
  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
        Patterns across many records: how long MDLs last, how fast new ones grow and take in new
        cases, where litigation starts and who works together. Every figure is a historical count or
        rate from the records shown, with its n; none is a prediction for a particular matter.
      </p>
      <nav
        aria-label="Sections on this page"
        className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-x-4 gap-y-1 rounded bg-background/95 px-1 py-1.5 text-xs backdrop-blur"
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
          </a>
        ))}
      </nav>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Termination />
        <Growth />
      </div>
      <FilingWaves />
      <RecallStudy />
      <Origins />
      <CoCounsel />
      <Clusters />
      <p className="text-[11px] text-muted-foreground">
        <Button asChild variant="link" size="sm" className="h-auto px-0 text-[11px]">
          <Link to="/insights/explore">Compare any two metrics in Explore</Link>
        </Button>
      </p>
    </div>
  );
}
