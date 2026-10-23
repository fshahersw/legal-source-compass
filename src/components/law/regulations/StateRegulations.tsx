import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  getStateRegRule,
  getStateRegTree,
  listStateRegisterIssues,
  searchStateRegs,
  type PathStep,
  type RegCode,
  type RegNode,
  type RegRuleHead,
} from "@/lib/external/stateRegs.functions";
import { cn } from "@/lib/utils";
import {
  REG_TABS,
  type RegTab,
  ACCESS_LABEL,
  CHECK_LABEL,
  STATUS_LABEL,
  acquisitionLine,
  fmtDate,
  issueWhen,
  issuesByYear,
  plural,
  robotsLine,
} from "./labels";

const tabCls =
  "-mb-px inline-flex items-center border-b-2 px-3 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring";
const linkCls = "inline-flex items-center gap-1 text-primary hover:underline";

/** Quiet underlined tabs; each is a real link so the tab has its own address and back/forward works. */
export function RegTabs({ state, active }: { state: string; active: RegTab }) {
  return (
    <nav
      aria-label="Administrative code sections"
      className="mb-3 flex flex-wrap gap-1 border-b border-border"
    >
      {REG_TABS.map((t) => (
        <Link
          key={t.id}
          to="/law/regulations/$state"
          params={{ state }}
          search={{ q: "", level: undefined, ...(t.id === "contents" ? {} : { tab: t.id }) }}
          className={cn(
            tabCls,
            t.id === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          {...(t.id === active ? { "aria-current": "page" as const } : {})}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function Official({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkCls}>
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div
      className="h-20 animate-pulse rounded-lg border border-border bg-muted/40"
      aria-busy="true"
      aria-label={label}
    />
  );
}

/** One-line source strip above the tabs: official link, how the text was read, currency as printed. */
export function SourceStrip({ code }: { code: RegCode }) {
  return (
    <section
      aria-label="Source"
      className="mb-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs"
    >
      <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 leading-relaxed">
        <Official href={code.codeUrl}>Official {code.codeName}</Official>
        <span className="text-muted-foreground">{acquisitionLine(code)}</span>
        <span className="text-muted-foreground">Currency: {code.currency ?? "Not recorded"}</span>
      </p>
      {code.blockedReason || code.acquisitionReason ? (
        <p className="m-0 mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {code.blockedReason ?? code.acquisitionReason}
        </p>
      ) : null}
    </section>
  );
}

function Crumbs({ state, path }: { state: string; path: PathStep[] }) {
  return (
    <nav
      aria-label="Position in the code"
      className="mb-2 flex flex-wrap items-center gap-1 text-[12px]"
    >
      <Link
        to="/law/regulations/$state"
        params={{ state }}
        search={{ q: "", level: undefined }}
        className="text-primary hover:underline"
      >
        Top
      </Link>
      {path.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1">
          <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
          <Link
            to="/law/regulations/$state"
            params={{ state }}
            search={{ q: "", level: undefined, node: p.id }}
            className="text-primary hover:underline"
          >
            {[p.num, p.heading].filter(Boolean).join(" ") || p.level}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function nodeLabel(n: RegNode): string {
  const num = n.num ?? "";
  const head = n.heading ?? "";
  if (num && head && !head.startsWith(num)) return `${num} ${head}`;
  return head || num || n.level;
}

function RuleRow({ r }: { r: RegRuleHead }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-[13px]">
      <Link
        to="/law/regulations/$state"
        params={{ state: r.state }}
        search={{ q: "", level: undefined, rule: r.id }}
        className="font-medium text-primary hover:underline"
      >
        {r.citation}
      </Link>
      <span className={r.status === "active" ? "" : "text-muted-foreground"}>
        {r.heading ?? "Not recorded"}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {r.status !== "active" ? r.status : null}
        {r.emergency ? " · emergency or temporary" : ""}
        {r.effectiveDate
          ? `${r.status !== "active" || r.emergency ? " · " : ""}effective ${fmtDate(r.effectiveDate)}`
          : ""}
        {r.chars === null ? " · no text printed" : ""}
      </span>
    </li>
  );
}

export function ContentsPanel({ state, node }: { state: string; node: string | undefined }) {
  const treeFn = useServerFn(getStateRegTree);
  const tree = useInfiniteQuery({
    queryKey: ["state-reg-tree", state, node ?? null],
    queryFn: ({ pageParam }) =>
      treeFn({ data: { state, parent: node ?? null, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + (p?.nodes.length ?? 0), 0);
      return last && loaded < last.total ? loaded : undefined;
    },
    staleTime: 10 * 60 * 1000,
  });
  if (tree.error) return <ExternalError error={tree.error} />;
  if (tree.isLoading) return <Loading label="Loading the table of contents" />;
  const first = tree.data?.pages[0] ?? null;
  if (!first)
    return (
      <p className="text-sm text-muted-foreground">The table of contents is not available yet.</p>
    );
  const nodes = tree.data!.pages.flatMap((p) => p?.nodes ?? []);
  return (
    <div>
      {node ? <Crumbs state={state} path={first.path} /> : null}
      {first.parent ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {first.parent.citation ?? first.parent.level}
          {first.parent.agency ? ` · ${first.parent.agency}` : ""} ·{" "}
          {first.parent.ruleCount !== null
            ? `${first.parent.ruleCount.toLocaleString("en-US")} rules listed by the publisher`
            : "rule count not listed by the publisher"}
          {` · ${first.parent.rulesLoaded.toLocaleString("en-US")} held here`} ·{" "}
          <Official href={first.parent.sourceUrl}>Publisher's page</Official>
        </p>
      ) : null}
      {nodes.length === 0 && first.rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {node
            ? "Nothing is recorded under this heading."
            : "No table of contents is loaded for this state yet."}
        </p>
      ) : null}
      {nodes.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {nodes.map((n) => (
            <li
              key={n.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-[13px]"
            >
              <Link
                to="/law/regulations/$state"
                params={{ state }}
                search={{ q: "", level: undefined, node: n.id }}
                className="min-w-0 text-primary hover:underline"
              >
                {nodeLabel(n)}
              </Link>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                {n.level}
                {n.children ? ` · ${plural(n.children, "entry", "entries")}` : ""}
                {n.ruleCount !== null ? ` · ${plural(n.ruleCount, "rule", "rules")} listed` : ""}
                {n.rulesLoaded ? ` · ${n.rulesLoaded.toLocaleString("en-US")} held` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {tree.hasNextPage ? (
        <button
          type="button"
          onClick={() => void tree.fetchNextPage()}
          disabled={tree.isFetchingNextPage}
          className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60"
        >
          {tree.isFetchingNextPage ? "Loading…" : "Show more headings"}
        </button>
      ) : null}
      {first.rules.length ? (
        <section aria-label="Rules" className="mt-3">
          <h2 className="eyebrow mb-1">Rules</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {first.rules.map((r) => (
              <RuleRow key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ) : node && first.parent && first.parent.ruleCount && !first.parent.rulesLoaded ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The rule text under this heading is not loaded yet; read it on the{" "}
          <Official href={first.parent.sourceUrl}>publisher's page</Official>.
        </p>
      ) : null}
    </div>
  );
}

export function RuleReader({ id }: { id: string }) {
  const ruleFn = useServerFn(getStateRegRule);
  const q = useQuery({
    queryKey: ["state-reg-rule", id],
    queryFn: () => ruleFn({ data: { id } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.error) return <ExternalError error={q.error} />;
  if (q.isLoading) return <Loading label="Loading the rule" />;
  const v = q.data;
  if (!v) return <p className="text-sm text-muted-foreground">This rule is not held here.</p>;
  const r = v.rule;
  const check = r.textCheck?.text ?? "not_checked";
  return (
    <article aria-label={r.citation} className="max-w-3xl">
      <Crumbs state={r.state} path={v.path} />
      <header className="mb-3">
        <h2 className="text-base font-semibold leading-snug">
          {r.citation}
          {r.heading ? <span className="font-normal"> {r.heading}</span> : null}
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12px]">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="m-0">
            {r.status}
            {r.emergency === true ? " · emergency or temporary rule" : ""}
          </dd>
          <dt className="text-muted-foreground">Effective</dt>
          <dd className="m-0">{fmtDate(r.effectiveDate)}</dd>
          <dt className="text-muted-foreground">Register</dt>
          <dd className="m-0">{r.registerCitation ?? "Not recorded"}</dd>
          <dt className="text-muted-foreground">Agency</dt>
          <dd className="m-0">{r.agency ?? "Not recorded"}</dd>
          <dt className="text-muted-foreground">Official text</dt>
          <dd className="m-0">
            <Official href={r.sourceUrl}>{v.publisher ?? "Publisher's page"}</Official>
          </dd>
          <dt className="text-muted-foreground">Currency</dt>
          <dd className="m-0">{r.currency ?? "Not recorded"}</dd>
          <dt className="text-muted-foreground">Retrieved</dt>
          <dd className="m-0">{r.retrievedAt ? r.retrievedAt.slice(0, 10) : "Not recorded"}</dd>
          <dt className="text-muted-foreground">Text check</dt>
          <dd className="m-0" title={r.textCheck?.method ?? undefined}>
            {CHECK_LABEL[check] ?? check}
          </dd>
        </dl>
      </header>
      {r.text ? (
        <div className="whitespace-pre-line rounded-lg border border-border bg-surface px-4 py-3 text-[14px] leading-relaxed">
          {r.text}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The publisher prints no text for this rule.</p>
      )}
      {r.history || r.authority ? (
        <section
          aria-label="History and authority"
          className="mt-3 text-[12px] leading-relaxed text-muted-foreground"
        >
          {r.authority ? <p className="m-0 whitespace-pre-line">Authority: {r.authority}</p> : null}
          {r.history ? <p className="m-0 mt-1 whitespace-pre-line">{r.history}</p> : null}
        </section>
      ) : null}
      <nav
        aria-label="Neighbouring rules"
        className="mt-4 flex flex-wrap justify-between gap-2 text-[12px]"
      >
        {v.prev ? (
          <Link
            to="/law/regulations/$state"
            params={{ state: r.state }}
            search={{ q: "", level: undefined, rule: v.prev.id }}
            className="text-primary hover:underline"
          >
            ← {v.prev.citation}
          </Link>
        ) : (
          <span />
        )}
        {v.next ? (
          <Link
            to="/law/regulations/$state"
            params={{ state: r.state }}
            search={{ q: "", level: undefined, rule: v.next.id }}
            className="text-primary hover:underline"
          >
            {v.next.citation} →
          </Link>
        ) : null}
      </nav>
    </article>
  );
}

export function SearchPanel({
  state,
  q,
  onSearch,
}: {
  state: string;
  q: string;
  onSearch: (q: string) => void;
}) {
  const [draft, setDraft] = useState(q);
  const [page, setPage] = useState({ q, offset: 0 });
  const offset = page.q === q ? page.offset : 0;
  const searchFn = useServerFn(searchStateRegs);
  const res = useQuery({
    queryKey: ["state-reg-search", state, q, offset],
    queryFn: () => searchFn({ data: { state, q, offset } }),
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  });
  return (
    <div>
      <form
        role="search"
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor="state-reg-q">
          Search the rule text or enter a citation
        </label>
        <input
          id="state-reg-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Words in the rules, or a citation"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Search
        </button>
      </form>
      {q.trim().length < 2 ? (
        <p className="text-xs text-muted-foreground">
          Searches the rule text held for this state (citation and heading first).
        </p>
      ) : null}
      {res.error ? <ExternalError error={res.error} /> : null}
      {res.isFetching ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
      {res.data === null ? (
        <p className="text-sm text-muted-foreground">Rule text search is not available yet.</p>
      ) : null}
      {res.data ? (
        <>
          {res.data.exact ? (
            <section aria-label="Citation" className="mb-3">
              <h2 className="eyebrow mb-1">Citation</h2>
              <ul className="rounded-lg border border-border bg-surface">
                <RuleRow r={res.data.exact} />
              </ul>
            </section>
          ) : null}
          <p className="mb-1 text-xs text-muted-foreground">
            {res.data.total.toLocaleString("en-US")} rules contain “{q}”
            {res.data.total > res.data.hits.length
              ? `; showing ${(offset + 1).toLocaleString("en-US")}–${(offset + res.data.hits.length).toLocaleString("en-US")}`
              : ""}
            .
          </p>
          {res.data.total > 25 ? (
            <div className="mb-2 flex gap-2 text-xs">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setPage({ q, offset: Math.max(0, offset - 25) })}
                className="rounded-md border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-50"
              >
                Previous 25
              </button>
              <button
                type="button"
                disabled={offset + 25 >= res.data.total || offset + 25 > 5000}
                onClick={() => setPage({ q, offset: offset + 25 })}
                className="rounded-md border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-50"
              >
                Next 25
              </button>
            </div>
          ) : null}
          {res.data.hits.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {res.data.hits.map((h) => (
                <li key={h.id} className="px-3 py-2 text-[13px]">
                  <Link
                    to="/law/regulations/$state"
                    params={{ state }}
                    search={{ q: "", level: undefined, rule: h.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {h.citation}
                  </Link>{" "}
                  <span>{h.heading ?? ""}</span>
                  {h.snippet ? (
                    <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
                      {h.snippet.split(/[«»]/).map((part, i) =>
                        i % 2 ? (
                          <mark key={i} className="bg-primary/15 text-foreground">
                            {part}
                          </mark>
                        ) : (
                          <span key={i}>{part}</span>
                        ),
                      )}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function RegisterPanel({ code }: { code: RegCode }) {
  const state = code.state;
  const fn = useServerFn(listStateRegisterIssues);
  const res = useQuery({
    queryKey: ["state-register-issues", state],
    queryFn: () => fn({ data: { state } }),
    enabled: !!code.registerName,
    staleTime: 10 * 60 * 1000,
  });
  if (!code.registerName)
    return (
      <p className="text-sm text-muted-foreground">
        {code.registerNote ?? "This state publishes no register."}
      </p>
    );
  const years = issuesByYear(res.data?.issues ?? []);
  const max = Math.max(1, ...years.map((y) => y.issues.length));
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {code.registerName}
        {code.registerFreq ? `, published ${code.registerFreq}` : ""} ·{" "}
        {code.registerUrl ? (
          <Official href={code.registerUrl}>Publisher's issue list</Official>
        ) : (
          "Not recorded"
        )}
      </p>
      {res.error ? <ExternalError error={res.error} /> : null}
      {res.isLoading ? <Loading label="Loading register issues" /> : null}
      {res.data && years.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues of this register are indexed yet. The weekly refresh reads the listings of
          Colorado, Kentucky, Maryland, Minnesota, Missouri, New Mexico, New York, Oregon and Texas.
        </p>
      ) : null}
      {years.length ? (
        <div className="space-y-3">
          <figure aria-label="Issues indexed per year" className="m-0">
            <ul className="space-y-1">
              {years.slice(0, 12).map((y) => (
                <li
                  key={y.year}
                  className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 text-[11px]"
                >
                  <span className="text-muted-foreground">{y.year}</span>
                  <span
                    className="h-2 rounded-sm bg-primary/60"
                    style={{ width: `${(y.issues.length / max) * 100}%` }}
                  />
                  <span className="text-right tabular-nums">{y.issues.length}</span>
                </li>
              ))}
            </ul>
            <figcaption className="mt-1 text-[11px] text-muted-foreground">
              Issues indexed per year, as listed by the publisher (source: {code.registerName}).
            </figcaption>
          </figure>
          {years.slice(0, 3).map((y) => (
            <section key={y.year} aria-label={`${y.year} issues`}>
              <h2 className="eyebrow mb-1">{y.year}</h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {y.issues.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 text-[13px]"
                  >
                    <Official href={i.url}>{issueWhen(i)}</Official>
                    <span className="text-[12px] text-muted-foreground">
                      {i.volume && i.issue
                        ? `Volume ${i.volume}, Issue ${i.issue}`
                        : i.pages
                          ? `Pages ${i.pages}`
                          : "Volume and issue not recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {res.data && res.data.total !== null && res.data.total > res.data.issues.length ? (
            <p className="text-[11px] text-muted-foreground">
              Showing the newest {res.data.issues.length} of{" "}
              {res.data.total.toLocaleString("en-US")} issues indexed.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SourcePanel({ code }: { code: RegCode }) {
  const rows: [string, React.ReactNode][] = [
    ["Administrative code", code.codeName],
    ["Citation form", code.citeForm ?? "Not recorded"],
    ["Official publisher", code.publisher],
    [
      "Official address",
      <Official key="u" href={code.codeUrl}>
        {code.codeUrl}
      </Official>,
    ],
    ["Publication", STATUS_LABEL[code.status] ?? code.status],
    ["Served as", ACCESS_LABEL[code.access] ?? code.access],
    ["robots.txt", robotsLine(code)],
    [
      "Publisher's page on the last check",
      code.probeResult
        ? `${code.probeResult}${code.probeAt ? `, ${code.probeAt.slice(0, 10)}` : ""}`
        : "Not recorded",
    ],
    [
      "Terms",
      code.termsUrl ? (
        <Official key="t" href={code.termsUrl}>
          Terms page
        </Official>
      ) : (
        "Not recorded"
      ),
    ],
    ["Currency as printed", code.currency ?? "Not recorded"],
    ["Rule text here", acquisitionLine(code)],
    [
      "Table of contents here",
      code.indexNodes ? `${code.indexNodes.toLocaleString("en-US")} headings` : "Not loaded",
    ],
    ["Register", code.registerName ?? code.registerNote ?? "Not recorded"],
  ];
  return (
    <div className="max-w-3xl">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[14rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="m-0 min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {code.blockedReason || code.acquisitionReason ? (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          {code.blockedReason ?? code.acquisitionReason}
        </p>
      ) : null}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Rule text comes only from the state's official publisher and is checked line by line against
        the publisher's own bytes. Where the official code is published only by a commercial vendor,
        nothing is copied.
      </p>
    </div>
  );
}
