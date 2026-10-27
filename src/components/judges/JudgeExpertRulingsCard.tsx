/**
 * Recorded expert-admissibility rulings for one judge (dataset judge_expert_rulings). Renders nothing until that
 * dataset is published. Thresholds from judgeRulingsView: a chart only from 5 rulings, shares only from 20 per movant
 * side; plaintiffs' and defendants' motions are separate bars; "Not determined" always shows; nothing is ranked.
 */
import { BarList, DataDrawer } from "@/components/kit";
import { ChartCard, VerdictStack } from "@/components/charts/recharts";
import type { JudgeExpertRulings } from "@/lib/external/judgeRulings.functions";
import {
  OUTCOME_LABELS,
  OUTCOME_ORDER,
  RULINGS_CAPTION,
  rulingsPeriod,
  rulingsTitle,
  rulingsView,
} from "./judgeRulingsView";

const TAXONOMY = [
  {
    group: "Decided",
    tags: OUTCOME_ORDER.filter((o) => o !== "not_determined").map((o) => ({
      key: o,
      label: OUTCOME_LABELS[o],
    })),
  },
  {
    group: "Not determined",
    tags: [{ key: "not_determined", label: OUTCOME_LABELS.not_determined }],
  },
];

export function JudgeExpertRulingsCard({ data }: { data: JudgeExpertRulings | null | undefined }) {
  if (!data) return null;
  const v = rulingsView(data.rulings);
  if (v.mode === "none") return null;
  const period = rulingsPeriod(v) ?? undefined;
  const drawer = (
    <DataDrawer
      title="Recorded expert-admissibility rulings"
      description={RULINGS_CAPTION}
      rows={data.rulings}
      rowKey={(r) => r.id}
      triggerLabel={`View all ${v.n}`}
      columns={[
        { key: "date", label: "Date", value: (r) => r.date },
        { key: "case", label: "Case", value: (r) => r.caption ?? r.docket },
        { key: "expert", label: "Expert (as printed)", value: (r) => r.expert },
        { key: "movant", label: "Movant (as printed)", value: (r) => r.movantPrinted },
        { key: "outcome", label: "Outcome", value: (r) => OUTCOME_LABELS[r.outcome] },
        { key: "basis", label: "Attribution", value: (r) => r.basis },
        {
          key: "source",
          label: "Source",
          value: (r) => r.sourceUrl,
          render: (r) =>
            r.sourceUrl ? (
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Open
              </a>
            ) : null,
        },
      ]}
      source={{
        source: { label: data.label ?? "Judge expert rulings" },
        ...(period ? { period } : {}),
      }}
    />
  );
  return (
    <ChartCard
      variant="editorial"
      title={rulingsTitle(v)}
      subtitle={`Motions to exclude or limit expert testimony · by movant side · counts${v.mode === "shares" ? " and shares" : ""}${period ? ` · ${period}` : ""}`}
      status={{ kind: "ready" }}
      {...(period ? { period } : {})}
      actions={drawer}
      footnotes={[RULINGS_CAPTION]}
      about={
        <div className="space-y-2">
          <p>
            Each ruling is attributed to this judge only by an exact link (court and docket number
            to the assigned judge, or the MDL judge link with a matching printed signer). Reports
            and recommendations and orders signed by a magistrate judge are left out.
          </p>
          <p>
            A chart is drawn from 5 rulings; shares only where a movant side has at least 20.
            {data.precision ? ` Measured precision of the outcome coding: ${data.precision}.` : ""}
          </p>
        </div>
      }
    >
      {v.mode === "list" ? (
        <ul className="space-y-1 text-body">
          {data.rulings.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums text-muted-foreground">
                {r.date ?? "Date not recorded"}
              </span>
              <span>{r.caption ?? r.docket ?? "Case not recorded"}</span>
              <span className="font-medium">{OUTCOME_LABELS[r.outcome]}</span>
              {r.sourceUrl ? (
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Source
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : v.mode === "shares" ? (
        <VerdictStack
          subjects={v.subjects.map((s) => ({
            id: s.movant,
            label: s.label,
            counts: s.counts,
            n: s.n,
          }))}
          taxonomy={TAXONOMY}
          ariaLabel="Recorded expert-admissibility rulings by movant side and outcome"
          labelWidth={170}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {v.subjects.map((s) => (
            <div key={s.movant} className="min-w-0">
              <p className="mb-2 text-label font-medium">
                {s.label} <span className="text-meta text-muted-foreground">n={s.n}</span>
              </p>
              <BarList
                ariaLabel={`${s.label}: rulings by outcome`}
                items={OUTCOME_ORDER.map((o) => ({
                  id: o,
                  label: OUTCOME_LABELS[o],
                  value: s.counts[o],
                  display: s.counts[o].toLocaleString("en-US"),
                }))}
              />
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
