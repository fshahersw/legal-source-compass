import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ExternalLink, Quote as QuoteIcon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { CourtMdl } from "@/lib/external/mdlIntel.functions";
import { courtPageStatus as pageStatus } from "@/lib/external/mdlIntelView";
import { cn } from "@/lib/utils";
import { FLAG_LABEL, n, signed, title } from "./intelFormat";
import { LeadershipList } from "./LeadershipList";
import { CourtOrderLink } from "./PacerLabel";

type Filter = "all" | "page" | "bellwether" | "flagged" | "none" | "pending";
type Sort = "pending" | "latest" | "mdl" | "orders";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All transferred" },
  { key: "page", label: "Court page located" },
  { key: "bellwether", label: "Bellwether quoted" },
  { key: "flagged", label: "Fast growth, no bellwether" },
  { key: "none", label: "No page located" },
  { key: "pending", label: "Not yet transferred" },
];
const latestOf = (c: CourtMdl) => c.latestOrders.find((o) => o.date && !o.vacated);
const CATEGORY_LABEL: Record<string, string> = {
  leadership: "Leadership",
  bellwether: "Bellwether / trial",
  settlement: "Settlement",
};
const bellwetherQuoted = (c: CourtMdl) => c.quoteCounts.bellwether > 0 || c.bellwetherOrders > 0;
const plural = (count: number, word: string, many = `${word}s`) =>
  `${n(count)} ${count === 1 ? word : many}`;
/** Builder flags about court-page coverage (current and older names); their text is derived from the record. */
const PAGE_FLAGS = new Set([
  "page_unreadable",
  "page_orders_not_extracted",
  "page_lists_no_orders",
  "page_fetch_failed",
]);
/** Flag text; the page-coverage flags say what extraction read from this record, never what the page contains. */
const flagLabel = (f: string, c: CourtMdl) =>
  PAGE_FLAGS.has(f) || (f === "no_court_page" && c.failedPages.length)
    ? pageStatus(c)
    : (FLAG_LABEL[f] ?? f);
/** Shorten at a word boundary and mark it, so a quoted statement never ends mid-word. */
const clipWords = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const space = text.lastIndexOf(" ", limit);
  return `${(space > 0 ? text.slice(0, space) : text.slice(0, limit)).trimEnd()} …`;
};
const QUOTED_LEGEND =
  "Statements quoted verbatim from the court page: L leadership, B bellwether or trial scheduling, S settlement";

/** Index of official transferee-court MDL pages for every pending products-liability MDL, with quoted statements. */
export function CourtPageIndex({ courts }: { courts: CourtMdl[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("pending");
  const [open, setOpen] = useState<number | null>(null);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return courts
      .filter((c) => (filter === "pending") === (c.status !== "transferred"))
      .filter((c) =>
        filter === "page"
          ? c.pages.length > 0
          : filter === "bellwether"
            ? bellwetherQuoted(c)
            : filter === "flagged"
              ? c.flags.includes("fast_growth_no_bellwether_quote")
              : filter === "none"
                ? c.pages.length === 0
                : true,
      )
      .filter(
        (c) =>
          !term ||
          `${c.mdl} ${c.title} ${c.judge ?? ""} ${c.districtLabel ?? ""}`
            .toLowerCase()
            .includes(term),
      )
      .sort((a, b) =>
        sort === "mdl"
          ? a.mdl - b.mdl
          : sort === "orders"
            ? b.ordersTotal - a.ordersTotal
            : sort === "latest"
              ? (latestOf(b)?.date ?? "").localeCompare(latestOf(a)?.date ?? "")
              : (b.pending ?? -1) - (a.pending ?? -1),
      );
  }, [courts, q, filter, sort]);
  const transferred = courts.filter((c) => c.status === "transferred");
  const located = transferred.filter((c) => c.pages.length).length;
  const notTransferred = courts.length - transferred.length;

  return (
    <section aria-labelledby="court-h" className="space-y-2">
      <div>
        <h2 id="court-h" className="text-sm font-semibold">
          Transferee-court MDL pages · products liability
        </h2>
        <p className="text-xs text-muted-foreground">
          {located} of {transferred.length} transferred products-liability MDLs (JPML report of
          10/1/2026) have an official court page located on *.uscourts.gov; {notTransferred} more
          had not been transferred yet and are under &ldquo;Not yet transferred&rdquo;. Statements
          are quoted verbatim from the court page with its URL and retrieval date; orders are the
          page&rsquo;s own links with the date printed in the same row.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search MDLs, judges or courts</span>
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search MDL, product, judge, court"
            className="h-8 pl-7 text-xs"
          />
        </label>
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-ring",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="pending">Pending actions</option>
            <option value="latest">Latest order date</option>
            <option value="orders">Orders listed</option>
            <option value="mdl">MDL number</option>
          </select>
        </label>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="relative max-w-full overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <caption className="sr-only">Products-liability MDL court pages</caption>
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="w-8 px-2 py-1.5">
                  <span className="sr-only">Expand</span>
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  MDL
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Litigation
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Court · judge
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Pending
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  12-mo
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Orders
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Latest order on page
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  <abbr title={QUOTED_LEGEND} className="no-underline">
                    <span aria-hidden="true">L · B · S</span>
                  </abbr>
                  <span className="sr-only">
                    Statements quoted: leadership, bellwether or trial, settlement
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <CourtRow
                  key={c.mdl}
                  c={c}
                  open={open === c.mdl}
                  onToggle={() => setOpen(open === c.mdl ? null : c.mdl)}
                />
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    No MDLs match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">L · B · S</span> = statements quoted
          verbatim from the court page that name <span className="font-medium">L</span>eadership
          (lead counsel, steering or executive committees, appointments),{" "}
          <span className="font-medium">B</span>ellwether or trial scheduling, and{" "}
          <span className="font-medium">S</span>ettlement; each is a sentence, list item or table
          row. Orders are counted separately.
        </p>
      </div>
    </section>
  );
}

