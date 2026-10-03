import { readFile, writeFile } from "node:fs/promises";
const file = "private/data/limitations/rules.json";
const data = JSON.parse(await readFile(file, "utf8"));
const seed = data.rules.find((r) => r.id === "va-personal_injury-baseline-20261002");
function add(
  jurisdiction,
  claimType,
  years,
  sourceIds,
  pinpoint,
  scope,
  conditions = [],
  options = {},
) {
  const id = `${jurisdiction.toLowerCase()}-${claimType}-${options.subtype ?? "general"}-review-20261002`;
  if (data.rules.some((r) => r.id === id)) return;
  if (
    options.computation !== "research_only" &&
    data.rules.some(
      (r) =>
        r.jurisdiction === jurisdiction &&
        r.claimType === claimType &&
        (r.subtype ?? "general") === (options.subtype ?? "general") &&
        r.computation === "baseline_only",
    )
  )
    return;
  data.rules.push({
    ...seed,
    id,
    jurisdiction,
    claimType,
    sourceIds,
    pinpoint,
    scope,
    summary: scope,
    period: years ? { amount: years, unit: "calendar_years" } : null,
    conditions,
    exclusions: [
      "Unresolved choice of law, historical applicability, disability, tolling, prior actions, special claims, commencement and service requirements.",
      "Any listed discovery, repose, claim-definition or transition issue not separately resolved.",
    ],
    accrualBasis: claimType === "wrongful_death" ? "death" : "confirmed_accrual",
    ...options,
  });
}
const ordinary = [
  [
    "AL",
    "personal_injury",
    2,
    ["al-6-2-38"],
    "Ala. Code § 6-2-38(l)",
    "Ordinary noncontractual injury to the person, not specifically enumerated elsewhere.",
    [
      "Subsection (g) concerns workers' compensation and is not this claim mapping.",
      "Latent exposure accrual and special statutes require separate legal confirmation.",
    ],
  ],
  [
    "AL",
    "wrongful_death",
    2,
    ["al-6-2-38"],
    "Ala. Code § 6-2-38(a)",
    "Representative's qualifying wrongful-death action under §§ 6-5-391 or 6-5-410.",
    [
      "Representative status, underlying claim eligibility, and the substantive death statutes require separate confirmation.",
    ],
  ],
  [
    "AK",
    "personal_injury",
    2,
    ["ak-9-10-070"],
    "Alaska Stat. § 09.10.070(a)(2)",
    "Ordinary personal injury not specifically provided otherwise.",
    [],
  ],
  [
    "HI",
    "personal_injury",
    2,
    ["hi-657-7"],
    "Haw. Rev. Stat. § 657-7",
    "Compensation for injury to a person, subject to other statutory provisions.",
    ["Accrual/discovery and § 657-13 exceptions must be independently resolved."],
  ],
  [
    "ID",
    "personal_injury",
    2,
    ["id-5-219"],
    "Idaho Code § 5-219(4)",
    "Ordinary injury to the person under the occurrence-based statutory rule.",
    [
      "Use the legally established occurrence/accrual date. Do not infer a general latent-injury discovery rule.",
      "Foreign-object, fraudulent-concealment and malpractice exceptions are outside this branch.",
    ],
  ],
  [
    "ID",
    "wrongful_death",
    2,
    ["id-5-219"],
    "Idaho Code § 5-219(4)",
    "Death caused by wrongful act or neglect, with statutory accrual separately established.",
    [
      "Underlying death-action requirements and accrual must be confirmed; date of death is not substituted for every occurrence issue.",
    ],
  ],
  [
    "IL",
    "personal_injury",
    2,
    ["il-13-202"],
    "735 ILCS 5/13-202",
    "Ordinary damages for injury to a person.",
    [
      "Special limitations, legal disability, and discovery exceptions must be reviewed independently.",
    ],
  ],
  [
    "IA",
    "personal_injury",
    2,
    ["ia-c614-2026"],
    "Iowa Code § 614.1(2)",
    "Ordinary injuries to the person under subsection (2).",
    [
      "Malpractice, improvements to real property and other specially declared limitations are excluded.",
    ],
  ],
  [
    "MA",
    "personal_injury",
    3,
    ["ma-260-2a"],
    "Mass. Gen. Laws ch. 260, § 2A",
    "Ordinary tort injury or contract action to recover for personal injuries.",
    ["Other specially provided statutory periods and accrual/discovery require confirmation."],
  ],
  [
    "SD",
    "personal_injury",
    3,
    ["sd-15-2-14"],
    "S.D. Codified Laws § 15-2-14(3)",
    "Ordinary personal injury under the general three-year provision.",
    ["Product, medical, governmental and other specially provided actions are excluded."],
  ],
  [
    "WV",
    "personal_injury",
    2,
    ["wv-55-2-12"],
    "W. Va. Code § 55-2-12(b)",
    "Ordinary personal-injury action not otherwise provided for.",
    ["Do not treat death or product-specific issues as resolved by this subsection."],
  ],
  [
    "WI",
    "personal_injury",
    3,
    ["wi-893-54"],
    "Wis. Stat. § 893.54(1m)(a)",
    "Ordinary injuries to the person under subsection (1m)(a).",
    ["Special statutory claims and operative discovery/accrual remain separately confirmed."],
  ],
  [
    "WI",
    "wrongful_death",
    3,
    ["wi-893-54"],
    "Wis. Stat. § 893.54(1m)(b), (2m)",
    "Ordinary wrongful death outside the two-year motor-vehicle death provision.",
    [
      "A death arising from a motor-vehicle accident has a different two-year subsection (2m); it is excluded here.",
    ],
  ],
  [
    "NV",
    "personal_injury",
    2,
    ["nv-nrs11"],
    "Nev. Rev. Stat. § 11.190(4)(e)",
    "Ordinary injury caused by wrongful act or neglect.",
    [
      "Other enumerated actions, malpractice, product repose and discovery require separate review.",
    ],
  ],
  [
    "NV",
    "wrongful_death",
    2,
    ["nv-nrs11"],
    "Nev. Rev. Stat. § 11.190(4)(e)",
    "Ordinary death caused by wrongful act or neglect.",
    ["Underlying death-action prerequisites and special statutes remain independently confirmed."],
  ],
  [
    "OH",
    "personal_injury",
    2,
    ["oh-2305-10"],
    "Ohio Rev. Code § 2305.10(A), (B), (E)",
    "Ordinary bodily injury on the legally established injury/accrual date.",
    [
      "Exposure branches (B)(1)–(5), childhood sexual abuse and special claims are excluded from this general branch.",
    ],
  ],
  [
    "CO",
    "personal_injury",
    2,
    ["co-t13-a80-2026"],
    "Colo. Rev. Stat. §§ 13-80-102(1)(a), 13-80-108(1)",
    "Ordinary tort injury, excluding motor-vehicle and specially provided claims.",
    [
      "Accrual requires legally confirmed actual or reasonable-diligence knowledge of both injury and cause.",
    ],
  ],
  [
    "CO",
    "wrongful_death",
    2,
    ["co-t13-a80-2026"],
    "Colo. Rev. Stat. §§ 13-80-102(1)(d), (2), 13-80-108(2)",
    "Ordinary wrongful death, accruing at death.",
    [
      "The specified vehicular-homicide/leaving-scene exception and other special claims are excluded.",
    ],
  ],
  [
    "MT",
    "personal_injury",
    3,
    ["mt-27-2-204"],
    "Mont. Code Ann. § 27-2-204(1), effective October 1, 2026 text",
    "Ordinary non-written-liability personal-injury claim within the subsection (1) classification.",
    [
      "The current publisher displays two transition versions. Applicability of the October 1, 2026 amendment and §§ 27-2-216, 27-2-219 must be confirmed.",
      "Intentional torts enumerated in (3) have a different two-year period and are excluded.",
    ],
  ],
  [
    "MT",
    "wrongful_death",
    3,
    ["mt-27-2-204"],
    "Mont. Code Ann. § 27-2-204(2)",
    "Ordinary death caused by wrongful act or neglect.",
    [
      "Homicide deaths have a different ten-year period and are excluded; historic version and accrual require confirmation.",
    ],
  ],
  [
    "DE",
    "personal_injury",
    2,
    ["de-10c81"],
    "10 Del. C. § 8119",
    "Ordinary damages for alleged personal injuries.",
    [
      "Borrowing under § 8121, latent accrual and special statutory provisions require separate confirmation.",
    ],
  ],
  [
    "FL",
    "personal_injury",
    2,
    ["fl-95-11", "fl-95-031"],
    "Fla. Stat. §§ 95.11(5)(a), 95.031(1)",
    "Ordinary negligence under the current two-year provision.",
    [
      "Confirm Chapter 2023-15 transition and governing historic version; a pre-amendment four-year claim must not use this branch.",
      "Product design/manufacture/distribution/sale injury has a distinct four-year statutory provision and is excluded.",
    ],
  ],
  [
    "FL",
    "wrongful_death",
    2,
    ["fl-95-11", "fl-95-031"],
    "Fla. Stat. §§ 95.11(5)(e), (11), 95.031",
    "Ordinary wrongful death outside special product, intentional-homicide and other statutory exceptions.",
    [
      "Independent accrual, representative eligibility and underlying death-action requirements must be confirmed.",
    ],
  ],
];
for (const s of ordinary) add(...s);
const products = [
  [
    "IN",
    2,
    ["in-code-2026"],
    "IC 34-20-3-1(b), (c)",
    "General product-injury two-year accrual period after independent delivery/repose review.",
    [
      "The ten-year delivery provision, accrual in years eight to ten, and any applicable exception must be resolved separately. The calculator does not determine that ten-year bar.",
      "Protracted asbestos exposure and constitutional treatment of IC 34-20-3-2 require the separate validity review.",
    ],
  ],
  [
    "TX",
    2,
    ["tx-cp16"],
    "Tex. Civ. Prac. & Rem. Code §§ 16.003(a), 16.012",
    "Product claim seeking damages for personal injury under the confirmed two-year injury classification.",
    [
      "Independently resolve fifteen-year sale-based repose, longer express warranties and latent-exposure exceptions in § 16.012.",
      "Asbestos/silica accrual under § 16.0031 is excluded from this general branch.",
    ],
  ],
  [
    "FL",
    4,
    ["fl-95-11", "fl-95-031"],
    "Fla. Stat. §§ 95.11(3)(d), 95.031(2)(b)–(d)",
    "Injury founded on design, manufacture, distribution or sale of personal property not permanently incorporated in an improvement to real property.",
    [
      "The claim must fall in § 95.11(3)(d), including its fixture language; do not apply the general negligence period.",
      "Legally establish discovery and resolve product useful-life/repose, latent-disease and concealment provisions in § 95.031 before selecting this period.",
    ],
  ],
  [
    "CO",
    2,
    ["co-t13-a80-2026"],
    "Colo. Rev. Stat. §§ 13-80-106(1), (2), 13-80-108(1)",
    "Personal injury caused by a manufacturer's or seller's product under § 13-80-106.",
    [
      "Actions governed by UCC § 4-2-725 are excluded.",
      "Manufacturing-equipment repose under § 13-80-107, disability, and any other special statute must be resolved separately.",
    ],
  ],
  [
    "CT",
    3,
    ["ct-ch926"],
    "Conn. Gen. Stat. § 52-577a(a), (c)–(e)",
    "Qualifying product claim, after independent ten-year possession/control and exception review.",
    [
      "Resolve last possession/control, useful safe life, warranty, asbestos and other applicable statutory exceptions separately.",
      "The trigger is first injury sustained or actual/reasonable-care discovery; it is not automatically product purchase or diagnosis.",
    ],
  ],
  [
    "MN",
    4,
    ["mn-541-05"],
    "Minn. Stat. § 541.05, subd. 2",
    "Product injury under strict liability in tort.",
    [
      "This four-year classification is specifically strict liability, and does not automatically classify negligence or warranty.",
      "Accrual, useful-life defenses, special statutes and historical applicability require separate confirmation.",
    ],
  ],
];
for (const [state, years, sources, pinpoint, scope, conditions] of products)
  add(state, "product_liability", years, sources, pinpoint, scope, conditions);
