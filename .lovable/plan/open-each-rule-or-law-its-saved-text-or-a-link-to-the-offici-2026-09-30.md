# Open each rule or law: its saved text, or a link to the official source

Yes, this makes sense. Today the outline stops at headings like "Title 10: Judicial Administration Rules (186)", and you can't open the rules inside them. Your database stores what's needed to go further. For example, Cal. R. Ct. 10.1 has its full saved text (about 3,000 characters), its status ("in force") and its official link on courts.ca.gov.

## What changes
```text
California · Court rules
  Title 10: Judicial Administration Rules (186)   <- click
    Rule 10.1  Authority, duties, and goals ...   in force   [Text] [Official source]
    Rule 10.2  Judicial Council membership ...    in force   [Text] [Official source]
    ... 50 per page, with search in this title
      -> Rule page
```
- **Lowest headings become clickable.** The rules or sections under them are listed with citation, title and status. Each row shows what's available: "Text saved", "Official source", or both.
- **Rule / provision page** (one per provision):
  - Header: citation, title, jurisdiction, type of law and status.
  - **Full text** when saved. It is laid out cleanly, with each lettered or numbered part, like (a) and (1), starting on its own line. There's a Copy text button.
  - **Official source** button that opens the publisher's page in a new tab.
  - If there is no saved text, the page says so and shows only the source link. If neither exists, it says "No text or source link recorded".
  - Previous / next rule buttons, and a path back to the title and collection.
  - The publisher's edition note (e.g. "Publisher snapshot v2026.08; verify edition and current legal status") in small print. File details go under the collapsed "Technical details".
- Works the same way for every jurisdiction and type of law (federal regulations, state statutes, IRS notices and so on). The provision page layout also applies to law records opened from the record-set folders.

## Technical details
- New read-only server functions:
  - `listLawProvisions(node, offset)` calls `corpus_law_provision_rows(p_node, p_offset, p_limit=50)` and returns id, title, citation and status.
  - `getLawProvision(id)` reads `corpus_records` (title, source_url, text, detail) for that id.
- Only the `http(s)` `source_url` is linked. Internal paths like `/api/text` and the bulk parquet file are not exposed as links.
- New route `/law/provision/$id` with its own head() using the citation and title. The outline's leaf rows link there. Previous/next comes from the provision's position in its node list.
- A pure `formatLawText.ts` splits text into paragraphs at subsection markers such as (a), (1) and (A). Tests make sure no text is dropped, the joined output equals the input once whitespace is normalized, and the real Rule 10.1 sample works.
- Then typecheck, tests, build, and a browser walk: California → Court rules → Title 10 → Rule 10.1 (text and source link), a federal regulation, and a record with no saved text.

## Limits
- The text is the publisher snapshot stored in your database, not re-checked against the live site.
- Some provisions may have only a link or only text. Each page says plainly which it has.
