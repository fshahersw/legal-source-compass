/**
 * Defendant disclosure radar: which tracked product torts each company names in the Item 3 and litigation notes of its
 * own Form 10-K (company_sec_legal_proceedings), by fiscal year, and when a company names one for the first time.
 * Pure; no I/O.
 *
 * A term match is a mention in the company's own disclosure, never MDL membership, and never feeds exposure counts.
 * Terms use word boundaries (a loose "NEC" matched "necessary"), and the infant-formula "NEC" abbreviation counts only
 * next to formula, infant, preterm or premature. "First disclosure" means the term appears in a fiscal year's 10-K and
 * not in an earlier 10-K of the same company held here; a company's earliest held 10-K is never counted as new.
 */

export type TortTerm = { id: string; label: string; re: RegExp };

export const TORT_TERMS: readonly TortTerm[] = [
  { id: "depo", label: "Depo-Provera", re: /\bDepo-?Provera\b/i },
  {
    id: "glp1",
    label: "GLP-1 drugs",
    re: /\bGLP-1\b|\b(?:semaglutide|tirzepatide|Ozempic|Wegovy|Mounjaro|Zepbound)\b/i,
  },
  {
    id: "pfas",
    label: "PFAS / AFFF",
    re: /\bPFAS\b|\bAFFF\b|\bper-?\s?and\s?poly-?fluoroalkyl\b|\baqueous film[- ]forming foam\b/i,
  },
  { id: "talc", label: "Talc", re: /\btalc(?:um)?\b/i },
  { id: "ranitidine", label: "Ranitidine / Zantac", re: /\branitidine\b|\bZantac\b/i },
  { id: "suboxone", label: "Suboxone", re: /\bSuboxone\b/i },
  {
    id: "hernia",
    label: "Hernia mesh",
    re: /\bhernia (?:mesh|repair (?:mesh|products?|devices?))\b/i,
  },
  {
    id: "nec",
    label: "Infant formula NEC",
    re: /\bnecrotizing enterocolitis\b|\bNEC\b(?=[^.]{0,150}\b(?:formula|infant|preterm|premature)\b)/,
  },
  { id: "opioids", label: "Opioids", re: /\bopioids?\b/i },
  { id: "hair", label: "Hair relaxer", re: /\bhair[- ]relax(?:er|ers|ing)\b/i },
  { id: "paraquat", label: "Paraquat", re: /\bparaquat\b/i },
  { id: "roundup", label: "Roundup / glyphosate", re: /\bRoundup\b|\bglyphosate\b/ },
  { id: "earplugs", label: "Combat Arms earplugs", re: /\bCombat Arms\b/i },
  { id: "cpap", label: "CPAP devices", re: /\bCPAP\b|\bsleep apnea (?:devices|machines)\b/ },
  { id: "ivc", label: "IVC filters", re: /\bIVC filters?\b|\binferior vena cava filters?\b/i },
  { id: "tepezza", label: "Tepezza", re: /\bTepezza\b/i },
  { id: "bairhugger", label: "Bair Hugger", re: /\bBair Hugger\b/i },
  { id: "valsartan", label: "Valsartan", re: /\bvalsartan\b/i },
  { id: "elmiron", label: "Elmiron", re: /\bElmiron\b|\bpentosan polysulfate\b/i },
  { id: "taxotere", label: "Taxotere / docetaxel", re: /\bTaxotere\b|\bdocetaxel\b/i },
  { id: "gardasil", label: "Gardasil", re: /\bGardasil\b/i },
  { id: "eto", label: "Ethylene oxide", re: /\bethylene oxide\b/i },
];

export type FilingText = {
  cik: string;
  company: string;
  accession: string;
  /** Fiscal year: the year of the period the 10-K covers. */
  fy: string;
  filed: string | null;
  url: string | null;
  /** Item 3 plus the litigation notes it points to, verbatim. */
  text: string;
  mdls: number[];
};

export type FirstDisclosure = {
  term: string;
  cik: string;
  company: string;
  fy: string;
  priorFy: string;
  accession: string;
  filed: string | null;
  url: string | null;
  excerpt: string;
};

export type NewMdlCite = {
  cik: string;
  company: string;
  fy: string;
  mdl: number;
  accession: string;
};

