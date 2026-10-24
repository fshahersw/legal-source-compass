/**
 * InsightCallout: an "insight of the day" block. Headline sentence, 2-4 key figures in a strip, and the explanatory
 * paragraph collapsed behind "Show explanation" (kept in the page, not deleted), with a source footer.
 *
 *   <InsightCallout eyebrow="Insight of the day · October 24, 2026"
 *     headline="63% of FDA device adverse-event reports describe malfunctions"
 *     figures={[{ label: "Malfunction reports", value: "16,607,966", detail: "62.5%" }, …]}
 *     footer={<SourceFooter source={{ label: "openFDA device adverse events (MAUDE)", href }} asOf="2026-09-30" />}>
 *     <p>MAUDE holds 26,557,775 device reports received from 1992 onward …</p>
 *   </InsightCallout>
 */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardFooter } from "./Card";

export type InsightFigure = { label: ReactNode; value: ReactNode; detail?: ReactNode | undefined };

export function InsightCallout({
  eyebrow,
  headline,
  figures,
  children,
  footer,
  defaultOpen = false,
  explanationLabel = "explanation",
  className,
}: {
  eyebrow?: ReactNode | undefined;
  headline: ReactNode;
  /** Two to four key figures; more are shown but the strip is designed for four. */
  figures: readonly InsightFigure[];
  /** The explanatory paragraph(s), collapsed by default. */
  children?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  defaultOpen?: boolean | undefined;
  explanationLabel?: string | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <Card as="section" className={cn("overflow-hidden", className)}>
      <div className="px-4 pt-4">
        {eyebrow ? (
          <p className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
            <Lightbulb className="size-3.5 text-brand" aria-hidden />
            {eyebrow}
          </p>
        ) : null}
        <h3 className="text-label font-semibold text-foreground">{headline}</h3>
      </div>
      {figures.length ? (
        <dl
          className={cn(
            "m-0 mx-4 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border",
            figures.length >= 4 ? "lg:grid-cols-4" : figures.length === 3 ? "sm:grid-cols-3" : "",
          )}
        >
          {figures.map((f, i) => (
            <div key={i} className="min-w-0 bg-card px-3 py-2.5">
              <dt className="text-meta text-muted-foreground">{f.label}</dt>
              <dd className="m-0 mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-kpi-sm tabular-nums">{f.value}</span>
                {f.detail ? (
                  <span className="text-meta tabular-nums text-muted-foreground">{f.detail}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? (
        <div className="px-4 pt-2.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md text-meta font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              aria-hidden
            />
            {open ? `Hide ${explanationLabel}` : `Show ${explanationLabel}`}
          </button>
          <div
            id={panelId}
            hidden={!open}
            className="measure mt-2 space-y-2 text-body text-foreground/85"
          >
            {children}
          </div>
        </div>
      ) : null}
      <div className="pt-4" />
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
