import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Map as MapIcon,
  Clock3,
  Library,
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
import {
  PRIMARY_NAVIGATION,
  contextualNavigation,
  navigationSection,
} from "@/lib/atlas/navigation";

const navIcons = { map: MapIcon, book: BookOpen, clock: Clock3, library: Library };
const NAV = PRIMARY_NAVIGATION.map((item) => ({ ...item, icon: navIcons[item.icon] }));

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
        <LogIn className="size-4 opacity-70" />
        {!collapsed && <span>Sign in</span>}
      </Link>
    );
  async function signOut() {
    await queryClient.cancelQueries();
    await signOutEverywhere();
    if (accessMode === "enforced") void navigate({ to: "/auth", replace: true });
  }
  return (
    <div className={collapsed ? "flex justify-center" : "space-y-1"}>
      {!collapsed && (
        <div
          className="truncate px-2 text-[11px] text-sidebar-foreground/75"
          title={user.email ?? ""}
        >
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
        <LogOut className="size-4 opacity-70" />
        {!collapsed && <span>Sign out</span>}
      </button>
    </div>
  );
}

export function AppShell({
  breadcrumbs,
  title,
  description,
  actions,
  emblem,
  children,
}: {
  breadcrumbs: { label: string; to?: string; search?: Record<string, string> | undefined }[];
  title: string;
  description?: string;
  actions?: ReactNode;
  emblem?: ReactNode;
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
  const context = contextualNavigation(pathname);
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    if (q.length >= 2) void navigate({ to: "/search", search: { q } });
  }
  return (
    <div
      data-ui-release="resource-workspace-20261009"
      className="atlas-shell flex min-h-screen bg-background"
    >
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-5 transition-[width] duration-150 lg:flex ${collapsed ? "w-14" : "w-52"}`}
      >
        <Link
          to="/"
          className={collapsed ? "mb-6 flex justify-center" : "mb-6 block px-2"}
          aria-label="Legal Source Atlas — home"
        >
          {collapsed ? (
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-md bg-sidebar-accent font-display text-sm font-semibold text-sidebar-primary"
            >
              LA
            </span>
          ) : (
            <>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/70">
                Research workspace
              </span>
              <span className="mt-1.5 block font-display text-xl leading-tight text-sidebar-primary">
                Legal Source
                <br />
                Atlas
              </span>
            </>
          )}
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = navigationSection(pathname) === item.id;
            const badgeCount =
              item.id === "sources" ? counts.total + Object.keys(bookmarks).length : 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`nav-link relative min-h-10 ${active ? "bg-sidebar-accent font-semibold" : ""} ${collapsed ? "justify-center px-0" : ""}`}
              >
                <item.icon className="size-4 shrink-0 opacity-90" strokeWidth={1.7} />
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {badgeCount > 0 && !collapsed ? (
                  <span className="rounded bg-sidebar/70 px-1.5 text-[10px] text-sidebar-foreground">
                    {badgeCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <AccountBox collapsed={collapsed} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="atlas-header border-b border-border bg-surface px-4 py-3 lg:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted lg:inline-flex"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
              <nav aria-label="Breadcrumb" className="min-w-0">
                <ol className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
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
                        <span aria-current="page">{crumb.label}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
            <form
              onSubmit={submitSearch}
              className="hidden w-64 shrink-0 items-center gap-1 md:flex"
            >
              <Input
                aria-label="Search all corpus data"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the atlas"
                className="h-8 bg-background text-xs"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label="Search"
              >
                <Search className="size-4" />
              </Button>
            </form>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {emblem ? <div className="shrink-0">{emblem}</div> : null}
              <div className="min-w-0">
                <h1 className="font-display text-[23px] leading-tight">{title}</h1>
                {description ? (
                  <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>
        </header>
        {context.length ? (
          <nav
            aria-label="Section"
            className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-1.5 lg:px-6"
          >
            {context.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: true }}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted font-semibold text-primary" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <nav
          aria-label="Sections"
          className="flex items-center gap-0.5 overflow-x-auto border-b border-sidebar-border bg-sidebar px-2 py-1.5 text-sidebar-foreground lg:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="nav-link whitespace-nowrap !px-2 !text-[11px]"
            >
              {item.label}
            </Link>
          ))}
          <div className="ml-auto shrink-0">
            <AccountBox collapsed />
          </div>
        </nav>
        <main className="atlas-main">
          {localStateWarning ||
          (persistWarning && persistWarning !== "Saving to browser storage…") ? (
            <div
              role="alert"
              className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs leading-relaxed text-warning-foreground"
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
