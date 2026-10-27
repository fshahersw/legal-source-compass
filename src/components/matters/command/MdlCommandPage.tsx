/**
 * The MDL command page (/matters/$id): one scrollable page behind a sticky section index, for registry MDLs (MDL
 * directory or Seeger Weiss registry) and recorded MDLs (only lens records: JPML series, hearings, court page...).
 * It opens with its answer (identity, headline figures, three charts), then what changed, velocity, the JPML record,
 * key orders, docketed dates, counsel, activity, documents, the regulatory record and the sources. There are no tabs:
 * a former `?tab=` address scrolls to the section that now holds its content; `?entry=` and `?view=` still open the
 * document viewer.
 */
import { useEffect } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ProfileSections, type ProfileSection } from "@/components/kit/ProfileSections";
import { title as litigationTitle } from "@/components/mdl/intelFormat";
import { matterAnchorOf, type MatterSearch, type MdlSectionId } from "@/lib/matters/search";
import type { MdlCommandPayload } from "@/lib/matters/types";
import { ActivitySection } from "./ActivitySection";
import { CounselSection } from "./CounselSection";
import { DocketedDatesSection } from "./DocketedDatesSection";
import { DocumentsSection } from "./DocumentsSection";
import { JpmlSection } from "./JpmlSection";
import { KeyOrdersSection } from "./KeyOrdersSection";
import { MdlIdentity } from "./MdlIdentity";
import { OverviewSection } from "./OverviewSection";
import { RegulatorySection } from "./RegulatorySection";
import { SourcesSection } from "./SourcesSection";
import { VelocitySection } from "./VelocitySection";
import { WhatChanged } from "./WhatChanged";

/** The page title: the MDL record's title, the JPML analytics title, the recorded title, or "MDL N". */
export function commandTitle(cmd: MdlCommandPayload): string {
  return (
    cmd.overview?.overview.title ??
    cmd.lens?.mdl?.title ??
    (cmd.lens?.recordedTitle ? litigationTitle(cmd.lens.recordedTitle.title) : null) ??
    `MDL ${cmd.mdl}`
  );
}

export function MdlCommandPage({
  cmd,
  search,
  onSearch,
}: {
  cmd: MdlCommandPayload;
  search: MatterSearch;
  onSearch: (next: (prev: MatterSearch) => MatterSearch) => void;
}) {
  const anchor = matterAnchorOf(search);
  // A former tab address scrolls once to its section (after the sections have rendered).
  useEffect(() => {
    if (!anchor || window.location.hash) return;
    const frame = window.requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ block: "start" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [anchor]);

  const title = commandTitle(cmd);
  const o = cmd.overview?.overview ?? null;
  const description = [
    o?.masterDocket.number ? `Master docket ${o.masterDocket.number}` : null,
    o?.court.shortName ?? cmd.lens?.court?.name ?? null,
    cmd.mode === "recorded" ? "Recorded MDL" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const is = (id: MdlSectionId) => anchor === id;
  const sections: (ProfileSection & { id: MdlSectionId })[] = [
    { id: "mdl-overview", title: "At a glance", label: "Overview", content: <OverviewSection cmd={cmd} /> },
    {
      id: "mdl-changes",
      title: "What changed",
      description: "The latest JPML interval and the last 30 and 90 days on the docket.",
      content: <WhatChanged cmd={cmd} />,
    },
    {
      id: "mdl-velocity",
      title: "Filing velocity",
      label: "Velocity",
      description: "How fast actions arrive, from JPML reports, transfer orders and filings.",
      content: <VelocitySection cmd={cmd} />,
    },
    {
      id: "mdl-jpml",
      title: "JPML record, court and judge",
      label: "JPML",
      content: <JpmlSection cmd={cmd} />,
    },
    {
      id: "mdl-orders",
      title: "Key orders",
      label: "Orders",
      description: "Numbered orders, Rule 702 rulings, bellwether, trial and settlement orders.",
      content: <KeyOrdersSection cmd={cmd} />,
    },
    {
      id: "mdl-dates",
      title: "Dates set on the docket",
      label: "Dates",
      content: <DocketedDatesSection cmd={cmd} />,
    },
    {
      id: "mdl-counsel",
      title: "Leadership, parties and counsel",
      label: "Counsel",
      content: <CounselSection cmd={cmd} open={is("mdl-counsel")} />,
    },
    {
      id: "mdl-activity",
      title: "Docket activity",
      label: "Activity",
      content: <ActivitySection cmd={cmd} open={is("mdl-activity")} />,
    },
    {
      id: "mdl-documents",
      title: "Documents",
      content: <DocumentsSection cmd={cmd} search={search} onSearch={onSearch} />,
    },
    {
      id: "mdl-regulatory",
      title: "Regulatory record and defendants",
      label: "Regulatory",
      content: <RegulatorySection cmd={cmd} />,
    },
    {
      id: "mdl-sources",
      title: "Sources and coverage",
      label: "Sources",
      content: <SourcesSection cmd={cmd} open={is("mdl-sources")} />,
    },
  ];
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Matters", to: "/matters" },
        ...(cmd.overview?.sw.tier ? [{ label: "Seeger Weiss hub", to: "/matters/seeger-weiss" }] : []),
        { label: `MDL ${cmd.mdl}` },
      ]}
      title={title}
      sectionTabs={false}
      {...(description ? { description } : {})}
    >
      <MdlIdentity cmd={cmd} />
      <ProfileSections sections={sections} />
    </AppShell>
  );
}
