# In-force state law — shared normalized model (`state-law/1`)

Owner: STAT-A (wave 1025). Followed by STAT-B (MI–WY) and called by CITE. This file is the contract; the code that
implements it is `scripts/state_law/lib.py` (API below, kept stable) and `database/contracts/state-law-inforce-v1.sql`.
Changes after first commit are additive only; anything breaking gets a `/2` schema id.

## 0. Ground rules (AGENTS.md owner instruction 2026-10-19, WAVE1025)

- Text comes only from the **official government publisher** of the state's statutes (legislature, revisor, code
  commission, council). Never fetch commercial legal hosts (Westlaw, Lexis/`advance.lexis.com`, Casetext, Justia,
  FindLaw, Casemine…). If the only current text sits on a commercial host, the state is `blocked` with the reason.
- Never use or recreate `open_us_law`; never use CC BY-NC bundles. Annotations are not kept.
- Respect robots.txt (including `Crawl-delay`), published rate limits, 403s and browser checks. Never bypass.
- Keep the source bytes unchanged for the validation sample (`.raw`) plus a plain-text rendering (`.txt`); every
  stored `text`/`heading`/`history` must be found verbatim (whitespace-normalised) in that rendering.

## 1. Files a state run writes (one directory per run)

```
<out>/<xx>/<edition_id>/
  edition.json          state-law-edition/1   (one object)
  nodes.jsonl.gz        state-law-node/1      (one per hierarchy node, parents before children)
  sections.jsonl.gz     state-law-section/1   (one per section, document order)
  sources.jsonl.gz      state-law-source/1    (one per fetched object: url, sha256, bytes, status, time)
  rejects.jsonl.gz      ledger of records not emitted: {state, code, number, reason, source_url, source_sha256}
                        (full runs only; a sample run stops on the first ModelError instead). Reasons include a
                        record that fails a model check, "range entry: Secs. x to y …" (not one section),
                        "superseded version" (a version whose stated end date has passed) and publisher copies that
                        are not the current text (DC "(Perm)" copies)
  verify.json           exact-text proof (sample runs; optional on full runs)
<raw>/<xx>/<sha256[:2]>/<sha256>.raw  + .txt      (only with --keep-raw; validation samples always keep raw)
```

`edition_id` = `<xx>-<YYYYMMDD>` (UTC date the run started, lowercase state), suffix `-2`, `-3` for a second run the
same day. One edition = one acquisition of the publisher's current compilation.

## 2. Section — `state-law-section/1`

