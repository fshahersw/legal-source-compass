import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { FtcHsrCard } from "@/components/analytics/hub/FtcConsumerSection";
import { getHsrSuspension } from "@/lib/external/companyTransactions.functions";

/**
 * The early-termination policy gap: the FTC suspended early termination grants in February 2021, so the notice counts
 * of the suspension years (found in the series itself: each below a tenth of the earlier median) are a policy effect,
 * not a collapse in mergers.
 */
function HsrSuspensionNote() {
  const q = useQuery({
    queryKey: ["ftc-hsr-suspension"],
    queryFn: () => getHsrSuspension(),
    staleTime: 10 * 60 * 1000,
  });
  const years = q.data?.suspended ?? [];
  if (!years.length) return null;
  const counts = years
    .map((y) => `${y}: ${(q.data?.calendar.find((c) => c.year === y)?.count ?? 0).toLocaleString("en-US")}`)
    .join(", ");
  return (
    <p
      role="note"
      className="max-w-3xl rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
    >
      <span className="font-medium">Policy gap, {years[0]}–{years.at(-1)}: </span>
      the FTC suspended early termination grants in February 2021, so the notices fall to{" "}
      {counts}. These years reflect that policy, not fewer mergers; do not read them as a trend.
    </p>
  );
}

/**
 * Merger review as the FTC publishes it: the HSR early termination notices, counted by federal fiscal year, with links to every
 * notice as published and to the FTC's monthly filing table. Mount it as a panel of the Enforcement page (see the handoff).
 * A notice is the FTC's publication that early termination was granted for a filing; it is not a finding about the deal.
 */
export function FtcMergerReview() {
  return (
    <section aria-label="HSR early termination notices" className="min-w-0 space-y-2">
      <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
        Early termination ends the Hart-Scott-Rodino waiting period before the 30 days run out. The
        FTC publishes a notice for each one granted; parties are shown exactly as the FTC prints
        them, so one company can appear under several spellings.
      </p>
      <HsrSuspensionNote />
      <div className="max-w-3xl">
        <FtcHsrCard />
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Link
          to={"/data/ftc_hsr_early_terminations" as never}
          className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Every notice as published
          <ArrowRight className="size-3" aria-hidden />
        </Link>
        <Link
          to={"/data/ftc_hsr_filings" as never}
          className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Filings, second requests and early terminations by year
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </p>
    </section>
  );
}
