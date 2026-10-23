import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useCorpusAccessMode } from "@/components/auth/CorpusAccessGate";
import { signOutEverywhere } from "@/lib/auth/session";
import { useSessionUser } from "@/lib/auth/useSession";
import { useAtlas } from "@/lib/atlas/store";
import { reviewCounts } from "@/lib/atlas/review";
import { getSidebarCollapsed, setSidebarCollapsed } from "@/lib/atlas/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { BRAND_ASSETS, PRODUCT_NAME, WORKSPACE_DESCRIPTOR } from "@/lib/branding";
import { cn } from "@/lib/utils";
import {
  PRIMARY_NAVIGATION,
  UTILITY_NAVIGATION,
  activeContextualPath,
  ariaCurrent,
  composeBreadcrumbs,
  contextualNavigation,
  navigationSection,
  tabKey,
  type Crumb,
  type NavigationItem,
  type NavigationSection,
  type SearchParams,
} from "@/lib/atlas/navigation";
import { SECTION_ICONS } from "./sectionIcons";

/** Scrolls the tab strip (never the page) so the active tab is in view when the strip overflows. */
function revealTab(el: HTMLElement | null) {
  const strip = el?.parentElement;
  if (!el || !strip) return;
  const tab = el.getBoundingClientRect();
  const box = strip.getBoundingClientRect();
  if (tab.left < box.left) strip.scrollLeft -= box.left - tab.left + 8;
  else if (tab.right > box.right) strip.scrollLeft += tab.right - box.right + 8;
}

/**
 * How a section list is laid out: "rail" shows icons only (labels stay the accessible name), "full" shows labels,
 * "responsive" is the sidebar: an icon rail from 768 px and full labels from 1024 px.
 */
type ListMode = "rail" | "full" | "responsive";

