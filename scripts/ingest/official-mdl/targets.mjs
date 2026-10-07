// Official transferee-court MDL pages for Seeger Weiss matters (discovered 2026-10-03; see _work/agents/official-mdl/PROGRESS.md).
// `case_number` is the case number AS PRINTED on the court's page: `literal` must be found verbatim in the captured page (checked at queue-build time).
// A matter with `pages: []` has no official MDL page that could be located; the reason is recorded in `note` and in the progress log, never guessed around.
export const MATTERS = {
  '2738': {
    name: 'In re Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 1,
    case_number: { literal: '3:16-md-02738', page_id: 'njd-2738-main', note: 'printed in "Log into PACER for Master Docket 3:16-md-02738"' },
    pages: [
      { id: 'njd-2738-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/johnson-johnson-talcum-powder-litigation' },
      { id: 'njd-2738-orders', role: 'orders_and_opinions', family: 'njd-body', url: 'https://www.njd.uscourts.gov/j-j-talcum-powder-orders' },
      { id: 'njd-2738-panel-orders', role: 'panel_orders', family: 'njd-body', url: 'https://www.njd.uscourts.gov/j-j-talcum-powder-panel-orders' },
      { id: 'njd-2738-scheduling-orders', role: 'scheduling_orders', family: 'njd-body', url: 'https://www.njd.uscourts.gov/j-j-talcum-upcoming-court-proceedings-scheduling-orders' },
    ],
    index_pages: ['njd-mdl-cases'],
  },
  '3060': {
    name: 'In re Hair Relaxer Marketing, Sales Practices, and Products Liability Litigation', court_id: 'ilnd', host: 'www.ilnd.uscourts.gov', tier: 1,
    case_number: { literal: '1:23-cv-00818', page_id: 'ilnd-3060-mdl', note: 'the court states "Orders are also entered in the lead case docket, 23-cv-00818" and its Member Cases table prints 1:23-cv-00818' },
    pages: [{ id: 'ilnd-3060-mdl', role: 'mdl_page', family: 'ilnd-mdl-details', url: 'https://www.ilnd.uscourts.gov/mdl-details.aspx?91eSFtoI+ycFmA6482wQKA==' }],
    index_pages: ['ilnd-mdl-index'],
  },
  '3114': {
    name: 'In re AT&T Inc. Customer Data Security Breach Litigation', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 1,
    case_number: { literal: '3:24-md-03114-D', page_id: 'txnd-3114-mdl', note: 'printed under the caption and in the page title "MDL 3:24-md-03114-D"' },
    pages: [{ id: 'txnd-3114-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-324-md-03114' }],
    index_pages: [],
  },
  '3163': {
    name: 'In re Glucagon-like Peptide-1 Receptor Agonists (GLP-1 RAs) Non-Arteritic Anterior Ischemic Optic Neuropathy (NAION) Products Liability Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 1,
    // The court's listing pages print only "MDL 3163". Every court PDF carries the ECF stamp "Case 2:25-md-03163-KSM Document <n> Filed <date> Page x of y";
    // the literal below was read from page 1 of CMO No. 1 (PyMuPDF text extraction) and is re-checked against every stored PDF after transfer.
    case_number: { literal: '2:25-md-03163-KSM', note: 'printed in the ECF header stamp of the court PDFs (not on the listing page)',
      pdf_evidence: { url: 'https://www.paed.uscourts.gov/sites/paed/files/mdl-orders/25md3163_cm-ord_1.pdf', sha256: 'b166df052dd902849d56984e23b45a536a863a5738bce54f492f102e7e639f43', page: 1, context: 'Case 2:25-md-03163-KSM Document 2 Filed 12/23/25 Page 1 of 5', retrieved_at: null } },
    printed_mdl_literal: 'MDL 3163',
    pages: [
      { id: 'paed-3163-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl3163/orders' },
      { id: 'paed-3163-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl3163' },
    ],
    index_pages: ['paed-mdl-hub'],
  },
  '3185': {
    name: 'In re Cognizant Technology Solutions Corporation and TriZetto Provider Solutions, LLC, Data Breach Security Litigation', court_id: 'moed', host: 'www.moed.uscourts.gov', tier: 1,
    case_number: { literal: '4:26-md-3185', page_id: 'moed-3185-mdl', note: 'the page heading' },
    pages: [{ id: 'moed-3185-mdl', role: 'mdl_page', family: 'moed-mdl-page', url: 'https://www.moed.uscourts.gov/mdl/426-md-3185' }],
    index_pages: ['moed-mdl-index'],
  },
  // E.D. Mo. court MDL index pages (moed-mdl-page on embedded node--mdl-orders; docket literals from page titles).
  '424520': {
    name: 'MOED multidistrict page 4:24-cv-00520', court_id: 'moed', host: 'www.moed.uscourts.gov', tier: 2,
    case_number: { literal: '4:24-CV-00520', page_id: 'moed-424-mdl', note: 'page title h1' },
    pages: [{ id: 'moed-424-mdl', role: 'mdl_page', family: 'moed-mdl-page', url: 'https://www.moed.uscourts.gov/mdl/424-cv-00520' }],
    index_pages: [],
  },
  '4251580': {
    name: 'MOED multidistrict page 4:25-cv-01580', court_id: 'moed', host: 'www.moed.uscourts.gov', tier: 2,
    case_number: { literal: '4:25-cv-01580', page_id: 'moed-425-mdl', note: 'page title h1' }, // title prints lowercase cv
    pages: [{ id: 'moed-425-mdl', role: 'mdl_page', family: 'moed-mdl-page', url: 'https://www.moed.uscourts.gov/mdl/425-cv-01580' }],
    index_pages: [],
  },
  '416180': {
    name: 'MOED multidistrict page 4:16-cv-180-CDP', court_id: 'moed', host: 'www.moed.uscourts.gov', tier: 2,
    case_number: { literal: '4:16-cv-180-CDP', page_id: 'moed-416-mdl', note: 'page title h1' },
    pages: [{ id: 'moed-416-mdl', role: 'mdl_page', family: 'moed-mdl-page', url: 'https://www.moed.uscourts.gov/mdl/416-cv-180-cdp' }],
    index_pages: [],
  },
  '3180': {
    name: 'In re Dupixent (Dupilumab) Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 1,
    case_number: null, pages: [], index_pages: ['njd-mdl-cases', 'jpml-panel-orders'],
    note: 'No MDL 3180 page on the D.N.J. site as of capture: the "MDL Cases" index lists Invokana 2750, Talc 2738, Plavix 2418, PPI 2789, Valsartan 2875, AMCA 2904, Biocell 2921, Elmiron 2973, Samsung 3055, Insulin 3080, Apple 3113.',
  },
  '3125': {
    name: 'In re AngioDynamics, Inc., and Navilyst Medical, Inc., Port Catheter Products Liability Litigation', court_id: 'casd', host: 'www.casd.uscourts.gov', tier: 1,
    case_number: null, pages: [], index_pages: ['jpml-panel-orders'],
    note: 'No S.D. Cal. MDL page found: the court site menu is ASP.NET postback only, search finds none, and judge pages sit under /Judges/, which robots.txt Disallows for all crawlers.',
  },
  // D.N.J. MDL pages linked from njd-mdl-cases (not in the tier-1 Seeger focus set).
  '2750': { name: 'In re Invokana (Canagliflozin) Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2750', pages: [{ id: 'njd-2750-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/invokana-litigation' }], index_pages: [] },
  '2418': { name: 'In re Plavix Products Liability and Marketing Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2418', pages: [{ id: 'njd-2418-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/plavix-product-liability-and-marketing-litigation' }], index_pages: [] },
  '2789': { name: 'In re Proton-Pump Inhibitor Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2789', pages: [{ id: 'njd-2789-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/proton-pump-mdl-2789' }], index_pages: [] },
  '2875': { name: 'In re Valsartan Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2875', pages: [{ id: 'njd-2875-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/valsartan-mdl-2875' }], index_pages: [] },
  '2904': { name: 'In re American Medical Collection Agency, Inc., Customer Data Security Breach Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2904', pages: [{ id: 'njd-2904-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/american-medical-collection-agency-inc-customer-data-security-breach-litigation-2904' }], index_pages: [] },
  '2921': { name: 'In re Allergan Biocell Textured Breast Implant Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2921', pages: [{ id: 'njd-2921-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/allergan-biocell-textured-breast-implant-products-liability-litigation' }], index_pages: [] },
  '2973': { name: 'In re Elmiron (Pentosan Polysulfate Sodium) Products Liability Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2973', pages: [{ id: 'njd-2973-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/elmiron-pentosan-polysulfate-sodium-products-liability-litigation' }], index_pages: [] },
  '3055': { name: 'In re Samsung Customer Data Security Breach Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3055', pages: [{ id: 'njd-3055-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/samsung-customer-data-security-breach-litigation' }], index_pages: [] },
  '3080': { name: 'In re Insulin Pricing Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3080', pages: [{ id: 'njd-3080-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/insulin-pricing-litigation' }], index_pages: [] },
  '3113': { name: 'In re Apple Inc. Smartphone Antitrust Litigation', court_id: 'njd', host: 'www.njd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3113', pages: [{ id: 'njd-3113-main', role: 'mdl_page', family: 'njd-body', url: 'https://www.njd.uscourts.gov/apple-inc-smartphone-antitrust-litigation' }], index_pages: [] },
  // E.D. Pa. MDL pages linked from paed-mdl-hub (3163 already in tier-1 above).
  '875': { name: 'In re Asbestos Products Liability Litigation (No. VI)', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 875', pages: [{ id: 'paed-875-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl875/orders' }, { id: 'paed-875-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-875-re-asbestos-products-liability-litigation-no-vi' }], index_pages: [] },
  '1203': { name: 'In re Diet Drugs (Phentermine / Fenfluramine / Dexfenfluramine) Products Liability Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 1203', pages: [{ id: 'paed-1203-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl1203/orders' }, { id: 'paed-1203-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-1203-re-diet-drugs-phentermine-fenfluramine-dexfenfluramine-products-liability-litigation' }], index_pages: [] },
  '1871': { name: 'In re Avandia Marketing, Sales Practices and Products Liability Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 1871', pages: [{ id: 'paed-1871-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl1871/orders' }, { id: 'paed-1871-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-1871-re-avandia-marketing-sales-practices-and-products-liability-litigation' }], index_pages: [] },
  '2002': { name: 'In re Processed Egg Products Antitrust Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2002', pages: [{ id: 'paed-2002-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl2002/orders' }, { id: 'paed-2002-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-2002-re-processed-egg-products-antitrust-litigation' }], index_pages: [] },
  '2323': { name: "In re National Football League Players' Concussion Injury Litigation", court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2323', pages: [{ id: 'paed-2323-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl2323/orders' }, { id: 'paed-2323-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-2323-re-national-football-league-players-concussion-injury-litigation' }], index_pages: [] },
  '2342': { name: 'In re Zoloft (Sertraline Hydrochloride) Products Liability Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2342', pages: [{ id: 'paed-2342-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl2342/orders' }, { id: 'paed-2342-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-2342-re-zoloft-sertraline-hydrochloride-products-liability-litigation' }], index_pages: [] },
  '2436': { name: 'In re Tylenol (Acetaminophen) Marketing, Sales Practices and Products Liability Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2436', pages: [{ id: 'paed-2436-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl2436/orders' }, { id: 'paed-2436-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-2436-re-tylenol-acetaminophen-marketing-sales-practices-and-products-liability-litigation' }], index_pages: [] },
  '2437': { name: 'In re Domestic Drywall Antitrust Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2437', pages: [{ id: 'paed-2437-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl2437/orders' }, { id: 'paed-2437-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-2437-re-domestic-drywall-antitrust-litigation' }], index_pages: [] },
  '2724': { name: 'In re Generic Pharmaceuticals Pricing Antitrust Litigation', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2724', pages: [{ id: 'paed-2724-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl2724/orders' }, { id: 'paed-2724-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-2724-re-generic-pharmaceuticals-pricing-antitrust-litigation' }], index_pages: [] },
  '3094': { name: 'In re Glucagon-like Peptide-1 Receptor Agonists (GLP-1 RAs) Products Liability Litigation (GI Injuries)', court_id: 'paed', host: 'www.paed.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3094', pages: [{ id: 'paed-3094-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.paed.uscourts.gov/mdl/mdl3094/orders' }, { id: 'paed-3094-landing', role: 'mdl_page', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl/mdl-3094-re-glucagon-peptide-1-receptor-agonists-glp-1-ras-products-liability-litigation-gi' }], index_pages: [] },
  // N.D. Tex. MDL docket tables (Firecrawl map of txnd.uscourts.gov; 3114 already tier-1).
  '2244': {
    name: 'In re DePuy Orthopaedics, Inc., Pinnacle Hip Implant Products Liability Litigation', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 2,
    case_number: { literal: '3:11-md-02244', page_id: 'txnd-2244-mdl', note: 'printed in the MDL page heading' },
    pages: [{ id: 'txnd-2244-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-311-md-02244' }],
    index_pages: [],
  },
  '2405': { name: 'MDL No. 2405 (N.D. Tex.)', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2405', pages: [{ id: 'txnd-2405-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-312-md-02405' }], index_pages: [] },
  '2587': { name: 'MDL No. 2587 (N.D. Tex.)', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2587', pages: [{ id: 'txnd-2587-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-314-md-02587' }], index_pages: [] },
  '2614': { name: 'MDL No. 2614 (N.D. Tex.)', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2614', pages: [{ id: 'txnd-2614-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-315-md-02614' }], index_pages: [] },
  '2835': { name: 'MDL No. 2835 (N.D. Tex.)', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2835', pages: [{ id: 'txnd-2835-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-318-md-02835' }], index_pages: [] },
  '1983': { name: 'MDL No. 1983 (N.D. Tex.)', court_id: 'txnd', host: 'www.txnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 1983', pages: [{ id: 'txnd-1983-mdl', role: 'mdl_page', family: 'txnd-docket-table', url: 'https://www.txnd.uscourts.gov/mdl-308-md-01983' }], index_pages: [] },
  // N.D. Fla. MDL orders-by-date tables (Firecrawl map; paed-orders-table with PDF + stub HTML links per row).
  '3140': {
    name: 'In re Depo-Provera Products Liability Litigation', court_id: 'flnd', host: 'www.flnd.uscourts.gov', tier: 1,
    case_number: null, printed_mdl_literal: 'MDL 3140',
    pages: [{ id: 'flnd-3140-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.flnd.uscourts.gov/mdl3140-orders-by-date' }],
    index_pages: [],
  },
  '2885': {
    name: 'In re 3M Combat Arms Earplug Products Liability Litigation', court_id: 'flnd', host: 'www.flnd.uscourts.gov', tier: 2,
    case_number: null, printed_mdl_literal: 'MDL 2885',
    pages: [{ id: 'flnd-2885-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.flnd.uscourts.gov/mdl2885-orders-by-date' }],
    index_pages: [],
  },
  '2734': {
    name: 'In re Abilify (Aripiprazole) Products Liability Litigation', court_id: 'flnd', host: 'www.flnd.uscourts.gov', tier: 2,
    case_number: { literal: '3:16-md-2734', page_id: 'flnd-2734-mdl', note: 'master docket printed on the MDL landing page' },
    pages: [
      { id: 'flnd-2734-mdl', role: 'mdl_page', family: 'njd-body', url: 'https://www.flnd.uscourts.gov/abilify-products-liability-litigation-mdl-no-2734' },
      { id: 'flnd-2734-orders', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.flnd.uscourts.gov/mdl2734-orders-by-date' },
    ],
    index_pages: [],
  },
  // N.D. Ohio MDL 2804 (Firecrawl map; njd-body link list on mdl-2804 hub).
  '2804': {
    name: 'In re National Prescription Opiate Litigation', court_id: 'ohnd', host: 'www.ohnd.uscourts.gov', tier: 1,
    case_number: null, printed_mdl_literal: 'MDL 2804',
    pages: [{ id: 'ohnd-2804-mdl', role: 'mdl_page', family: 'njd-body', url: 'https://www.ohnd.uscourts.gov/mdl-2804' }],
    index_pages: [],
  },
  '2316': {
    name: 'In re Ford Motor Co. Spark Plug and 3-Valve Engine Products Liability Litigation', court_id: 'ohnd', host: 'www.ohnd.uscourts.gov', tier: 2,
    case_number: { literal: '1:12-md-2316', page_id: 'ohnd-2316-mdl', note: 'printed in the master docket table on the MDL page' },
    pages: [{ id: 'ohnd-2316-mdl', role: 'mdl_page', family: 'njd-body', url: 'https://www.ohnd.uscourts.gov/mdl-2316' }],
    index_pages: [],
  },
  // D. Ariz. MDL 3081 (Firecrawl map; paed-orders-table on litigation landing page).
  '3081': {
    name: 'In re Bard Implanted Port Catheter Products Liability Litigation', court_id: 'azd', host: 'www.azd.uscourts.gov', tier: 1,
    case_number: null, printed_mdl_literal: 'MDL 3081',
    pages: [{ id: 'azd-3081-mdl', role: 'orders_table', family: 'paed-orders-table', url: 'https://www.azd.uscourts.gov/re-bard-implanted-port-catheter-products-liability-litigation' }],
    index_pages: [],
  },
  // D. Minn. MDL pages (mdl-cases index; mnd-mdl-page on Drupal content nodes).
  '3108': {
    name: 'In re Change Healthcare, Inc. Customer Data Security Breach Litigation', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 1,
    case_number: null, printed_mdl_literal: 'MDL 3108',
    pages: [{ id: 'mnd-3108-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/change-healthcare-inc-data-breach' }],
    index_pages: ['mnd-mdl-cases'],
  },
  '2998': { name: 'In re Pork Antitrust Litigation', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2998', pages: [{ id: 'mnd-2998-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/pork-antitrust-litigation-mdl' }], index_pages: [] },
  '2642': { name: 'In re Fluoroquinolone Products Liability Litigation', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2642', pages: [{ id: 'mnd-2642-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/Fluoroquinolone' }], index_pages: [] },
  '2441': { name: 'In re Stryker Rejuvenate and ABG II Modular-Neck Hip Stem Products Liability Litigation', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 2441', pages: [{ id: 'mnd-2441-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/stryker-rejuvenate' }], index_pages: [] },
  '3110': { name: 'In re Granulated Sugar Antitrust Litigation', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3110', pages: [{ id: 'mnd-3110-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/granulated-sugar-antitrust-litigation' }], index_pages: [] },
  '3155': { name: 'In re Air Crash at Toronto Pearson International Airport on January 5, 2025', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3155', pages: [{ id: 'mnd-3155-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/air-crash-toronto-pearson-international-airport' }], index_pages: [] },
  '3128': { name: 'In re Dividend Solar Finance LLC and Fifth Third Bank Sales and Lending Practices Litigation', court_id: 'mnd', host: 'www.mnd.uscourts.gov', tier: 2, case_number: null, printed_mdl_literal: 'MDL 3128', pages: [{ id: 'mnd-3128-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.mnd.uscourts.gov/content/dividend-solar-finance-llc-and-fifth-third-bank-sales-and-lending-practices-litigation' }], index_pages: [] },
  // S.D. Ill. MDL 3004 (Paraquat; orders table with direct PDFs on litigation landing page).
  '3004': {
    name: 'In re Paraquat Products Liability Litigation', court_id: 'ilsd', host: 'www.ilsd.uscourts.gov', tier: 2,
    case_number: null, printed_mdl_literal: 'MDL 3004',
    pages: [{ id: 'ilsd-3004-mdl', role: 'mdl_page', family: 'njd-body', url: 'https://www.ilsd.uscourts.gov/paraquat-products-liability-litigation' }],
    index_pages: [],
  },
  // S.D.N.Y. MDL 3043 (Drupal MDL hub; PDFs under /sites/default/files/pdf/MDL/).
  '3043': {
    name: 'In re Acetaminophen – ASD-ADHD Products Liability Litigation', court_id: 'nysd', host: 'www.nysd.uscourts.gov', tier: 1,
    case_number: null, printed_mdl_literal: 'MDL 3043',
    pages: [{ id: 'nysd-3043-mdl', role: 'orders_table', family: 'mnd-mdl-page', url: 'https://www.nysd.uscourts.gov/MDL/22md3043' }],
    index_pages: [],
  },
  // E.D. Ky. MDL 2809 (Onglyza/Kombiglyze; orders node only — main hub has generic MDL_Attorneys.pdf skipped).
  '2809': {
    name: 'In re Onglyza (Saxagliptin) and Kombiglyze XR (Saxagliptin and Metformin) Products Liability Litigation', court_id: 'kyed', host: 'www.kyed.uscourts.gov', tier: 2,
    case_number: { literal: '5:18-md-02809-KKC', page_id: 'kyed-2809-orders', note: 'printed in the orders page title' },
    pages: [{ id: 'kyed-2809-orders', role: 'orders_table', family: 'njd-body', url: 'https://www.kyed.uscourts.gov/518-md-02809-kkc-orders' }],
    index_pages: [],
  },
};

// Index pages prove which MDL pages a court currently lists (and therefore the ABSENCE of a page for a matter such as 3180).
export const INDEX_PAGES = {
  'njd-mdl-cases': { id: 'njd-mdl-cases', role: 'court_mdl_index', family: 'index-links', url: 'https://www.njd.uscourts.gov/mdl-cases' },
  'ilnd-mdl-index': { id: 'ilnd-mdl-index', role: 'court_mdl_index', family: 'index-links', url: 'https://www.ilnd.uscourts.gov/mdl.aspx' },
  'moed-mdl-index': { id: 'moed-mdl-index', role: 'court_mdl_index', family: 'index-links', url: 'https://www.moed.uscourts.gov/mdl-multidistrict-litigation-cases' },
  'paed-mdl-hub': { id: 'paed-mdl-hub', role: 'court_mdl_index', family: 'index-links', url: 'https://www.paed.uscourts.gov/mdl' },
  'txnd-mdl-cases': { id: 'txnd-mdl-cases', role: 'court_mdl_index', family: 'index-links', url: 'https://www.txnd.uscourts.gov/mdl-cases' },
  'mnd-mdl-cases': { id: 'mnd-mdl-cases', role: 'court_mdl_index', family: 'index-links', url: 'https://www.mnd.uscourts.gov/mdl-cases' },
  // JPML lists only the CURRENT hearing session's orders here (older PDFs stay on the site under predictable file names, see build-jpml-queue.mjs).
  'jpml-panel-orders': { id: 'jpml-panel-orders', role: 'jpml_panel_orders', family: 'jpml-panel-orders', url: 'https://www.jpml.uscourts.gov/panel-orders' },
};

export function pagesFor(mdls, { includeIndex = true } = {}) {
  const out = [], seen = new Set();
  for (const mdl of mdls) {
    const matter = MATTERS[mdl];
    if (!matter) throw Error('UNKNOWN_MDL ' + mdl);
    const list = [...matter.pages.map(p => ({ ...p, mdl, host: new URL(p.url).hostname }))];
    if (includeIndex) for (const id of matter.index_pages) list.push({ ...INDEX_PAGES[id], mdl, host: new URL(INDEX_PAGES[id].url).hostname });
    for (const p of list) { if (seen.has(p.url)) continue; seen.add(p.url); out.push(p); }
  }
  return out;
}
