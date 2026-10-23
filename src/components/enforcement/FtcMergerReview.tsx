import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { FtcHsrCard } from "@/components/analytics/hub/FtcConsumerSection";

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
