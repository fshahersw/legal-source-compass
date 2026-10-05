import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CaseDrawer } from "@/components/matters/CaseDrawer";
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
  BASIS_NOTES,
  EVIDENCE_NOTES,
  ROLE_LABELS,
  captionSourceLabel,
  evidenceKindLabel,
  evidenceKindsOf,
  routeLabel,
  type CaseEvidence,
  type CaseFilter,
  type CaseRole,
  type CaseRow,
  type CaseSort,
  type FacetOption,
  type RegistryLabels,
} from "@/lib/matters/cases";
import {
  getMatterCasesPage,
  getMatterCasesScope,
  getMatterFjcCases,
} from "@/lib/matters/matters.functions";
import type { CasesScope, MatterOverviewPayload } from "@/lib/matters/types";

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

function EvidenceChip({ kind, labels }: { kind: string; labels: RegistryLabels | undefined }) {
  const historical = kind === "fjc_idb" || kind === "fjc_idb_mdl_number";
  const note = BASIS_NOTES[kind] ?? EVIDENCE_NOTES[kind as CaseEvidence];
  return (
    <Chip
      tone={historical ? "warning" : kind === "master_docket" ? "primary" : "neutral"}
      title={note}
    >
      {evidenceKindLabel(kind, labels)}
    </Chip>
  );
}

function EvidenceCell({
  row,
  labels,
  onOpen,
}: {
  row: CaseRow;
  labels: RegistryLabels | undefined;
  onOpen?: ((row: CaseRow) => void) | undefined;
}) {
  const kinds = evidenceKindsOf(row);
  const shown = kinds.slice(0, 2);
  const rest = kinds.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((k) => (
        <EvidenceChip key={k} kind={k} labels={labels} />
      ))}
      {rest.length ? (
        <Chip title={rest.map((k) => evidenceKindLabel(k, labels)).join(", ")}>+{rest.length}</Chip>
      ) : null}
      {row.registry && onOpen ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => onOpen(row)}
          aria-label={`Evidence and documents for ${row.docketNumber ?? "this docket"}`}
        >
          Evidence{row.registry.evidenceCount ? ` (${row.registry.evidenceCount})` : ""} · PDFs
        </Button>
      ) : null}
    </div>
  );
}

