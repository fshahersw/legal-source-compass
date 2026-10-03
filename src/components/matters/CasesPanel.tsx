import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  DataTable,
  EmptyState,
  FilterField,
  LinkOut,
  Loading,
  NotRecorded,
  Panel,
  RangePager,
  Scope,
  selectClass,
  td,
  th,
} from "@/components/matters/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EVIDENCE_LABELS,
  EVIDENCE_NOTES,
  filterCases,
  scopedFacets,
  sortCases,
  type CaseEvidence,
  type CaseFilter,
  type CaseRole,
  type CaseRow,
  type CaseSort,
  type FacetOption,
} from "@/lib/matters/cases";
import { getMatterCases, getMatterFjcCases } from "@/lib/matters/matters.functions";
import type { MatterOverviewPayload } from "@/lib/matters/types";

const PAGE = 50;

function Facet({
  label,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (v: string) => void;
  allLabel: string;
}) {
  return (
    <FilterField label={label}>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count.toLocaleString()})
          </option>
        ))}
      </select>
    </FilterField>
  );
}

function EvidenceChip({ evidence, detail }: { evidence: CaseEvidence; detail: string | null }) {
  const historical = evidence === "fjc_idb";
  return (
    <Chip
      tone={historical ? "warning" : evidence === "master_docket" ? "primary" : "neutral"}
      title={`${EVIDENCE_NOTES[evidence]}${detail ? `\n\nSource: ${detail}` : ""}`}
    >
      {EVIDENCE_LABELS[evidence]}
    </Chip>
  );
}

