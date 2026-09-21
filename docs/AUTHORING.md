# Authoring guide — adding a certification

This project is **content-driven**: adding a cert (ISO 27001, a networking exam, etc.)
means adding JSON under `content/`, not changing app code. The app reads
`content/catalog.json` → each course's `course.json` → its question bank.

## Quick start

```bash
# 1. Scaffold a draft course (adds a hidden catalog entry + empty bundle)
node scripts/new-course.js --id iso-27001-2022 --title "ISO/IEC 27001:2022" \
  --provider ISO --code 27001 --category Governance \
  --domains "A.5:Organizational;A.6:People;A.7:Physical;A.8:Technological"

# 2. Add questions — either edit the file by hand, or import a raw source:
node scripts/import-questions.js --course iso-27001-2022 --in raw-questions.json

# 3. Validate
node scripts/validate-content.js

# 4. Publish: set status to "published" in course.json (course + question_bank),
#    in the bank file (question_bank_status), and in catalog.json (status +
#    published:true). Set course.availability.application to "published" and
#    question_bank.record_count to the real count. Re-run the validator.
```

A **draft** course (`published:false`, `status:"draft"`) is validated but hidden from
the app, so you can commit work-in-progress safely.

## File layout per course

```
content/<id>/
  course.json                  # metadata: title, domains, question_bank pointer
  published-questions.v2.json  # the active question bank shown in the app
  objectives.json              # (optional) study notes per domain/objective
```

Copy `content/_TEMPLATE/` as a starting point.

## Field reference

### catalog.json entry
| field | required | notes |
|-------|----------|-------|
| `id` | yes | unique; `^[a-z0-9][a-z0-9._-]{0,127}$` |
| `bundle` | yes | `<id>/course.json` |
| `published` | yes | boolean; `false` hides it from the app |
| `status` | yes | `draft` \| `needs_review` \| `published` |
| `category` | no | grouping label (e.g. `Security`, `Networking`, `Governance`, `Cloud`) |

### course.json
| field | required | notes |
|-------|----------|-------|
| `schema_version` | yes | `"2.0"` |
| `id` | yes | must equal the catalog id |
| `title`, `summary` | yes/no | shown on the course card |
| `provider`, `exam_code`, `category` | no | metadata |
| `status` | yes | must match the catalog status |
| `availability.application` | yes | `"published"` only when `published:true` |
| `domains[]` | yes | each needs `id` + `title` |
| `question_bank.path` | yes | relative to the course folder |
| `question_bank.record_count` | yes | integer; must equal the bank's record count |
| `question_bank.status` | yes | must match the bank's `question_bank_status` |

### Question record
| field | required | notes |
|-------|----------|-------|
| `id` | yes | unique within the bank |
| `type` | yes | `single_select` \| `multi_select` |
| `prompt` | yes | the question text |
| `options[]` | yes | ≥2, each with non-blank `id` + `text` |
| `correct_option_ids[]` | yes | single_select = exactly 1; multi_select = ≥2 |
| `explanation` | required to publish | why the answer is correct |
| `domain_id` | yes | must match a course domain id |
| `status` | yes | matches publication state |
| `provenance.kind` | yes | e.g. `original`, `imported`, `legacy_migration` |
| `difficulty` | no | `easy` \| `medium` \| `hard` (used for filtering/analytics) |
| `tags` | no | string array for cross-cutting topics |

## Notes / objectives (objectives.json)

Optional but recommended for concept-heavy certs (ISO 27001 controls, networking
fundamentals). Format:

```json
{ "schema_version": "2.1", "course_id": "<id>",
  "domains": [ { "id": "A.5", "objectives": [
    { "id": "A.5.1", "title": "Policies for information security",
      "summary": "…", "notes_md": "…", "refs": ["A.5.1"] }
  ]}]}
```

## Planned (not yet supported by the app)

The schema will grow to **v2.1** with `matching`, `ordering`, `fill_blank`, and
`pbq` (performance-based, multi-step) question types. Until that lands, use
`single_select` / `multi_select` only — other types will fail validation.

## Always validate before committing

```bash
npm run validate   # node scripts/validate-content.js
npm test           # node --test
```
