# Owner-requested corpus removal

The owner stopped corpus development and requested removal of Open US Law, CPSC injury data, and files in all three audited storage-availability groups. The owner then explicitly directed preservation of working app dependencies. Matter PDFs are excluded from deletion.

## Scope and protection baseline

Only Supabase project `xosqzzsnhxcyehcnirpa`, private bucket `corpus-originals`, is in scope. The previous corpus continuation goal and automation remain paused.

- Named record collections: `open_us_law` (2,968,623 records) and `cpsc_injury_data` (479,534 records).
- Storage baseline: 274,105 objects / 144,770,591,610 bytes.
- Exact protected set: 220,223 objects / 113,595,529,636 bytes.
- Exact eligible set: 53,882 objects / 31,175,061,974 bytes.
- Protection includes all 153,995 registered matter PDFs (95,041,193,387 bytes), same-hash aliases, court/MDL PDFs, unresolved opaque PDFs, 5,482 current app-manifest keys, every ready download dependency, and active state-code/authority evidence.
- There are no missing protected dependencies in the baseline. The additional 322 unclassified PDFs are preserved conservatively.

These are unique-object measurements, not sums of overlapping route references. The file scope also covers separate held bulk-law files and a CPSC recalls CSV; it does not authorize deletion of their other database collections.

## Execution status

In progress. CPSC removal is complete: all 479,534 records and its catalog entry are independently verified absent. Its complete raw/gzip recovery export remains local. All 818,617 Open US Law outline segments, 196,458 nodes, 224 collection entries, and the dedicated `law_outline` context are independently verified absent. Three additional contexts belonging exclusively to the deleted collections were removed and verified absent; mixed coverage/federal contexts remain preserved.

The Open US Law record export is continuing through four concurrent readers over exact native-ID partitions. The guarded Storage job is running; object-removal completion is not yet claimed.

Private inventories, raw/gzip row backups, protected/eligible file manifests, and deletion intent/receipt journals are under `private/audit-2026-10-05/owner-removal-openus-cpsc/` and are excluded from Git. Storage inventory metadata is a before-image of object identities and versions; it is not a claim that every deleted binary has a local recovery copy.

Deletion tools require explicit execute flags and pinned manifest hashes, target only this project, stop on unknown write outcomes, and verify identities and absence. Storage bytes are deleted through the Storage API, never by deleting `storage.objects` rows in SQL. Row deletion releases database space for reuse; it does not itself guarantee a lower allocated database-disk size.

Final completion counts and post-deletion verification will replace this in-progress status after execution.
