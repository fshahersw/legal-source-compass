import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Map as MapIcon,
  Landmark,
  Library,
  ShieldAlert,
  BookOpen,
  Search,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useCorpusAccessMode } from "@/components/auth/CorpusAccessGate";
import { signOutEverywhere } from "@/lib/auth/session";
import { useSessionUser } from "@/lib/auth/useSession";
import { useAtlas } from "@/lib/atlas/store";
import { reviewCounts } from "@/lib/atlas/review";
import { getSidebarCollapsed, setSidebarCollapsed } from "@/lib/atlas/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type NavItem = { to: string; label: string; icon: typeof Library; paths: string[] };
const EXPLORE = ["/", "/places", "/search", "/overview"];
const LITIGATION = [
  "/courts",
  "/judges",
  "/matters",
  "/people",
  "/insights",
  "/mdls",
  "/records",
  "/registry",
];
const LAW = ["/law", "/laws", "/limitations", "/safety", "/agencies"];
const SOURCES = [
  "/sources",
  "/source-datasets",
  "/data",
  "/saved-sources",
  "/data-exports",
];
const NAV: NavItem[] = [
  { to: "/matters", label: "Matters", icon: Landmark, paths: LITIGATION },
  { to: "/places", label: "Explore", icon: MapIcon, paths: EXPLORE },
  { to: "/law", label: "Law & Safety", icon: BookOpen, paths: LAW },
  { to: "/sources/library", label: "Sources", icon: Library, paths: SOURCES },
];

type ContextItem = { to: string; label: string; search?: { ds: string } };
const CONTEXT_NAV: { paths: string[]; items: ContextItem[] }[] = [
  {
    paths: EXPLORE,
    items: [
      { to: "/", label: "Map" },
      { to: "/search", label: "Search" },
    ],
  },
  {
    paths: LITIGATION,
    items: [
      { to: "/matters", label: "Matters & MDLs" },
      { to: "/matters/cases", label: "Cases & dockets" },
      { to: "/matters", label: "Expert rulings", search: { ds: "expert_rulings" } },
      { to: "/courts", label: "Courts" },
      { to: "/judges", label: "Judges" },
      { to: "/people", label: "People" },
    ],
  },
  {
    paths: LAW,
    items: [
      { to: "/law", label: "Law & regulation" },
      { to: "/law/codes", label: "State codes" },
      { to: "/limitations", label: "Time limits" },
      { to: "/safety", label: "Product safety" },
      { to: "/agencies", label: "Agencies" },
    ],
  },
  {
    paths: SOURCES,
    items: [
      { to: "/sources/library", label: "Source library" },
      { to: "/sources/catalog", label: "Source catalog" },
      { to: "/sources/coverage", label: "Quality & coverage" },
      { to: "/sources/analysis", label: "Docket timelines" },
      { to: "/sources/docket-documents", label: "Docket documents" },
      { to: "/saved-sources", label: "Saved" },
    ],
  },
];

function AccountBox({ collapsed }: { collapsed: boolean }) {
  const { user, ready } = useSessionUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accessMode = useCorpusAccessMode();
  if (!ready) return null;
  const center = collapsed ? "justify-center px-0" : "";
  if (!user)
    return (
      <Link
        to="/auth"
        className={`nav-link ${center}`}
        title={collapsed ? "Sign in" : undefined}
        aria-label={collapsed ? "Sign in" : undefined}
      >
        <LogIn className="size-4 opacity-70" strokeWidth={1.75} />
        {!collapsed && <span>Sign in</span>}
      </Link>
    );
  const signOut = async () => {
    await queryClient.cancelQueries();
    await signOutEverywhere();
    // Sign-in is optional unless the server enforces accounts (CORPUS_REQUIRE_AUTH); then return to the sign-in page.
    if (accessMode === "enforced") navigate({ to: "/auth", replace: true });
  };
  return (
    <div className={collapsed ? "flex justify-center" : "space-y-1"}>
      {!collapsed && (
        <div className="truncate text-[11px] text-sidebar-foreground/75" title={user.email ?? ""}>
          {user.email}
        </div>
      )}
      <button
        type="button"
        onClick={signOut}
        className={`nav-link w-full ${center}`}
        title={collapsed ? "Sign out" : undefined}
        aria-label={collapsed ? "Sign out" : undefined}
      >
        <LogOut className="size-4 opacity-70" strokeWidth={1.75} />
        {!collapsed && <span>Sign out</span>}
      </button>
    </div>
  );
}

