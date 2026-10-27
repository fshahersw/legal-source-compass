/**
 * Docket mix: a judge's assigned dockets in the case-law collection by nature-of-suit group, product liability
 * highlighted. Answers "how much product-liability work reaches this judge?". It describes the collection, not the
 * complete caseload; groups are the source's, as recorded. The share's base (dockets with a recorded nature of suit) and
 * its coverage of assigned dockets are always stated; below NOS_COVERAGE_FLOOR the share is not put in the title.
 */
import { ChartCard, RankBars } from "@/components/charts/recharts";
import type { JudgeActivity } from "@/lib/external/judgeCourtListener.functions";
import {
  NOS_COVERAGE_FLOOR,
  PRODUCT_GROUP,
  shownProductShare,
} from "@/lib/external/judgeCourtListener.functions";
import { fmtCount } from "./judgeGlanceView";

export function JudgeDocketMixCard({
  dockets,
  personId,
}: {
  dockets: NonNullable<JudgeActivity["dockets"]>;
  personId: number;
}) {
  const d = dockets;
  if (!d.nosGroups.length || !d.nosRecorded) return null;
  const product = d.nosGroups.find((g) => g.key === PRODUCT_GROUP) ?? null;
  const shown = shownProductShare(d);
  const title =
    shown !== null
      ? `Product liability and pharma injury: ${shown}% of this judge's dockets with a recorded nature of suit`
      : "Assigned dockets by nature-of-suit group";
  const coverage = d.nosCoveragePct !== null ? ` (${d.nosCoveragePct}% of ${fmtCount(d.assigned)} assigned)` : "";
  const period = d.firstYear && d.lastYear ? `${d.firstYear}–${d.lastYear}` : undefined;
  const share = (n: number) => `${((n / d.nosRecorded!) * 100).toFixed(1)}%`;
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`Assigned dockets · ${fmtCount(d.nosRecorded)} with a recorded nature of suit${coverage} · case-law collection${period ? ` · filed ${period}` : ""}`}
      status={{ kind: "ready" }}
      sources={[
        {
          label: "CourtListener, person page and bulk data",
          url: `https://www.courtlistener.com/person/${personId}/`,
        },
      ]}
      {...(period ? { period } : {})}
      table={{
        caption: "Assigned dockets by nature-of-suit group",
        columns: [
          { label: "Group" },
          { label: "Dockets", align: "right" },
          { label: "Share of recorded", align: "right" },
        ],
        rows: [
          ...d.nosGroups.map((g) => ({
            key: g.key,
            cells: [g.label, g.n, share(g.n)],
          })),
          ...(d.nosOther
            ? [
                {
                  key: "other",
                  cells: [
                    "Other groups (not broken down by the source)",
                    d.nosOther,
                    share(d.nosOther),
                  ],
                  muted: true,
                },
              ]
            : []),
        ],
      }}
      about={
        <div className="space-y-2">
          <p>
            Dockets the source lists as assigned to this person, grouped by nature of suit as the
            source groups them. It is the source&apos;s collection, not a complete caseload.
          </p>
          <p>
            The source publishes only the largest groups;{" "}
            {d.nosOther
              ? `${fmtCount(d.nosOther)} recorded dockets fall in groups it does not break down.`
              : "here they cover every recorded docket."}{" "}
            {product
              ? ""
              : d.productCount === 0
                ? "No docket falls in the product-liability group."
                : "The product-liability group is not among the published groups, so its share is not recorded."}
          </p>
          {d.productShare !== null && shown === null ? (
            <p>
              Only {d.nosCoveragePct ?? "an unknown share"}
              {d.nosCoveragePct !== null ? "%" : ""} of assigned dockets carry a recorded nature of
              suit (MDL member cases often carry none), so no product share is stated; it is shown
              from {NOS_COVERAGE_FLOOR}%.
            </p>
          ) : null}
        </div>
      }
    >
      <RankBars
        items={d.nosGroups.map((g) => ({ id: g.key, label: g.label, value: g.n }))}
        format={fmtCount}
        focusId={product ? PRODUCT_GROUP : null}
        labelWidth={240}
        ariaLabel="Assigned dockets by nature-of-suit group"
      />
    </ChartCard>
  );
}
