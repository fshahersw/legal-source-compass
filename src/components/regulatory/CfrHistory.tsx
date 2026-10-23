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
  const asOfOf = (v: CfrVersion) => (v.date < POINT_IN_TIME_START ? POINT_IN_TIME_START : v.date);
  // One "text as of" link per date: several versions can share a date (an editorial and a substantive change),
  // and the newest date is the current text.
  const linked = new Set<string>();
  const linkFor = versions.map((v, k) => {
    const d = asOfOf(v);
    if (k === 0 || v.removed || linked.has(d)) {
      linked.add(d);
      return false;
    }
    linked.add(d);
    return true;
  });
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
                    : !v.substantive
                      ? "Editorial change"
                      : before
                        ? "In effect when the record begins"
                        : "Substantive change"}
                </span>
              </div>
              {v.issueDate && v.issueDate !== v.date ? (
                <div className="text-[10px] leading-tight text-muted-foreground tabular-nums">
                  Incorporated in the eCFR {v.issueDate}
                </div>
              ) : null}
              <FrLinks v={v} labels={history.basisLabels} />
              {latest && !v.removed ? (
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
              ) : linkFor[k] ? (
                <button
                  type="button"
                  onClick={() => onPick(asOfOf(v))}
                  className={cn(
                    "mt-0.5 text-[11px] hover:underline",
                    selected === asOfOf(v) ? "font-medium text-foreground" : "text-primary",
                  )}
                >
                  Text as of {asOfOf(v)}
                </button>
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
