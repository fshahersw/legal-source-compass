# No changes — data split confirmed

The user asked to understand the data split across the two databases. Answer delivered:

- **External corpus Supabase (read-only):** all litigation data — 187,900 dockets, 15 MDL masters, 16,191 judges, 3,359 courts, laws, regulations, agencies, linking tables (~5.28M records, 71 datasets).
- **App's Lovable Cloud backend:** empty — no tables; would only hold accounts if used.
- **Static JSON bundles in the app:** source library, source catalog, Registry V2.2, MDL docket documents, matter registry.
- **Browser storage:** bookmarks, review decisions, sidebar state.

User confirmed this was for understanding only. No code, schema, or configuration changes will be made.
