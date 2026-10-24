import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Globe2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  REGISTRY_LABEL,
  countByGroup,
  filterGovRows,
  groupGovRows,
  type GovGroup,
  type GovRow,
} from "@/lib/external/govDomainsModel";
import { cn } from "@/lib/utils";
import {
  chipLabel,
  emptyText,
  rowDetail,
  rowFlags,
  rowLimit,
  rowName,
  snapshotText,
} from "./govDomainsView";
import { useGovStateQuery } from "./useGovStateQuery";
import { useInView } from "./useInView";

const CISA_VIEWER = "https://data.get.gov/?file=current-full.csv";
const GSA_LIST = "https://github.com/GSA/govt-urls";

/** Registry tags for a row: which registries list it. */
export function RegistryTags({ row }: { row: GovRow }) {
  return (
    <span className="flex shrink-0 gap-1">
      {row.registries.map((r) => (
        <span
          key={r}
          title={REGISTRY_LABEL[r]}
          className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
        >
          {r === "cisa" ? "CISA" : "GSA"}
        </span>
      ))}
    </span>
  );
}

/** One registered domain: the site (opens in the source panel), who registered it, and the type as published. */
export function GovDomainRow({ row, extra }: { row: GovRow; extra?: string | undefined }) {
  const detail = rowDetail(row);
  const flags = rowFlags(row);
  const name = rowName(row);
  return (
    <li className="flex items-start gap-2 px-3 py-2" data-testid="gov-domain-row">
      <div className="min-w-0 flex-1">
        {row.link ? (
          <a
            href={row.link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 font-mono text-[12.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            title={row.link}
          >
            <span className="truncate">{name}</span>
            <ArrowUpRight className="size-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="block truncate font-mono text-[12.5px] font-medium" title={name}>
            {name}
          </span>
        )}
        <span
          className="block truncate text-[11.5px] leading-4 text-muted-foreground"
          title={detail}
        >
          {detail}
        </span>
        {extra ? (
          <span className="block text-[11px] leading-4 text-muted-foreground">{extra}</span>
        ) : null}
        {flags.length ? (
          <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
            {flags.join(" · ")}
          </span>
        ) : null}
      </div>
      <RegistryTags row={row} />
    </li>
  );
}

/** What the registries are and are not, in the section footer. */
export function GovDomainsNotes({ snapshot }: { snapshot: Parameters<typeof snapshotText>[0] }) {
  return (
    <div className="space-y-1 border-t border-border bg-muted/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
      <p className="m-0">
        {snapshotText(snapshot)}. Registered or listed means the domain appears in a government
        registry: the{" "}
        <a href={CISA_VIEWER} target="_blank" rel="noreferrer" className="underline">
          CISA .gov registry
        </a>{" "}
        (every domain registered in the .gov zone; type, organization, city and state are as the
        registrant gave them) and the{" "}
        <a href={GSA_LIST} target="_blank" rel="noreferrer" className="underline">
          GSA list
        </a>{" "}
        of government domains outside .gov and .mil (a crowdsourced list, not a verification).
      </p>
      <p className="m-0">
        The state is the one the publisher gives, usually the organization&rsquo;s address; it is
        never taken from the domain name, and neither registry gives a county. A listing does not
        vouch for any page on the site.
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="Loading government websites">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * Registered government websites whose publisher-given state is this state, grouped by government level, searchable, each
 * link opening in the in-app source panel. Loads when the section nears the viewport. `embedded` drops the band so the
 * list can sit inside another section (the county page).
 */
export function GovDomainsPanel({
  usps,
  stateName,
  embedded = false,
}: {
  usps: string;
  stateName: string;
  embedded?: boolean;
}) {
  const [ref, seen] = useInView<HTMLElement>();
  const q = useGovStateQuery(usps, seen || embedded);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GovGroup | "unassigned" | "">("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rows = q.data?.rows;
  const filtering = query.trim() !== "" || group !== "";
  const textMatches = useMemo(() => filterGovRows(rows ?? [], query), [rows, query]);
  const chips = useMemo(() => countByGroup(textMatches), [textMatches]);
  const blocks = useMemo(
    () =>
      groupGovRows(
        group ? textMatches.filter((r) => (r.group ?? "unassigned") === group) : textMatches,
      ),
    [textMatches, group],
  );
  const shown = blocks.reduce((n, b) => n + b.rows.length, 0);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const reset = () => {
    setQuery("");
    setGroup("");
  };
  const total = q.data?.total ?? 0;
  const unavailable = q.data && !q.data.available;

  return (
    <section
      ref={ref}
      className={cn(!embedded && "resource-panel")}
      aria-label={`Official government websites in ${stateName}`}
      data-testid="gov-domains-panel"
    >
      {embedded ? null : (
        <div className="research-band">
          <h3 className="flex items-center gap-2 text-label font-semibold text-foreground">
            <Globe2 className="size-4" aria-hidden />
            Registered government domains
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground" role="status">
            {q.isPending && (seen || embedded)
              ? "Loading…"
              : q.data?.available
                ? `${(filtering ? shown : total).toLocaleString("en-US")}${filtering ? ` of ${total.toLocaleString("en-US")}` : ""} registered`
                : ""}
          </span>
        </div>
      )}
      {q.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs"
        >
          <span>The government website registries could not be read.</span>
          <Button variant="link" size="sm" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {!seen && !embedded ? <Loading /> : null}
      {(seen || embedded) && q.isPending ? <Loading /> : null}
      {unavailable ? (
        <p className="m-0 px-4 py-6 text-sm text-muted-foreground" role="status">
          The government website registries are not available in this workspace yet.
        </p>
      ) : null}
      {q.data?.available ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 p-2.5">
            <div className="relative min-w-44 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={`Filter ${stateName} government websites`}
                placeholder="Filter by domain, organization, city or type"
                className="h-9 bg-surface pl-8 text-xs"
              />
            </div>
            {filtering ? (
              <button
                type="button"
                onClick={reset}
                aria-label="Clear government website filters"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <div
            className="flex flex-wrap gap-1.5 border-b border-border px-2.5 py-2"
            role="group"
            aria-label="Government level"
          >
            {[
              { key: "" as const, count: textMatches.length },
              ...groupGovRows(textMatches).map((b) => ({
                key: b.group,
                count: chips.get(b.group) ?? 0,
              })),
            ].map((c) => (
              <button
                key={c.key || "all"}
                type="button"
                aria-pressed={group === c.key}
                onClick={() => setGroup(c.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] leading-none tabular-nums transition-colors",
                  group === c.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {chipLabel(c.key, c.count)}
              </button>
            ))}
          </div>
          {q.data.truncated ? (
            <p
              role="status"
              className="m-0 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground"
            >
              Partial list: {q.data.rows.length.toLocaleString("en-US")} of{" "}
              {total.toLocaleString("en-US")} records could be shown.
            </p>
          ) : null}
          {shown === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <p className="m-0">{emptyText({ filtering, stateName })}</p>
              {filtering ? (
                <Button variant="link" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {blocks.map((b) => {
                const open = expanded.has(b.group);
                const limit = rowLimit(open, filtering);
                const visible = b.rows.slice(0, limit);
                return (
                  <div key={b.group} data-testid={`gov-group-${b.group}`}>
                    <div className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-1.5">
                      <h4 className="m-0 font-sans text-[12px] font-semibold">
                        {b.label}{" "}
                        <span className="font-normal tabular-nums text-muted-foreground">
                          {b.rows.length.toLocaleString("en-US")}
                        </span>
                      </h4>
                      {b.rows.length > visible.length || open ? (
                        <button
                          type="button"
                          onClick={() => toggle(b.group)}
                          aria-expanded={open}
                          className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
                        >
                          {open
                            ? "Show fewer"
                            : `Show all ${b.rows.length.toLocaleString("en-US")}`}
                          <ChevronDown
                            className={cn("size-3 transition-transform", open && "rotate-180")}
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </div>
                    <ul className="m-0 list-none divide-y divide-border/60 p-0">
                      {visible.map((r) => (
                        <GovDomainRow key={r.id} row={r} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
          <GovDomainsNotes snapshot={q.data.snapshot} />
        </>
      ) : null}
    </section>
  );
}