| field | type | rule |
|---|---|---|
| `schema` | `"state-law-section/1"` | |
| `section_id` | text | `<STATE>:<CODE>:<number>` with whitespace removed from `number`; plus `@<k>` when the publisher prints k>1 versions of the same number (every version then carries `@1`, `@2`… in publisher order). ≤300 chars. |
| `edition_id` | text | |
| `state` | `^[A-Z]{2}$` | USPS code (DC included) |
| `code` | `^[A-Z0-9]{1,12}$` | code key within the state (`FS`, `PEN`, `ILCS`, `RS`, `CC`, `GBR`…). Single-code states still use a key. |
| `number` | text | the section designation **as printed**, without `§`/`Sec.`/trailing period. Where the state's numbering is only unique inside a title/chapter, the container is prefixed with `:` — `DE 10:8106`, `ME 14:752`, `MA 260:2A`, `IL 735:5/13-202`, `LA RS 9:2800.6`, `VT 12:511`. A publisher's own punctuation stays (`KS 79-32,117`, `DC 28:2-725`); editorial brackets around a number are dropped (`DC [3-1210.12]` → `3-1210.12`). |
| `number_norm` | text | `lib.norm_number(number)`: lowercase, unicode dashes → `-`, whitespace removed, leading `§`/`sec.` removed. SQL mirrors it exactly. |
| `version` | text\|null | verbatim version label when >1 versions (e.g. `(Text of section operative January 1, 2027)`), else null |
| `citation` | text | canonical citation, Bluebook style for the state, from the code's `citation_template` (`{n}` = number, `{t}`/`{s}` = the parts before/after the first `:`). E.g. `Fla. Stat. § 95.11`, `Cal. Civ. Proc. Code § 335.1`, `735 Ill. Comp. Stat. 5/13-202`, `Del. Code Ann. tit. 10, § 8106`, `Mass. Gen. Laws ch. 260, § 2A`, `Md. Code Ann., Cts. & Jud. Proc. § 5-101`. |
| `heading` | text\|null | catchline as printed, without the number |
| `text` | text | the statute's own words only. Paragraphs joined with `\n`; runs of spaces collapsed; no markup; no heading; no history/credits; no annotations, notes, cross references, case notes, editor's notes. May be `""` only when the publisher prints a status-only entry (e.g. "Repealed.") — then the marker is in `status_marker`. |
| `history` | text\|null | the publisher's own history/credits/source line, verbatim, **only** when the publisher prints one (e.g. FL `History.—…`, CO `Source:`). Never mixed into `text`. |
| `status` | enum | `in_force` \| `repealed` \| `reserved` \| `expired` \| `renumbered` \| `transferred` \| `future_effective` \| `not_recorded` |
| `status_basis` | enum | `publisher_marker` (a marker printed by the publisher decided it), `current_compilation` (`in_force`: printed as operative text in the publisher's current compilation, no non-operative marker), `not_recorded` (no basis — e.g. historical/third-party edition) |
| `status_marker` | text\|null | the verbatim marker text that set the status (`Repealed by Laws 2020, ch. 5, § 2.`, `[Reserved]`, `Renumbered as § 12-3-4`) |
| `effective` | object | `{"start": date\|null, "end": date\|null, "note": text\|null}`; dates only when the publisher states them, `note` verbatim |
| `node_id` | text | the innermost hierarchy node containing the section (§3) |
| `path` | array | `[{"level","label","number","heading"}]` root→leaf (code root excluded), native labels |
| `ordinal` | int | document order within the edition (0-based, strictly increasing) |
| `source` | object | `{"url","retrieved_at","sha256","bytes","method","member"}` — `method` ∈ `publisher_page`, `publisher_bulk`, `publisher_api`, `retained_original`; `member` = path inside an archive or null; `sha256` = sha256 of the exact source bytes the section was cut from. Additive: `also` = `[{"url","sha256",…}]` further publisher objects a quote may come from (e.g. KS takes a repealed section's marker from the chapter list); verify.py checks quotes against the union of the renderings |
| `text_sha256` | hex | sha256 of UTF-8 `text` |
| `parser` | text | `<xx>-<name>/<int>` |

Status rules (only from the publisher's own markers):
- `repealed`/`reserved`/`expired`/`renumbered`/`transferred`: a heading or body marker printed by the publisher
  (`lib.classify_status` has the shared patterns; state modules add their own). `status_basis=publisher_marker`.
- `future_effective`: the publisher prints an operative/effective date later than the run date for this text (e.g. CA
  `operative date`, IL "(Text of Section after amendment by P.A. … effective 1-1-27)"). `effective.start` is set.
- `in_force`: none of the above and the edition is the publisher's current official compilation. `status_basis =
  current_compilation`. It means "printed as operative text in the publisher's compilation as of its currency
  statement" — the UI always shows the currency statement beside it.
- `not_recorded`: the edition is not current or not official, or the publisher's markers are ambiguous, or the
  publisher marks the text as not operative in a way the enum does not name (DC "Not Funded", "Not Applicable",
  "[Omitted]"; a heading-only entry) — the verbatim marker is still kept in `status_marker`.
- `lib.classify_status` only treats a heading or short body as a marker when it *is* the marker: the marker word must
  be followed by the end, punctuation, a number, or a word introducing its particulars (`Repealed by …`, `Renumbered
  as …`, `Expired July 1, 2020`, `Reserved for future use`); a trailing bracket (`Limitations. [Repealed]`) also counts.
  `Transferred employees; rights.`, `Reserved powers.`, `Repealed Laws Not Revived.` and `Sunset.` are catchlines,
  not markers.

## 3. Hierarchy node — `state-law-node/1`

| field | rule |
|---|---|
| `node_id` | root `<STATE>:<CODE>`; each child appends `/<level>:<number>` (number escaped: `%`→`%25`, `/`→`%2F`, `:`→`%3A`, space→`%20`; an unnumbered node uses `~<ordinal>`) — `FL:FS/title:VIII/chapter:95` |
| `edition_id`, `state`, `code` | as above |
| `parent_id` | null only for the code root |
| `level` | normalized: `code`, `title`, `subtitle`, `division`, `subdivision`, `part`, `subpart`, `chapter`, `subchapter`, `article`, `subarticle`, `act`, `appendix`, `other` |
| `label` | native label as printed (`TITLE`, `Chapter`, `ARTICLE`, `Act`) |
| `number` | as printed, or null |
| `heading` | as printed, or null |
| `ordinal` | document order among all nodes of the edition |
| `source_url` | page that printed the node, or null |

`lib.node_id(state, code, [(level, number), ...])` builds ids. Parents are emitted before children.

## 4. Edition — `state-law-edition/1`

```json
{
  "schema": "state-law-edition/1", "edition_id": "fl-20261024", "state": "FL",
  "code_name": "Florida Statutes", "publisher": "The Florida Legislature", "publisher_url": "https://www.leg.state.fl.us/statutes/",
  "official_source": true, "access": "html",
  "edition_label": "The 2026 Florida Statutes",            // verbatim or null
  "currency_statement": "…verbatim…",                       // verbatim or null
  "currency_source_url": "https://…",                       // where the statement was read
  "currency_through": "2026-06-30",                         // only a date the publisher states, else null
  "source_last_modified": "…",                              // additive: what the publisher's files state about their
                                                            // age when no currency sentence exists (Last-Modified,
                                                            // listing dates, build/codified dates), verbatim values
  "source_mode": "publisher",                               // additive: publisher (read from the publisher during
                                                            // the run) | retained_original (re-parsed from this
                                                            // project's sha256-checked captures; pages the capture
                                                            // lacked are read fresh and listed in sources.jsonl.gz)
  "retrieved_from": "2026-10-24T01:00:00Z", "retrieved_to": "…",   // min/max retrieved_at of the sources; in
                                                            // retained mode these are the original capture times
  "codes": [{"code":"FS","name":"Florida Statutes","citation_template":"Fla. Stat. § {n}",
             "patterns":[{"regex":"…","number":"\\1"}]}],
  "counts": {"sections": 0, "nodes": 0, "sources": 0, "rejected": 0, "source_bytes": 0, "by_status": {"in_force": 0}},
  "files": {"sections.jsonl.gz": {"sha256": "…", "bytes": 0, "records": 0}},
  "parser": "fl-online-sunshine/1", "lib": "state-law-lib/1",
  "sample": null,                                            // or {"limit": N} for bounded samples
  "terms_note": "…", "update_cadence": "…"
}
```

## 5. Citation resolution (shared with CITE)

`public.state_law_resolve_v1(p_state text, p_citation text) returns jsonb` — SECURITY DEFINER, service_role only.

Input: a USPS state code and one citation string as written (`Fla. Stat. § 95.11(3)(a)`, `95.11`, `735 ILCS 5/13-202`,
`Cal. Civ. Proc. Code § 335.1`, `10 Del. C. § 8106`, `M.G.L. c. 260, § 2A`, `La. R.S. 9:5604`).

Steps: (1) `lib.norm_cite` (lowercase; `§`, `§§`, `sec.`, `section` → `§`; unicode dashes → `-`; collapse spaces; strip
`et seq.`, trailing `(…)` subsection pinpoints are kept aside as `pinpoint`). (2) Try the active edition's
`citation_patterns` in order (`regexp_replace(norm, regex, number)` on a full match) → `(code, number_norm)`.
(3) Exact lookup on `(edition, code, number_norm)`. No fuzzy, closest-number or cross-state fallback, ever.

Output:
```json
{"state":"FL","input":"Fla. Stat. § 95.11(3)(a)","normalized":"fla. stat. § 95.11","pinpoint":"(3)(a)",
 "result":"resolved",            // resolved | ambiguous | unresolved | unknown_state | no_edition
 "section_id":"FL:FS:95.11","code":"FS","number":"95.11","citation":"Fla. Stat. § 95.11",
 "heading":"…","status":"in_force","edition_id":"fl-20261024","source_url":"https://…",
 "currency_statement":"…", "candidates":[]}
```
- Several versions of one number: exactly one `in_force` → `resolved` to it (others listed in `candidates`); otherwise
  `ambiguous` with every version in `candidates`.
- A bare number that matches the same `number_norm` in several codes → `ambiguous` with candidates.
- A number that parses but is not printed by the publisher → `unresolved` (never mapped to a neighbour).

## 6. Database (contract `database/contracts/state-law-inforce-v1.sql`)

Schema `state_law` (private; RLS on; service_role only). `editions`, `codes`, `citation_patterns`, `nodes`,
`sections` (list-partitioned by `state`, `tsv` generated column: weight A = number + heading, B = first 250,000
chars of text, `english` config, GIN per partition), `sources`. One `active` edition per state.

App/CITE RPCs (public, SECURITY DEFINER, `search_path=''`, service_role only):
`state_law_states_v1()`, `state_law_tree_v1(p_state, p_node_id, p_limit, p_offset)`,
`state_law_section_v1(p_state, p_section_id)`, `state_law_search_v1(p_state, p_q, p_limit, p_offset, p_status)`,
`state_law_resolve_v1(p_state, p_citation)`.
Loader RPCs (lead only): `state_law_begin_edition_v1`, `state_law_load_nodes_v1`, `state_law_load_sections_v1`,
`state_law_activate_edition_v1`, `state_law_purge_edition_v1` (counted batch delete of superseded editions).

## 7. `lib.py` API (stable; STAT-B imports it)

```python
import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))   # from states/<xx>.py
from state_law import lib

lib.StateMeta(state, code_name, publisher, publisher_url, official_source, access, hosts, codes,
              min_interval_s=1.0, terms_note="", update_cadence="", blocked=None, parser="xx-name/1")
lib.Code(code, name, citation_template, patterns=())          # patterns: tuple of (regex, number_replacement)
lib.Pattern(regex, number)                                    # alternative to a tuple

def acquire(ctx: lib.RunContext) -> None                       # each states/<xx>.py defines META and acquire

ctx.fetch(url, *, method="publisher_page", data=None, headers=None, accept_status=(200,)) -> lib.Fetched
ctx.stream(url, *, method="publisher_bulk") -> context manager yielding a file-like (sha256 + bytes recorded on close)
ctx.edition(edition_label=None, currency_statement=None, currency_source_url=None, currency_through=None)
ctx.node(code, steps, label, heading=None, source_url=None) -> node_id      # steps = [(level, number), ...]
ctx.section(code=..., number=..., heading=..., text=..., node_id=..., path=..., source=fetched_or_dict,
            history=None, status=None, status_marker=None, effective=None, version=None) -> section_id
ctx.want_more() -> bool         # False once a --sample bound is reached
ctx.log(msg)

lib.Fetched: url, final_url, status, headers, body (bytes), sha256, bytes, retrieved_at, method, member
lib.html_text(fragment_or_bytes) -> str     lib.norm_ws(s) -> str     lib.norm_number(s) -> str
lib.norm_cite(s) -> (normalized, pinpoint)  lib.classify_status(heading, text) -> (status|None, marker|None)
lib.render_text(body, content_type) -> str  (the .txt rendering used by the exact-text proof)
lib.node_id(state, code, steps) -> str      lib.section_id(state, code, number, version_index=None) -> str
```

Additive API (all backwards compatible):

```python
ctx.get(url, fallback_fresh=False, keep_raw=True, **fetch_kwargs) -> lib.Fetched
    # the publisher (fresh) or, in retained mode, this project's earlier capture of the same URL (sha256-checked);
    # fallback_fresh reads the publisher when no capture exists; keep_raw=False records a bulk archive without
    # keeping its bytes (members are kept through ctx.member)
ctx.fetch(..., keep_raw=True)
ctx.member(archive_fetched_or_dict, name, body) -> lib.Fetched   # an archive member (or a file at a repository
    # revision: pass {"url": <file URL at that revision>, "retrieved_at": …}) recorded as its own source
ctx.edition(..., source_last_modified=None)                      # may be called again later in acquire()
ctx.section(..., version_index=None, also=(), ordinal=None)
ctx.today                                                         # run date (UTC) for effective-date comparisons
ctx.sample, ctx.raw_root, ctx.retained, ctx._rejects.write({...})
lib.RetainedStore.from_jsonl(state, path) / .from_rpc(state)      # retained originals index (url, sha256, bytes,
    # object_key, retrieved_at); downloads need EXTERNAL_SUPABASE_URL/KEY in the environment
lib.alias_patterns(aliases, prefix=None)  lib.apply_patterns(codes, citation) -> [(code, number_norm)]
lib.xml_text / caml_text / slim_text / pdf_text / json_text       # renderers behind lib.render_text
lib.decode_bytes(body, encoding=None)    # BOM, declared charset (ISO-8859-1/ASCII labels decode as windows-1252,
                                         # as browsers do; a utf-16 label on 8-bit bytes is ignored), utf-8, cp1252
lib.Blocked                               # raised by acquire() when the publisher refuses or the state is blocked
```

Renderings (the `.txt` every quote is checked against): HTML (`html_text`: block boundaries are lines, raw newlines
are spaces except in `<pre>`), XML (`xml_text`: element boundaries are lines except inline elements — `cite`, `em`,
`strong`, `span`, `a`, … — and DC codification instructions are left out), California CAML (`caml_text`), Iowa slim
XML (`slim_text`: empty character spans become their characters, an identifier span is followed by a space), PDF
(`pdftotext -layout`), JSON, plain text.

CLI: `python3 scripts/state_law/run.py <xx> --out private/build/w1025_<you>/state_law --raw private/acq/w1025_<you>/state_law [--sample N] [--keep-raw] [--option k=v] [--retained-index FILE]`
(`--option source=retained` pages the retained index from `public.state_law_retained_sources_v1`; exit 3 = blocked,
`blocked.json` written) then `python3 scripts/state_law/verify.py <edition dir> --raw <raw dir>` for the exact-text
proof (`--no-require-raw` for a structural check of a full run).
