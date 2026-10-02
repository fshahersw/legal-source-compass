# Research workbench

Build state comparison, judge service and tracked-case analysis with source-linked evidence. Add population-normalized FY2025 federal civil workload, FY2024–2025 change, district disposition time benchmarks, correlations with inspectable state pairs, exact case/judge/MDL relationships, citation exploration, and fresh state research directories.

Inputs: existing case catalog and native court crosswalk; official FJC judge/service CSVs; Census Vintage 2025 state population CSV; U.S. Courts Tables C and C-5; live DOJ state resource pages. Preserve input bytes and source dates/hashes. Supabase stays read-only. Retain the four existing sidebar sections.

Acceptance: all 50 states and DC are selectable; figures can be traced to raw source files; unknowns and excluded populations are visible; denominators and selected filters are consistent; correlations use complete paired observations and do not claim causality; district medians are never averaged into a state median; judge identity requires a unique exact normalized match; all matching cases/documents remain accessible through paging; protected/PACER-only records are never presented as public downloads. Show links from state and judge pages to the workbench. Include downloadable filtered data.

Baseline: 14 relevant existing unit tests pass. Verify new pure statistics and joins using boundary fixtures and real source reconciliation; run full tests, TypeScript, production build, audit check and browser checks. Review the complete diff for identity errors, misleading denominators, broken filters, missing sources, accessibility and responsive overflow before publishing under the user's existing deployment authorization.
