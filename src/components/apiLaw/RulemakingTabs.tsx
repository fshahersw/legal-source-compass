import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type RulemakingSection = "activity" | "dockets" | "documents";

const tab =
  "-mb-px inline-flex items-center border-b-2 px-3 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The parts of Law & government › Rulemaking: Federal Register activity by agency, Regulations.gov dockets and comment
 * counts, and Regulations.gov documents. Quiet underlined tabs that are real links (own address, back/forward works).
 */
export function RulemakingTabs({ active }: { active: RulemakingSection }) {
  const cls = (on: boolean) =>
    cn(
      tab,
      on
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );
  const current = (on: boolean) => (on ? { "aria-current": "page" as const } : {});
  return (
    <nav
      aria-label="Rulemaking sections"
      className="mb-3 flex flex-wrap gap-1 border-b border-border"
    >
      <Link
        to="/law/rulemaking"
        className={cls(active === "activity")}
        {...current(active === "activity")}
      >
        Federal Register activity
      </Link>
      <Link
        to={"/law/rulemaking/dockets" as never}
        className={cls(active === "dockets")}
        {...current(active === "dockets")}
      >
        Dockets &amp; comments
      </Link>
      <Link
        to={"/law/rulemaking/documents" as never}
        className={cls(active === "documents")}
        {...current(active === "documents")}
      >
        Regulations.gov documents
      </Link>
    </nav>
  );
}
