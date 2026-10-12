import type { LimitationsSnapshot } from "@/lib/limitations/types";

export function CalculatorCoverage({
  snapshot,
  onOpen,
}: {
  snapshot: LimitationsSnapshot;
  onOpen: () => void;
}) {
  const jurisdictions = new Set(snapshot.rules.map((rule) => rule.jurisdiction)).size;
  const cells = snapshot.coverage.flatMap((row) => row.claimCoverage ?? []);
  const notRecorded = cells.filter((cell) => cell.status === "not_recorded").length;
  const limited = cells.filter(
    (cell) => cell.status === "flagged" || cell.status === "research_only",
  ).length;
  return (
    <details className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer leading-relaxed">
        {snapshot.rules.length.toLocaleString()} recorded rules · {jurisdictions.toLocaleString()}{" "}
        jurisdictions with rules · Coverage limits
      </summary>
      <p className="mt-2">
        Rule totals include historical and narrow variants. A jurisdiction with rules is not
        complete coverage of every claim, exception or filing requirement.
      </p>
      <p className="mt-2">
        {cells.length
          ? `${notRecorded.toLocaleString()} listed state/claim combinations have no general rule recorded; ${limited.toLocaleString()} are flagged or research-only.`
          : "General-claim coverage counts are not recorded in this release."}
      </p>
      <p className="mt-2 break-words">
        Loaded source release: {snapshot.ruleVersion}. Integrity checks and evidence grades do not
        establish complete or current law.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 min-h-9 font-semibold text-primary underline"
      >
        Inspect state and claim coverage
      </button>
    </details>
  );
}
