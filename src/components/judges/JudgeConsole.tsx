/**
 * Judge profile console (analyst-console layout): the profile header card, six key figures, then a 12-column grid of
 * panels built only from exactly linked records:
 *
 * - Expert admissibility: decided Rule 702 / Daubert challenges granted, this judge (95% Wilson interval) against all
 *   other attributed judges (judge_expert_rulings).
 * - How MDL actions ended: closed in the transferee court vs remanded, this judge's terminated MDLs against the same
 *   district and all terminated MDLs (JPML terminated-litigation history).
 * - Bench map: motions pending more than six months for every district judge of the court, last CJRA reports.
 * - Counsel most often before this judge: firm appearances on the master dockets of this judge's MDLs.
 * - Where the judge sits on the bench: the court's judges on the two compared docket-flow measures.
 * - Pending MDLs: actions pending per MDL in the latest JPML report.
 *
 * Motion grant rates (dismissal, summary judgment) are not in the corpus and are not shown. Every panel is context,
 * not a ranking or a prediction of how the judge will rule.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import {
  ChartFrame,
  ChartLegend,
  Heatmap,
  ScatterCorrelation,
  metricFormatter,
  seriesVar,
  type ChartSource,
} from "@/components/charts";
import {
  Cell,
  ConsoleGrid,
  ConsoleHeading,
  ConsoleTable,
  InlineBar,
  queryStatus,
} from "@/components/console/ConsoleGrid";
import { JPML } from "@/components/console/DocketHealth";
import { fjcRecordQuery } from "@/components/judiciary/judiciaryQueries";
import { KpiStrip } from "@/components/kit/KpiCard";
import { CJRA_SOURCE, lastPoint } from "@/lib/external/judgeCjra.functions";
import { JudgeHeadshot, type RecordedPhotoCredit } from "./JudgeHeadshot";
import { RulingDotPlot, SplitBars, StackBars } from "./JudgeConsoleCharts";
import {
  benchMapRows,
  benchScatter,
  benchSelf,
  commissionYear,
  counselBars,
  currentService,
  endingsModel,
  fmtInt,
  fmtPct0,
  initials,
  judgeMdlNumbers,
  layoutSpans,
  outcomeCounts,
  pendingBars,
  priorRole,
  rulingRows,
} from "./judgeConsoleView";
import {
  courtBenchSeriesQuery,
  judgeCounselQuery,
  mdlEndingsBaselineQuery,
  rulingBaselineQuery,
} from "./judgeConsoleQueries";
import { shortDate } from "./judgeGlanceView";
import {
  courtBenchQuery,
  judgeCjraQuery,
  judgeCrossProfileQuery,
  judgeRulingsQuery,
} from "./judgeQueries";

const count = metricFormatter("count");
const RULINGS_SOURCE: ChartSource = {
  label: "CourtListener RECAP docket entries (expert-admissibility rulings)",
  url: "https://www.courtlistener.com/recap/",
};
const COUNSEL_SOURCE: ChartSource = {
  label: "CourtListener RECAP: MDL master-docket attorney appearances",
  url: "https://www.courtlistener.com/recap/",
};
const JPML_TERMINATED: ChartSource = {
  label: "JPML statistical analysis of terminated MDL litigation",
  url: "https://www.jpml.uscourts.gov/statistics-info",
};
const CASE_LAW: ChartSource = {
  label: "CourtListener RECAP dockets (case-law collection)",
  url: "https://www.courtlistener.com/recap/",
};
const OUTCOME_LABEL = {
  granted: "Granted",
  granted_in_part: "Granted in part",
  denied: "Denied",
  denied_as_moot: "Denied as moot",
  deferred: "Deferred",
  not_determined: "Not determined",
} as const;

const monthYear = (iso: string) => {
  const d = shortDate(iso);
  return d.replace(/ \d{1,2},/, "");
};

/* ---------------------------------------------------------------- header card */

