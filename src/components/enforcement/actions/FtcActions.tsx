import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  FTC_KINDS,
  getFtcActions,
  getFtcCases,
  type FtcAction,
  type FtcCase,
  type FtcKind,
} from "@/lib/external/enforcementActions.functions";
import { cn } from "@/lib/utils";
import { Kpi, LoadingBlock, MoreToggle, Panel, SourceLink, StateNote } from "../parts";
import { Chip, CompanyList, CourtList, DetailRow, FilterSelect, Pager, SearchBox } from "./bits";
import { fmtInt, fmtUsd, NOT_RECORDED } from "./format";

export function FtcActions() {
  return (
    <div className="space-y-3">
      <FtcDataSets />
      <FtcCases />
    </div>
  );
}

const KIND_LABEL: Record<FtcKind, string> = Object.fromEntries(
  FTC_KINDS.map((k) => [k.id, k.label]),
) as Record<FtcKind, string>;

function FtcDataSets() {
  const q = useQuery({
    queryKey: ["enforcement-actions", "ftc-actions"],
    queryFn: () => getFtcActions(),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading) return <LoadingBlock label="Loading FTC enforcement actions" />;
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
        FTC enforcement actions could not be loaded.
      </StateNote>
    );
  if (!q.data?.length)
    return <StateNote>FTC enforcement actions have not been published yet.</StateNote>;
  return <DataSetsBody rows={q.data} />;
}

