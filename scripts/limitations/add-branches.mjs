import { readFile, writeFile } from "node:fs/promises";
const file = "public/data/limitations/rules.json";
const data = JSON.parse(await readFile(file, "utf8"));
const seed = data.rules.find((r) => r.id === "va-personal_injury-baseline-20261002");
const specs = [
  [
    "NY",
    "product_liability",
    "latent_toxic",
    3,
    ["ny-cplr214c"],
    "CPLR § 214-c(2), (4)-(6)",
    "Latent effects of exposure to a substance; injury discovery is distinct from discovery of its cause.",
    "discovery_min",
    null,
    [
      "Medical/dental malpractice excluded; statutory historic exclusion in (6) must be checked.",
      "Any cause-discovery extension under (4) must be separately resolved; it is not computed.",
    ],
  ],
  [
    "VA",
    "product_liability",
    "latent_toxic",
    2,
    ["va-8-01-243", "va-8-01-249"],
    "Va. Code §§ 8.01-243(A), 8.01-249(4a)",
    "Latent substance/product injury, excluding asbestos and claims against health-care providers.",
    "discovery_min",
    2,
    [
      "Both injury and its causal connection to the substance/product must be actually or constructively known.",
      "If the injured person has died, supply the death date for the statutory two-year death cap.",
    ],
  ],
  [
    "VA",
    "product_liability",
    "asbestos",
    2,
    ["va-8-01-243", "va-8-01-249"],
    "Va. Code §§ 8.01-243(A), 8.01-249(4)",
    "Qualifying asbestos-related diagnosis first communicated by a physician.",
    "diagnosis",
    2,
    [
      "The diagnosis must be a qualifying disabling asbestos-related injury/disease.",
      "Separate later malignant injury, representative issues and prior claims require review; supply death date if deceased.",
    ],
  ],
  [
    "VA",
    "product_liability",
    "medical_device",
    2,
    ["va-8-01-243", "va-8-01-249"],
    "Va. Code §§ 8.01-243(A), 8.01-249(9)",
    "Implanted medical-device product claim against a party other than a health-care provider.",
    "discovery_min",
    null,
    [
      "Knowledge must cover the injury and causal connection to the implanted device.",
      "Breast augmentation/reconstruction prostheses have the separate branch in (7); do not apply (9) automatically.",
    ],
  ],
  [
    "VA",
    "product_liability",
    "breast_implant",
    2,
    ["va-8-01-243", "va-8-01-249"],
    "Va. Code §§ 8.01-243(A), 8.01-249(7)",
    "Prosthetic device implanted for breast augmentation/reconstruction; non-health-care-provider product defendant.",
    "diagnosis",
    null,
    [
      "A physician must first communicate both injury and its causal connection to implantation; diagnosis alone is insufficient.",
    ],
  ],
  [
    "MD",
    "wrongful_death",
    "occupational_disease",
    3,
    ["md-cjp3-904"],
    "Md. Code, Cts. & Jud. Proc. § 3-904(g)(2)",
    "Occupational disease caused by workplace toxic exposure and contributing to death.",
    "death_cause_min",
    10,
    [
      "The occupational-disease statutory definition must be satisfied.",
      "Use the shorter of ten years from death and three years from cause-of-death discovery; do not substitute an earlier diagnosis.",
    ],
  ],
];
for (const [
  jurisdiction,
  claimType,
  subtype,
  years,
  sourceIds,
  pinpoint,
  scope,
  mode,
  cap,
  conditions,
] of specs) {
  const id = `${jurisdiction.toLowerCase()}-${claimType}-${subtype}-20261002`;
  if (data.rules.some((r) => r.id === id)) continue;
  data.rules.push({
    ...seed,
    id,
    jurisdiction,
    claimType,
    subtype,
    period: { amount: years, unit: "calendar_years" },
    sourceIds,
    pinpoint,
    scope,
    summary: scope,
    conditions,
    accrualBasis: "confirmed_accrual",
    exclusions: [
      "Unresolved choice of law, historical applicability, tolling, disability, previous actions or service requirements.",
    ],
    calculation: {
      mode,
      ...(cap
        ? mode === "death_cause_min"
          ? { secondaryCapYears: cap }
          : { deathCapYears: cap }
        : {}),
    },
  });
}
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  JSON.stringify({
    rules: data.rules.length,
    baseline: data.rules.filter((r) => r.computation === "baseline_only").length,
    branches: specs.length,
  }),
);
