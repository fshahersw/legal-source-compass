import { Fragment, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  AMOUNT_BUCKETS,
  getDojLargest,
  getDojReleaseDetail,
  getDojReleases,
  type AmountBucket,
  type DojOverview,
  type DojRelease,
} from "@/lib/external/enforcementActions.functions";
import { cn } from "@/lib/utils";
import { Kpi, LoadingBlock, Panel, SourceLink, StateNote } from "../parts";
import {
  AmountList,
  Chip,
  CompanyList,
  CourtList,
  DetailRow,
  FigureCell,
  FilterSelect,
  HeadlineDetail,
  Pager,
  SearchBox,
} from "./bits";
import { dojOverviewQuery } from "./actionsView";
import { figureView, fmtInt, fmtUsd, headlineText } from "./format";
import { DataDrawer } from "@/components/kit";
import { HELD_LABEL, type HeldReason } from "@/lib/external/enforcementLargest";
import { coverageBreak } from "@/lib/external/enforcementHealth";

export function DojReleases() {
  const q = useQuery(dojOverviewQuery);
  if (q.isLoading) return <LoadingBlock label="Loading DOJ press releases" />;
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
        DOJ press releases could not be loaded.
      </StateNote>
    );
  if (!q.data) return <StateNote>DOJ press releases have not been published yet.</StateNote>;
  return <Body overview={q.data} />;
}

/**
 * The yearly partitions change coverage between 2012 and 2013 (about 1,100–1,500 releases a year before, 16,800–21,200
 * after): a caveat shown above the DOJ trend charts so the jump never reads as more enforcement.
 */
export function DojCoverageNote() {
  const q = useQuery(dojOverviewQuery);
  const brk = q.data
    ? coverageBreak(q.data.partitions.filter((p) => /_\d{4}$/.test(p.dataset)))
    : null;
  if (!brk) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
    >
      <span className="font-medium">Coverage change in {brk.year}: </span>
      the DOJ News API holds {fmtInt(brk.before)} releases dated {Number(brk.year) - 1} and{" "}
      {fmtInt(brk.after)} dated {brk.year}. The jump is the archive&rsquo;s coverage, not more
      enforcement, so do not compare years across it. Topic tags start in 2015.
    </p>
  );
}

