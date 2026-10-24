/**
 * Company logos (dataset company_logos_open, id = 10-digit SEC CIK). The logo is the one the company's Wikidata entity
 * states (P154), with its recorded licence and source page (owner decision 2026-10-24: shown whatever its rights
 * status). It is shown only to identify the company, with the trademark note, and only where no site icon from the
 * company's own website is stored. A record that fails the shape checks is dropped, never repaired.
 */
import { obj, parseOpenImage, text, type OpenImage } from "./common";

export const COMPANY_LOGOS_DATASET = "company_logos_open";
export const CIK = /^\d{10}$/;

/** Shown with every logo from this dataset. */
export const TRADEMARK_NOTE =
  "Logo shown to identify the company. Trademarks belong to their owners; no endorsement implied.";

export type OpenCompanyLogo = OpenImage & {
  cik: string;
  wikidata: string;
  statementId: string;
};

export function parseCompanyLogo(cik: string, raw: unknown): OpenCompanyLogo | null {
  if (!CIK.test(cik)) return null;
  const l = obj(raw);
  const image = parseOpenImage(raw);
  const wikidata = text(l?.["wikidata"], 20);
  const statementId = text(l?.["statement_id"], 120);
  if (!image || !wikidata || !statementId) return null;
  if (!/^Q\d{1,12}$/.test(wikidata)) return null;
  // A Wikidata statement id names its own entity: "Q159433$f2dae5b9-…".
  if (!statementId.startsWith(`${wikidata}$`) || !/^Q\d+\$[0-9A-Fa-f-]{8,64}$/.test(statementId))
    return null;
  return { ...image, cik, wikidata, statementId };
}

/** The entity page holding the logo statement. */
export const wikidataUrl = (l: Pick<OpenCompanyLogo, "wikidata">) =>
  `https://www.wikidata.org/wiki/${l.wikidata}#P154`;