add(
  "CA",
  "product_liability",
  2,
  ["ca-335-1"],
  "Cal. Code Civ. Proc. § 335.1; Fox, 35 Cal.4th at 806–813 & fn. 3",
  "Negligence or strict-liability product claim for bodily injury, with legally confirmed discovery of the factual basis of the claim.",
  [
    "Discovery requires the actual or reasonably suspected factual basis for this wrongdoing after legally assessed diligence; diagnosis or knowledge of medical negligence alone is not enough.",
    "Medical malpractice, asbestos-specific statutes, economic-loss/warranty claims, public-entity claims and special revival statutes are excluded.",
  ],
  { calculation: { mode: "discovery_min" }, caseReferenceIds: ["ca-fox-2005"] },
);
for (const [subtype, section, scope] of [
  [
    "latent_toxic",
    "(B)(1)",
    "Exposure to hazardous/toxic chemicals, ethical drugs or ethical medical devices, excluding the separate (B)(2)–(5) classes.",
  ],
  ["chromium", "(B)(2)", "Bodily injury caused by chromium exposure in any chemical form."],
  [
    "agent_orange",
    "(B)(3)",
    "Qualifying veteran's bodily injury through defoliants, herbicides or other statutory causative agents.",
  ],
  [
    "synthetic_estrogen",
    "(B)(4)",
    "Bodily injury through diethylstilbestrol or other nonsteroidal synthetic estrogen, including exposure before birth.",
  ],
])
  add(
    "OH",
    "product_liability",
    2,
    ["oh-2305-10", "oh-2307-71"],
    `Ohio Rev. Code § 2305.10(A), ${section}, (C)(7), (F); § 2307.71`,
    scope,
    [
      "Use the earlier competent-medical-authority information or legally confirmed reasonable-diligence knowledge of injury related to exposure.",
      "This selected repose exception requires the bodily injury to result from qualifying exposure during the ten-year first qualifying purchaser/lessee delivery window.",
      "All product/defendant/substance definitions, and any separate reference definitions in § 5903.21 for veterans' claims, must be independently confirmed.",
    ],
    { subtype, calculation: { mode: "discovery_min", requiresExposureWithinDeliveryYears: 10 } },
  );
