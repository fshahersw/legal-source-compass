/**
 * Identity strip of one MDL: status and docket type, the Seeger Weiss tier, the transferee court (artwork by exact
 * court id), the transferee judge (portrait and profile only by the exact linked profile id), the master docket and
 * the transfer date. Registry mode reads the MDL record; recorded mode reads the JPML analytics row or the record the
 * title was taken from.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";
import { JudgeHeadshot } from "@/components/judges/JudgeHeadshot";
import { Chip } from "@/components/matters/common";
import type { MdlCommandPayload } from "@/lib/matters/types";
import { Out, day } from "./shared";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-body">{children}</dd>
    </div>
  );
}

export function MdlIdentity({ cmd }: { cmd: MdlCommandPayload }) {
  const p = cmd.overview;
  const o = p?.overview ?? null;
  const lm = cmd.lens?.mdl ?? null;
  const status = o?.status ?? lm?.status ?? null;
  const asOf = o?.asOf ?? lm?.asOf ?? null;
  const type = o?.litigationType ?? lm?.type ?? null;
  const courtId = o?.court.clId ?? cmd.lens?.court?.court_id ?? null;
  const courtName =
    o?.court.shortName ?? o?.court.fullName ?? cmd.lens?.court?.name ?? lm?.district ?? null;
  const judgeProfile = p?.judgeProfile ?? null;
  const judgeName = judgeProfile?.name ?? o?.judge.printedName ?? lm?.judge ?? null;
  const master = o?.masterDocket.number ?? lm?.masterDocket ?? null;
  const clDocket = o?.masterDocket.clDocketId ?? null;
  const transferred = o?.dates.transferred ?? lm?.dateTransferred ?? null;
  return (
    <section
      aria-label={`MDL ${cmd.mdl} identity`}
      className="mb-6 rounded-xl border border-border bg-card px-4 py-3 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label font-semibold">MDL {cmd.mdl}</span>
        {status ? (
          <Chip tone={status === "pending" ? "success" : "neutral"}>
            {status[0]!.toUpperCase() + status.slice(1)}
            {asOf ? ` · JPML ${day(asOf)}` : ""}
          </Chip>
        ) : (
          <Chip>Status not recorded</Chip>
        )}
        {type ? <Chip>{type}</Chip> : null}
        {p?.sw.tier ? (
          <Link
            to="/matters/seeger-weiss"
            className="rounded focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Chip
              tone="primary"
              title="Seeger Weiss priority tier; orders the hub and never asserts a firm role."
            >
              Seeger Weiss tier {p.sw.tier}
            </Chip>
          </Link>
        ) : null}
        {cmd.mode === "recorded" ? (
          <Chip title="No MDL directory or registry record; the page shows the records kept for this exact MDL number.">
            Recorded MDL
          </Chip>
        ) : null}
      </div>
      <div className="mt-3 flex gap-4">
        {judgeProfile ? (
          <JudgeHeadshot judgeId={judgeProfile.id} name={judgeProfile.name} recorded={null} />
        ) : null}
        <dl className="grid min-w-0 flex-1 content-start gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Transferee court">
            <span className="flex items-center gap-2">
              {courtId ? (
                <CourtArtwork courtId={courtId} title={courtName ?? courtId} compact />
              ) : null}
              {courtId ? (
                <Link
                  to="/courts/$id"
                  params={{ id: courtId }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {courtName ?? courtId}
                </Link>
              ) : (
                (courtName ?? "Not recorded")
              )}
            </span>
          </Fact>
          <Fact label="Transferee judge">
            {judgeProfile ? (
              <Link
                to="/judges/$id"
                params={{ id: judgeProfile.id }}
                className="text-primary underline-offset-2 hover:underline"
              >
                {judgeProfile.name}
              </Link>
            ) : (
              (judgeName ?? "Not recorded")
            )}
          </Fact>
          <Fact label="Master docket">
            {master ? (
              <Out href={clDocket ? `https://www.courtlistener.com/docket/${clDocket}/` : null}>
                <span className="font-mono">{master}</span>
              </Out>
            ) : (
              "Not recorded"
            )}
          </Fact>
          <Fact label="Centralized (JPML transfer)">{day(transferred)}</Fact>
        </dl>
      </div>
    </section>
  );
}
