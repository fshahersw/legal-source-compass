import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText, Search } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TIER_PLURAL, TIERS, type CaseHit, type LiveHit, type Tier } from "@/lib/external/caselaw";
import { cn } from "@/lib/utils";
import {
  casesSearchQuery,
  courtsQuery,
  coverageQuery,
  fulltextQuery,
  liveQuery,
} from "./caseQueries";
import { fmtDay, fmtInt, NOT_RECORDED, stateLabel, yearOf } from "./caseFormat";
import {
  coverageLines,
  MODE_LABEL,
  SORT_LABEL,
  STATUSES,
  type CaseMode,
  type CaseSearchState,
  type CaseSort,
} from "./caseSearch";

type Nav = (next: CaseSearchState) => void;
const selectClass =
  "h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function Skeleton() {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
      ))}
    </div>
  );
}

export function Problem({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground"
    >
      {children}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      ) : null}
    </p>
  );
}

export function Pager({
  page,
  hasMore,
  go,
}: {
  page: number;
  hasMore: boolean;
  go: (p: number) => void;
}) {
  if (page <= 1 && !hasMore) return null;
  return (
    <div className="flex items-center gap-2 pt-2 text-[12px]">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => go(page - 1)}>
        Previous
      </Button>
      <span className="text-muted-foreground">Page {page}</span>
      <Button size="sm" variant="outline" disabled={!hasMore} onClick={() => go(page + 1)}>
        Next
      </Button>
    </div>
  );
}

export function HitTable({
  rows,
  showMatched,
  hideCourt,
}: {
  rows: CaseHit[];
  showMatched?: boolean;
  /** One court's own list: the court column would repeat its name on every row. */
  hideCourt?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[44rem] text-xs">
        <caption className="sr-only">Cases</caption>
        <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Case</th>
            {hideCourt ? null : <th className="px-2 py-1.5 font-medium">Court</th>}
            <th className="px-2 py-1.5 font-medium">Filed</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            <th
              className="px-3 py-1.5 text-right font-medium"
              title="Citing opinions in the citation map"
            >
              Cited by
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.clusterId} className="align-top">
              <td className="px-3 py-1.5">
                <Link
                  to="/cases/$id"
                  params={{ id: String(r.clusterId) }}
                  className="font-medium text-primary hover:underline"
                >
                  {r.caseName}
                </Link>
                {!r.hasText ? (
                  <span
                    className="ml-1 text-[10px] text-muted-foreground"
                    title="Metadata only: text not in the reading store yet"
                  >
                    (no text yet)
                  </span>
                ) : null}
                <div className="text-[11px] text-muted-foreground">
                  {r.citations.length
                    ? r.citations.slice(0, 3).join(" · ")
                    : "No citation recorded"}
                  {showMatched && r.matched.length
                    ? ` · matched in ${[...new Set(r.matched.map((m) => m.label.toLowerCase()))].join(", ")}`
                    : ""}
                </div>
              </td>
              {hideCourt ? null : (
                <td className="px-2 py-1.5 text-muted-foreground">
                  {r.court ?? r.courtId}
                  {r.jurisdiction ? (
                    <span className="ml-1 text-[11px]" title={stateLabel(r.jurisdiction)}>
                      · {r.jurisdiction}
                    </span>
                  ) : null}
                </td>
              )}
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDay(r.dateFiled)}</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {r.precedentialStatus ?? NOT_RECORDED}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtInt(r.citedBy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CasesResults({ s, nav }: { s: CaseSearchState; nav: Nav }) {
  const q = useQuery(casesSearchQuery(s));
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return <Problem onRetry={() => void q.refetch()}>The search could not be run.</Problem>;
  const d = q.data!;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        {d.note ? `${d.note} ` : ""}
        {d.mode === "citation"
          ? "Cases with this exact citation."
          : d.mode === "name"
            ? s.sort && s.sort !== "relevance"
              ? "Case names containing every word (the last word may be the start of a word)."
              : "Case names containing every word (the last word may be the start of a word); cases whose short name has them all come first, most cited first."
            : "All cases, most cited first. Type a case name or a citation such as 384 U.S. 436."}
        {d.dropped ? ` ${d.dropped} malformed rows were left out.` : ""}
      </p>
      {d.rows.length ? (
        <HitTable rows={d.rows} />
      ) : (
        <Problem>
          No case matches.{" "}
          {s.q
            ? "Try fewer words, another spelling, or the full-text search."
            : "Loosen the filters."}
        </Problem>
      )}
      <Pager
        page={d.page}
        hasMore={d.hasMore}
        go={(page) => nav({ ...s, page: page > 1 ? page : undefined })}
      />
    </div>
  );
}

