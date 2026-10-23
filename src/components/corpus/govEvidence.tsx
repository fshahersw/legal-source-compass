import { Landmark } from "lucide-react";
import { evidenceLabel, type GovLookupResult } from "@/lib/external/govDomainsModel";

/**
 * A quiet tag for a host the registries list. It says what the registry says (registered in the .gov zone, or listed by
 * GSA) and nothing about the page; a host that is not listed gets no tag, because absence is not evidence.
 */
export function GovEvidenceTag({ result }: { result: GovLookupResult | undefined }) {
  const e = result ? evidenceLabel(result) : null;
  if (!result || !e) return null;
  return (
    <span
      title={`${e.detail}. A registry listing says the domain is registered or listed as a government domain; it does not vouch for the page.`}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
      data-testid="gov-evidence-tag"
    >
      <Landmark className="size-2.5" aria-hidden />
      {e.label}
    </span>
  );
}
