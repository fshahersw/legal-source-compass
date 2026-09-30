import { Link } from "@tanstack/react-router";
import {
  Bookmark,
  BarChart3,
  Compass,
  Database,
  Map as MapIcon,
  Tags,
  Landmark,
  Layers,
  Library,
  ListChecks,
  Plug,
  ShieldAlert,
  Gavel,
  Scale,
  BookOpen,
  Search,
  FolderOpen,
  Download,
} from "lucide-react";
import type { ReactNode } from "react";

import { useAtlas } from "@/lib/atlas/store";
import { reviewCounts } from "@/lib/atlas/review";

type NavItem = { to: string; label: string; icon: typeof Library; exact?: boolean };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Explore", items: [
    { to: "/search", label: "Search", icon: Search },
    { to: "/places", label: "Places", icon: MapIcon },
    { to: "/data", label: "Data catalog", icon: Database },
  ] },
  { label: "Corpus", items: [
    { to: "/courts", label: "Courts", icon: Landmark },
    { to: "/judges", label: "Judges", icon: Gavel },
    { to: "/matters", label: "Matters", icon: Scale },
    { to: "/insights", label: "Case insights", icon: BarChart3 },
    { to: "/law", label: "Law", icon: BookOpen },
    { to: "/safety", label: "Safety", icon: ShieldAlert },
  ] },
  { label: "V2.2A sources", items: [
    { to: "/", label: "Library", icon: Library, exact: true },
    { to: "/jurisdictions", label: "Jurisdictions", icon: Compass },
    { to: "/categories", label: "Categories", icon: Tags },
    { to: "/source-families", label: "Source families", icon: Layers },
    { to: "/endpoint-explorer", label: "Endpoints", icon: Plug },
    { to: "/source-datasets", label: "Corpus sources", icon: FolderOpen },
  ] },
  { label: "My work", items: [
    { to: "/review-queue", label: "Review Queue", icon: ListChecks },
    { to: "/saved-sources", label: "Saved Sources", icon: Bookmark },
    { to: "/data-exports", label: "Data & Exports", icon: Download },
  ] },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);

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
  const { bundle, stats, overlays, bookmarks, status, loaded, localStateWarning, persistWarning } = useAtlas();
  const counts = reviewCounts(overlays);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Link to="/" className="mb-4 block px-2">
          <div className="eyebrow">Corpus + V2.2A directory</div>
          <div className="mt-1 font-display text-lg leading-tight text-sidebar-primary">
            Legal Source
            <br />
            Atlas
          </div>
        </Link>

        <nav className="flex flex-col gap-3 overflow-y-auto">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <div className="eyebrow px-2 pb-0.5 text-[10px]">{g.label}</div>
              {g.items.map((item) => (
                <Link key={item.to} to={item.to} activeOptions={{ exact: !!item.exact }} className="nav-link">
                  <item.icon className="size-4 opacity-70" strokeWidth={1.75} />
                  <span className="flex-1">{item.label}</span>
                  {item.label === "Review Queue" && counts.total > 0 ? (
                    <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">{counts.total}</span>
                  ) : null}
                  {item.label === "Saved Sources" && Object.keys(bookmarks).length > 0 ? (
                    <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">{Object.keys(bookmarks).length}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto space-y-3 px-2 pt-6">
          <div className="rounded-md border border-border bg-muted/60 p-2.5">
            <div className="eyebrow">
              {loaded?.origin === "bundled-default" || !loaded ? "Bundled directory" : "Your browser import"}
            </div>
            {status === "loading" ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">Loading…</p>
            ) : bundle && stats ? (
              <dl className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Version</dt>
                  <dd className="font-mono text-foreground">{bundle.bundle_version}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Distinct URLs</dt>
                  <dd className="font-mono text-foreground" data-testid="sidebar-distinct">
                    {stats.distinctSources.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Occurrences</dt>
                  <dd className="font-mono text-foreground" data-testid="sidebar-occurrences">
                    {stats.totalOccurrences.toLocaleString()}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-1.5 text-[11px] leading-relaxed text-destructive">
                Directory not loaded. See the message on the page.
              </p>
            )}
          </div>
          <p className="flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              The directory is public-source data shipped with this build. Your reviews, bookmarks and
              any file you import are stored in{" "}
              <strong className="font-semibold text-foreground">this browser only</strong>.
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
              activeOptions={{ exact: !!item.exact }}
              className="nav-link whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="px-5 py-6 lg:px-8">
          {localStateWarning || (persistWarning && persistWarning !== "Saving to browser storage…") ? (
            <div
              role="alert"
              className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[12px] leading-relaxed text-warning-foreground"
            >
              {[localStateWarning, persistWarning].filter(Boolean).join(" ")}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
