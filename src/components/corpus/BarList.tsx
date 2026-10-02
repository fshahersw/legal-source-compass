import type { Count } from "@/lib/corpus/insights";

export function BarList({ title, rows, limit = 12, unit }: { title: string; rows: Count[]; limit?: number; unit: string }) {
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.count));
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
      <h3 className="eyebrow mb-3">{title}</h3>
      {shown.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No rows.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem] items-center gap-2 text-[12px] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5.5rem]">
              <span className="truncate" title={r.label}>{r.label}</span>
              <span className="h-2 rounded-sm bg-muted">
                <span className="block h-2 rounded-sm bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono">{r.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit ? <p className="mt-2 text-[11px] text-muted-foreground">Top {limit} of {rows.length.toLocaleString()} values · counts are {unit}</p> : <p className="mt-2 text-[11px] text-muted-foreground">Counts are {unit}</p>}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-display text-2xl">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {note ? <div className="mt-0.5 text-[11px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}

export function CorpusStatus({ status, error, retry }: { status: string; error: string | null; retry: () => void }) {
  if (status === "loading") return <p className="text-[13px] text-muted-foreground">Loading bundled corpus files…</p>;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px]">
      <p>Couldn't load the bundled corpus files: {error}</p>
      <button className="mt-2 underline" onClick={retry}>Retry</button>
    </div>
  );
}
