/**
 * Card surfaces: white card, hairline border, 12 px radius, soft shadow-xs.
 *
 *   <Card>
 *     <CardHeader title="Federal civil cases filed" description="United States, fiscal years" actions={…} />
 *     <CardBody>…the number or chart…</CardBody>
 *     <CardFooter><SourceFooter source={{ label: "FJC Integrated Database", href }} period="FY2025" asOf="Oct 1, 2026"
 *       about={<p>Method and caveats…</p>} /></CardFooter>
 *   </Card>
 *
 * Content hierarchy (WORKER_RULES_UI): title (what it is), the number or chart, then one footer line
 * "Source · period · as of" with an "About this data" popover holding the method text, caveats and links.
 */
import { isValidElement, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoPopover } from "./InfoPopover";
import { PartialPill } from "./StatusPill";
import { cardClass } from "./styles";

export function Card({
  as: Tag = "div",
  interactive = false,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType | undefined;
  /** Hover and focus-within affordance for a card that is a link target. */
  interactive?: boolean | undefined;
}) {
  return (
    <Tag
      className={cn(
        cardClass,
        "min-w-0",
        interactive &&
          "transition-colors hover:border-border-strong focus-within:border-border-strong",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  titleAs: Title = "h3",
  id,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  icon?: ReactNode | undefined;
  titleAs?: ElementType | undefined;
  /** Id of the title, for aria-labelledby on the card. */
  id?: string | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-4 pt-4 pb-3", className)}>
      {icon ? (
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground [&_svg]:size-4"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <Title id={id} className="text-label text-foreground">
          {title}
        </Title>
        {description ? (
          <p className="mt-0.5 text-meta text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 border-t border-border px-4 py-2.5 text-meta text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export type SourceRef = { label: string; href?: string | null | undefined };

function isSourceRef(v: unknown): v is SourceRef {
  return typeof v === "object" && v !== null && !isValidElement(v) && "label" in v;
}

function SourceLink({ source }: { source: SourceRef }) {
  if (!source.href)
    return (
      <span className="truncate" title={source.label}>
        {source.label}
      </span>
    );
  const external = !source.href.startsWith("/");
  return (
    <a
      href={source.href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      title={source.label}
      className="inline-flex min-w-0 items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline"
    >
      <span className="truncate">{source.label}</span>
      {external ? <ExternalLink className="size-3 shrink-0" aria-hidden /> : null}
    </a>
  );
}

export type SourceFooterProps = {
  /** One or more sources (label + optional link), or any node (e.g. a router Link). */
  source?: SourceRef | readonly SourceRef[] | ReactNode | undefined;
  /** Period the figure covers, as printed by the source ("FY2025"). */
  period?: ReactNode | undefined;
  /** When the data was last read or published ("as of Oct 1, 2026"). Printed after "as of". */
  asOf?: ReactNode | undefined;
  /** A partial-period note; shows the "Partial" pill with the note in its popover. */
  partial?: ReactNode | undefined;
  /** Method text, caveats and links for the "About this data" popover. */
  about?: ReactNode | undefined;
  aboutLabel?: string | undefined;
  /** Heading inside the popover (defaults to the label). */
  aboutTitle?: string | undefined;
  className?: string | undefined;
  /** Extra items at the end of the line (before the info button), e.g. an "Open chart" link. */
  children?: ReactNode | undefined;
};

/** One footer line: "Source · period · as of", a partial pill when needed, then the "About this data" popover. */
export function SourceFooter({
  source,
  period,
  asOf,
  partial,
  about,
  aboutLabel = "About this data",
  aboutTitle,
  className,
  children,
}: SourceFooterProps) {
  const sources: SourceRef[] = Array.isArray(source)
    ? (source as SourceRef[]).filter(isSourceRef)
    : isSourceRef(source)
      ? [source]
      : [];
  const custom: ReactNode =
    !sources.length && source != null && !Array.isArray(source) && !isSourceRef(source)
      ? (source as ReactNode)
      : null;
  const parts: ReactNode[] = [];
  if (sources.length || custom)
    parts.push(
      <span key="src" className="inline-flex min-w-0 items-center gap-1">
        <span className="shrink-0">Source:</span>
        {custom ??
          sources.map((s, i) => (
            <span key={`${s.label}-${i}`} className="inline-flex min-w-0 items-center">
              {i > 0 ? <span className="mr-1">;</span> : null}
              <SourceLink source={s} />
            </span>
          ))}
      </span>,
    );
  if (period)
    parts.push(
      <span key="period" className="shrink-0">
        {period}
      </span>,
    );
  if (asOf)
    parts.push(
      <span key="asof" className="shrink-0">
        as of {asOf}
      </span>,
    );
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 text-meta text-muted-foreground", className)}
    >
      <p className="m-0 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {parts.map((p, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1.5", i === 0 && "min-w-0")}>
            {i > 0 ? (
              <span aria-hidden className="text-border-strong">
                ·
              </span>
            ) : null}
            {p}
          </span>
        ))}
      </p>
      {partial ? <PartialPill note={partial} /> : null}
      {children}
      {about ? (
        <InfoPopover label={aboutLabel} title={aboutTitle}>
          {about}
        </InfoPopover>
      ) : null}
    </div>
  );
}
