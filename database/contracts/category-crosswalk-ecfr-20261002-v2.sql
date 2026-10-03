-- Additive metadata categories, mapping revision 2026-10-02.2.
-- Existing 88 native mappings and their dated audit snapshot remain unchanged.
-- Root executes this administrative contract; preparing the file does not mutate DB.
insert into corpus_ingest.category_map
  (native_category, canonical_category, display_label, mapping_basis, version)
values
  ('ecfr_hierarchy', 'data', 'Data & download systems',
   'Explicit dated publisher hierarchy metadata. Reserved headings and appendices retained; counts are native nodes, not operative-law provisions. Originals retained.',
   '2026-10-02.2'),
  ('ecfr_authority_notes', 'data', 'Data & download systems',
   'Explicit dated XML authority/source/citation metadata snapshots. Reference excerpts are not agency guidance documents or case-applicability determinations. Originals retained.',
   '2026-10-02.2')
on conflict (native_category) do update set
  canonical_category = excluded.canonical_category,
  display_label = excluded.display_label,
  mapping_basis = excluded.mapping_basis,
  version = excluded.version;

select native_category, canonical_category, display_label, mapping_basis, version
from corpus_ingest.category_map
where native_category in ('ecfr_hierarchy', 'ecfr_authority_notes')
order by native_category;