/** "Supreme Court (every word); Federal district courts (first 1,000 words of each opinion)" */
function coverageText(tiers: { tier: Tier; scope: string; prefixWords: number | null }[]): string {
  if (!tiers.length) return "the Supreme Court";
  return tiers
    .map(
      (t) =>
        `${TIER_PLURAL[t.tier]} (${t.scope === "full" ? "every word" : `first ${fmtInt(t.prefixWords)} words of each opinion`})`,
    )
    .join("; ");
}

/** Full-text coverage by court level, stated plainly: every word, the first N words, or not indexed. */
function CoverageNote({
  tiers,
}: {
  tiers: { tier: Tier; scope: "full" | "prefix"; opinions: number; prefixWords: number | null }[];
}) {
  const lines = coverageLines(tiers, TIERS);
  return (
    <details className="rounded-md border border-border px-3 py-2 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground">
        What the full text covers: {lines.filter((l) => l.level === "full").length} level
        {lines.filter((l) => l.level === "full").length === 1 ? "" : "s"} every word,{" "}
        {lines.filter((l) => l.level === "prefix").length} the opening words only,{" "}
        {lines.filter((l) => l.level === "none").length} not indexed
      </summary>
      <ul className="mt-2 space-y-0.5">
        {lines.map((l) => (
          <li key={l.tier} className="flex flex-wrap gap-x-2">
            <span className="min-w-[16rem] text-foreground">{TIER_PLURAL[l.tier]}</span>
            <span className={cn(l.level === "none" ? "text-muted-foreground" : "text-foreground")}>
              {l.text}
            </span>
            {l.opinions != null ? (
              <span className="text-muted-foreground">({fmtInt(l.opinions)} opinions)</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">
        A level that is not indexed returns no full-text match here even when its opinions mention
        the words; use the CourtListener full text for those courts.
      </p>
    </details>
  );
}

function FulltextResults({ s, nav }: { s: CaseSearchState; nav: Nav }) {
  const q = useQuery(fulltextQuery(s));
  const cov = useQuery(coverageQuery);
  const note = cov.data ? <CoverageNote tiers={cov.data.tiers} /> : null;
  const indexed = (cov.data?.tiers ?? []).filter((t) => t.opinions > 0 || t.tier === 1);
  const scope = coverageText(indexed);
  const tierIndexed = !s.tier || indexed.some((t) => t.tier === s.tier);
  if (!s.q)
    return (
      <div className="space-y-2">
        <Problem>Type words or a phrase in quotes to search opinion text of {scope}.</Problem>
        {note}
      </div>
    );
  if (cov.isSuccess && !tierIndexed)
    return (
      <Problem>
        The opinion text of {TIER_PLURAL[s.tier!]?.toLowerCase()} is not indexed here yet (indexed:{" "}
        {scope}). Their opinions can be read on each case page; search their text with CourtListener
        full text.
        <button
          type="button"
          onClick={() => nav({ ...s, mode: "live", page: undefined, cursor: undefined })}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Search at the source
        </button>
      </Problem>
    );
  if (q.isLoading) return <Skeleton />;
  if (q.isError)
    return (
      <Problem onRetry={() => void q.refetch()}>The full-text search could not be run.</Problem>
    );
  const d = q.data!;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        Opinions whose indexed text matches (English stemming; "quoted phrases", OR and -word work).
        Indexed here: {scope}. Cases are ranked by how densely the words occur, then by citations.
      </p>
      {note}
      {d.rows.length ? (
        <HitTable rows={d.rows} showMatched />
      ) : (
        <Problem>No indexed opinion text matches “{s.q}”.</Problem>
      )}
      <Pager
        page={d.page}
        hasMore={d.hasMore}
        go={(page) => nav({ ...s, page: page > 1 ? page : undefined })}
      />
    </div>
  );
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("⟦") ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

function LiveResults({ s, nav }: { s: CaseSearchState; nav: Nav }) {
  const q = useQuery(liveQuery(s));
  if (!s.q)
    return (
      <Problem>
        Type words to search the full text of federal appellate and state highest-court opinions.
      </Problem>
    );
  if (q.isLoading)
    return (
      <div className="space-y-2">
        <p role="status" className="text-[12px] text-muted-foreground">
          {s.semantic
            ? "Searching by meaning on CourtListener; this usually takes 20 to 30 seconds."
            : "Searching on CourtListener; a search over many courts can take up to half a minute."}
        </p>
        <Skeleton />
      </div>
    );
  if (q.isError)
    return <Problem onRetry={() => void q.refetch()}>The live search could not be run.</Problem>;
  const d = q.data!;
  if (!d.ok)
    return (
      <Problem onRetry={d.reason === "upstream_error" ? () => void q.refetch() : undefined}>
        {d.reason === "rate_limited"
          ? "CourtListener's live search is at its request limit for this site. Try again in a few minutes, or search names and citations here."
          : d.reason === "not_configured"
            ? "The live CourtListener search is not configured on this server."
            : d.reason === "no_courts"
              ? "No court matches these filters."
              : d.reason === "too_many_courts"
                ? "This court level has too many courts for one search: choose a state or a court."
                : "CourtListener's live search did not answer. Try again shortly."}
      </Problem>
    );
  const rows: LiveHit[] = d.rows;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        {d.source === "live"
          ? "Live results from CourtListener's search service"
          : "Cached results from CourtListener's search service"}
        , fetched{" "}
        {new Date(d.fetchedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        {d.count != null ? ` · about ${fmtInt(d.count)} matches` : ""}
        {d.semantic ? " · meaning-based (semantic) ranking" : ""}. Cases with a page here open here;
        others open on CourtListener.
      </p>
      {rows.length ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.clusterId} className="px-3 py-2 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {r.held ? (
                  <Link
                    to="/cases/$id"
                    params={{ id: String(r.clusterId) }}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.caseName}
                  </Link>
                ) : (
                  <a
                    href={r.courtListenerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium hover:text-primary hover:underline"
                  >
                    {r.caseName}
                    <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
                  </a>
                )}
                <span className="text-muted-foreground">
                  {[r.citations[0], r.court, yearOf(r.dateFiled), r.status]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {r.snippet ? (
                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  <Snippet text={r.snippet} />
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Problem>CourtListener found no opinion of these courts matching “{s.q}”.</Problem>
      )}
      {d.next || s.cursor ? (
        <div className="flex items-center gap-2 pt-2">
          {s.cursor ? (
            <Button size="sm" variant="outline" onClick={() => nav({ ...s, cursor: undefined })}>
              First page
            </Button>
          ) : null}
          {d.next ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => nav({ ...s, cursor: d.next ?? undefined })}
            >
              Next
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CaseSearchPage({ s, nav }: { s: CaseSearchState; nav: Nav }) {
  const mode: CaseMode = s.mode ?? "cases";
  const [text, setText] = useState(s.q ?? "");
  useEffect(() => setText(s.q ?? ""), [s.q]);
  const courts = useQuery(courtsQuery);
  const levels: Tier[] = mode === "live" ? TIERS.filter((t) => t >= 2) : [...TIERS];
  const inMode = (courts.data ?? []).filter(
    (c) => (mode === "live" ? c.tier >= 2 : true) && (!s.tier || c.tier === s.tier),
  );
  const states = [
    ...new Set(inMode.map((c) => c.jurisdiction).filter((j): j is string => !!j)),
  ].sort((a, b) => stateLabel(a).localeCompare(stateLabel(b)));
  const courtOptions = inMode.filter((c) => !s.jur || c.jurisdiction === s.jur);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    nav({ ...s, q: text.trim() || undefined, page: undefined, cursor: undefined });
  };
  const set = (patch: CaseSearchState) =>
    nav({ ...s, ...patch, page: undefined, cursor: undefined });
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Search type" className="inline-flex rounded-lg bg-muted p-1">
        {(Object.keys(MODE_LABEL) as CaseMode[]).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() =>
              set({
                mode: m === "cases" ? undefined : m,
                tier: m === "live" && s.tier === 1 ? undefined : s.tier,
                court: undefined,
                semantic: undefined,
              })
            }
            className={cn(
              "rounded-md px-3 py-1 text-[12px] font-medium",
              mode === m
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === "cases"
                ? "Case name or citation, e.g. Miranda v. Arizona or 384 U.S. 436"
                : mode === "fulltext"
                  ? 'Words or "a phrase" in opinion text'
                  : "Words in opinions, searched on CourtListener"
            }
            aria-label="Search cases"
            className="h-8 pl-8 text-[13px]"
            maxLength={300}
          />
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Court level">
          <select
            value={s.tier ?? ""}
            onChange={(e) =>
              set({
                tier: e.target.value ? (Number(e.target.value) as Tier) : undefined,
                court: undefined,
              })
            }
            className={cn(selectClass, "max-w-[15rem]")}
          >
            <option value="">
              {mode === "live" ? "Federal appellate and state highest" : "Every level"}
            </option>
            {levels.map((t) => (
              <option key={t} value={t}>
                {TIER_PLURAL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="State">
          <select
            value={s.jur ?? ""}
            onChange={(e) => set({ jur: e.target.value || undefined, court: undefined })}
            className={cn(selectClass, "max-w-[11rem]")}
            disabled={!states.length && !s.jur}
          >
            <option value="">{courts.isLoading ? "Loading…" : "Any state"}</option>
            {states.map((j) => (
              <option key={j} value={j}>
                {stateLabel(j)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Court">
          <select
            value={s.court ?? ""}
            onChange={(e) => set({ court: e.target.value || undefined })}
            className={cn(selectClass, "max-w-[16rem]")}
          >
            <option value="">
              {courts.isLoading
                ? "Loading courts…"
                : courts.isError
                  ? "Courts unavailable"
                  : "Any court"}
            </option>
            {courtOptions.map((c) => (
              <option key={c.courtId} value={c.courtId}>
                {c.name} ({fmtInt(c.cases)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Filed from">
          <input
            type="date"
            value={s.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined })}
            className={selectClass}
          />
        </Field>
        <Field label="to">
          <input
            type="date"
            value={s.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined })}
            className={selectClass}
          />
        </Field>
        {mode !== "fulltext" ? (
          <Field label="Status">
            <select
              value={s.status ?? ""}
              onChange={(e) => set({ status: e.target.value || undefined })}
              className={selectClass}
            >
              <option value="">{mode === "live" ? "Published only" : "Any"}</option>
              {mode === "live" ? (
                <option value="Unknown">All statuses</option>
              ) : (
                STATUSES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))
              )}
            </select>
          </Field>
        ) : null}
        <Field label="Order">
          <select
            value={s.sort ?? ""}
            onChange={(e) => set({ sort: (e.target.value || undefined) as CaseSort | undefined })}
            className={selectClass}
            disabled={mode === "live" && !!s.semantic}
          >
            <option value="">
              {mode === "cases" && !s.q ? SORT_LABEL.cited : SORT_LABEL.relevance}
            </option>
            {(Object.keys(SORT_LABEL) as CaseSort[])
              .filter((k) => k !== "relevance")
              .map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
          </select>
        </Field>
        {mode === "live" ? (
          <label className="flex h-8 items-center gap-1 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={!!s.semantic}
              onChange={(e) => set({ semantic: e.target.checked || undefined })}
            />
            Search by meaning
          </label>
        ) : null}
      </div>
      {mode === "cases" ? (
        <CasesResults s={s} nav={nav} />
      ) : mode === "fulltext" ? (
        <FulltextResults s={s} nav={nav} />
      ) : (
        <LiveResults s={s} nav={nav} />
      )}
      <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
        <FileText className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span>
          Every court level from CourtListener's bulk data (snapshot 2026-09-30): the Supreme Court,
          federal courts of appeals, state highest and intermediate appellate courts, federal
          district courts and other courts. Names and citations are searched here, opinion text
          where it is indexed; any court's text can also be searched through CourtListener's live
          service.{" "}
          <Link to="/cases/courts" className="text-primary hover:underline">
            Browse by court
          </Link>
          .
        </span>
      </p>
    </div>
  );
}
