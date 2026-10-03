# Seeger Weiss docket HTML metadata supplement — October 2, 2026

Firecrawl captured 23 full returned HTML/Markdown/link pages from 24 exact CourtListener firm-indexed MD/ML docket targets. The sample used three simultaneous requests at most. Successful responses reported HTTP 200 and 23 credits in aggregate; credit use for the one failed request is unknown. Talc docket 6245245 returned a provider retrieval failure and was not retried. No CourtListener API requests, PDF bodies, PACER purchases, database writes, or file deletion occurred in this worker.

The 1,810-row firm search index contains 118 literal MD/ML or MDL-number results. This sample selected recent-first, non-JPML records with literal MD/ML numbers and litigation titles, a null provider termination field, and one sample per literal court/docket number. Null termination does not prove current active status. All 24 exact native docket IDs and their supplied URLs were independently reconstructed from original firm-query captures; a firm-index match remains a sourced association rather than certification of a filed firm appearance.

The packet contains 4,929 records: 23 docket page headers, 2,253 visible docket rows, and 2,653 visible document sections. It preserves 40 explicitly labeled assigned/referred judge observations, literal dates, document labels, links, raw HTML source spans, and original provider captures. Twenty-one pages expose continuation links, which were preserved but not followed. No separate parties or authorities tab was fetched, so this packet contains zero certified party-body rows or full-corpus authority relationships.

It also preserves 884 direct RECAP PDF locator occurrences, each unique within its literal native parent case. Of these, 128 exactly match a same-case URL in the frozen cached CourtListener native-document packet and retain that source-qualified native ID. The other 756 locators are new only to that frozen packet. The HTML exposes no explicit RECAP backend document ID for those candidates; a document number in a detail URL is not such an ID. No PDF response status, sealing status, body digest, or size was inferred. Eight occurrences have conservative sealing-related text holds, including 8 new locators.

Provider Last Updated dates and Date of Last Known Filing remain separate fields. CourtListener itself warns that community-collected RECAP dockets may not be up to date. Public projection, legal outcome activation, limitations calculations, complete-docket claims, all-member claims, and certified firm participation are disabled.

