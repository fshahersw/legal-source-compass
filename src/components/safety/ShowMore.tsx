/** "Show N more" for a capped table; every cap is announced, never silent. */
export function ShowMore({
  shown,
  total,
  step,
  onMore,
  onAll,
  noun,
}: {
  shown: number;
  total: number;
  step: number;
  onMore: () => void;
  onAll: () => void;
  noun: string;
}) {
  if (shown >= total) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-[11px] text-muted-foreground">
      <span>
        Showing {shown.toLocaleString("en-US")} of {total.toLocaleString("en-US")} {noun}
      </span>
      <button
        type="button"
        onClick={onMore}
        className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Show {Math.min(step, total - shown).toLocaleString("en-US")} more
      </button>
      <button
        type="button"
        onClick={onAll}
        className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Show all
      </button>
    </div>
  );
}
