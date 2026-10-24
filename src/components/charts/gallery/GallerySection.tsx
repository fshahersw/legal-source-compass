/** A titled block of the chart gallery: heading, one line saying what it shows, then its charts. */
import type { ReactNode } from "react";

export function GallerySection({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-4 space-y-3">
      <div>
        <h2 id={`${id}-h`} className="text-base font-semibold leading-6">
          {title}
        </h2>
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  );
}
