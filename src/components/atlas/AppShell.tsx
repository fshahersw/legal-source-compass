import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Map as MapIcon,
  BarChart3,
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
import { BRAND_ASSETS, PRODUCT_NAME, WORKSPACE_DESCRIPTOR } from "@/lib/branding";
import {
  PRIMARY_NAVIGATION,
  activeContextualPath,
  ariaCurrent,
  contextualNavigation,
  navigationSection,
} from "@/lib/atlas/navigation";

const navIcons = { map: MapIcon, book: BookOpen, chart: BarChart3, library: Library };
const NAV = PRIMARY_NAVIGATION.map((item) => ({ ...item, icon: navIcons[item.icon] }));

/**
 * Active state of a primary section link, decided by navigationSection() alone. The router only
 * matches the exact path (always inside the same section), so it can never light another
 * section; data-status drives the shared nav-link active style. aria-current is "page" only on
 * the section's own page and "true" on its sub-pages.
 */
function primaryLinkState(pathname: string, to: string, active: boolean) {
  return {
    activeOptions: { exact: true, includeSearch: false },
    activeProps: {},
    "aria-current": ariaCurrent(pathname, to, active),
    "data-status": active ? "active" : undefined,
  };
}

/** Scrolls the tab strip (never the page) so the active tab is in view when the strip overflows. */
function revealTab(el: HTMLElement | null) {
  const strip = el?.parentElement;
  if (!el || !strip) return;
  const tab = el.getBoundingClientRect();
  const box = strip.getBoundingClientRect();
  if (tab.left < box.left) strip.scrollLeft -= box.left - tab.left + 8;
  else if (tab.right > box.right) strip.scrollLeft += tab.right - box.right + 8;
}

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
  const section = navigationSection(pathname);
  const context = contextualNavigation(pathname);
  const activeTab = activeContextualPath(pathname, context);
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    if (q.length >= 2) void navigate({ to: "/search", search: { q } });
  }
  return (
    <div
      data-ui-release="seeger-weiss-workspace-20261012"
      className="atlas-shell flex min-h-screen bg-background"
    >
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-2.5 py-4 transition-[width] duration-150 lg:flex ${collapsed ? "w-14" : "w-48"}`}
      >
        <Link
          to="/"
          className={collapsed ? "mb-4 flex justify-center" : "mb-4 block px-1.5 py-1"}
          aria-label={`${PRODUCT_NAME} — home`}
        >
          {collapsed ? (
            <img src={BRAND_ASSETS.icon32} alt="" className="size-7" />
          ) : (
            <>
              <img
                src={BRAND_ASSETS.wordmarkWhite}
                alt="Seeger Weiss LLP"
                width={241}
                height={21}
                className="h-auto w-full"
              />
              <span className="mt-2 block text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/75">
                {WORKSPACE_DESCRIPTOR}
              </span>
            </>
          )}
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = section === item.id;
            const badgeCount =
              item.id === "sources" ? counts.total + Object.keys(bookmarks).length : 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                {...primaryLinkState(pathname, item.to, active)}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`nav-link relative min-h-9 ${active ? "bg-sidebar-accent font-semibold" : ""} ${collapsed ? "justify-center px-0" : ""}`}
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
        <header className="atlas-header border-b border-border bg-surface py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Link to="/" aria-label={`${PRODUCT_NAME} — home`} className="shrink-0 lg:hidden">
                <img src={BRAND_ASSETS.icon32} alt="" className="size-7" />
              </Link>
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
                placeholder="Search research"
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
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {emblem ? <div className="shrink-0">{emblem}</div> : null}
              <div className="min-w-0">
                <h1 className="font-display text-xl font-semibold leading-tight">{title}</h1>
                {description ? (
                  <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
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
            className="atlas-section-nav flex gap-0.5 overflow-x-auto border-b border-border bg-surface py-1"
          >
            {context.map((item) => {
              const active = item.to === activeTab;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: true, includeSearch: false }}
                  activeProps={{}}
                  ref={active ? revealTab : undefined}
                  aria-current={ariaCurrent(pathname, item.to, active)}
                  className={`inline-flex min-h-9 shrink-0 items-center rounded-sm px-2 py-1 text-xs md:min-h-8 ${active ? "bg-muted font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {item.label}
                </Link>
              );
            })}
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
              {...primaryLinkState(pathname, item.to, section === item.id)}
              className="nav-link min-h-10 whitespace-nowrap !px-2 !text-xs"
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
