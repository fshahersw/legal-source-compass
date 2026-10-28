/**
 * "Say it once" for section landings: a hub link that leads to a destination already in the section's header menu
 * repeats that menu entry, so the landing leaves it out. Links into another section (`elsewhere`) and links the menu
 * does not carry (e.g. a map layer) stay. Pure.
 */
import {
  menuLinks,
  sectionItem,
  sectionMenu,
  tabKey,
  type PrimarySection,
} from "@/lib/atlas/navigation";
import type { HubLink } from "./hubs";

export function linksNotInHeader(section: PrimarySection, links: readonly HubLink[]): HubLink[] {
  const header = new Set(menuLinks(sectionMenu(sectionItem(section).to)).map((l) => l.key));
  return links.filter(
    (l) =>
      l.elsewhere != null ||
      !header.has(
        tabKey(
          l.search ? { to: l.to, label: l.label, search: l.search } : { to: l.to, label: l.label },
        ),
      ),
  );
}
