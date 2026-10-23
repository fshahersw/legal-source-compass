import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import { ChartFrame } from "@/components/courts/clb/ClbParts";
import { YearBarLine } from "@/components/courts/clb/ClbRestCharts";
import { MiniTable, type Column } from "@/components/courts/clb/ClbRestParts";
import type { VacanciesOverview, Vacancy, VacancyMonth } from "@/lib/external/judiciary.functions";
import { vacancyColumns } from "./vacancyColumns";
import { aoName, courtLabel, fmtDay, fmtN, NR } from "./judiciaryFormat";
import { vacanciesOverviewQuery } from "./judiciaryQueries";

const CURRENT = "https://www.uscourts.gov/data-news/judicial-vacancies/current-judicial-vacancies";
const ARCHIVE = "https://www.uscourts.gov/data-news/judicial-vacancies/archive-judicial-vacancies";

const MEASURES = [
  {
    term: "Open vacancy",
    means: "A judgeship on the AO's current vacancy list of October 22, 2026.",
  },
  {
    term: "Announced",
    means:
      "A future vacancy: a judge has notified the intended date of senior status, retirement or elevation.",
  },
  {
    term: "Judicial emergency",
    means:
      "A vacancy the AO lists as an emergency, by its published criteria of weighted filings per judgeship and time vacant.",
  },
  {
    term: "Nominee",
    means: "The nominee printed on the current list for that vacancy.",
    caveat: "A nomination returned or withdrawn earlier is history and is not shown as pending.",
  },
  {
    term: "Days vacant",
    means: "October 22, 2026 minus the published vacancy date.",
  },
];

export function VacanciesPage() {
  const q = useQuery(vacanciesOverviewQuery);
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading judicial vacancies">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border bg-muted/50"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-md border border-border bg-muted/50" />
      </div>
    );
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Retry
          </button>
        }
      >
        Judicial vacancies could not be loaded.
      </StateNote>
    );
  if (!q.data) return <StateNote>No judicial vacancy data is available yet.</StateNote>;
  return <Body d={q.data} />;
}

