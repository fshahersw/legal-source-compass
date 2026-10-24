import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { int } from "@/components/analysis/analysisFormat";
import { HowToRead } from "@/components/analysis/HowToRead";
import {
  Kpi,
  LoadingBlock,
  MoreToggle,
  Panel,
  Segmented,
  StateNote,
} from "@/components/enforcement/parts";
import type { DistrictRow, MdlDetail, MdlRow } from "@/lib/external/courtCaseload.functions";
import { CountBars } from "./CaseloadCharts";
import {
  ListCoverage,
  ResetButton,
  RetryNote,
  SearchBox,
  SortTh,
  TableScroll,
} from "./CaseloadParts";
import { dateOrNot, fillCountGaps, fyLabel, NOT_RECORDED, shortCourtName } from "./caseloadFormat";
import {
  districtsQuery,
  mdlDetailQuery,
  mdlsQuery,
  methodQuery,
  nationalQuery,
} from "./caseloadQueries";
import { patchSearch } from "./caseloadSearch";
import {
  encodeSort,
  filterMdls,
  MDL_DEFAULT_SORT,
  MDL_SORT_KEYS,
  nextSort,
  parseSort,
  sortMdls,
  type MdlSortKey,
} from "./caseloadTables";
import type { TabProps } from "./DistrictsTab";
import { useJumpWhenShown } from "./useJumpWhenShown";

const ROW_LIMIT = 100;
const SELECT_HINT =
  "Select an MDL number in the table to see its cases by fiscal year, the districts and nature-of-suit codes they sit in, and the first-listed defendants as recorded.";

/** The evidence label that stays on this tab: what an MDL number in the FJC data does and does not show. */
function AssociationLabel() {
  return (
    <div
      role="note"
      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning-foreground"
    >
      <p className="font-medium">Federal caseload association (historical), not current JPML membership.</p>
      <p>
        Each number is an MDL docket number carried by at least one civil case record in the Federal
        Judicial Center&apos;s Integrated Database (field MDLDOCK). It shows that a case was
        recorded with that number at some time; it does not show that the case is in the MDL now.
        Numbers are shown as recorded, not corrected. A number is marked{" "}
        <strong>In JPML records</strong> only when the same number is in the JPML MDL records in
        this atlas.
      </p>
    </div>
  );
}

export function MdlTab({ search, onSearch }: TabProps) {
  const mdls = useQuery(mdlsQuery);
  const districts = useQuery(districtsQuery);
  const national = useQuery(nationalQuery);
  const method = useQuery(methodQuery);

  if (mdls.isLoading)
    return (
      <div className="space-y-3">
        <AssociationLabel />
        <LoadingBlock label="Loading MDL numbers" />
      </div>
    );
  if (mdls.isError)
    return (
      <div className="space-y-3">
        <AssociationLabel />
        <RetryNote onRetry={() => void mdls.refetch()}>
          The MDL-number table could not be loaded.
        </RetryNote>
      </div>
    );
  const list = mdls.data;
  if (!list?.rows.length)
    return (
      <div className="space-y-3">
        <AssociationLabel />
        <StateNote>The MDL-number association has not been published yet.</StateNote>
      </div>
    );
  const names = new Map((districts.data?.rows ?? []).map((d) => [d.id, d.name]));
  const nonNumeric = method.data?.mdl?.nonNumeric ?? null;
  return (
    <div className="space-y-3">
      <AssociationLabel />
      <MdlTable
        search={search}
        onSearch={onSearch}
        rows={list.rows}
        total={list.total}
        dropped={list.dropped}
        names={names}
      />
      <MdlDetailPanel
        mdl={search.mdl}
        rows={list.rows}
        names={names}
        partialFy={national.data?.partialFy ?? null}
        onClear={() => onSearch({ mdl: undefined })}
      />
      <HowToRead
        title="How to read the MDL numbers"
        measures={[
          {
            term: "Cases carrying the number",
            means:
              "Civil case records in the IDB whose MDL docket number field equals this number.",
            caveat:
              "A historical association: not the JPML's list of cases in the MDL, and not current membership.",
          },
          {
            term: "Pending",
            means: "Of those cases, the number still open in the IDB snapshot.",
          },
          {
            term: "First and last filed",
            means: "The earliest and latest filing dates among the cases carrying the number.",
          },
          {
            term: "Median days",
            means:
              "Median days from filing to termination over the carrying cases that have terminated.",
            caveat: "Not recorded when no carrying case has terminated.",
          },
          {
            term: "Largest district",
            means: "The district court holding the most cases that carry the number.",
          },
          {
            term: "In JPML records",
            means:
              "The same number is in the JPML MDL records in this atlas. The Lens and record links appear only for those numbers.",
            caveat:
              "Numbers not in the JPML records are shown as recorded, not corrected or dropped.",
          },
        ]}
        notes={
          nonNumeric ? (
            <>
              {int(nonNumeric.records)} case records carry an MDL field that is not a number (
              {int(nonNumeric.distinctValues)} distinct values); they are excluded from this table,
              not mapped to any number.
            </>
          ) : undefined
        }
      />
    </div>
  );
}

