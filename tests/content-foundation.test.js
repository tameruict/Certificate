'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildMigration } = require('../scripts/migrate-securityplus-v2');
const { validateRepository, validateQuestion, validateObjectives } = require('../scripts/validate-content');
const ROOT = path.resolve(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

test('catalog validation accepts four published bundles and excludes the Security+ legacy archive', () => {
  const result = validateRepository(ROOT);
  assert.equal(result.valid, true, result.issues.join('\n'));
  assert.equal(result.summary.published_courses, 4);
  assert.equal(result.summary.records, 377);
});

test('Security+ migration deterministically partitions all 1044 records into 302 published plus 742 needs_review with metadata', () => {
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
  assert.ok(published.records.every((record) =>
    record.status === 'published' &&
    record.provenance.kind === 'original' &&
    record.explanation &&
    ['easy', 'medium', 'hard'].includes(record.difficulty) &&
    Array.isArray(record.tags) && record.tags.length > 0 &&
    typeof record.objective_id === 'string' && record.objective_id.length > 0
  ));
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

test('AWS CLF-C02, ISO/IEC 27001:2022, and CompTIA Network+ N10-009 bundles are published with 25 records and v2.1 objectives', () => {
  for (const [courseId, bankFile] of [
    ['aws-cloud-practitioner-clf-c02', 'questions.v2.json'],
    ['iso-27001-2022', 'published-questions.v2.json'],
    ['comptia-network-plus-n10-009', 'published-questions.v2.json']
  ]) {
    const course = readJson(`content/${courseId}/course.json`);
    const objectives = readJson(`content/${courseId}/objectives.json`);
    const bank = readJson(`content/${courseId}/${bankFile}`);
    assert.equal(course.status, 'published');
    assert.equal(course.question_bank.record_count, 25);
    assert.equal(objectives.schema_version, '2.1');
    assert.equal(objectives.course_id, courseId);
    assert.equal(bank.records.length, 25);
    assert.ok(bank.records.some((record) => record.type === 'multi_select'));
    assert.ok(bank.records.every((record) => record.difficulty && Array.isArray(record.tags) && record.tags.length > 0 && record.objective_id));
  }
});

test('validator rejects a published record without an explanation or with invalid objective/difficulty', () => {
  const issues = [];
  const objMap = new Map([['d', new Set(['d.1'])]]);
  validateQuestion({
    id: 'broken',
    type: 'single_select',
    prompt: 'Prompt',
    explanation: '',
    domain_id: 'd',
    objective_id: 'd.99',
    difficulty: 'impossible',
    status: 'published',
    options: [{ id: 'one', text: 'One' }, { id: 'two', text: 'Two' }],
    correct_option_ids: ['one'],
    provenance: { kind: 'original' }
  }, 'fixture', new Set(['d']), true, issues, objMap);
  assert.ok(issues.some((issue) => issue.includes('non-blank explanation')));
  assert.ok(issues.some((issue) => issue.includes('difficulty')));
  assert.ok(issues.some((issue) => issue.includes("objective_id 'd.99'")));

  const objIssues = [];
  validateObjectives({
    schema_version: '2.1',
    course_id: 'wrong-id',
    domains: [{ id: 'unknown', objectives: [{ id: '1.1', title: 'Obj' }] }]
  }, 'fixture', 'expected-id', new Set(['1']), objIssues);
  assert.ok(objIssues.some((issue) => issue.includes('course_id must match')));
  assert.ok(objIssues.some((issue) => issue.includes("domain 'unknown' is not defined")));
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
