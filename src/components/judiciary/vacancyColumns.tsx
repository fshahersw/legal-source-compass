import { Link } from "@tanstack/react-router";
import type { Column } from "@/components/courts/clb/ClbRestParts";
import type { Vacancy } from "@/lib/external/judiciary.functions";
import { aoName, courtLabel, fmtDay, fmtN, NR } from "./judiciaryFormat";

const STATUS: Record<string, string> = {
  open: "Open",
  announced: "Announced",
  confirmation_listed: "Confirmation listed",
  no_longer_listed: "No longer listed",
};

/** Columns for current and announced vacancies (court page and the national list). */
export function vacancyColumns({
  court,
  emergency = false,
}: {
  court: boolean;
  emergency?: boolean;
}): Column<Vacancy>[] {
  const cols: Column<Vacancy>[] = [];
  if (court)
    cols.push({
      key: "court",
      label: "Court",
      render: (r) =>
        r.courtId ? (
          <Link
            to="/courts/$id"
            params={{ id: r.courtId }}
            className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            title={r.courtAsPublished ?? undefined}
          >
            {courtLabel(r)}
          </Link>
        ) : (
          courtLabel(r)
        ),
    });
  cols.push(
    {
      key: "who",
      label: "Vacancy created by",
      render: (r) =>
        r.incumbentJudgeId ? (
          <Link
            to="/judges/$id"
            params={{ id: r.incumbentJudgeId }}
            className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {aoName(r.incumbent)}
          </Link>
        ) : (
          aoName(r.incumbent)
        ),
    },
    { key: "reason", label: "Reason", render: (r) => r.reason ?? NR },
    {
      key: "date",
      label: "Vacancy date",
      render: (r) =>
        r.vacancyDate ? (
          fmtDay(r.vacancyDate)
        ) : (
          <span className="text-muted-foreground">To be determined</span>
        ),
    },
  );
  if (emergency)
    cols.push(
      {
        key: "days",
        label: "Days pending",
        numeric: true,
        render: (r) => r.emergencyDaysPending ?? NR,
      },
      {
        key: "weighted",
        label: "Weighted filings per judgeship",
        numeric: true,
        render: (r) => r.weightedFilings ?? NR,
      },
    );
  else
    cols.push(
      {
        key: "status",
        label: "Status",
        render: (r) => (
          <>
            {STATUS[r.status] ?? r.status}
            {r.emergency ? (
              <span className="ml-1 rounded border border-warning/40 bg-warning/15 px-1 text-[10px] text-warning-foreground">
                Emergency
              </span>
            ) : null}
          </>
        ),
      },
      {
        key: "open",
        label: "Days vacant",
        numeric: true,
        render: (r) => (r.daysOpen == null ? "—" : fmtN(r.daysOpen)),
      },
    );
  cols.push({
    key: "nominee",
    label: "Nominee",
    render: (r) =>
      r.pendingNominee ? (
        <>
          {aoName(r.pendingNominee)}
          {r.pendingNominationDate ? (
            <span className="block text-[11px] text-muted-foreground">
              nominated {fmtDay(r.pendingNominationDate)}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">None pending</span>
      ),
  });
  return cols;
}
