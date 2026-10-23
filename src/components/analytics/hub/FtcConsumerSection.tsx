import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, FileText, RefreshCw, Table2 } from "lucide-react";
import { ShareBars } from "@/components/states/consumer/ShareBars";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getFtcConsumerOverview, type FtcConsumerOverview } from "@/lib/analytics/ftcConsumer.functions";
import type { FtcSubjects } from "@/lib/analytics/ftcConsumer.server";
import type { BlockDef } from "@/lib/analytics/registry";
import { formatCount } from "@/lib/analytics/trend";
import type { SpotlightPost } from "@/lib/external/ftcData";
import { cn } from "@/lib/utils";
import { TrendCardView, type CardState } from "./TrendCard";

/**
 * FTC consumer-protection section of the Analytics overview: Do Not Call reported calls by month with the robocall share,
 * the subjects people report, HSR early terminations by fiscal year and the FTC's Data Spotlight posts. Each card says
 * what it counts, its unit, period and source; a card shows its own loading, empty and error state.
 */

const DEFS = {
  monthly: {
    id: "ftc-dnc-monthly",
    group: "consumer",
    title: "Do Not Call reports received by the FTC, by month created",
    measure: "Do Not Call reported calls",
    detail: { to: "/data/ftc_dnc_reported_calls", label: "Reported calls dataset" },
  },
  share: {
    id: "ftc-dnc-robocall-share",
    group: "consumer",
    title: "Share of Do Not Call reports that are recordings or robocalls, by month created",
    measure: "robocall share of reported calls",
    detail: { to: "/data/ftc_dnc_reported_calls", label: "Reported calls dataset" },
  },
  hsr: {
    id: "ftc-hsr-early-terminations",
    group: "enforcement",
    title: "HSR early terminations granted, by federal fiscal year",
    measure: "HSR early terminations",
    detail: { to: "/data/ftc_hsr_early_terminations", label: "Early termination notices" },
  },
} as const satisfies Record<string, BlockDef>;

const EMPTY_REASON = {
  dnc: "The published Do Not Call reported-call data holds no counted month yet.",
  hsr: "The published early termination notices hold no usable year yet.",
} as const;

