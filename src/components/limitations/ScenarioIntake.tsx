import { useId, useState } from "react";
import { FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STATES } from "@/lib/corpus/geo";
import { CLAIM_LABELS, type ClaimType } from "@/lib/limitations/types";
import {
  confirmIntake,
  INTAKE_FIELD_LABELS,
  INTAKE_MAX_LENGTH,
  parseIntake,
  type ConfirmedIntake,
  type IntakeField,
  type IntakeResult,
} from "@/lib/limitations/intake";

export function ScenarioIntake({ onApply }: { onApply: (intake: ConfirmedIntake) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [selected, setSelected] = useState<IntakeField[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <details className="rounded-md border border-primary/20 bg-primary/[.03]">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 sm:min-h-10 text-sm font-semibold text-primary">
        <FileText className="size-4 shrink-0" aria-hidden="true" />
        Start with a description
        <span className="ml-auto text-xs font-normal text-muted-foreground">Optional</span>
      </summary>
      <div className="space-y-3 border-t border-primary/10 p-3">
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          Extract explicitly named facts, then check them before applying. This local helper does
          not decide governing law, classify an accident, or calculate a deadline. Your text stays
          in this tab and is not sent to an AI service.
        </p>
        <label htmlFor={id} className="block text-sm font-medium">
          Describe one claim
        </label>
        <textarea
          id={id}
          rows={4}
          maxLength={INTAKE_MAX_LENGTH}
          aria-describedby={`${id}-help`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
            setSelected([]);
            setConfirmed(false);
          }}
          placeholder="Example format: California. Personal injury. Injury date: January 15, 2024. Accrual date: January 15, 2024. Include any exceptions you need to review."
          className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Dates: YYYY-MM-DD or January 15, 2024. Label each date's role.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!text.trim()}
            onClick={() => {
              const parsed = parseIntake(text);
              setResult(parsed);
              setSelected(parsed.facts.map((fact) => fact.field));
              setConfirmed(false);
            }}
          >
            Review extracted facts
          </Button>
        </div>
        {result && (
          <div className="space-y-3 border-t border-border pt-3" aria-live="polite">
            <p className="text-sm font-semibold">
              {result.facts.length ? "Check these proposals" : "No unambiguous facts to apply"}
            </p>
            {!result.facts.length && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Use the state and claim selectors below. Enter dates in the timeline; a narrative
                incident date alone does not establish legal accrual.
              </p>
            )}
            <div className="divide-y divide-border">
              {result.facts.map((fact) => {
                const label =
                  fact.field === "jurisdiction"
                    ? (STATES.find((state) => state.usps === fact.value)?.name ?? fact.value)
                    : fact.field === "claimType"
                      ? CLAIM_LABELS[fact.value as ClaimType]
                      : fact.value;
                return (
                  <label
                    key={fact.field}
                    className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-primary"
                      checked={selected.includes(fact.field)}
                      onChange={(event) => {
                        setSelected((old) =>
                          event.target.checked
                            ? [...old, fact.field]
                            : old.filter((key) => key !== fact.field),
                        );
                        setConfirmed(false);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {INTAKE_FIELD_LABELS[fact.field]}: {label}
                      </span>
                      <span className="mt-1 block break-words text-xs text-muted-foreground">
                        From: “{fact.evidence}”
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {result.notes.length > 0 && (
              <details className="rounded-md bg-muted/50 p-3 text-xs" open>
                <summary className="cursor-pointer font-medium">
                  Needs manual entry or clarification ({result.notes.length})
                </summary>
                <ul className="mt-2 list-disc space-y-1 break-words pl-4 text-muted-foreground">
                  {result.notes.map((note) => (
                    <li key={note.text}>{note.text}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.reviewTopics.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
                <p className="font-medium">Mentions requiring review</p>
                <p className="mt-1">
                  {result.reviewTopics.map((topic) => topic.label).join("; ")}.
                </p>
                <p className="mt-1 text-muted-foreground">
                  These screening questions will start as “Needs review”, including negated
                  mentions. No time is added or removed.
                </p>
              </div>
            )}
            {result.facts.length > 0 && (
              <>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I checked the selected facts against my records. Apply these facts as a new
                    draft; legal applicability and all exception answers still require review.
                  </span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={!confirmed || !selected.length}
                  onClick={() => {
                    const accepted = confirmIntake(result, selected, confirmed);
                    if (accepted) onApply(accepted);
                  }}
                >
                  Apply checked facts <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
