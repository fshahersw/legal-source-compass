/** What the summary endpoint returns (shared by the server function and the kit). Plain data, no server imports. */

export type SummaryUnavailableReason =
  "not_configured" | "rate_limited" | "busy" | "timeout" | "error" | "invalid";

export type SummaryResult =
  | { status: "ok"; bullets: string[]; omitted: number; cached: boolean; generatedAt: string }
  | { status: "thin"; message: string }
  | {
      status: "unavailable";
      reason: SummaryUnavailableReason;
      message: string;
      retryAfterSec?: number | undefined;
    };
