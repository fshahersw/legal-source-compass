"""Product ↔ MDL map: which products an MDL's official JPML title names, and the exact source searches that follow.

Evidence rule (WAVE1025, AGENTS.md): a product is linked to an MDL only when the JPML title (pending report title, or the
terminated-litigation report caption) names it. Every entry lists `tokens`: words printed in that title; the builder
refuses an entry whose tokens do not all occur in the stored title (case-insensitive), and the SQL loader checks the same.
The search is built only from those tokens, or from the official FDA classification of the device type / drug class the
title names (FDA product codes, the openFDA Established Pharmacologic Class); `note` says which, and how a search is
narrower or broader than the title. MDLs whose named product cannot be isolated by the title's own terms are listed in
NOT_MAPPED with the reason, never approximated.

Kinds and sources: drug → FAERS (drug/event) + drug enforcement; device → MAUDE (device/event) + device recalls and
device enforcement; food/cosmetic → CAERS (food/event); vehicle → NHTSA complaints (rule over make/model/component/text).
"""

DRUG = "drug"
DEVICE = "device"

# names: product names printed in the title (brand or generic). FAERS search = any drug in the report whose openFDA
# harmonised generic or brand name, or the reported medicinal product name, contains the name as a phrase.
# epc: the FDA Established Pharmacologic Class (openFDA pharm_class_epc) that is the class the title names.
# reactions: MedDRA preferred terms for a condition the title names (AND-ed with the product search).
# generics: generic names printed in the title, used to link the per-product FAERS pages (exact or salt form).
MDLS = [
    # ---------------------------------------------------------------- drugs, pending (JPML pending report titles)
    {"mdl": 1871, "kind": DRUG, "label": "Avandia (rosiglitazone)", "tokens": ["Avandia"], "basis": "title_names_brand", "names": ["Avandia"]},
    {"mdl": 2243, "kind": DRUG, "label": "Fosamax (alendronate sodium)", "tokens": ["Fosamax", "Alendronate Sodium"], "basis": "title_names_product",
     "names": ["Fosamax", "Alendronate"], "generics": ["Alendronate Sodium"]},
    {"mdl": 2740, "kind": DRUG, "label": "Taxotere (docetaxel)", "tokens": ["Taxotere", "Docetaxel"], "basis": "title_names_product",
     "names": ["Taxotere", "Docetaxel"], "generics": ["Docetaxel"]},
    {"mdl": 3023, "kind": DRUG, "label": "Taxotere (docetaxel) — eye injury", "tokens": ["Taxotere", "Docetaxel", "Eye Injury"],
     "basis": "title_names_product", "names": ["Taxotere", "Docetaxel"], "generics": ["Docetaxel"],
     "note_extra": "The title also names 'Eye Injury', which is not a MedDRA term; the series counts every report of the product (not only eye injuries)."},
    {"mdl": 2789, "kind": DRUG, "label": "Proton-pump inhibitors", "tokens": ["Proton-Pump Inhibitor"], "basis": "title_names_class",
     "epc": ["Proton Pump Inhibitor"]},
    {"mdl": 2848, "kind": DRUG, "label": "Zostavax (zoster vaccine live)", "tokens": ["Zostavax", "Zoster Vaccine Live"], "basis": "title_names_product",
     "names": ["Zostavax"],
     "note_extra": "Vaccine adverse events are reported mainly to VAERS, which openFDA does not carry; FAERS holds only the reports submitted there."},
    {"mdl": 2875, "kind": DRUG, "label": "Valsartan, losartan, irbesartan", "tokens": ["Valsartan", "Losartan", "Irbesartan"], "basis": "title_names_product",
     "names": ["Valsartan", "Losartan", "Irbesartan"], "generics": ["Valsartan", "Losartan", "Irbesartan"]},
    {"mdl": 2924, "kind": DRUG, "label": "Zantac (ranitidine)", "tokens": ["Zantac", "Ranitidine"], "basis": "title_names_product",
     "names": ["Zantac", "Ranitidine"], "generics": ["Ranitidine"]},
    {"mdl": 2973, "kind": DRUG, "label": "Elmiron (pentosan polysulfate sodium)", "tokens": ["Elmiron", "Pentosan Polysulfate Sodium"],
     "basis": "title_names_product", "names": ["Elmiron", "Pentosan Polysulfate"], "generics": ["Pentosan Polysulfate Sodium"]},
    {"mdl": 2974, "kind": DRUG, "label": "Paragard IUD", "tokens": ["Paragard"], "basis": "title_names_brand", "names": ["Paragard"],
     "note_extra": "Paragard (copper IUD) is approved as a drug (NDA), so its reports are in FAERS."},
    {"mdl": 3006, "kind": DRUG, "label": "Tasigna (nilotinib)", "tokens": ["Tasigna", "Nilotinib"], "basis": "title_names_product",
     "names": ["Tasigna", "Nilotinib"], "generics": ["Nilotinib"]},
    {"mdl": 3036, "kind": DRUG, "label": "Gardasil", "tokens": ["Gardasil"], "basis": "title_names_brand", "names": ["Gardasil"],
     "note_extra": "Vaccine adverse events are reported mainly to VAERS, which openFDA does not carry; FAERS holds only the reports submitted there."},
    {"mdl": 3043, "kind": DRUG, "label": "Acetaminophen", "tokens": ["Acetaminophen"], "basis": "title_names_product",
     "names": ["Acetaminophen"], "generics": ["Acetaminophen"],
     "note_extra": "The title names the ASD/ADHD claims; the series counts every report listing acetaminophen."},
    {"mdl": 3050, "kind": DRUG, "label": "Chantix (varenicline)", "tokens": ["Chantix", "Varenicline"], "basis": "title_names_product",
     "names": ["Chantix", "Varenicline"], "generics": ["Varenicline"]},
    {"mdl": 3079, "kind": DRUG, "label": "Tepezza", "tokens": ["Tepezza"], "basis": "title_names_brand", "names": ["Tepezza"]},
    {"mdl": 3092, "kind": DRUG, "label": "Suboxone (buprenorphine/naloxone) film", "tokens": ["Suboxone", "Buprenorphine/Naloxone"],
     "basis": "title_names_brand", "names": ["Suboxone"],
     "note_extra": "The search uses the brand Suboxone: the generic buprenorphine/naloxone also covers tablets and other makers' products, which the title (Suboxone film) does not name."},
    {"mdl": 3094, "kind": DRUG, "label": "GLP-1 receptor agonists", "tokens": ["Glucagon-like Peptide-1 Receptor Agonists", "GLP-1 RAs"],
     "basis": "title_names_class", "epc": ["GLP-1 Receptor Agonist"]},
    {"mdl": 3163, "kind": DRUG, "label": "GLP-1 receptor agonists — NAION", "tokens": ["GLP-1 RAs", "Non-Arteritic Anterior Ischemic Optic Neuropathy"],
     "basis": "title_names_class", "epc": ["GLP-1 Receptor Agonist"], "reactions": ["Optic ischaemic neuropathy"],
     "note_extra": "NAION is coded in MedDRA under the preferred term 'Optic ischaemic neuropathy' (non-arteritic and arteritic forms share it)."},
    {"mdl": 3140, "kind": DRUG, "label": "Depo-Provera (depot medroxyprogesterone acetate)", "tokens": ["Depo-Provera", "Medroxyprogesterone Acetate"],
     "basis": "title_names_brand", "names": ["Depo-Provera", "Depo-SubQ Provera"], "generics": ["Medroxyprogesterone Acetate"],
     "note_extra": "The search uses the brand names of the depot injection; the generic medroxyprogesterone acetate page also counts tablets."},
    {"mdl": 3180, "kind": DRUG, "label": "Dupixent (dupilumab)", "tokens": ["Dupixent", "Dupilumab"], "basis": "title_names_product",
     "names": ["Dupixent", "Dupilumab"], "generics": ["Dupilumab"]},
    # ---------------------------------------------------------------- drugs, terminated (JPML terminated-litigation report captions)
    {"mdl": 1348, "kind": DRUG, "label": "Rezulin", "tokens": ["Rezulin"], "basis": "title_names_brand", "names": ["Rezulin"]},
    {"mdl": 1355, "kind": DRUG, "label": "Propulsid", "tokens": ["Propulsid"], "basis": "title_names_brand", "names": ["Propulsid"]},
    {"mdl": 1431, "kind": DRUG, "label": "Baycol", "tokens": ["Baycol"], "basis": "title_names_brand", "names": ["Baycol"]},
    {"mdl": 1477, "kind": DRUG, "label": "Serzone", "tokens": ["Serzone"], "basis": "title_names_brand", "names": ["Serzone"]},
    {"mdl": 1481, "kind": DRUG, "label": "Meridia", "tokens": ["Meridia"], "basis": "title_names_brand", "names": ["Meridia"]},
    {"mdl": 1507, "kind": DRUG, "label": "Prempro", "tokens": ["Prempro"], "basis": "title_names_brand", "names": ["Prempro"]},
    {"mdl": 1574, "kind": DRUG, "label": "Paxil", "tokens": ["Paxil"], "basis": "title_names_brand", "names": ["Paxil"]},
    {"mdl": 1596, "kind": DRUG, "label": "Zyprexa", "tokens": ["Zyprexa"], "basis": "title_names_brand", "names": ["Zyprexa"]},
    {"mdl": 1626, "kind": DRUG, "label": "Accutane (isotretinoin)", "tokens": ["Accutane", "Isotretinoin"], "basis": "title_names_product",
     "names": ["Accutane", "Isotretinoin"], "generics": ["Isotretinoin"]},
    {"mdl": 1629, "kind": DRUG, "label": "Neurontin", "tokens": ["Neurontin"], "basis": "title_names_brand", "names": ["Neurontin"]},
    {"mdl": 1657, "kind": DRUG, "label": "Vioxx", "tokens": ["Vioxx"], "basis": "title_names_brand", "names": ["Vioxx"]},
    {"mdl": 1699, "kind": DRUG, "label": "Bextra and Celebrex", "tokens": ["Bextra", "Celebrex"], "basis": "title_names_brand", "names": ["Bextra", "Celebrex"]},
    {"mdl": 1724, "kind": DRUG, "label": "Viagra", "tokens": ["Viagra"], "basis": "title_names_brand", "names": ["Viagra"]},
    {"mdl": 1736, "kind": DRUG, "label": "Celexa and Lexapro", "tokens": ["Celexa", "Lexapro"], "basis": "title_names_brand", "names": ["Celexa", "Lexapro"]},
    {"mdl": 1742, "kind": DRUG, "label": "Ortho Evra", "tokens": ["Ortho Evra"], "basis": "title_names_brand", "names": ["Ortho Evra"]},
    {"mdl": 1760, "kind": DRUG, "label": "Aredia and Zometa", "tokens": ["Aredia", "Zometa"], "basis": "title_names_brand", "names": ["Aredia", "Zometa"]},
    {"mdl": 1769, "kind": DRUG, "label": "Seroquel", "tokens": ["Seroquel"], "basis": "title_names_brand", "names": ["Seroquel"]},
    {"mdl": 1789, "kind": DRUG, "label": "Fosamax", "tokens": ["Fosamax"], "basis": "title_names_brand", "names": ["Fosamax"]},
    {"mdl": 1836, "kind": DRUG, "label": "Mirapex", "tokens": ["Mirapex"], "basis": "title_names_brand", "names": ["Mirapex"]},
    {"mdl": 1909, "kind": DRUG, "label": "Gadolinium contrast dyes", "tokens": ["Gadolinium Contrast Dyes"], "basis": "title_names_class",
     "epc": ["Gadolinium-based Contrast Agent"]},
    {"mdl": 1928, "kind": DRUG, "label": "Trasylol", "tokens": ["Trasylol"], "basis": "title_names_brand", "names": ["Trasylol"]},
    {"mdl": 1938, "kind": DRUG, "label": "Vytorin and Zetia", "tokens": ["Vytorin", "Zetia"], "basis": "title_names_brand", "names": ["Vytorin", "Zetia"]},
    {"mdl": 1943, "kind": DRUG, "label": "Levaquin", "tokens": ["Levaquin"], "basis": "title_names_brand", "names": ["Levaquin"]},
    {"mdl": 1953, "kind": DRUG, "label": "Heparin", "tokens": ["Heparin"], "basis": "title_names_product", "names": ["Heparin"], "generics": ["Heparin Sodium"],
     "note_extra": "The search counts every report listing heparin; the title does not name a maker or lot."},
    {"mdl": 1964, "kind": DRUG, "label": "NuvaRing", "tokens": ["NuvaRing"], "basis": "title_names_brand", "names": ["NuvaRing"]},
    {"mdl": 1968, "kind": DRUG, "label": "Digitek", "tokens": ["Digitek"], "basis": "title_names_brand", "names": ["Digitek"]},
    {"mdl": 2092, "kind": DRUG, "label": "Chantix (varenicline)", "tokens": ["Chantix", "Varenicline"], "basis": "title_names_product",
     "names": ["Chantix", "Varenicline"], "generics": ["Varenicline"]},
    {"mdl": 2096, "kind": DRUG, "label": "Zicam cold remedy", "tokens": ["Zicam"], "basis": "title_names_brand", "names": ["Zicam"]},
    {"mdl": 2100, "kind": DRUG, "label": "Yasmin and Yaz (drospirenone)", "tokens": ["Yasmin", "Yaz", "Drospirenone"], "basis": "title_names_product",
     "names": ["Yasmin", "Yaz", "Drospirenone"], "generics": ["Drospirenone"]},
    {"mdl": 2120, "kind": DRUG, "label": "Pamidronate", "tokens": ["Pamidronate"], "basis": "title_names_product", "names": ["Pamidronate"],
     "generics": ["Pamidronate Disodium"]},
    {"mdl": 2226, "kind": DRUG, "label": "Darvocet, Darvon and propoxyphene", "tokens": ["Darvocet", "Darvon", "Propoxyphene"],
     "basis": "title_names_product", "names": ["Darvocet", "Darvon", "Propoxyphene"]},
    {"mdl": 2299, "kind": DRUG, "label": "Actos (pioglitazone)", "tokens": ["Actos", "Pioglitazone"], "basis": "title_names_product",
     "names": ["Actos", "Pioglitazone"], "generics": ["Pioglitazone"]},
    {"mdl": 2331, "kind": DRUG, "label": "Propecia (finasteride)", "tokens": ["Propecia", "Finasteride"], "basis": "title_names_brand",
     "names": ["Propecia"], "generics": ["Finasteride"],
     "note_extra": "The search uses the brand Propecia: generic finasteride also covers Proscar (5 mg), which the title does not name."},
    {"mdl": 2342, "kind": DRUG, "label": "Zoloft (sertraline hydrochloride)", "tokens": ["Zoloft", "Sertraline Hydrochloride"], "basis": "title_names_product",
     "names": ["Zoloft", "Sertraline"], "generics": ["Sertraline Hydrochloride"]},
    {"mdl": 2385, "kind": DRUG, "label": "Pradaxa (dabigatran etexilate)", "tokens": ["Pradaxa", "Dabigatran Etexilate"], "basis": "title_names_product",
     "names": ["Pradaxa", "Dabigatran"], "generics": ["Dabigatran Etexilate Mesylate"]},
    {"mdl": 2404, "kind": DRUG, "label": "Nexium (esomeprazole)", "tokens": ["Nexium", "Esomeprazole"], "basis": "title_names_product",
     "names": ["Nexium", "Esomeprazole"], "generics": ["Esomeprazole Magnesium"]},
    {"mdl": 2418, "kind": DRUG, "label": "Plavix", "tokens": ["Plavix"], "basis": "title_names_brand", "names": ["Plavix"]},
    {"mdl": 2436, "kind": DRUG, "label": "Tylenol (acetaminophen)", "tokens": ["Tylenol", "Acetaminophen"], "basis": "title_names_brand",
     "names": ["Tylenol"], "generics": ["Acetaminophen"],
     "note_extra": "The search uses the brand Tylenol: generic acetaminophen covers many other makers' products the title does not name."},
    {"mdl": 2452, "kind": DRUG, "label": "Incretin-based therapies", "tokens": ["Incretin-Based Therapies"], "basis": "title_names_class",
     "epc": ["GLP-1 Receptor Agonist", "Dipeptidyl Peptidase 4 Inhibitor"],
     "note_extra": "Incretin-based therapies are counted as the two FDA Established Pharmacologic Classes that act on the incretin pathway (GLP-1 receptor agonists and DPP-4 inhibitors); the title names the therapies, not the classes."},
    {"mdl": 2458, "kind": DRUG, "label": "Effexor (venlafaxine hydrochloride)", "tokens": ["Effexor", "Venlafaxine Hydrochloride"], "basis": "title_names_product",
     "names": ["Effexor", "Venlafaxine"], "generics": ["Venlafaxine Hydrochloride"]},
    {"mdl": 2502, "kind": DRUG, "label": "Lipitor (atorvastatin calcium)", "tokens": ["Lipitor", "Atorvastatin Calcium"], "basis": "title_names_product",
     "names": ["Lipitor", "Atorvastatin"], "generics": ["Atorvastatin Calcium"]},
    {"mdl": 2545, "kind": DRUG, "label": "Testosterone replacement therapy", "tokens": ["Testosterone Replacement Therapy"], "basis": "title_names_product",
     "names": ["Testosterone"]},
    {"mdl": 2606, "kind": DRUG, "label": "Benicar (olmesartan)", "tokens": ["Benicar", "Olmesartan"], "basis": "title_names_product",
     "names": ["Benicar", "Olmesartan"], "generics": ["Olmesartan Medoxomil"]},
    {"mdl": 2642, "kind": DRUG, "label": "Fluoroquinolones", "tokens": ["Fluoroquinolone"], "basis": "title_names_class", "epc": ["Fluoroquinolone Antibacterial"]},
    {"mdl": 2657, "kind": DRUG, "label": "Zofran (ondansetron)", "tokens": ["Zofran", "Ondansetron"], "basis": "title_names_product",
     "names": ["Zofran", "Ondansetron"], "generics": ["Ondansetron"]},
    {"mdl": 2691, "kind": DRUG, "label": "Viagra (sildenafil citrate) and Cialis (tadalafil)", "tokens": ["Viagra", "Sildenafil Citrate", "Cialis", "Tadalafil"],
     "basis": "title_names_product", "names": ["Viagra", "Sildenafil", "Cialis", "Tadalafil"], "generics": ["Sildenafil Citrate", "Tadalafil"]},
    {"mdl": 2734, "kind": DRUG, "label": "Abilify (aripiprazole)", "tokens": ["Abilify", "Aripiprazole"], "basis": "title_names_product",
     "names": ["Abilify", "Aripiprazole"], "generics": ["Aripiprazole"]},
    {"mdl": 2750, "kind": DRUG, "label": "Invokana (canagliflozin)", "tokens": ["Invokana", "Canagliflozin"], "basis": "title_names_product",
     "names": ["Invokana", "Canagliflozin"], "generics": ["Canagliflozin"]},
    {"mdl": 2754, "kind": DRUG, "label": "Eliquis (apixaban)", "tokens": ["Eliquis", "Apixaban"], "basis": "title_names_product",
     "names": ["Eliquis", "Apixaban"], "generics": ["Apixaban"]},
    {"mdl": 2767, "kind": DRUG, "label": "Mirena IUS (levonorgestrel)", "tokens": ["Mirena", "Levonorgestrel"], "basis": "title_names_brand",
     "names": ["Mirena"],
     "note_extra": "The search uses the brand Mirena: generic levonorgestrel also covers oral contraceptives the title does not name."},
    {"mdl": 2776, "kind": DRUG, "label": "Farxiga (dapagliflozin)", "tokens": ["Farxiga", "Dapagliflozin"], "basis": "title_names_product",
     "names": ["Farxiga", "Dapagliflozin"], "generics": ["Dapagliflozin"]},
    {"mdl": 2809, "kind": DRUG, "label": "Onglyza (saxagliptin) and Kombiglyze XR", "tokens": ["Onglyza", "Saxagliptin", "Kombiglyze XR"],
     "basis": "title_names_product", "names": ["Onglyza", "Saxagliptin", "Kombiglyze"], "generics": ["Saxagliptin"]},
    # ---------------------------------------------------------------- devices (MAUDE); searches use the title's manufacturer and device words
    {"mdl": 2197, "kind": DEVICE, "label": "DePuy ASR hip implant", "tokens": ["DePuy", "ASR Hip Implant"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"asr"+AND+device.manufacturer_d_name:"depuy"', "recall": 'recalling_firm:"depuy"+AND+product_description:"asr"'},
    {"mdl": 2244, "kind": DEVICE, "label": "DePuy Pinnacle hip implant", "tokens": ["DePuy", "Pinnacle Hip Implant"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"pinnacle"+AND+device.manufacturer_d_name:"depuy"', "recall": 'recalling_firm:"depuy"+AND+product_description:"pinnacle"'},
    {"mdl": 2441, "kind": DEVICE, "label": "Stryker Rejuvenate and ABG II hip stems", "tokens": ["Stryker", "Rejuvenate", "ABG II"],
     "basis": "title_names_manufacturer_and_device",
     "maude": '(device.brand_name:"rejuvenate"+device.brand_name:"abg ii")+AND+device.manufacturer_d_name:"stryker"',
     "recall": 'recalling_firm:"stryker"+AND+(product_description:"rejuvenate"+product_description:"abg ii")'},
    {"mdl": 2570, "kind": DEVICE, "label": "Cook Medical IVC filters", "tokens": ["Cook Medical", "IVC Filters"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.manufacturer_d_name:"cook"+AND+device.device_report_product_code:"DTK"',
     "recall": 'recalling_firm:"cook"+AND+product_code:"DTK"',
     "note_extra": "IVC filters are counted by FDA product code DTK ('Filter, Intravascular, Cardiovascular'), the classification of the device the title names."},
    {"mdl": 2666, "kind": DEVICE, "label": "Bair Hugger forced-air warming devices", "tokens": ["Bair Hugger"], "basis": "title_names_product",
     "maude": 'device.brand_name:"bair hugger"', "recall": 'product_description:"bair hugger"'},
    {"mdl": 2753, "kind": DEVICE, "label": "Atrium C-Qur mesh", "tokens": ["Atrium", "C-Qur"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"c-qur"+AND+device.manufacturer_d_name:"atrium"', "recall": 'recalling_firm:"atrium"+AND+product_description:"c-qur"'},
    {"mdl": 2768, "kind": DEVICE, "label": "Stryker LFIT V40 femoral head", "tokens": ["Stryker", "LFIT V40"], "basis": "title_names_manufacturer_and_device",
     "maude": '(device.brand_name:"v40"+device.brand_name:"lfit")+AND+device.manufacturer_d_name:"stryker"',
     "recall": 'recalling_firm:"stryker"+AND+(product_description:"v40"+product_description:"lfit")'},
    {"mdl": 2775, "kind": DEVICE, "label": "Smith & Nephew Birmingham Hip Resurfacing", "tokens": ["Smith & Nephew", "Birmingham Hip Resurfacing"],
     "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"birmingham hip"+AND+device.manufacturer_d_name:"smith"',
     "recall": 'recalling_firm:"smith"+AND+product_description:"birmingham hip"'},
    {"mdl": 2782, "kind": DEVICE, "label": "Ethicon Physiomesh", "tokens": ["Ethicon", "Physiomesh"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"physiomesh"', "recall": 'product_description:"physiomesh"'},
    {"mdl": 2816, "kind": DEVICE, "label": "Sorin 3T heater-cooler", "tokens": ["Sorin", "3T Heater-Cooler"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"3t"+AND+device.manufacturer_d_name:"sorin"',
     "recall": 'recalling_firm:"sorin"+AND+product_description:"3t"',
     "note_extra": "Reports that name the maker only as LivaNova (Sorin's later name) are not counted: the title names Sorin."},
    {"mdl": 2846, "kind": DEVICE, "label": "Davol / C.R. Bard polypropylene hernia mesh", "tokens": ["Davol", "C.R. Bard", "Polypropylene Hernia Mesh"],
     "basis": "title_names_manufacturer_and_device",
     "maude": '(device.manufacturer_d_name:"davol"+device.manufacturer_d_name:"bard")+AND+device.device_report_product_code:"FTL"',
     "recall": '(recalling_firm:"davol"+recalling_firm:"bard")+AND+product_code:"FTL"',
     "note_extra": "Hernia mesh is counted by FDA product code FTL ('Mesh, Surgical, Polymeric'); the code also covers non-polypropylene meshes of these makers."},
    {"mdl": 2859, "kind": DEVICE, "label": "Zimmer M/L Taper hip and Versys femoral head", "tokens": ["Zimmer", "M/L Taper", "Versys Femoral Head"],
     "basis": "title_names_manufacturer_and_device",
     "maude": '(device.brand_name:"m/l taper"+device.brand_name:"versys")+AND+device.manufacturer_d_name:"zimmer"',
     "recall": 'recalling_firm:"zimmer"+AND+(product_description:"m/l taper"+product_description:"versys")'},
    {"mdl": 2921, "kind": DEVICE, "label": "Allergan Biocell textured breast implants", "tokens": ["Allergan", "Biocell", "Textured Breast Implant"],
     "basis": "title_names_manufacturer_and_device",
     "maude": '(device.brand_name:"biocell"+device.brand_name:"textured")+AND+device.manufacturer_d_name:"allergan"',
     "recall": 'recalling_firm:"allergan"+AND+(product_description:"biocell"+product_description:"textured")',
     "note_extra": "Counts Allergan reports whose brand name says Biocell or textured; textured implants reported under a style number only (e.g. 'Style 410') are not counted."},
    {"mdl": 2949, "kind": DEVICE, "label": "Profemur hip implant", "tokens": ["Profemur"], "basis": "title_names_product",
     "maude": 'device.brand_name:"profemur"', "recall": 'product_description:"profemur"'},
    {"mdl": 3014, "kind": DEVICE, "label": "Philips recalled CPAP, Bi-Level PAP and mechanical ventilators", "tokens": ["Philips", "CPAP", "Bi-Level PAP", "Mechanical Ventilator"],
     "basis": "title_names_manufacturer_and_device",
     "maude": '(device.manufacturer_d_name:"philips"+device.brand_name:"philips")+AND+device.device_report_product_code:("BZD"+"CBK"+"NOU"+"MNS"+"MNT"+"QOS")',
     "recall": 'recalling_firm:"philips"+AND+product_code:("BZD"+"CBK"+"NOU"+"MNS"+"MNT"+"QOS")',
     "note_extra": "CPAP, bi-level PAP and ventilators are counted by their FDA product codes (BZD, CBK, NOU, MNS, MNT, QOS) for makers named Philips. Most MAUDE reports on these devices name the maker only as 'Respironics'; the title names Philips, so those reports are NOT counted and this series understates the volume."},
    {"mdl": 3029, "kind": DEVICE, "label": "Covidien hernia mesh", "tokens": ["Covidien", "Hernia Mesh"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.manufacturer_d_name:"covidien"+AND+device.device_report_product_code:"FTL"',
     "recall": 'recalling_firm:"covidien"+AND+product_code:"FTL"',
     "note_extra": "Hernia mesh is counted by FDA product code FTL ('Mesh, Surgical, Polymeric')."},
    {"mdl": 3044, "kind": DEVICE, "label": "Exactech polyethylene orthopedic products", "tokens": ["Exactech"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.manufacturer_d_name:"exactech"', "recall": 'recalling_firm:"exactech"',
     "note_extra": "Counts every Exactech report; the title's 'polyethylene orthopedic products' cannot be isolated by a MAUDE field."},
    {"mdl": 3081, "kind": DEVICE, "label": "Bard implanted port catheters", "tokens": ["Bard", "Implanted Port Catheter"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.manufacturer_d_name:"bard"+AND+device.device_report_product_code:"LJT"',
     "recall": 'recalling_firm:"bard"+AND+product_code:"LJT"',
     "note_extra": "Implanted ports are counted by FDA product code LJT ('Port & Catheter, Implanted, Subcutaneous, Intravascular')."},
    {"mdl": 3125, "kind": DEVICE, "label": "AngioDynamics / Navilyst port catheters", "tokens": ["AngioDynamics", "Navilyst", "Port Catheter"],
     "basis": "title_names_manufacturer_and_device",
     "maude": '(device.manufacturer_d_name:"angiodynamics"+device.manufacturer_d_name:"navilyst")+AND+device.device_report_product_code:"LJT"',
     "recall": '(recalling_firm:"angiodynamics"+recalling_firm:"navilyst")+AND+product_code:"LJT"',
     "note_extra": "Implanted ports are counted by FDA product code LJT."},
    {"mdl": 3172, "kind": DEVICE, "label": "Cartiva synthetic cartilage implant", "tokens": ["Cartiva"], "basis": "title_names_product",
     "maude": 'device.brand_name:"cartiva"', "recall": 'product_description:"cartiva"'},
    {"mdl": 3181, "kind": DEVICE, "label": "Boston Scientific spinal cord stimulators", "tokens": ["Boston Scientific", "Spinal Cord Stimulator"],
     "basis": "title_names_manufacturer_and_device",
     "maude": 'device.manufacturer_d_name:"boston scientific"+AND+device.generic_name:"spinal cord"',
     "recall": 'recalling_firm:"boston scientific"+AND+product_description:"spinal cord"'},
    {"mdl": 1842, "kind": DEVICE, "label": "Kugel mesh hernia patch", "tokens": ["Kugel Mesh"], "basis": "title_names_product",
     "maude": 'device.brand_name:"kugel"', "recall": 'product_description:"kugel"'},
    {"mdl": 1905, "kind": DEVICE, "label": "Medtronic Sprint Fidelis leads", "tokens": ["Medtronic", "Sprint Fidelis"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"sprint fidelis"', "recall": 'product_description:"sprint fidelis"'},
    {"mdl": 2004, "kind": DEVICE, "label": "Mentor ObTape transobturator sling", "tokens": ["Mentor", "ObTape"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"obtape"', "recall": 'product_description:"obtape"'},
    {"mdl": 2158, "kind": DEVICE, "label": "Zimmer Durom hip cup", "tokens": ["Zimmer", "Durom"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"durom"', "recall": 'product_description:"durom"'},
    {"mdl": 2272, "kind": DEVICE, "label": "Zimmer NexGen knee implant", "tokens": ["Zimmer", "NexGen Knee Implant"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"nexgen"+AND+device.manufacturer_d_name:"zimmer"', "recall": 'recalling_firm:"zimmer"+AND+product_description:"nexgen"'},
    {"mdl": 2329, "kind": DEVICE, "label": "Wright Medical Conserve hip implant", "tokens": ["Wright Medical", "Conserve Hip Implant"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"conserve"+AND+device.manufacturer_d_name:"wright"', "recall": 'recalling_firm:"wright"+AND+product_description:"conserve"'},
    {"mdl": 2391, "kind": DEVICE, "label": "Biomet M2a Magnum hip implant", "tokens": ["Biomet", "M2a Magnum"], "basis": "title_names_manufacturer_and_device",
     "maude": '(device.brand_name:"m2a"+device.brand_name:"magnum")+AND+device.manufacturer_d_name:"biomet"',
     "recall": 'recalling_firm:"biomet"+AND+(product_description:"m2a"+product_description:"magnum")'},
    {"mdl": 2652, "kind": DEVICE, "label": "Ethicon power morcellator", "tokens": ["Ethicon", "Power Morcellator"], "basis": "title_names_manufacturer_and_device",
     "maude": 'device.manufacturer_d_name:"ethicon"+AND+device.generic_name:"morcellator"', "recall": 'recalling_firm:"ethicon"+AND+product_description:"morcellator"'},
    {"mdl": 1959, "kind": DEVICE, "label": "Panacryl sutures", "tokens": ["Panacryl Sutures"], "basis": "title_names_product",
     "maude": 'device.brand_name:"panacryl"', "recall": 'product_description:"panacryl"'},
    {"mdl": 2428, "kind": DEVICE, "label": "Fresenius GranuFlo / NaturaLyte dialysate", "tokens": ["Fresenius", "GranuFlo", "NaturaLyte"],
     "basis": "title_names_manufacturer_and_device",
     "maude": 'device.brand_name:"granuflo"+device.brand_name:"naturalyte"', "recall": 'product_description:"granuflo"+product_description:"naturalyte"'},
    # ---------------------------------------------------------------- foods / cosmetics (CAERS) and tobacco
    {"mdl": 3178, "kind": "food", "label": "ByHeart infant formula", "tokens": ["ByHeart", "Infant Formula"], "basis": "title_names_manufacturer_and_device",
     "caers": 'products.name_brand:"byheart"', "recall": 'recalling_firm:"byheart"',
     "note_extra": "Food adverse-event (CAERS) reports naming the brand ByHeart."},
    {"mdl": 3060, "kind": "cosmetic", "label": "Hair relaxers", "tokens": ["Hair Relaxer"], "basis": "title_names_product",
     "caers": 'products.name_brand:"relaxer"+products.name_brand:"relaxers"',
     "note_extra": "Cosmetic adverse-event (CAERS) reports whose product name contains 'relaxer'."},
    # ---------------------------------------------------------------- vehicles (NHTSA complaints received 2020+)
    {"mdl": 2599, "kind": "vehicle", "label": "Takata airbag inflators", "tokens": ["Takata Airbag"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"text": ["TAKATA"], "component": ["AIR BAGS"]}},
    {"mdl": 2672, "kind": "vehicle", "label": "Volkswagen 'clean diesel'", "tokens": ["Volkswagen", "Clean Diesel"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"make": ["VOLKSWAGEN"], "text": ["DIESEL"]}},
    {"mdl": 2777, "kind": "vehicle", "label": "Chrysler-Dodge-Jeep EcoDiesel", "tokens": ["Chrysler-Dodge-Jeep", "EcoDiesel"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"make": ["CHRYSLER", "DODGE", "JEEP", "RAM"], "text": ["ECODIESEL", "ECO DIESEL"]},
     "note_extra": "RAM is included because Chrysler sells the EcoDiesel trucks under the RAM make, which NHTSA records separately from DODGE."},
    {"mdl": 2814, "kind": "vehicle", "label": "Ford DPS6 PowerShift transmission", "tokens": ["Ford", "DPS6 PowerShift Transmission"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"make": ["FORD"], "component": ["POWER TRAIN"], "text": ["POWERSHIFT", "DPS6"]}},
    {"mdl": 2905, "kind": "vehicle", "label": "ZF-TRW airbag control units", "tokens": ["ZF-TRW", "Airbag Control Units"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"text": ["ZF-TRW", "ZF TRW"], "component": ["AIR BAGS"]}},
    {"mdl": 3040, "kind": "vehicle", "label": "Chrysler Pacifica (plug-in hybrid) fire recall", "tokens": ["Chrysler Pacifica", "Fire"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"make": ["CHRYSLER"], "model": ["PACIFICA"], "fire": True},
     "note_extra": "Counts Chrysler Pacifica complaints that NHTSA records as involving a fire."},
    {"mdl": 3051, "kind": "vehicle", "label": "ARC airbag inflators", "tokens": ["ARC Airbag Inflators"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"text": ["ARC AUTOMOTIVE", "ARC INFLATOR", "ARC AIRBAG", "ARC AIR BAG"], "component": ["AIR BAGS"]}},
    {"mdl": 3052, "kind": "vehicle", "label": "Kia / Hyundai vehicle theft", "tokens": ["Kia", "Hyundai", "Vehicle Theft"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"make": ["KIA", "HYUNDAI"], "text": ["THEFT", "STOLEN"]}},
    {"mdl": 2151, "kind": "vehicle", "label": "Toyota unintended acceleration", "tokens": ["Toyota", "Unintended Acceleration"], "basis": "title_names_vehicle_and_component",
     "nhtsa": {"make": ["TOYOTA"], "text": ["UNINTENDED ACCELERATION", "SUDDEN ACCELERATION", "UNINTENDED ACCELERATION"]}},
]

# MDLs whose title names a product but whose product cannot be isolated by the title's own terms in these sources.
NOT_MAPPED = {
    1358: "MTBE is a gasoline additive; none of these sources reports on it.",
    2066: "'Oral sodium phosphate' cannot be isolated in FAERS: the openFDA route field belongs to any drug in a report.",
    2372: "The title names a Watson fentanyl patch; FAERS cannot isolate one maker's transdermal fentanyl by the title's terms.",
    2738: "Johnson & Johnson talcum powder: CAERS cosmetic reports do not carry the maker reliably enough to isolate the product.",
    2741: "Roundup is a pesticide (EPA); none of these sources reports on it.",
    2873: "Aqueous film-forming foams: not an FDA- or NHTSA-reported product.",
    2885: "3M Combat Arms earplugs are not reported in MAUDE as medical devices.",
    2913: "Juul: openFDA tobacco problem reports do not carry a brand field to search by the title's name.",
    3004: "Paraquat is a pesticide (EPA); none of these sources reports on it.",
    3015: "Johnson & Johnson sunscreen: the title names no product name a FAERS/CAERS field holds.",
    3026: "The title names Abbott preterm infant nutrition products without a product name CAERS holds.",
    3037: "The title names recalled Abbott infant formula without a product name; the brand names are not in the title.",
    3101: "Baby food (heavy metals): the title names no brand or maker.",
    3047: "Social media: not a product these sources report on.",
    3078: "Generac solar power systems: not reported in these sources.",
    3087: "Future Motion (Onewheel): consumer product; CPSC record-level reports are out of this stream's scope.",
    2187: "Pelvic repair systems: the MAUDE product codes for urogynecologic mesh changed over time; not mapped in this wave.",
    2325: "Pelvic repair systems (American Medical Systems): as 2187.",
    2326: "Pelvic repair systems (Boston Scientific): as 2187.",
    2327: "Pelvic repair systems (Ethicon): as 2187.",
    2387: "Pelvic support systems (Coloplast): as 2187.",
    2440: "Pelvic repair systems (Cook Medical): as 2187.",
    2511: "Pelvic repair systems (Neomedic): as 2187.",
    1708: "Guidant implantable defibrillators: MAUDE maker names changed with acquisitions (Guidant, Boston Scientific); not isolable by the title's terms.",
    1726: "Medtronic implantable defibrillators: the title names no model; every Medtronic defibrillator would be counted.",
    1785: "Bausch & Lomb contact lens solution: the title names no product name a MAUDE field holds.",
    1407: "Phenylpropanolamine (PPA): withdrawn in 2000, before openFDA FAERS coverage (2004).",
}


def name_clause(name):
    n = name.lower()
    return (f'patient.drug.openfda.generic_name:"{n}"+patient.drug.openfda.brand_name:"{n}"'
            f'+patient.drug.medicinalproduct:"{n}"')


def faers_search(entry):
    """The FAERS search for one drug MDL group (OR over the title's names / classes, AND the title's reaction)."""
    parts = []
    for n in entry.get("names", []):
        parts.append(name_clause(n))
    for epc in entry.get("epc", []):
        parts.append(f'patient.drug.openfda.pharm_class_epc:"{epc}"')
    if not parts:
        return None
    s = "(" + "+".join(parts) + ")"
    if entry.get("reactions"):
        s += "+AND+patient.reaction.reactionmeddrapt:(" + "+".join(f'"{r}"' for r in entry["reactions"]) + ")"
    return s


def enforcement_search(entry):
    """Drug enforcement search: the same names against the harmonised and printed product fields."""
    if entry["kind"] != DRUG:
        return entry.get("recall")
    parts = []
    for n in entry.get("names", []):
        n = n.lower()
        parts += [f'openfda.generic_name:"{n}"', f'openfda.brand_name:"{n}"', f'product_description:"{n}"']
    for epc in entry.get("epc", []):
        parts.append(f'openfda.pharm_class_epc:"{epc}"')
    return "(" + "+".join(parts) + ")" if parts else None


def basis_note(entry):
    tok = ", ".join(f"'{t}'" for t in entry["tokens"])
    head = {
        "title_names_product": f"The JPML title names {tok}.",
        "title_names_brand": f"The JPML title names the brand {tok}.",
        "title_names_class": f"The JPML title names the class {tok}.",
        "title_names_manufacturer_and_device": f"The JPML title names {tok}.",
        "title_names_vehicle_and_component": f"The JPML title names {tok}.",
    }[entry["basis"]]
    return (head + " " + entry.get("note_extra", "")).strip()


def check_tokens(entry, title):
    """Every token occurs in the official title (case-insensitive, verbatim). Returns the missing tokens."""
    low = title.lower()
    return [t for t in entry["tokens"] if t.lower() not in low]
