# Navigator (in-app agent)

The navigator is the agent behind the header's **Agent** button. Given a task, it works the site in the user's browser:
it opens pages, reads the charts and tables they show, uses tabs, toggles and search boxes, follows links, and answers
with links to every page it used. The user watches each step (a pointer glides to every control before it is pressed)
and can stop it at any time.

## How it runs

- **Loop on the server, hands in the browser.** `/api/navigator` (`src/routes/api/navigator.ts`) runs the model loop
  (`src/lib/navigator/agent.server.ts`). Server tools run there: the assistant's corpus, FDA, SEC, case-law and document
  tools (web and code tools excluded) plus `site_map`. Browser tools (`go_to`, `read_page`, `read_chart`, `find_links`,
  `click`, `type_into`, `scroll_to`) are handed to the browser: the stream ends with the calls and a signed transcript,
  `useNavigator` runs them on the live page (`src/components/navigator/executor.ts`) and posts the results back to resume.
- **Signed transcript.** The server signs the conversation, round and pending call ids with HMAC-SHA256
  (`sign.server.ts`) using `NAVIGATOR_SIGNING_KEY`, or a key derived from `ANTHROPIC_API_KEY` when that is unset. A page
  cannot forge earlier tool results or reset the round limit (30 rounds).
- **Exact figures.** Every `ChartCard` registers a lazy getter for its title, subtitle, sources, period and "View data"
  table (`src/lib/navigator/chartRegistry.ts`); `read_page` and `read_chart` read those rows, so answers use the numbers
  behind the charts rather than screen text. Conversion happens only when read, so animated pages pay nothing.
- **Page guides.** `src/lib/navigator/pageGuides.ts` describes the key pages (address pattern, view parameters,
  controls, how to reach an entity's page). `site_map` combines them with the navigation registry (`siteDirectory()`).

## Guardrails

- Paths must be this site's (`safeSitePath`): no external, protocol-relative, API or sign-in paths.
- Controls whose label matches `FORBIDDEN_LABEL` (download, export, delete, sign in/out, submit, share, …), download
  links, external links and form submit buttons are refused; the agent is told not to work around a refusal.
- `type_into` only fills search and filter boxes (never password, email, phone or file inputs).
- Page text, records and documents are treated as data; instructions inside them are ignored.
- Rate limit: 160 navigator requests per client per 10 minutes (each resume is a request).

## Adding a page

Add a guide to `PAGE_GUIDES` with the page's pattern, what it shows, its query parameters and its main controls. Use
`ChartCard` for charts (already registered) and give sections a `Section` id so `read_page`, `find_links` and
`scroll_to` can address them.