function CaseTable({ rows, showRoute }: { rows: CaseRow[]; showRoute: boolean }) {
  return (
    <DataTable caption="Member cases and their membership evidence">
      <thead>
        <tr>
          <th className={th} scope="col">
            Docket
          </th>
          <th className={th} scope="col">
            Court
          </th>
          <th className={th} scope="col">
            Filed
          </th>
          <th className={th} scope="col">
            Terminated
          </th>
          <th className={th} scope="col">
            Status
          </th>
          <th className={th} scope="col">
            Role
          </th>
          <th className={th} scope="col">
            Membership evidence
          </th>
          {showRoute ? (
            <th className={th} scope="col">
              Route
            </th>
          ) : null}
          <th className={th} scope="col">
            Defendant (as recorded)
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-muted/40">
            <td className={td}>
              <div className="font-mono text-[12px]">{r.docketNumber ?? <NotRecorded />}</div>
              {r.caption ? (
                <div className="max-w-[22rem] text-[11px] text-muted-foreground">{r.caption}</div>
              ) : r.captionWithheld ? (
                <div className="text-[10px] text-muted-foreground">
                  Caption withheld by the source
                </div>
              ) : null}
              {r.sourceUrl ? (
                <div className="text-[11px]">
                  <LinkOut href={r.sourceUrl}>CourtListener</LinkOut>
                </div>
              ) : null}
            </td>
            <td className={td}>
              {r.courtId ? (
                <Link
                  to="/courts/$id"
                  params={{ id: r.courtId }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {r.courtId}
                </Link>
              ) : (
                <NotRecorded />
              )}
            </td>
            <td className={`${td} whitespace-nowrap font-mono`}>
              {r.dateFiled ?? <NotRecorded />}
            </td>
            <td className={`${td} whitespace-nowrap font-mono`}>
              {r.dateTerminated ?? <span className="text-muted-foreground">—</span>}
            </td>
            <td className={td}>
              {r.status ? (
                <span className="capitalize">{r.status.replace(/_/g, " ")}</span>
              ) : (
                <NotRecorded />
              )}
            </td>
            <td className={td}>
              {r.role === "master" ? (
                <Chip tone="primary">Master</Chip>
              ) : r.role === "member" ? (
                "Member"
              ) : (
                "Unknown"
              )}
            </td>
            <td className={td}>
              <EvidenceChip evidence={r.evidence} detail={r.evidenceDetail} />
            </td>
            {showRoute ? <td className={td}>{r.route ?? <NotRecorded />}</td> : null}
            <td className={`${td} max-w-[12rem]`}>{r.defendant ?? <NotRecorded />}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/** Member cases in the saved docket sample, with evidence-scoped facets computed from this matter's rows only. */
function SampleCases({ payload }: { payload: MatterOverviewPayload }) {
  const mdl = payload.overview.mdl;
  const fn = useServerFn(getMatterCases);
  const q = useQuery({
    queryKey: ["matter-cases", mdl],
    queryFn: () => fn({ data: { id: mdl } }),
    staleTime: 5 * 60_000,
  });
  const [filter, setFilter] = useState<CaseFilter>({});
  const [sort, setSort] = useState<CaseSort>("filed-desc");
  const [offset, setOffset] = useState(0);
  const rows = q.data?.rows ?? [];
  const filtered = useMemo(() => sortCases(filterCases(rows, filter), sort), [rows, filter, sort]);
  const facets = useMemo(() => scopedFacets(rows, filter), [rows, filter]);
  const set = (patch: Partial<CaseFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setOffset(0);
  };
  const active = Object.values(filter).some((v) => v);
  const page = filtered.slice(offset, offset + PAGE);
  const jpmlTotal = payload.overview.actions.total;

  if (q.isLoading) return <Loading what="member cases" />;
  if (q.error) return <ExternalError error={q.error} />;
  if (!q.data) return <EmptyState>This matter has no cases in the connected corpus.</EmptyState>;

  return (
    <div className="space-y-3">
      <Scope title="Scope">
        The corpus lists {rows.length.toLocaleString()} {rows.length === 1 ? "docket" : "dockets"}{" "}
        for this MDL: the master docket
        {rows.length > 1
          ? ` and ${(rows.length - rows.filter((r) => r.role === "master").length).toLocaleString()} from the saved docket sample`
          : ""}
        {q.data.inventoryPublished ? "" : " (the saved docket sample is not published)"}.{" "}
        {jpmlTotal !== null ? (
          <>
            The JPML listing counts {jpmlTotal.toLocaleString()} actions
            {payload.overview.asOf ? ` as of ${payload.overview.asOf}` : ""}; the corpus holds only
            the dockets listed below, so these counts are never the size of the MDL.{" "}
          </>
        ) : null}
        <span className="block pt-1">
          Membership comes from the evidence shown on each row. A parent-docket reference is not
          membership, and no row was added by guessing.
        </span>
      </Scope>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        <div className="sm:col-span-2">
          <FilterField label="Search">
            <Input
              aria-label="Search member cases"
              className="h-8 text-[12px]"
              placeholder="Docket, court, defendant"
              value={filter.q ?? ""}
              onChange={(e) => set({ q: e.target.value })}
            />
          </FilterField>
        </div>
        <Facet
          label="Court"
          value={filter.court ?? ""}
          options={facets.court}
          allLabel="All courts"
          onChange={(v) => set({ court: v })}
        />
        <Facet
          label="Filed year"
          value={filter.year ?? ""}
          options={facets.year}
          allLabel="Any year"
          onChange={(v) => set({ year: v })}
        />
        <Facet
          label="Status"
          value={filter.status ?? ""}
          options={facets.status}
          allLabel="Any status"
          onChange={(v) => set({ status: v })}
        />
        <Facet
          label="Membership evidence"
          value={filter.evidence ?? ""}
          options={facets.evidence}
          allLabel="Any evidence"
          onChange={(v) => set({ evidence: v as CaseEvidence | "" })}
        />
        <Facet
          label="Role"
          value={filter.role ?? ""}
          options={facets.role}
          allLabel="Any role"
          onChange={(v) => set({ role: v as CaseRole | "" })}
        />
        {facets.routeRecorded ? (
          <Facet
            label="Route into the MDL"
            value={filter.route ?? ""}
            options={facets.route}
            allLabel="Any route"
            onChange={(v) => set({ route: v })}
          />
        ) : null}
        <FilterField label="Sort">
          <select
            className={selectClass}
            value={sort}
            onChange={(e) => setSort(e.target.value as CaseSort)}
          >
            <option value="filed-desc">Filed, newest first</option>
            <option value="filed-asc">Filed, oldest first</option>
            <option value="docket">Docket number</option>
          </select>
        </FilterField>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span aria-live="polite">
          <span className="font-medium text-foreground tabular-nums">
            {filtered.length.toLocaleString()}
          </span>{" "}
          of {rows.length.toLocaleString()} dockets match
        </span>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[12px]"
            onClick={() => {
              setFilter({});
              setOffset(0);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {filtered.length ? (
        <CaseTable rows={page} showRoute={facets.routeRecorded} />
      ) : (
        <EmptyState>No docket matches these filters.</EmptyState>
      )}
      {!facets.routeRecorded ? (
        <p className="text-[11px] text-muted-foreground">
          Route into the MDL (direct filing, JPML transfer order, tag-along) is not recorded in the
          sources currently loaded, so it is not shown or filterable.
        </p>
      ) : null}
      {filtered.length > PAGE ? (
        <RangePager
          offset={offset}
          pageSize={PAGE}
          shown={page.length}
          total={filtered.length}
          onOffset={setOffset}
        />
      ) : null}
    </div>
  );
}

/** Dockets whose FJC Integrated Database record carries this MDL number — historical/administrative evidence. */
function FjcCases({ mdl, total, capped }: { mdl: string; total: number | null; capped: boolean }) {
  const fn = useServerFn(getMatterFjcCases);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [court, setCourt] = useState("");
  const [draft, setDraft] = useState("");
  const courtOk = /^[a-z0-9]{2,12}$/.test(court);
  const q = useQuery({
    queryKey: ["matter-fjc", mdl, offset, court],
    enabled: open,
    queryFn: () => fn({ data: { id: mdl, offset, court: courtOk ? court : null } }),
    staleTime: 5 * 60_000,
  });
  if (!total) return null;
  return (
    <Panel
      title="Dockets carrying this MDL number in the FJC Integrated Database"
      note="Historical/administrative: the FJC IDB records a multidistrict-litigation docket number on each of these dockets. It is a dated source association, not a current member census, a master designation or a transfer ruling."
      aside={
        <Chip tone="warning">
          {total.toLocaleString()}
          {capped ? "+" : ""} dockets
        </Chip>
      }
    >
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Show FJC-associated dockets
        </Button>
      ) : (
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCourt(draft.trim().toLowerCase());
              setOffset(0);
            }}
          >
            <FilterField label="Exact court id (e.g. njd)">
              <Input
                aria-label="Filter by exact court id"
                className="h-8 w-40 text-[12px]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="All courts"
              />
            </FilterField>
            <Button type="submit" size="sm" variant="outline" className="h-8">
              Apply
            </Button>
            {court ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setCourt("");
                  setDraft("");
                  setOffset(0);
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
          {q.isLoading ? <Loading what="FJC-associated dockets" /> : null}
          {q.error ? <ExternalError error={q.error} /> : null}
          {q.data ? (
            <>
              {q.data.rows.length ? (
                <CaseTable rows={q.data.rows} showRoute={false} />
              ) : (
                <EmptyState>No FJC-associated docket matches.</EmptyState>
              )}
              <RangePager
                offset={q.data.offset}
                pageSize={q.data.pageSize}
                shown={q.data.rows.length}
                total={q.data.total}
                capped={q.data.capped}
                onOffset={setOffset}
              />
              <p className="text-[11px] text-muted-foreground">
                Listed in the source's order. Captions and party names are not projected for these
                dockets.
              </p>
            </>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function CasesPanel({ payload }: { payload: MatterOverviewPayload }) {
  const fn = useServerFn(getMatterCases);
  const q = useQuery({
    queryKey: ["matter-cases", payload.overview.mdl],
    queryFn: () => fn({ data: { id: payload.overview.mdl } }),
    staleTime: 5 * 60_000,
  });
  return (
    <div className="space-y-4">
      <Panel
        id="cases"
        title="Member cases"
        note="Master docket and cases the corpus links to this MDL, each with the evidence for the link."
      >
        <SampleCases payload={payload} />
      </Panel>
      {q.data?.fjc ? (
        <FjcCases mdl={payload.overview.mdl} total={q.data.fjc.total} capped={q.data.fjc.capped} />
      ) : null}
    </div>
  );
}
