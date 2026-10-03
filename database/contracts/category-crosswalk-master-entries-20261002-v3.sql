-- Additive exact native-entry category, mapping revision 2026-10-02.3.
-- Prepared contract only; readiness and privacy eligibility belong to the separate projection.
-- Earlier 88-map audit and the additive eCFR revision .2 remain immutable evidence.
insert into corpus_ingest.category_map
  (native_category, canonical_category, display_label, mapping_basis, version)
values
  ('master_docket_entry', 'dockets', 'Dockets & case systems',
   'Exact native docket-entry metadata category. Native docket linkage and document locators do not infer MDL member role, complete docket history or legal outcome; originals retained.',
   '2026-10-02.3')
on conflict (native_category) do update set
  canonical_category = excluded.canonical_category,
  display_label = excluded.display_label,
  mapping_basis = excluded.mapping_basis,
  version = excluded.version;

select native_category, canonical_category, display_label, mapping_basis, version
from corpus_ingest.category_map
where native_category = 'master_docket_entry';
