# Collapsible sidebar (collapse / expand toggle)

## What changes

The left sidebar becomes toggleable:

- **Expanded** — current layout (240px wide, brand, labeled nav, account box, privacy note).
- **Collapsed** — a narrow icon rail (56px): brand shrinks to a small monogram, nav shows icons only (with hover tooltips), the review/bookmark count becomes a small dot on Sources & Work, the account box shows the sign-in / sign-out icon only, and the privacy note is hidden.
- A **toggle button (panel-left icon)** lives in the page header, next to the breadcrumbs — always visible in both states, so the sidebar can always be brought back.
- The choice is **remembered in this browser** (localStorage), so the sidebar opens the way you left it.
- Smooth width transition when toggling.
- Mobile (<1024px) is unchanged — it keeps the existing horizontal nav strip.

## Implementation (technical)

Files touched:

1. `src/components/atlas/AppShell.tsx` — the only component involved.
   - Add `collapsed` state initialized from a small helper (`getSidebarCollapsed()` / `setSidebarCollapsed()` in `src/lib/atlas/ui.ts`) that reads/writes `localStorage` key `atlas:sidebar-collapsed`.
   - Read the stored value in `useEffect` (not in the state initializer) to avoid SSR/hydration mismatch.
   - Toggle button in the header: `PanelLeftClose` / `PanelLeftOpen` lucide icons, `aria-label` "Collapse sidebar" / "Expand sidebar", `aria-expanded` on the control.
   - Collapsed `<aside>`: `w-14` instead of `w-60`, with a CSS width transition; icons centered via the existing `nav-link` flex layout; text elements conditionally rendered; `title` attributes on icon-only links for tooltips; count badge degrades to a dot.
   - Collapsed brand: "LA" monogram block linking to `/`.
   - Collapsed account box: icon-only sign-in / sign-out button with `title`.
   - Keep the existing semantic tokens (`bg-sidebar`, `border-sidebar-border`, etc.) — no hardcoded colors.
2. `src/lib/atlas/ui.ts` (new) — tiny pure helpers for the persisted boolean, with a unit test (`ui.test.ts`) covering read/write/fallback when storage is unavailable.

## Verification

- Unit tests for the persistence helper; existing 120 tests still pass, typecheck clean.
- Browser check with Playwright: toggle collapses to the icon rail and back, tooltips present, the state survives a page reload, the active nav item stays highlighted when collapsed, no console errors.
