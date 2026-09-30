import { Link } from "@tanstack/react-router";
import {
  Bookmark,
  Database,
  Landmark,
  Layers,
  Library,
  ListChecks,
  Plug,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { useAtlas } from "@/lib/atlas/store";
import { reviewCounts } from "@/lib/atlas/review";

const NAV = [
  { to: "/", label: "Library", icon: Library, exact: true },
  { to: "/jurisdictions", label: "Jurisdictions", icon: Landmark },
  { to: "/source-families", label: "Source Families", icon: Layers },
  { to: "/endpoint-explorer", label: "Endpoint Explorer", icon: Plug },
  { to: "/review-queue", label: "Review Queue", icon: ListChecks },
  { to: "/saved-sources", label: "Saved Sources", icon: Bookmark },
  { to: "/data-exports", label: "Data & Exports", icon: Database },
] as const;

export function AppShell({
  breadcrumbs,
  title,
  description,
  actions,
  children,
}: {
  breadcrumbs: { label: string; to?: string }[];
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { bundle, stats, overlays, bookmarks } = useAtlas();
  const counts = reviewCounts(overlays);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Link to="/" className="mb-6 block px-2">
          <div className="eyebrow">V2.2A directory</div>
          <div className="mt-1 font-display text-lg leading-tight text-sidebar-primary">
            Legal Source
            <br />
            Atlas
          </div>
        </Link>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={"exact" in item ? { exact: item.exact } : undefined}
              className="nav-link"
            >
              <item.icon className="size-4 opacity-70" strokeWidth={1.75} />
              <span className="flex-1">{item.label}</span>
              {item.label === "Review Queue" && counts.total > 0 ? (
                <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">
                  {counts.total}
                </span>
              ) : null}
              {item.label === "Saved Sources" && Object.keys(bookmarks).length > 0 ? (
                <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">
                  {Object.keys(bookmarks).length}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-3 px-2 pt-6">
          <div className="rounded-md border border-border bg-muted/60 p-2.5">
            <div className="eyebrow">Imported bundle</div>
            {bundle && stats ? (
              <dl className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Version</dt>
                  <dd className="font-mono text-foreground">{bundle.bundle_version}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Distinct URLs</dt>
                  <dd className="font-mono text-foreground">
                    {stats.distinctSources.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Occurrences</dt>
                  <dd className="font-mono text-foreground">
                    {stats.totalOccurrences.toLocaleString()}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                No bundle imported. All views are empty until a V2.2A JSON bundle is loaded.
              </p>
            )}
          </div>
          <p className="flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              Reviews, bookmarks and the imported bundle are stored in{" "}
              <strong className="font-semibold text-foreground">this browser only</strong>. Nothing is
              uploaded to a server.
            </span>
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/90 px-5 py-4 backdrop-blur lg:px-8">
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {breadcrumbs.map((crumb, i) => (
                <li key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 ? <span aria-hidden className="opacity-50">/</span> : null}
                  {crumb.to ? (
                    <Link to={crumb.to} className="hover:text-foreground hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl leading-tight">{title}</h1>
              {description ? (
                <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={"exact" in item ? { exact: item.exact } : undefined}
              className="nav-link whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
