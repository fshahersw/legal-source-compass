import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { Highlighted } from "@/components/courts/rules/Highlighted";
import { oneLine } from "@/components/courts/rules/ruleFormat";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { cn } from "@/lib/utils";
import {
  getConstitutionOutline,
  getConstitutionProvisions,
  groupByArticle,
  searchConstitutions,
  type Constitution,
  type Provision,
  type ProvisionHead,
} from "@/lib/external/courtRulesLaw.functions";

const CHUNK = 40;

export const Route = createFileRoute("/law_/constitutions/$state")({
  validateSearch: (search: Record<string, unknown>) => ({
    article: typeof search["article"] === "string" ? search["article"].slice(0, 40) : undefined,
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
  }),
  head: ({ params }) => {
    const name = stateByUsps.get(params.state.toUpperCase())?.name ?? params.state;
    return pageHead(
      `Constitution of ${name}`,
      `The constitution of ${name} as its official publisher prints it.`,
    );
  },
  component: StateConstitutionPage,
});

const groupKey = (article: string | null) => article ?? "front";
/** "Article IV"; units outside any article are front matter, or the whole text when the state has no articles. */
const groupLabel = (article: string | null, single: boolean) =>
  article ? `Article ${article}` : single ? "Text" : "Front matter";
const provisionLabel = (p: ProvisionHead) =>
  p.section ? `Section ${p.section}` : p.article ? `Article ${p.article}` : "Unnumbered text";

/** Paragraphs as printed, with the line breaks inside a paragraph (from the page layout) joined. */
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n|\f/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