function CaseTable({
  rows,
  showRoute,
  labels,
  onOpen,
}: {
  rows: CaseRow[];
  showRoute: boolean;
  labels?: RegistryLabels | undefined;
  onOpen?: ((row: CaseRow) => void) | undefined;
}) {
  // Columns appear only when at least one row records the value, so a column is never a wall of "Not recorded".
  const showTerminated = rows.some((r) => r.dateTerminated);
  const showDefendant = rows.some((r) => r.defendant);
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
          {showTerminated ? (
            <th className={th} scope="col">
              Terminated
            </th>
          ) : null}
          <th className={th} scope="col">
            Status
          </th>
          <th className={th} scope="col">
            Role
          </th>
          {showRoute ? (
            <th className={th} scope="col">
              Route
            </th>
          ) : null}
          <th className={th} scope="col">
            Membership evidence
          </th>
          {showDefendant ? (
            <th className={th} scope="col">
              Defendant (as recorded)
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-muted/40">
            <td className={td}>
              <div className="whitespace-nowrap font-mono text-[12px]">
                {r.docketNumber ?? <NotRecorded />}
              </div>
              {r.caption ? (
                <div
                  className="max-w-[24rem] text-[12px] leading-snug"
                  title={
                    captionSourceLabel(r.registry?.captionSource)
                      ? `Caption as published by: ${captionSourceLabel(r.registry?.captionSource)}`
                      : undefined
                  }
                >
                  {r.caption}
                </div>
              ) : r.captionWithheld ? (
                <div
                  className="text-[10px] text-muted-foreground"
                  title={
                    r.registry
                      ? "No source prints a caption for this docket, or the printed one is withheld under the publication rule (sealed, restricted, in camera, ex parte or redacted wording)."
                      : undefined
                  }
                >
                  {r.registry ? "No caption published" : "Caption withheld by the source"}
                </div>
              ) : null}
              {r.registry?.links.length ? (
                <div className="flex flex-wrap gap-x-3 text-[11px]">
                  {r.registry.links.slice(0, 3).map((l) => (
                    <LinkOut key={l.url} href={l.url}>
                      {l.label}
                    </LinkOut>
                  ))}
                </div>
              ) : r.sourceUrl ? (
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
            {showTerminated ? (
              <td className={`${td} whitespace-nowrap font-mono`}>
                {r.dateTerminated ?? <span className="text-muted-foreground">—</span>}
              </td>
            ) : null}
            <td className={td}>
              {r.status ? (
                <span className="capitalize">{r.status.replace(/_/g, " ")}</span>
              ) : (
                <NotRecorded />
              )}
            </td>
            <td className={td}>
              {r.role === "master" ? (
                <Chip tone="primary">{labels?.role?.[r.role] ?? ROLE_LABELS[r.role]}</Chip>
              ) : (
                (labels?.role?.[r.role] ?? ROLE_LABELS[r.role])
              )}
            </td>
            {showRoute ? (
              <td className={td}>{r.route ? routeLabel(r.route) : <NotRecorded />}</td>
            ) : null}
            <td className={td}>
              <EvidenceCell row={r} labels={labels} onOpen={onOpen} />
            </td>
            {showDefendant ? (
              <td className={`${td} max-w-[12rem]`}>{r.defendant ?? <NotRecorded />}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function ScopeNote({ payload, scope }: { payload: MatterOverviewPayload; scope: CasesScope }) {
  const o = payload.overview;
  const jpmlTotal = o.actions.total;
  const jpmlPending = o.actions.pending;
  const registryRows = scope.registryRows;
  return (
    <div className="space-y-2">
      {scope.registryTruncated ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-[13px] text-foreground">
          <p>
            Searching <strong>{scope.listed.toLocaleString()} loaded dockets</strong> of{" "}
            <strong>{registryRows.toLocaleString()} registry records</strong>. Filters and counts on
            this page cover the loaded dockets only.
          </p>
          <Link
            to="/data/$dataset"
            params={{ dataset: "sw_matter_dockets_v1" }}
            search={{ f: { mdl: payload.overview.mdl } }}
            className="font-semibold text-primary underline underline-offset-2"
          >
            Search all registry records
          </Link>
        </div>
      ) : null}
      <details className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          About this list’s coverage and membership
        </summary>
        <div className="mt-2 space-y-1.5">
          {registryRows > 0 ? (
            <p>
              The matter registry records {registryRows.toLocaleString()} dockets for this MDL.
              {scope.registryTruncated
                ? ` Role counts here describe the ${scope.listed.toLocaleString()} loaded dockets: ${scope.roles.map((r) => `${r.label.toLowerCase()} ${r.count.toLocaleString()}`).join(", ")}.`
                : ` Roles: ${scope.roles.map((r) => `${r.label.toLowerCase()} ${r.count.toLocaleString()}`).join(", ")}.`}
            </p>
          ) : (
            <p>
              The corpus lists {scope.listed.toLocaleString()} dockets for this MDL
              {scope.inventoryPublished ? "." : "; the saved docket sample is not published."}
            </p>
          )}
          {scope.actionRows > 0 ? (
            <p>
              {scope.registryTruncated ? "Among loaded dockets, " : ""}
              {scope.actionRows.toLocaleString()} {scope.actionRows === 1 ? "row is" : "rows are"}{" "}
              counted as actions. A transferred action may have transferor and transferee rows, but
              only one carries the count.
            </p>
          ) : null}
          {jpmlTotal !== null || jpmlPending !== null ? (
            <p>
              JPML report{o.asOf ? ` dated ${o.asOf}` : ""}:{" "}
              {jpmlPending !== null
                ? `${jpmlPending.toLocaleString()} pending`
                : "pending count not recorded"}
              {jpmlTotal !== null ? ` and ${jpmlTotal.toLocaleString()} historical actions` : ""}.
            </p>
          ) : null}
          <p>
            Membership is supported by the evidence shown on each row; a parent-docket reference
            alone does not establish membership.
          </p>
        </div>
      </details>
    </div>
  );
}

/** A filter without one key (the optional keys cannot hold undefined). */
function without(filter: CaseFilter, key: keyof CaseFilter): CaseFilter {
  const next = { ...filter };
  delete next[key];
  return next;
}

/**
 * Member cases (matter registry + saved docket sample). The server filters, sorts, counts and facets the whole list and
 * returns one page, so the browser never holds the list; facet counts are scoped to this matter's rows.
 */
function SampleCases({ payload }: { payload: MatterOverviewPayload }) {
  const mdl = payload.overview.mdl;
  const fn = useServerFn(getMatterCasesPage);
  const [filter, setFilter] = useState<CaseFilter>({});
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<CaseSort>("filed-desc");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<CaseRow | null>(null);
  // The search box is debounced into the filter so each keystroke is not a server round trip.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const text = draft.trim();
      setFilter((f) => ((f.q ?? "") === text ? f : text ? { ...f, q: text } : without(f, "q")));
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const q = useQuery({
    queryKey: ["matter-cases-page", mdl, filter, sort, offset],
    queryFn: () => fn({ data: { id: mdl, filter: { q: "", ...filter }, sort, offset } }),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
  const set = (patch: Partial<CaseFilter>) => {
    setFilter((f) => {
      const next: CaseFilter = { ...f, ...patch };
      for (const k of Object.keys(next) as (keyof CaseFilter)[]) if (!next[k]) delete next[k];
      return next;
    });
    setOffset(0);
  };
  const data = q.data;
  const active = Object.values(filter).some((v) => v);

  if (q.isLoading) return <Loading what="member cases" />;
  if (q.error) return <ExternalError error={q.error} />;
  if (!data) return <EmptyState>This matter has no cases in the connected corpus.</EmptyState>;
  const { facets, scope } = data;
  const labels = scope.labels;

  return (
    <div className="space-y-3">
      <ScopeNote payload={payload} scope={scope} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        <div className="sm:col-span-2">
          <FilterField label="Search">
            <Input
              aria-label="Search member cases"
              className="h-8 text-[12px]"
              placeholder="Docket number, court or provider case id"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
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
        {facets.status.length ? (
          <Facet
            label="Status"
            value={filter.status ?? ""}
            options={facets.status}
            allLabel="Any status"
            onChange={(v) => set({ status: v })}
          />
        ) : null}
        <Facet
          label="Membership evidence"
          value={filter.evidence ?? ""}
          options={facets.evidence}
          allLabel="Any evidence"
          onChange={(v) => set({ evidence: v })}
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
        {facets.actionRows > 0 ? (
          <FilterField label="Count">
            <select
              className={selectClass}
              value={filter.actions ?? ""}
              onChange={(e) => set({ actions: e.target.value === "action" ? "action" : "" })}
            >
              <option value="">All dockets</option>
              <option value="action">
                Counted as an action ({facets.actionRows.toLocaleString()})
              </option>
            </select>
          </FilterField>
        ) : null}
        <FilterField label="Sort">
          <select
            className={selectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as CaseSort);
              setOffset(0);
            }}
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
            {data.total.toLocaleString()}
          </span>{" "}
          {scope.registryTruncated
            ? `matches among ${scope.listed.toLocaleString()} loaded dockets`
            : `of ${scope.listed.toLocaleString()} dockets match`}
        </span>
        {active || draft ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[12px]"
            onClick={() => {
              setFilter({});
              setDraft("");
              setOffset(0);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {data.rows.length ? (
        <div className={q.isFetching ? "opacity-70 transition-opacity" : ""}>
          <CaseTable
            rows={data.rows}
            showRoute={facets.routeRecorded}
            labels={labels}
            onOpen={setOpen}
          />
        </div>
      ) : (
        <EmptyState>No docket matches these filters.</EmptyState>
      )}
      {!facets.routeRecorded ? (
        <p className="text-[11px] text-muted-foreground">
          Route into the MDL (direct filing, JPML transfer order, tag-along) is not recorded in the
          sources currently loaded, so it is not shown or filterable.
        </p>
      ) : null}
      {facets.evidence.reduce((n, o) => n + o.count, 0) > data.total ? (
        <p className="text-[11px] text-muted-foreground">
          A docket with several kinds of evidence is counted once under each kind, so the evidence
          counts can add up to more than the number of dockets.
        </p>
      ) : null}
      {data.total > data.pageSize ? (
        <RangePager
          offset={data.offset}
          pageSize={data.pageSize}
          shown={data.rows.length}
          total={data.total}
          onOffset={setOffset}
        />
      ) : null}
      <CaseDrawer mdl={mdl} row={open} labels={labels} onClose={() => setOpen(null)} />
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
  const fn = useServerFn(getMatterCasesScope);
  // Same cached server list as the pages; only the FJC count is needed here.
  const scope = useQuery({
    queryKey: ["matter-cases-scope", payload.overview.mdl],
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
      {scope.data?.fjc ? (
        <FjcCases
          mdl={payload.overview.mdl}
          total={scope.data.fjc.total}
          capped={scope.data.fjc.capped}
        />
      ) : null}
    </div>
  );
}
