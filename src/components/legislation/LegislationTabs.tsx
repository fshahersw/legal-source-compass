import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type LegislationSection = "bills" | "members" | "committees";

const tab =
  "-mb-px inline-flex items-center border-b-2 px-3 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The three parts of the Legislation section: bills (federal and state), members of Congress and congressional
 * committees. Quiet underlined tabs that are real links, so each part has its own address and back/forward works.
 */
export function LegislationTabs({ active }: { active: LegislationSection }) {
  const cls = (on: boolean) =>
    cn(
      tab,
      on
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );
  return (
    <nav aria-label="Legislation sections" className="mb-3 flex gap-1 border-b border-border">
      <Link
        to="/law/legislation"
        className={cls(active === "bills")}
        {...(active === "bills" ? { "aria-current": "page" as const } : {})}
      >
        Bills
      </Link>
      <Link
        to="/law/legislation/members"
        className={cls(active === "members")}
        {...(active === "members" ? { "aria-current": "page" as const } : {})}
      >
        Members of Congress
      </Link>
      <Link
        to="/law/legislation/committees"
        className={cls(active === "committees")}
        {...(active === "committees" ? { "aria-current": "page" as const } : {})}
      >
        Committees
      </Link>
    </nav>
  );
}
