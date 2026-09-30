# Connect Legal Source Atlas to your external database (read-only)

## Security first
- The database password was posted in chat. Please **reset it** in your database provider's settings after this work. The new value will go into the secure secret form, never into code or chat.
- The app will only **read** from your database. It will not write to it or change its structure.

## Steps
1. **Save credentials securely**: ask for `EXTERNAL_DB_URL` (the full connection string with the new password) through the secure secret form. If possible, also ask for the project URL and a read-only key, which work better from the app's server.
2. **Check what is there (read-only)**: list the tables and columns, count the rows, and sample a few records. Then report back to you which tables hold sources, occurrences, endpoints, families, promotions, county records, laws, judges and regulations. I will not guess at the mapping.
3. **Agree on the mapping**: show you the proposed table-to-view mapping for approval before any views change.
4. **Add a server-side data layer**: read-only server functions that page through the data and filter it on the server, so large tables are never loaded into the browser in full. Credentials stay on the server.
5. **Wire up the views**: Library, Jurisdictions, Families, Endpoints, Map (with county counts once real county records exist), Categories and Insights get their data from the connected source. The bundled V2.2A file stays as a clearly labelled fallback. Reviews and bookmarks stay saved in your browser.
6. **Verify**: run the tests with a mocked connection, run a live read-only check that compares counts against the database, do browser checks on every view, and add a verification report.

## Technical details
- The app's server environment cannot reliably keep direct Postgres TCP connections open. The preferred route is the provider's REST API with a key stored as a secret. Direct Postgres will be used only if a check proves it works.
- Record the rule in AGENTS.md: external data is read-only and fetched on the server; no secrets reach the client.
- The architecture rule "no backend/API key" gets updated to reflect that you explicitly asked for this.