function MdlTable({
  search,
  onSearch,
  rows,
  total,
  dropped,
  names,
}: TabProps & {
  rows: MdlRow[];
  total: number | null;
  dropped: number;
  names: Map<string, string>;
}) {
  const [all, setAll] = useState(false);
  const spec = parseSort(search.sort, MDL_SORT_KEYS, MDL_DEFAULT_SORT);
  const shown = useMemo(
    () =>
      sortMdls(
        filterMdls(rows, { q: search.q, jpml: search.jpml, pendingOnly: search.pending === "yes" }),
        spec,
      ),
    [rows, search.q, search.jpml, search.pending, spec],
  );
  const inJpml = rows.filter((r) => r.inJpml).length;
  const filtered = Boolean(search.q || search.jpml || search.pending);
  const reset = () => {
    setAll(false);
    onSearch({ q: undefined, jpml: undefined, pending: undefined });
  };
  const sortBy = (key: MdlSortKey) =>
    onSearch({
      sort: encodeSort(nextSort(spec, key, key !== "topDistrict"), MDL_DEFAULT_SORT),
    });
  const head = (
    key: MdlSortKey,
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
  const visible = all ? shown : shown.slice(0, ROW_LIMIT);
  return (
    <Panel
      id="caseload-mdls"
      title="MDL docket numbers in the federal caseload data"
      subtitle={`${int(rows.length)} numbers carried by at least one civil case; ${int(inJpml)} also in the JPML records`}
      actions={
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(rows.length)} numbers
        </span>
      }
      footnote="FJC IDB association (historical), not current JPML membership. Dates are filing dates of the cases carrying the number; median days is over those cases that have terminated."
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={search.q}
          onChange={(q) => {
            setAll(false);
            onSearch({ q });
          }}
          label="Search MDL numbers"
          placeholder="MDL number or district id"
        />
        <Segmented
          label="JPML records"
          value={search.jpml ?? "all"}
          options={[
            { id: "all", label: "All" },
            { id: "yes", label: "In JPML records" },
            { id: "no", label: "Not in JPML records" },
          ]}
          onChange={(v) => {
            setAll(false);
            onSearch({ jpml: v === "all" ? undefined : v });
          }}
        />
        <Segmented
          label="Pending"
          value={search.pending === "yes" ? "pending" : "any"}
          options={[
            { id: "any", label: "Any" },
            { id: "pending", label: "Has pending cases" },
          ]}
          onChange={(v) => {
            setAll(false);
            onSearch({ pending: v === "pending" ? "yes" : undefined });
          }}
        />
        {filtered ? <ResetButton onClick={reset} /> : null}
      </div>
      {shown.length ? (
        <>
          <TableScroll
            label="MDL docket numbers carried by federal civil cases"
            maxHeight="max-h-[28rem]"
          >
            <table className="w-full min-w-[46rem] text-xs" id="caseload-mdl-table">
              <caption className="sr-only">
                MDL docket numbers carried by civil cases in the federal caseload data, a
 historical association
              </caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  {head("mdl", "MDL", "MDL docket number as recorded", "left")}
                  {head("cases", "Cases", "Civil cases carrying the number")}
                  {head("pending", "Pending", "Of those, cases still open in the IDB")}
                  {head("districts", "Districts", "Districts holding at least one carrying case")}
                  {head(
                    "firstFiled",
                    "First filed",
                    "Earliest filing date among the cases",
                    "left",
                  )}
                  {head("lastFiled", "Last filed", "Latest filing date among the cases", "left")}
                  {head(
                    "medianDays",
                    "Median days",
                    "Median days from filing to termination over terminated carrying cases",
                  )}
                  {head(
                    "topDistrict",
                    "Largest district",
                    "District with the most carrying cases",
                    "left",
                  )}
                  <th
                    scope="col"
                    className="sticky top-0 z-10 bg-surface px-1.5 py-1.5 text-left font-medium shadow-[inset_0_-1px_0_var(--border)]"
                  >
                    JPML records
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visible.map((m) => {
                  const selected = search.mdl === m.mdl;
                  const known = m.topDistrict ? names.get(m.topDistrict) : undefined;
                  return (
                    <tr key={m.id} className={selected ? "bg-muted/60" : undefined}>
                      <td className="whitespace-nowrap px-1.5 py-1 font-mono">
                        <Link
                          to="/courts/caseload"
                          search={patchSearch(search, { mdl: m.mdl })}
                          resetScroll={false}
                          aria-current={selected ? "true" : undefined}
                          className={`hover:underline ${selected ? "font-semibold text-foreground" : "text-primary"}`}
                        >
                          MDL {m.mdl}
                        </Link>
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">{int(m.cases)}</td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {m.pending == null ? (
                          <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
                        ) : (
                          int(m.pending)
                        )}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {m.districts == null ? (
                          <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
                        ) : (
                          int(m.districts)
                        )}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1 font-mono">
                        {dateOrNot(m.firstFiled)}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1 font-mono">
                        {dateOrNot(m.lastFiled)}
                      </td>
                      <td className="px-1.5 py-1 text-right font-mono">
                        {m.medianDays == null ? (
                          <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
                        ) : (
                          int(m.medianDays)
                        )}
                      </td>
                      <td
                        className="max-w-40 truncate px-1.5 py-1"
                        title={known ?? m.topDistrict ?? NOT_RECORDED}
                      >
                        {m.topDistrict ? (
                          known ? (
                            <Link
                              to="/courts/caseload"
                              search={{ court: m.topDistrict }}
                              className="text-primary hover:underline"
                            >
                              {shortCourtName(known)}
                            </Link>
                          ) : (
                            <span className="font-mono">{m.topDistrict}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">{NOT_RECORDED}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1">
                        {m.inJpml ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="rounded border border-border bg-muted px-1 py-px text-[10px] font-medium">
                              In JPML records
                            </span>
                            {m.lensHref ? (
                              <Link
                                to="/matters/lens/$mdl"
                                params={{ mdl: String(m.mdl) }}
                                className="text-primary hover:underline"
                              >
                                Lens
                              </Link>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not in JPML records</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <div className="px-3 pb-1.5">
            <MoreToggle
              total={shown.length}
              limit={ROW_LIMIT}
              expanded={all}
              onToggle={() => setAll((v) => !v)}
              controls="caseload-mdl-table"
              noun="numbers"
            />
          </div>
        </>
      ) : (
        <StateNote action={<ResetButton onClick={reset} />}>
          No MDL number matches these filters.
        </StateNote>
      )}
      <ListCoverage loaded={rows.length} total={total} dropped={dropped} noun="MDL numbers" />
    </Panel>
  );
}

function MdlDetailPanel({
  mdl,
  rows,
  names,
  partialFy,
  onClear,
}: {
  mdl: number | undefined;
  rows: MdlRow[];
  names: Map<string, string>;
  partialFy: number | null;
  onClear: () => void;
}) {
  const number = mdl ?? null;
  const query = useQuery({ ...mdlDetailQuery(number ?? 0), enabled: number != null });
  useJumpWhenShown(number ?? undefined, !query.isLoading, "caseload-mdl-detail");
  if (number == null)
    return (
      <Panel id="caseload-mdl-detail" title="MDL drill-down">
        <StateNote>{SELECT_HINT}</StateNote>
      </Panel>
    );
  const row = rows.find((r) => r.mdl === number) ?? null;
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
  const title = `MDL ${number}`;
  if (query.isLoading)
    return (
      <Panel id="caseload-mdl-detail" title={title} actions={clear}>
        <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading the MDL drill-down">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-md border border-border bg-muted/50"
              />
            ))}
          </div>
          <div className="h-48 animate-pulse rounded-md border border-border bg-muted/50" />
        </div>
      </Panel>
    );
  if (query.isError)
    return (
      <Panel id="caseload-mdl-detail" title={title} actions={clear}>
        <RetryNote onRetry={() => void query.refetch()}>
          The drill-down for this MDL number could not be loaded.
        </RetryNote>
      </Panel>
    );
  const d = query.data;
  if (!d)
    return (
      <Panel id="caseload-mdl-detail" title={title} actions={clear}>
        <StateNote>
          No case in the FJC data carries MDL number {number}. {SELECT_HINT}
        </StateNote>
      </Panel>
    );
  return <Detail d={d} row={row} names={names} partialFy={partialFy} clear={clear} />;
}

function Detail({
  d,
  row,
  names,
  partialFy,
  clear,
}: {
  d: MdlDetail;
  row: MdlRow | null;
  names: Map<string, string>;
  partialFy: number | null;
  clear: ReactNode;
}) {
  const t = d.totals;
  const maxDefendant = d.defendants[0]?.cases ?? 0;
  return (
    <Panel
      id="caseload-mdl-detail"
      title={`MDL ${d.mdl}`}
      subtitle="Cases carrying this MDL docket number in the federal caseload data: a historical association, not current JPML membership"
      actions={
        <>
          {row?.lensHref ? (
            <Link
              to="/matters/lens/$mdl"
              params={{ mdl: String(d.mdl) }}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              MDL lens
            </Link>
          ) : null}
          {row?.recordHref ? (
            <Link
              to="/records/$dataset/$id"
              params={{ dataset: "mdls", id: String(d.mdl) }}
              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              JPML record
            </Link>
          ) : null}
          {clear}
        </>
      }
    >
      <div className="space-y-3 p-3">
        {!d.inJpml ? (
          <StateNote>
            This number is not in the JPML MDL records in this atlas, so nothing here confirms that
            it is a registered MDL; it is shown as the IDB recorded it.
          </StateNote>
        ) : null}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi
            label="Cases carrying the number"
            value={int(t.cases)}
            note="Civil case records in the IDB"
          />
          <Kpi
            label="Pending in the IDB"
            value={t.pending == null ? NOT_RECORDED : int(t.pending)}
            note="Of those cases"
          />
          <Kpi
            label="Districts"
            value={t.districts == null ? NOT_RECORDED : int(t.districts)}
            note="Holding at least one case"
          />
          <Kpi
            label="Median days to termination"
            value={t.medianDays == null ? NOT_RECORDED : int(t.medianDays)}
            note={
              t.withDays != null
                ? `Over the ${int(t.withDays)} terminated ${t.withDays === 1 ? "case" : "cases"}`
                : "Terminated cases only"
            }
          />
          <Kpi
            label="First filed"
            value={t.firstFiled ?? NOT_RECORDED}
            note="Earliest filing date"
          />
          <Kpi label="Last filed" value={t.lastFiled ?? NOT_RECORDED} note="Latest filing date" />
          <Kpi
            label="Transferred in"
            value={t.transferredIn == null ? NOT_RECORDED : int(t.transferredIn)}
            note="Origin code 6, MDL transfer"
          />
          <Kpi
            label="Originating in the district"
            value={t.originating == null ? NOT_RECORDED : int(t.originating)}
            note="Origin code 13, in use from July 2016"
          />
        </div>
      </div>
      <div className="grid gap-3 border-t border-border/60 p-3 lg:grid-cols-2">
        <Panel
          title="Cases by fiscal year filed"
          subtitle="FY1988 onward"
          footnote={
            <>
              Filing fiscal year of each carrying case; a year with no bar had no carrying case
              filed. Cases filed before FY1988 are in the total above but not in this chart.
              {partialFy != null ? ` ${fyLabel(partialFy)}* is a partial year.` : ""}
            </>
          }
        >
          {d.byFy.length ? (
            <CountBars
              data={fillCountGaps(
                d.byFy.map((b) => ({
                  fy: b.fy,
                  value: b.cases,
                  partial: partialFy != null && b.fy === partialFy,
                })),
                (fy) => ({ fy, value: 0, partial: false }),
              )}
              noun="cases"
              subject={`MDL ${d.mdl}`}
            />
          ) : (
            <StateNote>Filing years are {NOT_RECORDED} for this number.</StateNote>
          )}
        </Panel>
        <Panel
          title="Where the cases are"
          subtitle="Districts holding the most carrying cases"
          footnote="Up to twelve districts, largest first. Select a district to open its caseload."
        >
          {d.districts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Districts holding cases that carry this MDL number
                </caption>
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      District
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Cases
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {d.districts.map((x) => {
                    const known = names.get(x.courtId);
                    return (
                      <tr key={x.courtId}>
                        <td className="px-2 py-1">
                          {known ? (
                            <Link
                              to="/courts/caseload"
                              search={{ court: x.courtId }}
                              className="text-primary hover:underline"
                            >
                              {shortCourtName(known)}
                            </Link>
                          ) : (
                            <span className="font-mono">{x.courtId}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{int(x.cases)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <StateNote>Districts are {NOT_RECORDED} for this number.</StateNote>
          )}
        </Panel>
        <Panel
          title="Nature of suit"
          subtitle="Codes the carrying cases were filed under"
          footnote="The filer's code from the civil cover sheet, not a finding of what the case was about."
        >
          {d.nos.length ? (
            <ul className="divide-y divide-border/60 text-xs" aria-label="Nature-of-suit codes">
              {d.nos.map((n) => (
                <li key={n.nos} className="flex items-baseline justify-between gap-3 px-3 py-1">
                  <span className="min-w-0 truncate" title={`${n.nos} ${n.label}`}>
                    <span className="font-mono text-muted-foreground">{n.nos}</span> {n.label}
                  </span>
                  <span className="font-mono">{int(n.cases)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <StateNote>Nature-of-suit codes are {NOT_RECORDED} for this number.</StateNote>
          )}
        </Panel>
        <Panel
          title="First-listed defendants, as recorded"
          subtitle="Exact text in the IDB, most cases first"
          footnote="Not normalised, merged or matched to a company: the same party can appear under several spellings, and a name here does not mean it is a defendant in the MDL."
        >
          {d.defendants.length ? (
            <ul className="divide-y divide-border/60 text-xs" aria-label="First-listed defendants">
              {d.defendants.map((x) => (
                <li
                  key={x.name}
                  className="grid grid-cols-[minmax(0,1fr)_5rem_3rem] items-center gap-2 px-3 py-1"
                >
                  <span className="truncate font-mono" title={x.name}>
                    {x.name}
                  </span>
                  <span className="h-1.5 rounded-sm bg-muted" aria-hidden>
                    <span
                      className="block h-1.5 rounded-sm bg-primary/60"
                      style={{
                        width: `${maxDefendant > 0 ? Math.max(2, (x.cases / maxDefendant) * 100) : 0}%`,
                      }}
                    />
                  </span>
                  <span className="text-right font-mono">{int(x.cases)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <StateNote>Defendants are {NOT_RECORDED} for this number.</StateNote>
          )}
        </Panel>
      </div>
    </Panel>
  );
}
