import { createFileRoute, Link, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { Fact, StatusBadge } from "@/components/uscode/UsCodeText";
import { pageHead } from "@/lib/corpus/head";
import { cn } from "@/lib/utils";
import {
  getUsCodeContainerUnits,
  getUsCodeTitle,
  searchUsCodeTitle,
  containerLabel,
  smartTitle,
  TITLE_KEY,
  type OutlineNode,
  type UnitHead,
  type UscTitleDetail,
} from "@/lib/external/usCode.functions";

type TitleSearch = { q?: string | undefined; c?: number | undefined };

export const Route = createFileRoute("/law_/uscode/$title")({
  validateSearch: (search: Record<string, unknown>): TitleSearch => {
    const c = Number(search["c"]);
    return {
      q:
        typeof search["q"] === "string" && search["q"].trim()
          ? search["q"].slice(0, 200)
          : undefined,
      c: Number.isInteger(c) && c >= 0 && c < 100_000 ? c : undefined,
    };
  },
  head: ({ params }) =>
    pageHead(
      `Title ${params.title.replace(/a$/, " Appendix")}, United States Code`,
      `Outline and sections of Title ${params.title} of the United States Code.`,
    ),
  component: TitleRoute,
});

const fmt = (n: number) => n.toLocaleString("en-US");

function TitleRoute() {
  const section = useMatch({ from: "/law_/uscode/$title/$section", shouldThrow: false });
  if (section) return <Outlet />;
  return <TitlePage />;
}

function TitlePage() {
  const { title } = Route.useParams();
  const { q, c } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/uscode/$title" });
  const valid = TITLE_KEY.test(title);
  const fn = useServerFn(getUsCodeTitle);
  const detail = useQuery({
    queryKey: ["us-code-title", title],
    queryFn: () => fn({ data: { title } }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  const t = detail.data;
  const heading = t
    ? `${t.appendix ? `Title ${t.number} Appendix` : `Title ${t.number}`}. ${smartTitle(t.name)}`
    : `Title ${title}`;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "United States Code", to: "/law/uscode" },
        { label: t ? t.label : `Title ${title}` },
      ]}
      title={heading}
      {...(t
        ? {
            description: t.positiveLaw
              ? "Positive law title: the Code's text is itself the law."
              : "Not a positive law title: the Code's text is evidence of the laws in the Statutes at Large.",
          }
        : {})}
    >
      {!valid ? (
        <p className="text-sm text-muted-foreground">
          There is no Title “{title}” in the United States Code.
        </p>
      ) : null}
      {detail.error ? <ExternalError error={detail.error} /> : null}
      {detail.isLoading ? (
        <div
          className="h-40 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading the title"
        />
      ) : null}
      {detail.data === null ? (
        <p className="text-sm text-muted-foreground">
          Title {title} is not in the corpus.{" "}
          <Link to="/law/uscode" search={{ q: "" }} className="text-primary underline">
            All titles
          </Link>
        </p>
      ) : null}
      {t ? (
        <>
          <TitleFacts t={t} />
          <TitleSearchBox
            title={title}
            q={q}
            onSearch={(text) => void navigate({ search: { q: text || undefined, c } })}
          />
          {q ? <TitleHits title={title} q={q} /> : null}
          <Outline t={t} selected={c} onSelect={(i) => void navigate({ search: { q, c: i } })} />
        </>
      ) : null}
    </AppShell>
  );
}

