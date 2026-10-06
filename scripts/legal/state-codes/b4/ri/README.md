# Rhode Island General Laws (batch 4)

## Official source

- **Publisher:** Rhode Island General Assembly (LexisNexis-hosted statutory web edition)
- **Base URL:** https://webserver.rilegislature.gov/Statutes/
- **Pattern:** `TITLE{n}/INDEX.htm` → `{title-ch}/INDEX.htm` → `{title-ch-section}.htm`
- **Edition label on section pages:** `R.I. Gen. Laws § …`
- **Currency:** No edition date or “current through” statement was found on the captured root, title, chapter, or section pages.

## Acquire

```bash
export FIRECRAWL_API_KEY=…   # optional fallback on 403/406
python3 acquire.py --work /tmp/sc4/ri
```

`--inventory-only` builds `inventory.json` without fetching section bodies.

## Parse and verify

```bash
python3 parse.py --work /tmp/sc4/ri
python3 verify.py --work /tmp/sc4/ri
```

## Tests

```bash
python3 -m unittest
```

## History blocks

Section histories appear in `History of Section.` paragraphs (HTML `<br>`-separated enactment lines).