function SectionLinks({
  items,
  label,
  pathname,
  search,
  section,
  mode,
  badges,
  onNavigate,
}: {
  items: readonly NavigationItem[];
  label: string;
  pathname: string;
  search: SearchParams;
  section: NavigationSection | null;
  mode: ListMode;
  badges?: Partial<Record<NavigationSection, number>>;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = section === item.id;
        const Icon = SECTION_ICONS[item.id];
        const badge = badges?.[item.id] ?? 0;
        return (
          <Link
            key={item.id}
            to={item.to}
            // Active state is decided by navigationSection() alone. The router's own matching only marks the exact page
            // (path and query), which is always inside this section; data-status drives the nav-link active style.
            activeOptions={{ exact: true, includeSearch: true }}
            activeProps={{}}
            aria-current={ariaCurrent(pathname, item.to, active, search)}
            data-status={active ? "active" : undefined}
            title={mode === "full" ? undefined : item.label}
            onClick={onNavigate}
            className={cn(
              "nav-link relative min-h-9",
              active && "bg-sidebar-accent font-semibold",
              mode === "rail" && "justify-center px-0",
              mode === "responsive" && "justify-center px-0 lg:justify-start lg:px-[0.55rem]",
            )}
          >
            <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.7} aria-hidden />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                mode === "rail" && "sr-only",
                mode === "responsive" && "sr-only lg:not-sr-only",
              )}
            >
              {item.label}
            </span>
            {badge > 0 && mode !== "rail" ? (
              <span
                className={cn(
                  "rounded bg-sidebar/70 px-1.5 text-[10px] text-sidebar-foreground",
                  mode === "responsive" && "hidden lg:inline",
                )}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Sign-in state; `mode` follows the section list it sits under. */
function AccountBox({ mode }: { mode: ListMode }) {
  const { user, ready } = useSessionUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accessMode = useCorpusAccessMode();
  if (!ready) return null;
  const linkClass = cn(
    "nav-link w-full",
    mode === "rail" && "justify-center px-0",
    mode === "responsive" && "justify-center px-0 lg:justify-start lg:px-[0.55rem]",
  );
  const textClass = cn(
    mode === "rail" && "sr-only",
    mode === "responsive" && "sr-only lg:not-sr-only",
  );
  const tip = (label: string) => (mode === "full" ? undefined : label);
  if (!user)
    return (
      <Link to="/auth" className={linkClass} title={tip("Sign in")}>
        <LogIn className="size-4 opacity-70" aria-hidden />
        <span className={textClass}>Sign in</span>
      </Link>
    );
  async function signOut() {
    await queryClient.cancelQueries();
    await signOutEverywhere();
    if (accessMode === "enforced") void navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="space-y-1">
      {mode !== "rail" ? (
        <div
          className={cn(
            "truncate px-2 text-[11px] text-sidebar-foreground/75",
            mode === "responsive" && "hidden lg:block",
          )}
          title={user.email ?? ""}
        >
          {user.email}
        </div>
      ) : null}
      <button type="button" onClick={signOut} className={linkClass} title={tip("Sign out")}>
        <LogOut className="size-4 opacity-70" aria-hidden />
        <span className={textClass}>Sign out</span>
      </button>
    </div>
  );
}

function SearchForm({ className, onDone }: { className?: string; onDone?: () => void }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    if (q.length < 2) return;
    onDone?.();
    void navigate({ to: "/search", search: { q } });
  }
  return (
    <form onSubmit={submit} role="search" className={cn("items-center gap-1", className)}>
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
  breadcrumbs: Crumb[];
  title: string;
  description?: string;
  actions?: ReactNode;
  emblem?: ReactNode;
  children: ReactNode;
}) {
  const { overlays, bookmarks, localStateWarning, persistWarning } = useAtlas();
  const counts = reviewCounts(overlays);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as SearchParams;
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    setCollapsed(getSidebarCollapsed());
  }, []);
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    setSidebarCollapsed(next);
  };
  const section = navigationSection(pathname, search);
  const context = contextualNavigation(pathname, search);
  const activeTab = activeContextualPath(pathname, search);
  const trail = composeBreadcrumbs(pathname, search, breadcrumbs);
  const badges = { saved: counts.total + Object.keys(bookmarks).length };
  const listProps = { pathname, search, section, badges };
  return (
    <div
      data-ui-release="seeger-weiss-workspace-20261012"
      className="atlas-shell flex min-h-screen bg-background"
    >
      <aside
        aria-label="Sections"
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-2 py-4 transition-[width] duration-150 md:flex",
          collapsed ? "w-14" : "w-14 lg:w-52 lg:px-2.5",
        )}
      >
        <Link
          to="/"
          className={cn("mb-4 flex justify-center", !collapsed && "lg:block lg:px-1.5 lg:py-1")}
          aria-label={`${PRODUCT_NAME} — home`}
        >
          <img
            src={BRAND_ASSETS.icon32}
            alt=""
            className={cn("size-7", !collapsed && "lg:hidden")}
          />
          {!collapsed ? (
            <span className="hidden lg:block">
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
            </span>
          ) : null}
        </Link>
        <SectionLinks
          items={PRIMARY_NAVIGATION}
          label="Primary"
          mode={collapsed ? "rail" : "responsive"}
          {...listProps}
        />
        <div className="my-3 border-t border-sidebar-border" />
        <SectionLinks
          items={UTILITY_NAVIGATION}
          label="Utilities"
          mode={collapsed ? "rail" : "responsive"}
          {...listProps}
        />
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <AccountBox mode={collapsed ? "rail" : "responsive"} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="atlas-header border-b border-border bg-surface py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawer(true)}
                aria-expanded={drawer}
                aria-controls="atlas-drawer"
                aria-label="Open navigation"
                className="inline-flex shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted md:hidden"
              >
                <Menu className="size-4" />
              </button>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted lg:inline-flex"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
              <nav aria-label="Breadcrumb" className="min-w-0">
                <ol className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {trail.map((crumb, i) => (
                    <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                      {i > 0 ? (
                        <span aria-hidden className="opacity-50">
                          ›
                        </span>
                      ) : null}
                      {crumb.to ? (
                        <Link
                          to={crumb.to}
                          {...(crumb.search ? { search: crumb.search as never } : {})}
                          className="truncate hover:text-foreground hover:underline"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span aria-current="page" className="truncate">
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
            <SearchForm className="hidden w-64 shrink-0 md:flex" />
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
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </header>
        {context.length ? (
          <nav
            aria-label="Section"
            className="atlas-section-nav flex gap-0.5 overflow-x-auto border-b border-border bg-surface py-1"
          >
            {context.map((item) => {
              const key = tabKey(item);
              const active = key === activeTab;
              return (
                <Link
                  key={key}
                  to={item.to}
                  {...(item.search ? { search: item.search as never } : {})}
                  activeOptions={{ exact: true, includeSearch: true }}
                  activeProps={{}}
                  ref={active ? revealTab : undefined}
                  aria-current={ariaCurrent(pathname, item.to, active, search, item.search)}
                  className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-sm px-2 py-1 text-xs md:min-h-8 ${active ? "bg-muted font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
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
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent
          id="atlas-drawer"
          side="left"
          className="atlas-shell flex w-72 max-w-[85vw] flex-col gap-0 overflow-y-auto border-sidebar-border !bg-sidebar p-3 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            The nine sections, sources, saved work and search.
          </SheetDescription>
          <Link to="/" className="mb-3 block px-1.5 py-1" aria-label={`${PRODUCT_NAME} — home`}>
            <img
              src={BRAND_ASSETS.wordmarkWhite}
              alt="Seeger Weiss LLP"
              width={241}
              height={21}
              className="h-auto w-44"
            />
          </Link>
          <SearchForm className="mb-3 flex" onDone={() => setDrawer(false)} />
          <SectionLinks
            items={PRIMARY_NAVIGATION}
            label="Primary sections"
            mode="full"
            onNavigate={() => setDrawer(false)}
            {...listProps}
          />
          <div className="my-3 border-t border-sidebar-border" />
          <SectionLinks
            items={UTILITY_NAVIGATION}
            label="Utility sections"
            mode="full"
            onNavigate={() => setDrawer(false)}
            {...listProps}
          />
          <div className="mt-auto border-t border-sidebar-border pt-3">
            <AccountBox mode="full" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