add(
  "OH",
  "product_liability",
  2,
  ["oh-2305-10", "oh-2307-71"],
  "Ohio Rev. Code § 2305.10(A), (B)(5), (C)(6), (F)",
  "Qualifying asbestos-exposure bodily-injury claim under the express asbestos discovery/repose exception.",
  [
    "Use the earlier competent-medical-authority information or legally confirmed reasonable-diligence knowledge of injury related to asbestos.",
    "This is bodily injury, not a computation of Ohio's separate wrongful-death cause of action.",
  ],
  { subtype: "asbestos", calculation: { mode: "discovery_min" } },
);
for (const [state, sources, pinpoint, scope, conditions] of [
  [
    "IA",
    ["ia-c614-2026"],
    "Iowa Code § 614.1(2), (2A)(a), (b)",
    "Latent disease from statutorily defined harmful material within the product provision.",
    [
      "Harmful material is limited to pre-July 12, 1992 silicone gel breast implants; asbestos, dioxins, tobacco, PCBs; or a substance satisfying the statutory EPA/state unreasonable-risk determination and regulation criteria.",
      "Knowledge must concern both disease and its cause. Claims governed by improvements-to-real-property subsection (11), medical malpractice or other special statutes are excluded.",
    ],
  ],
  [
    "KS",
    ["ks-60-513", "ks-60-3303"],
    "K.S.A. §§ 60-513(a)(4), (b), 60-3303(a)–(d)",
    "Product seller's latent-disease claim involving statutorily defined harmful material.",
    [
      "Harmful material is limited to pre-July 1, 1992 silicone gel breast implants; asbestos, dioxins, PCBs; or a substance satisfying the statutory EPA/Kansas unreasonable-risk determination and regulation criteria.",
      "Knowledge must concern both disease and its cause. The ten-year useful-safe-life presumption is rebuttable, not a universal absolute cutoff.",
      "The 60-513 ten-year discovery cap has the specified latent-disease exception; useful safe life, warranties and other defenses remain independently reviewed.",
    ],
  ],
])
  add(state, "product_liability", 2, sources, pinpoint, scope, conditions, {
    subtype: "latent_toxic",
    calculation: { mode: "discovery_min" },
  });
