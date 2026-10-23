/**
 * Trend cards on the law-firm page. Counsel entries carry no date, so the only time dimension is the year each MDL was
 * filed; see lib/trends/firm. They are the Analytics hub's card (components/trends).
 */
import { useMemo } from "react";
import { StaticTrend } from "@/components/trends/ProfileTrend";
import { staticDef } from "@/components/trends/trendDefs";
import type { FirmProfile, MdlLandscape } from "@/lib/external/firmIntel.functions";
import {
  buildFirmLandscapeYears,
  buildFirmProfileYears,
  toSideAppearances,
} from "@/lib/trends/firm";

/** Appearances on the registry's MDL master dockets by the year the MDL was filed, both sides. */
export function FirmLandscapeYearsCard({ mdls }: { mdls: readonly MdlLandscape[] }) {
  const def = useMemo(
    () =>
      staticDef({
        id: "firm-landscape-years",
        title: "Counsel appearances on MDL master dockets, by the year the MDL was filed",
        measure: "counsel appearances on MDL master dockets",
        detail: { to: "/data/firm_matter_overview", label: "Landscape dataset" },
      }),
    [],
  );
  const block = useMemo(() => buildFirmLandscapeYears({ mdls: toSideAppearances(mdls) }), [mdls]);
  return (
    <StaticTrend
      def={def}
      block={block}
      emptyReason="No MDL in the landscape has a recorded filing year."
    />
  );
}

/** One firm's appearances grouped by the filing year of each MDL it appears in. */
export function FirmProfileYearsCard({ p }: { p: FirmProfile }) {
  const def = useMemo(
    () =>
      staticDef({
        id: `firm-profile-years-${p.id}`,
        title: `${p.name}: appearances on MDL master dockets, by the year the MDL was filed`,
        measure: "appearances on MDL master dockets",
        detail: { to: `/records/firm_profiles/${p.id}`, label: "Firm record" },
      }),
    [p.id, p.name],
  );
  const block = useMemo(
    () =>
      buildFirmProfileYears({
        id: p.id,
        rows: p.perMdl.map((m) => ({ year: m.year, appearances: m.appearances })),
      }),
    [p.id, p.perMdl],
  );
  if (!block) return null;
  return <StaticTrend def={def} block={block} emptyReason="" />;
}
