import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink } from "lucide-react";
import { markImageFailed, useImageFailed } from "@/components/visuals/failedImages";
import { ImageLoadFailed, OpenImageCredit } from "@/components/visuals/ImageCredit";
import { openCompanyLogoQuery } from "@/components/visuals/queries";
import { CIK, TRADEMARK_NOTE } from "@/lib/visuals/companyLogos";
import { cn } from "@/lib/utils";
import { companyfactsUrl, edgarCompanyUrl, NOT_RECORDED, type CompanySummary } from "./companyData";
import { fiscalYearEnd, stateName, tickerLine, type StatementsProfile } from "./companyStatements";

/** The open-licence logo of this CIK, read only when no site icon is stored (dataset company_logos_open). */
function useOpenLogo(cik: string | undefined, hasSiteIcon: boolean) {
  const valid = !!cik && CIK.test(cik);
  const q = useQuery({ ...openCompanyLogoQuery(cik ?? ""), enabled: valid && !hasSiteIcon });
  return valid && !hasSiteIcon ? (q.data ?? null) : null;
}

/**
 * The company's own site icon (acquired from its website; see scripts/enrichment/sec/acquire_company_logos.py). When
 * none is stored and the statements read has settled, the open-licence logo its Wikidata entity states (shown to
 * identify the company; its credit and trademark note sit under the company facts).
 */
export function CompanyLogo({
  profile,
  size = 40,
  cik,
  settled = true,
}: {
  profile: StatementsProfile | null;
  size?: number;
  cik?: string;
  /** False while the statements read (which carries the site icon) is still pending. */
  settled?: boolean;
}) {
  const logo = profile?.logo;
  const open = useOpenLogo(cik, !!logo);
  const openFailed = useImageFailed(open?.thumb.url);
  if (!logo && settled && open && !openFailed)
    return (
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-xs"
        style={{ width: size, height: size }}
        title={`${TRADEMARK_NOTE} Logo: ${open.license} · Wikimedia Commons`}
      >
        <img
          src={open.thumb.url}
          alt=""
          width={size - 8}
          height={size - 8}
          className="max-h-full max-w-full object-contain p-1"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => markImageFailed(open.thumb.url)}
        />
      </span>
    );
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-xs text-muted-foreground"
      style={{ width: size, height: size }}
      title={
        logo
          ? `Site icon from ${logo.sourcePage ?? "the company's website"}${logo.retrieved ? `, retrieved ${logo.retrieved}` : ""}`
          : "No logo from the company's own website is stored"
      }
    >
      {logo ? (
        <img
          src={logo.path}
          alt=""
          width={size - 8}
          height={size - 8}
          className="max-h-full max-w-full object-contain p-1"
          loading="lazy"
        />
      ) : (
        <Building2 className="size-5" aria-hidden />
      )}
    </span>
  );
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("line-clamp-2 break-words text-xs", mono && "font-mono")}>{children}</dd>
    </div>
  );
}

