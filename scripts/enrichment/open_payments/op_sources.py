"""Official CMS Open Payments dataset identifiers (openpaymentsdata.cms.gov metastore, publication of 2026-06-30).

Listed from https://openpaymentsdata.cms.gov/api/1/metastore/schemas/dataset/items . Program years 2017 and
2018 are archived by CMS and exist only as detail-file downloads on the Archived Datasets page.
"""

METASTORE = "https://openpaymentsdata.cms.gov/api/1/metastore/schemas/dataset/items"
DATASET_PAGE = "https://openpaymentsdata.cms.gov/dataset/"

# Summary: payments grouped by reporting entities (one row per reporting entity x program year).
BY_ENTITY = "d5762bed-26ca-4035-91c9-9d67297dc77c"
# Summary: reporting entity profile information (current and alternate names).
ENTITY_PROFILE = "1cf0c6c0-c377-466e-b78f-037b442559f8"
# Summary dashboard: national totals by program year.
DASHBOARD = "e0d225fc-8230-401d-8fad-e2262fb22b4c"
# Summary: state level payment totals and averages for all years (state x year x payment type x recipient type).
STATE_TOTALS = "02157882-0f43-473a-a777-c96eb5b1b623"

# Summary: payments grouped by reporting entities and nature of payments, per program year (general payments).
NATURE_BY_ENTITY = {
    "2019": "7f3bcc65-6f34-42de-8e63-7611e0a6f67b",
    "2020": "7dfe6254-2aee-454f-9ea5-df611a9a7b55",
    "2021": "a2714020-f599-52b0-b12b-8f5b510e547a",
    "2022": "cedcd327-4e5d-43f9-8eb1-c11850fa7c66",
    "2023": "72008dab-0953-4226-a4cd-9f1872e8170d",
    "2024": "d7e3f320-9ddc-4a5b-8aaf-45048cbd7386",
    "2025": "8798d245-2096-4fbf-b73e-78d689ed0c01",
}

# Summary: state payment totals grouped by nature of payment, per program year.
STATE_NATURE = {
    "2019": "37fba404-224d-5bad-9c62-527d9316e516",
    "2020": "7f3055b6-73d8-5aff-be15-55873552e2cd",
    "2021": "7fad5b56-2cfe-52ab-ac4d-3200780287d4",
    "2022": "c64c40af-23a5-4419-8b64-692684483664",
    "2023": "f83aed3a-7504-4fca-aabb-ac0338c79688",
    "2024": "e8a6db6a-a540-46aa-b04c-e216e2c72618",
    "2025": "0d5631f5-6600-428d-b326-64f68c302c54",
}

# Detail: General Payment Data, per program year (used for datastore aggregations).
GENERAL_DETAIL = {
    "2019": "4e54dd6c-30f8-4f86-86a7-3c109a89528e",
    "2020": "a08c4b30-5cf3-4948-ad40-36f404619019",
    "2021": "0380bbeb-aea1-58b6-b708-829f92a48202",
    "2022": "df01c2f8-dc1f-4e79-96cb-8208beaf143c",
    "2023": "fb3a65aa-c901-4a38-a813-b04b00dfa2a9",
    "2024": "e6b17c6a-2534-4207-a4a1-6746a14911ff",
    "2025": "fb0b1734-1410-429d-92f6-3f4b35218e5e",
}

# Detail: Research Payment Data, per program year.
RESEARCH_DETAIL = {
    "2019": "713a6016-1930-4a0c-b7c2-3e3de4f244c5",
    "2020": "9c248e7e-7c7f-478b-ab84-ce0919d72c1c",
    "2021": "ce1d28dd-0094-5060-a036-580329439600",
    "2022": "fdc3c773-018a-412c-8a81-d7b8a13a037b",
    "2023": "ec9521bf-9d97-4603-814c-f4132d34bc4f",
    "2024": "2f15cb85-8887-4dcc-a318-1f8ec1d815b3",
    "2025": "f0d1de67-6852-4093-a036-c9328c256a05",
}

# Archived program years: detail-file zips (Archived Datasets page).
ARCHIVE_PAGE = "https://openpaymentsdata.cms.gov/datasets/archived"
ARCHIVED_ZIPS = {
    "2017": "https://download.cms.gov/openpayments/PGYR2017_P01302025_01212025.zip",
    "2018": "https://download.cms.gov/openpayments/PGYR2018_P01302025_01212025.zip",
}

API_YEARS = sorted(NATURE_BY_ENTITY)
ALL_YEARS = sorted(list(ARCHIVED_ZIPS) + API_YEARS)

# Current program years: official detail-file zips (Dataset Downloads page, publication of 2026-06-30). Used for
# per-entity breakdowns (recipient state, first-listed product) that CMS does not publish as summaries.
DOWNLOAD_PAGE = "https://openpaymentsdata.cms.gov/datasets/download"
DETAIL_ZIPS = {year: f"https://download.cms.gov/openpayments/PGYR{year}_P06302026_06032026.zip" for year in API_YEARS}
ZIPS = {**ARCHIVED_ZIPS, **DETAIL_ZIPS}