type Filters = {
  year: string;
  component?: string | undefined;
  topic?: string | undefined;
  amount?: AmountBucket | undefined;
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

function Body({ overview }: { overview: DojOverview }) {
  const latest = overview.years[overview.years.length - 1]!;
  const [f, setF] = useState<Filters>({ year: latest, q: "", page: 0 });
  const set = (next: Partial<Filters>) => setF((cur) => ({ ...cur, page: 0, ...next }));
  const q = useDebounced(f.q, 350);
  const releases = useQuery({
    queryKey: ["enforcement-actions", "doj", f.year, f.component, f.topic, f.amount, q, f.page],
    queryFn: () =>
      getDojReleases({
        data: {
          year: f.year,
          component: f.component,
          topic: f.topic,
          amount: f.amount,
          q: q || undefined,
          page: f.page,
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  const yearRow = overview.byYear.find((y) => y.year === f.year);
  const withFigure = overview.byYear.reduce(
    (s, y) =>
      s + Object.entries(y.amount).reduce((t, [k, n]) => t + (k === "none" ? 0 : (n ?? 0)), 0),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Press releases"
          value={fmtInt(overview.total)}
          note={`${overview.years[0]}–${latest}, all DOJ components`}
        />
        <Kpi
          label="With a resolution figure stated"
          value={fmtInt(withFigure)}
          note="Settlement, penalty, restitution, forfeiture, disgorgement or judgment keyword in the figure's sentence"
        />
        <Kpi label={`Releases dated ${f.year}`} value={fmtInt(yearRow?.count ?? 0)} />
        <Kpi
          label="Extracted values re-checked"
          value={
            overview.checks.valuesChecked != null
              ? fmtInt(overview.checks.valuesChecked)
              : "Not recorded"
          }
          note={
            overview.checks.spanFailures != null
              ? `${fmtInt(overview.checks.spanFailures)} not found verbatim in the release text`
              : undefined
          }
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        The charts above count releases by release date; choose a year in the list below to read its
        releases. Counts are releases in the DOJ News API on the harvest date. Releases before 2009
        are in DOJ&rsquo;s static archive and are not included.
      </p>

      <Panel
        title={`DOJ press releases, ${f.year}`}
        subtitle="Newest first. Figures are the dollar amounts the release states, labelled by the first keyword in their sentence; they are not verified payments."
        footnote={
          <>
            Source: DOJ News API (justice.gov). Parties are named exactly as the title states them;
            companies link to a company page only on an exact registrant-name match. Courts link
            only when the release names a federal court that maps to exactly one court.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect
            label="Year"
            value={f.year}
            allLabel={null}
            onChange={(v) => set({ year: v ?? latest })}
            options={[...overview.years].reverse().map((y) => ({ value: y, label: y }))}
          />
          <FilterSelect
            label="Component"
            value={f.component}
            onChange={(v) => set({ component: v })}
            options={overview.components
              .slice(0, 200)
              .map((c) => ({ value: c.name, label: `${c.name} (${fmtInt(c.count)})` }))}
          />
          <FilterSelect
            label="Topic"
            value={f.topic}
            onChange={(v) => set({ topic: v })}
            options={overview.topics
              .slice(0, 200)
              .map((t) => ({ value: t.name, label: `${t.name} (${fmtInt(t.count)})` }))}
          />
          <FilterSelect
            label="Largest resolution figure stated"
            value={f.amount}
            onChange={(v) => set({ amount: v as AmountBucket | undefined })}
            options={AMOUNT_BUCKETS.map((b) => ({ value: b.id, label: b.label }))}
          />
          <SearchBox
            label="Search titles, parties, case numbers"
            value={f.q}
            onChange={(v) => set({ q: v })}
            placeholder="e.g. False Claims Act"
          />
        </div>
        {releases.isLoading ? (
          <div className="p-3">
            <LoadingBlock label="Loading releases" />
          </div>
        ) : releases.isError ? (
          <div className="p-3">
            <StateNote
              tone="error"
              action={
                <button type="button" className="underline" onClick={() => void releases.refetch()}>
                  Retry
                </button>
              }
            >
              Releases could not be loaded.
            </StateNote>
          </div>
        ) : !releases.data?.rows.length ? (
          <div className="p-3">
            <StateNote>No release matches these filters in {f.year}.</StateNote>
          </div>
        ) : (
          <>
            <ReleaseTable rows={releases.data.rows} stale={releases.isPlaceholderData} />
            <Pager
              page={f.page}
              pageSize={releases.data.pageSize}
              total={releases.data.total}
              shown={releases.data.rows.length}
              onPage={(p) => setF((cur) => ({ ...cur, page: p }))}
              noun="releases"
            />
          </>
        )}
      </Panel>

      <Largest />
    </div>
  );
}

function ReleaseTable({ rows, stale }: { rows: DojRelease[]; stale: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cn("overflow-x-auto", stale && "opacity-60")}>
      <table className="w-full text-xs">
        <caption className="sr-only">DOJ press releases</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="w-6 px-2 py-1.5">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Date
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Title
            </th>
            <th scope="col" className="hidden px-2 py-1.5 font-medium md:table-cell">
              Component
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 text-right font-medium"
              title="The figure the title states with a resolution verb, else the first resolution figure in the text; the largest stated resolution figure is shown below it when it is another value"
            >
              Headline figure
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => {
            const expanded = open === r.id;
            const lead = r.components.find((c) => c.startsWith("USAO")) ?? r.components[0];
            return (
              <Fragment key={r.id}>
                <tr className="align-top">
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`doj-${r.id}`}
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
                    {r.date ?? "Not recorded"}
                  </td>
                  <td className="min-w-[14rem] px-2 py-1">
                    {r.url ? <SourceLink href={r.url}>{r.title}</SourceLink> : r.title}
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {r.dockets.slice(0, 2).map((d) => (
                        <Chip key={d} title="Case or docket number stated in the release">
                          {d}
                        </Chip>
                      ))}
                      {r.statutes.slice(0, 2).map((s) => (
                        <Chip key={s} tone="muted" title="Statute cited in the release">
                          {s}
                        </Chip>
                      ))}
                      {r.companies.length ? (
                        <Chip title="Exact match to an SEC registrant">Company page</Chip>
                      ) : null}
                    </span>
                  </td>
                  <td
                    className="hidden max-w-56 truncate px-2 py-1 md:table-cell"
                    title={r.components.join("; ")}
                  >
                    {lead ?? "Not recorded"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right font-mono">
                    <FigureCell
                      headline={r.headline}
                      largest={r.maxResolutionUsd}
                      none="None stated"
                      noneReason={r.headlineNoneReason}
                    />
                  </td>
                </tr>
                {expanded ? (
                  <tr id={`doj-${r.id}`}>
                    <td colSpan={5} className="bg-muted/30 px-3 py-2">
                      <ReleaseDetail release={r} />
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

function ReleaseDetail({ release: r }: { release: DojRelease }) {
  const detail = useQuery({
    queryKey: ["enforcement-actions", "doj-detail", r.dataset, r.id],
    queryFn: () => getDojReleaseDetail({ data: { dataset: r.dataset, id: r.id } }),
    staleTime: 30 * 60 * 1000,
  });
  return (
    <dl className="space-y-1.5">
      <DetailRow label="Components">{r.components.join("; ") || "Not recorded"}</DetailRow>
      {r.topics.length ? <DetailRow label="Topics">{r.topics.join("; ")}</DetailRow> : null}
      {r.parties.length ? (
        <DetailRow label="Named in the title">
          {r.parties.map((p) => p.asWritten).join("; ")}
        </DetailRow>
      ) : null}
      {r.companies.length ? (
        <DetailRow label="Company pages">
          <CompanyList companies={r.companies} />
        </DetailRow>
      ) : null}
      <DetailRow label="Headline figure">
        <HeadlineDetail
          headline={r.headline}
          largest={r.maxResolutionUsd}
          noneReason={r.headlineNoneReason}
        />
      </DetailRow>
      <DetailRow
        label={`Dollar figures stated${r.amountsTotal > r.amounts.length ? ` (first ${r.amounts.length} of ${r.amountsTotal})` : ""}`}
      >
        <AmountList amounts={r.amounts} />
      </DetailRow>
      <DetailRow label="Statutes cited">{r.statutes.join("; ") || "None found"}</DetailRow>
      <DetailRow label="Case or docket numbers">{r.dockets.join("; ") || "None stated"}</DetailRow>
      <DetailRow label="Federal courts named">
        <CourtList courts={r.courts} />
      </DetailRow>
      <DetailRow label="Excerpt">
        {detail.isLoading ? (
          <span className="text-muted-foreground">Loading excerpt…</span>
        ) : detail.isError ? (
          <span className="text-destructive">The excerpt could not be loaded.</span>
        ) : detail.data?.excerpt ? (
          <span className="block whitespace-pre-line text-[11px] leading-4">
            {detail.data.excerpt}
          </span>
        ) : (
          <span className="text-muted-foreground">Not recorded</span>
        )}
      </DetailRow>
    </dl>
  );
}

const HELD_ORDER: HeldReason[] = [
  "title_contradicts",
  "other_party",
  "not_outcome",
  "maximum",
  "title_no_resolution",
  "distribution",
  "statistics",
  "personnel",
  "speech",
  "filing",
  "charge",
];

/**
 * Largest resolutions, all years: ranked by the figure each release's own title states (never the largest figure its
 * text mentions). Figures read only from the text are listed apart and unranked ("View figures read from the text");
 * speeches, ceremonies, totals, victim distributions, filings, charges and implausible figures are held back (listed
 * with the reason in "View held-back releases"); exact repeats of one release are collapsed into one entry.
 */
function Largest() {
  const q = useQuery({
    queryKey: ["enforcement-actions", "doj-largest", "v3"],
    queryFn: () => getDojLargest(),
    staleTime: 10 * 60 * 1000,
  });
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const entries = q.data?.entries ?? [];
  const held = useMemo(
    () =>
      [...(q.data?.held ?? [])].sort(
        (a, b) =>
          HELD_ORDER.indexOf(a.reason) - HELD_ORDER.indexOf(b.reason) ||
          (b.release.headline?.valueUsd ?? 0) - (a.release.headline?.valueUsd ?? 0),
      ),
    [q.data],
  );
  const shown = expanded ? entries.slice(0, 100) : entries.slice(0, 12);
  return (
    <Panel
      title="Largest resolutions, all years"
      subtitle="Releases whose title states a resolution of $1 billion or more"
      footnote={
        <>
          Ranked only by the amount the release title states. Figures found only in the release text
          are listed apart, unranked. Speeches, totals, victim payouts, filings, charges and
          statutory maximums are held back. Only exact repeats of one release are merged. Figures
          are as stated, not verified payments, and are never summed.
          {q.data
            ? ` ${fmtInt(q.data.candidates)} releases reached $1 billion: ${fmtInt(entries.length)} ranked, ${fmtInt(q.data.textOnly.length)} text-only, ${fmtInt(held.length)} held back.`
            : ""}
        </>
      }
    >
      {q.isLoading ? (
        <div className="p-3">
          <LoadingBlock label="Loading largest resolutions" />
        </div>
      ) : q.isError ? (
        <div className="p-3">
          <StateNote tone="error">The list could not be loaded.</StateNote>
        </div>
      ) : !entries.length ? (
        <div className="p-3">
          <StateNote>No release states a resolution figure of $1 billion or more.</StateNote>
        </div>
      ) : (
        <div className="space-y-2 px-3 py-2">
          <ol className="space-y-1 text-xs" id="doj-largest">
            {shown.map(({ release: r, valueUsd, related }) => (
              <li key={r.id} className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="w-32 shrink-0 text-right font-mono"
                    title={
                      r.headline ? (figureView(r.headline, null).note ?? undefined) : undefined
                    }
                  >
                    {r.headline ? headlineText(r.headline) : fmtUsd(valueUsd)}
                  </span>
                  <span className="w-20 shrink-0 font-mono text-muted-foreground">
                    {r.date ?? "Not recorded"}
                  </span>
                  <span className="min-w-0 truncate" title={r.title}>
                    {r.url ? <SourceLink href={r.url}>{r.title}</SourceLink> : r.title}
                  </span>
                  {related.length ? (
                    <button
                      type="button"
                      aria-expanded={openId === r.id}
                      aria-controls={`doj-related-${r.id}`}
                      onClick={() => setOpenId(openId === r.id ? null : r.id)}
                      className="shrink-0 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      +{fmtInt(related.length)} related release{related.length === 1 ? "" : "s"}
                    </button>
                  ) : null}
                </div>
                {openId === r.id ? (
                  <ul id={`doj-related-${r.id}`} className="mt-0.5 space-y-0.5 sm:ml-[13.5rem]">
                    {related.map((x) => (
                      <li
                        key={x.id}
                        className="flex min-w-0 gap-2 text-[11px] text-muted-foreground"
                      >
                        <span className="w-20 shrink-0 font-mono">{x.date ?? "Not recorded"}</span>
                        <span className="w-28 shrink-0 font-mono">
                          {x.headline ? headlineText(x.headline) : "Not recorded"}
                        </span>
                        <span className="min-w-0 truncate" title={x.title}>
                          {x.url ? <SourceLink href={x.url}>{x.title}</SourceLink> : x.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            {entries.length > 12 ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls="doj-largest"
                onClick={() => setExpanded((v) => !v)}
                className="rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {expanded
                  ? "Show fewer"
                  : `Show ${fmtInt(Math.min(entries.length, 100) - 12)} more`}
              </button>
            ) : null}
            {q.data?.textOnly.length ? (
              <DataDrawer
                title="Figures read only from the release text"
                description="The title states no amount, so these are not ranked. Each figure comes from the sentence shown; check the release before relying on it."
                rows={q.data.textOnly}
                rowKey={(e) => e.release.id}
                triggerLabel={`View ${fmtInt(q.data.textOnly.length)} figures read from the text`}
                searchable
                columns={[
                  {
                    key: "figure",
                    label: "Figure (USD)",
                    align: "right",
                    value: (e) => e.valueUsd,
                    render: (e) =>
                      e.release.headline ? headlineText(e.release.headline) : fmtUsd(e.valueUsd),
                  },
                  { key: "kind", label: "Kind", value: (e) => e.release.headline?.keyword ?? null },
                  { key: "date", label: "Date", value: (e) => e.release.date },
                  {
                    key: "title",
                    label: "Release",
                    value: (e) => e.release.title,
                    render: (e) =>
                      e.release.url ? (
                        <SourceLink href={e.release.url}>{e.release.title}</SourceLink>
                      ) : (
                        e.release.title
                      ),
                  },
                  {
                    key: "sentence",
                    label: "Sentence",
                    value: (e) => e.release.headline?.sentence ?? null,
                  },
                  {
                    key: "related",
                    label: "Same release elsewhere",
                    value: (e) => e.related.length,
                  },
                ]}
                source={{
                  source: {
                    label: "DOJ News API (justice.gov)",
                    href: "https://www.justice.gov/news",
                  },
                }}
              />
            ) : null}
            {held.length ? (
              <DataDrawer
                title="Releases held back from the largest resolutions"
                description="Each release reached $1 billion by its headline figure but is not ranked, for the reason shown."
                rows={held}
                rowKey={(h) => h.release.id}
                triggerLabel={`View ${fmtInt(held.length)} held-back releases`}
                searchable
                columns={[
                  { key: "reason", label: "Reason", value: (h) => HELD_LABEL[h.reason] },
                  {
                    key: "figure",
                    label: "Headline figure (USD)",
                    align: "right",
                    value: (h) => h.release.headline?.valueUsd ?? null,
                    render: (h) =>
                      h.release.headline ? headlineText(h.release.headline) : "Not recorded",
                  },
                  { key: "date", label: "Date", value: (h) => h.release.date },
                  {
                    key: "title",
                    label: "Release",
                    value: (h) => h.release.title,
                    render: (h) =>
                      h.release.url ? (
                        <SourceLink href={h.release.url}>{h.release.title}</SourceLink>
                      ) : (
                        h.release.title
                      ),
                  },
                  { key: "detail", label: "Detail", value: (h) => h.detail },
                ]}
                source={{
                  source: {
                    label: "DOJ News API (justice.gov)",
                    href: "https://www.justice.gov/news",
                  },
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
