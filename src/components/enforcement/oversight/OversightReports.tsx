import { useState } from "react";
import { Segmented } from "../parts";
import { DojView } from "./DojView";
import { IgReports } from "./IgReports";
import { OscView } from "./OscView";

export type OversightSource = "ig" | "osc" | "doj";
type Source = OversightSource;

/**
 * "Oversight reports" tab of the Enforcement page: official oversight and accountability publications. Inspectors General
 * reports come from Oversight.gov, the Office of Special Counsel's from osc.gov, and the Department of Justice's
 * corporate-enforcement resolutions and document indexes from justice.gov. Every row links to the official page.
 */
export function OversightReports({ initialSource = "ig" }: { initialSource?: OversightSource }) {
  const [source, setSource] = useState<Source>(initialSource);
  const [oig, setOig] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Source>
          label="Oversight source"
          value={source}
          onChange={setSource}
          options={[
            { id: "ig", label: "Inspectors General" },
            { id: "osc", label: "Special Counsel" },
            { id: "doj", label: "Justice Department" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          Official publications, shown as published. Figures are the publishers&rsquo;, not audited
          here.
        </p>
      </div>
      {source === "ig" ? <IgReports presetOig={oig} /> : null}
      {source === "osc" ? <OscView /> : null}
      {source === "doj" ? (
        <DojView
          onOpenOig={(name) => {
            setOig(name);
            setSource("ig");
          }}
        />
      ) : null}
    </div>
  );
}
