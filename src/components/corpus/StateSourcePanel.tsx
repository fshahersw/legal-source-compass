import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MergedStateSource } from "@/lib/atlas/stateSources";
export function StateSourcePanel({
  rows,
  state,
  loading,
  error,
  onRetry,
}: {
  rows: MergedStateSource[];
  state: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !term ||
        [r.title, r.domain, r.category, r.url].some((v) => (v ?? "").toLowerCase().includes(term)),
    );
  }, [rows, q]);
  return (
    <section className="space-y-4" aria-label="State law and source directory">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Laws & research sources</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            One directory, with duplicate URLs consolidated.
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs">
          {loading ? "Loading…" : `${rows.length.toLocaleString()} recorded sources`}
        </span>
      </div>
      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(40);
          }}
          aria-label="Filter this state's sources"
          placeholder="Search titles, domains, or categories"
          className="h-9 pl-9 text-sm"
        />
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          Some source collections could not load. Results below may be incomplete.
          <Button onClick={onRetry} variant="link" size="sm">
            Retry sources
          </Button>
        </div>
      ) : null}
      {loading && !rows.length ? (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading state sources…
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="divide-y divide-border">
            {shown.slice(0, limit).map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-[10px] font-semibold uppercase text-muted-foreground">
                  {(row.domain ?? "WEB").replace(/^www\./, "").slice(0, 3)}
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    to="/sources/detail"
                    search={{ id: row.id, state }}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {row.title || row.url}
                  </Link>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {row.domain}
                    {row.category ? ` · ${row.category}` : ""}
                  </span>
                </span>
                <span
                  className="hidden max-w-52 truncate text-[10px] text-muted-foreground md:block"
                  title={row.collections.join(", ")}
                >
                  {row.collections.length > 1
                    ? `${row.collections.length} collections`
                    : row.collections[0]}
                </span>
                {/^https?:\/\//i.test(row.url) ? (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open source: ${row.title || row.domain}`}
                    className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          {!shown.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {q
                ? "No sources match this search."
                : "No state sources are recorded in the loaded collections."}
            </p>
          ) : null}
        </div>
      )}
      {shown.length > limit ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {limit} of {shown.length.toLocaleString()}
          </span>
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 40)}>
            Load more sources
          </Button>
        </div>
      ) : null}
    </section>
  );
}
