/**
 * HeaderStrip: the one header of a page (adapted from the supplied tab-navbar). Two tiers inside one white band:
 *
 *   tier 1  [sidebar toggle] Breadcrumb ................ [search] [Ask AI] [theme]
 *   tier 2  Page title (H1) · one line of context ................ [primary action]
 *           Menu:  Courts   Judges   Caseload ▾   Compare ▾
 *
 * The menu (HeaderMenu) has at most four items, each a direct link or a dropdown panel. A panel is a short summary
 * tile (the group's title and one line) beside titled destinations with a one-line description each. The page being
 * shown is marked: `aria-current` on its link (and "true" on the trigger that holds it) with an ink label and a 2 px
 * rule. Radix gives the keyboard behaviour: arrow keys between items, Enter / Space opens a panel, ArrowDown moves
 * into it, Escape closes it and returns focus to its trigger. Below 768 px the menu is one button that opens a sheet
 * listing every destination.
 *
 *   <HeaderStrip title="Courts & judges" breadcrumbs={trail} menu={sectionMenu(path, search)}
 *     leading={…} search={…} askAi={…} trailing={…} actions={<Button size="sm">Export</Button>} />
 *
 * Menu items come from `sectionMenu()` in src/lib/atlas/navigation.ts (they carry `current` and `active`).
 */
import * as React from "react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { MenuItem, MenuLink } from "@/lib/atlas/navigation";
import { cn } from "@/lib/utils";
import { Breadcrumbs, PageHeader, type PageCrumb } from "./PageHeader";
import { panelOffset } from "./panelPlacement";

type GroupItem = Extract<MenuItem, { kind: "group" }>;

/**
 * The router link of a destination (path plus the query some destinations open with). It forwards its ref and every
 * prop it receives: Radix puts keyboard handling, `data-active` and a generic aria-current on the child of
 * NavigationMenuLink, and our own aria-current ("page" on the exact page, "true" inside it) wins over Radix's.
 * `exact` keeps the router from adding its own aria-current="page" to a parent route (/courts while on
 * /courts/vacancies); the router still marks the exact page, which agrees with `link.current`.
 */
const DestinationLink = React.forwardRef<
  HTMLAnchorElement,
  { link: MenuLink } & Omit<React.ComponentPropsWithoutRef<"a">, "href">
>(({ link, ...props }, ref) => (
  <Link
    ref={ref}
    to={link.to as never}
    {...(link.search ? { search: link.search as never } : {})}
    activeOptions={{ exact: true }}
    {...(props as Record<string, never>)}
    aria-current={link.current}
  />
));
DestinationLink.displayName = "DestinationLink";

