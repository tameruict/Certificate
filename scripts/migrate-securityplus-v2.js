'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'questions.json');
const COURSE_DIR = path.join(ROOT, 'content', 'comptia-security-plus-sy0-701');
const PUBLISHED_PATH = path.join(COURSE_DIR, 'published-questions.v2.json');
const ARCHIVE_PATH = path.join(COURSE_DIR, 'needs-review-questions.v2.json');
const REPORT_PATH = path.join(ROOT, 'content', 'reports', 'securityplus-migration-report.json');
const COURSE_ID = 'comptia-security-plus-sy0-701';
const REVIEWED_RECORD_COUNT = 302;
const LEGACY_SCHEMA = ['d', 'q', 'o', 'a', 'e'];
function canonicalLegacyQuestion(question) { return JSON.stringify({ d: question.d, q: question.q, o: question.o, a: question.a, e: question.e }); }
function fingerprint(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableQuestionId(question, occurrences) { const base = `secplus-sy0-701-${fingerprint(canonicalLegacyQuestion(question)).slice(0, 16)}`; const count = (occurrences.get(base) || 0) + 1; occurrences.set(base, count); return count === 1 ? base : `${base}-${count}`; }
function normalizeLegacyQuestion(question, index, occurrences) {
  for (const key of LEGACY_SCHEMA) if (!(key in question)) throw new Error(`Legacy record ${index} is missing '${key}'.`);
  if (!Number.isInteger(question.d) || question.d < 1 || question.d > 5) throw new Error(`Legacy record ${index} has invalid domain.`);
  if (!Array.isArray(question.o) || question.o.length < 2) throw new Error(`Legacy record ${index} has invalid options.`);
  if (!Number.isInteger(question.a) || question.a < 0 || question.a >= question.o.length) throw new Error(`Legacy record ${index} has invalid answer index.`);
  const optionIds = question.o.map((_, optionIndex) => `option_${optionIndex + 1}`);
  return { id: stableQuestionId(question, occurrences), type: 'single_select', prompt: String(question.q).trim(), options: question.o.map((text, optionIndex) => ({ id: optionIds[optionIndex], text: String(text).trim() })), correct_option_ids: [optionIds[question.a]], explanation: String(question.e).trim(), domain_id: String(question.d), status: 'needs_review', provenance: { kind: 'legacy_migration', source_file: 'questions.json', source_record_index: index, source_schema: 'd-q-o-a-e' } };
}
function makePublishedRecord(record) { return { ...record, status: 'published', provenance: { kind: 'original', source_file: 'questions.json', source_record_index: record.provenance.source_record_index, authoring_note: 'Reviewed original Security+ study material preserved from the established first 302-record bank; not an exam item.' } }; }
function buildMigration(legacyQuestions) {
  if (!Array.isArray(legacyQuestions) || legacyQuestions.length < REVIEWED_RECORD_COUNT) throw new Error(`questions.json must contain at least ${REVIEWED_RECORD_COUNT} records.`);
  const occurrences = new Map(); const normalized = legacyQuestions.map((question, index) => normalizeLegacyQuestion(question, index, occurrences)); const publishedRecords = normalized.slice(0, REVIEWED_RECORD_COUNT).map(makePublishedRecord); const archiveRecords = normalized.slice(REVIEWED_RECORD_COUNT); const duplicateIdSuffixes = [...occurrences.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const publishedDocument = { schema_version: '2.0', course_id: COURSE_ID, question_bank_status: 'published', content_origin: 'original', records: publishedRecords };
  const archiveDocument = { schema_version: '2.0', course_id: COURSE_ID, question_bank_status: 'needs_review', content_origin: 'legacy_migration', records: archiveRecords };
  const report = { report_version: '1.0', migration: 'legacy-securityplus-to-content-v2', source: { path: 'questions.json', record_count: legacyQuestions.length, sha256: fingerprint(JSON.stringify(legacyQuestions)), schema: LEGACY_SCHEMA }, outputs: { published: { path: 'content/comptia-security-plus-sy0-701/published-questions.v2.json', record_count: publishedRecords.length, sha256: fingerprint(JSON.stringify(publishedDocument)), question_bank_status: 'published', provenance: 'reviewed_original_subset' }, needs_review: { path: 'content/comptia-security-plus-sy0-701/needs-review-questions.v2.json', record_count: archiveRecords.length, sha256: fingerprint(JSON.stringify(archiveDocument)), question_bank_status: 'needs_review', provenance: 'legacy_migration' } }, accounting: { migrated: normalized.length, skipped: 0, published: publishedRecords.length, needs_review: archiveRecords.length, single_select: normalized.length, multi_select: 0, duplicate_id_suffixes: duplicateIdSuffixes, records_without_explanation: archiveRecords.filter((record) => !record.explanation).length }, id_strategy: 'secplus-sy0-701 + first 16 hex chars of SHA-256 over canonical legacy fields; deterministic duplicate suffix only for identical records.', app_eligibility: 'The reviewed original 302-record subset is published. The remaining legacy records are archived and excluded until editorial review changes that bank and its records to published.' };
  return { publishedDocument, archiveDocument, report };
}
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function run(args = process.argv.slice(2)) { const checkOnly = args.includes('--check'); const { publishedDocument, archiveDocument, report } = buildMigration(JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'))); const expected = [[PUBLISHED_PATH, json(publishedDocument)], [ARCHIVE_PATH, json(archiveDocument)], [REPORT_PATH, json(report)]]; if (checkOnly) { if (!expected.every(([filePath, contents]) => fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents)) throw new Error('Migration output is stale. Run: node scripts/migrate-securityplus-v2.js'); console.log(`Migration is current: ${report.accounting.published} published and ${report.accounting.needs_review} needs_review records.`); return report; } for (const [filePath, contents] of expected) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, contents, 'utf8'); } console.log(`Migrated ${report.accounting.migrated} records: ${report.accounting.published} published, ${report.accounting.needs_review} archived for review.`); return report; }
if (require.main === module) { try { run(); } catch (error) { console.error(`Migration failed: ${error.message}`); process.exitCode = 1; } }
module.exports = { buildMigration, canonicalLegacyQuestion, stableQuestionId, run };
