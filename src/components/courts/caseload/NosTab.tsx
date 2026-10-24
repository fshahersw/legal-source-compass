import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { int, shareOf } from "@/components/analysis/analysisFormat";
import { HowToRead } from "@/components/analysis/HowToRead";
import { Kpi, LoadingBlock, Panel, Segmented, StateNote } from "@/components/enforcement/parts";
import type { DistrictRow, NosDetail, NosRow } from "@/lib/external/courtCaseload.functions";
import { VolumeChart } from "./CaseloadCharts";
import {
  FilterSelect,
  ListCoverage,
  MixPanels,
  ResetButton,
  RetryNote,
  SearchBox,
  SortTh,
  TableScroll,
} from "./CaseloadParts";
import {
  fillYearGaps,
  fyLabel,
  NOT_RECORDED,
  partialText,
  pct,
  shortCourtName,
  windowLabel,
  yearOf,
} from "./caseloadFormat";
import {
  districtsQuery,
  methodQuery,
  nationalQuery,
  nosDetailQuery,
  nosQuery,
} from "./caseloadQueries";
import { patchSearch } from "./caseloadSearch";
import {
  encodeSort,
  filterNos,
  nextSort,
  NOS_DEFAULT_SORT,
  NOS_SORT_KEYS,
  parseSort,
  sortNos,
  type NosSortKey,
} from "./caseloadTables";
import type { TabProps } from "./DistrictsTab";
import { useJumpWhenShown } from "./useJumpWhenShown";

const SELECT_HINT =
  "Select a nature-of-suit code or group in the table to see its national series, the districts that file it most and how its cases end.";

export function NosTab({ search, onSearch }: TabProps) {
  const nos = useQuery(nosQuery);
  const national = useQuery(nationalQuery);
  const method = useQuery(methodQuery);
  const districts = useQuery(districtsQuery);

  if (nos.isLoading) return <LoadingBlock label="Loading nature-of-suit caseloads" />;
  if (nos.isError)
    return (
      <RetryNote onRetry={() => void nos.refetch()}>
        The nature-of-suit table could not be loaded.
      </RetryNote>
    );
  const list = nos.data;
  if (!list?.rows.length)
    return <StateNote>The nature-of-suit caseload has not been published yet.</StateNote>;
  const latestFy = national.data?.latestFy ?? method.data?.latestCompleteFy ?? null;
  return (
    <div className="space-y-3">
      <NosTable
        search={search}
        onSearch={onSearch}
        rows={list.rows}
        total={list.total}
        dropped={list.dropped}
        fy={latestFy}
      />
      <NosDetailPanel
        id={search.nos}
        rows={list.rows}
        districts={districts.data?.rows ?? []}
        latestFy={latestFy}
        through={method.data?.through ?? null}
        search={search}
        onClear={() => onSearch({ nos: undefined })}
      />
      <HowToRead
        title="How to read the nature-of-suit figures"
        measures={[
          {
            term: "Nature of suit",
            means:
              "The code the filer assigns on the civil cover sheet (110 Insurance, 365 Personal Injury - Product Liability, 440 Other Civil Rights and so on), as listed in the IDB codebook.",
            caveat:
              "A code is the filer's classification, not a finding of what the case was about.",
          },
          {
            term: "Group",
            means:
              "This project's grouping of nature-of-suit codes into topics, plus one for codes that are in no group. It is not an FJC or AO category; each group lists its codes.",
          },
          {
            term: "Filed and terminated",
            means:
              "National counts across all districts for the latest complete fiscal year. Terminations can exceed filings when a mass-tort docket is closed out in bulk.",
            caveat:
              "The fiscal year in progress is shown only as a dashed partial year on the charts.",
          },
          {
            term: "Median days, settled, trial",
            means:
              "Median days from filing to termination, the share of terminations coded settled, and the share by trial judgment, over cases terminated in the year.",
          },
          {
            term: "Codes with no cases",
            means:
              "A code with no case filed or terminated in the latest complete year has no figures for it; they show as Not recorded rather than zero.",
          },
        ]}
      />
    </div>
  );
}

