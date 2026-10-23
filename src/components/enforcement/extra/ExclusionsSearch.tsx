import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  searchExclusions,
  type ExclusionHit,
  type ExclusionSearch,
} from "@/lib/external/enforcementExtra.functions";
import { Panel, Segmented, SourceLink, StateNote } from "../parts";
import { fmtDate, fmtInt, NOT_RECORDED } from "./format";
import { exclusionsOverviewQuery } from "./queries";

type ListFilter = "all" | "sam" | "leie";
const CLASSIFICATIONS = ["Individual", "Firm", "Entity", "Special Entity Designation", "Vessel"];
const STALE = 10 * 60 * 1000;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Search of the two federal exclusion lists: SAM.gov exclusions (debarments, suspensions and reciprocal
 * exclusions) and HHS-OIG's LEIE. Names are shown exactly as the publishers list them; every row links to
 * its record here and to the official source. A name match is not an identity match.
 */
export function ExclusionsSearch() {
  const uid = useId();
  const [text, setText] = useState("");
  const [list, setList] = useState<ListFilter>("all");
  const [classification, setClassification] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(text.trim(), 350);
  const overview = useQuery(exclusionsOverviewQuery);
  const enabled = q.length >= 2;
  const results = useQuery({
    queryKey: ["exclusions-search", q, list, classification, page],
    queryFn: () =>
      searchExclusions({
        data: { q, list, page, ...(classification ? { classification } : {}) },
      }),
    enabled,
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
  useEffect(() => setPage(0), [q, list, classification]);

  const o = overview.data;
  const subtitle = o
    ? `${o.sam ? `${fmtInt(o.sam.records)} SAM.gov records` : "SAM.gov list not loaded"} · ${o.leie ? `${fmtInt(o.leie.records)} LEIE records` : "LEIE not loaded"} · names exactly as published`
    : "SAM.gov exclusions and the HHS-OIG LEIE · names exactly as published";

  return (
    <Panel
      title="Exclusions"
      subtitle={subtitle}
      footnote={
        <>
          A name match is not an identity match: confirm against the official record (SAM.gov record
          page or the OIG exclusions database) before relying on it. SAM.gov lists active exclusions
          only; LEIE lists current exclusions. Street addresses, ZIP codes and dates of birth are
          not shown.
          {o?.sam?.dataPage ? (
            <>
              {" "}
              Sources: <SourceLink href={o.sam.dataPage}>SAM.gov public extract</SourceLink>
            </>
          ) : null}
          {o?.leie?.dataPage ? (
            <>
              {" · "}
              <SourceLink href={o.leie.dataPage}>OIG LEIE downloads</SourceLink>
            </>
          ) : null}
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-border/60 px-3 py-2">
        <label htmlFor={`${uid}-q`} className="sr-only">
          Search exclusion lists by name
        </label>
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id={`${uid}-q`}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name of a person, firm or entity"
            autoComplete="off"
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
        <Segmented<ListFilter>
          label="List"
          value={list}
          onChange={setList}
          options={[
            { id: "all", label: "Both lists" },
            { id: "sam", label: "SAM.gov" },
            { id: "leie", label: "LEIE" },
          ]}
        />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Classification
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">Any</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="p-3">
        {!enabled ? (
          <StateNote>
            Type at least two characters of a name. Both lists are searched by the name as
            published.
          </StateNote>
        ) : results.isError ? (
          <StateNote
            tone="error"
            action={
              <button
                type="button"
                onClick={() => void results.refetch()}
                className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Retry
              </button>
            }
          >
            The exclusion lists could not be searched.
          </StateNote>
        ) : results.isLoading || !results.data ? (
          <div
            className="h-40 animate-pulse rounded-md border border-border bg-muted/40"
            aria-busy="true"
            aria-label="Searching exclusion lists"
          />
        ) : (
          <Results data={results.data} fetching={results.isFetching} page={page} onPage={setPage} />
        )}
      </div>
    </Panel>
  );
}

function Results({
  data,
  fetching,
  page,
  onPage,
}: {
  data: ExclusionSearch;
  fetching: boolean;
  page: number;
  onPage: (p: number) => void;
}) {
  const hits = [...(data.sam?.hits ?? []), ...(data.leie?.hits ?? [])];
  const totals = [
    data.sam
      ? `${data.sam.total == null ? "Not recorded" : fmtInt(data.sam.total)} in SAM.gov`
      : null,
    data.leie
      ? `${data.leie.total == null ? "Not recorded" : fmtInt(data.leie.total)} in LEIE`
      : null,
  ].filter(Boolean);
  const more =
    (data.sam?.total ?? 0) > (page + 1) * data.pageSize ||
    (data.leie?.total ?? 0) > (page + 1) * data.pageSize;
  if (!hits.length)
    return (
      <StateNote>
        No listed name contains “{data.q}”{totals.length ? ` (${totals.join(", ")})` : ""}. Absence
        here is not a clearance: the lists change daily (SAM.gov) and monthly (LEIE).
      </StateNote>
    );
  return (
    <div aria-busy={fetching}>
      <p className="mb-1.5 text-[11px] text-muted-foreground" aria-live="polite">
        Names containing “{data.q}”: {totals.join(" · ")}
        {fetching ? " · updating…" : ""}
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[46rem] text-xs">
          <caption className="sr-only">
            Exclusion list records whose name contains the search
          </caption>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Name as published
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                List
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Agency or category
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Exclusion type
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Since
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Until
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Place
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <Row key={h.id} h={h} />
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

function Row({ h }: { h: ExclusionHit }) {
  return (
    <tr className="border-t border-border/60 align-top">
      <td className="px-2 py-1.5">
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: h.dataset, id: h.id }}
          className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {h.name}
        </Link>
        <div className="text-[11px] text-muted-foreground">
          {h.classification ?? NOT_RECORDED}
          {h.identifiers ? ` · ${h.identifiers}` : ""}
          {h.companyCik ? (
            <>
              {" · "}
              <Link
                to="/companies/$cik"
                params={{ cik: h.companyCik }}
                className="text-primary hover:underline"
              >
                company profile (exact name match)
              </Link>
            </>
          ) : null}
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">{h.list === "sam" ? "SAM.gov" : "LEIE"}</td>
      <td className="px-2 py-1.5">{h.agency ?? NOT_RECORDED}</td>
      <td className="px-2 py-1.5">{h.type ?? NOT_RECORDED}</td>
      <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
        {h.start ? fmtDate(h.start) : NOT_RECORDED}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
        {h.end === "Indefinite" ? (
          <span className="font-sans">Indefinite</span>
        ) : h.end ? (
          fmtDate(h.end)
        ) : (
          <span className="font-sans text-muted-foreground">
            {h.list === "leie" ? "No reinstatement date" : NOT_RECORDED}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5">{h.place ?? NOT_RECORDED}</td>
      <td className="whitespace-nowrap px-2 py-1.5">
        {h.sourceUrl ? (
          <SourceLink href={h.sourceUrl}>
            {h.list === "sam" ? "SAM.gov record" : "LEIE file"}
          </SourceLink>
        ) : (
          NOT_RECORDED
        )}
      </td>
    </tr>
  );
}
