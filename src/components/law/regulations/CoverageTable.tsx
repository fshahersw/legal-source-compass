import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { stateByUsps } from "@/lib/corpus/geo";
import type { RegCode } from "@/lib/external/stateRegs.functions";
import { ACQUISITION_LABEL, STATUS_LABEL, robotsLine } from "./labels";

/**
 * The coverage matrix of the 51 jurisdictions: official publisher, how the code is served, what is held here, and the
 * state register. Every state links to its page; every publisher links to its official address.
 */
export function CoverageTable({ codes }: { codes: RegCode[] }) {
  const sorted = [...codes].sort((a, b) =>
    (stateByUsps.get(a.state)?.name ?? a.state).localeCompare(
      stateByUsps.get(b.state)?.name ?? b.state,
    ),
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
      <table className="w-full min-w-[44rem] border-collapse text-left text-[13px]">
        <caption className="sr-only">
          State administrative codes: publisher, access and coverage
        </caption>
        <thead className="border-b border-border text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              State
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Administrative code and publisher
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Rule text here
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Contents
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium xl:table-cell">
              robots.txt
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Register
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {sorted.map((c) => (
            <tr key={c.state} className="align-top">
              <td className="whitespace-nowrap px-3 py-1.5">
                <Link
                  to="/law/regulations/$state"
                  params={{ state: c.state }}
                  search={{ q: "", level: undefined }}
                  className="font-medium text-primary hover:underline"
                >
                  {stateByUsps.get(c.state)?.name ?? c.state}
                </Link>
              </td>
              <td className="px-3 py-1.5">
                <a
                  href={c.codeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {c.codeName}
                  <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
                </a>
                <span className="block text-[11px] text-muted-foreground">
                  {c.publisher}
                  {c.status !== "official_free" ? ` · ${STATUS_LABEL[c.status] ?? c.status}` : ""}
                </span>
              </td>
              <td className="px-3 py-1.5">
                {c.acquisition === "acquired"
                  ? `${c.textRules.toLocaleString("en-US")} rules`
                  : c.acquisition === "sample" && c.sampleRules !== null
                    ? `Sample of ${c.sampleRules.toLocaleString("en-US")} rules`
                    : ACQUISITION_LABEL[c.acquisition]}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {c.indexNodes ? `${c.indexNodes.toLocaleString("en-US")} headings` : "Not loaded"}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-1.5 text-muted-foreground xl:table-cell">
                {robotsLine(c)}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {c.registerName ? (
                  c.registerUrl ? (
                    <a
                      href={c.registerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {c.registerName}
                    </a>
                  ) : (
                    c.registerName
                  )
                ) : (
                  "None published"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
