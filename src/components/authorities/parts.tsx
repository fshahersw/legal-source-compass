import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { MoreToggle } from "@/components/enforcement/parts";
import { tableEdition, type TableMeta } from "@/lib/external/ecfrAuthorities";

/** A bordered panel with a title row; the aside (edition, counts) sits at the right of the title. */
export function PanelFrame({
  label,
  title,
  aside,
  children,
}: {
  label: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="min-w-0 rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/70 px-3 py-2">
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        {aside ? <span className="text-[11px] text-muted-foreground">{aside}</span> : null}
      </header>
      <div className="px-3 py-2.5 text-[12.5px]">{children}</div>
    </section>
  );
}

export function PanelLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-2">
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted/60" />
      <div className="h-3 w-3/5 animate-pulse rounded bg-muted/60" />
    </div>
  );
}

export function PanelError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="m-0 text-muted-foreground">
      {what} could not load.{" "}
      <button type="button" className="text-primary underline" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

export function SourceFoot({
  meta,
  url,
  page,
}: {
  meta: TableMeta;
  url: string | null;
  page: number | null;
}) {
  return (
    <p className="m-0 mt-2.5 border-t border-border/70 pt-2 text-[11px] leading-4 text-muted-foreground">
      Source: Parallel Table of Authorities and Rules, {tableEdition(meta)}, Office of the Federal
      Register. The table lists the authority agencies cite in their regulations and is not
      all-inclusive; a row does not say the part implements every provision of the authority.{" "}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          GovInfo PDF{page ? `, page ${page}` : ""} <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </p>
  );
}

/** A capped list with a keyboard-operable "+N more" toggle. */
export function Capped<T>({
  items,
  limit,
  noun,
  render,
  className,
}: {
  items: T[];
  limit: number;
  noun: string;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = open ? items : items.slice(0, limit);
  return (
    <>
      <ul id={id} className={className ?? "m-0 list-none p-0"}>
        {shown.map((x, i) => render(x, i))}
      </ul>
      <MoreToggle
        total={items.length}
        limit={limit}
        expanded={open}
        onToggle={() => setOpen((v) => !v)}
        controls={id}
        noun={noun}
      />
    </>
  );
}
