import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import type { AgencyProfile } from "@/lib/external/agencyProfile.functions";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { AgencyEmblem } from "@/components/visuals/AgencyEmblem";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { Button } from "@/components/ui/button";
import { agencyOrganization, officialOrganizationReference } from "./organization";

export function AgencyOrganization({ profile }: { profile: AgencyProfile }) {
  const { parent, current, children } = agencyOrganization(profile);
  const reference = officialOrganizationReference(profile.name);
  return (
    <section aria-label={`${profile.name} organization`} className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-label font-semibold">Organization</h4>
        <InfoPopover label="Organization sources and scope">
          <p>Parent and components follow the Federal Register's recorded agency relationships. This is a directory hierarchy, not an internal reporting chart; unlisted offices are not assumed absent.</p>
          <a href={profile.frUrl} target="_blank" rel="noreferrer">Agency directory record</a>
          {reference ? <><p>Official charts may be dated snapshots; check the date printed on each chart.</p><a href={reference.url} target="_blank" rel="noreferrer">{reference.label}</a></> : null}
        </InfoPopover>
      </div>
      {parent ? <>
        <Link to="/agencies/$id" params={{ id: String(parent.id) }} className="flex items-center gap-3 rounded-md border border-border-strong bg-secondary px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-ring">
          <AgencyMark name={parent.name} />
          <span className="min-w-0 flex-1"><span className="block text-meta text-muted-foreground">Parent agency</span><span className="font-medium">{parent.name}</span></span>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
        </Link>
        <div className="flex justify-center text-brand" aria-hidden><ArrowDown className="size-5" /></div>
      </> : null}
      <div className="flex items-center gap-3 rounded-md border border-brand bg-brand px-3 py-3 text-brand-foreground">
        <AgencyEmblem agencyId={String(current.id)} name={current.name} />
        <span className="min-w-0 text-label font-semibold">{current.name}</span>
      </div>
      {children.length ? <>
        <div className="flex justify-center text-brand" aria-hidden><ArrowDown className="size-5" /></div>
        <p className="text-meta text-muted-foreground">{children.length} listed components</p>
        <ul className="grid gap-2 border-l-2 border-status-info-ring pl-3 sm:grid-cols-2">
          {children.map((child) => <li key={child.id} className="min-w-0">
            <Link to="/agencies/$id" params={{ id: String(child.id) }} className="flex h-full items-center gap-2 rounded-md border border-status-info-ring bg-status-info-soft p-2 text-body text-status-info-ink focus-visible:outline-2 focus-visible:outline-ring">
              <AgencyMark name={child.name} />
              <span className="min-w-0 flex-1">{child.name}</span>
              <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
            </Link>
          </li>)}
        </ul>
      </> : <p className="text-meta text-muted-foreground">Internal office relationships: Not recorded.</p>}
      {reference ? <Button asChild variant="outline" size="sm"><a href={reference.url} target="_blank" rel="noreferrer">{reference.label}<ArrowUpRight className="size-3.5" /></a></Button> : null}
    </section>
  );
}