function CourtRow({ c, open, onToggle }: { c: CourtMdl; open: boolean; onToggle: () => void }) {
  const latest = latestOf(c);
  const id = `court-${c.mdl}`;
  return (
    <>
      <tr className={cn("border-t border-border/60 align-top", open && "bg-muted/30")}>
        <td className="px-2 py-1.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            aria-label={`Details for MDL ${c.mdl}`}
            onClick={onToggle}
            className="flex size-6 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </td>
        <td className="px-2 py-1.5 tabular-nums">
          <Link
            to="/matters/lens/$mdl"
            params={{ mdl: String(c.mdl) }}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {c.mdl}
          </Link>
        </td>
        <td className="max-w-[240px] px-2 py-1.5">
          <div className="line-clamp-2 font-medium leading-snug" title={title(c.title)}>
            {title(c.title)}
          </div>
          {c.flags.length ? (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {c.flags.map((f) => (
                <span
                  key={f}
                  className={cn(
                    "rounded border px-1 py-px text-[10.5px]",
                    f === "fast_growth_no_bellwether_quote"
                      ? "border-warning/40 bg-warning/15 text-warning-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {flagLabel(f, c)}
                </span>
              ))}
            </div>
          ) : null}
        </td>
        <td className="max-w-[200px] px-2 py-1.5">
          <div className="truncate" title={c.districtLabel ?? undefined}>
            {c.districtLabel ?? "Not recorded"}
          </div>
          <div className="truncate text-muted-foreground" title={c.judge ?? undefined}>
            {c.judge ?? "Judge not recorded"}
          </div>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(c.pending)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{signed(c.change12m)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {c.pages.length ? n(c.ordersTotal) : "—"}
        </td>
        <td className="max-w-[220px] px-2 py-1.5">
          {latest ? (
            <CourtOrderLink order={latest} className="group block" labelClassName="mt-0.5">
              <span className="tabular-nums text-muted-foreground">{latest.date}</span>{" "}
              <span className="line-clamp-1 text-primary group-hover:underline">
                {latest.title}
              </span>
            </CourtOrderLink>
          ) : (
            <span className="text-muted-foreground">{pageStatus(c)}</span>
          )}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-[11px] tabular-nums text-muted-foreground">
          <span aria-hidden="true">
            L {c.quoteCounts.leadership} · B {c.quoteCounts.bellwether} · S{" "}
            {c.quoteCounts.settlement}
          </span>
          <span className="sr-only">
            {`${plural(c.quoteCounts.leadership, "leadership statement")}, ${plural(c.quoteCounts.bellwether, "bellwether or trial statement")}, ${plural(c.quoteCounts.settlement, "settlement statement")} quoted`}
          </span>
        </td>
      </tr>
      {open ? (
        <tr id={id} className="bg-muted/20">
          <td />
          <td colSpan={8} className="px-2 pb-3 pt-1">
            <CourtDetail c={c} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CourtDetail({ c }: { c: CourtMdl }) {
  if (!c.pages.length)
    return (
      <p className="text-xs text-muted-foreground">
        {c.failedPages.length ? (
          <>
            The official court page was located but could not be fetched (
            {c.failedPages.map((p, i) => (
              <span key={p.url}>
                {i ? ", " : ""}
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {p.status ? `HTTP ${p.status}` : "no response"}
                </a>
              </span>
            ))}
            ).{" "}
          </>
        ) : (
          <>
            No official court MDL page was located with site-restricted searches of the transferee
            court&rsquo;s uscourts.gov site.{" "}
          </>
        )}
        {c.status === "transferred"
          ? `JPML facts: transferred ${c.dateTransferred ?? "(date not recorded)"} to ${c.judge ?? "judge not recorded"}, ${c.districtLabel ?? "court not recorded"}.`
          : `Not transferred as of the JPML report of 10/1/2026${c.transferOrderFiled ? `; the Panel's transfer order was filed ${c.transferOrderFiled} (${c.judge ?? "judge not recorded"}, ${c.districtLabel ?? "court not recorded"})` : ""}.`}
        {c.status !== "transferred" && c.transferOrderUrl ? (
          <>
            {" "}
            <a
              href={c.transferOrderUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              Transfer order
            </a>
          </>
        ) : null}
      </p>
    );
  const groups = ["leadership", "bellwether", "settlement"] as const;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Court pages
          </h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {c.pages.map((p) => (
              <li key={p.url}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-start gap-1 text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span className="line-clamp-1" title={p.title || p.url}>
                    {p.title || p.url}
                  </span>
                </a>
                <span className="ml-4 text-[10.5px] text-muted-foreground">
                  retrieved {p.retrieved ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Latest orders ({n(c.ordersTotal)} extracted)
          </h4>
          {c.latestOrders.length ? (
            <ol className="mt-1 space-y-0.5 text-xs">
              {c.latestOrders.map((o) => (
                <li key={o.url} className="flex items-start gap-2">
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                    {o.date ?? o.datePrinted ?? "Undated"}
                  </span>
                  <CourtOrderLink
                    order={o}
                    className="line-clamp-1 min-w-0 text-primary underline-offset-2 hover:underline"
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No order links were extracted from{" "}
              {c.pages.length === 1 ? "the court page" : "the court pages"}; see the page itself.
            </p>
          )}
        </div>
        {c.leadership.length ? (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Leadership as listed on the page
            </h4>
            <p className="text-[10.5px] text-muted-foreground" title={c.contactMethod ?? undefined}>
              Names, firms and roles as printed; counsel contact details are not shown.
            </p>
            <LeadershipList
              sections={c.leadership}
              initialSections={4}
              initialLines={8}
              moreRoles={c.leadershipMore}
              moreUrl={c.leadershipMoreUrl}
              className="mt-1 text-xs"
            />
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        {c.firstBellwetherDate ? (
          <p className="rounded border border-border bg-surface px-2 py-1.5 text-xs">
            Earliest bellwether-trial date quoted on the court page:{" "}
            <span className="font-medium tabular-nums">{c.firstBellwetherDate}</span>
            {c.monthsToBellwether !== null
              ? ` · ${c.monthsToBellwether} months after JPML transfer`
              : ""}
            {c.bellwetherTimingNote ? ` · ${c.bellwetherTimingNote}` : ""}
          </p>
        ) : null}
        {groups.map((g) => {
          const qs = c.quotes.filter((q) => q.category === g);
          return (
            <div key={g}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABEL[g]} statements ({n(c.quoteCounts[g])})
              </h4>
              {qs.length ? (
                <ul className="mt-1 space-y-1">
                  {qs.slice(0, 4).map((q, i) => (
                    <li key={i} className="flex gap-1.5 text-xs">
                      <QuoteIcon
                        className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>
                        <q
                          className="leading-snug"
                          title={q.text.length > 320 ? q.text : undefined}
                        >
                          {clipWords(q.text, 320)}
                        </q>{" "}
                        <a
                          href={q.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10.5px] text-muted-foreground underline underline-offset-2"
                        >
                          source{q.retrieved ? `, ${q.retrieved}` : ""}
                        </a>
                        {q.contactRemoved ? (
                          <span className="ml-1 text-[10.5px] text-muted-foreground">
                            · contact details removed
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No statement on the court page mentions this.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