function StateConstitutionPage() {
  const { state: raw } = Route.useParams();
  const state = raw.toUpperCase();
  const { article, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/constitutions/$state" });
  const outlineFn = useServerFn(getConstitutionOutline);
  const outline = useQuery({
    queryKey: ["constitution-outline", state],
    queryFn: () => outlineFn({ data: { state } }),
    enabled: /^[A-Z]{2}$/.test(state),
    staleTime: 10 * 60 * 1000,
  });
  const name = outline.data?.constitution.name ?? stateByUsps.get(state)?.name ?? state;
  const crumbs = [
    { label: "Home", to: "/" },
    { label: "Law & regulation", to: "/law" },
    { label: "State constitutions", to: "/law/constitutions" },
    { label: name },
  ];
  const c = outline.data?.constitution;
  return (
    <AppShell
      breadcrumbs={crumbs}
      title={c?.title ?? `Constitution of ${name}`}
      {...(c && (c.publisher || c.edition)
        ? { description: [c.publisher, c.edition].filter(Boolean).join(" · ") }
        : {})}
    >
      {outline.error ? <ExternalError error={outline.error} /> : null}
      {outline.isLoading ? (
        <div
          className="h-40 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading the constitution"
        />
      ) : null}
      {outline.data === null ? (
        <p className="text-sm text-muted-foreground">
          No constitution is recorded for {state}.{" "}
          <Link to="/law/constitutions" search={{ q: "" }} className="text-primary underline">
            All states
          </Link>
        </p>
      ) : null}
      {c ? <Facts c={c} dropped={outline.data?.dropped ?? 0} /> : null}
      {c && c.status === "text" && outline.data ? (
        <Body
          state={state}
          provisions={outline.data.provisions}
          article={article}
          q={q}
          onArticle={(a) => void navigate({ search: { article: a, q }, hash: "" })}
          onSearch={(text) => void navigate({ search: { article, q: text } })}
        />
      ) : null}
    </AppShell>
  );
}

function Facts({ c, dropped }: { c: Constitution; dropped: number }) {
  const shape =
    c.structure === "section"
      ? c.articles
        ? `${c.articles.toLocaleString("en-US")} articles, ${c.sections.toLocaleString("en-US")} sections`
        : `${c.sections.toLocaleString("en-US")} sections (no articles)`
      : c.structure === "article"
        ? `${c.articles.toLocaleString("en-US")} articles; sections are not separated for this state`
        : c.structure === "document"
          ? "One document; articles and sections are not separated"
          : "Not recorded";
  return (
    <section
      aria-label="Source"
      className="mb-4 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <dl className="m-0 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Publisher" value={c.publisher ?? "Not recorded"} />
        <Fact label="Edition" value={c.edition ?? "Not recorded"} />
        <Fact label="Structure" value={c.status === "text" ? shape : c.statusLabel} />
        <Fact
          label="Retrieved"
          value={c.retrievedAt ? c.retrievedAt.slice(0, 10) : "Not retrieved"}
        />
      </dl>
      {c.url ? (
        <p className="m-0 mt-2 text-[11px]">
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Official source <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      ) : null}
      {c.status !== "text" ? (
        <p className="m-0 mt-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {c.statusLabel}
          {c.note ? `. ${c.note}` : ""} No text is shown from unofficial copies.
        </p>
      ) : null}
      {dropped ? (
        <p className="m-0 mt-2 text-[11px] text-muted-foreground">
          {dropped.toLocaleString("en-US")} stored provisions could not be read and are not shown.
        </p>
      ) : null}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Body({
  state,
  provisions,
  article,
  q,
  onArticle,
  onSearch,
}: {
  state: string;
  provisions: ProvisionHead[];
  article: string | undefined;
  q: string;
  onArticle: (article: string) => void;
  onSearch: (q: string) => void;
}) {
  const groups = groupByArticle(provisions);
  const group = groups.find((g) => groupKey(g.article) === article) ?? groups[0];
  const [draft, setDraft] = useState(q);
  if (!group)
    return (
      <p className="text-sm text-muted-foreground">
        No provisions are recorded for this constitution.
      </p>
    );
  const single = groups.length === 1;
  return (
    <div className={cn("grid gap-4", !single && "lg:grid-cols-[15rem_minmax(0,1fr)]")}>
      <nav
        aria-label="Articles"
        hidden={single}
        className="self-start rounded-lg border border-border bg-surface lg:sticky lg:top-2"
      >
        <p className="eyebrow m-0 border-b border-border/70 px-3 py-2">Articles</p>
        <ul className="m-0 max-h-[70vh] list-none overflow-auto p-1">
          {groups.map((g) => {
            const active = g === group;
            return (
              <li key={g.key}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onArticle(groupKey(g.article))}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{groupLabel(g.article, groups.length === 1)}</span>
                    {g.title ? (
                      <span
                        className="block truncate text-[11px] font-normal"
                        title={oneLine(g.title)}
                      >
                        {oneLine(g.title)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[11px]">{g.provisions.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 space-y-3">
        <form
          role="search"
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="state-constitution-search">
            Search this constitution
          </label>
          <input
            id="state-constitution-search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search this constitution"
            className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Search
          </button>
          {q ? (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                onSearch("");
              }}
              className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </form>
        {q.trim().length >= 2 ? <StateSearch state={state} q={q} /> : null}
        <ArticleText
          key={group.key}
          group={group}
          state={state}
          label={groupLabel(group.article, groups.length === 1)}
        />
      </div>
    </div>
  );
}

function StateSearch({ state, q }: { state: string; q: string }) {
  const searchFn = useServerFn(searchConstitutions);
  const found = useQuery({
    queryKey: ["state-constitution-search", state, q],
    queryFn: () => searchFn({ data: { q, state, offset: 0 } }),
  });
  if (found.isLoading) return <p className="m-0 text-xs text-muted-foreground">Searching…</p>;
  if (found.error) return <ExternalError error={found.error} />;
  if (!found.data) return null;
  if (!found.data.hits.length)
    return (
      <p className="m-0 text-xs text-muted-foreground">
        No provision of this constitution contains every word of “{q}”.
      </p>
    );
  return (
    <section
      aria-label="Matching provisions"
      className="rounded-lg border border-border bg-surface"
    >
      <p className="m-0 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
        {(found.data.total ?? found.data.hits.length).toLocaleString("en-US")} provisions match
        {found.data.total !== null && found.data.total > found.data.hits.length
          ? `; the first ${found.data.hits.length} are listed`
          : ""}
        .
      </p>
      <ul className="m-0 max-h-80 list-none divide-y divide-border/70 overflow-auto p-0">
        {found.data.hits.map((h) => (
          <li key={h.id} className="px-3 py-2">
            <Link
              to="/law/constitutions/$state"
              params={{ state }}
              search={{ article: groupKey(h.article), q }}
              hash={h.id}
              className="text-[13px] font-medium hover:underline"
            >
              {oneLine(h.title)}
            </Link>
            <Highlighted
              text={h.snippet}
              q={q}
              className="mt-0.5 block text-xs leading-relaxed text-foreground/80"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleText({
  group,
  state,
  label,
}: {
  group: { article: string | null; title: string | null; provisions: ProvisionHead[] };
  state: string;
  label: string;
}) {
  const { hash } = useLocation();
  const ids = group.provisions.map((p) => p.id);
  const target = hash ? ids.indexOf(hash) : -1;
  const [shown, setShown] = useState(Math.max(CHUNK, Math.ceil((target + 1) / CHUNK) * CHUNK));
  const provisionsFn = useServerFn(getConstitutionProvisions);
  const chunks: string[][] = [];
  for (let n = 0; n < Math.min(shown, ids.length); n += CHUNK) chunks.push(ids.slice(n, n + CHUNK));
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ["constitution-provisions", state, chunk[0], chunk.length],
      queryFn: () => provisionsFn({ data: { state, ids: chunk } }),
      staleTime: 30 * 60 * 1000,
    })),
  });
  const texts = new Map<string, Provision>();
  for (const r of results) for (const p of r.data ?? []) texts.set(p.id, p);
  const loading = results.some((r) => r.isLoading);
  const failed = results.find((r) => r.error);
  useEffect(() => {
    if (!hash || loading) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash, loading]);
  return (
    <section aria-label={label} className="rounded-lg border border-border bg-surface">
      <header className="border-b border-border/70 px-4 py-2.5">
        <h2 className="m-0 text-sm font-semibold">
          {label}
          {group.title ? (
            <span className="font-normal text-muted-foreground"> · {oneLine(group.title)}</span>
          ) : null}
        </h2>
      </header>
      {failed?.error ? (
        <div className="p-3">
          <ExternalError error={failed.error} />
        </div>
      ) : null}
      <ol className="m-0 list-none divide-y divide-border/70 p-0">
        {group.provisions.slice(0, shown).map((p) => (
          <ProvisionBlock
            key={p.id}
            head={p}
            text={texts.get(p.id) ?? null}
            loading={loading && !texts.has(p.id)}
          />
        ))}
      </ol>
      {ids.length > shown ? (
        <div className="border-t border-border/70 px-4 py-2">
          <button
            type="button"
            onClick={() => setShown((s) => s + CHUNK)}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
          >
            Show {Math.min(CHUNK, ids.length - shown)} more of {ids.length - shown} remaining
          </button>
        </div>
      ) : null}
    </section>
  );
}

const CHECK_NOTE: Record<string, string | null> = {
  confirmed: null,
  mostly_confirmed:
    "A second reading of the official file found this text with a heading or line placed differently.",
  partly_confirmed:
    "A second reading of the official file did not find all of this text in this order (page layout); read it on the official page.",
  not_checked: null,
};

function ProvisionBlock({
  head,
  text,
  loading,
}: {
  head: ProvisionHead;
  text: Provision | null;
  loading: boolean;
}) {
  const note = CHECK_NOTE[head.textCheck];
  return (
    <li id={head.id} className="scroll-mt-4 px-4 py-3">
      <h3 className="m-0 text-[13px] font-semibold">{provisionLabel(head)}</h3>
      {text ? (
        <div className="mt-1 max-w-[75ch] space-y-2 text-[13px] leading-relaxed">
          {paragraphs(text.text).map((para, n) => (
            <p key={n} className="m-0">
              {para}
            </p>
          ))}
        </div>
      ) : loading ? (
        <div className="mt-1 h-12 animate-pulse rounded bg-muted/50" aria-busy="true" />
      ) : (
        <p className="m-0 mt-1 text-xs text-muted-foreground">
          The stored text of this provision could not be read.
        </p>
      )}
      <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <a
          href={head.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          Official text <ExternalLink className="size-3" aria-hidden />
        </a>
        {note ? <span>{note}</span> : null}
      </p>
    </li>
  );
}
