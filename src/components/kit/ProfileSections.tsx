/**
 * ProfileSections: one scrollable profile page in a few named sections behind a sticky in-page index. A section
 * whose panels all render nothing for this entity (no data) is not displayed and drops out of the index, so a thin
 * record does not show empty headings.
 *
 *   <ProfileSections sections={[{ id: "court-judges", title: "Judges", description: "…", content: <>…panels…</> }]} />
 */
import type { ReactNode } from "react";
import { Section } from "./Section";
import { SectionIndex } from "./SectionIndex";

export type ProfileSection = {
  id: string;
  /** Section heading, also the index label unless `label` is given. */
  title: string;
  /** Shorter index label. */
  label?: string | undefined;
  description?: string | undefined;
  content: ReactNode;
};

/** Hidden while the section holds nothing but its own header. */
const EMPTY_HIDDEN = "[&:not(:has(>:nth-child(2)))]:hidden";

export function ProfileSections({ sections }: { sections: readonly ProfileSection[] }) {
  return (
    <>
      <SectionIndex
        items={sections.map((s) => ({ id: s.id, label: s.label ?? s.title }))}
        hideMissing
        className="mt-0 mb-6"
      />
      <div className="space-y-10">
        {sections.map((s) => (
          <Section
            key={s.id}
            id={s.id}
            title={s.title}
            description={s.description}
            className={EMPTY_HIDDEN}
          >
            {s.content}
          </Section>
        ))}
      </div>
    </>
  );
}