function TitleFacts({ t }: { t: UscTitleDetail }) {
  const gone = Object.entries(t.byStatus)
    .filter(([k]) => k !== "none")
    .reduce((a, [, n]) => a + n, 0);
  return (
    <section
      aria-label="Source"
      className="mb-4 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <dl className="m-0 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Release point">{t.release ?? "Not recorded"}</Fact>
        <Fact label="Units">{fmt(t.units)}</Fact>
        <Fact label="Repealed, omitted or moved">{fmt(gone)}</Fact>
        <Fact label="Positive law">{t.positiveLaw ? "Yes" : "No"}</Fact>
      </dl>
      <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {t.officialUrl ? (
          <a
            href={t.officialUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Title on uscode.house.gov <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {t.zip ? (
          <a
            href={t.zip.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Official XML (USLM) <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </p>
    </section>
  );
}

function TitleSearchBox({
  title,
  q,
  onSearch,
}: {
  title: string;
  q: string | undefined;
  onSearch: (q: string) => void;
}) {
  const [draft, setDraft] = useState(q ?? "");
  return (
    <form
      role="search"
      className="mb-4 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <label className="sr-only" htmlFor="usc-title-search">
        Search Title {title}
      </label>
      <input
        id="usc-title-search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`Section number or words in Title ${title}`}
        className="w-full max-w-md rounded-md border border-input bg-background px-3 py-1.5 text-sm"
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
  );
}

function TitleHits({ title, q }: { title: string; q: string }) {
  const fn = useServerFn(searchUsCodeTitle);
  const found = useQuery({
    queryKey: ["us-code-search", title, q],
    queryFn: () => fn({ data: { title, q, offset: 0 } }),
  });
  return (
    <section
      aria-label="Matching sections"
      className="mb-4 rounded-lg border border-border bg-surface"
    >
      {found.isLoading ? (
        <p className="m-0 px-3 py-2 text-xs text-muted-foreground">Searching Title {title}…</p>
      ) : null}
      {found.error ? (
        <div className="p-3">
          <ExternalError error={found.error} />
        </div>
      ) : null}
      {found.data ? (
        found.data.hits.length === 0 ? (
          <p className="m-0 px-3 py-2 text-xs text-muted-foreground">
            No section of Title {title} has that number or contains every word of “{q}”.
          </p>
        ) : (
          <>
            <p className="m-0 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
              {(found.data.total ?? found.data.hits.length).toLocaleString("en-US")} sections match
              {found.data.total !== null && found.data.total > found.data.hits.length
                ? `; the first ${found.data.hits.length} are listed`
                : ""}
              . Words are matched in section numbers, headings and text (not notes).
            </p>
            <UnitList title={title} units={found.data.hits} className="max-h-96 overflow-auto" />
          </>
        )
      ) : null}
    </section>
  );
}

function UnitList({
  title,
  units,
  className,
}: {
  title: string;
  units: UnitHead[];
  className?: string;
}) {
  return (
    <ul className={cn("m-0 list-none divide-y divide-border/70 p-0", className)}>
      {units.map((u) => (
        <li key={u.id}>
          <Link
            to="/law/uscode/$title/$section"
            params={{ title, section: u.key }}
            className="flex items-baseline gap-3 px-3 py-1.5 hover:bg-muted/50"
          >
            <span className="w-44 shrink-0 font-mono text-[12px]">{u.citation}</span>
            <span className={cn("min-w-0 flex-1 text-[13px]", u.status && "text-muted-foreground")}>
              {u.heading}
            </span>
            <StatusBadge status={u.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Outline({
  t,
  selected,
  onSelect,
}: {
  t: UscTitleDetail;
  selected: number | undefined;
  onSelect: (i: number) => void;
}) {
  const byParent = useMemo(() => {
    const m = new Map<number | null, OutlineNode[]>();
    for (const n of t.outline) {
      const list = m.get(n.parent) ?? [];
      list.push(n);
      m.set(n.parent, list);
    }
    return m;
  }, [t.outline]);
  const byIndex = useMemo(() => new Map(t.outline.map((n) => [n.index, n])), [t.outline]);
  const root = t.outline.find((n) => n.parent === null && n.depth === 0) ?? null;
  const top = root ? (byParent.get(root.index) ?? []) : t.outline.filter((n) => n.depth === 0);
  const current =
    (selected !== undefined ? byIndex.get(selected) : undefined) ??
    (root && root.direct > 0 ? root : (top[0] ?? root ?? undefined));
  const ancestors = new Set<number>();
  for (let n = current; n && n.parent !== null; n = byIndex.get(n.parent)) ancestors.add(n.parent);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const isOpen = (i: number) => open.has(i) || ancestors.has(i);
  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const renderNodes = (nodes: OutlineNode[]) => (
    <ul className="m-0 list-none p-0">
      {nodes.map((n) => {
        const kids = byParent.get(n.index) ?? [];
        const active = current?.index === n.index;
        return (
          <li key={n.index}>
            <div className="flex items-start">
              {kids.length ? (
                <button
                  type="button"
                  aria-label={isOpen(n.index) ? "Collapse" : "Expand"}
                  aria-expanded={isOpen(n.index)}
                  onClick={() => toggle(n.index)}
                  className="mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
                >
                  {isOpen(n.index) ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-[1.125rem] shrink-0" />
              )}
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(n.index)}
                className={cn(
                  "flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-xs",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1">{containerLabel(n.num, n.heading)}</span>
                <span className="shrink-0 font-mono text-[11px]">{fmt(n.total)}</span>
              </button>
            </div>
            {kids.length && isOpen(n.index) ? (
              <div className="ml-3 border-l border-border/70 pl-1">{renderNodes(kids)}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
  if (!current)
    return <p className="text-sm text-muted-foreground">No outline is recorded for this title.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <nav
        aria-label="Outline"
        className="self-start rounded-lg border border-border bg-surface lg:sticky lg:top-2"
      >
        <p className="eyebrow m-0 border-b border-border/70 px-3 py-2">Outline</p>
        <div className="max-h-[70vh] overflow-auto p-1">
          {root && root.direct > 0 ? (
            <button
              type="button"
              onClick={() => onSelect(root.index)}
              className={cn(
                "mb-1 w-full rounded-md px-2 py-1 text-left text-xs",
                current.index === root.index
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              Sections outside any chapter ({fmt(root.direct)})
            </button>
          ) : null}
          {top.length ? renderNodes(top) : null}
        </div>
      </nav>
      <ContainerPanel
        title={t.key}
        node={current}
        kids={byParent.get(current.index) ?? []}
        onSelect={onSelect}
      />
    </div>
  );
}

function ContainerPanel({
  title,
  node,
  kids,
  onSelect,
}: {
  title: string;
  node: OutlineNode;
  kids: OutlineNode[];
  onSelect: (i: number) => void;
}) {
  const fn = useServerFn(getUsCodeContainerUnits);
  const units = useQuery({
    queryKey: ["us-code-units", title, node.index],
    queryFn: () => fn({ data: { title, container: node.index } }),
    enabled: node.direct > 0,
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section aria-label="Contents" className="min-w-0 rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/70 px-4 py-2.5">
        <h2 className="m-0 text-sm font-semibold">
          {node.depth === 0 ? `Title ${title}` : containerLabel(node.num, node.heading)}
        </h2>
        <span className="text-[11px] text-muted-foreground">{fmt(node.total)} units</span>
        <StatusBadge status={node.status} />
      </header>
      {kids.length ? (
        <ul className="m-0 list-none divide-y divide-border/70 border-b border-border/70 p-0">
          {kids.map((k) => (
            <li key={k.index}>
              <button
                type="button"
                onClick={() => onSelect(k.index)}
                className="flex w-full items-baseline gap-3 px-4 py-1.5 text-left text-[13px] hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">{containerLabel(k.num, k.heading)}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{fmt(k.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {node.direct > 0 ? (
        units.isLoading ? (
          <div
            className="m-3 h-24 animate-pulse rounded bg-muted/50"
            aria-busy="true"
            aria-label="Loading sections"
          />
        ) : units.error ? (
          <div className="p-3">
            <ExternalError error={units.error} />
          </div>
        ) : units.data ? (
          <>
            <UnitList title={title} units={units.data.units} />
            {units.data.total !== null &&
            units.data.total > units.data.units.length + units.data.dropped ? (
              <p className="m-0 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
                Showing the first {fmt(units.data.units.length)} of {fmt(units.data.total)}. Use the
                search box to find a section.
              </p>
            ) : null}
            {units.data.dropped ? (
              <p className="m-0 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
                {fmt(units.data.dropped)} stored records could not be read and are not shown.
              </p>
            ) : null}
          </>
        ) : null
      ) : !kids.length ? (
        <p className="m-0 px-4 py-3 text-xs text-muted-foreground">
          No sections are recorded under this heading.
        </p>
      ) : null}
    </section>
  );
}
