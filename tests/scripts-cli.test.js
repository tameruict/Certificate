'use strict';

// Behaviour tests for scripts/new-course.js and scripts/import-questions.js.
//
// Both scripts resolve their repository root from __dirname, so they
// cannot be pointed at a temporary directory by an argument. These tests
// therefore copy the script file under test into a fresh temporary
// directory that mimics a minimal repo layout (scripts/ + content/),
// run it there with child_process, and assert on the files it creates.
// The real content/ bank is never touched by these tests.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_SCRIPTS = path.resolve(__dirname, '../scripts');

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'certlab-scripts-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'content', 'catalog.json'),
    `${JSON.stringify({ schema_version: '2.0', courses: [] }, null, 2)}\n`,
    'utf8'
  );
  return root;
}

function installScript(root, name) {
  const destination = path.join(root, 'scripts', name);
  fs.copyFileSync(path.join(REPO_SCRIPTS, name), destination);
  return destination;
}

function runScript(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('new-course scaffolds a draft course and registers it in the catalog', () => {
  const root = makeTempRepo();
  try {
    const script = installScript(root, 'new-course.js');
    const result = runScript(script, [
      '--id', 'test-course-101',
      '--title', 'Test Course',
      '--provider', 'TestOrg',
      '--code', 'TST-101',
      '--category', 'Testing',
      '--domains', '1:General;2:Advanced'
    ]);
    assert.equal(result.status, 0, result.stderr);
    const courseDir = path.join(root, 'content', 'test-course-101');
    const course = readJson(path.join(courseDir, 'course.json'));
    assert.equal(course.id, 'test-course-101');
    assert.equal(course.status, 'draft');
    assert.equal(course.question_bank.record_count, 0);
    assert.deepEqual(course.domains, [{ id: '1', title: 'General' }, { id: '2', title: 'Advanced' }]);
    const bank = readJson(path.join(courseDir, 'published-questions.v2.json'));
    assert.deepEqual(bank.records, []);
    assert.ok(fs.existsSync(path.join(courseDir, 'objectives.json')));
    const catalog = readJson(path.join(root, 'content', 'catalog.json'));
    assert.deepEqual(catalog.courses, [{ id: 'test-course-101', bundle: 'test-course-101/course.json', published: false, status: 'draft' }]);

    // Scaffolding the same id twice must fail instead of overwriting.
    const duplicate = runScript(script, ['--id', 'test-course-101', '--title', 'Again']);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /already exists/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('new-course rejects an invalid course id', () => {
  const root = makeTempRepo();
  try {
    const script = installScript(root, 'new-course.js');
    const result = runScript(script, ['--id', 'Bad ID!', '--title', 'Bad']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--id/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function scaffoldCourseForImport(root) {
  const script = installScript(root, 'new-course.js');
  const result = runScript(script, [
    '--id', 'test-course-101',
    '--title', 'Test Course',
    '--domains', '1:General'
  ]);
  assert.equal(result.status, 0, result.stderr);
  return path.join(root, 'content', 'test-course-101');
}

test('import-questions writes a bank with resolved option ids and counts', () => {
  const root = makeTempRepo();
  try {
    const courseDir = scaffoldCourseForImport(root);
    const fixturePath = path.join(root, 'fixture.json');
    fs.writeFileSync(fixturePath, JSON.stringify([
      {
        prompt: 'Which one is correct?',
        options: ['First', 'Second', 'Third'],
        correct: 1,
        domain_id: '1',
        explanation: 'Second is correct.'
      },
      {
        prompt: 'Pick both correct answers.',
        options: ['A', 'B', 'C'],
        correct: ['A', 'C'],
        domain_id: '1',
        explanation: 'A and C are correct.'
      }
    ]), 'utf8');
    const script = installScript(root, 'import-questions.js');
    const result = runScript(script, ['--course', 'test-course-101', '--in', fixturePath]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Imported 2 record/);
    const bank = readJson(path.join(courseDir, 'published-questions.v2.json'));
    assert.equal(bank.records.length, 2);
    assert.equal(bank.schema_version, '2.0');
    assert.deepEqual(bank.records[0].correct_option_ids, ['option_2']);
    assert.deepEqual(bank.records[1].correct_option_ids, ['option_1', 'option_3']);
    assert.equal(bank.records[1].type, 'multi_select');
    assert.ok(bank.records.every((record) => record.status === 'draft'));

    // --dry-run must report the count without rewriting the bank.
    const before = fs.readFileSync(path.join(courseDir, 'published-questions.v2.json'), 'utf8');
    const dry = runScript(script, ['--course', 'test-course-101', '--in', fixturePath, '--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /--dry-run/);
    assert.equal(fs.readFileSync(path.join(courseDir, 'published-questions.v2.json'), 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('import-questions rejects a record with no resolvable correct option', () => {
  const root = makeTempRepo();
  try {
    scaffoldCourseForImport(root);
    const fixturePath = path.join(root, 'fixture.json');
    fs.writeFileSync(fixturePath, JSON.stringify([
      { prompt: 'Broken?', options: ['A', 'B'], correct: 9, domain_id: '1', explanation: 'No.' }
    ]), 'utf8');
    const script = installScript(root, 'import-questions.js');
    const result = runScript(script, ['--course', 'test-course-101', '--in', fixturePath]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not resolve/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
