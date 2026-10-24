/**
 * Tab overflow rule for PageTabs (and the shell's section tabs): a page shows at most seven tabs (AGENTS.md). When
 * there are more, six are shown and the rest move into a "More" menu, which counts as the seventh slot. The active
 * tab is always visible: if it would fall into the menu it takes the last visible slot and the tab it displaces moves
 * into the menu, keeping the original order there. Pure and tested (tabs.test.ts).
 */

export const MAX_TABS = 7;

export function splitTabs<T extends { id: string }>(
  items: readonly T[],
  activeId?: string | null,
  max: number = MAX_TABS,
): { visible: T[]; overflow: T[] } {
  const limit = Math.max(2, Math.floor(Number.isFinite(max) ? max : MAX_TABS));
  if (items.length <= limit) return { visible: [...items], overflow: [] };
  const slots = limit - 1; // one slot is the "More" menu
  const activeIndex = activeId == null ? -1 : items.findIndex((t) => t.id === activeId);
  if (activeIndex < slots) return { visible: items.slice(0, slots), overflow: items.slice(slots) };
  const visible = [...items.slice(0, slots - 1), items[activeIndex]!];
  const overflow = items.filter((_, i) => i >= slots - 1 && i !== activeIndex);
  return { visible, overflow };
}
