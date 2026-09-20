'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const APP_PATH = path.resolve(__dirname, '../lib/app.js');

function camelCaseDataName(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function createDom() {
  let html = '';
  const elementCache = new Map();
  const appElement = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; elementCache.clear(); }
  };

  function elementsFor(selector) {
    if (elementCache.has(selector)) return elementCache.get(selector);
    const match = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!match) return [];
    const wanted = match[1];
    const elements = [];
    const openingTags = appElement.innerHTML.match(/<[^/!][^>]*>/g) || [];

    for (const tag of openingTags) {
      if (!new RegExp(`\\sdata-${wanted}(?:=|\\s|>)`).test(tag)) continue;
      const dataset = {};
      for (const attribute of tag.matchAll(/\sdata-([a-z-]+)="([^"]*)"/g)) {
        dataset[camelCaseDataName(attribute[1])] = attribute[2];
      }
      const listeners = {};
      elements.push({
        dataset,
        addEventListener(type, handler) { listeners[type] = handler; },
        click() { listeners.click?.({ currentTarget: this, target: this }); }
      });
    }
    elementCache.set(selector, elements);
    return elements;
  }

  const document = {
    querySelector(selector) {
      if (selector === '#app') return appElement;
      return elementsFor(selector)[0] || null;
    },
    querySelectorAll: elementsFor
  };
  return { appElement, document };
}

function loadAppForTest() {
  const { appElement, document } = createDom();
  const stored = new Map();
  const context = {
    console,
    document,
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, value); }
    },
    window: { addEventListener() {} },
    clearInterval() {},
    clearTimeout() {},
    setInterval() { return 1; },
    setTimeout() { return 1; },
    confirm() { return false; }
  };

  let source = fs.readFileSync(APP_PATH, 'utf8')
    .replace(/^import[^\n]+\n/, 'const supabase = null; const isSupabaseConfigured = false;\n')
    .replace(/\nboot\(\);\s*$/, '\n');
  source += '\nglobalThis.__appTest = { app, baseProgress, render };\n';
  vm.runInNewContext(source, context, { filename: APP_PATH });
  return { ...context.__appTest, appElement, document, stored };
}

test('Check answer persists the selection and rerenders answer feedback', () => {
  const harness = loadAppForTest();
  const question = {
    id: 'question-1',
    type: 'single_choice',
    domainId: 'domain-1',
    prompt: 'Which option is correct?',
    options: [
      { key: 'a', text: 'Correct choice' },
      { key: 'b', text: 'Incorrect choice' }
    ],
    correct: ['a'],
    explanation: 'Option A is the expected answer.'
  };

  Object.assign(harness.app, {
    courses: [{ id: 'course-1', title: 'Test course', code: 'TEST' }],
    course: { id: 'course-1', title: 'Test course', code: 'TEST' },
    data: {
      metadata: {},
      domains: [{ id: 'domain-1', name: 'Test domain' }],
      questions: [question]
    },
    progress: harness.baseProgress(),
    view: 'practice',
    practiceFilter: 'all',
    pending: new Set()
  });

  harness.render();
  const correctOption = harness.document.querySelectorAll('[data-option]')
    .find((button) => button.dataset.option === 'a');
  assert.ok(correctOption, 'the correct answer option should be rendered');
  correctOption.click();
  assert.match(harness.appElement.innerHTML, />Check answer<\/button>/);

  const checkAnswer = harness.document.querySelector('[data-submit]');
  assert.ok(checkAnswer, 'the enabled Check answer button should be rendered');
  assert.doesNotThrow(() => checkAnswer.click());

  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.app.progress.answers['question-1'])),
    { selected: ['a'], correct: true, at: harness.app.progress.answers['question-1'].at }
  );
  assert.match(harness.appElement.innerHTML, /class="status good">Correct<\/b>/);
  assert.match(harness.appElement.innerHTML, /Option A is the expected answer\./);
  assert.match(harness.appElement.innerHTML, />Next question<\/button>/);
  assert.doesNotMatch(harness.appElement.innerHTML, />Check answer<\/button>/);

  const saved = JSON.parse(harness.stored.get('certlab:progress:course-1'));
  assert.equal(saved.answers['question-1'].correct, true);
  assert.deepEqual(Array.from(saved.answers['question-1'].selected), ['a']);
});

test('question content is escaped before it reaches the HTML renderer', () => {
  const harness = loadAppForTest();
  const attack = '<img src=x onerror="globalThis.pwned=true">';
  Object.assign(harness.app, {
    courses: [{ id: 'course-1', title: attack, code: 'TEST' }],
    course: { id: 'course-1', title: attack, code: 'TEST' },
    data: {
      metadata: {},
      domains: [{ id: 'domain-1', name: attack }],
      questions: [{
        id: 'question-1', type: 'single_choice', domainId: 'domain-1',
        prompt: attack, options: [{ key: 'a', text: attack }], correct: ['a'],
        explanation: attack
      }]
    },
    progress: harness.baseProgress(), view: 'practice', practiceFilter: 'all',
    pending: new Set()
  });

  harness.render();
  assert.doesNotMatch(harness.appElement.innerHTML, /<img\b/i);
  assert.match(harness.appElement.innerHTML, /&lt;img src=x onerror=&quot;/i);
});
