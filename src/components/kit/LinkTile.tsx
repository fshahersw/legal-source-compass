/**
 * Link surfaces for navigation content.
 *
 * LinkTile: a compact card link (icon, title, one line, count, arrow) for section landings and "go deeper" links.
 *   <LinkTile to="/courts" icon={Landmark} title="Courts & judges" description="Every court and judge…"
 *     count="5,411 courts" />
 *
 * ListRow: one row in a card list (leading slot or icon, title, one line, meta/count on the right, chevron when it
 * links). Use inside <ul className="divide-y divide-border">; pass `to` (router), `href` (external) or neither.
 *   <ListRow to="/insights/trends" icon={LineChart} title="Trends" description="Compare up to six places…" />
 */
import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, ExternalLink, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

type Icon = ComponentType<LucideProps>;

function IconBox({ icon: I, size = "md" }: { icon: Icon; size?: "sm" | "md" | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground transition-colors group-hover:text-foreground",
        size === "md" ? "size-9" : "size-8",
      )}
      aria-hidden
    >
      <I className="size-4" strokeWidth={1.75} />
    </span>
  );
}

const asTitle = (v: ReactNode) => (typeof v === "string" ? v : undefined);

export function LinkTile({
  to,
  search,
  params,
  icon,
  title,
  description,
  count,
  className,
}: {
  to: string;
  search?: Record<string, unknown> | undefined;
  params?: Record<string, string> | undefined;
  icon?: Icon | undefined;
  title: ReactNode;
  description?: ReactNode | undefined;
  /** Count line(s) under the description, e.g. "5,411 courts". */
  count?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <Link
      to={to as never}
      {...(search ? { search: search as never } : {})}
      {...(params ? { params: params as never } : {})}
      className={cn(
        "group flex h-full min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {icon ? <IconBox icon={icon} /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-label text-foreground">
          <span className="truncate" title={asTitle(title)}>
            {title}
          </span>
          <ArrowRight
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        </span>
        {description ? (
          <span
            className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-muted-foreground"
            title={asTitle(description)}
          >
            {description}
          </span>
        ) : null}
        {count ? (
          <span className="mt-1.5 block text-meta font-medium tabular-nums text-foreground/75">
            {count}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function ListRow({
  to,
  search,
  params,
  hash,
  href,
  icon,
  leading,
  title,
  description,
  meta,
  trailing,
  className,
}: {
  to?: string | undefined;
  search?: Record<string, unknown> | undefined;
  params?: Record<string, string> | undefined;
  hash?: string | undefined;
  /** External link (opens in a new tab). */
  href?: string | undefined;
  icon?: Icon | undefined;
  /** A custom leading slot (rank number, logo); replaces the icon. */
  leading?: ReactNode | undefined;
  title: ReactNode;
  description?: ReactNode | undefined;
  /** Right-aligned figure or count. */
  meta?: ReactNode | undefined;
  /** Right-most slot (e.g. a separate action link); rendered outside the row link. */
  trailing?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const body = (
    <>
      {leading ?? (icon ? <IconBox icon={icon} size="sm" /> : null)}
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[13px] font-medium text-foreground"
          title={asTitle(title)}
        >
          {title}
        </span>
        {description ? (
          <span
            className="mt-0.5 line-clamp-2 block text-meta text-muted-foreground"
            title={asTitle(description)}
          >
            {description}
          </span>
        ) : null}
      </span>
      {meta != null ? (
        <span className="shrink-0 text-right text-meta tabular-nums text-muted-foreground">
          {meta}
        </span>
      ) : null}
      {to ? (
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      ) : href ? (
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      ) : null}
    </>
  );
  const rowClass =
    "group flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring";
  const link = to ? (
    <Link
      to={to as never}
      {...(search ? { search: search as never } : {})}
      {...(params ? { params: params as never } : {})}
      {...(hash ? { hash } : {})}
      className={cn(rowClass, "hover:bg-accent")}
    >
      {body}
    </Link>
  ) : href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cn(rowClass, "hover:bg-accent")}>
      {body}
    </a>
  ) : (
    <div className={rowClass}>{body}</div>
  );
  return (
    <li className={cn("flex min-w-0 items-center", className)}>
      {link}
      {trailing ? <div className="shrink-0 pr-4">{trailing}</div> : null}
    </li>
  );
}