const research = [
  [
    "CT",
    "personal_injury",
    2,
    ["ct-ch926"],
    "Conn. Gen. Stat. § 52-584",
    "Negligence injury: two years from injury sustained or actual/reasonable-care discovery, with three-year act/omission cap.",
    ["Do not compute a single two-year date without the separate act/omission cap and exceptions."],
  ],
  [
    "CT",
    "product_liability",
    null,
    ["ct-ch926"],
    "Conn. Gen. Stat. § 52-577c",
    "Environmental release of a statutorily defined hazardous substance/pollutant has a distinct two-year provision.",
    [
      "Review the release/environment and substance definitions and exceptions; this is not all toxic products.",
    ],
  ],
  [
    "KS",
    "product_liability",
    null,
    ["ks-60-3303"],
    "K.S.A. § 60-3303(a)–(d)",
    "Useful-safe-life defense and ten-year rebuttable presumption have extended warranties, concealment, prolonged-exposure and latent-disease exceptions.",
    ["Never treat the number ten as a universal automatic product cutoff."],
  ],
  [
    "IA",
    "product_liability",
    null,
    ["ia-c614-2026"],
    "Iowa Code § 614.1(2A)(a), (b)",
    "Fifteen-year product provision has longer express-warranty, concealment and defined latent-harmful-material exceptions.",
    [],
  ],
  [
    "IL",
    "product_liability",
    null,
    ["il-13-202", "il-13-213"],
    "735 ILCS 5/13-202, 13-213, text WITHOUT P.A. 89-7 changes",
    "Publisher labels the expanded P.A. 89-7 version unconstitutional. The unaffected text applies repose to strict-liability product claims, with 12/10-year and other exception analysis.",
    [
      "Do not apply the invalid expanded all-theories version. Separate negligence, strict liability, warranty, first-sale and first-user dates.",
    ],
  ],
  [
    "LA",
    "personal_injury",
    null,
    ["la-3493-1"],
    "La. Civ. Code art. 3493.1; 2024 Act 423",
    "Current delictual-action text gives two years, with a July 1, 2024 statutory change; transition must be independently resolved.",
    [
      "Do not replace historic one-year rules wholesale or infer event-date applicability from a current page.",
    ],
  ],
  [
    "DC",
    "personal_injury",
    null,
    ["dc-12-301", "dc-12-311"],
    "D.C. Code §§ 12-301(a)(8), 12-311",
    "Three-year residual classification and asbestos-specific trigger provisions require distinct claim mapping.",
    [
      "The asbestos provision includes alternative later-of windows, not a generic two-year or three-year exposure deadline.",
    ],
  ],
  [
    "MO",
    "personal_injury",
    null,
    ["mo-516-120"],
    "Mo. Rev. Stat. § 516.120(4)",
    "Five-year injury-to-person/rights classification is subject to special statutes and accrual law.",
    [],
  ],
  [
    "NE",
    "personal_injury",
    null,
    ["ne-25-207"],
    "Neb. Rev. Stat. § 25-207(3)",
    "Four-year injury-to-rights residual classification needs claim-specific mapping and special-statute review.",
    [],
  ],
  [
    "UT",
    "personal_injury",
    null,
    ["ut-78b-2-307"],
    "Utah Code § 78B-2-307(4)",
    "Four-year residual relief provision does not itself establish every injury or product classification.",
    [],
  ],
  [
    "WY",
    "personal_injury",
    null,
    ["wy-title1c3-2026"],
    "Wyo. Stat. § 1-3-105(a)(iv)(C)",
    "Four-year noncontractual injury-to-rights provision requires claim classification and special-statute review.",
    [],
  ],
  [
    "NJ",
    "personal_injury",
    null,
    ["nj-2019-c120"],
    "N.J.S.A. 2A:14-2, as reproduced in P.L. 2019, c.120",
    "Enacted amendment reproduces a two-year ordinary-injury provision; current codification and intervening changes remain unverified.",
    [
      "The same act contains sexual-abuse provisions. It does not verify every current product/injury limitation or historical version.",
    ],
  ],
  [
    "IN",
    "product_liability",
    null,
    ["in-code-2026"],
    "IC 34-20-3-2; Myers, 53 N.E.3d at 1165–1167",
    "Myers invalidated the asbestos section's disparate treatment and held protracted-exposure claims outside product repose.",
    [
      "The published section cannot be implemented as operative law solely from its appearance in the 2026 compilation.",
    ],
  ],
  [
    "NY",
    "personal_injury",
    null,
    ["ny-cplr202", "ny-cplr208"],
    "CPLR §§ 202, 208",
    "Nonresident outside-New-York accrual may require both New York and foreign timeliness; infancy/insanity rules have statutory limits.",
    [],
  ],
  [
    "VA",
    "personal_injury",
    null,
    ["va-8-01-230", "va-8-01-229", "va-8-01-249"],
    "Va. Code §§ 8.01-229, 8.01-230, 8.01-249",
    "General accrual and enumerated discovery exceptions differ; disability, death, nonsuit and other tolling require separate branches.",
    [],
  ],
  [
    "CA",
    "personal_injury",
    null,
    ["ca-12a", "ca-352"],
    "Cal. Code Civ. Proc. §§ 12a, 352",
    "Time computation and specified minority/disability provisions are not applied without the correct court calendar and statutory exclusions.",
    [],
  ],
];
for (const s of research)
  add(...s, { computation: "research_only", accrualBasis: "requires_review" });
