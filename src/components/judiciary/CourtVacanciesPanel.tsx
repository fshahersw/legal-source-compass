import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import { CollapsibleSection } from "@/components/courts/clb/ClbParts";
import {
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
} from "@/components/courts/clb/ClbRestParts";
import {
  getCourtVacancies,
  type CourtVacancies,
  type Vacancy,
} from "@/lib/external/judiciary.functions";
import { vacancyColumns } from "./vacancyColumns";
import { aoName, fmtDay, fmtN, NR } from "./judiciaryFormat";

const CURRENT = "https://www.uscourts.gov/data-news/judicial-vacancies/current-judicial-vacancies";

/** Current and past judgeship vacancies at one court, from the uscourts.gov vacancy lists (dataset judicial_vacancies). */
export function CourtVacanciesPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["judiciary-court-vacancies", courtId],
    queryFn: () => getCourtVacancies({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading) return <PanelLoading label="Loading judicial vacancies" height="h-28" />;
  if (q.isError)
    return (
      <PanelError text="Judicial vacancies could not be loaded." onRetry={() => void q.refetch()} />
    );
  if (!q.data) return null;
  return <Body v={q.data} />;
}

function Body({ v }: { v: CourtVacancies }) {
  const current = [...v.open, ...v.announced];
  const historyCols = [
    {
      key: "who",
      label: "Vacancy created by",
      render: (r: Vacancy) =>
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
    { key: "reason", label: "Reason", render: (r: Vacancy) => r.reason ?? NR },
    { key: "date", label: "Vacancy date", render: (r: Vacancy) => fmtDay(r.vacancyDate) },
    {
      key: "conf",
      label: "Confirmation listed",
      render: (r: Vacancy) =>
        r.confirmation ? (
          <>
            {r.confirmation.judgeId ? (
              <Link
                to="/judges/$id"
                params={{ id: r.confirmation.judgeId }}
                className="text-primary hover:underline"
              >
                {aoName(r.confirmation.nominee)}
              </Link>
            ) : (
              aoName(r.confirmation.nominee)
            )}{" "}
            <span className="text-muted-foreground">{fmtDay(r.confirmation.date)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            None listed{r.lastListed ? ` · last listed ${fmtDay(r.lastListed)}` : ""}
          </span>
        ),
    },
  ];
  return (
    <PanelShell
      title="Judicial vacancies"
      subtitle={`${v.courtName ?? v.courtId}: vacancies, future vacancies and judicial emergencies as listed by the Administrative Office of the U.S. Courts (current lists of Oct 22, 2026; archive from 1981)`}
      record={{ dataset: "judicial_vacancies", id: `court:${v.courtId}` }}
      aside={
        <>
          <Link
            to="/courts/vacancies"
            className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            All vacancies
          </Link>
          <SourceLink href={CURRENT}>uscourts.gov</SourceLink>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi label="Open vacancies" value={fmtN(v.open.length)} />
        <Kpi label="Announced future vacancies" value={fmtN(v.announced.length)} />
        <Kpi
          label="Judicial emergencies"
          value={fmtN(v.emergencies.length)}
          tone={v.emergencies.length ? "warning" : undefined}
        />
        <Kpi
          label="Median days, vacancy to listed confirmation"
          value={v.medianDaysToConfirmation == null ? NR : fmtN(v.medianDaysToConfirmation)}
          note={
            v.confirmationsWithDates
              ? `${fmtN(v.confirmationsWithDates)} confirmations with both dates`
              : undefined
          }
        />
      </div>
      <div className="px-3 pb-3">
        {current.length ? (
          <MiniTable
            caption="Current and announced vacancies"
            rows={current}
            rowKey={(r) => `${r.status}-${r.incumbent}-${r.vacancyDate}`}
            columns={vacancyColumns({ court: false })}
            noun="vacancies"
            note="Nominee: the nominee printed on the current list; an earlier nomination that is no longer listed is not shown as pending."
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            No open or announced vacancy is listed for this court on the current lists.
          </p>
        )}
      </div>
      {v.recent.length ? (
        <CollapsibleSection
          title="Earlier vacancies"
          summary={`${fmtN(v.listedTotal)} listed since 1981 in the parsed reports`}
        >
          <MiniTable
            caption="Most recent past vacancies"
            rows={v.recent}
            rowKey={(r) => `${r.incumbent}-${r.vacancyDate}-${r.firstListed}`}
            columns={historyCols}
            limit={8}
            noun="vacancies"
            note="Monthly reports from 1988 to 2001 are mostly scanned images and are not parsed, so vacancies of those years are under-counted."
          />
        </CollapsibleSection>
      ) : null}
    </PanelShell>
  );
}
