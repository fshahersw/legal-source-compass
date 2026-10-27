/**
 * Dates the court set on the docket, read verbatim ("due by", "set for", "continued to" + a date). Upcoming dates come
 * only from orders and clerk settings (dates printed in party filings stay under View data) and are
 * relative to today and always say when they were docketed: later changes after the collected text are not known.
 * Nothing is projected forward.
 */
import { Card, CardBody, DataDrawer, KpiStrip, type DataColumn } from "@/components/kit";
import {
  PRINTED_IN_FILING,
  SET_BY_COURT,
  docketedNote,
  isCourtSet,
  upcomingDates,
} from "@/lib/matters/docketDates";
import type { DocketDateRow, MdlCommandPayload } from "@/lib/matters/types";
import { EntryLink, Note, collectedNote, day, docketSource, fmt } from "./shared";

const columns: DataColumn<DocketDateRow>[] = [
  { key: "date", label: "Date set", value: (r) => r.date },
  { key: "time", label: "Time", value: (r) => r.time },
  { key: "label", label: "Event as printed", value: (r) => r.label },
  { key: "phrase", label: "Phrase", value: (r) => r.phrase },
  { key: "vacated", label: "Vacated", value: (r) => (r.vacated ? "Vacated (as printed)" : "") },
  { key: "docketed", label: "Docketed on", value: (r) => r.entryDate },
  {
    key: "printedIn",
    label: "Printed in",
    value: (r) => (isCourtSet(r) ? SET_BY_COURT : PRINTED_IN_FILING),
  },
  { key: "snippet", label: "Docket text", value: (r) => r.snippet },
  {
    key: "entry",
    label: "Entry",
    align: "right",
    value: (r) => r.entryNumber,
    render: (r) => <EntryLink n={r.entryNumber} href={r.sourceUrl} />,
  },
];

export function DocketedDatesSection({ cmd }: { cmd: MdlCommandPayload }) {
  if (!cmd.dates || !cmd.datesSummary)
    return (
      <p className="text-body text-muted-foreground">
        {cmd.errors.includes("dates")
          ? "The docket dates could not be read just now."
          : "No master-docket text is collected for this MDL."}
      </p>
    );
  const s = cmd.datesSummary;
  const ahead = upcomingDates(cmd.dates.rows, cmd.asOf);
  const docket = docketSource(cmd);
  const rows = [...cmd.dates.rows].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="space-y-4">
      <KpiStrip
        label="Docketed dates"
        cellBasis="basis-[calc(50%-1px)] xl:basis-[calc(25%-1px)]"
        items={[
          { key: "total", label: "Dates read from the docket", value: fmt(s.total) },
          {
            key: "ahead",
            label: `Still ahead of ${day(cmd.asOf)}`,
            value: fmt(s.ahead),
            meta: "Set by the court, not vacated",
          },
          { key: "vacated", label: "Docketed as vacated", value: fmt(s.vacated) },
          {
            key: "latest",
            label: "Latest date set",
            value: s.latest ? day(s.latest.date) : null,
            meta: s.latest ? (s.latest.label ?? "Event not named") : undefined,
          },
        ]}
      />
      <Card>
        <CardBody className="pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-label text-foreground">Upcoming, as docketed</h3>
            <DataDrawer
              title={`MDL ${cmd.mdl}: dates set on the docket`}
              rows={rows}
              rowKey={(r, i) => `${r.entryId}-${r.date}-${i}`}
              columns={columns}
              searchable
              source={{
                source: { label: docket.label, href: docket.url },
                about: <p>{collectedNote(s.collectedThrough)}</p>,
              }}
            />
          </div>
          {ahead.length ? (
            <ul className="mt-2 space-y-2 text-body">
              {ahead.slice(0, 8).map((d, i) => (
                <li key={`${d.entryId}-${d.date}-${i}`}>
                  <span className="font-medium tabular-nums">
                    {day(d.date)}
                    {d.time ? `, ${d.time}` : ""}
                  </span>{" "}
                  · {d.label ?? "Event not named in the entry"}
                  <span className="block text-meta text-muted-foreground">
                    <EntryLink n={d.entryNumber} href={d.sourceUrl} />,{" "}
                    {docketedNote(d.entryDate, s.collectedThrough)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-body text-muted-foreground">
              No date ahead of {day(cmd.asOf)} in the collected docket text.
            </p>
          )}
          {ahead.length > 8 ? <Note>{fmt(ahead.length - 8)} more under View data.</Note> : null}
          {s.aheadInFilings > 0 ? (
            <Note>
              {fmt(s.aheadInFilings)} more{" "}
              {s.aheadInFilings === 1 ? "date ahead is" : "dates ahead are"} printed only in party
              filings (for example a hearing the movant noticed); they are under View data, marked
              &ldquo;{PRINTED_IN_FILING}&rdquo;.
            </Note>
          ) : null}
          <Note>{collectedNote(s.collectedThrough)}</Note>
        </CardBody>
      </Card>
    </div>
  );
}
