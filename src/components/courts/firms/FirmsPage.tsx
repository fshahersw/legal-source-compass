import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { int } from "@/components/analysis/analysisFormat";
import { Kpi, MoreToggle, Panel, Segmented } from "@/components/enforcement/parts";
import {
  Callout,
  KpiGrid,
  KpiSkeleton,
  QueryPanel,
} from "@/components/courts/collection/CollectionParts";
import { RhoMark } from "@/components/courts/collection/CollectionVisuals";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  FIRM_PAGE,
  getFirmLandscape,
  getFirmList,
  getFirmNetwork,
  getFirmProfile,
  type FirmPair,
  type FirmProfile,
  type FirmRow,
  type FirmSort,
  type MdlLandscape,
  type Side,
} from "@/lib/external/firmIntel.functions";
import { cn } from "@/lib/utils";
import { Facts, FirmName, RankScatter, ShareMeter, SideBar, SideLegend } from "./FirmVisuals";
import {
  isOrganisation,
  landscapeQuery,
  NOT_RECORDED,
  SIDE_COLOR,
  SIDE_LABEL,
} from "./firmQueries";
import { patchFirmSearch, type FirmSearch } from "./firmSearch";

const STALE = 10 * 60 * 1000;

const networkQuery = {
  queryKey: ["firm-network"],
  queryFn: () => getFirmNetwork(),
  staleTime: STALE,
};

type Nav = (next: FirmSearch, opts?: { replace?: boolean }) => void;

const fmt = (n: number | null | undefined) => (n == null ? NOT_RECORDED : int(n));

