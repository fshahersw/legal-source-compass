import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { MoreToggle } from "@/components/enforcement/parts";

/** Frame shared by the CourtListener bulk-data panels on court and judge pages. */
export function PanelShell({
  title,
  subtitle,
  record,
  aside,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  /** Root-relative record the panel summarises (`/records/<dataset>/<id>`). */
  record?: { dataset: string; id: string } | null;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const uid = useId();
  return (
    <section
      className="mb-5 min-w-0 rounded-xl border border-border bg-card shadow-xs"
      aria-labelledby={`${uid}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <h2 id={`${uid}-title`} className="text-sm font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {aside}
          {record ? (
            <Link
              to="/records/$dataset/$id"
              params={{ dataset: record.dataset, id: record.id }}
              className="rounded-md border border-border px-2.5 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              Full record
            </Link>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function PanelLoading({ label, height = "h-40" }: { label: string; height?: string }) {
  return (
    <div
      className={cn("mb-5 animate-pulse rounded-lg border border-border bg-muted/40", height)}
      aria-busy="true"
      aria-label={label}
    />
  );
}

export function PanelError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <p
      role="alert"
      className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
    >
      {text}
      <button
        type="button"
        onClick={onRetry}
        className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Retry
      </button>
    </p>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

/** A compact table; the first `limit` rows show, the rest behind a toggle. Scrolls sideways inside its box on narrow screens. */
export function MiniTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  limit = 10,
  noun,
  note,
}: {
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  limit?: number;
  noun?: string;
  note?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const uid = useId();
  if (!rows.length) return null;
  const shown = expanded ? rows : rows.slice(0, limit);
  return (
    <div className="min-w-0">
      <div id={uid} className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-xs">
          <caption className="mb-1 text-left text-xs font-medium">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-[11px] text-muted-foreground">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn("px-1.5 py-1 font-medium", c.numeric ? "text-right" : "text-left")}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-border/50 align-top">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-1.5 py-1",
                      c.numeric ? "text-right font-mono tabular-nums" : "break-words",
                    )}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
      <MoreToggle
        total={rows.length}
        limit={limit}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        controls={uid}
        noun={noun}
      />
    </div>
  );
}

/** A person's name linking to their clb_judge_dockets record only when the stored link named exactly that id. */
export function PersonName({
  name,
  statsRecord,
  personId,
}: {
  name: string;
  statsRecord: string | null;
  personId: number;
}) {
  if (statsRecord === `/records/clb_judge_dockets/${personId}`)
    return (
      <Link
        to="/records/$dataset/$id"
        params={{ dataset: "clb_judge_dockets", id: String(personId) }}
        className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {name}
      </Link>
    );
  return <>{name}</>;
}

/** A court name linking to its profile only when the stored link is exactly `/courts/<id>`. */
export function CourtName({
  name,
  courtId,
  link,
}: {
  name: string;
  courtId: string;
  link: string | null;
}) {
  if (link === `/courts/${courtId}`)
    return (
      <Link
        to="/courts/$id"
        params={{ id: courtId }}
        className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {name}
      </Link>
    );
  return <>{name}</>;
}
