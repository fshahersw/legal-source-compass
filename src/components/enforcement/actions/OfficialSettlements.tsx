import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ConfirmedFact,
  OfficialSettlement,
} from "@/lib/external/enforcementActions.functions";
import { cn } from "@/lib/utils";
import { Kpi, LoadingBlock, MoreToggle, Panel, Segmented, SourceLink, StateNote } from "../parts";
import { CourtList, SearchBox } from "./bits";
import { officialSettlementsQuery } from "./actionsView";
import { daysUntil, deadlineNote, fmtInt, hostOf } from "./format";

export function OfficialSettlements() {
  const q = useQuery(officialSettlementsQuery);
  if (q.isLoading) return <LoadingBlock label="Loading confirmed settlements" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        Confirmed settlements could not be loaded.
      </StateNote>
    );
  if (!q.data?.length)
    return <StateNote>No settlement has been confirmed on an official page yet.</StateNote>;
  return <Body rows={q.data} />;
}

type View = "ahead" | "all";
const FACT_LABEL: Record<ConfirmedFact, string> = {
  deadline: "Deadline",
  amount: "Amount",
  court: "Court",
  "case number": "Case no.",
};

function Body({ rows }: { rows: OfficialSettlement[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [view, setView] = useState<View>("ahead");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const ahead = rows.filter((r) => r.deadline != null && r.deadline >= today);
  const soon = ahead.filter((r) => daysUntil(today, r.deadline!) <= 30);
  const withCourt = rows.filter((r) => r.courts.length || r.caseNumbers.length).length;
  const needle = query.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (view === "ahead" ? r.deadline != null && r.deadline >= today : true))
    .filter((r) =>
      needle
        ? [
            r.name,
            r.pageTitle,
            r.officialHost,
            ...r.caseNumbers,
            ...r.courts.map((c) => c.asWritten),
          ].some((v) => v?.toLowerCase().includes(needle))
        : true,
    )
    .sort((a, b) =>
      view === "ahead"
        ? (a.deadline ?? "").localeCompare(b.deadline ?? "")
        : (b.deadline ?? "").localeCompare(a.deadline ?? ""),
    );
  const limit = 25;
  const shown = expanded ? filtered : filtered.slice(0, limit);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Confirmed on the official page"
          value={fmtInt(rows.length)}
          note="Name plus at least one deadline, amount, court or case number"
        />
        <Kpi
          label="Deadline still ahead"
          value={fmtInt(ahead.length)}
          note={`Confirmed claim date on or after ${today}`}
        />
        <Kpi
          label="Closing within 30 days"
          value={fmtInt(soon.length)}
          tone={soon.length ? "warning" : undefined}
        />
        <Kpi label="Court or case number stated" value={fmtInt(withCourt)} />
      </div>
      <Panel
        title="Settlement claims confirmed on official pages"
        subtitle={
          view === "ahead"
            ? "Confirmed deadline still ahead, soonest first"
            : "All confirmed settlements, latest deadline first"
        }
        actions={
          <Segmented
            label="Window"
            value={view}
            options={[
              { id: "ahead", label: `Deadline ahead (${fmtInt(ahead.length)})` },
              { id: "all", label: `All (${fmtInt(rows.length)})` },
            ]}
            onChange={(v: View) => {
              setView(v);
              setExpanded(false);
            }}
          />
        }
        footnote={
          <>
            Every fact shown was read on the official settlement page it links to (administrator,
            court or agency); dates, amounts and eligibility change, so confirm there before relying
            on them. Leads discovered via{" "}
            <a
              href="https://settlesignal.com/"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              SettleSignal (settlesignal.com)
            </a>
            , free to use with attribution; SettleSignal's own status and payout text are not shown.
          </>
        }
      >
        <div className="border-b border-border/60 px-3 py-2">
          <SearchBox
            label="Search"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setExpanded(false);
            }}
            placeholder="Settlement, court, case number or site"
          />
        </div>
        {shown.length ? (
          <div className="overflow-x-auto" id="official-settlements">
            <table className="w-full text-xs">
              <caption className="sr-only">Settlements confirmed on official pages</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Settlement
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Claim deadline
                  </th>
                  <th scope="col" className="hidden px-2 py-1.5 font-medium md:table-cell">
                    Amount on the page
                  </th>
                  <th scope="col" className="hidden px-2 py-1.5 font-medium lg:table-cell">
                    Court / case no.
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Confirmed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="min-w-[12rem] max-w-80 px-2 py-1">
                      <SourceLink href={r.officialUrl}>{r.name}</SourceLink>
                      <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={r.pageTitle ?? undefined}
                      >
                        {r.officialHost ?? hostOf(r.officialUrl)}
                        {r.claimUrl ? (
                          <>
                            {" · "}
                            <a
                              href={r.claimUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              Claim form
                            </a>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {r.deadline ? (
                        <span title={r.deadlineSentence ?? undefined}>
                          <span className="font-mono">{r.deadline}</span>
                          <span
                            className={cn(
                              "ml-1 text-[11px]",
                              r.deadline < today
                                ? "text-muted-foreground"
                                : daysUntil(today, r.deadline) <= 30
                                  ? "font-medium"
                                  : "text-muted-foreground",
                            )}
                          >
                            {deadlineNote(today, r.deadline)}
                          </span>
                          {r.deadlineAsWritten ? (
                            <span className="block text-[11px] text-muted-foreground">
                              page: “{r.deadlineAsWritten}”
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not confirmed</span>
                      )}
                    </td>
                    <td className="hidden max-w-56 px-2 py-1 md:table-cell">
                      {r.amounts.length ? (
                        <span title={r.amounts[0]!.sentence ?? undefined}>
                          <span className="font-mono">{r.amounts[0]!.asWritten}</span>
                          {r.amounts[0]!.sentence ? (
                            <span className="line-clamp-2 text-[11px] text-muted-foreground">
                              “{r.amounts[0]!.sentence}”
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not confirmed</span>
                      )}
                    </td>
                    <td className="hidden max-w-64 px-2 py-1 lg:table-cell">
                      {r.courts.length ? <CourtList courts={r.courts.slice(0, 1)} /> : null}
                      {r.caseNumbers.length ? (
                        <span className="block font-mono text-[11px]">
                          {r.caseNumbers.slice(0, 2).join("; ")}
                        </span>
                      ) : null}
                      {!r.courts.length && !r.caseNumbers.length ? (
                        <span className="text-muted-foreground">Not stated</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex flex-wrap gap-1">
                        {r.confirmed.map((f) => (
                          <span
                            key={f}
                            className="rounded border border-border bg-muted px-1 py-px text-[10px]"
                          >
                            {FACT_LABEL[f]}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 pb-1">
              <MoreToggle
                total={filtered.length}
                limit={limit}
                expanded={expanded}
                onToggle={() => setExpanded((v) => !v)}
                controls="official-settlements"
                noun="settlements"
              />
            </div>
          </div>
        ) : (
          <div className="p-3">
            <StateNote>
              {view === "ahead"
                ? "No confirmed deadline is ahead of today with this search. Try All."
                : "No settlement matches this search."}
            </StateNote>
          </div>
        )}
      </Panel>
    </div>
  );
}