function SiteLink({ site, namedIn }: { site: string | null; namedIn: string | null }) {
  if (!site) return <>{NOT_RECORDED}</>;
  return (
    <>
      <a
        href={`https://${site}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
        title={`https://${site}${namedIn ? `, named in the annual report filed ${namedIn}` : ""}`}
      >
        <span className="truncate">{site}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
      {staleReport(namedIn) ? (
        <span
          className="block text-[11px] text-muted-foreground"
          title="The annual report naming this site is more than two years old; the domain may have changed hands."
        >
          named in {namedIn!.slice(0, 4)}; may have changed hands
        </span>
      ) : null}
    </>
  );
}

/** An annual report more than two years old may name a domain the company no longer holds. */
function staleReport(date: string | null) {
  if (!date) return false;
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  return date < cutoff.toISOString().slice(0, 10);
}

export function CompanyFacts({
  cik,
  profile: p,
  summary,
}: {
  cik: string;
  profile: StatementsProfile | null;
  summary: CompanySummary | null;
}) {
  const s = summary?.profile ?? null;
  const sic = p?.sic ?? s?.sic ?? null;
  const sicDescription = p?.sicDescription ?? s?.sicDescription ?? null;
  const state = p?.stateOfIncorporation ?? s?.stateOfIncorporation ?? null;
  const fye = p?.fiscalYearEnd ?? s?.fiscalYearEnd ?? null;
  const address = s
    ? [s.businessCity, s.businessStateName ?? s.businessState].filter(Boolean).join(", ")
    : "";
  const annual =
    p?.filings.find((f) => ["10-K", "20-F", "40-F", "10-KT"].includes(f.form))?.date ?? null;
  return (
    <section aria-label="Company facts" className="rounded-xl border border-border bg-surface">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-5 gap-y-1 px-3.5 py-2.5 text-[12.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span>
            <b className="font-semibold text-foreground">{tickerLine(p, summary)}</b>
          </span>
          <span>{sicDescription ?? NOT_RECORDED}</span>
          <span>{address || NOT_RECORDED}</span>
          <span>Incorporated in {stateName(state)}</span>
          <span>FY ends {fiscalYearEnd(fye)}</span>
          <span className="font-mono text-[11px]">CIK {cik}</span>
          <span className="ml-auto font-medium text-primary group-open:hidden">
            Company details
          </span>
          <span className="ml-auto hidden font-medium text-primary group-open:inline">
            Hide details
          </span>
        </summary>
        <div className="border-t border-border/70 p-3.5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <Fact label="Tickers and exchange">{tickerLine(p, summary)}</Fact>
            <Fact label="Industry (SIC)">
              <span title={sic ? `SIC ${sic}` : undefined}>
                {sicDescription ?? NOT_RECORDED}
                {sic ? <span className="text-muted-foreground"> · {sic}</span> : null}
              </span>
            </Fact>
            <Fact label="State of incorporation">{stateName(state)}</Fact>
            <Fact label="Fiscal year ends">{fiscalYearEnd(fye)}</Fact>
            <Fact label="Website">
              <SiteLink site={p?.website ?? null} namedIn={annual} />
            </Fact>
            <Fact label="Investor relations">
              <SiteLink site={p?.irWebsite ?? null} namedIn={annual} />
            </Fact>
            <Fact label="CIK" mono>
              {cik}
            </Fact>
            <Fact label="Filer category">{p?.category ?? NOT_RECORDED}</Fact>
            <Fact label="Business address">{address || NOT_RECORDED}</Fact>
            <Fact label="Market price">
              <span className="text-muted-foreground" title={p?.priceNote ?? undefined}>
                No price source connected
              </span>
            </Fact>
            <Fact label="SEC filings">
              <a
                href={edgarCompanyUrl(cik)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                EDGAR <ExternalLink className="size-3" aria-hidden />
              </a>
            </Fact>
            <Fact label="XBRL facts">
              {p?.statements ? (
                <a
                  href={companyfactsUrl(cik)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  companyfacts <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                <span className="text-muted-foreground">None filed</span>
              )}
            </Fact>
          </dl>
          <div className="mt-2.5 border-t border-border/60 pt-2 text-xs leading-5">
            {p?.description ? (
              <p>
                {p.description}{" "}
                {p.descriptionSource ? (
                  <a
                    href={p.descriptionSource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap text-[11px] text-primary hover:underline"
                  >
                    Item 1, Form {p.descriptionSource.form} filed {p.descriptionSource.date}
                  </a>
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Business description: {NOT_RECORDED}. No passage of the latest annual report&rsquo;s
                business section could be quoted word for word.
              </p>
            )}
            {s?.formerNames.length ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Former names: {s.formerNames.join("; ")}
              </p>
            ) : null}
            {summary?.coRegistrantOf.length ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Files as a co-registrant with {summary.coRegistrantOf.join("; ")}.
              </p>
            ) : null}
            <OpenLogoCredit cik={cik} hasSiteIcon={!!p?.logo} />
          </div>
        </div>
      </details>
    </section>
  );
}

/** Credit and trademark note for the open-licence logo shown in the page header; nothing when none is shown. */
function OpenLogoCredit({ cik, hasSiteIcon }: { cik: string; hasSiteIcon: boolean }) {
  const open = useOpenLogo(cik, hasSiteIcon);
  const failed = useImageFailed(open?.thumb.url);
  if (!open) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
      {failed ? <ImageLoadFailed image={open} noun="logo" /> : null}
      <OpenImageCredit image={open} label="Logo" compact className="text-[11px]" />
      <p className="m-0">{TRADEMARK_NOTE}</p>
    </div>
  );
}
