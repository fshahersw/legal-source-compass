import { Fragment, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  FRB_FAMILIES,
  getFrbActions,
  type FrbAction,
  type FrbFamily,
} from "@/lib/external/regulatoryRecords.functions";
import { cn } from "@/lib/utils";
import { Chip, DetailRow, FilterSelect, Pager, SearchBox } from "../actions/bits";
import { Kpi, LoadingBlock, Panel, SourceLink, StateNote } from "../parts";
import { FrbTrendChart } from "./FrbTrendChart";
import { dayLabel, fmtInt, frbOverviewQuery, frbYears, NOT_RECORDED } from "./regulatoryView";

type Filters = {
  year?: string | undefined;
  family?: FrbFamily | undefined;
  subject?: "organization" | "individual" | undefined;
  q: string;
  page: number;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The "Federal Reserve" section of /law/enforcement: trend chart, then the Board's list with filters. */
export function FrbActions() {
  const overview = useQuery(frbOverviewQuery);
  const [f, setF] = useState<Filters>({ q: "", page: 0 });
  const set = (next: Partial<Filters>) => setF((cur) => ({ ...cur, page: 0, ...next }));
  const q = useDebounced(f.q, 350);
  const res = useQuery({
    queryKey: ["regulatory-records", "frb-actions", f.year, f.family, f.subject, q, f.page],
    queryFn: () =>
      getFrbActions({
        data: {
          year: f.year,
          family: f.family,
          subject: f.subject,
          q: q || undefined,
          page: f.page,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  const o = overview.data;
  return (
    <div className="min-w-0 space-y-3">
      {overview.isLoading ? (
        <LoadingBlock label="Loading Federal Reserve enforcement actions" />
      ) : overview.isError ? (
        <StateNote
          tone="error"
          action={
            <button type="button" className="underline" onClick={() => void overview.refetch()}>
              Retry
            </button>
          }
        >
          The Federal Reserve enforcement summary could not be loaded.
        </StateNote>
      ) : !o ? (
        <StateNote>Federal Reserve enforcement actions have not been published yet.</StateNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi
              label="Rows in the Board's list"
              value={fmtInt(o.actions)}
              note={`Effective ${dayLabel(o.firstEffectiveDate)} to ${dayLabel(o.latestEffectiveDate)}`}
            />
            <Kpi
              label="Banking organizations named"
              value={fmtInt(o.subjects.organization)}
              note="Rows naming an organization"
            />
            <Kpi
              label="Individuals named"
              value={fmtInt(o.subjects.individual)}
              note="Shown as the Board publishes them"
            />
            <Kpi
              label="Latest effective date"
              value={dayLabel(o.latestEffectiveDate)}
              note={`${o.partialYear} is a partial year`}
            />
          </div>
          <FrbTrendChart overview={o} />
        </>
      )}
      <Panel
        title="Federal Reserve enforcement actions"
        subtitle="Formal actions against banking organizations and individuals, as the Board lists them, newest effective date first"
        footnote={
          <>
            Source:{" "}
            <SourceLink href="https://www.federalreserve.gov/supervisionreg/enforcementactions.htm">
              federalreserve.gov, Enforcement Actions
            </SourceLink>{" "}
            (public-domain Board data, cited to the Board). Names, affiliations, action types and
            dates are exactly as the Board publishes them; individuals appear only where the Board
            names them, with its document link, and nothing is inferred about a person. A
            termination date appears only where the Board publishes one: a blank means none is
            published, not that an action is still in force. A banking organization links to a
            company page only on an exact registrant-name match.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Effective year"
            value={f.year}
            onChange={(v) => set({ year: v })}
            options={(o ? frbYears(o) : []).map((y) => ({ value: y, label: y }))}
          />
          <FilterSelect
            label="Action family"
            value={f.family}
            onChange={(v) => set({ family: v as FrbFamily | undefined })}
            options={FRB_FAMILIES.map((x) => ({ value: x, label: x }))}
          />
          <FilterSelect
            label="Named"
            value={f.subject}
            onChange={(v) => set({ subject: v as Filters["subject"] })}
            options={[
              { value: "organization", label: "Banking organization" },
              { value: "individual", label: "Individual" },
            ]}
          />
          <SearchBox
            label="Search names or actions"
            value={f.q}
            onChange={(v) => set({ q: v })}
            placeholder="e.g. Wells Fargo"
          />
        </div>
        {res.isLoading ? (
          <div className="p-3">
            <LoadingBlock label="Loading Federal Reserve actions" />
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
              Federal Reserve actions could not be loaded.
            </StateNote>
          </div>
        ) : !res.data?.rows.length ? (
          <div className="p-3">
            <StateNote>
              {!f.year && !f.family && !f.subject && !q
                ? "Federal Reserve enforcement actions have not been published yet."
                : "No Federal Reserve action matches these filters."}
            </StateNote>
          </div>
        ) : (
          <>
            <FrbTable rows={res.data.rows} stale={res.isPlaceholderData} />
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
    </div>
  );
}

/** "Wells Fargo & Company, San Francisco, California" (as published) plus any exact-name company links. */
function NamedCell({ a }: { a: FrbAction }) {
  const links = [...a.organizations, ...a.affiliations].flatMap((s) => (s.match ? [s.match] : []));
  const unique = [...new Map(links.map((l) => [l.cik, l])).values()];
  return (
    <>
      <span className="font-medium">{a.individual ?? a.bankingOrganization ?? NOT_RECORDED}</span>
      {a.individual && a.individualAffiliation ? (
        <span className="block text-[11px] text-muted-foreground">
          Affiliation: {a.individualAffiliation}
        </span>
      ) : null}
      <span className="mt-0.5 flex flex-wrap gap-1">
        <Chip tone="muted">
          {a.subject === "individual" ? "Individual" : "Banking organization"}
        </Chip>
        {unique.map((c) => (
          <Link
            key={c.cik}
            to="/companies/$cik"
            params={{ cik: c.cik }}
            className="text-[11px] text-primary hover:underline"
            title="The name equals this SEC registrant's name after exact normalisation"
          >
            {c.registrant}
          </Link>
        ))}
      </span>
    </>
  );
}

function FrbTable({ rows, stale }: { rows: FrbAction[]; stale: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cn("overflow-x-auto", stale && "opacity-60")}>
      <table className="w-full text-xs">
        <caption className="sr-only">Federal Reserve enforcement actions</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="w-6 px-2 py-1.5">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Effective
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Named (as listed)
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Action
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium md:table-cell">
              Terminated
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium sm:table-cell">
              Document
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((a) => {
            const expanded = open === a.id;
            return (
              <Fragment key={a.id}>
                <tr className="align-top">
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`frb-${a.id}`}
                      onClick={() => setOpen(expanded ? null : a.id)}
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
                  <td className="whitespace-nowrap px-2 py-1 font-mono">{a.effectiveDate}</td>
                  <td className="min-w-[12rem] max-w-[26rem] break-words px-2 py-1">
                    <NamedCell a={a} />
                  </td>
                  <td className="min-w-[8rem] break-words px-2 py-1">
                    {a.type}
                    <span className="block text-[11px] text-muted-foreground">{a.typeFamily}</span>
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-1 font-mono md:table-cell">
                    {a.terminationDate ?? (
                      <span className="font-sans text-muted-foreground">None published</span>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-1 sm:table-cell">
                    {a.url ? (
                      <SourceLink href={a.url}>{a.urlLabel ?? "Board document"}</SourceLink>
                    ) : (
                      <span className="text-muted-foreground">No document link published</span>
                    )}
                  </td>
                </tr>
                {expanded ? (
                  <tr id={`frb-${a.id}`}>
                    <td colSpan={6} className="bg-muted/30 px-3 py-2">
                      <FrbDetail a={a} />
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

export function FrbDetail({ a }: { a: FrbAction }) {
  return (
    <dl className="space-y-1.5">
      {a.bankingOrganization ? (
        <DetailRow label="Banking organization">{a.bankingOrganization}</DetailRow>
      ) : null}
      {a.individual ? <DetailRow label="Individual">{a.individual}</DetailRow> : null}
      {a.individualAffiliation ? (
        <DetailRow label="Individual's affiliation">{a.individualAffiliation}</DetailRow>
      ) : null}
      <DetailRow label="Action (as published)">{a.type}</DetailRow>
      <DetailRow label="Effective date">{dayLabel(a.effectiveDate)}</DetailRow>
      <DetailRow label="Termination date">
        {a.terminationDate ? dayLabel(a.terminationDate) : "None published by the Board"}
      </DetailRow>
      {a.note ? (
        <DetailRow label="Board note">
          {a.note}
          {a.noteLinks.map((l) => (
            <span key={l.url} className="ml-2">
              <SourceLink href={l.url}>{l.label}</SourceLink>
            </span>
          ))}
        </DetailRow>
      ) : null}
      <DetailRow label="Document">
        {a.url ? (
          <SourceLink href={a.url}>{a.urlLabel ?? a.url}</SourceLink>
        ) : (
          <span className="text-muted-foreground">No document link published</span>
        )}
        {a.urlUnresolved ? (
          <span className="block text-[11px] text-muted-foreground">
            The Board lists the path "{a.urlUnresolved}", which is not a complete link.
          </span>
        ) : null}
      </DetailRow>
      <DetailRow label="Source">
        <SourceLink href={a.sourceUrl}>{a.sourceUrl}</SourceLink>
      </DetailRow>
    </dl>
  );
}
