'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildMigration } = require('../scripts/migrate-securityplus-v2');
const { validateRepository, validateQuestion } = require('../scripts/validate-content');
const ROOT = path.resolve(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

test('catalog validation accepts two published bundles and excludes the Security+ legacy archive', () => {
  const result = validateRepository(ROOT);
  assert.equal(result.valid, true, result.issues.join('\n'));
  assert.equal(result.summary.published_courses, 2);
  assert.equal(result.summary.records, 310);
});

test('Security+ migration deterministically partitions all 1044 records into 302 published plus 742 needs_review', () => {
  const legacy = readJson('questions.json');
  const published = readJson('content/comptia-security-plus-sy0-701/published-questions.v2.json');
  const archive = readJson('content/comptia-security-plus-sy0-701/needs-review-questions.v2.json');
  const report = readJson('content/reports/securityplus-migration-report.json');
  const expected = buildMigration(legacy);
  assert.equal(legacy.length, 1044);
  assert.deepEqual(published, expected.publishedDocument);
  assert.deepEqual(archive, expected.archiveDocument);
  assert.deepEqual(report, expected.report);
  assert.equal(published.records.length, 302);
  assert.equal(archive.records.length, 742);
  assert.equal(new Set([...published.records, ...archive.records].map((record) => record.id)).size, 1044);
  assert.ok(published.records.every((record) => record.status === 'published' && record.provenance.kind === 'original' && record.explanation));
  assert.ok(archive.records.every((record) => record.status === 'needs_review' && record.provenance.kind === 'legacy_migration'));
  assert.equal(report.accounting.published, 302);
  assert.equal(report.accounting.needs_review, 742);
  assert.equal(report.accounting.records_without_explanation, 742);
});

test('published Security+ course points only at the reviewed original 302-record bank', () => {
  const course = readJson('content/comptia-security-plus-sy0-701/course.json');
  assert.equal(course.status, 'published');
  assert.equal(course.question_bank.path, 'published-questions.v2.json');
  assert.equal(course.question_bank.record_count, 302);
  assert.equal(course.archived_question_banks[0].path, 'needs-review-questions.v2.json');
  assert.equal(course.archived_question_banks[0].record_count, 742);
  assert.equal(course.archived_question_banks[0].application, 'excluded');
});

test('AWS pilot is original and contains a five-option multi-select question', () => {
  const bank = readJson('content/aws-cloud-practitioner-clf-c02/questions.v2.json');
  const multi = bank.records.find((record) => record.type === 'multi_select');
  assert.equal(bank.question_bank_status, 'published'); assert.equal(bank.content_origin, 'original'); assert.ok(multi);
  assert.equal(multi.options.length, 5); assert.equal(multi.correct_option_ids.length, 2); assert.equal(multi.provenance.kind, 'original');
});

test('validator rejects a published record without an explanation', () => {
  const issues = [];
  validateQuestion({ id: 'broken', type: 'single_select', prompt: 'Prompt', explanation: '', domain_id: 'd', status: 'published', options: [{ id: 'one', text: 'One' }, { id: 'two', text: 'Two' }], correct_option_ids: ['one'], provenance: { kind: 'original' } }, 'fixture', new Set(['d']), true, issues);
  assert.ok(issues.some((issue) => issue.includes('non-blank explanation')));
});

test('validator detects an unpublished record injected into a published application bundle', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'certificate-content-'));
  try {
    fs.cpSync(path.join(ROOT, 'content'), path.join(tempRoot, 'content'), { recursive: true });
    const awsPath = path.join(tempRoot, 'content', 'aws-cloud-practitioner-clf-c02', 'questions.v2.json');
    const bank = JSON.parse(fs.readFileSync(awsPath, 'utf8')); bank.records[0].status = 'needs_review'; fs.writeFileSync(awsPath, `${JSON.stringify(bank, null, 2)}\n`, 'utf8');
    const result = validateRepository(tempRoot); assert.equal(result.valid, false); assert.ok(result.issues.some((issue) => issue.includes('published courses cannot contain')));
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});