function NosTable({
  search,
  onSearch,
  rows,
  total,
  dropped,
  fy,
}: TabProps & { rows: NosRow[]; total: number | null; dropped: number; fy: number | null }) {
  const spec = parseSort(search.sort, NOS_SORT_KEYS, NOS_DEFAULT_SORT);
  const groups = useMemo(
    () =>
      rows
        .filter((r) => r.kind === "group" && r.groupKey)
        .map((r) => ({ id: r.groupKey!, label: r.name })),
    [rows],
  );
  const groupLabel = useMemo(() => new Map(groups.map((g) => [g.id, g.label])), [groups]);
  const shown = useMemo(
    () =>
      sortNos(
        filterNos(rows, {
          q: search.q,
          kind: search.kind,
          group: search.group,
          activeOnly: search.active === "yes",
        }),
        spec,
      ),
    [rows, search.q, search.kind, search.group, search.active, spec],
  );
  const year = fy == null ? "the latest complete year" : fyLabel(fy);
  const filtered = Boolean(search.q || search.kind || search.group || search.active);
  const reset = () =>
    onSearch({ q: undefined, kind: undefined, group: undefined, active: undefined });
  const sortBy = (key: NosSortKey) =>
    onSearch({
      sort: encodeSort(nextSort(spec, key, !["name", "code"].includes(key)), NOS_DEFAULT_SORT),
    });
  const head = (
    key: NosSortKey,
    label: string,
    title: string,
    align: "left" | "right" = "right",
  ) => (
    <SortTh
      label={label}
      title={title}
      align={align}
      active={spec.key === key}
      desc={spec.desc}
      onSort={() => sortBy(key)}
    />
  );
  return (
    <Panel
      id="caseload-nos"
      title="Nature of suit"
      subtitle={`National civil filings and terminations by nature-of-suit code and by this project's groups, ${year}`}
      actions={
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(rows.length)} rows
        </span>
      }
      footnote={`National figures across all districts. Groups are this project's grouping of the codebook's codes, not FJC categories. Median days, settled and trial shares are over cases terminated in ${year}; pro se and class action are shares of that year's filings.`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search nature-of-suit codes"
          placeholder="Search code or name"
        />
        <Segmented
          label="Kind"
          value={search.kind ?? "all"}
          options={[
            { id: "all", label: "All" },
            { id: "group", label: "Groups" },
            { id: "nos", label: "Codes" },
          ]}
          onChange={(k) => onSearch({ kind: k === "all" ? undefined : k })}
        />
        <FilterSelect
          label="Group"
          value={search.group}
          onChange={(group) => onSearch({ group })}
          options={groups}
          allLabel="All groups"
        />
        <Segmented
          label="Activity"
          value={search.active === "yes" ? "active" : "any"}
          options={[
            { id: "any", label: "Any code" },
            { id: "active", label: `Filed in ${year}` },
          ]}
          onChange={(v) => onSearch({ active: v === "active" ? "yes" : undefined })}
        />
        {filtered ? <ResetButton onClick={reset} /> : null}
      </div>
      {shown.length ? (
        <TableScroll label="Nature-of-suit codes and groups">
          <table className="w-full min-w-[44rem] text-xs">
            <caption className="sr-only">
              Nature-of-suit codes and groups with national {year} civil filings and terminations
            </caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                {head("code", "Code", "Nature-of-suit code; groups have none", "left")}
                {head("name", "Name", "Code name or group name", "left")}
                {head("filings", "Filed", `Civil cases filed nationally in ${year}`)}
                {head("terminations", "Terminated", `Civil cases terminated nationally in ${year}`)}
                {head(
                  "medianDays",
                  "Median days",
                  "Median days from filing to termination, cases terminated in the year",
                )}
                {head("settledPct", "Settled %", "Share of the year's terminations coded settled")}
                {head("trialPct", "Trial %", "Share of the year's terminations by trial judgment")}
                {head(
                  "proSePct",
                  "Pro se %",
                  "Share of the year's filings with a recorded pro se status that have a pro se plaintiff",
                )}
                {head(
                  "classActionPct",
                  "Class %",
                  "Share of the year's filings alleging a class action",
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((n) => {
                const selected = search.nos === n.id;
                return (
                  <tr
                    key={n.id}
                    className={
                      selected ? "bg-muted/60" : n.kind === "group" ? "bg-muted/20" : undefined
                    }
                  >
                    <td className="whitespace-nowrap px-1.5 py-1 font-mono text-muted-foreground">
                      {n.kind === "group" ? "Group" : n.code}
                    </td>
                    <td className="max-w-72 truncate px-1.5 py-1" title={n.name}>
                      <Link
                        to="/courts/caseload"
                        search={patchSearch(search, { nos: n.id })}
                        resetScroll={false}
                        aria-current={selected ? "true" : undefined}
                        className={`hover:underline ${selected ? "font-semibold text-foreground" : "text-primary"}`}
                      >
                        {n.name}
                      </Link>
                      {n.kind === "nos" && n.groupKey && groupLabel.get(n.groupKey) ? (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {groupLabel.get(n.groupKey)}
                        </span>
                      ) : null}
                    </td>
                    <Cell v={n.filings} />
                    <Cell v={n.terminations} />
                    <Cell v={n.medianDays} />
                    <Cell v={n.settledPct} pct />
                    <Cell v={n.trialPct} pct />
                    <Cell v={n.proSePct} pct />
                    <Cell v={n.classActionPct} pct />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <StateNote action={<ResetButton onClick={reset} />}>
          No nature-of-suit row matches these filters.
        </StateNote>
      )}
      <ListCoverage
        loaded={rows.length}
        total={total}
        dropped={dropped}
        noun="nature-of-suit records"
      />
    </Panel>
  );
}

function Cell({ v, pct: isPct = false }: { v: number | null; pct?: boolean }) {
  return (
    <td className="px-1.5 py-1 text-right font-mono">
      {v == null ? (
        <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
      ) : isPct ? (
        pct(v)
      ) : (
        int(v)
      )}
    </td>
  );
}

function NosDetailPanel({
  id,
  rows,
  districts,
  latestFy,
  through,
  search,
  onClear,
}: {
  id: string | undefined;
  rows: NosRow[];
  districts: readonly DistrictRow[];
  latestFy: number | null;
  through: string | null;
  search: TabProps["search"];
  onClear: () => void;
}) {
  const query = useQuery({ ...nosDetailQuery(id ?? "nos:000"), enabled: Boolean(id) });
  const row = id ? (rows.find((r) => r.id === id) ?? null) : null;
  useJumpWhenShown(id, !query.isLoading, "caseload-nos-detail");
  if (!id)
    return (
      <Panel id="caseload-nos-detail" title="Nature-of-suit drill-down">
        <StateNote>{SELECT_HINT}</StateNote>
      </Panel>
    );
  const clear = (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <X className="size-3" aria-hidden />
      Close
    </button>
  );
  const title = row ? row.name : "Nature-of-suit drill-down";
  if (query.isLoading)
    return (
      <Panel id="caseload-nos-detail" title={title} actions={clear}>
        <div
          className="space-y-2 p-3"
          aria-busy="true"
          aria-label="Loading the nature-of-suit drill-down"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-md border border-border bg-muted/50"
              />
            ))}
          </div>
          <div className="h-60 animate-pulse rounded-md border border-border bg-muted/50" />
        </div>
      </Panel>
    );
  if (query.isError)
    return (
      <Panel id="caseload-nos-detail" title={title} actions={clear}>
        <RetryNote onRetry={() => void query.refetch()}>
          The drill-down for this nature-of-suit record could not be loaded.
        </RetryNote>
      </Panel>
    );
  const d = query.data;
  if (!d)
    return (
      <Panel id="caseload-nos-detail" title="Nature-of-suit drill-down" actions={clear}>
        <StateNote>
          No nature-of-suit record &ldquo;{id}&rdquo; is in the FJC caseload. {SELECT_HINT}
        </StateNote>
      </Panel>
    );
  return (
    <Detail
      d={d}
      row={row}
      rows={rows}
      districts={districts}
      latestFy={latestFy}
      through={through}
      search={search}
      clear={clear}
    />
  );
}

function Detail({
  d,
  row,
  rows,
  districts,
  latestFy,
  through,
  search,
  clear,
}: {
  d: NosDetail;
  row: NosRow | null;
  rows: NosRow[];
  districts: readonly DistrictRow[];
  latestFy: number | null;
  through: string | null;
  search: TabProps["search"];
  clear: ReactNode;
}) {
  const names = new Map(districts.map((x) => [x.id, x.name]));
  const fy = latestFy ?? d.years.filter((y) => !y.partial).at(-1)?.fy ?? null;
  const y = yearOf(d.years, fy);
  const partial = d.years.find((v) => v.partial) ?? null;
  const groupRow = d.groupKey
    ? rows.find((r) => r.kind === "group" && r.groupKey === d.groupKey)
    : null;
  const w = d.window;
  const fyText = fy == null ? "the latest complete year" : fyLabel(fy);
  const noCases = fy != null && !y;
  return (
    <Panel
      id="caseload-nos-detail"
      title={row?.code != null ? `${row.code} ${d.name}` : d.name}
      subtitle={
        d.kind === "group"
          ? `${d.members.length ? `Group of ${int(d.members.length)} nature-of-suit codes` : "Group of codes that are in no other group"} · national, all districts`
          : `${groupRow ? groupRow.name : "Group not recorded"} · national, all districts`
      }
      actions={clear}
    >
      <div className="space-y-3 p-3">
        {noCases ? (
          <StateNote>
            No case was filed or terminated under this record in {fyText}, so it has no {fyText}{" "}
            figures; its earlier years are charted below.
          </StateNote>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi
            label={`Filed, ${fyText}`}
            value={y?.filings == null ? NOT_RECORDED : int(y.filings)}
            note="National, all districts"
          />
          <Kpi
            label={`Terminated, ${fyText}`}
            value={y?.terminations == null ? NOT_RECORDED : int(y.terminations)}
          />
          <Kpi
            label="Median days to termination"
            value={y?.medianDays == null ? NOT_RECORDED : int(y.medianDays)}
            note={`Cases terminated in ${fyText}`}
          />
          <Kpi
            label="Settled"
            value={pct(y?.settledPct)}
            note={`Share of ${fyText} terminations`}
          />
          <Kpi
            label="Trial judgment"
            value={pct(y?.trialPct)}
            note={`Share of ${fyText} terminations`}
          />
          <Kpi
            label="Class action"
            value={pct(y?.classActionPct)}
            note={`Share of ${fyText} filings`}
          />
        </div>
        {d.kind === "group" && d.members.length ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold">Codes in this group</h4>
            <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="Codes in this group">
              {d.members.map((m) => (
                <li key={m.nos}>
                  <Link
                    to="/courts/caseload"
                    search={patchSearch(search, { nos: `nos:${m.nos}` })}
                    resetScroll={false}
                    className="inline-block rounded border border-border px-1.5 py-0.5 text-primary hover:bg-muted"
                  >
                    <span className="font-mono">{m.nos}</span> {m.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.kind === "nos" && groupRow ? (
          <p className="text-xs text-muted-foreground">
            Group:{" "}
            <Link
              to="/courts/caseload"
              search={patchSearch(search, { nos: groupRow.id })}
              resetScroll={false}
              className="text-primary hover:underline"
            >
              {groupRow.name}
            </Link>
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 border-t border-border/60 p-3 lg:grid-cols-2">
        <Panel
          title="Filed, terminated and pending, nationally"
          subtitle="Civil cases per fiscal year, all districts"
          footnote={
            <>
              A year with no case filed or terminated under this record is left blank. Pending is
              the count on September 30.
              {partial
                ? ` ${fyLabel(partial.fy)}* is a ${partialText(through)}: dashed, and not comparable with a complete year.`
                : ""}
            </>
          }
        >
          <VolumeChart years={fillYearGaps(d.years)} subject={d.name} through={through} />
        </Panel>
        <Panel
          title="Districts that file it most"
          subtitle={`Filings by district, ${windowLabel(w)}`}
          footnote="Filings over the five complete fiscal years named above; the share is of the national filings for this record in the same years. Select a district to open its caseload."
        >
          {d.topDistricts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Districts with the most filings for this nature of suit
                </caption>
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      #
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      District
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Filed
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Share of national
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {d.topDistricts.map((t, i) => {
                    const known = names.get(t.courtId);
                    const share = shareOf(t.filings, w?.filings);
                    return (
                      <tr key={t.courtId}>
                        <td className="px-2 py-1 font-mono text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1">
                          {known ? (
                            <Link
                              to="/courts/caseload"
                              search={{ court: t.courtId }}
                              className="text-primary hover:underline"
                            >
                              {shortCourtName(known)}
                            </Link>
                          ) : (
                            <span className="font-mono">{t.courtId}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{int(t.filings)}</td>
                        <td className="px-2 py-1 text-right font-mono">{pct(share)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <StateNote>The leading districts are {NOT_RECORDED} for this record.</StateNote>
          )}
        </Panel>
      </div>
      <div className="border-t border-border/60 p-3">
        <MixPanels window={w} showGroups={false} showTopNos={d.kind === "group"} subject={d.name} />
      </div>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        Source: Federal Judicial Center Integrated Database, national, all districts. Counts are the
 FJC&apos;s, and the AO&apos;s published tables remain the reference for official totals.
      </p>
    </Panel>
  );
}