export type DisclosureRadar = {
  /** Fiscal years with at least `minFilings` filings held (the heatmap columns). */
  years: string[];
  filingsByYear: Record<string, number>;
  companies: number;
  filings: number;
  /** Companies naming each term per fiscal year. */
  cells: { term: string; fy: string; companies: number; firsts: number }[];
  firsts: FirstDisclosure[];
  newMdls: NewMdlCite[];
};

/** Verbatim words around the first match: up to `radius` characters each side, whitespace collapsed. */
export function excerptAround(text: string, re: RegExp, radius = 180): string {
  const flags = re.flags.replace("g", "");
  const m = new RegExp(re.source, flags).exec(text);
  if (!m) return "";
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "… " : ""}${body}${end < text.length ? " …" : ""}`;
}

export function disclosureRadar(
  filings: readonly FilingText[],
  options: { minFilings?: number; terms?: readonly TortTerm[] } = {},
): DisclosureRadar {
  const terms = options.terms ?? TORT_TERMS;
  const minFilings = options.minFilings ?? 20;
  const filingsByYear: Record<string, number> = {};
  for (const f of filings) filingsByYear[f.fy] = (filingsByYear[f.fy] ?? 0) + 1;
  const years = Object.keys(filingsByYear)
    .filter((y) => filingsByYear[y]! >= minFilings)
    .sort();

  // per company, per fiscal year: the terms named and the filing that named each first
  const byCompany = new Map<string, FilingText[]>();
  for (const f of filings) {
    const list = byCompany.get(f.cik) ?? [];
    list.push(f);
    byCompany.set(f.cik, list);
  }
  const hits = new Map<string, Set<string>>(); // `${term}|${fy}` -> ciks
  const firsts: FirstDisclosure[] = [];
  const newMdls: NewMdlCite[] = [];
  for (const [cik, list] of byCompany) {
    const sorted = [...list].sort(
      (a, b) => a.fy.localeCompare(b.fy) || (a.filed ?? "").localeCompare(b.filed ?? ""),
    );
    const fys = [...new Set(sorted.map((f) => f.fy))];
    const seenTerms = new Set<string>();
    const seenMdls = new Set<number>();
    fys.forEach((fy, i) => {
      const inYear = sorted.filter((f) => f.fy === fy);
      const named = new Map<string, FilingText>();
      for (const t of terms)
        for (const f of inYear) if (!named.has(t.id) && t.re.test(f.text)) named.set(t.id, f);
      for (const [term, f] of named) {
        const key = `${term}|${fy}`;
        const set = hits.get(key) ?? new Set<string>();
        set.add(cik);
        hits.set(key, set);
        if (i > 0 && !seenTerms.has(term)) {
          const t = terms.find((x) => x.id === term)!;
          firsts.push({
            term,
            cik,
            company: f.company,
            fy,
            priorFy: fys[i - 1]!,
            accession: f.accession,
            filed: f.filed,
            url: f.url,
            excerpt: excerptAround(f.text, t.re),
          });
        }
      }
      for (const term of named.keys()) seenTerms.add(term);
      const cited = new Set(inYear.flatMap((f) => f.mdls));
      for (const n of cited) {
        if (i > 0 && !seenMdls.has(n)) {
          const f = inYear.find((x) => x.mdls.includes(n))!;
          newMdls.push({ cik, company: f.company, fy, mdl: n, accession: f.accession });
        }
      }
      for (const n of cited) seenMdls.add(n);
    });
  }
  const cells = terms.flatMap((t) =>
    years.map((fy) => ({
      term: t.id,
      fy,
      companies: hits.get(`${t.id}|${fy}`)?.size ?? 0,
      firsts: firsts.filter((x) => x.term === t.id && x.fy === fy).length,
    })),
  );
  firsts.sort(
    (a, b) =>
      b.fy.localeCompare(a.fy) ||
      a.term.localeCompare(b.term) ||
      a.company.localeCompare(b.company),
  );
  newMdls.sort((a, b) => b.fy.localeCompare(a.fy) || a.mdl - b.mdl);
  return {
    years,
    filingsByYear,
    companies: byCompany.size,
    filings: filings.length,
    cells,
    firsts,
    newMdls,
  };
}
