import { useQuery } from "@tanstack/react-query";
import { chartFrom, yearSpan } from "./clbRestFormat";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import {
  BK_COURT_ID,
  getClbBankruptcyCourt,
  type BankruptcyProfile,
  type BkJudge,
} from "@/lib/external/clbBankruptcy.functions";
import { ChartFrame, CollapsibleSection, ShareBars } from "./ClbParts";
import { YearBarLine } from "./ClbRestCharts";
import { MiniTable, PanelError, PanelLoading, PanelShell, PersonName } from "./ClbRestParts";
import { fmtDec, fmtInt, fmtPct, NOT_RECORDED } from "./clbFormat";

const FILE_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/randoms/bankruptcy-dockets-2022-09-19.csv.bz2";

/**
 * Bankruptcy-court activity in CourtListener's bankruptcy-dockets bulk file (dataset clb_bankruptcy_courts). Renders nothing for
 * a court without a record (every court that is not a federal bankruptcy court).
 */
export function BankruptcyActivityPanel({ courtId }: { courtId: string }) {
  const enabled = BK_COURT_ID.test(courtId);
  const q = useQuery({
    queryKey: ["clb-bankruptcy", courtId],
    queryFn: () => getClbBankruptcyCourt({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading bankruptcy docket statistics" />;
  if (q.isError)
    return (
      <PanelError
        text="Bankruptcy docket statistics could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return null;
  return <Body p={q.data} />;
}

function Body({ p }: { p: BankruptcyProfile }) {
  const ap = p.caseTypes.find((t) => t.code === "ap");
  // The chart starts at the first year holding at least 2% of the busiest year's dockets: a handful of very old dockets
  // (often terminated decades later) would otherwise set the median axis. Earlier years are counted in the footnote.
  const from = chartFrom(p.byYear, (y) => y.dockets);
  const earlier = from.earlier + (p.beforeSeries ?? 0);
  const rows = from.rows.map((y) => ({ label: String(y.yr), bar: y.dockets, line: y.medianDays }));
  const partial = p.byYear.some((y) => y.yr === Number(p.fileDate.slice(0, 4)));
  return (
    <PanelShell
      title="Bankruptcy dockets"
      subtitle={
        <>
          CourtListener bankruptcy-dockets file dated {p.fileDate} · not a complete count of filings
        </>
      }
      record={{ dataset: "clb_bankruptcy_courts", id: p.courtId }}
      aside={<SourceLink href={FILE_URL}>Bulk file</SourceLink>}
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi
          label="Dockets in the file"
          value={fmtInt(p.dockets)}
          note={
            yearSpan(p.firstFiled, p.lastFiled)
              ? `filed ${yearSpan(p.firstFiled, p.lastFiled)}`
              : undefined
          }
        />
        <Kpi
          label="With a termination date"
          value={fmtPct(p.terminatedPct)}
          note={p.terminated != null ? `${fmtInt(p.terminated)} dockets` : undefined}
        />
        <Kpi
          label="Median days to termination"
          value={p.duration ? fmtInt(Math.round(p.duration.p50)) : NOT_RECORDED}
          note={
            p.duration
              ? `middle half ${fmtInt(Math.round(p.duration.p25))}–${fmtInt(Math.round(p.duration.p75))} · n = ${fmtInt(p.duration.n)}`
              : "fewer than 30 dockets with both dates"
          }
        />
        <Kpi
          label="Adversary proceedings"
          value={ap ? fmtPct(ap.sharePct) : NOT_RECORDED}
          note={
            ap
              ? `${fmtInt(ap.dockets)} with the ap code in the number`
              : "no ap code in the docket numbers"
          }
        />
      </div>
      <p className="px-3 pb-2 text-[11px] leading-4 text-muted-foreground">
        Chapter, assets and liabilities: {NOT_RECORDED} (the file has no such columns).{" "}
        {fmtPct(p.blockedPct)} of these dockets are flagged by CourtListener as blocked from search
        engines; no debtor names are shown.
        {p.inDocketFilePct != null
          ? ` ${fmtPct(p.inDocketFilePct)} of them are also in the 2026-09-30 docket file.`
          : ""}
      </p>
      {rows.length ? (
        <CollapsibleSection
          title="Filings by year"
          summary={`${rows.length} years, ${rows[0]!.label}–${rows[rows.length - 1]!.label}`}
          defaultOpen
        >
          <ChartFrame
            caption="Dockets by filing year, with the median days to termination"
            label={`Bar chart of ${p.name} dockets in the file by filing year from ${rows[0]!.label} to ${rows[rows.length - 1]!.label}, with a line for the median days from filing to termination.`}
            footnote={
              <>
                Medians need 30 dockets with both dates; recent years have more open cases, so their
                medians are lower.
                {partial ? ` ${p.fileDate.slice(0, 4)} runs only to ${p.fileDate}.` : ""}
                {earlier
                  ? ` ${fmtInt(earlier)} dockets filed before ${rows[0]!.label} are not plotted (those years hold under 2% of the busiest year's dockets).`
                  : ""}
                {p.undated ? ` ${fmtInt(p.undated)} have no usable filing date.` : ""}
              </>
            }
          >
            <YearBarLine
              rows={rows}
              barName="Dockets filed"
              lineName="Median days to termination"
              lineUnit="days"
            />
          </ChartFrame>
        </CollapsibleSection>
      ) : null}
      {p.caseTypes.length ? (
        <CollapsibleSection
          title="Case type in the docket number"
          summary={p.caseTypes
            .slice(0, 2)
            .map((t) => `${t.code} ${fmtPct(t.sharePct)}`)
            .join(" · ")}
        >
          <ShareBars
            heading="Dockets by the PACER case-type code inside the docket number"
            note={
              <>
                Shares of all {fmtInt(p.dockets)} dockets; bk bankruptcy case, ap adversary
                proceeding, mp miscellaneous proceeding (PACER release notes). A number without the
                code is counted as none.
              </>
            }
            rows={p.caseTypes.map((t) => ({
              key: t.code,
              label:
                t.medianDays != null
                  ? `${t.label} · median ${fmtInt(Math.round(t.medianDays))} days`
                  : t.label,
              count: t.dockets,
              sharePct: t.sharePct,
            }))}
            whole={p.dockets}
          />
        </CollapsibleSection>
      ) : null}
      <CollapsibleSection
        title="Judges"
        summary={
          p.judgesWithId != null
            ? `${fmtInt(p.judgesWithId)} people recorded by id · ${fmtPct(p.withJudgeIdPct)} of dockets`
            : undefined
        }
      >
        {p.judges.length ? (
          <MiniTable<BkJudge>
            caption="Assigned judges with the most dockets in the file"
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
              { key: "d", label: "Dockets", numeric: true, render: (j) => fmtInt(j.dockets) },
              { key: "s", label: "Share", numeric: true, render: (j) => fmtPct(j.sharePct) },
              {
                key: "y",
                label: "Filed",
                render: (j) => yearSpan(j.firstFiled, j.lastFiled) ?? NOT_RECORDED,
              },
              {
                key: "m",
                label: "Median days",
                numeric: true,
                render: (j) => (j.medianDays == null ? NOT_RECORDED : fmtDec(j.medianDays, 0)),
              },
            ]}
            note="Judges are the assigned person ids recorded on the dockets; a name links only to that exact person's record."
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            No docket in the file records the assigned judge as a person id.
          </p>
        )}
        {p.judgeNameOnly ? (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            {fmtInt(p.judgeNameOnly)} dockets record a judge by name only (not linked)
            {p.judgeNamesWithoutId.length
              ? `, most often: ${p.judgeNamesWithoutId.map((x) => `${x.name} (${fmtInt(x.dockets)})`).join("; ")}`
              : ""}
            .
          </p>
        ) : null}
      </CollapsibleSection>
      <div className="px-3 pb-3">
        <HowToRead
          measures={[
            {
              term: "Dockets in the file",
              means:
                "Rows of CourtListener's bankruptcy-dockets export for this court, one per docket id.",
              caveat:
                "CourtListener's collection, mostly created in 2020–2021 from PACER case lists; not every filing.",
            },
            {
              term: "Days to termination",
              means:
                "Termination date minus filing date, for dockets with both dates and the termination on or after filing.",
            },
            {
              term: "Case type",
              means: "The two letters inside a PACER docket number (office:yy-tt-nnnnn).",
            },
          ]}
        />
      </div>
    </PanelShell>
  );
}