function DataSetsBody({ rows }: { rows: FtcAction[] }) {
  const [kind, setKind] = useState<FtcKind | undefined>();
  const [year, setYear] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const years = useMemo(
    () =>
      [...new Set(rows.map((r) => r.date?.slice(0, 4)).filter((y): y is string => !!y))]
        .sort()
        .reverse(),
    [rows],
  );
  const counts = useMemo(() => {
    const c: Partial<Record<FtcKind, number>> = {};
    for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);
  const penaltyTotal = rows
    .filter((r) => r.kind === "bcp_penalty" && r.orderedAmount != null)
    .reduce((s, r) => s + (r.orderedAmount ?? 0), 0);
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!kind || r.kind === kind) &&
      (!year || r.date?.startsWith(year)) &&
      (!needle ||
        [r.name, r.matterNumber, r.actionType, r.industry, r.basis].some((v) =>
          v?.toLowerCase().includes(needle),
        )),
  );
  const limit = 30;
  const shown = expanded ? filtered.slice(0, 500) : filtered.slice(0, limit);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FTC_KINDS.map((k) => (
          <Kpi key={k.id} label={k.label} value={fmtInt(counts[k.id] ?? 0)} />
        ))}
      </div>
      <Panel
        title="FTC enforcement data sets"
        subtitle="Merger, nonmerger and competition civil-penalty actions (FY1996 onward) and consumer protection civil-penalty orders (FY2000 onward), as the FTC publishes them"
        footnote={
          <>
            Source: FTC enforcement data sets (CC0),
            ftc.gov/policy-notices/open-government/data-sets. Consumer protection civil-penalty
            orders total {fmtUsd(penaltyTotal)} ordered, as listed (an ordered amount is not a
            collected amount). Names the FTC withholds for confidential merger actions stay
            withheld.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-3">
          <FilterSelect
            label="Data file"
            value={kind}
            onChange={(v) => {
              setKind(v as FtcKind | undefined);
              setExpanded(false);
            }}
            options={FTC_KINDS.map((k) => ({ value: k.id, label: k.label }))}
          />
          <FilterSelect
            label="Year"
            value={year}
            onChange={(v) => {
              setYear(v);
              setExpanded(false);
            }}
            options={years.map((y) => ({ value: y, label: y }))}
          />
          <SearchBox
            label="Search"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setExpanded(false);
            }}
            placeholder="Matter, number, industry or statute"
          />
        </div>
        {shown.length ? (
          <div className="overflow-x-auto" id="ftc-actions">
            <table className="w-full text-xs">
              <caption className="sr-only">FTC enforcement actions</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Matter
                  </th>
                  <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">
                    Data file
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Ordered
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-2 py-1 font-mono">
                      {r.date ?? NOT_RECORDED}
                    </td>
                    <td className="min-w-[12rem] px-2 py-1">
                      {r.page ? <SourceLink href={r.page}>{r.name}</SourceLink> : r.name}
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {r.matterNumber ? (
                          <Chip title="FTC matter number">{r.matterNumber}</Chip>
                        ) : null}
                        {r.caseIds[0] ? (
                          <Link
                            to="/records/$dataset/$id"
                            params={{ dataset: "ftc_cases", id: r.caseIds[0] }}
                            className="text-[10px] text-primary hover:underline"
                          >
                            Case page record
                          </Link>
                        ) : null}
                        <CompanyList companies={r.companies} />
                      </span>
                    </td>
                    <td className="hidden px-2 py-1 sm:table-cell">{KIND_LABEL[r.kind]}</td>
                    <td className="max-w-64 px-2 py-1">
                      {r.actionType ?? NOT_RECORDED}
                      {r.basis ? (
                        <span className="block text-[11px] text-muted-foreground">{r.basis}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right font-mono">
                      {r.kind === "bcp_penalty" ? (
                        fmtUsd(r.orderedAmount)
                      ) : (
                        <span className="font-sans text-muted-foreground">Not in file</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 pb-1">
              <MoreToggle
                total={Math.min(filtered.length, 500)}
                limit={limit}
                expanded={expanded}
                onToggle={() => setExpanded((v) => !v)}
                controls="ftc-actions"
                noun="actions"
              />
              {filtered.length > 500 && expanded ? (
                <p className="text-[11px] text-muted-foreground">
                  Showing the newest 500 of {fmtInt(filtered.length)}; narrow the filters to see the
                  rest.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="p-3">
            <StateNote>No FTC action matches these filters.</StateNote>
          </div>
        )}
      </Panel>
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type CaseFilters = {
  actionType?: "Federal" | "Administrative" | undefined;
  status?: "Pending" | "Closed" | undefined;
  mission?: "Competition" | "Consumer Protection" | undefined;
  q: string;
  page: number;
};

function FtcCases() {
  const [f, setF] = useState<CaseFilters>({ q: "", page: 0 });
  const set = (next: Partial<CaseFilters>) => setF((cur) => ({ ...cur, page: 0, ...next }));
  const q = useDebounced(f.q, 350);
  const res = useQuery({
    queryKey: ["enforcement-actions", "ftc-cases", f.actionType, f.status, f.mission, q, f.page],
    queryFn: () =>
      getFtcCases({
        data: {
          actionType: f.actionType,
          status: f.status,
          mission: f.mission,
          q: q || undefined,
          page: f.page,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  return (
    <Panel
      title="FTC cases and proceedings"
      subtitle="FTC Legal Library: case name, matter number, civil action and docket numbers, court and the documents listed on each case page"
      footnote="Source: ftc.gov Legal Library (read one page every 5 seconds, as the site's robots.txt asks). Cases whose page has not been read yet show their listing details only."
    >
      <div className="grid grid-cols-1 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label="Type of action"
          value={f.actionType}
          onChange={(v) => set({ actionType: v as CaseFilters["actionType"] })}
          options={[
            { value: "Federal", label: "Federal court" },
            { value: "Administrative", label: "Administrative" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={f.status}
          onChange={(v) => set({ status: v as CaseFilters["status"] })}
          options={[
            { value: "Pending", label: "Pending" },
            { value: "Closed", label: "Closed" },
          ]}
        />
        <FilterSelect
          label="Mission (FTC tag)"
          value={f.mission}
          onChange={(v) => set({ mission: v as CaseFilters["mission"] })}
          options={[
            { value: "Competition", label: "Competition" },
            { value: "Consumer Protection", label: "Consumer Protection" },
          ]}
        />
        <SearchBox
          label="Search"
          value={f.q}
          onChange={(v) => set({ q: v })}
          placeholder="Case name or number"
        />
      </div>
      {res.isLoading ? (
        <div className="p-3">
          <LoadingBlock label="Loading FTC cases" />
        </div>
      ) : res.isError ? (
        <div className="p-3">
          <StateNote
            tone="error"
            action={
              <button type="button" className="underline" onClick={() => void res.refetch()}>
                Retry
              </button>
            }
          >
            FTC cases could not be loaded.
          </StateNote>
        </div>
      ) : !res.data?.rows.length ? (
        <div className="p-3">
          <StateNote>
            {!f.actionType && !f.status && !f.mission && !q
              ? "FTC cases have not been published yet."
              : "No FTC case matches these filters."}
          </StateNote>
        </div>
      ) : (
        <>
          <CaseTable rows={res.data.rows} stale={res.isPlaceholderData} />
          <Pager
            page={f.page}
            pageSize={res.data.pageSize}
            total={res.data.total}
            shown={res.data.rows.length}
            onPage={(p) => setF((cur) => ({ ...cur, page: p }))}
            noun="cases"
          />
        </>
      )}
    </Panel>
  );
}

function CaseTable({ rows, stale }: { rows: FtcCase[]; stale: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cn("overflow-x-auto", stale && "opacity-60")}>
      <table className="w-full text-xs">
        <caption className="sr-only">FTC cases and proceedings</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="w-6 px-2 py-1.5">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Case
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Type
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">
              Status
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium md:table-cell">
              Numbers
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Updated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((c) => {
            const expanded = open === c.id;
            return (
              <Fragment key={c.id}>
                <tr className="align-top">
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`ftc-${c.id}`}
                      onClick={() => setOpen(expanded ? null : c.id)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {expanded ? (
                        <ChevronDown className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronRight className="size-3.5" aria-hidden />
                      )}
                      <span className="sr-only">{expanded ? "Hide details" : "Show details"}</span>
                    </button>
                  </td>
                  <td className="min-w-[12rem] px-2 py-1">
                    {c.url ? <SourceLink href={c.url}>{c.name}</SourceLink> : c.name}
                    <CompanyList companies={c.companies} />
                  </td>
                  <td className="px-2 py-1">{c.actionType ?? NOT_RECORDED}</td>
                  <td className="hidden px-2 py-1 sm:table-cell">{c.status ?? NOT_RECORDED}</td>
                  <td className="hidden max-w-56 px-2 py-1 md:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {[...c.matterNumbers, ...c.civilActionNumbers, ...c.docketNumbers]
                        .slice(0, 4)
                        .map((n) => (
                          <Chip key={n}>{n}</Chip>
                        ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono">
                    {c.lastUpdated ?? NOT_RECORDED}
                  </td>
                </tr>
                {expanded ? (
                  <tr id={`ftc-${c.id}`}>
                    <td colSpan={6} className="bg-muted/30 px-3 py-2">
                      <dl className="space-y-1.5">
                        <DetailRow label="FTC matter/file number">
                          {c.matterNumbers.join("; ") || NOT_RECORDED}
                        </DetailRow>
                        <DetailRow label="Civil action number">
                          {c.civilActionNumbers.join("; ") || "None listed"}
                        </DetailRow>
                        <DetailRow label="Docket number">
                          {c.docketNumbers.join("; ") || "None listed"}
                        </DetailRow>
                        <DetailRow label="Federal court">
                          <CourtList courts={c.courts} />
                        </DetailRow>
                        {c.tags.length ? (
                          <DetailRow label="Tags">{c.tags.join("; ")}</DetailRow>
                        ) : null}
                        {c.summary ? (
                          <DetailRow label="Summary (FTC)">{c.summary}</DetailRow>
                        ) : null}
                        <DetailRow
                          label={
                            c.pageRead
                              ? `Documents (${fmtInt(c.documentsTotal ?? c.documents.length)}${(c.documentsTotal ?? 0) > c.documents.length ? `, newest ${c.documents.length} shown` : ""})`
                              : "Documents"
                          }
                        >
                          {!c.pageRead ? (
                            <span className="text-muted-foreground">
                              Case page not read yet; open the FTC page for its documents.
                            </span>
                          ) : c.documents.length ? (
                            <ul className="space-y-0.5">
                              {c.documents.map((d) => (
                                <li key={d.url + d.title} className="flex min-w-0 gap-2">
                                  <span className="w-20 shrink-0 font-mono text-muted-foreground">
                                    {d.date ?? "—"}
                                  </span>
                                  <span className="min-w-0 break-words">
                                    <SourceLink href={d.url}>{d.title}</SourceLink>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted-foreground">No documents listed</span>
                          )}
                        </DetailRow>
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
