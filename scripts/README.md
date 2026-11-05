# Content Authoring, Migration & Validation Scripts (`scripts`)

## Overview
Node.js CLI and library utilities for scaffolding certification courses, importing and normalizing raw question banks, migrating legacy Security+ question sets to v2 schema, importing bilingual Markdown study writeups into Supabase, and validating repository-wide content contracts.

## Interface
- `scripts/import-questions.js`:
  - `run(argv = process.argv.slice(2)) -> { bank, warnings }`
  - `normalizeRaw(raw, index, domainIds, occurrences, courseId, warnings) -> QuestionRecord`
  - `parseArgs(argv) -> Record<string, string | boolean>`
  - CLI: `node scripts/import-questions.js --course <id> --in <path> [--status draft|needs_review|published] [--out <filename>] [--dry-run]`
- `scripts/import-writeups.js`:
  - `parseFrontmatter(text) -> { data, body }`
  - `validateArticle(data, sourcePath) -> void`
  - `collectArticles(sourceDir) -> { articles, skipped, referenced, missingImages, existingImages, totalImageBytes, incompletePairs }`
  - `referencedImages(markdown) -> string[]`
  - CLI: `node scripts/import-writeups.js --source <path-to-github.io> [--dry-run|--apply]`
- `scripts/migrate-securityplus-v2.js`:
  - `buildMigration(legacyQuestions) -> { publishedDocument, archiveDocument, report }`
  - `canonicalLegacyQuestion(question) -> string`
  - `stableQuestionId(question, occurrences) -> string`
  - `classifyQuestion(domainId, prompt, options, explanation) -> { difficulty, tags, objective_id }`
  - `run(args = process.argv.slice(2)) -> MigrationReport`
  - CLI: `node scripts/migrate-securityplus-v2.js [--check]`
- `scripts/new-course.js`:
  - `run(argv = process.argv.slice(2)) -> { id, courseDir }`
  - `parseArgs(argv) -> Record<string, string | boolean>`
  - `parseDomains(spec) -> Array<{ id: string, title: string }>`
  - CLI: `node scripts/new-course.js --id <id> --title <title> [--provider <str>] [--code <str>] [--category <str>] [--summary <str>] [--domains "id:Title;..."]`
- `scripts/validate-content.js`:
  - `validateRepository(root = ROOT) -> { valid: boolean, issues: string[], summary: { catalog: string, courses: Array<{ id, published, record_count, status }>, published_courses: number, records: number } }`
  - `validateQuestion(question, context, domainIds, courseIsPublished, issues, objectiveIdsByDomain = null) -> void`
  - `validateObjectives(objectives, entryLabel, courseId, domainIds, issues) -> Map<string, Set<string>>`
  - `run() -> ValidationResult`
  - CLI: `node scripts/validate-content.js`

## Invariants
- Schema version across `content/catalog.json`, `course.json` bundles, and question bank files must be `'2.0'` (`objectives.json` uses `'2.1'`).
- Valid content statuses are strictly `'draft'`, `'needs_review'`, or `'published'`; valid question types are `'single_select'` (exactly 1 correct option) or `'multi_select'` (`>= 2` correct options).
- Every question record requires a unique non-blank `id` within its bank, non-blank `prompt`, `domain_id` matching a declared course domain, `>= 2` options with unique non-blank `id`/`text`, valid deduplicated `correct_option_ids` referencing existing options, and non-blank `provenance.kind`.
- Published courses (`catalog.published === true`) must have status `'published'` across the catalog entry, course bundle, `availability.application`, `question_bank`, and every question record, and every published question must have a non-blank `explanation`.
- Unpublished courses cannot set `availability.application === 'published'`, and `archived_question_banks` must set `application === 'excluded'` and must not duplicate the active `question_bank` path.
- All bundle, active `question_bank`, and `archived_question_banks` paths must resolve inside `content/` and their respective course bundle directory (preventing path traversal); bank `records.length` must equal the declared integer `record_count`.
- Question IDs in `import-questions.js` and `migrate-securityplus-v2.js` are deterministically derived from `<prefix>-<first 16 hex chars of SHA-256>` over canonical fields, appending `-<count>` only on hash collision.
- `migrate-securityplus-v2.js` requires `questions.json` to contain at least 302 legacy records with keys `['d','q','o','a','e']` (`d` in `1..5`, `o.length >= 2`, `a` in `0..o.length-1`), publishing the first 302 records and archiving the remainder as `'needs_review'`.
- `new-course.js` requires a unique course `id` matching `/^[a-z0-9][a-z0-9._-]{0,127}$/`, a non-existent `content/<id>/` directory, and unique `id:Title` domain definitions.
- `import-writeups.js` requires non-draft Markdown files to contain valid frontmatter (`title`, `description <= 180` chars, `platform`, `category`, `difficulty` in `Easy|Medium|Hard|Insane`, `language` in `vi|en`, unique `translationKey::language` pair, parseable `publishedAt`) and refuses `--apply` if `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or any referenced `/images/*` file is missing.

## Side Effects
- `import-questions.js` reads `content/<course>/course.json` and the `--in` JSON file, writes `content/<course>/<out>` (default `published-questions.v2.json`) unless `--dry-run` is set, writes to `stdout`/`stderr`, and sets `process.exitCode = 1` on error.
- `import-writeups.js` recursively reads `.md` files under `<source>/src/content/writeups` and stats/reads image files under `<source>/public/images`; when `--apply` is passed, performs HTTP `POST` upserts to Supabase Storage (`/storage/v1/object/writeup-images/<path>?upsert=true`) and PostgREST (`/rest/v1/study_articles?on_conflict=translation_key,language`).
- `migrate-securityplus-v2.js` reads `questions.json` and writes `content/comptia-security-plus-sy0-701/published-questions.v2.json`, `content/comptia-security-plus-sy0-701/needs-review-questions.v2.json`, and `content/reports/securityplus-migration-report.json` unless `--check` is passed.
- `new-course.js` creates `content/<id>/`, writes `course.json`, `published-questions.v2.json`, and `objectives.json`, and updates `content/catalog.json` in place.
- `validate-content.js` reads `content/catalog.json`, `course.json` bundles, and active/archived question bank JSON files, outputting validation results to `stdout`/`stderr` and setting `process.exitCode = 1` on failure.

## Verification
- Run: `npm test`