for (const r of data.rules) {
  if (r.id === "az-validity-1-20261002") r.caseReferenceIds = ["az-hazine-1993"];
  if (r.id === "pa-validity-1-20261002") r.caseReferenceIds = ["pa-neiman-2013"];
  if (
    r.id === "in-product_liability-general-review-20261002" ||
    r.id === "in-product_liability-latent_toxic-review-20261002"
  )
    r.caseReferenceIds = ["in-myers-2016"];
  if (r.jurisdiction === "IN" && r.scope.startsWith("Myers")) {
    r.ruleKind = "validity";
    r.validity =
      "Primary judicial opinion identifies constitutional invalidity; later treatment not comprehensively reviewed";
    r.caseReferenceIds = ["in-myers-2016"];
  }
  if (r.jurisdiction === "ID" && r.claimType === "wrongful_death")
    r.accrualBasis = "confirmed_accrual";
  if (r.jurisdiction === "OH" && r.subtype === "agent_orange") {
    r.computation = "research_only";
    r.validity =
      "Referenced § 5903.21 definitions were unavailable at the current official publisher on capture; no automatic computation.";
    const missing =
      "Current official § 5903.21 URL returned Number Not Found. Resolve the referenced definitions, repeals and historical applicability before using this branch.";
    if (!r.conditions.includes(missing)) r.conditions.push(missing);
  }
}
await writeFile(file, JSON.stringify(data, null, 2) + "\n");
console.log(
  JSON.stringify({
    rules: data.rules.length,
    baseline: data.rules.filter((r) => r.computation === "baseline_only").length,
    research: data.rules.filter((r) => r.computation === "research_only").length,
  }),
);
