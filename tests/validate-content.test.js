'use strict';

// Repository-level tests for scripts/validate-content.js with small
// synthetic fixtures. This is feasible without a large refactor because
// the module already exports validateRepository(root) and
// validateQuestion(...): a synthetic root only needs content/catalog.json
// plus one course bundle, and no real content/ file is involved.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateRepository, validateQuestion } = require('../scripts/validate-content');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validQuestion(overrides = {}) {
  return {
    id: 'q-1',
    type: 'single_select',
    prompt: 'Which one?',
    explanation: 'Because.',
    domain_id: '1',
    status: 'draft',
    options: [
      { id: 'option_1', text: 'First' },
      { id: 'option_2', text: 'Second' }
    ],
    correct_option_ids: ['option_2'],
    provenance: { kind: 'original' },
    ...overrides
  };
}

function makeRepo({ courseOverrides = {}, bankOverrides = {}, catalogOverrides = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'certlab-validate-'));
  writeJson(path.join(root, 'content', 'catalog.json'), {
    schema_version: '2.0',
    courses: [{ id: 'test-course', bundle: 'test-course/course.json', published: false, status: 'draft', ...catalogOverrides }]
  });
  writeJson(path.join(root, 'content', 'test-course', 'course.json'), {
    schema_version: '2.0',
    id: 'test-course',
    status: 'draft',
    availability: { application: 'draft' },
    domains: [{ id: '1', title: 'General' }],
    question_bank: { path: 'questions.v2.json', record_count: 1, status: 'draft' },
    ...courseOverrides
  });
  writeJson(path.join(root, 'content', 'test-course', 'questions.v2.json'), {
    schema_version: '2.0',
    course_id: 'test-course',
    question_bank_status: 'draft',
    content_origin: 'original',
    records: [validQuestion()],
    ...bankOverrides
  });
  return root;
}

test('validateRepository accepts a minimal synthetic draft course', () => {
  const root = makeRepo();
  try {
    const result = validateRepository(root);
    assert.equal(result.valid, true, result.issues.join('\n'));
    assert.equal(result.summary.records, 1);
    assert.equal(result.summary.published_courses, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateRepository rejects a record_count that does not match the bank', () => {
  const root = makeRepo({ courseOverrides: { question_bank: { path: 'questions.v2.json', record_count: 2, status: 'draft' } } });
  try {
    const result = validateRepository(root);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.includes('record_count does not match')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateQuestion rejects a published record without an explanation', () => {
  const issues = [];
  validateQuestion(
    validQuestion({ status: 'published', explanation: '' }),
    'fixture',
    new Set(['1']),
    true,
    issues
  );
  assert.ok(issues.some((issue) => issue.includes('non-blank explanation')));
});

test('validateQuestion rejects a correct option id that does not exist', () => {
  const issues = [];
  validateQuestion(
    validQuestion({ correct_option_ids: ['option_9'] }),
    'fixture',
    new Set(['1']),
    false,
    issues
  );
  assert.ok(issues.some((issue) => issue.includes('does not exist')));
});