/** The profile header: portrait (or initials), name, court, commission, prior role and the MDLs presided over. */
export function JudgeProfileHeader({
  judgeId,
  name,
  photo,
  photoCredit,
}: {
  judgeId: string;
  name: string;
  photo: string | null;
  photoCredit: RecordedPhotoCredit | null;
}) {
  const linked = /^[a-z0-9]{8,64}$/.test(judgeId);
  const fjc = useQuery({ ...fjcRecordQuery(judgeId), enabled: linked });
  const cross = useQuery({ ...judgeCrossProfileQuery(judgeId), enabled: linked });
  const service = currentService(fjc.data);
  const commissioned = commissionYear(fjc.data);
  const prior = priorRole(fjc.data?.career);
  const senior = !!service?.seniorStatus && !service.terminationDate;
  const pending = [...(cross.data?.pending ?? [])].sort((a, b) => b.pending - a.pending);
  const facts: { k: string; v: ReactNode }[] = [];
  if (service)
    facts.push({
      k: "Court",
      v: (
        <>
          {senior ? "Senior " : ""}
          {service.title ? `${service.title}, ` : ""}
          {service.courtId ? (
            <Link
              to="/courts/$id"
              params={{ id: service.courtId }}
              className="font-semibold text-foreground hover:underline"
            >
              {service.court}
            </Link>
          ) : (
            <b className="font-semibold text-foreground">{service.court}</b>
          )}
        </>
      ),
    });
  if (commissioned)
    facts.push({
      k: "Commissioned",
      v: (
        <>
          <b className="font-semibold text-foreground">{commissioned}</b>
          {service?.president ? ` · appointed by ${service.president}` : ""}
        </>
      ),
    });
  if (prior)
    facts.push({
      k: "Last career entry before the bench",
      v: <span title={fjc.data?.career ?? undefined}>{prior}</span>,
    });
  if (pending.length)
    facts.push({
      k: pending.length > 1 ? "Presides over MDLs" : "Presides over MDL",
      v: (
        <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
          {pending.map((p) => (
            <Link
              key={p.mdl}
              to="/matters/lens/$mdl"
              params={{ mdl: String(p.mdl) }}
              title={p.title}
              className="font-semibold text-primary hover:underline"
            >
              {p.mdl}
            </Link>
          ))}
        </span>
      ),
    });
  return (
    <div className="mb-3 flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-start">
      <div className="flex shrink-0 items-start gap-3">
        <div className="peer empty:hidden">
          <JudgeHeadshot
            judgeId={judgeId}
            name={name}
            recorded={photo}
            recordedCredit={photoCredit}
          />
        </div>
        <span
          aria-hidden
          className="hidden size-16 shrink-0 place-items-center rounded-full bg-primary/10 text-[20px] font-semibold text-primary peer-empty:grid"
        >
          {initials(name)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="eyebrow m-0">Federal judge · profile</p>
        {fjc.isLoading ? (
          <div
            className="mt-2 h-10 max-w-lg animate-pulse rounded bg-muted/60"
            aria-busy="true"
            aria-label="Loading service record"
          />
        ) : facts.length ? (
          <dl className="m-0 mt-2 grid gap-x-6 gap-y-1.5 text-[12.5px] text-muted-foreground sm:grid-cols-2">
            {facts.map((f) => (
              <div key={f.k} className="min-w-0">
                <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em]">{f.k}</dt>
                <dd className="m-0 break-words sm:truncate">{f.v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 mt-2 text-[12.5px] text-muted-foreground">
            No service record is linked to this profile.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- console */

export function JudgeConsole({ judgeId, name }: { judgeId: string; name: string }) {
  const navigate = useNavigate();
  const fjc = useQuery(fjcRecordQuery(judgeId));
  const cross = useQuery(judgeCrossProfileQuery(judgeId));
  const cjra = useQuery(judgeCjraQuery(judgeId));
  const rulings = useQuery(judgeRulingsQuery(judgeId));
  const baseline = useQuery(rulingBaselineQuery);
  const court = cjra.data?.courtId ?? currentService(fjc.data)?.courtId ?? null;
  const bench = useQuery({ ...courtBenchQuery(court ?? "none"), enabled: !!court });
  const series = useQuery({ ...courtBenchSeriesQuery(court ?? "none"), enabled: !!court });
  const mdls = useMemo(() => judgeMdlNumbers(cross.data), [cross.data]);
  const counsel = useQuery({ ...judgeCounselQuery(mdls), enabled: mdls.length > 0 });
  const hasHistory = (cross.data?.historical.length ?? 0) > 0;
  const endingsBase = useQuery({ ...mdlEndingsBaselineQuery, enabled: hasHistory });

  const short = name.replace(/^Hon\.\s+/, "");
  const last =
    short
      .replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, "")
      .split(/\s+/)
      .at(-1) ?? short;
  const judgeLabel = `Judge ${last}`;

  const ruleRows = useMemo(
    () =>
      rulings.data ? rulingRows(rulings.data.rulings, baseline.data?.rulings ?? [], judgeId) : [],
    [rulings.data, baseline.data, judgeId],
  );
  const allRow = ruleRows.find((r) => r.id === "all");
  const endings = useMemo(
    () =>
      cross.data ? endingsModel(cross.data.historical, endingsBase.data ?? null, judgeLabel) : null,
    [cross.data, endingsBase.data, judgeLabel],
  );
  const self = benchSelf(bench.data, judgeId);
  const selfRecord = cjra.data?.recordId ?? self?.recordId ?? null;
  const scatter = useMemo(() => benchScatter(bench.data), [bench.data]);
  const mapRows = useMemo(
    () => benchMapRows(series.data, bench.data, selfRecord),
    [series.data, bench.data, selfRecord],
  );
  const firms = useMemo(() => counselBars(counsel.data?.firms ?? []), [counsel.data]);
  const pend = useMemo(() => pendingBars(cross.data), [cross.data]);
  const motions = cjra.data ? lastPoint(cjra.data, "motions_6m") : null;
  const benchPeriod = bench.data?.period ? shortDate(bench.data.period) : undefined;
  const courtName = bench.data?.court ?? currentService(fjc.data)?.court ?? "the court";
  const remandShare = endings?.rows[0]?.remandedPct ?? null;

  const kpis = [
    {
      key: "mdls",
      label: "Pending MDLs (transferee)",
      value: cross.data ? fmtInt(cross.data.pending.length) : null,
      meta: cross.data?.asOf
        ? `JPML report ${shortDate(cross.data.asOf)}`
        : "No MDL record linked to this profile",
      state: cross.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "actions",
      label: "Actions pending in them",
      value: cross.data ? fmtInt(cross.data.pendingActions) : null,
      meta:
        cross.data?.sharePct != null
          ? `${cross.data.sharePct.toFixed(1)}% of all MDL actions${cross.data.rank ? ` · rank ${cross.data.rank}` : ""}`
          : undefined,
      state: cross.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "terminated",
      label: "Terminated MDLs",
      value: cross.data ? fmtInt(cross.data.historical.length) : null,
      meta:
        remandShare != null ? `${remandShare.toFixed(1)}% of their actions remanded` : undefined,
      state: cross.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "motions",
      label: "Motions pending > 6 months",
      value: motions ? fmtInt(motions.value) : null,
      meta: motions
        ? `CJRA ${monthYear(motions.period)}${scatter?.medianMotions != null ? ` · court median ${fmtInt(scatter.medianMotions)}` : ""}`
        : "Not listed in a CJRA report",
      state: cjra.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "days",
      label: "Median days to termination, civil",
      value: self?.medianDaysCivil != null ? fmtInt(self.medianDaysCivil) : null,
      unit: self?.medianDaysCivil != null ? "days" : undefined,
      meta:
        self?.medianDaysCivil != null
          ? [
              self.medianDaysN != null ? `${fmtInt(self.medianDaysN)} dockets` : null,
              scatter?.medianDays != null ? `court median ${fmtInt(scatter.medianDays)}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Case-law collection"
          : "Case-law collection",
      state: bench.isLoading && !!court ? ("loading" as const) : undefined,
    },
    {
      key: "rulings",
      label: "Expert rulings recorded",
      value: rulings.data
        ? fmtInt(rulings.data.rulings.length)
        : rulings.isLoading
          ? undefined
          : null,
      meta:
        allRow && allRow.judge.n
          ? `${fmtPct0((allRow.judge.k / allRow.judge.n) * 100)} of ${allRow.judge.n} decided granted`
          : "Rule 702 / Daubert",
      state: rulings.isLoading ? ("loading" as const) : undefined,
    },
  ];

  // Panels whose data loaded and holds nothing for this judge drop out; their reasons are listed once.
  const absent: string[] = [];
  const rulingsReady = !!rulings.data && (allRow?.judge.n ?? 0) > 0;
  if (!rulings.isLoading && !rulingsReady) absent.push("expert-admissibility rulings");
  const endingsReady = !!endings;
  if (!cross.isLoading && !endingsReady) absent.push("terminated MDLs");
  const counselReady = firms.length > 0;
  if (!cross.isLoading && !counsel.isLoading && !counselReady)
    absent.push("counsel appearances on this judge's MDL dockets");
  const pendReady = pend.length > 0;
  if (!cross.isLoading && !pendReady) absent.push("pending MDLs");
  const mapReady = mapRows.length > 1;
  const scatterReady = (scatter?.points.length ?? 0) > 1;
  if (!court || (!series.isLoading && !bench.isLoading && !mapReady && !scatterReady))
    absent.push("a CJRA bench listing for the court");

  const showRulings = rulings.isLoading || rulingsReady;
  const showEndings = cross.isLoading || (hasHistory && endingsBase.isLoading) || endingsReady;
  const showCounsel = cross.isLoading || (mdls.length > 0 && counsel.isLoading) || counselReady;
  const showPend = cross.isLoading || pendReady;
  const showMap = !!court && (series.isLoading || bench.isLoading || mapReady);
  const showScatter = !!court && (bench.isLoading || scatterReady);

  const panels: { key: string; span: 4 | 5 | 6 | 7 | 8 | 12; node: ReactNode }[] = [];

  if (showRulings)
    panels.push({
      key: "rulings",
      span: 7,
      node: (
        <ChartFrame
          title="Expert admissibility rulings"
          subtitle="Share of decided Rule 702 / Daubert challenges granted in full or in part"
          sources={[RULINGS_SOURCE]}
          status={queryStatus(
            rulings,
            rulingsReady,
            "No expert-admissibility rulings are attributed to this judge.",
          )}
          notes={[
            "Decided means granted, granted in part or denied; moot, deferred and undetermined rulings are left out.",
            "Bars are 95% Wilson intervals. Rates on fewer than 30 rulings are faded; under 3 they are not drawn.",
            "The grey dot is every other judge the dataset attributes rulings to, not a court or national rate.",
            "Recorded rulings only. They do not predict how this judge will rule on a future challenge.",
          ]}
          footnotes={
            baseline.data?.unattributed
              ? [
                  `${baseline.data.unattributed} recorded rulings are not attributed to one judge and are left out of every rate.`,
                ]
              : undefined
          }
          table={
            rulings.data
              ? {
                  caption: `Expert-admissibility rulings attributed to ${short}`,
                  columns: [
                    { label: "Group", align: "left" },
                    { label: `${judgeLabel}: granted / decided` },
                    { label: "95% interval" },
                    { label: "All other judges: granted / decided" },
                  ],
                  rows: [
                    ...ruleRows.map((r) => ({
                      key: r.id,
                      cells: [
                        r.label,
                        `${r.judge.k} / ${r.judge.n}`,
                        r.judge.ci
                          ? `${Math.round(r.judge.ci.lo * 100)}–${Math.round(r.judge.ci.hi * 100)}%`
                          : "Not recorded",
                        `${r.others.k} / ${r.others.n}`,
                      ],
                    })),
                    ...Object.entries(outcomeCounts(rulings.data.rulings)).map(([k, n]) => ({
                      key: `o-${k}`,
                      cells: [
                        `Outcome: ${OUTCOME_LABEL[k as keyof typeof OUTCOME_LABEL]}`,
                        n,
                        "",
                        "",
                      ],
                    })),
                  ],
                }
              : undefined
          }
          minHeight={170}
        >
          {rulingsReady ? (
            <>
              <ChartLegend
                mark="swatch"
                items={[
                  { id: "judge", label: `${judgeLabel}, 95% interval`, color: seriesVar(0) },
                  { id: "others", label: "All other judges", color: "var(--chart-muted-mark)" },
                ]}
              />
              <RulingDotPlot rows={ruleRows} judgeLabel={judgeLabel} />
              {rulings.data ? (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    Outcomes as recorded
                  </p>
                  <ChartLegend
                    mark="swatch"
                    items={[
                      { id: "g", label: "Granted", color: seriesVar(2) },
                      { id: "p", label: "Granted in part", color: seriesVar(4) },
                      { id: "d", label: "Denied", color: seriesVar(1) },
                      {
                        id: "o",
                        label: "Moot, deferred or not determined",
                        color: "var(--chart-other)",
                      },
                    ]}
                  />
                  <SplitBars
                    rows={[
                      {
                        id: "judge",
                        label: judgeLabel,
                        counts: outcomeCounts(rulings.data.rulings),
                        highlight: true,
                      },
                      {
                        id: "others",
                        label: "All other judges",
                        counts: outcomeCounts(
                          (baseline.data?.rulings ?? []).filter((r) => r.profile !== judgeId),
                        ),
                        highlight: false,
                      },
                    ]
                      .filter((r) => Object.values(r.counts).some((n) => n > 0))
                      .map((r) => ({
                        id: r.id,
                        label: r.label,
                        highlight: r.highlight,
                        note: `${Object.values(r.counts).reduce((a, b) => a + b, 0)} rulings`,
                        parts: [
                          { id: "g", label: "Granted", value: r.counts.granted, slot: 2 },
                          {
                            id: "p",
                            label: "Granted in part",
                            value: r.counts.granted_in_part,
                            slot: 4,
                          },
                          { id: "d", label: "Denied", value: r.counts.denied, slot: 1 },
                          {
                            id: "o",
                            label: "Moot, deferred or not determined",
                            value:
                              r.counts.denied_as_moot + r.counts.deferred + r.counts.not_determined,
                            slot: null,
                          },
                        ],
                      }))}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </ChartFrame>
      ),
    });

  if (showEndings)
    panels.push({
      key: "endings",
      span: 5,
      node: (
        <ChartFrame
          title="How MDL actions ended"
          subtitle="Actions in terminated MDLs: closed in the transferee court vs remanded"
          sources={[JPML_TERMINATED]}
          status={queryStatus(
            {
              isLoading: cross.isLoading || (hasHistory && endingsBase.isLoading),
              isError: cross.isError,
              refetch: cross.refetch,
            },
            endingsReady,
            "No terminated MDL with recorded counts is attributed to this judge.",
          )}
          notes={[
            "Each MDL's actions are those transferred in plus those filed in the transferee court; each ends closed there or remanded.",
            "District and national rows sum the JPML terminated-litigation history as printed.",
          ]}
          table={
            endings
              ? {
                  caption: "Actions closed and remanded in terminated MDLs",
                  columns: [
                    { label: "Group", align: "left" },
                    { label: "MDLs" },
                    { label: "Closed in transferee court" },
                    { label: "Remanded" },
                    { label: "Remanded share" },
                  ],
                  rows: [...endings.rows, ...endings.perMdl].map((r) => ({
                    key: r.id,
                    cells: [
                      r.label,
                      r.mdls,
                      r.closed,
                      r.remanded,
                      r.remandedPct == null ? "Not recorded" : `${r.remandedPct.toFixed(1)}%`,
                    ],
                  })),
                }
              : undefined
          }
          minHeight={170}
        >
          {endings ? (
            <div className="space-y-3">
              <ChartLegend
                mark="swatch"
                items={[
                  { id: "closed", label: "Closed in the transferee court", color: seriesVar(0) },
                  { id: "remanded", label: "Remanded", color: seriesVar(1) },
                ]}
              />
              <SplitBars
                rows={endings.rows.map((r) => ({
                  id: r.id,
                  label: r.label,
                  highlight: r.id === "judge",
                  note: `${fmtInt(r.mdls)} MDLs · ${fmtInt(r.closed + r.remanded)} actions`,
                  parts: [
                    { id: "closed", label: "Closed", value: r.closed, slot: 0 },
                    { id: "remanded", label: "Remanded", value: r.remanded, slot: 1 },
                  ],
                }))}
              />
              {endings.perMdl.length > 1 ? (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-muted-foreground">
                    By MDL ({endings.perMdl.length})
                  </summary>
                  <div className="mt-2">
                    <SplitBars
                      labelWidth="minmax(0,13rem)"
                      rows={endings.perMdl.slice(0, 12).map((r) => ({
                        id: r.id,
                        label: r.label,
                        note: `${fmtInt(r.closed + r.remanded)} actions`,
                        parts: [
                          { id: "closed", label: "Closed", value: r.closed, slot: 0 },
                          { id: "remanded", label: "Remanded", value: r.remanded, slot: 1 },
                        ],
                      }))}
                    />
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </ChartFrame>
      ),
    });

  if (showMap)
    panels.push({
      key: "map",
      span: 8,
      node: (
        <ChartFrame
          title={`Bench map: motions pending more than six months, ${courtName}`}
          subtitle="District judges of the court in each semiannual CJRA report · darker = more motions pending"
          sources={[CJRA_SOURCE]}
          status={queryStatus(
            {
              isLoading: series.isLoading || bench.isLoading,
              isError: series.isError,
              refetch: series.refetch,
            },
            mapReady,
            "The court's CJRA report lists too few judges to compare.",
          )}
          notes={[
            "Counts as the CJRA Appendix A prints them for each judge; a blank cell means the report does not list the judge.",
            "Judges sitting by designation are left out. Context for one court, not a ranking.",
          ]}
          table={
            series.data && mapReady
              ? {
                  caption: `Motions pending more than six months by judge, ${courtName}`,
                  columns: [
                    { label: "Judge", align: "left" },
                    ...series.data.periods.map((p) => ({ label: monthYear(p) })),
                  ],
                  rows: mapRows.map((r) => ({
                    key: r.id,
                    cells: [r.label, ...r.values.map((v) => (v === null ? "Not recorded" : v))],
                  })),
                }
              : undefined
          }
          minHeight={260}
        >
          {series.data && mapReady ? (
            <Heatmap
              rows={mapRows.map((r) => ({ id: r.id, label: r.self ? `▸ ${r.label}` : r.label }))}
              columns={series.data.periods.map((p) => ({ id: p, label: monthYear(p) }))}
              value={(row, col) => {
                const r = mapRows.find((x) => x.id === row);
                const i = series.data!.periods.indexOf(col);
                return r && i >= 0 ? (r.values[i] ?? null) : null;
              }}
              formatter={count}
              ariaLabel={`Motions pending more than six months by judge and CJRA report, ${courtName}`}
              cellLabels
              cellHeight={22}
            />
          ) : null}
        </ChartFrame>
      ),
    });

  if (showCounsel)
    panels.push({
      key: "counsel",
      span: 4,
      node: (
        <ChartFrame
          title="Counsel most often before this judge"
          subtitle="Appearances on the master dockets of this judge's MDLs, by side"
          sources={[COUNSEL_SOURCE]}
          status={queryStatus(
            {
              isLoading: cross.isLoading || counsel.isLoading,
              isError: counsel.isError,
              refetch: counsel.refetch,
            },
            counselReady,
            "No firm appearance records cover this judge's MDLs.",
          )}
          notes={[
            "Firm names as recorded; spellings are not merged. Side is the one recorded for the firm on each MDL.",
            counsel.data
              ? `Covers ${counsel.data.covered.length} of this judge's ${mdls.length} MDLs (the MDLs with appearance records).`
              : "Covers only the MDLs with appearance records.",
          ]}
          table={
            firms.length
              ? {
                  caption: "Firm appearances on this judge's MDL master dockets",
                  columns: [
                    { label: "Firm", align: "left" },
                    { label: "For plaintiffs" },
                    { label: "For defendants" },
                    { label: "Other" },
                    { label: "MDLs" },
                  ],
                  rows: firms.map((f) => ({
                    key: f.id,
                    cells: [f.label, f.plaintiff, f.defense, f.other, f.mdls.join(", ")],
                  })),
                }
              : undefined
          }
          actions={
            <Link
              to="/courts/firms"
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Firms →
            </Link>
          }
          minHeight={220}
        >
          {counselReady ? (
            <div className="space-y-2">
              <ChartLegend
                mark="swatch"
                items={[
                  { id: "p", label: "For plaintiffs", color: seriesVar(0) },
                  { id: "d", label: "For defendants", color: seriesVar(1) },
                ]}
              />
              <StackBars
                unit="appearances"
                rows={firms.map((f) => ({
                  id: f.id,
                  label: f.label,
                  title: `${f.label} · MDL ${f.mdls.join(", ")}`,
                  parts: [
                    { id: "p", label: "For plaintiffs", value: f.plaintiff, slot: 0 },
                    { id: "d", label: "For defendants", value: f.defense, slot: 1 },
                    { id: "o", label: "Other", value: f.other, slot: null },
                  ],
                }))}
              />
            </div>
          ) : null}
        </ChartFrame>
      ),
    });

  if (showScatter)
    panels.push({
      key: "scatter",
      span: 7,
      node: (
        <ChartFrame
          title="Where the judge sits on the bench"
          subtitle={`District judges of ${courtName} · motions pending > 6 months against median days to termination`}
          period={benchPeriod ? `CJRA report ${benchPeriod}` : undefined}
          sources={[CJRA_SOURCE, CASE_LAW]}
          status={queryStatus(
            bench,
            scatterReady,
            "Too few judges of the court have both measures.",
          )}
          notes={[
            "Each dot is one district judge of the court; the highlighted dot is this judge. Click a dot to open that profile.",
            "Median days come from the dockets in the case-law collection, not the complete caseload.",
            "Context for one court, not a ranking or a prediction.",
          ]}
          footnotes={
            scatter?.missing
              ? [
                  `${scatter.missing} of ${scatter.own} judges of the court lack one of the two measures and are not drawn.`,
                ]
              : undefined
          }
          table={
            scatter && scatterReady
              ? {
                  caption: `District judges of ${courtName}: docket-flow measures`,
                  columns: [
                    { label: "Judge", align: "left" },
                    { label: "Motions pending > 6 months" },
                    { label: "Median days to termination, civil" },
                  ],
                  rows: scatter.points.map((p) => ({ key: p.id, cells: [p.label, p.x, p.y] })),
                }
              : undefined
          }
          minHeight={240}
        >
          {scatter && scatterReady ? (
            <ScatterCorrelation
              points={scatter.points}
              xFormatter={count}
              yFormatter={count}
              xLabel="Motions pending > 6 months"
              yLabel="Median days to termination"
              ariaLabel={`District judges of ${courtName} by motions pending and median days to termination`}
              selected={selfRecord}
              showFit={false}
              height={240}
              onSelect={(id) => {
                const pid = bench.data?.judges.find((j) => j.recordId === id)?.profileId;
                if (pid && pid !== judgeId)
                  void navigate({ to: "/judges/$id", params: { id: pid } });
              }}
            />
          ) : null}
        </ChartFrame>
      ),
    });

  if (showPend)
    panels.push({
      key: "pending",
      span: 5,
      node: (
        <ChartFrame
          title="Pending MDLs before this judge"
          unit="actions pending"
          period={cross.data?.asOf ? `JPML report ${shortDate(cross.data.asOf)}` : undefined}
          sources={[JPML]}
          status={queryStatus(cross, pendReady, "No pending MDL is assigned to this judge.")}
          table={
            pendReady
              ? {
                  caption: "Pending MDLs assigned to this judge",
                  columns: [
                    { label: "MDL", align: "left" },
                    { label: "Pending" },
                    { label: "12-month change" },
                  ],
                  rows: pend.map((p) => ({
                    key: p.id,
                    cells: [p.label, p.value, p.change12m == null ? "Not recorded" : p.change12m],
                  })),
                }
              : undefined
          }
          minHeight={140}
        >
          {pendReady ? (
            <ConsoleTable
              caption="Pending MDLs assigned to this judge"
              rowKey={(p) => p.id}
              rows={pend.slice(0, 10)}
              columns={[
                {
                  key: "mdl",
                  label: "MDL",
                  render: (p) => (
                    <Link
                      to="/matters/lens/$mdl"
                      params={{ mdl: p.id }}
                      className="block max-w-[16rem] truncate font-medium text-foreground hover:text-primary hover:underline"
                      title={p.label}
                    >
                      {p.label}
                    </Link>
                  ),
                },
                {
                  key: "bar",
                  label: "",
                  className: "w-24",
                  render: (p) => <InlineBar value={p.value} max={pend[0]?.value ?? 0} />,
                },
                {
                  key: "pending",
                  label: "Pending",
                  align: "right",
                  render: (p) => fmtInt(p.value),
                },
                {
                  key: "change",
                  label: "12 mo",
                  align: "right",
                  render: (p) =>
                    p.change12m == null ? (
                      <span className="text-muted-foreground">Not recorded</span>
                    ) : (
                      `${p.change12m > 0 ? "+" : ""}${fmtInt(p.change12m)}`
                    ),
                },
              ]}
            />
          ) : null}
        </ChartFrame>
      ),
    });

  // Rebalance spans so each grid row fills: a panel left alone on its row takes the full width.
  const laid = layoutSpans(panels.map((p) => p.span));

  return (
    <section aria-labelledby="judge-console" className="space-y-3">
      <ConsoleHeading
        id="judge-console"
        eyebrow="Judge analytics"
        title="How this judge's docket compares"
        description="Recorded rulings, MDL outcomes and docket flow against the court and all judges. Context, not a prediction."
      />
      <KpiStrip label={`${short}: key figures`} items={kpis} />
      {panels.length ? (
        <ConsoleGrid>
          {panels.map((p, i) => (
            <Cell key={p.key} span={laid[i]!}>
              {p.node}
            </Cell>
          ))}
        </ConsoleGrid>
      ) : null}
      {absent.length ? (
        <p className="m-0 text-[12px] text-muted-foreground">
          Not recorded for this judge: {absent.join("; ")}.
        </p>
      ) : null}
    </section>
  );
}
