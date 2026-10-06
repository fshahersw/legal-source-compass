import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DocketDocuments } from "@/components/corpus/DocketDocuments";
import { BarList } from "@/components/corpus/BarList";
import { filterMatters, mdlForMatter, type CatalogMatter } from "@/lib/atlas/catalogMatters";
import {
  casesForState,
  completedDays,
  courtStates,
  exportJson,
  judgeNameKey,
  relatedCases,
  uniqueJudge,
  type Relationship,
} from "@/lib/corpus/research";
import {
  CaseStats,
  control,
  Field,
  fmt,
  Pagination,
  Panel,
  Source,
  tableClass,
  type WorkbenchProps,
} from "./shared";

export function CaseResearch({ data, cases, masters, state, search, update }: WorkbenchProps) {
  const research = useQuery({
    queryKey: ["mdl-research-briefs"],
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetchBundleSnapshot("/data/research/mdl-briefs.json");
      if (!response.ok) throw new Error("Court-order readings could not load.");
      return response.json() as Promise<{
        retrievedAt: string;
        scope: string;
        briefs: {
          mdl: string;
          title: string;
          order: string;
          issued: string;
          sourceUrl: string;
          pinpoint: string;
          ordersUrl: string;
          summary: string;
          mappingInsight: string;
          authorities: string[];
        }[];
      }>;
    },
  });
  const [status, setStatus] = useState(""),
    [page, setPage] = useState(0),
    [relationship, setRelationship] = useState<Relationship>("mdl"),
    [relatedPage, setRelatedPage] = useState(0);
  const scoped = useMemo(
    () => casesForState(cases, state, courtStates(data.courts.records)),
    [data, cases, state],
  );
  const exact = search.judge ? uniqueJudge(search.judge, data.judiciary.judges) : null;
  const filtered = filterMatters(
    scoped,
    { q: search.q, status: status || undefined, mdl: search.mdl },
    masters,
  )
    .filter(
      (c) =>
        !search.judge ||
        (exact
          ? !!c.judge && judgeNameKey(c.judge) === judgeNameKey(exact.name)
          : c.judge === search.judge),
    )
    .sort((a, b) => (b.date_filed ?? "").localeCompare(a.date_filed ?? ""));
  const chosen = search.docket ? cases.find((c) => c.docket_id === search.docket) : filtered[0];
  const mdl = chosen ? mdlForMatter(chosen, masters) : null;
  const related = chosen ? relatedCases(chosen, cases, relationship, masters) : [];
  const choose = (row: CatalogMatter) => {
    update({ docket: row.docket_id });
    setRelatedPage(0);
  };
  const tally = (values: string[]) => {
    const map = new Map<string, number>();
    values.forEach((v) => map.set(v, (map.get(v) ?? 0) + 1));
    return [...map].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };
  const brief = research.data?.briefs.find((b) => b.mdl === mdl);
  return (
    <div className="space-y-4">
      <Panel
        title="Court-order research"
        note="Readings of four identified MDL orders from the courts. Select a litigation to inspect its saved cases and sourced procedural context."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {research.data?.briefs.map((b) => {
            const rows = cases.filter((c) => mdlForMatter(c, masters) === b.mdl);
            return (
              <button
                key={b.mdl}
                className="rounded-lg border border-border p-3 text-left text-[12px] hover:bg-primary/5"
                disabled={!rows.length}
                onClick={() => {
                  update({
                    state: "ALL",
                    judge: undefined,
                    q: undefined,
                    docket: rows[0]?.docket_id,
                    mdl: b.mdl,
                  });
                  setPage(0);
                  setStatus("");
                }}
              >
                <strong className="block">{b.title}</strong>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  MDL {b.mdl} · {fmt(rows.length)} catalog cases · Order {b.issued}
                </span>
              </button>
            );
          })}
        </div>
        {research.error && (
          <p className="text-[12px] text-destructive">Court-order readings could not load.</p>
        )}
      </Panel>
      <Panel
        title="Case cohort"
        note="Filter the saved docket catalog, inspect its statistics, and follow relationships backed by recorded identifiers."
      >
        {search.mdl && (
          <p className="mb-3 text-[12px]">
            Native MDL crosswalk filter: <strong>MDL {search.mdl}</strong>{" "}
            <button
              className="ml-2 text-primary underline"
              onClick={() => {
                update({ mdl: undefined });
                setPage(0);
              }}
            >
              Clear MDL
            </button>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Find a case, party, firm, docket, or judge">
            <input
              className={control}
              value={search.q ?? ""}
              onChange={(e) => {
                update({ q: e.target.value.slice(0, 200), docket: undefined });
                setPage(0);
              }}
              placeholder="Search all catalog fields"
            />
          </Field>
          <Field label="Recorded status">
            <select
              className={control}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="terminated">Terminated</option>
            </select>
          </Field>
        </div>
        {search.judge && (
          <p className="mt-3 text-[12px]">
            Judge filter: <strong>{search.judge}</strong>{" "}
            <button
              className="ml-2 text-primary underline"
              onClick={() => {
                update({ judge: undefined, docket: undefined });
                setPage(0);
              }}
            >
              Clear judge
            </button>
          </p>
        )}
        <div className="mt-3">
          <CaseStats rows={filtered} />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() =>
            exportJson("case-cohort.json", {
              state,
              mdl: search.mdl,
              judge: search.judge,
              q: search.q,
              status,
              source: "/data/catalog-matters.json",
              rows: filtered,
            })
          }
        >
          Download the full filtered cohort
        </Button>
        <div className="mt-3 overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Case</th>
                <th>Court</th>
                <th>Judge</th>
                <th>Filed</th>
                <th>Status</th>
                <th>MDL</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(page * 20, page * 20 + 20).map((c) => (
                <tr
                  key={c.docket_id}
                  className={c.docket_id === chosen?.docket_id ? "bg-primary/10" : ""}
                >
                  <td className="min-w-52">
                    <button className="text-left text-primary underline" onClick={() => choose(c)}>
                      {c.case_name ?? c.docket_number ?? c.docket_id}
                    </button>
                  </td>
                  <td>{c.court ?? "Not recorded"}</td>
                  <td className="min-w-36">{c.judge ?? "Not recorded"}</td>
                  <td className="whitespace-nowrap">{c.date_filed ?? "Not recorded"}</td>
                  <td>{c.status ?? "Not recorded"}</td>
                  <td>{mdlForMatter(c, masters) ?? "Not linked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination count={filtered.length} page={page} onPage={setPage} />
      </Panel>
      <div className="grid gap-4 md:grid-cols-2">
        <BarList
          title="Judges in the filtered cohort"
          rows={tally(filtered.map((c) => c.judge ?? "Not recorded"))}
          limit={12}
          unit="selected catalog cases"
        />
        <BarList
          title="Firms in the filtered cohort"
          rows={tally(filtered.flatMap((c) => c.firms ?? []))}
          limit={12}
          unit="case–firm associations; a case may name multiple firms"
        />
      </div>
      {chosen ? (
        <>
          {brief && (
            <Panel
              title={brief.title}
              note={`${brief.order} · Issued ${brief.issued} · Retrieved ${research.data?.retrievedAt}`}
            >
              <p className="text-[13px] leading-relaxed">{brief.summary}</p>
              <p className="mt-3 rounded-lg bg-primary/5 p-3 text-[12px] leading-relaxed">
                <strong>Research implication: </strong>
                {brief.mappingInsight}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
                <Source href={brief.sourceUrl}>Read the order · {brief.pinpoint}</Source>
                <Source href={brief.ordersUrl}>Court’s order directory</Source>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {research.data?.scope} The reading applies to the identified MDL order; individual
                case facts and later rulings require separate review.
              </p>
              <div className="mt-3 text-[12px]">
                <h3 className="mb-2 font-semibold">Authorities identified in this order</h3>
                <ul className="space-y-2">
                  {brief.authorities.map((a) => (
                    <li key={a}>
                      {a}
                      <button
                        className="ml-2 text-primary underline"
                        onClick={() => update({ view: "citations", q: a })}
                      >
                        Search recorded citations
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
          <Panel
            title={chosen.case_name ?? chosen.docket_number ?? `Docket ${chosen.docket_id}`}
            note={`Native docket ID ${chosen.docket_id} · ${chosen.docket_number ?? "Docket number not recorded"}${filtered.some((c) => c.docket_id === chosen.docket_id) ? "" : " · Selected case is outside the current filter"}`}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <ol className="space-y-3 border-l-2 border-primary/40 pl-4 text-[13px]">
                  <li>
                    <span className="text-[11px] text-muted-foreground">Filed</span>
                    <strong className="block">{chosen.date_filed ?? "Not recorded"}</strong>
                  </li>
                  <li>
                    <span className="text-[11px] text-muted-foreground">Recorded status</span>
                    <strong className="block">{chosen.status ?? "Not recorded"}</strong>
                  </li>
                  <li>
                    <span className="text-[11px] text-muted-foreground">Terminated</span>
                    <strong className="block">{chosen.date_terminated ?? "Not recorded"}</strong>
                  </li>
                  <li>
                    <span className="text-[11px] text-muted-foreground">
                      Recorded elapsed time, if terminated
                    </span>
                    <strong className="block">
                      {completedDays(chosen) === null
                        ? "Not recorded"
                        : `${fmt(completedDays(chosen))} days`}
                    </strong>
                  </li>
                </ol>
                <p className="mt-3 text-[12px]">
                  Recorded defendant: {chosen.defendant ?? "Not recorded"}
                </p>
                <p className="mt-2 text-[12px]">
                  Recorded roles: {chosen.roles?.join(", ") || "Not recorded"}
                </p>
              </div>
              <div className="space-y-3 text-[12px]">
                <h3 className="font-semibold">Follow the recorded relationships</h3>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground">Case → court</div>
                  {chosen.court ? (
                    <Link
                      className="text-primary underline"
                      to="/courts/$id"
                      params={{ id: chosen.court }}
                    >
                      {data.courts.records.find((c) => c.id === chosen.court)?.title ??
                        chosen.court}
                    </Link>
                  ) : (
                    "Not recorded"
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Case → recorded judge
                    </div>
                    {chosen.judge ? (
                      <button
                        className="text-left text-primary underline"
                        onClick={() => update({ view: "judges", judge: chosen.judge ?? undefined })}
                      >
                        {chosen.judge}
                      </button>
                    ) : (
                      "Not recorded"
                    )}
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      Case → master docket → MDL
                    </div>
                    {mdl ? (
                      <Link
                        className="text-primary underline"
                        to="/matters/$id"
                        params={{ id: mdl }}
                      >
                        MDL {mdl}
                      </Link>
                    ) : (
                      "No native MDL crosswalk"
                    )}
                    <div className="mt-1 break-all text-[10px] text-muted-foreground">
                      Master docket: {chosen.mdl_master_docket_id ?? "Not recorded"}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[10px] uppercase text-muted-foreground">Case → firms</div>
                  {chosen.firms?.join(" · ") || "Not recorded"}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-[12px]">
              {chosen.courtlistener_docket_url && (
                <Source href={chosen.courtlistener_docket_url}>
                  Original CourtListener docket
                </Source>
              )}
              <Link
                className="text-primary underline"
                to="/insights"
                search={{ view: "cases", docket: chosen.docket_id, state: "ALL" }}
              >
                Permanent case analysis link
              </Link>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportJson(`docket-${chosen.docket_id}.json`, {
                    case: chosen,
                    mdl,
                    source: "/data/catalog-matters.json",
                    relationshipBasis:
                      "Native master docket ID; exact recorded court, judge and firm labels",
                  })
                }
              >
                Download case record
              </Button>
            </div>
          </Panel>
          <Panel
            title="Find related cases"
            note="Relationships show shared recorded metadata. Shared counsel or a judge does not establish citation, legal similarity, liability, or a causal connection."
          >
            <Field label="Relationship evidence">
              <select
                className={control}
                value={relationship}
                onChange={(e) => {
                  setRelationship(e.target.value as Relationship);
                  setRelatedPage(0);
                }}
              >
                <option value="mdl">Same MDL via native master-docket crosswalk</option>
                <option value="judge">Same exact recorded judge label</option>
                <option value="firm">At least one exact recorded firm label</option>
                <option value="court">Same native court ID</option>
              </select>
            </Field>
            <p className="mt-3 text-[12px]">
              <strong>{fmt(related.length)}</strong> other catalog cases share this relationship
              across all states.
            </p>
            <ul className="mt-3 space-y-3 text-[12px]">
              {related.slice(relatedPage * 20, relatedPage * 20 + 20).map((c) => (
                <li key={c.docket_id}>
                  <button className="text-left text-primary underline" onClick={() => choose(c)}>
                    {c.case_name ?? c.docket_number ?? c.docket_id}
                  </button>
                  <span className="block text-[11px] text-muted-foreground">
                    {c.court ?? "Court not recorded"} · {c.judge ?? "Judge not recorded"} ·{" "}
                    {c.status ?? "Status not recorded"}
                  </span>
                </li>
              ))}
            </ul>
            <Pagination count={related.length} page={relatedPage} onPage={setRelatedPage} />
          </Panel>
          {mdl && (
            <Panel
              title={`MDL ${mdl}: related master-docket documents`}
              note="This collection belongs to the linked MDL master docket. It does not establish that each document was filed in the selected member case. Available free PDFs can be read in the app."
            >
              <DocketDocuments kind="mdl" id={mdl} />
            </Panel>
          )}
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {search.docket
            ? "The selected docket ID is not in the saved catalog."
            : "No cases match the current selection."}
        </p>
      )}
    </div>
  );
}
