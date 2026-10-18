import type { ReactNode } from "react";
import type { CourtOrder } from "@/lib/external/mdlIntel.functions";
import { cn } from "@/lib/utils";

/** Hover text for a court-page order link that opens CM/ECF (CourtOrder.pacer, requiresPacerLogin). */
const PACER_TITLE = "Opens the court's CM/ECF system; a PACER login is required";

/** Small "PACER" tag placed after an order link whose host is CM/ECF or PACER; never inside the link text. */
export function PacerLabel({ className }: { className?: string | undefined }) {
  return (
    <span
      title={PACER_TITLE}
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-border px-1 text-[10px] font-medium leading-4 text-muted-foreground",
        className,
      )}
    >
      PACER<span className="sr-only">: login required to open this order</span>
    </span>
  );
}

/**
 * A court-page order link (new tab), titled with the order's own title; when the link opens CM/ECF the title
 * says a PACER login is required and a PACER tag follows the link.
 */
export function CourtOrderLink({
  order,
  className,
  labelClassName,
  children,
}: {
  order: Pick<CourtOrder, "url" | "title" | "pacer">;
  className?: string | undefined;
  labelClassName?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <>
      <a
        href={order.url}
        target="_blank"
        rel="noreferrer"
        className={className}
        title={order.pacer ? `${order.title} — ${PACER_TITLE}` : order.title}
      >
        {children ?? order.title}
      </a>
      {order.pacer ? <PacerLabel className={labelClassName} /> : null}
    </>
  );
}