function yearly(series: readonly VacancyMonth[]) {
  const by = new Map<string, number[]>();
  for (const m of series) {
    if (!m.parsed || m.vacanciesListed == null) continue;
    const y = m.month.slice(0, 4);
    by.set(y, [...(by.get(y) ?? []), m.vacanciesListed]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([y, v]) => ({
      label: y,
      bar: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
      months: v.length,
    }));
}

function Body({ d }: { d: VacanciesOverview }) {
  const years = yearly(d.series);
  const rows = years.map(({ label, bar }) => ({ label, bar }));
  const sparse = years.filter((y) => y.months < 4).map((y) => y.label);
  const missingYears = rows.length
    ? Number(rows.at(-1)!.label) - Number(rows[0]!.label) + 1 - rows.length
    : 0;
  const confCols: Column<Vacancy>[] = [
    {
      key: "court",
      label: "Court",
      render: (r) =>
        r.courtId ? (
          <Link
            to="/courts/$id"
            params={{ id: r.courtId }}
            className="text-primary hover:underline"
          >
            {courtLabel(r)}
          </Link>
        ) : (
          courtLabel(r)
        ),
    },
    {
      key: "who",
      label: "Vacancy created by",
      render: (r) =>
        r.incumbentJudgeId ? (
          <Link
            to="/judges/$id"
            params={{ id: r.incumbentJudgeId }}
            className="text-primary hover:underline"
          >
            {aoName(r.incumbent)}
          </Link>
        ) : (
          aoName(r.incumbent)
        ),
    },
    { key: "vdate", label: "Vacancy date", render: (r) => fmtDay(r.vacancyDate) },
    {
      key: "nominee",
      label: "Confirmed",
      render: (r) =>
        r.confirmation?.judgeId ? (
          <Link
            to="/judges/$id"
            params={{ id: r.confirmation.judgeId }}
            className="text-primary hover:underline"
          >
            {aoName(r.confirmation.nominee)}
          </Link>
        ) : (
          aoName(r.confirmation?.nominee ?? null)
        ),
    },
    { key: "cdate", label: "Confirmation date", render: (r) => fmtDay(r.confirmation?.date) },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Open vacancies" value={fmtN(d.open.length)} note="current list, Oct 22, 2026" />
        <Kpi label="Announced future vacancies" value={fmtN(d.announced.length)} />
        <Kpi label="Judicial emergencies" value={fmtN(d.emergencies.length)} />
        <Kpi
          label="Open with a nominee pending"
          value={fmtN(d.open.filter((v) => v.pendingNominee).length)}
          note={`of ${fmtN(d.open.length)} open`}
        />
      </div>
      <Panel
        title="Current vacancies"
        subtitle="Article III and territorial judgeships on the AO's current vacancy list"
        actions={<SourceLink href={CURRENT}>uscourts.gov</SourceLink>}
      >
        <div className="p-3">
          {d.open.length ? (
            <MiniTable
              caption="Open vacancies (days vacant as of Oct 22, 2026)"
              rows={d.open}
              rowKey={(r) => r.id ?? `${r.courtId}-${r.incumbent}-${r.vacancyDate}`}
              columns={vacancyColumns({ court: true })}
              limit={40}
              noun="vacancies"
            />
          ) : (
            <p className="text-xs text-muted-foreground">No open vacancy is listed.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Future vacancies"
        subtitle="Vacancies announced by the sitting judge; a date to be determined is shown as such"
      >
        <div className="p-3">
          {d.announced.length ? (
            <MiniTable
              caption="Announced future vacancies"
              rows={d.announced}
              rowKey={(r) => r.id ?? `${r.courtId}-${r.incumbent}`}
              columns={vacancyColumns({ court: true }).filter((c) => c.key !== "open")}
              limit={40}
              noun="vacancies"
            />
          ) : (
            <p className="text-xs text-muted-foreground">No future vacancy is listed.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Judicial emergencies"
        subtitle="Days pending and weighted filings per judgeship as published on the emergency list"
      >
        <div className="p-3">
          {d.emergencies.length ? (
            <MiniTable
              caption="Vacancies listed as judicial emergencies"
              rows={d.emergencies}
              rowKey={(r) => r.id ?? `${r.courtId}-${r.incumbent}`}
              columns={vacancyColumns({ court: true, emergency: true })}
              limit={40}
              noun="emergencies"
            />
          ) : (
            <p className="text-xs text-muted-foreground">No judicial emergency is listed.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="History"
        subtitle="Vacancies on the monthly lists, 1981–2026, and the most recent confirmations listed"
        actions={<SourceLink href={ARCHIVE}>Archive</SourceLink>}
        footnote={`${fmtN(d.coverage.parsed)} monthly reports parsed; ${fmtN(d.coverage.notParsed)} not parsed (scanned images or unsupported layouts, mostly 1988–2001); ${fmtN(d.coverage.partial)} parsed in part.`}
      >
        <div className="space-y-4 p-3">
          {rows.length ? (
            <ChartFrame
              caption="Average number of vacancies on the monthly list, by year"
              label={`Bar chart of the average number of judgeship vacancies on the monthly lists for each year from ${rows[0]!.label} to ${rows.at(-1)!.label}; years without a parsed report are omitted.`}
              height="h-52"
              footnote={`Each bar averages the monthly reports parsed for that year; years with only a few parsed months (${sparse.join(", ") || "none"}) are less reliable.${missingYears ? ` ${missingYears} years have no parsed report and are not shown.` : ""}`}
            >
              <YearBarLine rows={rows} barName="Average vacancies listed" />
            </ChartFrame>
          ) : (
            <p className="text-xs text-muted-foreground">{NR}</p>
          )}
          <MiniTable
            caption="Most recent confirmations listed against a vacancy"
            rows={d.recentConfirmations}
            rowKey={(r) => `${r.courtId}-${r.incumbent}-${r.confirmation?.date}`}
            columns={confCols}
            limit={10}
            noun="confirmations"
          />
        </div>
      </Panel>
      <HowToRead
        measures={MEASURES}
        notes="Names are shown as the AO prints them (last name first). Links to judge profiles are made only on exact keys: the incumbent's surname, court and an FJC senior-status or termination date equal to the vacancy date; the nominee's surname, court and an FJC confirmation date equal to the listed confirmation date."
      />
    </div>
  );
}
