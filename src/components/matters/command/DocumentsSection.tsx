/**
 * Documents: the court-filings layer for this MDL (its own counts, pages and text status), then the matter's saved
 * document records and viewer on demand. `?entry=` and `?view=` keep opening the viewer here.
 */
import { DocumentsPanel as FilingsPanel } from "@/components/documents/DocumentsPanel";
import { DocumentsPanel } from "@/components/matters/DocumentsPanel";
import { withEntry, withView, type MatterSearch } from "@/lib/matters/search";
import type { MdlCommandPayload } from "@/lib/matters/types";
import { Disclosure } from "./shared";

export function DocumentsSection({
  cmd,
  search,
  onSearch,
}: {
  cmd: MdlCommandPayload;
  search: MatterSearch;
  onSearch: (next: (prev: MatterSearch) => MatterSearch) => void;
}) {
  const open = search.entry !== undefined || search.view !== undefined || search.tab === "documents";
  return (
    <div className="space-y-4">
      <FilingsPanel type="mdl" id={cmd.mdl} />
      {cmd.overview ? (
        <Disclosure title="Saved document records and viewer" defaultOpen={open}>
          <DocumentsPanel
            payload={cmd.overview}
            entry={search.entry ?? null}
            onEntry={(n) => onSearch((prev) => withEntry(prev, n))}
            viewKey={search.view ?? null}
            onView={(key) => onSearch((prev) => withView(prev, key))}
          />
        </Disclosure>
      ) : null}
    </div>
  );
}
