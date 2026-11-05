## README.md

No drift detected.

## api/README.md

No drift detected.

## lib/README.md

No drift detected.

## scripts/README.md

No drift detected.

## supabase/README.md

No drift detected.

## docs/AUTHORING.md

- `Planned (not yet supported by the app)`: `docs/AUTHORING.md` notes planned schema `v2.1` question types (`matching`, `ordering`, `fill_blank`, `pbq`) that are not yet implemented in `lib/app.js` or `scripts/validate-content.js` (explicitly marked as planned in the document).
- `catalog.json entry`: Resolved — `scripts/validate-content.js` now enforces `^[a-z0-9][a-z0-9._-]{0,127}$` on `catalog.json` `id` entries as well as `objectives.json` schema `2.1` and question `difficulty`/`tags`/`objective_id` cross-references.