export function FtcConsumerSection() {
  const q = useQuery({
    queryKey: ["ftc-consumer-overview"],
    queryFn: () => getFtcConsumerOverview(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  return (
    <section id="group-ftc-consumer" aria-labelledby="group-ftc-consumer-title" className="scroll-mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="group-ftc-consumer-title" className="text-sm font-semibold">
          FTC consumer protection and merger review
        </h2>
        <Link
          to={"/data/ftc_open_data_catalog" as never}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          What the FTC offers for download
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <p className="mb-2 max-w-4xl text-xs leading-5 text-muted-foreground">
        Do Not Call reports, HSR early terminations and the FTC&apos;s Data Spotlight posts, from
        the FTC&apos;s own data files and API. Reports are consumers&apos; submissions, not
        findings of wrongdoing.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {q.isPending ? (
          <>
            <TrendCardView def={DEFS.monthly} state={{ kind: "loading" }} />
            <TrendCardView def={DEFS.share} state={{ kind: "loading" }} />
            <TrendCardView def={DEFS.hsr} state={{ kind: "loading" }} />
            <LoadingFrame label="Loading Data Spotlight posts" />
          </>
        ) : q.isError ? (
          <div role="alert" className="space-y-2 rounded-md border border-border bg-surface px-3 py-3 text-xs md:col-span-2">
            <p className="text-destructive">
              This section could not be read just now. The other sections are unaffected.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
              <RefreshCw className="size-3" aria-hidden />
              Retry
            </Button>
          </div>
        ) : (
          <Loaded data={q.data} onRetry={() => void q.refetch()} />
        )}
      </div>
    </section>
  );
}

function cardState(
  block: FtcConsumerOverview["monthly"],
  failed: boolean,
  empty: string,
  onRetry: () => void,
): CardState {
  if (failed) return { kind: "error", onRetry };
  return block ? { kind: "ok", block } : { kind: "empty", reason: empty };
}

export function Loaded({ data, onRetry = () => undefined }: { data: FtcConsumerOverview; onRetry?: () => void }) {
  const dncFailed = data.unavailable.includes("dnc");
  const hsrFailed = data.unavailable.includes("hsr");
  return (
    <>
      <TrendCardView def={DEFS.monthly} state={cardState(data.monthly, dncFailed, EMPTY_REASON.dnc, onRetry)} />
      <TrendCardView def={DEFS.share} state={cardState(data.share, dncFailed, EMPTY_REASON.dnc, onRetry)} />
      <SubjectsCard subjects={data.subjects} failed={dncFailed} />
      <TrendCardView def={DEFS.hsr} state={cardState(data.hsr, hsrFailed, EMPTY_REASON.hsr, onRetry)} />
      <SpotlightCard posts={data.spotlight} failed={data.unavailable.includes("spotlight")} />
      {data.terms ? (
        <p className="text-[11px] leading-4 text-muted-foreground md:col-span-2">{data.terms}</p>
      ) : null}
    </>
  );
}

function LoadingFrame({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border bg-surface" aria-busy>
      <div className="space-y-2 px-3 py-2" role="status" aria-label={label}>
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function CardFrame({
  id,
  title,
  period,
  children,
}: {
  id: string;
  title: string;
  period?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`block-${id}`}
      aria-labelledby={`block-${id}-title`}
      className="flex min-w-0 scroll-mt-4 flex-col rounded-md border border-border bg-surface"
    >
      <header className="border-b border-border/70 px-3 py-2">
        <h3 id={`block-${id}-title`} className="text-sm font-semibold leading-5">
          {title}
        </h3>
        {period ? <p className="text-[11px] leading-4 text-muted-foreground">{period}</p> : null}
      </header>
      {children}
    </section>
  );
}

function SourceFooter({ label, url, extra }: { label: string; url: string; extra?: string }) {
  return (
    <footer className="mt-auto border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
      <p>
        Source:{" "}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
        >
          {label}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
      {extra ? <p>{extra}</p> : null}
    </footer>
  );
}

/** Subjects consumers gave, as shares of the calls counted in the window; the FTC's catch-all buckets are listed apart. */
export function SubjectsCard({ subjects, failed }: { subjects: FtcSubjects | null; failed: boolean }) {
  const [showData, setShowData] = useState(false);
  const tableId = useId();
  const title = "Subjects of Do Not Call reports";
  if (failed)
    return (
      <CardFrame id="ftc-dnc-subjects" title={title}>
        <p role="alert" className="px-3 py-3 text-xs text-destructive">
          This card could not be read just now. The other cards are unaffected.
        </p>
      </CardFrame>
    );
  if (!subjects)
    return (
      <CardFrame id="ftc-dnc-subjects" title={title}>
        <p role="status" className="px-3 py-3 text-xs text-muted-foreground">
          No month with every record read is published yet, so no subject shares are shown.
        </p>
      </CardFrame>
    );
  const all = [...subjects.named, ...subjects.catchAll];
  return (
    <CardFrame
      id="ftc-dnc-subjects"
      title={title}
      period={`Share of reports · ${subjects.window}`}
    >
      <div className="px-3 pt-2">
        <p className="text-[11px] leading-4 text-muted-foreground">
          {formatCount(subjects.total)} reports counted; the ten named subjects the most reported
        </p>
        <div className="mt-1.5">
          <ShareBars items={subjects.named.map((s) => ({ label: s.subject, sharePct: s.sharePct }))} />
        </div>
        {subjects.catchAll.length ? (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            The FTC&apos;s catch-all choices, not ranked above:{" "}
            {subjects.catchAll.map((s) => `${s.subject} ${s.sharePct}%`).join(", ")}.
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
        <button
          type="button"
          aria-expanded={showData}
          aria-controls={tableId}
          onClick={() => setShowData((v) => !v)}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Table2 className="size-3" aria-hidden />
          {showData ? "Hide data" : "Show data"}
        </button>
        <Link
          to={"/data/ftc_dnc_reported_calls" as never}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Reported calls dataset
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <div id={tableId} hidden={!showData}>
        {showData ? (
          <div
            role="region"
            aria-label="Data table: subjects of Do Not Call reports"
            tabIndex={0}
            className="max-h-56 overflow-auto border-t border-border/70 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <table className="w-full border-collapse text-[11px]">
              <caption className="sr-only">
                Reports by subject, {subjects.window}. Shares are of all {formatCount(subjects.total)} reports counted.
              </caption>
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="px-3 py-1 font-medium">Subject</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Reports</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {all.map((s) => (
                  <tr key={s.subject} className="border-b border-border/50 last:border-0">
                    <th scope="row" className="px-3 py-0.5 text-left font-normal">{s.subject}</th>
                    <td className="px-2 py-0.5 text-right tabular-nums">{formatCount(s.calls)}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{s.sharePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <details className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        <summary className="cursor-pointer select-none text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          How to read this
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>
            The consumer picks one subject from the FTC&apos;s list when reporting a call. The share
            is that subject&apos;s reports divided by all reports counted in the window, including
            the catch-all choices.
          </li>
          <li>
            This is the window of daily files the FTC lists as downloadable now, not a year: shares
            can move from one period to the next.
          </li>
          <li>Reports are unverified; a subject is what the consumer said, not what the caller sold.</li>
        </ul>
      </details>
      <SourceFooter label="FTC Do Not Call reported calls data" url={subjects.sourceUrl} extra={`Period: ${subjects.window}`} />
    </CardFrame>
  );
}

/** The FTC's newest Data Spotlight posts, linked to the FTC's pages; text is the FTC's own summary. */
export function SpotlightCard({ posts, failed }: { posts: readonly SpotlightPost[]; failed: boolean }) {
  const title = "FTC Data Spotlight posts";
  if (failed)
    return (
      <CardFrame id="ftc-spotlight" title={title}>
        <p role="alert" className="px-3 py-3 text-xs text-destructive">
          This card could not be read just now. The other cards are unaffected.
        </p>
      </CardFrame>
    );
  if (!posts.length)
    return (
      <CardFrame id="ftc-spotlight" title={title}>
        <p role="status" className="px-3 py-3 text-xs text-muted-foreground">
          No Data Spotlight posts are indexed yet.
        </p>
      </CardFrame>
    );
  return (
    <CardFrame id="ftc-spotlight" title={title} period="Newest first · published by the FTC from Consumer Sentinel reports">
      <ul className="divide-y divide-border/60">
        {posts.slice(0, 6).map((p) => (
          <li key={p.id} className="px-3 py-2">
            <p className="text-xs font-medium leading-4">
              {p.url ? (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {p.title}
                </a>
              ) : (
                p.title
              )}
            </p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {p.published ?? "Date not recorded"}
              {p.fileUrl ? (
                <>
                  {" · "}
                  <a
                    href={p.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn("inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline")}
                  >
                    <FileText className="size-3" aria-hidden />
                    PDF
                  </a>
                </>
              ) : null}
            </p>
            {p.summary ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{p.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex justify-end px-3 py-2">
        <Link
          to={"/data/ftc_publications_index" as never}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          All Data Spotlight posts and FTC reports
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <SourceFooter label="FTC Data Spotlight" url="https://www.ftc.gov/news-events/data-visualizations/data-spotlight" />
    </CardFrame>
  );
}
