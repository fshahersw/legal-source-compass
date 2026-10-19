import { useQuery } from "@tanstack/react-query";
import { chartFrom, yearSpan } from "./clbRestFormat";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import {
  APPELLATE_COURT_ID,
  getClbAppellateCourt,
  type AppellatePanels,
  type AppellateTiming,
  type TimingInterval,
} from "@/lib/external/clbAppellate.functions";
import { ChartFrame, CollapsibleSection, ShareBars } from "./ClbParts";
import { YearBarLine } from "./ClbRestCharts";
import {
  CourtName,
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
  PersonName,
} from "./ClbRestParts";
import { fmtDec, fmtInt, fmtPct, NOT_RECORDED } from "./clbFormat";

const ORIGIN_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/originating-court-information-2026-09-30.csv.bz2";
const PANEL_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/search_opinioncluster_panel-2026-09-30.csv.bz2";

const days = (n: number | null) => (n == null ? NOT_RECORDED : `${fmtInt(Math.round(n))} days`);

/**
 * Appeal timing from originating-court information and the panels recorded on opinion clusters (datasets clb_appellate_timing
 * and clb_appellate_panels). Renders nothing for a court with neither record.
 */
export function AppellatePanel({ courtId }: { courtId: string }) {
  const enabled = APPELLATE_COURT_ID.test(courtId);
  const q = useQuery({
    queryKey: ["clb-appellate", courtId],
    queryFn: () => getClbAppellateCourt({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading appeal timing and panels" height="h-32" />;
  if (q.isError)
    return (
      <PanelError
        text="Appeal timing and panels could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  const t = q.data?.timing ?? null;
  const p = q.data?.panels ?? null;
  if (!t && !p) return null;
  return (
    <PanelShell
      title={
        t && p
          ? "Appeals: timing, lower courts and panels"
          : t
            ? "Appeals: timing and lower courts"
            : "Recorded panels"
      }
      subtitle={
        <>
          {t && p
            ? "CourtListener originating-court information and cluster panels"
            : t
              ? "CourtListener originating-court information on appellate dockets"
              : "Judges CourtListener lists on the court's opinion clusters"}{" "}
          · counts of the collection, not complete caseloads
        </>
      }
      aside={
        <>
          {t ? <SourceLink href={ORIGIN_URL}>Originating-court file</SourceLink> : null}
          {p ? <SourceLink href={PANEL_URL}>Panel file</SourceLink> : null}
        </>
      }
    >
      {t ? <Timing t={t} /> : null}
      {p ? <Panels p={p} /> : null}
      {t && !p ? (
        <p className="border-t border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
          Recorded panels: {NOT_RECORDED} (fewer than 50 of this court&apos;s opinion clusters list
          a panel).
        </p>
      ) : null}
      <div className="px-3 pb-3">
        <HowToRead
          measures={[
            {
              term: "Appeals with lower-court information",
              means:
                "Appellate dockets whose originating-court information row CourtListener holds.",
              caveat: "Mostly RECAP appellate dockets; coverage varies by court and year.",
            },
            {
              term: "Intervals",
              means:
                "Days between two recorded dates of the same appeal, used only when both are recorded and the later is not before the earlier.",
            },
            {
              term: "Recorded panel",
              means:
                "The judges CourtListener lists on an opinion cluster (person ids), counted per cluster.",
              caveat: "Most clusters list no panel; a missing panel says nothing about who sat.",
            },
          ]}
        />
      </div>
    </PanelShell>
  );
}

function Timing({ t }: { t: AppellateTiming }) {
  const iv = new Map(t.intervals.map((i) => [i.key, i]));
  const notice = iv.get("judgment_to_noa");
  const received = iv.get("noa_to_received");
  const app = iv.get("app_filed_to_term");
  const from = chartFrom(t.byYear, (y) => y.appeals);
  const rows = from.rows.map((y) => ({ label: String(y.yr), bar: y.appeals, line: y.medianDays }));
  return (
    <>
      <h3 className="px-3 pb-1 text-xs font-semibold">Appeals with lower-court information</h3>
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi
          label="Appeals with lower-court information"
          value={fmtInt(t.appeals)}
          note={
            t.appealsPctOfDockets != null
              ? `${fmtPct(t.appealsPctOfDockets)} of the court's dockets`
              : undefined
          }
        />
        <Kpi
          label="Judgment to notice of appeal"
          value={days(notice?.p50 ?? null)}
          note={notice ? `median · n = ${fmtInt(notice.n)}` : undefined}
        />
        <Kpi
          label="Notice to receipt by this court"
          value={days(received?.p50 ?? null)}
          note={received ? `median · n = ${fmtInt(received.n)}` : undefined}
        />
        <Kpi
          label="Opened to terminated here"
          value={days(app?.p50 ?? null)}
          note={app ? `median · n = ${fmtInt(app.n)}` : undefined}
        />
      </div>
      <CollapsibleSection
        title="Appeal timing"
        summary={`${t.intervals.filter((i) => i.p50 != null).length} intervals`}
        defaultOpen
      >
        <MiniTable<TimingInterval>
          caption="Days between recorded dates"
          rows={t.intervals}
          rowKey={(i) => i.key}
          columns={[
            { key: "l", label: "Interval", render: (i) => i.label },
            { key: "n", label: "Appeals", numeric: true, render: (i) => fmtInt(i.n) },
            {
              key: "m",
              label: "Median",
              numeric: true,
              render: (i) => (i.p50 == null ? NOT_RECORDED : fmtDec(i.p50, 0)),
            },
            {
              key: "q",
              label: "Middle half",
              numeric: true,
              render: (i) =>
                i.p25 == null || i.p75 == null
                  ? NOT_RECORDED
                  : `${fmtDec(i.p25, 0)}–${fmtDec(i.p75, 0)}`,
            },
            {
              key: "x",
              label: "Set aside",
              numeric: true,
              render: (i) => fmtInt(i.negativeSetAside),
            },
          ]}
          note="Quartiles are shown when at least 30 appeals have both dates. Set aside: appeals whose two dates are in reverse order."
        />
        {rows.length > 1 ? (
          <div className="mt-3">
            <ChartFrame
              caption="Appeals by year opened, with the median days to termination"
              label={`Bar chart of appeals with lower-court information at ${t.name} by year opened, with a line for the median days from opening to termination.`}
              footnote={`Medians need 30 appeals with both dates; recent years hold more open appeals.${from.earlier ? ` ${fmtInt(from.earlier)} appeals opened before ${rows[0]!.label} are not plotted (those years hold under 2% of the busiest year's appeals).` : ""}`}
            >
              <YearBarLine
                rows={rows}
                barName="Appeals opened"
                lineName="Median days to termination"
                lineUnit="days"
              />
            </ChartFrame>
          </div>
        ) : null}
      </CollapsibleSection>
      {t.fromCourts.length ? (
        <CollapsibleSection
          title="Lower courts"
          summary={t.fromCourts
            .slice(0, 2)
            .map((f) => f.name)
            .join(" · ")}
        >
          <ShareBars
            heading="Appeals by the court appealed from"
            note="Shares of the appeals whose lower court is recorded."
            rows={t.fromCourts.map((f) => ({
              key: f.courtId,
              label:
                f.medianDays != null
                  ? `${f.name} · median ${fmtInt(Math.round(f.medianDays))} days`
                  : f.name,
              count: f.appeals,
              sharePct: f.sharePct,
              courtId: f.link === `/courts/${f.courtId}` ? f.courtId : undefined,
            }))}
          />
        </CollapsibleSection>
      ) : null}
      {t.lowerJudges.length ? (
        <CollapsibleSection
          title="Lower-court judges"
          summary={
            t.lowerJudgeIdPct != null
              ? `recorded as a person for ${fmtPct(t.lowerJudgeIdPct)} of appeals`
              : undefined
          }
        >
          <MiniTable
            caption="Lower-court judges whose cases were appealed here most"
            rows={t.lowerJudges}
            rowKey={(j) => String(j.personId)}
            columns={[
              {
                key: "n",
                label: "Judge",
                render: (j) => (
                  <PersonName name={j.name} personId={j.personId} statsRecord={j.statsRecord} />
                ),
              },
              { key: "a", label: "Appeals", numeric: true, render: (j) => fmtInt(j.appeals) },
              { key: "c", label: "Mostly from", render: (j) => j.mainFrom ?? NOT_RECORDED },
              {
                key: "y",
                label: "Opened",
                render: (j) => yearSpan(j.firstFiled, j.lastFiled) ?? NOT_RECORDED,
              },
            ]}
            note="The lower-court judge is the person id recorded in the originating-court information; names recorded without an id are not listed."
          />
        </CollapsibleSection>
      ) : null}
    </>
  );
}

function Panels({ p }: { p: AppellatePanels }) {
  const from = chartFrom(p.byYear, (y) => y.clusters);
  const rows = from.rows.map((y) => ({ label: String(y.yr), bar: y.clusters, line: y.medianSize }));
  return (
    <>
      <h3 className="border-t border-border/70 px-3 pb-1 pt-2 text-xs font-semibold">
        Recorded panels on opinion clusters
      </h3>
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi
          label="Opinion clusters with a recorded panel"
          value={fmtInt(p.clustersWithPanel)}
          note={
            p.panelPctOfClusters != null
              ? `${fmtPct(p.panelPctOfClusters)} of the court's clusters`
              : undefined
          }
        />
        <Kpi
          label="Median panel size"
          value={p.medianSize == null ? NOT_RECORDED : fmtDec(p.medianSize, 0)}
          note="judges listed per cluster"
        />
        <Kpi
          label="Judges on recorded panels"
          value={fmtInt(p.judgesCount)}
          note={
            yearSpan(p.firstFiled, p.lastFiled)
              ? `clusters filed ${yearSpan(p.firstFiled, p.lastFiled)}`
              : undefined
          }
        />
        <Kpi
          label="Pairs who sat together"
          value={fmtInt(p.pairsCount)}
          note="distinct pairs of judges"
        />
      </div>
      <CollapsibleSection
        title="Panel members"
        summary={p.judges
          .slice(0, 2)
          .map((j) => j.name)
          .join(" · ")}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <MiniTable
            caption="Judges on the most recorded panels"
            rows={p.judges}
            rowKey={(j) => String(j.personId)}
            columns={[
              {
                key: "n",
                label: "Judge",
                render: (j) => (
                  <PersonName name={j.name} personId={j.personId} statsRecord={j.statsRecord} />
                ),
              },
              { key: "p", label: "Panels", numeric: true, render: (j) => fmtInt(j.panels) },
              { key: "s", label: "Share", numeric: true, render: (j) => fmtPct(j.sharePct) },
              {
                key: "y",
                label: "Years",
                render: (j) => yearSpan(j.firstFiled, j.lastFiled) ?? NOT_RECORDED,
              },
            ]}
          />
          <MiniTable
            caption="Pairs who sat together most often"
            rows={p.pairs}
            rowKey={(x) => `${x.a.personId}-${x.b.personId}`}
            columns={[
              {
                key: "a",
                label: "Pair",
                render: (x) => (
                  <>
                    <PersonName
                      name={x.a.name}
                      personId={x.a.personId}
                      statsRecord={x.a.statsRecord}
                    />{" "}
                    and{" "}
                    <PersonName
                      name={x.b.name}
                      personId={x.b.personId}
                      statsRecord={x.b.statsRecord}
                    />
                  </>
                ),
              },
              { key: "p", label: "Panels", numeric: true, render: (x) => fmtInt(x.panels) },
              {
                key: "y",
                label: "Years",
                render: (x) => yearSpan(x.firstFiled, x.lastFiled) ?? NOT_RECORDED,
              },
            ]}
          />
        </div>
      </CollapsibleSection>
      {p.sizes.length || rows.length > 1 ? (
        <CollapsibleSection
          title="Panel sizes over time"
          summary={p.sizes
            .slice(0, 3)
            .map((s) => `${s.size}: ${fmtPct(s.sharePct)}`)
            .join(" · ")}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <ShareBars
              heading="Clusters by number of judges listed"
              note="Shares of the clusters with a recorded panel."
              rows={p.sizes.map((s) => ({
                key: String(s.size),
                label: `${s.size} judge${s.size === 1 ? "" : "s"}`,
                count: s.clusters,
                sharePct: s.sharePct,
              }))}
              whole={p.clustersWithPanel}
            />
            {rows.length > 1 ? (
              <ChartFrame
                caption="Clusters with a recorded panel by year filed, with the median panel size"
                label={`Bar chart of ${p.name} opinion clusters with a recorded panel by year filed, with a line for the median number of judges listed.`}
                footnote={
                  from.earlier
                    ? `${fmtInt(from.earlier)} clusters filed before ${rows[0]!.label} are not plotted (those years hold under 2% of the busiest year's clusters).`
                    : undefined
                }
              >
                <YearBarLine
                  rows={rows}
                  barName="Clusters with a panel"
                  lineName="Median panel size"
                  lineUnit="judges"
                />
              </ChartFrame>
            ) : null}
          </div>
        </CollapsibleSection>
      ) : null}
    </>
  );
}