| Source docket | Court | Visible rows | PDF locators / new | Continuation observed | Last known filing, literal |
|---|---|---:|---:|---|---|
| [4:26-md-03185](https://www.courtlistener.com/docket/73454806/in-re-cognizant-technology-solutions-corporation-and-trizetto-provider/) (73454806) | moed | 70 | 11 / 11 | No link observed | Sept. 29, 2026 |
| [3:25-md-03166](https://www.courtlistener.com/docket/72030009/in-re-roblox-corporation-child-sexual-exploitation-and-assault-litigation/) (72030009) | cand | 100 | 55 / 55 | Yes | Oct. 1, 2026 |
| [3:25-md-03149](https://www.courtlistener.com/docket/69912599/in-re-powerschool-holdings-inc-and-powerschool-group-llc-customer-data/) (69912599) | casd | 100 | 3 / 3 | Yes | Sept. 30, 2026 |
| [2:25-ml-03144](https://www.courtlistener.com/docket/69871659/in-re-tiktok-inc-minor-privacy-litigation/) (69871659) | cacd | 100 | 86 / 86 | Yes | Sept. 30, 2026 |
| [3:25-md-03140](https://www.courtlistener.com/docket/69674950/in-re-depo-provera-depot-medroxyprogesterone-acetate-products-liability/) (69674950) | flnd | 100 | 9 / 9 | Yes | Sept. 25, 2026 |
| [3:24-md-03125](https://www.courtlistener.com/docket/69255166/in-re-angiodynamics-inc-and-navilyst-medical-inc-port-catheter/) (69255166) | casd | 100 | 2 / 2 | Yes | Sept. 30, 2026 |
| [2:24-md-03113](https://www.courtlistener.com/docket/68869775/apple-inc-smartphone-antitrust-litigation/) (68869775) | njd | 100 | 33 / 33 | Yes | Oct. 1, 2026 |
| [0:24-md-03108](https://www.courtlistener.com/docket/68837976/in-re-change-healthcare-inc-customer-data-security-breach-litigation/) (68837976) | mnd | 100 | 20 / 20 | Yes | Oct. 1, 2026 |
| [3:24-md-03114](https://www.courtlistener.com/docket/68936135/in-re-att-inc-customer-data-security-breach-litigation/) (68936135) | txnd | 83 | 21 / 21 | No link observed | Aug. 17, 2026 |
| [2:23-md-03081](https://www.courtlistener.com/docket/67678440/in-re-bard-implanted-port-catheter-products-liability-litigation/) (67678440) | azd | 100 | 3 / 3 | Yes | Oct. 2, 2026 |
| [2:23-md-03080](https://www.courtlistener.com/docket/67665081/insulin-pricing-litigation/) (67665081) | njd | 100 | 54 / 54 | Yes | Oct. 1, 2026 |
| [1:23-md-03062](https://www.courtlistener.com/docket/66800762/in-re-crop-protection-products-loyalty-program-antitrust-litigation/) (66800762) | ncmd | 100 | 17 / 17 | Yes | Sept. 30, 2026 |
| [1:17-md-02804](https://www.courtlistener.com/docket/6240169/in-re-national-prescription-opiate-litigation/) (6240169) | ohnd | 100 | 113 / 113 | Yes | Oct. 1, 2026 |
| [4:22-md-03047](https://www.courtlistener.com/docket/65407433/in-re-social-media-adolescent-addictionpersonal-injury-products-liability/) (65407433) | cand | 100 | 128 / 0 | Yes | Oct. 1, 2026 |
| [0:22-md-03031](https://www.courtlistener.com/docket/63363039/in-re-cattle-and-beef-antitrust-litigation/) (63363039) | mnd | 100 | 16 / 16 | Yes | Sept. 22, 2026 |
| [9:20-md-02924](https://www.courtlistener.com/docket/16813256/in-re-zantac-ranitidine-products-liability-litigation/) (16813256) | flsd | 100 | 9 / 9 | Yes | Sept. 15, 2026 |
| [2:19-md-02921](https://www.courtlistener.com/docket/16684846/in-re-allergan-biocell-textured-breast-implant-products-liability/) (16684846) | njd | 100 | 4 / 4 | Yes | Aug. 28, 2026 |
| [2:19-ml-02905](https://www.courtlistener.com/docket/16048321/in-re-zf-trw-airbag-control-units-products-liability-litigation/) (16048321) | cacd | 100 | 1 / 1 | Yes | Sept. 30, 2026 |
| [2:19-md-02904](https://www.courtlistener.com/docket/16152046/american-medical-collection-agency-inc-customer-data-security-breach/) (16152046) | njd | 100 | 13 / 13 | Yes | Sept. 24, 2026 |
| [3:19-md-02885](https://www.courtlistener.com/docket/14916674/in-re-3m-combat-arms-earplug-products-liability-litigation/) (14916674) | flnd | 100 | 105 / 105 | Yes | Aug. 17, 2026 |
| [2:18-md-02846](https://www.courtlistener.com/docket/7603829/in-re-davol-inccr-bard-inc-polypropylene-hernia-mesh-products/) (7603829) | ohsd | 100 | 26 / 26 | Yes | Aug. 26, 2026 |
| [3:18-md-02843](https://www.courtlistener.com/docket/7067512/in-re-facebook-inc-consumer-privacy-user-profile-litigation/) (7067512) | cand | 100 | 151 / 151 | Yes | Sept. 23, 2026 |
| [1:16-md-02753](https://www.courtlistener.com/docket/6087948/in-re-atrium-medical-corp-c-qur-mesh-products-liability-litigation/) (6087948) | nhd | 100 | 4 / 4 | Yes | March 27, 2026 |

Private packet and verification:

- Full original returns: C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/firecrawl-dockets/original-{native docket ID}.json. The original-return ledger pins all 24 file hashes; the aggregate saved return bytes are 43203842.
- Metadata: reviewed-v1/visible-docket-records.jsonl; 4,929 rows; SHA-256 22f39f095a0d69287fc0e2bce30d81ce149bd9cc01dccaf243f34189ba66cb3c.
- PDF locator candidates: reviewed-v1/direct-recap-pdf-candidates.jsonl; 884 rows; SHA-256 7547080bd0777bd743d50006f750b9cbd33dba2fa1073077054e9ec2d7ed6ad6.
- Page coverage: reviewed-v1/page-coverage.jsonl; 23 rows; SHA-256 1001b2fdb5d8d57b63eaa31b34b862017377c43c5558bfafaa6b518f230f30a4.
- Manifest: reviewed-v1/manifest.json; SHA-256 d666a1ac1a50c0558fb18b99d64334e8fc4c5b08bfc8781c7b442cbffc667c35.
- Independent Node receipt: independent-native-scope-and-canonical.json. All 24 native targets were reconstructed from 17 original API captures; all 4,929 metadata and 884 PDF candidate data hashes and scope gates passed.
- Independent Python receipt: independent-original-span-verification.json. All 24 provider capture hashes, 23 structured-return equivalences, 38,198 source-span occurrences, 23,022 field/link reconstructions, and all 128 exact cached native matches passed.

Hashes of provider JSON and provider-returned rawHtml UTF-8 describe the bytes actually saved here. They do not assert publisher HTTP-wire hashes. The producer is scripts/ingest/prepare-seeger-weiss-firecrawl-docket-metadata.py; it only reads frozen local files and writes private normalized metadata. The source-preserving packet is ready for root review and separate private intake; it is not a PDF transfer queue or an automatic database import.
