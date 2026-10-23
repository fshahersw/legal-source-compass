import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, FileText, LibraryBig, MapPinned, Scale } from "lucide-react";
import { AgencyMark, StateMark } from "./EntityArtwork";
import { STATES } from "@/lib/corpus/geo";
import type { DatasetInfo } from "@/lib/external/catalog.functions";
import { parseAgencyOptions } from "@/lib/external/agencyTree";
import { lawGroup } from "@/lib/external/lawTree";
import { datasetDisplayName } from "@/lib/external/domainRegistry";

const federal = [
  {
    group: "statutes",
    title: "Federal statutes",
    description: "Federal statutory materials",
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

/**
 * Federal record sets on Law & government › Federal law: one card per law group, opening the group's only available
 * collection directly when exactly one is recorded, the group otherwise, and the agency directory for notices when
 * no notice collection exists.
 */
export function FederalLawCollections({ datasets = [] }: { datasets?: readonly DatasetInfo[] }) {
  const other = datasets.filter((d) => lawGroup(d.id) === "other").length;
  return (
    <section className="resource-panel" aria-label="Federal record sets">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <LibraryBig className="size-4" aria-hidden />
          Federal record sets
        </h2>
        <Link
          to="/law"
          search={{ view: "list" }}
          className="text-xs text-[var(--navy-muted)] hover:text-white hover:underline"
        >
          All collections →
        </Link>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-4">
        {federal.map(({ group, title, description, icon: Icon }) => {
          const available = datasets.filter(
            (dataset) => lawGroup(dataset.id) === group && dataset.ready === true,
          );
          const destination = available.length === 1 ? available[0] : undefined;
          const browseAgencies = group === "notices" && available.length === 0;
          return (
            <Link
              key={group}
              {...(browseAgencies
                ? { to: "/agencies" as const, search: { q: "" } }
                : {
                    to: "/law" as const,
                    search: {
                      scope: "federal",
                      group,
                      ...(destination ? { ds: destination.id } : {}),
                    },
                  })}
              aria-label={browseAgencies ? "Browse agencies for published notices" : title}
              className="group flex min-h-24 items-center gap-3 bg-surface p-4 transition-colors hover:bg-[var(--blue-tint)]"
            >
              <span className="resource-icon !size-10">
                <Icon className="size-5" strokeWidth={1.65} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {destination
                    ? datasetDisplayName(destination.id, destination.label)
                    : description}
                </span>
                <span className="mt-1 block text-[11px] text-primary">
                  {browseAgencies
                    ? "Browse agencies"
                    : destination
                      ? "Open collection"
                      : "Browse collections"}
                </span>
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
            </Link>
          );
        })}
      </div>
      {other ? (
        <p className="m-0 border-t border-border bg-surface px-4 py-2 text-xs text-muted-foreground">
          Other federal collections ({other}):{" "}
          <Link
            to="/law"
            search={{ scope: "federal", group: "other" }}
            className="text-primary underline"
          >
            browse
          </Link>
        </p>
      ) : null}
    </section>
  );
}

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

/**
 * The lower part of the Law & government overview: agency shortcuts and a way into each state's law. The sub-areas
 * themselves (federal law, state law, legislation, rulemaking, time limits, agencies) are the section hub above it.
 */
export function LawLanding({
  datasets = [],
  metadataState = "ready",
  onRetry,
}: {
  datasets?: readonly DatasetInfo[];
  metadataState?: "loading" | "error" | "ready";
  onRetry?: () => void;
}) {
  const recordedAgencies = parseAgencyOptions(
    datasets
      .find((dataset) => dataset.id === "federal_register_history")
      ?.filters.find((filter) => filter.name === "agency")?.options ?? [],
  );
  return (
    <div className="space-y-4">
      {metadataState === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading agency shortcuts…</p>
      ) : metadataState === "error" ? (
        <p role="alert" className="text-xs text-muted-foreground">
          Shortcut metadata could not be refreshed. Browse links remain available.{" "}
          <button type="button" onClick={onRetry} className="text-primary underline">
            Retry shortcut metadata
          </button>
        </p>
      ) : null}
      <section className="resource-panel" aria-label="Agency shortcuts">
        <div className="research-band">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4" aria-hidden />
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
          {agencies.map((a) => {
            const matches = recordedAgencies.filter((agency) => agency.name === a.name);
            const agency = matches.length === 1 ? matches[0] : undefined;
            return (
              <Link
                key={a.name}
                {...(agency
                  ? { to: "/agencies/$id" as const, params: { id: agency.id } }
                  : { to: "/agencies" as const, search: { q: a.name } })}
                aria-label={
                  agency ? `Open ${agency.name}` : `Browse agency directory for ${a.name}`
                }
                className="flex items-center gap-3 bg-surface px-3 py-3 transition-colors hover:bg-[var(--blue-tint)]"
              >
                <AgencyMark name={a.name} className="!size-10 !rounded-md !p-1.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{a.short}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {agency ? a.subject : "Browse agency directory"}
                  </span>
                </span>
                <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
              </Link>
            );
          })}
        </div>
      </section>
      <section className="resource-panel" aria-label="State law shortcuts">
        <div className="research-band">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MapPinned className="size-4" aria-hidden />
            Law by state
          </h2>
          <Link
            to="/law"
            search={{ scope: "states" }}
            className="text-xs text-[var(--navy-muted)] hover:text-white hover:underline"
          >
            State law →
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
      <p className="m-0 text-xs text-muted-foreground">
        Every law collection in one list:{" "}
        <Link to="/law" search={{ view: "list" }} className="text-primary underline">
          all law collections
        </Link>
        .
      </p>
    </div>
  );
}
