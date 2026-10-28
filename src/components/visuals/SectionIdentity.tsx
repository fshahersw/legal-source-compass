import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpen, Landmark, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { courtBuildingsQuery, stateCapitolQuery } from "./queries";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { OpenImageCredit } from "./ImageCredit";
import { cn } from "@/lib/utils";

/** Exact-bound registry imagery only; a missing photograph leaves a labelled topic icon. */
export function SectionIdentity({ id, title, note, state, courtId }: {
  id: string; title: string; note?: ReactNode; state: string; courtId?: string | undefined;
}) {
  const court = useQuery({ ...courtBuildingsQuery(courtId ?? ""), enabled: id === "courts" && !!courtId });
  const capitol = useQuery({ ...stateCapitolQuery(state), enabled: id === "law" });
  const building = court.data?.buildings[0];
  const photo = id === "courts" ? building?.photo : id === "law" ? capitol.data : null;
  const [failed, setFailed] = useState<string | null>(null);
  const Icon: LucideIcon = id === "courts" ? Landmark : id === "law" ? BookOpen : BarChart3;
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-border pb-3">
      {photo && failed !== photo.display.url ? <img src={photo.thumb.url} alt={id === "courts" ? building?.building ?? "Recorded courthouse" : capitol.data?.building ?? "Recorded state capitol"} loading="lazy" onError={() => setFailed(photo.display.url)} className="h-14 w-24 shrink-0 rounded-md object-cover" /> :
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-md border", id === "law" ? "border-status-good-ring bg-status-good-soft text-status-good-ink" : "border-status-info-ring bg-status-info-soft text-status-info-ink")}><Icon className="size-5" aria-hidden /></span>}
      <h2 id={`${id}-heading`} className="m-0 min-w-0 flex-1 text-heading font-semibold">{title}</h2>
      {note || photo ? <InfoPopover label={`${title}: sources and image`}>
        {note ? <p>{note}</p> : null}
        {photo ? <OpenImageCredit image={photo} /> : null}
        {building && id === "courts" ? <><p>{building.relationshipLabel}</p><a href={building.evidenceUrl} target="_blank" rel="noreferrer">Court–building association</a></> : null}
        {id === "law" ? <p>Capitol photograph identifies the recorded building; it does not verify present occupancy.</p> : null}
        {id === "demographics" ? <a href="https://www.census.gov/library/visualizations.html" target="_blank" rel="noreferrer">Official Census visualizations</a> : null}
        {id === "government-sites" ? <a href="https://www.usa.gov/state-governments" target="_blank" rel="noreferrer">Official state and territory government directory</a> : null}
      </InfoPopover> : null}
    </div>
  );
}