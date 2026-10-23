import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type DistrictProsecutions } from "@/lib/external/enforcementExtra.functions";
import { Kpi, MoreToggle, Panel, SourceLink, StateNote } from "../parts";
import { fmtInt, fmtPct, share, titleCase } from "./format";
import { districtProsecutionsQuery } from "./queries";

const DISTRICT_ID = /^[a-z]{2,4}d$/;
const LIMIT = 6;

/**
 * EOUSA National Caseload Data, FY2025 annual release, for one U.S. Attorney's district: criminal records by
 * program category and lead charge, and civil cases with the Government as defendant. Counts only.
 */
export function ProsecutionsPanel({ courtId }: { courtId: string }) {
  const enabled = DISTRICT_ID.test(courtId);
  const q = useQuery({ ...districtProsecutionsQuery(courtId), enabled });
  if (!enabled) return null;
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-48 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading U.S. Attorneys' caseload counts"
      />
    );
  if (q.isError)
    return (
      <div className="mb-5">
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
          U.S. Attorneys' caseload counts could not be loaded.
        </StateNote>
      </div>
    );
  if (!q.data) return null;
  return <Body d={q.data} />;
}

function Bars({
  rows,
  total,
  id,
}: {
  rows: { key: string; label: string; n: number }[];
  total: number;
  id: string;
}) {
  return (
    <ul id={id} className="space-y-1">
      {rows.map((r) => {
        const pct = share(r.n, total);
        return (
          <li
            key={r.key}
            className="grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] items-center gap-2 text-xs"
          >
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
            <span className="h-1.5 rounded bg-muted" aria-hidden>
              <span
                className="block h-1.5 rounded bg-primary"
                style={{ width: `${Math.min(100, pct ?? 0)}%` }}
              />
            </span>
            <span className="text-right font-mono tabular-nums">
              {fmtInt(r.n)}
              <span className="text-muted-foreground"> {fmtPct(pct, 0)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Body({ d }: { d: DistrictProsecutions }) {
  const uid = useId();
  const [allGroups, setAllGroups] = useState(false);
  const [allCharges, setAllCharges] = useState(false);
  const total = d.criminalRecords ?? 0;
  const groups = d.programGroups.map((g) => ({
    key: g.code,
    label: titleCase(g.label),
    n: g.records,
  }));
  const charges = d.leadCharges;
  return (
    <div className="mb-5">
      <Panel
        title={`Prosecutions (U.S. Attorneys), FY${d.fy}`}
        subtitle={`EOUSA National Caseload Data · ${titleCase(d.districtName)} (${d.districtCode}) · counts from the FY${d.fy} annual release`}
        actions={
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "eousa_caseload_annual", id: `eousa:${d.fy}:${d.courtId}` }}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Release record
          </Link>
        }
        footnote={
          <>
            Counts of the release's lead-charge and program-category records (deliverable 7) and of
            civil cases with the Government as defendant (deliverable 16), as EOUSA describes them
            in the release README. They are not the Annual Statistical Report's caseload totals and
            do not count every matter the office handled. No case names, participants or case
            numbers are shown.{" "}
            {d.sourceUrl ? (
              <SourceLink href={d.sourceUrl}>EOUSA National Caseload Data</SourceLink>
            ) : null}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-3">
          <Kpi
            label="Criminal lead-charge records"
            value={fmtInt(d.criminalRecords)}
            note={
              d.nationalRecords
                ? `${fmtPct(share(total, d.nationalRecords))} of ${fmtInt(d.nationalRecords)} nationally`
                : undefined
            }
          />
          <Kpi label="Civil cases, Government as defendant" value={fmtInt(d.govDefendantCases)} />
          <Kpi
            label="Public cases with a business or property party"
            value={
              d.businessProperty
                ? fmtInt(d.businessProperty.civil + d.businessProperty.criminal)
                : "Not recorded"
            }
            note={
              d.businessProperty
                ? `${fmtInt(d.businessProperty.civil)} civil · ${fmtInt(d.businessProperty.criminal)} criminal`
                : undefined
            }
          />
        </div>
        {total > 0 ? (
          <div className="grid gap-4 border-t border-border/60 p-3 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium">Program groups</p>
              <Bars
                rows={allGroups ? groups : groups.slice(0, LIMIT)}
                total={total}
                id={`${uid}-g`}
              />
              <MoreToggle
                total={groups.length}
                limit={LIMIT}
                expanded={allGroups}
                onToggle={() => setAllGroups((v) => !v)}
                controls={`${uid}-g`}
                noun="groups"
              />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium">Most frequent lead charges</p>
              <ul id={`${uid}-c`} className="space-y-1 text-xs">
                {(allCharges ? charges : charges.slice(0, LIMIT)).map((c) => (
                  <li key={c.code} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-mono text-[11px] text-muted-foreground">{c.code}</span>{" "}
                      {c.label}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{fmtInt(c.records)}</span>
                  </li>
                ))}
              </ul>
              <MoreToggle
                total={charges.length}
                limit={LIMIT}
                expanded={allCharges}
                onToggle={() => setAllCharges((v) => !v)}
                controls={`${uid}-c`}
                noun="charges"
              />
            </div>
          </div>
        ) : (
          <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
            The release lists no criminal lead-charge records for this district.
          </p>
        )}
      </Panel>
    </div>
  );
}
