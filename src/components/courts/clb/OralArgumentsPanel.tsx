import { useQuery } from "@tanstack/react-query";
import { yearSpan } from "./clbRestFormat";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import {
  getClbOralArguments,
  ORAL_COURT_ID,
  type OralName,
  type OralProfile,
} from "@/lib/external/clbOralArguments.functions";
import { ChartFrame, CollapsibleSection } from "./ClbParts";
import { YearBarLine } from "./ClbRestCharts";
import { MiniTable, PanelError, PanelLoading, PanelShell } from "./ClbRestParts";
import { fmtDec, fmtInt, fmtPct, NOT_RECORDED } from "./clbFormat";

const FILE_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/oral-arguments-2026-09-30.csv.bz2";

/** Oral-argument recordings of a court in CourtListener (dataset clb_oral_arguments). Renders nothing for a court without recordings. */
export function OralArgumentsPanel({ courtId }: { courtId: string }) {
  const enabled = ORAL_COURT_ID.test(courtId);
  const q = useQuery({
    queryKey: ["clb-oral", courtId],
    queryFn: () => getClbOralArguments({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading oral-argument recordings" height="h-32" />;
  if (q.isError)
    return (
      <PanelError
        text="Oral-argument recordings could not be loaded."
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return null;
  return <Body o={q.data} />;
}

function Body({ o }: { o: OralProfile }) {
  const rows = o.byYear.map((y) => ({
    label: String(y.yr),
    bar: y.recordings,
    line: y.medianMinutes,
  }));
  const span = yearSpan(o.firstArgued, o.lastArgued);
  return (
    <PanelShell
      title="Oral arguments"
      subtitle={
        <>
          Recordings in CourtListener, by the docket's argument date · bulk data from Free Law
 Project
        </>
      }
      record={{ dataset: "clb_oral_arguments", id: o.courtId }}
      aside={<SourceLink href={FILE_URL}>Bulk file</SourceLink>}
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi
          label="Recordings"
          value={fmtInt(o.recordings)}
          note={span ? `argued ${span}` : undefined}
        />
        <Kpi
          label="Recorded hours"
          value={o.totalHours == null ? NOT_RECORDED : fmtInt(Math.round(o.totalHours))}
          note={o.dockets != null ? `${fmtInt(o.dockets)} dockets` : undefined}
        />
        <Kpi
          label="Median length"
          value={o.minutes ? `${fmtDec(o.minutes.p50, 0)} min` : NOT_RECORDED}
          note={
            o.minutes
              ? `middle half ${fmtDec(o.minutes.p25, 0)}–${fmtDec(o.minutes.p75, 0)} min`
              : undefined
          }
        />
        <Kpi
          label="With a machine transcript"
          value={fmtPct(o.transcriptPct)}
          note={o.withTranscript != null ? `${fmtInt(o.withTranscript)} recordings` : undefined}
        />
      </div>
      {rows.length ? (
        <CollapsibleSection title="By year argued" summary={`${rows.length} years`} defaultOpen>
          <ChartFrame
            caption="Recordings by year argued, with the median length"
            label={`Bar chart of ${o.name} oral-argument recordings by year argued from ${rows[0]!.label} to ${rows[rows.length - 1]!.label}, with a line for the median length in minutes.`}
            footnote={`Medians need 10 recordings with a length.${rows[rows.length - 1]!.label === "2026" ? " 2026 runs only to the snapshot date, Sept 30." : ""}`}
          >
            <YearBarLine rows={rows} barName="Recordings" lineName="Median length" lineUnit="min" />
          </ChartFrame>
        </CollapsibleSection>
      ) : null}
      {o.names.length ? (
        <CollapsibleSection
          title="Judges named in the recordings"
          summary={`${fmtPct(o.judgesTextPct)} of recordings name the panel`}
        >
          <MiniTable<OralName>
            caption="Names in the recordings' judges text, most frequent first"
            rows={o.names}
            rowKey={(n) => n.name}
            columns={[
              { key: "n", label: "Name as written", render: (n) => n.name },
              { key: "r", label: "Recordings", numeric: true, render: (n) => fmtInt(n.recordings) },
              {
                key: "m",
                label: "Median min",
                numeric: true,
                render: (n) =>
                  n.medianMinutes == null ? NOT_RECORDED : fmtDec(n.medianMinutes, 0),
              },
              {
                key: "y",
                label: "Years",
                render: (n) => yearSpan(n.firstYear, n.lastYear) ?? NOT_RECORDED,
              },
            ]}
            note="Names are counted as the recordings write them (usually surnames) and are not linked to a judge profile: the same surname can belong to more than one judge."
          />
        </CollapsibleSection>
      ) : null}
      <div className="px-3 pb-3">
        <HowToRead
          measures={[
            {
              term: "Recording",
              means:
                "One audio file CourtListener collected from the court's website; a docket can have several.",
            },
            {
              term: "Length",
              means: "The file's duration; it can include time before and after the argument.",
            },
            {
              term: "Year argued",
              means: "The docket's date argued.",
              caveat: "Courts appear only for the years CourtListener has gathered their audio.",
            },
          ]}
        />
      </div>
    </PanelShell>
  );
}