/** Law firms on the MDL master dockets of the matter registry: who appears, where, with whom and against whom. */
export function FirmsPage({ search, onNavigate }: { search: FirmSearch; onNavigate: Nav }) {
  const set = (patch: Partial<FirmSearch>) => onNavigate(patchFirmSearch(search, patch));
  return (
    <div className="space-y-4">
      <Callout>
        One <strong>appearance</strong> is one counsel entry for one party on an MDL master docket
        in the matter registry (CourtListener party records). Member dockets are not counted, so
        these figures describe who appears on the master dockets, not a firm&rsquo;s whole caseload
        or market share. Firm spellings are merged only by stated rules (case, punctuation, &amp;,
        entity forms such as LLP, a trailing office name); government counsel is kept apart.
      </Callout>
      <Overview />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TopFirms />
        <Network />
      </div>
      <MdlConcentration selected={search.mdl} onSelect={(mdl) => set({ mdl })} />
      <Associations />
      <Directory search={search} set={set} />
      <LeftOut />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ overview

function Overview() {
  const q = useQuery(landscapeQuery);
  if (q.isLoading) return <KpiSkeleton n={5} />;
  const o = q.data?.overview;
  if (!o) return null;
  const sides = o.sideFirms;
  return (
    <KpiGrid id="firm-kpis" label="Law firms on MDL master dockets">
      <Kpi
        label="Firms (spellings merged)"
        value={fmt(o.firms)}
        note="Firms with at least one appearance"
      />
      <Kpi
        label="Appearances"
        value={fmt(o.appearances)}
        note="Counsel entries for a party on a master docket"
      />
      <Kpi
        label="MDLs with counsel records"
        value={fmt(o.mdls)}
        note="Master dockets in the matter registry"
      />
      <Kpi
        label="Firms in two or more MDLs"
        value={fmt(o.multiMdlFirms)}
        note={
          o.firms && o.multiMdlFirms != null
            ? `${((100 * o.multiMdlFirms) / o.firms).toFixed(1)}% of firms`
            : undefined
        }
      />
      <Kpi
        label="Firms by main side"
        value={`${fmt(sides.plaintiff)} / ${fmt(sides.defense)}`}
        note={`Plaintiff / defense; ${fmt(sides.other)} mainly for other parties`}
      />
    </KpiGrid>
  );
}

// ------------------------------------------------------------------------------------------------ top firms

function TopFirms() {
  const q = useQuery(landscapeQuery);
  const [all, setAll] = useState(false);
  const listId = useId();
  return (
    <Panel
      id="firms-top"
      title="Most active firms"
      subtitle="Appearances on MDL master dockets, by the side of the party represented"
      actions={<SideLegend />}
      footnote="Bar length is the firm's appearances; colour is the side of the represented party. The MDL count is the number of master dockets the firm appears on."
    >
      <QueryPanel
        query={q}
        label="Loading the most active firms"
        errorText="The firm overview could not be loaded."
        emptyText="No firm overview is recorded."
        isEmpty={(d) => !d.overview?.top.length}
      >
        {(d) => {
          const top = d.overview!.top;
          const shown = all ? top : top.slice(0, 15);
          const max = Math.max(...top.map((t) => t.appearances), 1);
          return (
            <div className="p-3">
              <ol id={listId} className="m-0 grid list-none gap-1.5 p-0 text-xs">
                {shown.map((t, i) => (
                  <li
                    key={`${i}-${t.firm}`}
                    className="grid grid-cols-[1.5rem_minmax(0,12rem)_minmax(0,1fr)_3.5rem_2.5rem] items-center gap-2"
                  >
                    <span className="text-right font-mono text-muted-foreground">{i + 1}</span>
                    <FirmName firm={t.firm} href={t.href} className="truncate" />
                    <SideBar
                      parts={{ [t.side ?? "other"]: t.appearances }}
                      max={max}
                      label={`${t.firm}: ${int(t.appearances)} appearances, ${t.side ? SIDE_LABEL[t.side] : "side not recorded"}`}
                    />
                    <span className="text-right font-mono">{int(t.appearances)}</span>
                    <span
                      className="text-right font-mono text-muted-foreground"
                      title="MDL master dockets"
                    >
                      {t.mdls ?? "—"}
                    </span>
                  </li>
                ))}
              </ol>
              <MoreToggle
                total={top.length}
                limit={15}
                expanded={all}
                onToggle={() => setAll((v) => !v)}
                controls={listId}
                noun="firms"
              />
            </div>
          );
        }}
      </QueryPanel>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ network

function Network() {
  const q = useQuery(networkQuery);
  const [kind, setKind] = useState<"cocounsel" | "opposing">("cocounsel");
  return (
    <Panel
      id="firms-network"
      title="Who works with and against whom"
      subtitle={
        kind === "cocounsel"
          ? "Pairs of firms that represent the same parties (parties in common)"
          : "Plaintiff-side and defense-side firms on the same master dockets (MDLs in common)"
      }
      actions={
        <Segmented
          label="Pair type"
          value={kind}
          options={[
            { id: "cocounsel", label: "Co-counsel" },
            { id: "opposing", label: "Opposing" },
          ]}
          onChange={setKind}
        />
      }
      footnote={
        kind === "cocounsel"
          ? "Co-counsel: both firms have a counsel entry for the same party. Pairs sharing at least three parties are recorded."
          : "Opposing: one firm represents a plaintiff-side party and the other a defense-side party on the same master docket. Pairs meeting on at least two MDLs are recorded."
      }
    >
      <QueryPanel
        query={q}
        label="Loading firm pairs"
        errorText="The firm pairs could not be loaded."
        emptyText="No firm pairs are recorded."
        isEmpty={(d) => !d.cocounsel.length && !d.opposing.length}
      >
        {(d) => <PairList pairs={kind === "cocounsel" ? d.cocounsel : d.opposing} kind={kind} />}
      </QueryPanel>
    </Panel>
  );
}

function PairList({ pairs, kind }: { pairs: FirmPair[]; kind: "cocounsel" | "opposing" }) {
  const [all, setAll] = useState(false);
  const id = useId();
  const shown = all ? pairs : pairs.slice(0, 12);
  const max = Math.max(...pairs.map((p) => p.weight), 1);
  const color = kind === "cocounsel" ? FDA_COLORS[1]! : FDA_COLORS[2]!;
  return (
    <div className="p-3">
      <ol id={id} className="m-0 grid list-none gap-1.5 p-0 text-xs">
        {shown.map((p, i) => (
          <li
            key={`${p.a.firm}|${p.b.firm}`}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)_5rem_2.5rem] items-center gap-2"
          >
            <span className="text-right font-mono text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 truncate">
              <FirmName firm={p.a.firm} href={p.a.href} />
              <span className="text-muted-foreground">
                {" "}
                {kind === "cocounsel" ? "with" : "vs"}{" "}
              </span>
              <FirmName firm={p.b.firm} href={p.b.href} />
            </span>
            <span className="h-2 rounded-sm bg-muted" aria-hidden>
              <span
                className="block h-2 rounded-sm"
                style={{ width: `${(100 * p.weight) / max}%`, background: color }}
              />
            </span>
            <span
              className="text-right font-mono"
              title={
                kind === "cocounsel"
                  ? "Parties represented by both"
                  : `MDLs in common${p.mdls.length ? `: ${p.mdls.join(", ")}` : ""}`
              }
            >
              {int(p.weight)}
            </span>
          </li>
        ))}
      </ol>
      <MoreToggle
        total={pairs.length}
        limit={12}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls={id}
        noun="pairs"
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ MDL concentration

type MdlSort = "mdl" | "hhi" | "firms" | "top5";

function MdlConcentration({
  selected,
  onSelect,
}: {
  selected: number | undefined;
  onSelect: (mdl: number | undefined) => void;
}) {
  const q = useQuery(landscapeQuery);
  const [sort, setSort] = useState<MdlSort>("hhi");
  return (
    <Panel
      id="firms-mdls"
      title="How concentrated is each MDL's plaintiff side?"
      subtitle="Share of plaintiff-side appearances held by the most active firms, per master docket"
      actions={
        <Segmented
          label="Sort MDLs"
          value={sort}
          options={[
            { id: "hhi", label: "Concentration" },
            { id: "top5", label: "Top-5 share" },
            { id: "firms", label: "Firms" },
            { id: "mdl", label: "MDL" },
          ]}
          onChange={setSort}
        />
      }
      footnote="HHI is the sum of squared appearance shares (0 to 10,000): higher means a few firms account for most plaintiff-side entries. It describes counsel entries on the master docket, not fees, leadership appointments or market share. Select a row for the firms behind it."
    >
      <QueryPanel
        query={q}
        label="Loading MDL concentration"
        errorText="The MDL landscape could not be loaded."
        emptyText="No MDL landscape is recorded."
        isEmpty={(d) => !d.mdls.length}
      >
        {(d) => <MdlTable mdls={d.mdls} sort={sort} selected={selected} onSelect={onSelect} />}
      </QueryPanel>
    </Panel>
  );
}

function MdlTable({
  mdls,
  sort,
  selected,
  onSelect,
}: {
  mdls: MdlLandscape[];
  sort: MdlSort;
  selected: number | undefined;
  onSelect: (mdl: number | undefined) => void;
}) {
  const key = (m: MdlLandscape) =>
    sort === "mdl"
      ? -m.mdl
      : sort === "hhi"
        ? (m.plaintiff.hhi ?? -1)
        : sort === "firms"
          ? (m.plaintiff.firms ?? -1)
          : (m.plaintiff.top5 ?? -1);
  const rows = [...mdls].sort((a, b) => key(b) - key(a));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-xs">
        <caption className="sr-only">
          Plaintiff-side concentration of counsel appearances by MDL
        </caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              MDL
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Most active plaintiff-side firm
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 font-medium"
              title="Share of plaintiff-side appearances held by the five most active firms"
            >
              Top-5 share
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              HHI
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 text-right font-medium"
              title="Plaintiff-side / defense-side firms"
            >
              Firms P / D
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const open = selected === m.mdl;
            const lead = m.plaintiff.top[0];
            return (
              <MdlRow
                key={m.mdl}
                m={m}
                open={open}
                onToggle={() => onSelect(open ? undefined : m.mdl)}
              >
                <td className="px-2 py-1.5">
                  {lead ? (
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <FirmName firm={lead.firm} href={lead.href} className="truncate" />
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {lead.sharePct != null ? `${lead.sharePct.toFixed(1)}%` : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{NOT_RECORDED}</span>
                  )}
                </td>
                <td className="w-56 px-2 py-1.5">
                  <ShareMeter
                    value={m.plaintiff.top5}
                    color={SIDE_COLOR.plaintiff}
                    label={`Top-5 share for MDL ${m.mdl}`}
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {m.plaintiff.hhi != null ? int(Math.round(m.plaintiff.hhi)) : "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">
                  {fmt(m.plaintiff.firms)} / {fmt(m.defense.firms)}
                </td>
              </MdlRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MdlRow({
  m,
  open,
  onToggle,
  children,
}: {
  m: MdlLandscape;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const detailId = `mdl-detail-${m.mdl}`;
  return (
    <>
      <tr className={cn("border-t border-border/60", open && "bg-muted/40")}>
        <th scope="row" className="w-[16rem] max-w-[20rem] px-3 py-1.5 text-left font-normal">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            onClick={onToggle}
            className="flex min-w-0 items-start gap-1 text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight
              className={cn(
                "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                open && "rotate-90",
              )}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="font-mono font-semibold">{m.mdl}</span>{" "}
              <span className="line-clamp-2 text-muted-foreground" title={m.title ?? undefined}>
                {m.title ? m.title.replace(/^in re:?\s*/i, "") : NOT_RECORDED}
              </span>
            </span>
          </button>
        </th>
        {children}
      </tr>
      {open ? (
        <tr id={detailId} className="bg-muted/20">
          <td colSpan={5} className="px-3 pb-3 pt-1">
            <MdlDetail m={m} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function MdlDetail({ m }: { m: MdlLandscape }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {(["plaintiff", "defense"] as const).map((s) => {
        const side = m[s];
        return (
          <section
            key={s}
            aria-label={`${SIDE_LABEL[s]} firms in MDL ${m.mdl}`}
            className="min-w-0"
          >
            <h4 className="m-0 mb-1 text-[11px] font-semibold" style={{ color: SIDE_COLOR[s] }}>
              {SIDE_LABEL[s]}: {fmt(side.firms)} firms, {fmt(side.appearances)} appearances
            </h4>
            {side.top.length ? (
              <ol className="m-0 grid list-none gap-1 p-0 text-[11px]">
                {side.top.slice(0, 8).map((t) => (
                  <li
                    key={t.firm}
                    className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2"
                  >
                    <FirmName firm={t.firm} href={t.href} className="truncate" />
                    <ShareMeter
                      value={t.sharePct}
                      color={SIDE_COLOR[s]}
                      label={`${t.firm} share`}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 text-[11px] text-muted-foreground">
                No firms recorded on this side.
              </p>
            )}
          </section>
        );
      })}
      <section aria-label={`Lead attorney designations in MDL ${m.mdl}`} className="min-w-0">
        <h4 className="m-0 mb-1 text-[11px] font-semibold">
          Lead-attorney designations, plaintiff side
        </h4>
        {m.leadPlaintiff.length ? (
          <ol className="m-0 grid list-none gap-1 p-0 text-[11px]">
            {m.leadPlaintiff.slice(0, 8).map((t) => (
              <li key={t.firm} className="flex justify-between gap-2">
                <FirmName firm={t.firm} href={t.href} className="truncate" />
                <span className="font-mono">{int(t.designations)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[11px] text-muted-foreground">None recorded.</p>
        )}
        <p className="m-0 mt-2 text-[10px] leading-tight text-muted-foreground">
          The CM/ECF &ldquo;lead attorney&rdquo; flag for a party, not a court appointment to MDL
          leadership.
          {m.href ? (
            <>
              {" "}
              <Link
                to="/records/$dataset/$id"
                params={{ dataset: "sw_matters_v1", id: `sw-matter:${m.mdl}` }}
                className="text-primary hover:underline"
              >
                Matter record
              </Link>
            </>
          ) : null}
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ associations

function Associations() {
  const q = useQuery(landscapeQuery);
  return (
    <Panel
      id="firms-associations"
      title="Patterns across MDLs"
      subtitle="Spearman rank correlations across the registry's MDLs, with 95% intervals"
      footnote="Each point in a scatter is one MDL, placed by rank. These describe association across the MDLs in the registry, a selection rather than every MDL; they do not show that one measure causes the other. Intervals that cross zero mean the direction is not settled at this sample size."
    >
      <QueryPanel
        query={q}
        label="Loading associations"
        errorText="The associations could not be loaded."
        emptyText="No associations are recorded."
        isEmpty={(d) => !d.associations.length}
      >
        {(d) => (
          <ul className="m-0 grid list-none gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.associations.map((a) => {
              // The builder plots the first measure named on x and the second on y.
              const [xLabel, yLabel] = a.label.split(" vs ");
              return (
                <li
                  key={a.id}
                  className="flex min-w-0 gap-3 rounded-md border border-border/70 bg-surface p-3"
                >
                  <RankScatter
                    points={a.points.map((p) => ({ key: p.mdl, x: p.x, y: p.y }))}
                    xLabel={xLabel ?? "first measure"}
                    yLabel={yLabel ?? "second measure"}
                    label={`Scatter: ${a.label}`}
                    pointName={(k) => `MDL ${k}`}
                  />
                  <div className="min-w-0 text-xs">
                    <p className="m-0 font-medium leading-snug">{a.label}</p>
                    <p className="m-0 mt-1 font-mono">
                      ρ {a.rho >= 0 ? "+" : ""}
                      {a.rho.toFixed(2)}{" "}
                      <span className="text-muted-foreground">
                        [{a.low.toFixed(2)}, {a.high.toFixed(2)}] · n {a.n}
                      </span>
                    </p>
                    <RhoMark
                      rho={a.rho}
                      low={a.low}
                      high={a.high}
                      label={`Correlation ${a.rho.toFixed(2)}, interval ${a.low.toFixed(2)} to ${a.high.toFixed(2)}`}
                    />
                    <p className="m-0 text-[11px] text-muted-foreground">{a.strength ?? ""}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryPanel>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ directory

const SORT_LABEL: Record<FirmSort, string> = {
  appearances: "Appearances",
  mdls: "MDLs",
  parties: "Parties",
  attorneys: "Attorneys",
};

function Directory({
  search,
  set,
}: {
  search: FirmSearch;
  set: (patch: Partial<FirmSearch>) => void;
}) {
  const page = search.page ?? 1;
  const listArgs = {
    side: search.side ?? "all",
    q: search.q ?? "",
    sort: search.sort ?? "appearances",
    offset: (page - 1) * FIRM_PAGE,
  } as const;
  const q = useQuery({
    queryKey: ["firm-list", listArgs],
    queryFn: () => getFirmList({ data: listArgs }),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
  const [text, setText] = useState(search.q ?? "");
  useEffect(() => setText(search.q ?? ""), [search.q]);
  const total = q.data?.total ?? null;
  const pages = total != null ? Math.max(1, Math.ceil(total / FIRM_PAGE)) : null;
  return (
    <Panel
      id="firms-directory"
      title="Firm directory"
      subtitle={total != null ? `${int(total)} firms match` : "Every firm with an appearance"}
      actions={
        <Segmented
          label="Main side"
          value={(search.side ?? "all") as "all" | Side}
          options={[
            { id: "all", label: "All" },
            { id: "plaintiff", label: "Plaintiff" },
            { id: "defense", label: "Defense" },
            { id: "other", label: "Other" },
          ]}
          onChange={(v) => set({ side: v === "all" ? undefined : v })}
        />
      }
      footnote="Main side is the side with the most of the firm's appearances. Lead designations count the CM/ECF lead-attorney flag on the firm's entries. Select a firm for its MDLs, courts, clients, co-counsel and opposing counsel."
    >
      <form
        role="search"
        className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text.trim() || undefined });
        }}
      >
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs focus-within:outline-2 focus-within:outline-ring">
          <Search className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search firms by name</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Firm name"
            className="min-w-0 flex-1 bg-transparent outline-none"
            maxLength={80}
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Search
        </button>
        {search.q ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => set({ q: undefined })}
          >
            Clear
          </button>
        ) : null}
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          Sort by
          <select
            value={search.sort ?? "appearances"}
            onChange={(e) =>
              set({
                sort: e.target.value === "appearances" ? undefined : (e.target.value as FirmSort),
              })
            }
            className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
          >
            {(Object.keys(SORT_LABEL) as FirmSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </form>
      <QueryPanel
        query={q}
        label="Loading firms"
        errorText="The firm directory could not be loaded."
        emptyText={
          search.q
            ? `No firm name contains “${search.q}”.`
            : "No firms are recorded for this filter."
        }
        isEmpty={(d) => !d.rows.length}
      >
        {(d) => (
          <>
            <FirmTable
              rows={d.rows}
              open={search.firm}
              onToggle={(id) => set({ firm: search.firm === id ? undefined : id })}
              busy={q.isFetching}
            />
            {pages && pages > 1 ? (
              <nav
                aria-label="Firm directory pages"
                className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-xs"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => set({ page: page - 1 })}
                  className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-muted-foreground">
                  Page {page} of {pages}
                </span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => set({ page: page + 1 })}
                  className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </nav>
            ) : null}
            {d.dropped ? (
              <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                {d.dropped} stored rows could not be read and are not shown.
              </p>
            ) : null}
          </>
        )}
      </QueryPanel>
    </Panel>
  );
}

function FirmTable({
  rows,
  open,
  onToggle,
  busy,
}: {
  rows: FirmRow[];
  open: string | undefined;
  onToggle: (id: string) => void;
  busy: boolean;
}) {
  const max = Math.max(...rows.map((r) => r.appearances), 1);
  return (
    <div className={cn("overflow-x-auto", busy && "opacity-70")} aria-busy={busy}>
      <table className="w-full min-w-[44rem] text-xs">
        <caption className="sr-only">Law firms on MDL master dockets</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              #
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Firm
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Main side
            </th>
            <th scope="col" className="w-40 px-2 py-1.5 font-medium">
              Appearances
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              MDLs
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Parties
            </th>
            <th scope="col" className="hidden px-2 py-1.5 text-right font-medium xl:table-cell">
              Attorneys
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 text-right font-medium"
              title="CM/ECF lead-attorney flags"
            >
              Lead
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              MDL years
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open === r.id;
            const detailId = `firm-detail-${r.id.replace(/[^a-z0-9-]/g, "")}`;
            return (
              <FirmTableRow
                key={r.id}
                r={r}
                isOpen={isOpen}
                detailId={detailId}
                max={max}
                onToggle={() => onToggle(r.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FirmTableRow({
  r,
  isOpen,
  detailId,
  max,
  onToggle,
}: {
  r: FirmRow;
  isOpen: boolean;
  detailId: string;
  max: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={cn("border-t border-border/60", isOpen && "bg-muted/40")}>
        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{r.rank ?? "—"}</td>
        <th scope="row" className="max-w-[20rem] px-2 py-1.5 text-left font-normal">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? detailId : undefined}
            onClick={onToggle}
            className="flex min-w-0 items-center gap-1 text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                isOpen && "rotate-90",
              )}
              aria-hidden
            />
            <span className="truncate">{r.firm}</span>
          </button>
        </th>
        <td className="px-2 py-1.5">
          {r.side ? (
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-sm"
                style={{ background: SIDE_COLOR[r.side] }}
                aria-hidden
              />
              {SIDE_LABEL[r.side].replace(" side", "")}
            </span>
          ) : (
            NOT_RECORDED
          )}
        </td>
        <td className="px-2 py-1.5">
          <span className="flex items-center gap-2">
            <span className="flex-1">
              <SideBar
                parts={{ [r.side ?? "other"]: r.appearances }}
                max={max}
                label={`${int(r.appearances)} appearances`}
              />
            </span>
            <span className="w-12 text-right font-mono">{int(r.appearances)}</span>
          </span>
        </td>
        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.mdls)}</td>
        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.parties)}</td>
        <td className="hidden px-2 py-1.5 text-right font-mono xl:table-cell">
          {fmt(r.attorneys)}
        </td>
        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.lead)}</td>
        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-muted-foreground">
          {r.firstYear
            ? r.firstYear === r.lastYear
              ? r.firstYear
              : `${r.firstYear}–${r.lastYear ?? "?"}`
            : "—"}
        </td>
      </tr>
      {isOpen ? (
        <tr id={detailId} className="bg-muted/20">
          <td colSpan={9} className="px-3 pb-3 pt-1">
            <FirmDetail id={r.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FirmDetail({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["firm-profile", id],
    queryFn: () => getFirmProfile({ data: { id } }),
    staleTime: STALE,
  });
  return (
    <QueryPanel
      query={q}
      label="Loading the firm profile"
      errorText="This firm's profile could not be loaded."
      emptyText="This firm's profile is not recorded."
      skeleton={<div className="h-32 animate-pulse rounded-md bg-muted/50" aria-busy="true" />}
    >
      {(p) => <FirmProfileView p={p} />}
    </QueryPanel>
  );
}

function FirmProfileView({ p }: { p: FirmProfile }) {
  const maxMdl = Math.max(...p.perMdl.map((m) => m.appearances), 1);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <section aria-label="Appearances by MDL">
          <h4 className="m-0 mb-1 text-[11px] font-semibold">Appearances by MDL (filing year)</h4>
          <ol className="m-0 grid list-none gap-1 p-0 text-[11px]">
            {[...p.perMdl]
              .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.mdl - b.mdl)
              .map((m) => (
                <li
                  key={m.mdl}
                  className="grid grid-cols-[3rem_minmax(0,14rem)_minmax(0,1fr)_3rem] items-center gap-2"
                >
                  <span className="font-mono text-muted-foreground">{m.year ?? "—"}</span>
                  <span className="min-w-0 truncate" title={m.title ?? undefined}>
                    {m.href ? (
                      <Link
                        to="/records/$dataset/$id"
                        params={{ dataset: "sw_matters_v1", id: `sw-matter:${m.mdl}` }}
                        className="text-primary hover:underline"
                      >
                        MDL {m.mdl}
                      </Link>
                    ) : (
                      `MDL ${m.mdl}`
                    )}{" "}
                    <span className="text-muted-foreground">{m.title ?? ""}</span>
                  </span>
                  <SideBar
                    parts={{ [m.side ?? "other"]: m.appearances }}
                    max={maxMdl}
                    label={`MDL ${m.mdl}: ${int(m.appearances)} appearances`}
                  />
                  <span className="text-right font-mono">{int(m.appearances)}</span>
                </li>
              ))}
          </ol>
        </section>
        <Facts
          items={[
            [
              "Side mix",
              `${fmt(p.sideMix.plaintiff)} plaintiff · ${fmt(p.sideMix.defense)} defense · ${fmt(p.sideMix.other)} other`,
            ],
            ["Parties / attorneys", `${fmt(p.parties)} parties · ${fmt(p.attorneys)} attorneys`],
            ["Lead-attorney flags", `${fmt(p.lead)} (CM/ECF role, not court-appointed leadership)`],
            ["Pro hac vice / terminated", `${fmt(p.proHacVice)} / ${fmt(p.terminated)}`],
            [
              "Litigation types",
              p.litigationTypes.map((t) => `${t.type} (${t.mdls})`).join("; ") || NOT_RECORDED,
            ],
            [
              "Courts",
              p.courts.length
                ? p.courts.map((c, i) => (
                    <span key={c.courtId}>
                      {i ? ", " : ""}
                      {c.href ? (
                        <Link
                          to="/courts/$id"
                          params={{ id: c.courtId }}
                          className="text-primary hover:underline"
                        >
                          {c.courtId}
                        </Link>
                      ) : (
                        c.courtId
                      )}{" "}
                      <span className="text-muted-foreground">({int(c.appearances)})</span>
                    </span>
                  ))
                : NOT_RECORDED,
            ],
            ["Spellings merged", p.spellings.map((s) => `${s.text} (${s.n})`).join("; ")],
          ]}
        />
        <DefenseClients clients={p.defenseClients} />
        {p.plaintiffsRepresented ? (
          <p className="m-0 text-[11px] text-muted-foreground">
            Plaintiff-side parties represented: {int(p.plaintiffsRepresented)} (counted, not named
            here).
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-3">
        <RelatedList
          title="Co-counsel (parties in common)"
          rows={p.cocounsel.map((c) => ({
            firm: c.firm,
            href: c.href,
            value: c.sharedParties,
            note: undefined,
          }))}
          color={FDA_COLORS[1]!}
        />
        <RelatedList
          title="Opposing counsel (master dockets in common)"
          rows={p.opposing.map((c) => ({
            firm: c.firm,
            href: c.href,
            value: c.dockets,
            note: c.mdls.length ? `MDLs ${c.mdls.join(", ")}` : undefined,
          }))}
          color={FDA_COLORS[2]!}
        />
        <RelatedList
          title="Same side in the same MDLs (overlap, not rivalry)"
          rows={p.sameSide.map((c) => ({
            firm: c.firm,
            href: c.href,
            value: c.sharedMdls,
            note: c.jaccard != null ? `Jaccard ${c.jaccard.toFixed(2)}` : undefined,
          }))}
          color={FDA_COLORS[3]!}
        />
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "firm_profiles", id: p.id }}
          className="inline-block text-[11px] text-primary hover:underline"
        >
          Full firm record
        </Link>
      </div>
    </div>
  );
}

function DefenseClients({ clients }: { clients: FirmProfile["defenseClients"] }) {
  if (!clients.length) return null;
  const orgs = clients.filter((c) => isOrganisation(c.name));
  const others = clients.length - orgs.length;
  return (
    <p className="m-0 text-[11px]">
      <span className="text-muted-foreground">Defense-side parties represented: </span>
      {orgs.map((c) => `${c.name} (${c.appearances})`).join("; ")}
      {others ? (
        <span className="text-muted-foreground">
          {orgs.length ? "; " : ""}
          {others} other {others === 1 ? "party" : "parties"} (individuals or unclassified names,
          counted, not named here)
        </span>
      ) : null}
    </p>
  );
}

function RelatedList({
  title,
  rows,
  color,
}: {
  title: string;
  rows: { firm: string; href: string | null; value: number; note: string | undefined }[];
  color: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section aria-label={title}>
      <h4 className="m-0 mb-1 text-[11px] font-semibold">{title}</h4>
      {rows.length ? (
        <ol className="m-0 grid list-none gap-1 p-0 text-[11px]">
          {rows.slice(0, 6).map((r) => (
            <li
              key={r.firm}
              className="grid grid-cols-[minmax(0,1fr)_3.5rem_2rem] items-center gap-2"
              title={r.note}
            >
              <FirmName firm={r.firm} href={r.href} className="truncate" />
              <span className="h-1.5 rounded-sm bg-muted" aria-hidden>
                <span
                  className="block h-1.5 rounded-sm"
                  style={{ width: `${(100 * r.value) / max}%`, background: color }}
                />
              </span>
              <span className="text-right font-mono">{int(r.value)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-[11px] text-muted-foreground">None recorded.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ left out

function LeftOut() {
  const q = useQuery(landscapeQuery);
  const o = q.data?.overview;
  if (!o) return null;
  return (
    <details className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">
        What is left out, and government counsel
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Facts items={o.leftOut.map((x) => [x.label, int(x.n)] as [string, ReactNode])} />
        <div>
          <p className="m-0 mb-1 text-muted-foreground">
            Government counsel ({fmt(o.government.entries)} entries in {o.government.mdls} MDLs) is
            shown as written and never merged: a bare &ldquo;Office of the Attorney General&rdquo;
            names a different office in each state.
          </p>
          <ul className="m-0 list-disc pl-4 text-[11px]">
            {o.government.offices.slice(0, 12).map((g) => (
              <li key={g.name}>
                {g.name} <span className="text-muted-foreground">({int(g.entries)})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
