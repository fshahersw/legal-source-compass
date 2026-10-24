# Denser type, image backdrops, chart explorer, source names in the "i" icon

## 1. Tighter, neater text
- Page headers: title goes from about 30-36px to 22-24px with tighter line height. The subtitle becomes one 13px line, and the gap between the header and the first figures shrinks.
- Section and card headings: 15-16px instead of 18-20px. Small caps-style labels at 11px, styled like the report sample (letter-spaced, accent colour).
- Headline figures: large, light serif numbers with a short 12px caption underneath, like the Cornerstone sample. Tiles get less padding (16px instead of 24px).
- Body text and tables: 13-14px, one shared left edge, and the same spacing between all sections.
- The changes are made once in the shared page-header, section, figure and card parts, so every page updates together.

## 2. Image backdrops for section headers
- Federal law, Courts & judges, Litigation, Enforcement, Law & government, Places, Companies and Insights each get a sharp, high-resolution photo behind the header, similar to the Supreme Court sample.
- A soft gradient sits over each photo so the title stays readable in light and dark mode. On phones the photo is shorter and cropped.
- Where your visual registry already has a matching official photo (the Supreme Court building, state capitols, agency buildings), that photo is used with its credit. Other headers use generic, unbranded architecture images that never pose as a specific court or agency.

## 3. "Explore this data" builder (ideas from Data Formulator)
- Every chart card gets an "Explore" button. It opens a panel with the fields the chart already uses (for example year, category, count, state).
- You drag or pick fields into X, Y, Colour and Facet, and the chart redraws right away. It suggests a chart type that fits the data: line for time, bars for categories, dots for comparisons.
- A short history shows your earlier views, so you can go back to one.
- An optional "describe it" box lets the built-in AI suggest a field mapping. It only rearranges figures already loaded. It never invents numbers, and its text is marked as AI-generated.
- The figures you see are unchanged. Missing values still show as "Not recorded".

## 4. Source names only inside the "i" icon
- Source names (CourtListener, DocketBird, Stanford Securities Class Action Clearinghouse, Vaquill, FJC and similar) come out of headings, subtitles, captions and body text across about 128 files.
- Each chart or section card gets one "i" icon. It opens the source name, link, period, unit and any notes that matter for accuracy.
- The Sources pages, the library and the export files keep the full source details.

## Technical details
- Type scale: new size tokens in `src/styles.css`, applied in `kit/PageHeader`, `HeaderStrip`, section and figure-tile parts and chart cards.
- Backdrop: a `HeaderBackdrop` prop on `PageHeader` that takes either a registry image picked by exact ID or a generated image saved under `src/assets/headers/`, with a gradient token on top.
- Explorer: `src/components/charts/explore/` with an encoding shelf, rule-based chart picking, and the existing chart parts doing the drawing. The AI suggestion runs through a server function and returns only a field mapping.
- Source text: `rg` sweep of the listed names. Move each into a `SourceInfo` popover on the card and leave data attribution fields as they are. The rules in `AGENTS.md` and the 2026-10-24 owner rules stay in force, and no vendor or model names appear.
- Checks: typecheck, tests, and screenshots at desktop and phone size of every main page.