function pathMatches(pathname: string, path: string) {
  return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
}

export function AppShell({
  breadcrumbs,
  title,
  description,
  actions,
  children,
}: {
  breadcrumbs: { label: string; to?: string; search?: Record<string, string> | undefined }[];
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { overlays, bookmarks, localStateWarning, persistWarning } = useAtlas();
  const counts = reviewCounts(overlays);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(getSidebarCollapsed());
  }, []);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    setSidebarCollapsed(next);
  };
  const context = CONTEXT_NAV.find((group) =>
    group.paths.some((path) => pathMatches(pathname, path)),
  );
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = search.trim();
    if (q.length >= 2) navigate({ to: "/search", search: { q } });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-5 transition-[width] duration-200 lg:flex ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
        {collapsed ? (
          <Link to="/" className="mb-4 flex justify-center" aria-label="Legal Source Atlas — home">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-md bg-sidebar-accent font-display text-[13px] font-semibold text-sidebar-primary"
            >
              LA
            </span>
          </Link>
        ) : (
          <Link to="/" className="mb-4 block px-2">
            <div className="eyebrow text-sidebar-foreground/75">Legal research</div>
            <div className="mt-1 font-display text-lg leading-tight text-sidebar-primary">
              Legal Source
              <br />
              Atlas
            </div>
          </Link>
        )}

        <nav className="flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = item.paths.some((path) => pathMatches(pathname, path));
            const badgeCount =
              item.label === "Sources" ? counts.total + Object.keys(bookmarks).length : 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`nav-link relative ${active ? "active" : ""} ${collapsed ? "justify-center px-0" : ""}`}
              >
                <item.icon className="size-4 opacity-70" strokeWidth={1.75} />
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {badgeCount > 0 ? (
                  collapsed ? (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 top-1.5 size-1.5 rounded-full bg-secondary"
                    />
                  ) : (
                    <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">
                      {badgeCount}
                    </span>
                  )
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={`mt-auto space-y-3 pt-6 ${collapsed ? "px-0" : "px-2"}`}>
          <AccountBox collapsed={collapsed} />
          {!collapsed && (
            <p className="flex gap-1.5 text-[11px] leading-relaxed text-sidebar-foreground/75">
              <ShieldAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
              <span>Saved items stay in this browser.</span>
            </p>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/90 px-5 py-4 backdrop-blur lg:px-8">
          <div className="mb-1.5 flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden shrink-0 rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose className="size-4" strokeWidth={1.75} />
              )}
            </button>
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                {breadcrumbs.map((crumb, i) => (
                  <li key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 ? (
                      <span aria-hidden className="opacity-50">
                        /
                      </span>
                    ) : null}
                    {crumb.to ? (
                      <Link
                        to={crumb.to}
                        {...(crumb.search ? { search: crumb.search as never } : {})}
                        className="hover:text-foreground hover:underline"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{crumb.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl leading-tight">{title}</h1>
              {description ? (
                <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
          <form onSubmit={submitSearch} className="mt-3 flex max-w-xl items-center gap-1.5">
            <Input
              aria-label="Search all corpus data"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search matters, dockets, documents, courts, and law"
              className="h-9 bg-background text-[13px]"
            />
            <Button
              type="submit"
              size="icon"
              variant="outline"
              className="size-9"
              aria-label="Search"
            >
              <Search />
            </Button>
          </form>
        </header>

        {context && pathname !== "/" ? (
          <nav
            aria-label="Section"
            className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-5 py-2 lg:px-8"
          >
            {context.items.map((item) => (
              <Link
                key={`${item.to}${item.search?.ds ?? ""}`}
                to={item.to}
                {...(item.search ? { search: item.search } : {})}
                activeOptions={{ exact: item.to === "/", includeSearch: !!item.search }}
                className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted font-semibold text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <nav
          aria-label="Sections"
          className="flex items-center gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar px-3 py-2 text-sidebar-foreground lg:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="nav-link whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
          <div className="ml-auto shrink-0 pl-1">
            <AccountBox collapsed />
          </div>
        </nav>

        <main className="px-5 py-6 lg:px-8">
          {localStateWarning ||
          (persistWarning && persistWarning !== "Saving to browser storage…") ? (
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
