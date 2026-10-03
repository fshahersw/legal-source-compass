-- Additive exact source-metadata categories, revision 2026-10-02.4.
-- Prepared only. Dated datasets stay held until the separate full-field guards pass.
-- Earlier category audits/revisions and source-native values are not overwritten.
insert into corpus_ingest.category_map
  (native_category, canonical_category, display_label, mapping_basis, version)
values
  ('openfda_device_classification_metadata', 'data', 'Data & download systems',
   'Dated FDA device product-category code metadata. Device regulatory class is separate from recall hazard class; category counts are not device counts or applicability findings. Originals retained.', '2026-10-02.4'),
  ('openfda_device_enforcement_metadata', 'enforcement', 'Administrative enforcement',
   'Dated source-native device recall enforcement-report metadata. Export status does not establish current lifecycle, health alerts, causation, liability or litigation membership. Originals retained.', '2026-10-02.4'),
  ('openfda_drug_enforcement_metadata', 'enforcement', 'Administrative enforcement',
   'Dated source-native drug recall enforcement-report metadata. Export status does not establish current lifecycle, health alerts, causation, liability or litigation membership. Originals retained.', '2026-10-02.4'),
  ('openfda_device_recall_metadata', 'safety', 'Safety & scientific evidence',
   'Dated source-native cfRes recall metadata. FDA source-reported general cause categories are not independent findings of causation, liability, current requirements or litigation membership. Originals retained.', '2026-10-02.4'),
  ('mass_tort_authority_evidence', 'mixed', 'Mixed legal resources',
   'Selected opinion bodies, federal provisions, research routes, access gaps and legislative-status evidence retain separate native kinds. Research routes and gaps are not holdings, binding-authority findings or activated calculator rules. Originals retained.', '2026-10-02.4'),
  ('jpml_html_reference', 'mixed', 'Mixed legal resources',
   'Selected JPML HTML reference kinds retain separate source dates: panel-membership observations, statistics and unread report locators are not MDL judicial assignments, operative orders or a current complete member-case census. Originals retained.', '2026-10-02.4')
on conflict (native_category) do update set
  canonical_category = excluded.canonical_category,
  display_label = excluded.display_label,
  mapping_basis = excluded.mapping_basis,
  version = excluded.version;

select native_category, canonical_category, display_label, mapping_basis, version
from corpus_ingest.category_map
where native_category in (
  'openfda_device_classification_metadata', 'openfda_device_enforcement_metadata',
  'openfda_drug_enforcement_metadata', 'openfda_device_recall_metadata',
  'mass_tort_authority_evidence', 'jpml_html_reference')
order by native_category;
