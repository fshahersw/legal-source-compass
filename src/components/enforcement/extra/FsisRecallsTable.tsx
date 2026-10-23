import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getFsisRecalls,
  type FsisRecall,
  type FsisRecalls,
} from "@/lib/external/enforcementExtra.functions";
import { Panel, Segmented, SourceLink, StateNote } from "../parts";
import { fmtDate, fmtInt, NOT_RECORDED } from "./format";

type Kind = "all" | "recall" | "pha";
type Cls = "all" | "I" | "II" | "III";
const YEARS = Array.from({ length: 13 }, (_, i) => 2026 - i);
const CLASS_LABEL: Record<string, string> = {
  I: "Class I",
  II: "Class II",
  III: "Class III",
  PHA: "Public health alert",
};

/**
 * FSIS (USDA) meat, poultry and egg product recalls and public health alerts, 2014-2026, from FSIS's own recall
 * listing. Sits beside the CPSC / FDA / NHTSA recall surfaces; each row links to its record and FSIS's release.
 */
export function FsisRecallsTable() {
  const uid = useId();
  const [kind, setKind] = useState<Kind>("all");
  const [cls, setCls] = useState<Cls>("all");
  const [year, setYear] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setPage(0), [kind, cls, year, q]);
  const query = useQuery({
    queryKey: ["fsis-recalls", kind, cls, year, q, page],
    queryFn: () => getFsisRecalls({ data: { kind, cls, year, q, page } }),
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const exact = d?.checks.filter((c) => c.official != null && c.official === c.listing).length ?? 0;
  return (
    <Panel
      title="FSIS recalls and public health alerts"
      subtitle="USDA Food Safety and Inspection Service · meat, poultry and egg products · 2014-2026"
      footnote={
        <>
          From FSIS's recall listing (number, class, reason, dates, distribution and establishment
          as published). Pounds appear only where the release excerpt states them. Recall expansions
          (numbers marked EXP) are separate rows.
          {d?.checks.length
            ? ` Counted without expansions, the listing matches FSIS's published annual recall totals in ${exact} of ${d.checks.length} years.`
            : ""}{" "}
          <SourceLink href="https://www.fsis.usda.gov/recalls">FSIS recalls</SourceLink>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-border/60 px-3 py-2">
        <label htmlFor={`${uid}-q`} className="sr-only">
          Search FSIS recall titles
        </label>
        <input
          id={`${uid}-q`}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search titles (firm, product, reason)"
          className="h-8 min-w-0 flex-1 basis-48 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Segmented<Kind>
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            { id: "all", label: "All" },
            { id: "recall", label: "Recalls" },
            { id: "pha", label: "Health alerts" },
          ]}
        />
        <Segmented<Cls>
          label="Class"
          value={cls}
          onChange={setCls}
          options={[
            { id: "all", label: "Any class" },
            { id: "I", label: "I" },
            { id: "II", label: "II" },
            { id: "III", label: "III" },
          ]}
        />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Year
          <select
            value={year ?? ""}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All years</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="p-3">
        {query.isError ? (
          <StateNote
            tone="error"
            action={
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Retry
              </button>
            }
          >
            FSIS recalls could not be loaded.
          </StateNote>
        ) : !d ? (
          <div
            className="h-48 animate-pulse rounded-md border border-border bg-muted/40"
            aria-busy="true"
            aria-label="Loading FSIS recalls"
          />
        ) : !d.rows.length ? (
          <StateNote>No FSIS recall or alert matches these filters.</StateNote>
        ) : (
          <Table d={d} fetching={query.isFetching} page={page} onPage={setPage} />
        )}
      </div>
    </Panel>
  );
}

function Table({
  d,
  fetching,
  page,
  onPage,
}: {
  d: FsisRecalls;
  fetching: boolean;
  page: number;
  onPage: (p: number) => void;
}) {
  const more = d.total != null && d.total > (page + 1) * d.pageSize;
  return (
    <div aria-busy={fetching}>
      <p className="mb-1.5 text-[11px] text-muted-foreground" aria-live="polite">
        {d.total == null ? "Count not recorded" : `${fmtInt(d.total)} records`}
        {fetching ? " · updating…" : ""}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[44rem] text-xs">
          <caption className="sr-only">FSIS recalls and public health alerts</caption>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Date
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Recall
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Class
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Reason
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Pounds
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Distribution
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Previous
        </button>
        <span className="text-muted-foreground">Page {page + 1}</span>
        <button
          type="button"
          disabled={!more}
          onClick={() => onPage(page + 1)}
          className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Row({ r }: { r: FsisRecall }) {
  return (
    <tr className="border-t border-border/60 align-top">
      <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
        {r.date ? fmtDate(r.date) : NOT_RECORDED}
        {r.status ? (
          <div className="font-sans text-[11px] text-muted-foreground">{r.status}</div>
        ) : null}
      </td>
      <td className="px-2 py-1.5">
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "fsis_recalls", id: r.id }}
          className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {r.title}
        </Link>
        <div className="text-[11px] text-muted-foreground">
          {r.number ?? "Number not recorded"}
          {r.expansion ? " · expansion of an earlier recall" : ""}
          {r.establishment ? ` · ${r.establishment}` : ""}
          {r.sourceUrl ? (
            <>
              {" · "}
              <SourceLink href={r.sourceUrl}>FSIS release</SourceLink>
            </>
          ) : null}
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">{r.cls ? CLASS_LABEL[r.cls] : NOT_RECORDED}</td>
      <td className="px-2 py-1.5">{r.reason ?? NOT_RECORDED}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">
        {r.pounds == null ? (
          <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
        ) : (
          fmtInt(r.pounds)
        )}
      </td>
      <td className="px-2 py-1.5">{r.states ?? NOT_RECORDED}</td>
    </tr>
  );
}
