/** Publisher identifier syntax, shared by the ingest validator and SQL generator. */
export const ID_PATTERNS: Record<string, string> = {
  court: "^[A-Za-z0-9][A-Za-z0-9-]*$",
  mdl: "^MDL-[1-9][0-9]*$",
  agency: "^[a-z0-9]+(-[a-z0-9]+)*$",
  // Earlier FR issues retain two-digit years and E/F-series numbers. Corrections
  // retain their C1-/C2- prefix; publication date is independent of this number.
  fr_document: "^(C[0-9]+-)?([0-9]{2}|[0-9]{4}|[A-Z][0-9]{1,2})-[0-9]{1,6}$",
  cfr_section: "^[0-9]+ CFR [0-9]+(\\.[0-9]+)?[a-zA-Z]?(\\([a-zA-Z0-9]+\\))*$",
  usc_section: "^[0-9]+ USC [0-9]+[a-zA-Z]?([–-][0-9]+[a-zA-Z]?)?(\\([a-zA-Z0-9]+\\))*$",
  rule_proceeding: "^[0-9]{4}-[A-Z0-9]{4}$",
  bill: "^[0-9]{1,3}-(hr|s|hjres|sjres|hconres|sconres|hres|sres)-[1-9][0-9]*$",
  public_law: "^PL [0-9]{1,3}-[1-9][0-9]*$",
};

export const ID_AUTHORITIES: Record<string, readonly string[]> = {
  court: ["courtlistener"], judge: ["courtlistener", "fjc"],
  case: ["courtlistener", "cap"], docket: ["courtlistener"],
  docket_entry: ["courtlistener"], opinion: ["courtlistener", "cap"],
  mdl: ["jpml"], agency: ["federal_register"], fr_document: ["federal_register"],
  cfr_section: ["ecfr"], usc_section: ["uscode"],
  bill: ["congress"], public_law: ["congress"],
};

export const NATIVE_NUMERIC_TYPES = ["opinion", "case", "docket", "docket_entry", "attorney", "party", "judge"];
export const NATIVE_NUMERIC_AUTHORITIES = ["courtlistener", "fjc", "cap"];