/** A dropdown panel: the group's summary tile, then its destinations with a line each. */
function GroupPanel({ item }: { item: GroupItem }) {
  return (
    <div className="grid w-[min(31rem,calc(100vw-2.5rem))] grid-cols-[10.5rem_minmax(0,1fr)] gap-2 p-2">
      <div className="flex flex-col justify-end rounded-lg bg-muted/70 p-4">
        <p className="m-0 text-label text-foreground">{item.label}</p>
        <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">{item.description}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {item.items.map((link) => (
          <li key={link.key}>
            <NavigationMenuLink asChild active={link.current !== undefined}>
              <DestinationLink
                link={link}
                className="block rounded-lg px-3 py-2 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-accent"
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium leading-5 text-foreground">
                  {link.label}
                  {link.current ? (
                    <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                  ) : null}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-4 text-muted-foreground">
                  {link.description}
                </span>
              </DestinationLink>
            </NavigationMenuLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Below 768 px: one button (the current destination) that opens a sheet with every destination. */
function MobileMenu({
  items,
  label,
  title,
  always,
}: {
  items: readonly MenuItem[];
  label: string;
  title: string;
  /** Show the button at every width (the compact layout), not only below 768 px. */
  always: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const current =
    items.flatMap((i) => (i.kind === "group" ? i.items : [i])).find((l) => l.current)?.label ??
    items[0]?.label ??
    label;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(
          "inline-flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-foreground shadow-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
          !always && "md:hidden",
        )}
        aria-label={`${label}: ${current}`}
      >
        <span className="truncate">{current}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl border-border p-0 pb-4"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-popover px-5 py-4 pr-12">
          <SheetTitle className="text-heading">{title}</SheetTitle>
          <SheetDescription className="sr-only">Every page in this section.</SheetDescription>
        </div>
        <nav aria-label={title} className="px-3 pt-2">
          <ul className="m-0 list-none p-0">
            {items.map((item) =>
              item.kind === "link" ? (
                <li key={item.key}>
                  <MobileLink link={item} onNavigate={close} />
                </li>
              ) : (
                <li key={item.key} className="pt-2">
                  <p className="m-0 px-3 pb-1 pt-2 text-meta font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                  <ul className="m-0 list-none p-0">
                    {item.items.map((link) => (
                      <li key={link.key}>
                        <MobileLink link={link} onNavigate={close} />
                      </li>
                    ))}
                  </ul>
                </li>
              ),
            )}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function MobileLink({ link, onNavigate }: { link: MenuLink; onNavigate: () => void }) {
  return (
    <DestinationLink
      link={link}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
        link.current && "bg-accent",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-5 text-foreground">
          {link.label}
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
          {link.description}
        </span>
      </span>
      {link.current ? (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      )}
    </DestinationLink>
  );
}

/** Widest a panel gets (31 rem) and the space kept between a panel and the window edge. */
const PANEL_REM = 31;
const PANEL_BORDER = 2;
const EDGE = 16;

/**
 * The section menu: dropdown navigation from 768 px, a sheet button below (or always, when `compact`). At most four
 * items. A panel opens under its trigger, left-aligned with it; when that would run past the window it slides left
 * just enough to stay 16 px inside (computed when it opens and on resize).
 */
export function HeaderMenu({
  items,
  label = "Section",
  title,
  defaultOpen,
  compact = false,
  className,
}: {
  items: readonly MenuItem[];
  /** Accessible name of the menu. */
  label?: string | undefined;
  /** Title of the mobile sheet (the section's name); defaults to `label`. */
  title?: string | undefined;
  /** Key of a panel to show open on first render (the kit gallery). */
  defaultOpen?: string | undefined;
  /** Always the one-button layout, whatever the width (the kit gallery's phone specimen). */
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  const [value, setValue] = useState(defaultOpen ?? "");
  const [shift, setShift] = useState<Record<string, number>>({});
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useLayoutEffect(() => {
    const item = value ? itemRefs.current.get(value) : undefined;
    if (!item) return;
    const place = () => {
      const win = document.documentElement.clientWidth;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = Math.min(PANEL_REM * rem, win - 2.5 * rem) + PANEL_BORDER;
      const offset = panelOffset({
        triggerLeft: item.getBoundingClientRect().left,
        windowWidth: win,
        panelWidth: width,
        edge: EDGE,
      });
      setShift((prev) => (prev[value] === offset ? prev : { ...prev, [value]: offset }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [value]);

  if (!items.length) return null;
  return (
    <div className={cn("min-w-0", className)}>
      {compact ? null : (
        <NavigationMenu
          viewport={false}
          aria-label={label}
          value={value}
          onValueChange={setValue}
          className="hidden max-w-none justify-start md:flex"
        >
          <NavigationMenuList className="-ml-3 justify-start gap-0.5">
            {items.map((item) =>
              item.kind === "link" ? (
                <NavigationMenuItem key={item.key}>
                  <NavigationMenuLink asChild active={item.current !== undefined}>
                    <DestinationLink link={item} className={navigationMenuTriggerStyle()}>
                      {item.label}
                    </DestinationLink>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ) : (
                <NavigationMenuItem
                  key={item.key}
                  value={item.key}
                  className="relative"
                  ref={(node: HTMLLIElement | null) => {
                    if (node) itemRefs.current.set(item.key, node);
                    else itemRefs.current.delete(item.key);
                  }}
                >
                  <NavigationMenuTrigger
                    {...(item.active ? { "data-active": "", "aria-current": "true" as const } : {})}
                  >
                    {item.label}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent
                    {...(shift[item.key] ? { style: { left: shift[item.key] } } : {})}
                  >
                    <GroupPanel item={item} />
                  </NavigationMenuContent>
                </NavigationMenuItem>
              ),
            )}
          </NavigationMenuList>
        </NavigationMenu>
      )}
      <MobileMenu items={items} label={label} title={title ?? label} always={compact} />
    </div>
  );
}

/** The two-tier header band; compose every page's header from this (the app shell does). */
export function HeaderStrip({
  title,
  description,
  breadcrumbs,
  menu,
  menuLabel = "Section",
  menuTitle,
  titleAs,
  compact = false,
  actions,
  emblem,
  leading,
  search,
  askAi,
  trailing,
  defaultOpenMenu,
  backdrop,
  className,
}: {
  title: ReactNode;
  /** One line of context; omit it when it only restates the title. */
  description?: ReactNode | undefined;
  breadcrumbs: readonly PageCrumb[];
  /** From sectionMenu(); empty or absent for a page without a menu. */
  menu?: readonly MenuItem[] | undefined;
  menuLabel?: string | undefined;
  /** Title of the phone sheet: the section's name. */
  menuTitle?: string | undefined;
  /** "h1" for a page; a specimen shown beside others uses "h2". */
  titleAs?: "h1" | "h2" | undefined;
  /** Phone layout at any width: one menu button, no hidden search (the kit gallery's phone specimen). */
  compact?: boolean | undefined;
  /** The page's one primary action(s), right of the title. */
  actions?: ReactNode | undefined;
  emblem?: ReactNode | undefined;
  /** Left of the breadcrumb: the sidebar toggle buttons. */
  leading?: ReactNode | undefined;
  /** The global search (give it its own responsive classes). */
  search?: ReactNode | undefined;
  /** The Ask AI trigger. */
  askAi?: ReactNode | undefined;
  /** Far right: theme toggle, mobile search. */
  trailing?: ReactNode | undefined;
  defaultOpenMenu?: string | undefined;
  /** Decorative section photo behind the title band (no alt text; it carries no information). */
  backdrop?: string | undefined;
  className?: string | undefined;
}) {
  const hasMenu = Boolean(menu?.length);
  return (
    <header
      data-slot="header-strip"
      className={cn("relative z-30 border-b border-border bg-surface", className)}
    >
      <div className="border-b border-border/70">
        <div className="mx-auto flex h-12 w-full max-w-[1440px] items-center gap-2 px-[var(--workspace-gutter)]">
          {leading}
          <Breadcrumbs items={breadcrumbs} className="min-w-0 flex-1" />
          {search}
          {askAi}
          {trailing}
        </div>
      </div>
      <div className="relative">
      {backdrop ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <img src={backdrop} alt="" width={1920} height={640} className="absolute inset-y-0 right-0 h-full w-full object-cover object-right opacity-90" />
          <div className="header-backdrop-fade absolute inset-0" />
        </div>
      ) : null}
      <div
        className={cn(
          "relative mx-auto w-full max-w-[1440px] px-[var(--workspace-gutter)]",
          backdrop ? "pt-7 md:pt-9" : "pt-4",
          hasMenu ? "pb-0" : backdrop ? "pb-7 md:pb-9" : "pb-4",
        )}
      >
        <PageHeader
          title={title}
          titleAs={titleAs}
          description={description}
          actions={actions}
          emblem={emblem}
          tabs={
            hasMenu ? (
              <HeaderMenu
                items={menu!}
                label={menuLabel}
                title={menuTitle}
                defaultOpen={defaultOpenMenu}
                compact={compact}
              />
            ) : undefined
          }
          tabsClassName={backdrop ? "mt-5" : "mt-3"}
        />
      </div>
      </div>
    </header>
  );
}
