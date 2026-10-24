/**
 * PageHeader: breadcrumb, title (28/34 semibold, tight tracking), one-line description (14/22, at most 68ch), actions,
 * optional emblem and menu or tabs.
 * The app shell renders one for every page (title/description/actions/emblem); use this directly for a header inside
 * a page body or a prototype.
 *
 *   <PageHeader breadcrumbs={[{ label: "Insights", to: "/insights" }, { label: "Trends" }]} title="Trends"
 *     description="Compare places or MDLs on one metric over time." actions={<Button size="sm">Export</Button>}
 *     tabs={<PageTabs … />} />
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageCrumb = {
  label: string;
  to?: string | undefined;
  search?: Record<string, unknown> | undefined;
};

export function Breadcrumbs({
  items,
  className,
}: {
  items: readonly PageCrumb[];
  className?: string | undefined;
}) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1 p-0 text-[13px] text-muted-foreground">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden /> : null}
              {crumb.to && !last ? (
                <Link
                  to={crumb.to as never}
                  {...(crumb.search ? { search: crumb.search as never } : {})}
                  className="truncate rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn("truncate", last && "font-medium text-foreground")}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  emblem,
  tabs,
  meta,
  titleAs: Title = "h1",
  tabsClassName,
  className,
}: {
  title: ReactNode;
  description?: ReactNode | undefined;
  breadcrumbs?: readonly PageCrumb[] | undefined;
  actions?: ReactNode | undefined;
  emblem?: ReactNode | undefined;
  /** A tab row (PageTabs or link tabs) under the header. */
  tabs?: ReactNode | undefined;
  /** A short line under the description (e.g. "Updated Oct 24, 2026"). */
  meta?: ReactNode | undefined;
  titleAs?: "h1" | "h2" | undefined;
  /** Replaces the default gap above `tabs`. */
  tabsClassName?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <header className={cn("min-w-0", className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} className="mb-2" /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {emblem ? <div className="shrink-0">{emblem}</div> : null}
          <div className="min-w-0">
            <Title className="text-title text-foreground">{title}</Title>
            {description ? (
              <p className="measure mt-1.5 text-body text-muted-foreground">{description}</p>
            ) : null}
            {meta ? <div className="mt-1 text-meta text-muted-foreground">{meta}</div> : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {tabs ? <div className={tabsClassName ?? "mt-4"}>{tabs}</div> : null}
    </header>
  );
}
