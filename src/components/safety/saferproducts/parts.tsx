import { TriangleAlert } from "lucide-react";
import { SourceLink } from "@/components/enforcement/parts";
import { UNVERIFIED, UNVERIFIED_SENTENCE } from "./saferProductsView";

const ABOUT = "https://www.saferproducts.gov/About";

/** The label every report count carries. Kept as a chip so it travels with a panel into any screenshot. */
export function UnverifiedBadge() {
  return (
    <span
      title={UNVERIFIED_SENTENCE}
      className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning-foreground"
    >
      <TriangleAlert className="size-3" aria-hidden />
      {UNVERIFIED}
    </span>
  );
}

/** The standing statement above every SaferProducts view. */
export function UnverifiedNotice({ extra }: { extra?: string | undefined }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-4"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold">{UNVERIFIED}.</span> {UNVERIFIED_SENTENCE}
        {extra ? ` ${extra}` : ""} Source:{" "}
        <SourceLink href={ABOUT}>
          SaferProducts.gov, U.S. Consumer Product Safety Commission
        </SourceLink>
      </p>
    </div>
  );
}
