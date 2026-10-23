import { Fragment, useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  AMOUNT_BUCKETS,
  getSecActions,
  type AmountBucket,
  type SecAction,
} from "@/lib/external/enforcementActions.functions";
import { cn } from "@/lib/utils";
import { LoadingBlock, Panel, SourceLink, StateNote } from "../parts";
import {
  AmountList,
  Chip,
  CompanyList,
  CourtList,
  DetailRow,
  FilterSelect,
  Pager,
  SearchBox,
} from "./bits";
import { fmtUsd, NOT_RECORDED } from "./format";

type Filters = {
  type?: "litigation_release" | "administrative_proceeding" | undefined;
  year?: string | undefined;
  amount?: AmountBucket | undefined;
  q: string;
  page: number;
};

const THIS_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1995 + 1 }, (_, i) => String(THIS_YEAR - i));

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SecActions() {
  const [f, setF] = useState<Filters>({ q: "", page: 0 });
  const set = (next: Partial<Filters>) => setF((cur) => ({ ...cur, page: 0, ...next }));
  const q = useDebounced(f.q, 350);
  const res = useQuery({
    queryKey: ["enforcement-actions", "sec", f.type, f.year, f.amount, q, f.page],
    queryFn: () =>
      getSecActions({
        data: { type: f.type, year: f.year, amount: f.amount, q: q || undefined, page: f.page },
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  return (
    <Panel
      title="SEC enforcement actions"
      subtitle="Litigation releases (federal court actions) and administrative proceedings, as the SEC lists them, newest first"
      footnote={
        <>
          Source: sec.gov litigation releases and administrative proceedings lists. Respondents are
          shown exactly as the SEC lists them. For litigation releases, civil action numbers, courts
          and dollar figures are quoted from the release text; administrative proceedings are listed
          with their release and file numbers only.
        </>
      }
    >
      <div className="grid grid-cols-1 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label="Type"
          value={f.type}
          onChange={(v) => set({ type: v as Filters["type"] })}
          options={[
            { value: "litigation_release", label: "Litigation releases" },
            { value: "administrative_proceeding", label: "Administrative proceedings" },
          ]}
        />
        <FilterSelect
          label="Year"
          value={f.year}
          onChange={(v) => set({ year: v })}
          options={YEARS.map((y) => ({ value: y, label: y }))}
        />
        <FilterSelect
          label="Largest resolution figure (litigation releases)"
          value={f.amount}
          onChange={(v) => set({ amount: v as AmountBucket | undefined })}
          options={AMOUNT_BUCKETS.map((b) => ({ value: b.id, label: b.label }))}
        />
        <SearchBox
          label="Search respondents or numbers"
          value={f.q}
          onChange={(v) => set({ q: v })}
          placeholder="e.g. LR-26675 or a name"
        />
      </div>
      {res.isLoading ? (
        <div className="p-3">
          <LoadingBlock label="Loading SEC actions" />
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
            SEC actions could not be loaded.
          </StateNote>
        </div>
      ) : !res.data?.rows.length ? (
        <div className="p-3">
          <StateNote>
            {!f.type && !f.year && !f.amount && !q
              ? "SEC enforcement actions have not been published yet."
              : "No SEC action matches these filters."}
          </StateNote>
        </div>
      ) : (
        <>
          <SecTable rows={res.data.rows} stale={res.isPlaceholderData} />
          <Pager
            page={f.page}
            pageSize={res.data.pageSize}
            total={res.data.total}
            shown={res.data.rows.length}
            onPage={(p) => setF((cur) => ({ ...cur, page: p }))}
            noun="actions"
          />
        </>
      )}
    </Panel>
  );
}

function SecTable({ rows, stale }: { rows: SecAction[]; stale: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cn("overflow-x-auto", stale && "opacity-60")}>
      <table className="w-full text-xs">
        <caption className="sr-only">SEC enforcement actions</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="w-6 px-2 py-1.5">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Date
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Respondents (as listed)
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">
              Release
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium md:table-cell">
              Civil action / file no.
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Largest resolution figure stated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => {
            const expanded = open === r.id;
            return (
              <Fragment key={r.id}>
                <tr className="align-top">
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`sec-${r.id}`}
                      onClick={() => setOpen(expanded ? null : r.id)}
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
                  <td className="whitespace-nowrap px-2 py-1 font-mono">
                    {r.date ?? NOT_RECORDED}
                  </td>
                  <td className="min-w-[12rem] max-w-[26rem] break-words px-2 py-1">
                    {r.url ? <SourceLink href={r.url}>{r.respondents}</SourceLink> : r.respondents}
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      <Chip tone="muted">{r.type}</Chip>
                      <CompanyList companies={r.companies} />
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-1 font-mono sm:table-cell">
                    {r.releaseNumber}
                  </td>
                  <td className="hidden max-w-48 px-2 py-1 md:table-cell">
                    {r.type === "Litigation release"
                      ? r.civilActions.join("; ") || (
                          <span className="text-muted-foreground">Not stated</span>
                        )
                      : (r.fileNumber ?? <span className="text-muted-foreground">Not listed</span>)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right font-mono">
                    {r.maxResolutionUsd != null ? (
                      fmtUsd(r.maxResolutionUsd)
                    ) : (
                      <span className="font-sans text-muted-foreground">
                        {r.type === "Litigation release" ? "None stated" : "Not in the list"}
                      </span>
                    )}
                  </td>
                </tr>
                {expanded ? (
                  <tr id={`sec-${r.id}`}>
                    <td colSpan={6} className="bg-muted/30 px-3 py-2">
                      <dl className="space-y-1.5">
                        <DetailRow label="Release number">{r.releaseNumber}</DetailRow>
                        {r.series ? <DetailRow label="Release series">{r.series}</DetailRow> : null}
                        {r.type === "Litigation release" ? (
                          <>
                            <DetailRow label="Civil action number">
                              {r.civilActions.join("; ") || "Not stated in the release"}
                            </DetailRow>
                            <DetailRow label="Court">
                              <CourtList courts={r.courts} />
                            </DetailRow>
                            <DetailRow label="Dollar figures stated">
                              <AmountList amounts={r.amounts} />
                            </DetailRow>
                            <DetailRow label="Statutes cited">
                              {r.statutes.join("; ") || "None found"}
                            </DetailRow>
                            {r.excerpt ? (
                              <DetailRow label="Release text (opening)">
                                <span className="block whitespace-pre-line text-[11px] leading-4">
                                  {r.excerpt}
                                </span>
                              </DetailRow>
                            ) : (
                              <DetailRow label="Release text">
                                <span className="text-muted-foreground">
                                  Not read yet; open the SEC release.
                                </span>
                              </DetailRow>
                            )}
                          </>
                        ) : (
                          <DetailRow label="Administrative file number">
                            {r.fileNumber ?? "Not listed"}
                          </DetailRow>
                        )}
                        {r.seeAlso.length ? (
                          <DetailRow label="Documents">
                            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                              {r.seeAlso.map((d) => (
                                <SourceLink key={d.url} href={d.url}>
                                  {d.label}
                                </SourceLink>
                              ))}
                            </span>
                          </DetailRow>
                        ) : null}
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
