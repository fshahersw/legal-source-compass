import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { listNames } from "@/lib/external/entity.functions";
import { possibleDuplicates } from "@/lib/external/entityView";
import { pageHead } from "@/lib/corpus/head";

const KINDS = { judges: "Judges", mdl_counsel: "Counsel & firms" } as const;
type Kind = keyof typeof KINDS;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export const Route = createFileRoute("/people")({
  validateSearch: (s: Record<string, unknown>): { kind: Kind; letter: string; offset: number } => ({
    kind: s["kind"] === "mdl_counsel" ? "mdl_counsel" : "judges",
    letter: typeof s["letter"] === "string" && /^[A-Z]$/.test(s["letter"]) ? s["letter"] : "A",
    offset: typeof s["offset"] === "number" && s["offset"] >= 0 ? s["offset"] : 0,
  }),
  head: () =>
    pageHead(
      "Name index",
      "A–Z index of judges, attorneys and law firms in the connected corpus, with possible duplicate names flagged.",
    ),
  component: PeoplePage,
});

function PeoplePage() {
  const { kind, letter, offset } = Route.useSearch();
  const navigate = useNavigate({ from: "/people" });
  const fn = useServerFn(listNames);
  const q = useQuery({
    queryKey: ["names", kind, letter, offset],
    queryFn: () => fn({ data: { dataset: kind, letter, offset } }),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.rows ?? [];
  const dups = possibleDuplicates(rows);
  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Name index" }]}
      title="Name index"
      description="Names are listed exactly as recorded. Similar spellings are flagged as possible duplicates, never merged."
    >
      <div className="mb-3 flex gap-1">
        {(Object.keys(KINDS) as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => navigate({ search: { kind: k, letter, offset: 0 } })}
            className={`rounded-md px-2 py-1 text-[12px] ${k === kind ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted"}`}
          >
            {KINDS[k]}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-0.5">
        {LETTERS.map((l) => (
          <button
            key={l}
            onClick={() => navigate({ search: { kind, letter: l, offset: 0 } })}
            className={`w-7 rounded py-1 text-[12px] ${l === letter ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {q.error ? <ExternalError error={q.error} /> : null}
      <p className="mb-2 text-[12px] text-muted-foreground">
        {q.data?.total != null
          ? `${q.data.total.toLocaleString()} ${kind === "judges" ? "judicial profile records" : "counsel and firm records"} with names starting with “${letter}”`
          : q.isLoading
            ? "Loading…"
            : ""}
      </p>
      {kind === "judges" ? (
        <p className="mb-3 text-[12px] text-muted-foreground">
          Consolidated and official-source profiles remain separate. These counts are records, not a
          census of unique or currently serving judges.
        </p>
      ) : null}
      {dups.length ? (
        <p className="mb-3 rounded-md border border-border bg-muted/50 p-2 text-[12px]">
          Similar names to review on this page:{" "}
          {dups.map((g) => g.map((r) => r.title).join(" / ")).join("; ")}
        </p>
      ) : null}
      <ul className="columns-1 gap-6 text-[13px] sm:columns-2 lg:columns-3">
        {rows.map((r) => (
          <li key={r.id} className="break-inside-avoid py-0.5">
            {kind === "judges" ? (
              <Link to="/judges/$id" params={{ id: r.id }} className="hover:underline">
                {r.title}
              </Link>
            ) : (
              <Link
                to="/records/$dataset/$id"
                params={{ dataset: kind, id: r.id }}
                className="hover:underline"
              >
                {r.title}
              </Link>
            )}
            {r.state ? (
              <span className="ml-1 text-[11px] text-muted-foreground">{r.state}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2 text-[12px]">
        <button
          disabled={offset === 0}
          onClick={() => navigate({ search: { kind, letter, offset: Math.max(0, offset - 200) } })}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          disabled={rows.length < 200}
          onClick={() => navigate({ search: { kind, letter, offset: offset + 200 } })}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </AppShell>
  );
}
