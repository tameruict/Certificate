'use strict';

// Convert a raw question source into a schema-v2 question bank for a course.
// Generalizes the one-off migrate-securityplus-v2.js so any cert can be imported.
//
// Input: a JSON file that is either
//   (a) an array of raw questions, or
//   (b) an object with a "records"/"questions"/"items" array.
// Each raw question is mapped flexibly (many field aliases are accepted):
//   prompt   <- prompt | question | q | text
//   options  <- options | choices | o | answers        (array of strings or {text})
//   correct  <- correct | correct_option_ids | answer | a
//              (option index(es), option id(s), or the correct option text(s))
//   domain   <- domain_id | domain | d
//   explanation <- explanation | rationale | e
//   type     <- type (single_select | multi_select); inferred from #correct otherwise
//   difficulty, tags  <- passed through when present (optional v2.1 fields)
//
// Usage:
//   node scripts/import-questions.js --course iso-27001-2022 --in raw.json
//   node scripts/import-questions.js --course iso-27001-2022 --in raw.json --status needs_review --dry-run
//
// Stable ids: "<course>-<first 16 hex of sha256 over prompt+options+correct>".
// Writes to content/<course>/<out> (default published-questions.v2.json).
// Records missing an explanation or with an unknown domain are reported as warnings.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const VALID_STATUSES = new Set(['draft', 'needs_review', 'published']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) { args[token.slice(2, eq)] = token.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { args[token.slice(2)] = true; }
    else { args[token.slice(2)] = next; i += 1; }
  }
  return args;
}

const first = (source, keys) => { for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key]; return undefined; };
const asArray = value => Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');

function normalizeRaw(raw, index, domainIds, occurrences, courseId, warnings) {
  const prompt = String(first(raw, ['prompt', 'question', 'q', 'text']) || '').trim();
  if (!prompt) throw new Error(`Record ${index}: missing prompt.`);

  const rawOptions = asArray(first(raw, ['options', 'choices', 'o', 'answers']));
  if (rawOptions.length < 2) throw new Error(`Record ${index}: needs at least two options.`);
  const options = rawOptions.map((option, optionIndex) => ({
    id: `option_${optionIndex + 1}`,
    text: String(typeof option === 'string' ? option : (option?.text ?? option?.label ?? option?.value ?? '')).trim()
  }));
  if (options.some(option => !option.text)) throw new Error(`Record ${index}: every option needs non-blank text.`);

  const rawCorrect = asArray(first(raw, ['correct', 'correct_option_ids', 'correctOptionIds', 'answer', 'a']));
  const correct = [...new Set(rawCorrect.flatMap(value => {
    if (typeof value === 'number' && options[value]) return [options[value].id];        // index
    const asId = options.find(option => option.id === String(value));                    // option_N id
    if (asId) return [asId.id];
    const byText = options.find(option => option.text === String(value).trim());          // literal text
    return byText ? [byText.id] : [];
  }))];
  if (!correct.length) throw new Error(`Record ${index}: could not resolve any correct option from ${JSON.stringify(rawCorrect)}.`);

  const domainId = String(first(raw, ['domain_id', 'domainId', 'domain', 'd']) ?? '').trim();
  if (!domainId) throw new Error(`Record ${index}: missing domain.`);
  if (domainIds && !domainIds.has(domainId)) warnings.push(`Record ${index}: domain "${domainId}" is not defined by the course.`);

  const declaredType = String(raw.type || '').trim();
  const type = declaredType === 'multi_select' || declaredType === 'single_select'
    ? declaredType
    : (correct.length > 1 ? 'multi_select' : 'single_select');
  if (type === 'single_select' && correct.length !== 1) throw new Error(`Record ${index}: single_select needs exactly one correct option.`);

  const explanation = String(first(raw, ['explanation', 'rationale', 'e']) || '').trim();
  if (!explanation) warnings.push(`Record ${index}: missing explanation (required before publishing).`);

  const base = `${courseId}-${fingerprint(JSON.stringify({ prompt, options: options.map(o => o.text), correct })).slice(0, 16)}`;
  const count = (occurrences.get(base) || 0) + 1;
  occurrences.set(base, count);

  const record = {
    id: count === 1 ? base : `${base}-${count}`,
    type,
    prompt,
    options,
    correct_option_ids: correct,
    explanation,
    domain_id: domainId,
    status: 'draft',
    provenance: { kind: 'imported', source_record_index: index }
  };
  if (raw.difficulty) record.difficulty = String(raw.difficulty).trim();
  if (Array.isArray(raw.tags) && raw.tags.length) record.tags = raw.tags.map(String);
  return record;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const courseId = String(args.course || '').trim();
  const inPath = String(args.in || '').trim();
  const status = String(args.status || 'draft').trim();
  const outName = String(args.out || 'published-questions.v2.json').trim();
  const dryRun = Boolean(args['dry-run']);

  if (!courseId || !inPath) throw new Error('Both --course and --in are required.');
  if (!VALID_STATUSES.has(status)) throw new Error(`--status must be one of ${[...VALID_STATUSES].join(', ')}.`);

  const courseDir = path.join(CONTENT_DIR, courseId);
  const coursePath = path.join(courseDir, 'course.json');
  if (!fs.existsSync(coursePath)) throw new Error(`content/${courseId}/course.json not found. Scaffold it first: node scripts/new-course.js`);
  const course = JSON.parse(fs.readFileSync(coursePath, 'utf8'));
  const domainIds = new Set((course.domains || []).map(domain => String(domain.id)));

  const rawSource = JSON.parse(fs.readFileSync(path.resolve(inPath), 'utf8'));
  const rawRecords = Array.isArray(rawSource)
    ? rawSource
    : (rawSource.records || rawSource.questions || rawSource.items || []);
  if (!Array.isArray(rawRecords) || !rawRecords.length) throw new Error('Input contains no question records.');

  const warnings = [];
  const occurrences = new Map();
  const records = rawRecords.map((raw, index) => normalizeRaw(raw, index, domainIds, occurrences, courseId, warnings));

  const bank = {
    schema_version: '2.0',
    course_id: courseId,
    question_bank_status: status,
    content_origin: 'imported',
    records: records.map(record => ({ ...record, status }))
  };

  for (const warning of warnings) console.warn(`WARN  ${warning}`);
  console.log(`Imported ${records.length} record(s) for ${courseId} (${warnings.length} warning(s)).`);

  const outPath = path.join(courseDir, outName);
  if (dryRun) { console.log(`--dry-run: would write ${records.length} records to content/${courseId}/${outName}.`); return { bank, warnings }; }
  fs.writeFileSync(outPath, `${JSON.stringify(bank, null, 2)}\n`, 'utf8');
  console.log(`Wrote content/${courseId}/${outName}.`);
  console.log(`Remember to set question_bank.record_count = ${records.length} in course.json, then run: node scripts/validate-content.js`);
  return { bank, warnings };
}

if (require.main === module) {
  try { run(); }
  catch (error) { console.error(`import-questions failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { run, normalizeRaw, parseArgs };
