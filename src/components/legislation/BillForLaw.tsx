import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText } from "lucide-react";
import { getBillForLaw } from "@/lib/external/legislation.functions";
import { fmtDay } from "./format";

const CONGRESS = /^(10[89]|11[0-9])$/;

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * For a public_laws_enacted record page: reads the law number GovInfo printed (law.public_law {congress, number}) from
 * the record and shows its originating bill. A number GovInfo prints on more than one measure (pl_shared) is not used.
 */
export function BillForPublicLawRecord({ raw }: { raw: Record<string, unknown> }) {
  const law = asObj(raw["law"]) ?? asObj(asObj(raw["detail"])?.["law"]);
  const pl = asObj(law?.["public_law"]);
  const c = pl?.["congress"];
  const n = pl?.["number"];
  if (law?.["pl_shared"] === true || typeof c !== "number" || typeof n !== "number") return null;
  return <BillForLaw congress={c} lawNumber={n} />;
}

/**
 * The originating bill of a public law, for law pages: the measure whose GovInfo Bill Status file lists this law number
 * (exact Congress and number). Outside the 108th–119th Congress nothing is shown; no match says so.
 */
export function BillForLaw({
  congress,
  lawNumber,
}: {
  congress: number | string;
  lawNumber: number | string;
}) {
  const c = String(congress);
  const n = String(lawNumber);
  const covered = CONGRESS.test(c) && /^[1-9]\d{0,3}$/.test(n);
  const fn = useServerFn(getBillForLaw);
  const q = useQuery({
    queryKey: ["bill-for-law", c, n],
    queryFn: () => fn({ data: { congress: c, number: n } }),
    enabled: covered,
    staleTime: 30 * 60 * 1000,
  });
  if (!covered) return null;
  return (
    <section
      aria-label="Originating bill"
      className="rounded-md border border-border bg-surface px-3 py-2 text-[12.5px]"
    >
      <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
        <FileText className="size-3.5" aria-hidden />
        Originating bill
      </h2>
      {q.isPending ? (
        <p role="status" aria-busy="true" className="m-0 text-muted-foreground">
          Loading…
        </p>
      ) : q.isError ? (
        <p role="alert" className="m-0 text-muted-foreground">
          The bill could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : q.data.bills.length ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {q.data.bills.map((b) => (
            <li key={b.id}>
              <Link
                to="/law/legislation/federal/$congress/$type/$number"
                params={{ congress: String(b.congress), type: b.type, number: b.number }}
                className="font-medium text-primary hover:underline"
              >
                {b.citation}
              </Link>
              <span className="ml-1">{b.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {b.sponsor ?? "Sponsor not recorded"} · introduced {fmtDay(b.introduced)}
                {b.status === "became_law"
                  ? ""
                  : " · lists this law, but no became-law action is recorded for this measure"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-muted-foreground">
          No bill in the 108th–119th Congress Bill Status files lists Public Law {c}-{n}.
        </p>
      )}
    </section>
  );
}
