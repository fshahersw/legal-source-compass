# Navigator (in-app agent)

The navigator is the agent behind the header's **Agent** button. Given a task, it works the site in the user's browser:
it opens pages, reads the charts and tables they show, uses tabs, toggles and search boxes, follows links, and answers
with links to every page it used. The user watches each step (a pointer glides to every control before it is pressed)
and can stop it at any time.

## How it runs

- **Loop on the server, hands in the browser.** `/api/navigator` (`src/routes/api/navigator.ts`) runs the model loop
  (`src/lib/navigator/agent.server.ts`). Server tools run there: the assistant's corpus, FDA, SEC, case-law and document
  tools (code tools excluded) plus `site_map` and the workspace tools below. Browser tools (`go_to`, `read_page`, `read_chart`, `find_links`,
  `click`, `type_into`, `scroll_to`, `run_python`) are handed to the browser: the stream ends with the calls and a signed transcript,
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

## Voice and adaptive personality

The mic button in the navigator panel starts a realtime voice session (WebRTC). `/api/navigator-voice` receives the
browser's SDP offer and its style profile, adds the session configuration (persona and style instructions, tools,
voice, semantic turn detection, input transcription) and exchanges the offer with the realtime voice service using
`OPENAI_API_KEY`, which stays on the server. Optional: `VOICE_MODEL` (default `gpt-realtime-2.1`) and `VOICE_NAME`
(default `marin`). The provider is not named in the UI or the spoken persona.

- The voice talks; the navigator works. Voice tools: `run_task` (hands a task to the navigator and waits for its
  answer), `stop_task`, `read_screen`, `open_page` and `set_style`. While a task runs, the voice says in a few words
  which page is opening (out-of-band responses that do not enter the conversation).
- Personality (`src/lib/navigator/voiceStyle.ts`): length, tone, pace, whether to explain legal terms, light humor and a
  preferred name. It changes when the user asks (the model calls `set_style`) and from behaviour: cutting in twice
  in the last four answers makes it one step shorter; very short turns make a detailed style normal. Changes are sent
  mid-session with `session.update`, shown in the panel as chips with the reason, and remembered in this browser
  (`navigator:voice-style:v1`). The user can set or reset it by hand.
- Every figure the voice says must come from a tool result; it hangs up after ten idle minutes; sessions are rate
  limited (12 per client per 10 minutes).

## Workspace: memory, folder, documents, images, Python, web, schedules

Each user has a workspace that persists across tasks: schema `agent` in the corpus project
(`database/contracts/agent-workspace-v1.sql`), written only through the `agent_*` functions (security definer,
`search_path ''`, service role only) and the private `agent-files` bucket (25 MB per file). It never mixes with corpus
data.

- **Owner.** A signed-in user owns the workspace by account; with sign-in off the browser keeps a random 256-bit key
  (`localStorage agent:owner:v1`, sent as `x-agent-owner`). The server stores only `sha256` of either
  (`src/lib/agent/owner.server.ts`). A paused task is bound to its owner inside the signed transcript.
- **Memory** (`remember`, `recall`, `forget`): preferences, facts about the user's work and procedures (the steps and
  paths that answered a recurring question). At the start of each task `context.server.ts` brings every preference,
  the relevant facts, matching procedures, the last tasks and the folder's newest files into the prompt and marks the
  memories it used. Each finished task is saved as an episode with the pages it opened. Limits: 500 memories.
- **Folder** (`save_note`, `list_files`, `read_file`): shown at `/sources/library?view=agent` (`AgentFolder.tsx`).
  Downloads use one-hour HMAC-signed links (`/api/agent/file`); HTML files download rather than render and every
  response except PDFs is sandboxed. Limits: 2,000 files.
- **Documents** (`create_document`): Markdown rendered to Word (`docx`), PDF (`pdf-lib`), HTML, Markdown or CSV by
  `documents.server.ts`, all in plain JavaScript.
- **Images** (`generate_image`): diagrams and illustrations saved as PNG (`images.server.ts`, `OPENAI_API_KEY`,
  optional `IMAGE_MODEL`). Realistic depictions of real people and imitation seals or documents are refused; generated
  images are labelled as AI-generated in the folder.
- **Python** (`run_python`, browser tool): Pyodide 0.28.3 with numpy, pandas and matplotlib in a Web Worker
  (`src/components/navigator/python.ts`), loaded from jsdelivr on first use. The page's chart tables arrive as pandas
  DataFrames in `charts`; open matplotlib figures are saved to the folder. 90 s per call (180 s for the first, which
  downloads the sandbox); state persists within the browser session.
- **Web** (`web_search`, `read_web_page`, `browse_web`): `browse_web` opens a public page in a remote browser and
  runs up to 12 bounded actions (click, write, press, wait, scroll; no scripts), with an optional screenshot saved to
  the folder (`browse.server.ts`, `FIRECRAWL_API_KEY`). Only public http(s) addresses (`publicUrl`).
- **Schedules** (`create_schedule`, `list_schedules`, `delete_schedule`): once, hourly, daily, weekdays, weekly or
  monthly at a wall-clock time in an IANA zone (default America/Chicago; `src/lib/agent/schedule.ts` keeps the local
  time across daylight-saving changes). pg_cron job `agent-tick` runs `agent.tick()` every five minutes; when something
  is due it posts a one-time token to `<site_url>/api/agent/tick`, the route redeems it with `agent_tick_claim` (no
  shared secret on the site) and runs up to two due tasks headless (`runner.server.ts`): server tools only, no
  schedule tools, the previous report as context, the answer saved as an unread report. `site_url` registers itself
  from the first real https request (preview and local hosts never register). "Run now" in the folder runs a task in
  the request. Limits: 20 schedules.

Routes: `/api/agent/files` (list, add a figure or note, rename, pin, mark read, delete), `/api/agent/file` (signed
download), `/api/agent/memory`, `/api/agent/schedules` (list, pause, resume, run now, delete), `/api/agent/tick`.
