/** The matter page's "Lifecycle & signals" tab: the MDL's lifecycle lane, its product signal timeline and the
 * authorities its filings cite. */
import { CitationMap } from "./CitationMap";
import { MdlLaneDetail } from "./MdlLaneDetail";
import { ProductSignalTimeline } from "./ProductSignalTimeline";

export function MatterLifecyclePanel({ mdl }: { mdl: string }) {
  if (!/^[1-9][0-9]{0,5}$/.test(mdl))
    return (
      <p className="text-[13px] text-muted-foreground">
        Lifecycle charts are drawn for MDLs with a JPML number; this matter has none recorded.
      </p>
    );
  return (
    <div className="space-y-4 pb-6">
      <MdlLaneDetail mdl={mdl} headingLevel="h2" />
      <ProductSignalTimeline mdl={mdl} />
      <CitationMap mdl={mdl} />
    </div>
  );
}
