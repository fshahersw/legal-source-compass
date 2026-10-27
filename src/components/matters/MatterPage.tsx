/**
 * The matter page is the MDL command page now (src/components/matters/command/MdlCommandPage.tsx): one scrollable page
 * with a sticky section index for registry and recorded MDLs. This alias keeps the former import working.
 *
 * Demoted 2026-10-27 (restorable from git): the four-view tab bar (Overview · Cases & parties · Docket & documents ·
 * Evidence & sources). Every former `?tab=` address now scrolls to the section holding that content
 * (MATTER_TAB_ANCHORS in src/lib/matters/search.ts); the panels themselves are reused inside the sections.
 */
export { MdlCommandPage as MatterPage } from "./command/MdlCommandPage";
