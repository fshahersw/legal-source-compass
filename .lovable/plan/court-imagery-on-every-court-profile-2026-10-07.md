# Court imagery on every court profile

## Goal
Give every court page a useful visual identity across federal, state, district, bankruptcy, appellate, county, municipal, and historical court records—without presenting generic artwork as an official court seal.

## Image policy
Use this strict priority order:

1. **Exact official court image** — a seal, logo, courthouse photo, or official header matched by the court’s exact corpus ID and retained with its source page, original image URL, retrieval date, checksum, and descriptive label.
2. **Recorded corpus image** — an existing court-profile image link, again only when it belongs to the exact court record.
3. **Court-type emblem** — an original, neutral visual for the recorded court type. It will be labeled “Court type” and never called an official seal or court image.
4. **Unclassified court fallback** — a restrained courthouse emblem labeled “Court type not recorded.” No type will be guessed from the court name.

Official imagery will never be matched by similar names, jurisdictions, URLs, or parent courts.

## What will change

### 1. One court-artwork registry
- Replace the duplicated, hardcoded five-court lookup with one shared registry read by both court profiles and matter headers.
- Preserve the five existing verified federal marks and their current provenance.
- Define a validated record for court ID, artwork kind, local/CDN asset, official source page, original image URL, retrieval date, checksum, and accessible description.
- Reject duplicate court IDs, missing provenance, broken files, and unsupported artwork kinds in tests.

### 2. Conservative court-type classification
- Normalize the directory’s recorded free-text type into presentation groups such as:
  - U.S. Supreme Court
  - Federal appellate
  - Federal district
  - Federal bankruptcy
  - State supreme/high court
  - State appellate
  - State trial/district/circuit/superior
  - County/parish
  - Municipal/local/specialty
  - Historical or not recorded
- Classification will use only the recorded `system` and `type` fields. Ambiguous values remain unclassified rather than inferred from the title.
- Add a coverage report showing every observed source type, its mapped group, and all unmapped values.

### 3. Court artwork component
- Build one reusable court-artwork component with stable seal, banner, and photo layouts.
- Show the official source attribution in a small caption or tooltip when official artwork is present.
- Give neutral type emblems distinct shapes and labels so they cannot be mistaken for government seals.
- Hide a failed official image and fall back to the correct type emblem instead of leaving a blank area.
- Include descriptive alt text, keyboard-accessible attribution, responsive sizing, and no layout shift.

### 4. Court profile integration
- Place the artwork prominently beside the court name and key facts on every `/courts/:id` page.
- Keep the existing location map and factual panels unchanged.
- Use the court directory’s exact ID, system, type, and state record to select the artwork; no fuzzy matching.
- Remove the generic page’s fragile “first link containing seal/image/logo” presentation for court profiles in favor of the court-specific component.

### 5. Matter-page consistency
- Reuse the same registry and artwork component for court marks in matter headers.
- Preserve the compact matter-header size while ensuring the image, fallback, and attribution match the corresponding court profile.

### 6. Official-image acquisition path
- Add a repeatable acquisition script for future official court artwork.
- Accept only images discovered on an authoritative court or government page and require an exact court-ID review before adding them.
- Store downloaded media through the project asset flow; keep provenance and checksum metadata in the registry.
- Produce a review list instead of publishing uncertain, third-party, copyrighted, or name-only matches.
- The first release will provide honest visual coverage for every court through type emblems; exact official imagery will expand only as it is verified.

## Verification
- Unit-test exact-ID artwork selection, precedence, all court-type mappings, unknown types, broken-image fallback, and manifest/file consistency.
- Test representative pages for federal district, bankruptcy, federal appellate, state high court, state appellate, county/local, historical, and unknown records.
- Browser-check desktop and mobile court pages plus a matter header for correct image sizing, attribution, fallback labels, and no overlap.
- Confirm every directory court receives either verified exact artwork or a clearly labeled neutral fallback.
- Confirm no official image is assigned through fuzzy matching and no generic emblem is described as an official seal.

## Technical notes
- Court-specific artwork selection will live outside the generic entity renderer.
- Existing external corpus access remains read-only; this work does not alter court records.
- Official media and provenance remain versioned and auditable; uncertain candidates stay out of the published registry.
