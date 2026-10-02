import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { BarList } from "@/components/corpus/BarList";
import {
  casesForState,
  courtStates,
  exportJson,
  judgeNameKey,
  openServiceAt,
  recordedDate,
  uniqueJudge,
} from "@/lib/corpus/research";
import {
  CaseStats,
  control,
  Field,
  fmt,
  Pagination,
  Panel,
  Source,
  tableClass,
  type WorkbenchProps,
} from "./shared";

export function JudgeResearch({ data, cases, state, search, update }: WorkbenchProps) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(0);
  const scoped = useMemo(
    () => casesForState(cases, state, courtStates(data.courts.records)),
    [data, cases, state],
  );
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of scoped)
      if (c.judge) {
        const key = judgeNameKey(c.judge);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    return map;
  }, [scoped]);
  const nativeNames = [
    ...new Set(scoped.map((c) => c.judge).filter((n): n is string => !!n)),
  ].sort();
  const first = nativeNames.find((n) => uniqueJudge(n, data.judiciary.judges));
  const selectedName = search.judge ?? first ?? "";
  const selected = uniqueJudge(selectedName, data.judiciary.judges);
  const judgeCases = scoped.filter(
    (c) =>
      c.judge &&
      (selected ? judgeNameKey(c.judge) === judgeNameKey(selected.name) : c.judge === selectedName),
  );
  const listed = data.judiciary.judges.filter(
    (j) =>
      (state === "ALL" || j.services.some((s) => s.state === state)) &&
      j.name.toLowerCase().includes(q.toLowerCase()),
  );
  const shown = listed.slice(page * 20, page * 20 + 20);
  const byYear = new Map<string, number>();
  for (const c of judgeCases) {
    const year = c.date_filed?.slice(0, 4);
    if (year && /^\d{4}$/.test(year)) byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  return (
    <div className="space-y-4">
      <Panel
        title="Judge research"
        note={`Federal Judicial Center: ${fmt(data.judiciary.judgeCount)} judges and ${fmt(data.judiciary.serviceCount)} service appointments, retrieved ${data.judiciary.asOf}. ${data.judiciary.scope}`}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Analyze a judge recorded in this case selection">
            <select
              value={nativeNames.includes(selectedName) ? selectedName : ""}
              className={control}
              onChange={(e) => update({ judge: e.target.value })}
            >
              <option value="">Choose a recorded judge</option>
              {nativeNames.map((n) => (
                <option key={n} value={n}>
                  {n} · {counts.get(judgeNameKey(n)) ?? 0} cases
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search the FJC service directory">
            <input
              className={control}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder="Full name, surname, or initials"
            />
          </Field>
        </div>
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-primary">
            Browse {fmt(listed.length)} federal judicial biographies
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Appointments</th>
                  <th>Open service at snapshot</th>
                  <th>Exact-name catalog cases</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <button
                        className="text-primary underline"
                        onClick={() => update({ judge: j.name })}
                      >
                        {j.name}
                      </button>
                    </td>
                    <td>{j.services.length}</td>
                    <td>
                      {j.services.some((s) => openServiceAt(s, data.judiciary.asOf))
                        ? "Recorded open interval"
                        : "No recorded open interval"}
                    </td>
                    <td>
                      {uniqueJudge(j.name, data.judiciary.judges)
                        ? (counts.get(judgeNameKey(j.name)) ?? 0)
                        : "Name ambiguous"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination count={listed.length} page={page} onPage={setPage} />
        </details>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Biographies link to catalog cases only when the full name has one exact match after
          normalizing punctuation, spacing, and case. Initials and suffixes remain significant.
          State and magistrate judges can still have catalog analysis without an FJC biography.
        </p>
      </Panel>
      {selectedName && (
        <>
          <Panel
            title={selected?.name ?? selectedName}
            note={
              selected
                ? `FJC native ID ${selected.id} · Service history from the publisher’s export`
                : "No unique full-name match in the FJC Article III directory. The catalog’s recorded judge label is retained."
            }
          >
            <CaseStats rows={judgeCases} />
            <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
              <button
                className="text-primary underline"
                onClick={() => update({ view: "cases", judge: selectedName })}
              >
                Explore this judge’s saved cases
              </button>
              <Source href="https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export">
                FJC source and coverage
              </Source>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportJson("judge-research.json", {
                    name: selectedName,
                    state,
                    asOf: data.judiciary.asOf,
                    match: selected ? "Unique exact normalized full name" : "Unresolved",
                    biography: selected,
                    cases: judgeCases,
                    source:
                      "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export",
                  })
                }
              >
                Download judge research
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              These are cases assigned to the recorded judge in the selected catalog, not that
              judge’s full docket. Case mix, transfers and selection affect duration; this is not a
              performance or win-rate score.
            </p>
          </Panel>
          {selected && (
            <Panel
              title="Appointments and service timeline"
              note="Each row is a separate appointment. Partial chief-judge years are retained as published; no day is inferred."
            >
              <ol className="space-y-4">
                {selected.services.map((s) => {
                  const nomination = recordedDate(s.nominationDate),
                    confirmation = recordedDate(s.confirmationDate);
                  const lag =
                    nomination !== null && confirmation !== null && confirmation >= nomination
                      ? (confirmation - nomination) / 86400000
                      : null;
                  return (
                    <li key={s.sequence} className="border-l-2 border-primary/40 pl-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-[13px] font-semibold">{s.court}</h3>
                        <span className="rounded bg-muted px-2 py-1 text-[10px]">{s.type}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
                        {[
                          ["Nomination", s.nominationDate],
                          ["Confirmation", s.confirmationDate],
                          ["Commission", s.commissionDate],
                          ["Senior status", s.seniorDate],
                          ["Termination", s.terminationDate],
                          ["Termination reason", s.terminationReason],
                          [
                            "Chief service",
                            s.chiefBegin ? `${s.chiefBegin}–${s.chiefEnd ?? "Not recorded"}` : null,
                          ],
                          ["Nomination → confirmation", lag === null ? null : `${fmt(lag)} days`],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <div className="text-[10px] text-muted-foreground">{label}</div>
                            <div>{value ?? "Not recorded"}</div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {openServiceAt(s, data.judiciary.asOf)
                          ? `Recorded service interval open on ${data.judiciary.asOf}`
                          : "No open service interval established at this snapshot"}
                        {s.recessDate ? ` · Recess appointment ${s.recessDate}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <BarList
              title="Saved case filings by year"
              rows={[...byYear]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([label, count]) => ({ label, count }))}
              limit={100}
              unit="dated cases in the selected judge/state cohort"
            />
            <Panel
              title="Recorded cases"
              note="Open a case to see its timeline, shared MDL, counsel, court, and source docket."
            >
              <div className="max-h-80 overflow-auto">
                <ul className="space-y-3 text-[12px]">
                  {judgeCases.map((c) => (
                    <li key={c.docket_id}>
                      <Link
                        className="text-primary underline"
                        to="/insights"
                        search={{ view: "cases", state, docket: c.docket_id, judge: selectedName }}
                      >
                        {c.case_name ?? c.docket_number ?? c.docket_id}
                      </Link>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {c.court ?? "Court not recorded"} · {c.date_filed ?? "Date not recorded"} ·{" "}
                        {c.status ?? "Status not recorded"}
                      </span>
                    </li>
                  ))}
                </ul>
                {!judgeCases.length && (
                  <p className="text-[12px] text-muted-foreground">
                    No uniquely matched cases in this state selection.
                  </p>
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
