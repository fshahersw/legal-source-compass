# Exact identity and category review

Read-only audit of external Supabase project `xosqzzsnhxcyehcnirpa`, checked October 2, 2026 at 08:36 UTC. Bulk ingestion continued independently during the review; the findings below concern the stated complete legacy collections and the newly staged native people table, not a final count of every new ingestion table.

## Findings and applied cleanup

The source category correction is recorded in `corpus-category-review-2026-10-02.md`. Content categories and publisher classifications now have separate provenance, and each exact-URL merged source retains all original collection records. This is presentation cleanup; original bytes remain unchanged.

The judge routing matcher used the broad possible-duplicate name key, which removed Jr/Sr/II/III suffixes and accents. That key is suitable only for a human review warning. Permanent judge links now require a unique name match using case, spacing, and punctuation normalization while retaining initials, suffixes, and diacritics. The broad possible-duplicate warning still does not merge records.

The four legacy datasets examined contain 42,971 records: 16,191 historical people, 10,698 directory profiles, 10,669 merged judge entity records, and 5,413 court spine records. The narrow identical-payload screen found zero repeat groups after excluding only top-level IDs and comparing the same dataset/source URL/source date with full item/detail/text fingerprints. This does not prove the absence of semantic duplicates elsewhere in the database.

## People versions and explicit aliases

All 16,191 historical person rows carry distinct exact CourtListener person IDs that agree with their record IDs. Each matches the September 30, 2026 native bulk people table. There are no native IDs present in only one of these two reviewed snapshots. The historical view identifies its source as June 30, 2026; none of its people source-file hashes matches the new September source-file hash. Those are related versions, not deletable identical captures.

There are 394 explicitly recorded aliases and 15,797 non-alias records. Every alias resolves to an existing native person ID; none points to itself, none lacks a target, and alias rows do not contain their own position lists. All 394 recorded alias targets agree with the new native `is_alias_of_id` fields. The 3,711 recorded legacy FJC identifiers also agree by exact CourtListener native ID. A missing position list on 578 historical biographies is not evidence of garbage: the source includes aliases and nonjudicial roles.

An additive alias edge is justified only by the source's explicit target, with its source version and both retained originals. The following SELECT identifies the exact safe relation; it is not a deletion or publication instruction:

```sql
SELECT 'courtlistener' AS source_system,
       p.detail #>> '{source,person_id}' AS alias_native_id,
       p.detail #>> '{alias_of,id}' AS canonical_native_id,
       p.detail -> 'source' AS historical_source,
       p.detail AS retained_historical_profile,
       e.provenance AS current_source,
       e.data AS retained_current_native_record
FROM public.corpus_records p
JOIN corpus_ingest.entities e
  ON e.source_system = 'courtlistener'
 AND e.entity_type = 'people'
 AND e.native_id = p.detail #>> '{source,person_id}'
WHERE p.dataset = 'people'
  AND p.detail ->> 'is_alias' = 'true'
  AND p.detail #>> '{alias_of,id}' = e.data ->> 'is_alias_of_id';
```

## Judge projection grain

All 10,669 merged judge entity records have a distinct nonempty internal entity ID. All 10,669 directory profiles that carry such an ID resolve to one merged entity; there are zero orphan references. The remaining 29 directory records are separate official profiles with preserved source-profile IDs. There are 11,928 source memberships: neither a native membership key nor a complete source dataset/observation/URL/capture-time anchor appears across multiple merged entities. No source-profile ID repeats in the directory.

The directory and entity datasets are related views, not another 21,367 unique judges. CourtListener people also include historical, alias, and nonjudicial records. These grains must remain explicit in statistics and new bulk mappings.

Source URL alone is an unsafe deduplication key for entity records. The inspected FJC CSV source is shared by 4,074 judge rows, while the Court Spine also includes different local courts that share publisher URLs. Native entity identity, snapshot/version, source observation, and retained payload must take precedence over matching URLs or titles.

## Court version and local-registry grain

The 5,413 Court Spine rows contain 3,361 explicitly identified native CourtListener courts and 2,052 local registry rows without such a native ID. All 3,361 native IDs match the September 30, 2026 bulk courts table; none is exclusive to one reviewed snapshot. The historical Court Spine dates its CourtListener component June 30, 2026. Local registry records must not be discarded because they lack a CourtListener ID or share a publisher homepage.

One historical native court (`njcirctsussex`, Sussex County Circuit Court, N.J.) records its type filter as `St`, whereas the majority state-trial code is `ST`. Its stored subtitle already labels it **State trial**, so the folder view groups the existing human label consistently. Its native code remains preserved in the original; a database rewrite to uppercase is not justified merely by presentation deduplication.

No destructive cleanup was justified by this narrow audit. No rows were deleted, no originals were overwritten, and no publication flags or permissions were changed by this review. The public aggregate snapshot is `public/data/quality/taxonomy-review-2026-10-02.json`.

The subsequent native-jurisdiction review identified the publisher’s two testing courts (`psc`, `test`, jurisdiction `T`). Their complete active-registry rows and the prior dataset metadata were archived in private reversible cleanup decisions before excluding them from the public Court Spine. Its active count is now 5,411; the narrow audit’s 5,413-row count describes the earlier reviewed snapshot. Native metadata originals remain preserved. The two testing rows are also excluded from the new public 3,359-court reference projection.
