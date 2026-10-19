import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  COURT_SITES,
  matchesQuery,
  PORTAL_KINDS,
  type Portal,
} from "@/lib/external/sourcesCatalog";

const DATASETS_SHOWN = 5;

export function PortalDirectory({
  portals,
  q,
  sampleState,
  failed,
}: {
  portals: readonly Portal[];
  q: string;
  sampleState: "loading" | "error" | "ready";
  failed: number;
}) {
  const visible = q
    ? portals.filter((p) =>
        matchesQuery([p.name, ...p.hosts, ...p.datasets.map((d) => d.label)].join(" "), q),
      )
    : portals;
  if (!portals.length)
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No dataset records a source URL yet.
      </p>
    );
  return (
    <div className="space-y-5">
      <p className="m-0 text-[12px] text-muted-foreground">
        Sites and downloads named in each published dataset's recorded source statement and on its
        first records, grouped by publisher. Links open the publisher's site; the records themselves
        are under each dataset.
        {sampleState === "loading" ? " Reading record sources…" : null}
        {sampleState === "error" ? " Record sources could not be read; statements only." : null}
        {failed ? ` ${failed} dataset${failed === 1 ? "" : "s"} could not be read.` : null}
      </p>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          No portal matches “{q}”.
        </p>
      ) : null}
      {PORTAL_KINDS.map((kind) => {
        const list = visible.filter((p) => p.kind === kind.id);
        if (!list.length) return null;
        return (
          <section key={kind.id} aria-labelledby={`portal-${kind.id}`}>
            <h2 id={`portal-${kind.id}`} className="m-0 mb-2 text-sm font-semibold">
              {kind.label}{" "}
              <span className="text-[12px] font-normal text-muted-foreground">
                {list.length} site{list.length === 1 ? "" : "s"}
              </span>
            </h2>
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 2xl:grid-cols-3">
              {list.map((p) => (
                <PortalCard key={p.host} p={p} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PortalCard({ p }: { p: Portal }) {
  const [all, setAll] = useState(false);
  const shown = all ? p.datasets : p.datasets.slice(0, DATASETS_SHOWN);
  return (
    <li className="flex min-w-0 flex-col rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-medium leading-snug">{p.name}</p>
          <p
            className="m-0 truncate font-mono text-[10px] text-muted-foreground"
            title={p.hosts.join(", ")}
          >
            {p.host === COURT_SITES ? `${p.hosts.length} court sites on uscourts.gov` : p.host}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {p.datasets.length} dataset{p.datasets.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-1 p-0">
        {shown.map((d) => (
          <li key={d.id}>
            <Link
              to="/data/$dataset"
              params={{ dataset: d.id }}
              className="block max-w-[16rem] truncate rounded border border-border/70 px-1.5 py-0.5 text-[11px] hover:bg-muted"
              title={d.label}
            >
              {d.label}
            </Link>
          </li>
        ))}
        {p.datasets.length > DATASETS_SHOWN ? (
          <li>
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="rounded px-1.5 py-0.5 text-[11px] text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {all ? "Fewer" : `+${p.datasets.length - DATASETS_SHOWN} more`}
            </button>
          </li>
        ) : null}
      </ul>
      <ul className="m-0 mt-auto list-none space-y-0.5 p-0 pt-2">
        {p.urls.slice(0, 3).map((u) => (
          <li key={u} className="min-w-0">
            <a
              href={u}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline"
              title={u}
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{u.replace(/^https?:\/\/(www\.)?/, "")}</span>
            </a>
          </li>
        ))}
      </ul>
    </li>
  );
}
