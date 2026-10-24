/**
 * Section: a light section header (16/24 semibold title, optional one-line description, actions on the right) over
 * its content. Replaces the heavy navy "Sections" / "In this section" bars.
 *
 *   <Section title="Courts & judges" description="Federal caseloads and the bench" actions={<Link …>All</Link>}>
 *     …cards…
 *   </Section>
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  description,
  actions,
  id,
  headingAs: Heading = "h2",
  className,
  headerClassName,
  children,
}: {
  title: ReactNode;
  description?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** Id of the section; the heading gets `${id}-title` and labels the section. */
  id?: string | undefined;
  headingAs?: "h2" | "h3" | undefined;
  className?: string | undefined;
  headerClassName?: string | undefined;
  children: ReactNode;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={titleId} className={cn("min-w-0 scroll-mt-16", className)}>
      <div
        className={cn(
          "mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1",
          headerClassName,
        )}
      >
        <div className="min-w-0">
          <Heading id={titleId} className="text-heading text-foreground">
            {title}
          </Heading>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
