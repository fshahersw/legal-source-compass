/** Exact native-identity snapshot pairs reviewed on 2026-10-05. Raw datasets stay intact. */
export type DatasetVersionRow = {
  id: string;
  ready?: boolean | null;
  records?: number | null;
};

export type DatasetVersionFamily = {
  current: string;
  previous: string;
  currentLabel: string;
  previousLabel: string;
  identity: string;
  note: string;
};

export const DATASET_VERSION_FAMILIES: readonly DatasetVersionFamily[] = [
  {
    current: "agency_safety_openfda_device_classification_20261002",
    previous: "agency_safety_openfda_device_classification",
    currentLabel: "Latest available · October 2, 2026",
    previousLabel: "Earlier openFDA version · date not recorded",
    identity: "exact FDA product_code",
    note: "The October 2 collection includes all 7,093 earlier product codes and one additional code.",
  },
  {
    current: "cl_people",
    previous: "people",
    currentLabel: "Latest available · September 30, 2026",
    previousLabel: "Earlier biographies · June 30, 2026",
    identity: "exact CourtListener native person ID",
    note: "Both versions cover the same 16,191 CourtListener people. Each retains the information published in that version.",
  },
] as const;

const familyByDataset = new Map<string, DatasetVersionFamily>();
for (const family of DATASET_VERSION_FAMILIES) {
  familyByDataset.set(family.current, family);
  familyByDataset.set(family.previous, family);
}

export function datasetVersionFamily(datasetId: string): DatasetVersionFamily | null {
  return familyByDataset.get(datasetId) ?? null;
}

export function canonicalDatasetId(datasetId: string): string {
  return datasetVersionFamily(datasetId)?.current ?? datasetId;
}

export function datasetVersionLabel(datasetId: string, fallback: string): string {
  const family = datasetVersionFamily(datasetId);
  if (!family) return fallback;
  return datasetId === family.current
    ? `${fallback} · current snapshot`
    : `${fallback} · prior snapshot`;
}

function isAvailableCurrent(family: DatasetVersionFamily, datasets: readonly DatasetVersionRow[]) {
  return datasets.some(
    (dataset) =>
      dataset.id === family.current &&
      dataset.ready === true &&
      (dataset.records == null || dataset.records > 0),
  );
}

/** Hide only audited prior snapshots when their complete current counterpart is available. */
export function visibleDatasetChoices<T extends DatasetVersionRow>(datasets: readonly T[]): T[] {
  const hidden = new Set(
    DATASET_VERSION_FAMILIES.filter((family) => isAvailableCurrent(family, datasets)).map(
      (family) => family.previous,
    ),
  );
  return datasets.filter((dataset) => !hidden.has(dataset.id));
}

/** Resolve a direct prior-dataset link to the canonical view while retaining the requested version. */
export function resolveDatasetVersion(
  requestedId: string,
  datasets: readonly DatasetVersionRow[],
): { canonicalId: string; selectedId: string; family: DatasetVersionFamily | null } {
  const family = datasetVersionFamily(requestedId);
  if (!family || !isAvailableCurrent(family, datasets))
    return { canonicalId: requestedId, selectedId: requestedId, family };
  return {
    canonicalId: family.current,
    selectedId: requestedId === family.previous ? family.previous : family.current,
    family,
  };
}

/** Ready catalog rows used before search RPC pagination; exact prior IDs do not duplicate hits. */
export function canonicalSearchDatasetIds<T extends DatasetVersionRow>(
  datasets: readonly T[],
): string[] {
  const hidden = new Set(
    DATASET_VERSION_FAMILIES.filter((family) => isAvailableCurrent(family, datasets)).map(
      (family) => family.previous,
    ),
  );
  return datasets.filter((dataset) => !hidden.has(dataset.id)).map((dataset) => dataset.id);
}
