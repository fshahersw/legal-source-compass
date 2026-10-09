import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Building2, Clock3, FileText, LibraryBig, Scale } from "lucide-react";
import { AgencyMark, StateMark } from "./EntityArtwork";
import { STATES } from "@/lib/corpus/geo";

const federal = [
  {
    group: "statutes",
    title: "Federal statutes",
    description: "United States Code and statutory materials",
    icon: LibraryBig,
  },
  {
    group: "regulations",
    title: "Federal regulations",
    description: "Codified agency rules and regulations",
    icon: Scale,
  },
  {
    group: "register",
    title: "Federal Register",
    description: "Published rules, notices and proposals",
    icon: FileText,
  },
  {
    group: "notices",
    title: "Agency notices",
    description: "Administrative notices and actions",
    icon: Building2,
  },
];
const agencies = [
  { name: "Food and Drug Administration", short: "FDA", subject: "Food, drugs & devices" },
  { name: "Environmental Protection Agency", short: "EPA", subject: "Environmental rules" },
  { name: "Securities and Exchange Commission", short: "SEC", subject: "Securities & markets" },
  { name: "Consumer Product Safety Commission", short: "CPSC", subject: "Consumer safety" },
  { name: "Federal Trade Commission", short: "FTC", subject: "Consumer protection" },
  { name: "Labor Department", short: "Labor", subject: "Workplace regulation" },
  { name: "Justice Department", short: "Justice", subject: "Federal legal resources" },
  { name: "Transportation Department", short: "Transport", subject: "Transportation rules" },
];
export function LawLanding() {
  return (
    <div className="space-y-4">
      <section className="resource-panel" aria-label="Browse legal authorities">
        <div className="research-band">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="size-4" />
            Law & regulation
          </h2>
          <Link
            to="/law"
            search={{ view: "list" }}
            className="text-xs text-[var(--navy-muted)] hover:text-white hover:underline"
          >
            All collections →
          </Link>
        </div>
        <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
          {federal.map(({ group, title, description, icon: Icon }) => (
            <Link
              key={group}
              to="/law"
              search={{ scope: "federal", group }}
              className="group flex min-h-24 items-center gap-3 bg-surface p-4 transition-colors hover:bg-[var(--blue-tint)]"
            >
              <span className="resource-icon !size-10">
                <Icon className="size-5" strokeWidth={1.65} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {description}
                </span>
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </Link>
          ))}
          <Link
            to="/law/codes"
            search={{ q: "" }}
            className="flex min-h-24 items-center gap-3 bg-surface p-4 hover:bg-[var(--blue-tint)]"
          >
            <span className="resource-icon !size-10">
              <BookOpen className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">State statutes</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Read titles, chapters and sections
              </span>
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </Link>
          <Link
            to="/limitations"
            className="flex min-h-24 items-center gap-3 bg-surface p-4 hover:bg-[var(--blue-tint)]"
          >
            <span className="resource-icon !size-10">
              <Clock3 className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Deadline assessment</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Cited rules and case-specific exceptions
              </span>
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </Link>
        </div>
      </section>
      <section className="resource-panel" aria-label="Agency shortcuts">
        <div className="research-band">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4" />
            Regulatory agencies
          </h2>
          <Link
            to="/agencies"
            className="text-xs text-[var(--navy-muted)] hover:text-white hover:underline"
          >
            All agencies →
          </Link>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {agencies.map((a) => (
            <Link
              key={a.name}
              to="/agencies"
              search={{ q: a.name }}
              className="flex items-center gap-3 bg-surface px-3 py-3 transition-colors hover:bg-[var(--blue-tint)]"
            >
              <AgencyMark name={a.name} className="!size-10 !rounded-md !p-1.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{a.short}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {a.subject}
                </span>
              </span>
              <ArrowRight className="size-3 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>
      <section className="resource-panel" aria-label="State law shortcuts">
        <div className="research-band">
          <h2 className="text-sm font-semibold">State law & court rules</h2>
          <Link
            to="/"
            className="text-xs text-[var(--navy-muted)] hover:text-white hover:underline"
          >
            Open map →
          </Link>
        </div>
        <div className="grid gap-px bg-border/60 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {[...STATES]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((state) => (
              <Link
                key={state.usps}
                to="/places/$state"
                params={{ state: state.usps }}
                search={{ tab: "sources" }}
                className="flex min-h-11 items-center gap-2 bg-surface px-2.5 py-1.5 text-[12px] font-medium hover:bg-[var(--blue-tint)]"
              >
                <StateMark state={state.usps} className="!size-7 !rounded-md !p-1" />
                <span className="min-w-0 truncate">{state.name}</span>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
