import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type LegislationSection =
  "bills" | "members" | "committees" | "amendments" | "reports" | "nominations" | "gao";

const tab =
  "-mb-px inline-flex items-center whitespace-nowrap border-b-2 px-3 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring";

const TABS: { id: LegislationSection; to: string; label: string }[] = [
  { id: "bills", to: "/law/legislation", label: "Bills" },
  { id: "members", to: "/law/legislation/members", label: "Members of Congress" },
  { id: "committees", to: "/law/legislation/committees", label: "Committees" },
  { id: "amendments", to: "/law/legislation/amendments", label: "Amendments" },
  { id: "reports", to: "/law/legislation/reports", label: "Reports & hearings" },
  { id: "nominations", to: "/law/legislation/nominations", label: "Nominations & treaties" },
  { id: "gao", to: "/law/legislation/gao", label: "GAO decisions" },
];

/**
 * The parts of the Legislation section: bills (federal and state), members of Congress, congressional committees,
 * amendments, committee reports and hearings, nominations and treaties, and GAO (a legislative-branch agency) legal
 * decisions. Quiet underlined tabs that are real links, so each part has its own address and back/forward works.
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
    <nav
      aria-label="Legislation sections"
      className="mb-3 flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((t) => (
        <Link
          key={t.id}
          to={t.to as never}
          className={cls(active === t.id)}
          {...(active === t.id ? { "aria-current": "page" as const } : {})}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
