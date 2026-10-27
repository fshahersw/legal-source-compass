/**
 * The Panel's record and the transferee bench: the JPML actions series with its table, pending by fiscal year,
 * hearing sessions, GovInfo Panel orders, terminated-litigation entries, the transferee court and judge cards and the
 * JPML counts the MDL record lists. Moved here from the former case lens (/matters/lens/$mdl redirects to #mdl-jpml).
 */
import { Fragment, type ReactNode } from "react";
import {
  CourtCard,
  HearingsCard,
  JudgeCard,
  PanelOrdersCard,
  TerminatedCard,
} from "@/components/lens/MdlLens";
import { JpmlMdlSeriesPanel } from "@/components/mdl/jpml-series/JpmlMdlSeriesPanel";
import { JpmlCountsPanel } from "@/components/matters/OverviewPanel";
import { ProfileTrend } from "@/components/trends/ProfileTrend";
import type { MdlCommandPayload } from "@/lib/matters/types";

/** Half-width cards in rows of two; an odd last card spans the row. */
function Pairs({ cards }: { cards: ((c: string | undefined) => ReactNode)[] }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {cards.map((card, i) => (
        <Fragment key={i}>
          {card(i === cards.length - 1 && cards.length % 2 === 1 ? "lg:col-span-2" : undefined)}
        </Fragment>
      ))}
    </div>
  );
}

export function JpmlSection({ cmd }: { cmd: MdlCommandPayload }) {
  const n = Number(cmd.mdl);
  const lens = cmd.lens;
  const inSeries = cmd.jpmlPoints.length > 0;
  const cards: ((c: string | undefined) => ReactNode)[] = [];
  if (lens?.court) {
    const court = lens.court;
    cards.push((c) => <CourtCard court={court} dist={lens.courtDistributions} className={c} />);
  }
  if (lens?.judge) {
    const judge = lens.judge;
    cards.push((c) => <JudgeCard judge={judge} mdl={n} className={c} />);
  }
  if (lens?.hearings.length) {
    const h = lens.hearings;
    cards.push((c) => <HearingsCard hearings={h} className={c} />);
  }
  if (lens?.panelOrders.length) {
    const p = lens.panelOrders;
    cards.push((c) => <PanelOrdersCard orders={p} className={c} />);
  }
  if (lens?.terminated.length) {
    const t = lens.terminated;
    cards.push((c) => <TerminatedCard rows={t} className={c} />);
  }
  return (
    <div className="space-y-4">
      {inSeries ? <JpmlMdlSeriesPanel mdl={n} /> : null}
      {inSeries ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ProfileTrend kind="mdl-fy-pending" id={n} />
          {cmd.overview?.overview.actions.snapshots.length ? (
            <JpmlCountsPanel payload={cmd.overview} />
          ) : null}
        </div>
      ) : (
        <p className="text-body text-muted-foreground">
          MDL {cmd.mdl} is not in the JPML monthly actions-pending reports recorded here, so no
          pending-action series is shown.
          {lens?.judgeAmbiguous ? " More than one judge profile lists this MDL, so none is shown." : ""}
        </p>
      )}
      <Pairs cards={cards} />
    </div>
  );
}
