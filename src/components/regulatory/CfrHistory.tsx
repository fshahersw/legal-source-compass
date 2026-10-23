import { ExternalLink, History } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { POINT_IN_TIME_START, type CfrHistory, type CfrVersion } from "@/lib/external/ecfrFull";

const VISIBLE = 12;

function FrLinks({ v, labels }: { v: CfrVersion; labels: Record<string, string> }) {
  if (!v.fr.length) return null;
  const basis = labels[v.frBasis] ?? null;
  return (
    <div className="mt-0.5">
      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
        {v.fr.map((f) => (
          <a
            key={f.documentNumber}
            href={f.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
            title={f.publicationDate ? `Published ${f.publicationDate}` : undefined}
          >
            {f.citation ?? f.documentNumber}
            <ExternalLink className="size-2.5" aria-hidden />
          </a>
        ))}
      </span>
      {basis ? (
        <span className="block text-[10px] leading-tight text-muted-foreground">{basis}</span>
      ) : null}
    </div>
  );
}

/** Change history (newest first) with a link to read the text as of each date. */
export function CfrVersionList({
  history,
  selected,
  onPick,
}: {
  history: CfrHistory;
  selected: string | null;
  onPick: (date: string | null) => void;
}) {
  const [all, setAll] = useState(false);
  const versions = [...history.versions].reverse();
  const shown = all ? versions : versions.slice(0, VISIBLE);
  return (
    <div>
      <ol className="m-0 list-none space-y-2 p-0 text-[12px]">
        {shown.map((v, k) => {
          const before = v.date < POINT_IN_TIME_START;
          const latest = k === 0;
          return (
            <li key={`${v.date}-${v.issueDate}-${k}`} className="border-l-2 border-border pl-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium tabular-nums">{v.date}</span>
                <span className="text-[11px] text-muted-foreground">
                  {v.removed
                    ? "Removed"
                    : before
                      ? "In effect when the record begins"
                      : v.substantive
                        ? "Substantive change"
                        : "Editorial change"}
                </span>
              </div>
              <FrLinks v={v} labels={history.basisLabels} />
              {!v.removed ? (
                latest ? (
                  <button
                    type="button"
                    onClick={() => onPick(null)}
                    className={cn(
                      "mt-0.5 text-[11px] hover:underline",
                      selected === null ? "text-muted-foreground" : "text-primary",
                    )}
                    disabled={selected === null}
                  >
                    {selected === null ? "Shown: current text" : "Show current text"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPick(before ? POINT_IN_TIME_START : v.date)}
                    className={cn(
                      "mt-0.5 text-[11px] hover:underline",
                      selected === (before ? POINT_IN_TIME_START : v.date)
                        ? "font-medium text-foreground"
                        : "text-primary",
                    )}
                  >
                    Text as of {before ? POINT_IN_TIME_START : v.date}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
      {versions.length > VISIBLE ? (
        <button
          type="button"
          onClick={() => setAll((x) => !x)}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          {all ? "Show fewer" : `Show all ${versions.length} versions`}
        </button>
      ) : null}
    </div>
  );
}

/** Free date entry for the live "as of" view (2017-01-03 to today). */
export function AsOfPicker({
  value,
  today,
  onPick,
}: {
  value: string | null;
  today: string;
  onPick: (date: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft) onPick(draft);
      }}
    >
      <label htmlFor="cfr-asof" className="text-[11px] text-muted-foreground">
        <History className="mr-1 inline size-3" aria-hidden />
        Text as of
      </label>
      <input
        id="cfr-asof"
        type="date"
        min={POINT_IN_TIME_START}
        max={today}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
      />
      <button
        type="submit"
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        disabled={!draft}
      >
        Show
      </button>
    </form>
  );
}
