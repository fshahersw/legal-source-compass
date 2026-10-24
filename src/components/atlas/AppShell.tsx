import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  LogIn,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useCorpusAccessMode } from "@/components/auth/CorpusAccessGate";
import { signOutEverywhere } from "@/lib/auth/session";
import { useSessionUser } from "@/lib/auth/useSession";
import { useAtlas } from "@/lib/atlas/store";
import { reviewCounts } from "@/lib/atlas/review";
import { getSidebarCollapsed, setSidebarCollapsed } from "@/lib/atlas/ui";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/components/kit/PageHeader";
import { pageTabClass } from "@/components/kit/styles";
import { splitTabs } from "@/components/kit/tabs";
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
import { THEME_SCRIPT, applyTheme, readTheme, storeTheme, type Theme } from "./theme";

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

const railClass = (mode: ListMode) =>
  cn(
    mode === "rail" && "justify-center px-0",
    mode === "responsive" && "justify-center px-0 lg:justify-start lg:px-2.5",
  );
const railText = (mode: ListMode) =>
  cn(mode === "rail" && "sr-only", mode === "responsive" && "sr-only lg:not-sr-only");

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
            className={cn("nav-link relative min-h-9", railClass(mode))}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className={cn("min-w-0 flex-1 truncate", railText(mode))}>{item.label}</span>
            {badge > 0 && mode !== "rail" ? (
              <span
                className={cn(
                  "rounded-md bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-inset ring-border",
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
  const linkClass = cn("nav-link w-full", railClass(mode));
  const textClass = railText(mode);
  const tip = (label: string) => (mode === "full" ? undefined : label);
  if (!user)
    return (
      <Link to="/auth" className={linkClass} title={tip("Sign in")}>
        <LogIn className="size-4" aria-hidden />
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
            "truncate px-2.5 text-[11px] text-sidebar-muted",
            mode === "responsive" && "hidden lg:block",
          )}
          title={user.email ?? ""}
        >
          {user.email}
        </div>
      ) : null}
      <button type="button" onClick={signOut} className={linkClass} title={tip("Sign out")}>
        <LogOut className="size-4" aria-hidden />
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
    <form onSubmit={submit} role="search" className={cn("relative items-center", className)}>
      <button
        type="submit"
        aria-label="Search"
        className="absolute left-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search className="size-4" aria-hidden />
      </button>
      <Input
        aria-label="Search all corpus data"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search research"
        className="h-9 bg-muted/50 pl-8 text-[13px] shadow-none md:h-9"
      />
    </form>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const stored = readTheme();
    applyTheme(stored);
    setTheme(stored);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        applyTheme(next);
        storeTheme(next);
      }}
      aria-label={next === "dark" ? "Use dark theme" : "Use light theme"}
      title={next === "dark" ? "Dark theme" : "Light theme"}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {theme === "dark" ? (
        <Sun className="size-4" aria-hidden />
      ) : (
        <Moon className="size-4" aria-hidden />
      )}
    </button>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      to="/"
      className={cn(
        "flex min-w-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        !collapsed && "lg:justify-start lg:px-1",
      )}
      aria-label={`${PRODUCT_NAME} — home`}
    >
      <img
        src={BRAND_ASSETS.icon32}
        alt=""
        className={cn("size-7 rounded-md", !collapsed && "lg:hidden")}
      />
      {!collapsed ? (
        <span className="hidden min-w-0 lg:block">
          {/* the white wordmark, inked to near-black on the light sidebar */}
          <img
            src={BRAND_ASSETS.wordmarkWhite}
            alt="Seeger Weiss LLP"
            width={241}
            height={21}
            className="h-auto w-40 opacity-90 brightness-0 dark:opacity-100 dark:brightness-100"
          />
          <span className="mt-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-muted">
            {WORKSPACE_DESCRIPTOR}
          </span>
        </span>
      ) : null}
    </Link>
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
  const tabs = splitTabs(
    context.map((item) => ({ id: tabKey(item), item })),
    activeTab,
  );
  const mode: ListMode = collapsed ? "rail" : "responsive";
  return (
    <div
      data-ui-release="seeger-weiss-workspace-20261024"
      className="atlas-shell flex min-h-screen bg-background"
    >
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {/* the column carries the background and hairline for the full page height; the panel inside sticks */}
      <div
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-150 md:block",
          collapsed ? "w-16" : "w-16 lg:w-56",
        )}
      >
        <aside
          aria-label="Sections"
          className="sticky top-0 flex h-screen flex-col overflow-y-auto text-sidebar-foreground"
        >
          <div className="flex h-16 shrink-0 items-center px-3">
            <Brand collapsed={collapsed} />
          </div>
          <div className="flex flex-1 flex-col px-3 pb-3">
            <SectionLinks items={PRIMARY_NAVIGATION} label="Primary" mode={mode} {...listProps} />
            <div className="my-3 border-t border-sidebar-border" />
            <SectionLinks items={UTILITY_NAVIGATION} label="Utilities" mode={mode} {...listProps} />
            <div className="mt-auto border-t border-sidebar-border pt-3">
              <AccountBox mode={mode} />
            </div>
          </div>
        </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="atlas-topbar flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-[var(--workspace-gutter)]">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-expanded={drawer}
            aria-controls="atlas-drawer"
            aria-label="Open navigation"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
          <span className="mx-1 hidden h-5 w-px bg-border md:block" aria-hidden />
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1 p-0 text-[13px] text-muted-foreground">
              {trail.map((crumb, i) => {
                const last = i === trail.length - 1;
                return (
                  <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
                    {i > 0 ? (
                      <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
                    ) : null}
                    {crumb.to ? (
                      <Link
                        to={crumb.to}
                        {...(crumb.search ? { search: crumb.search as never } : {})}
                        className={cn(
                          "truncate rounded-sm hover:text-foreground",
                          last && "font-medium text-foreground",
                        )}
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        aria-current="page"
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
          <SearchForm className="hidden w-56 shrink-0 md:flex lg:w-72" />
          <ThemeToggle />
        </div>
        <div className="atlas-header border-b border-border bg-surface">
          <div
            className={cn(
              "mx-auto w-full max-w-[1440px] px-[var(--workspace-gutter)] pt-5",
              context.length ? "pb-0" : "pb-5",
            )}
          >
            <PageHeader title={title} description={description} actions={actions} emblem={emblem} />
            {context.length ? (
              <div className="mt-3 flex items-end gap-5">
                <nav
                  aria-label="Section"
                  className="atlas-section-nav flex min-w-0 items-end gap-5 overflow-x-auto"
                >
                  {tabs.visible.map(({ id: key, item }) => {
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
                        className={pageTabClass(active)}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
                {tabs.overflow.length ? (
                  <Popover>
                    <PopoverTrigger className={cn(pageTabClass(false), "gap-1")}>
                      More
                      <ChevronDown className="size-3.5" aria-hidden />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60 p-1">
                      <nav aria-label="More section pages" className="flex flex-col">
                        {tabs.overflow.map(({ id: key, item }) => (
                          <Link
                            key={key}
                            to={item.to}
                            {...(item.search ? { search: item.search as never } : {})}
                            className="rounded-md px-2.5 py-1.5 text-[13px] hover:bg-accent"
                          >
                            {item.label}
                          </Link>
                        ))}
                      </nav>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <main className="atlas-main mx-auto w-full max-w-[1440px]">
          {localStateWarning ||
          (persistWarning && persistWarning !== "Saving to browser storage…") ? (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-status-warning-ring bg-status-warning-soft px-3 py-2.5 text-xs leading-relaxed text-status-warning-ink"
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
          <div className="mb-3 flex h-12 items-center px-1">
            <Link to="/" className="block" aria-label={`${PRODUCT_NAME} — home`}>
              <img
                src={BRAND_ASSETS.wordmarkWhite}
                alt="Seeger Weiss LLP"
                width={241}
                height={21}
                className="h-auto w-40 opacity-90 brightness-0 dark:opacity-100 dark:brightness-100"
              />
            </Link>
          </div>
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
