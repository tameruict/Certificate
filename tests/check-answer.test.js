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
    documentElement: { setAttribute() {} },
    querySelector(selector) {
      if (selector === '#app') return appElement;
      return elementsFor(selector)[0] || null;
    },
    querySelectorAll: elementsFor
  };
  return { appElement, document };
}

function loadAppForTest(customSupabase = null) {
  const { appElement, document } = createDom();
  const stored = new Map();
  const context = {
    console,
    document,
    FormData: class {
      constructor(form) { this._map = new Map(Object.entries(form?.values || {})); }
      get(key) { return this._map.has(key) ? this._map.get(key) : null; }
    },
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, value); }
    },
    window: { addEventListener() {} },
    supabaseStub: customSupabase,
    isSupabaseConfiguredStub: Boolean(customSupabase),
    clearInterval() {},
    clearTimeout() {},
    setInterval() { return 1; },
    setTimeout() { return 1; },
    confirm() { return false; }
  };

  const stubs = [
    'const supabase = globalThis.supabaseStub; const isSupabaseConfigured = globalThis.isSupabaseConfiguredStub;',
    'const fetchArticleList = async () => ({ articles: [], error: null });',
    'const fetchArticleDetail = async () => ({ article: null, error: null });',
    'const fetchArticleProgress = async () => ({});',
    'const saveArticleProgress = async () => ({ error: null });',
    'const articlesImageBase = () => "";',
    'const renderMarkdownWithToc = (md = "") => ({ html: String(md), headings: [] });',
    'const filterArticles = (a = []) => a;',
    'const sortArticles = (a = []) => a;',
    'const getPlatforms = () => [];',
    'const getCategories = () => [];',
    'const rewriteImageUrls = (md = "") => String(md);',
    'const coverImageUrl = (u = null) => u;',
    'const getStoredLanguage = () => "vi";',
    'const setStoredLanguage = () => {};'
  ].join('\n');

  let source = fs.readFileSync(APP_PATH, 'utf8')
    .replace(/^(?:import[^\n]+\n)+/, `${stubs}\n`)
    .replace(/\nboot\(\);\s*$/, '\n');
  source += '\nglobalThis.__appTest = { app, baseProgress, render, renderAuth, submitAuth, generateRecoveryCode, normalizeRecoveryCode, rotateRecoveryCode, loadCloudCourseSummaries, restoreCloudProgress, courseProgressSummary, recordExamAttempt };\n';
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
  assert.equal(saved.streak, 1);
  assert.equal(saved.bestStreak, 1);
  assert.match(harness.appElement.innerHTML, /1 streak/);
  assert.deepEqual(Array.from(saved.answers['question-1'].selected), ['a']);
});

test('Timed mock completion renders per-domain score breakdown', () => {
  const harness = loadAppForTest();
  const questions = [
    { id: 'q-1', type: 'single_choice', domainId: 'domain-1', prompt: 'Q1?', options: [{ key: 'a', text: 'A1' }, { key: 'b', text: 'B1' }], correct: ['a'], explanation: 'E1' },
    { id: 'q-2', type: 'single_choice', domainId: 'domain-2', prompt: 'Q2?', options: [{ key: 'a', text: 'A2' }, { key: 'b', text: 'B2' }], correct: ['b'], explanation: 'E2' }
  ];
  const progress = harness.baseProgress();
  progress.answers['q-1'] = { selected: ['a'], correct: true, at: 1 };
  progress.answers['q-2'] = { selected: ['a'], correct: false, at: 2 };

  Object.assign(harness.app, {
    courses: [{ id: 'course-1', title: 'Test course', code: 'TEST' }],
    course: { id: 'course-1', title: 'Test course', code: 'TEST' },
    data: {
      metadata: {},
      domains: [
        { id: 'domain-1', name: 'Architecture', weight: 50 },
        { id: 'domain-2', name: 'Operations', weight: 50 }
      ],
      questions
    },
    progress,
    view: 'mock',
    mock: { questions, index: 0, endAt: Date.now() - 1000, finished: true, paused: false, remainingWhenPaused: null }
  });

  harness.render();
  assert.match(harness.appElement.innerHTML, /Domain breakdown/);
  assert.match(harness.appElement.innerHTML, /1\/1 correct \(100%\)/);
  assert.match(harness.appElement.innerHTML, /0\/1 correct \(0%\)/);
});

test('CBT question navigator palette jumps directly to selected question index', () => {
  const harness = loadAppForTest();
  const questions = [
    { id: 'q-1', type: 'single_choice', domainId: 'domain-1', prompt: 'Question 1?', options: [{ key: 'a', text: 'A1' }, { key: 'b', text: 'B1' }], correct: ['a'], explanation: 'Exp 1' },
    { id: 'q-2', type: 'single_choice', domainId: 'domain-1', prompt: 'Question 2?', options: [{ key: 'a', text: 'A2' }, { key: 'b', text: 'B2' }], correct: ['b'], explanation: 'Exp 2' }
  ];

  Object.assign(harness.app, {
    courses: [{ id: 'course-1', title: 'Test course', code: 'TEST' }],
    course: { id: 'course-1', title: 'Test course', code: 'TEST' },
    data: { metadata: {}, domains: [{ id: 'domain-1', name: 'Domain 1' }], questions },
    progress: harness.baseProgress(),
    view: 'practice',
    practiceFilter: 'all',
    questionIndex: 0,
    pending: new Set()
  });

  harness.render();
  const jumpButtons = harness.document.querySelectorAll('[data-jump-index]');
  assert.equal(jumpButtons.length, 2);
  jumpButtons[1].click();
  assert.equal(harness.app.questionIndex, 1);
  assert.match(harness.appElement.innerHTML, /Question 2\?/);
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

test('Password recovery flow validates recovery code, rotates recovery key in workspace, and supports email link fallback even with autofilled password', async () => {
  const rpcCalls = [];
  const resetEmails = [];
  const customSupabase = {
    auth: {
      onAuthStateChange() {},
      async resetPasswordForEmail(email) {
        resetEmails.push(email);
        return { data: {}, error: null };
      }
    },
    async rpc(fn, args) {
      rpcCalls.push({ fn, args });
      return { data: { ok: true }, error: null };
    }
  };
  const harness = loadAppForTest(customSupabase);

  const generated = harness.generateRecoveryCode();
  assert.match(generated, /^CLAB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(harness.normalizeRecoveryCode(generated).length, 16);

  harness.app.auth.mode = 'login';
  harness.renderAuth();
  assert.match(harness.appElement.innerHTML, /Forgot password\? Recover account/);

  harness.app.auth.mode = 'forgot';
  harness.renderAuth();
  assert.match(harness.appElement.innerHTML, /Recover your password/);

  await harness.submitAuth({
    values: {
      username: 'study_user',
      recoveryCode: 'short',
      password: 'StrongPassword!123',
      confirm: 'StrongPassword!123'
    }
  });
  assert.equal(rpcCalls.length, 0);
  assert.match(harness.appElement.innerHTML, /Enter a valid 12–64 character recovery code/);

  await harness.submitAuth({
    values: {
      username: 'study_user',
      recoveryCode: generated,
      password: 'StrongPassword!123',
      confirm: 'StrongPassword!123'
    }
  });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'reset_password_with_recovery_code');
  assert.equal(rpcCalls[0].args.p_username, 'study_user');
  assert.equal(rpcCalls[0].args.p_recovery_code, harness.normalizeRecoveryCode(generated));
  assert.equal(harness.app.auth.mode, 'login');
  assert.match(harness.appElement.innerHTML, /Password reset complete/);

  harness.app.auth.mode = 'forgot';
  await harness.submitAuth({
    values: {
      recoveryEmail: 'learner@example.com',
      password: 'AutofilledPassword!123'
    }
  });
  assert.deepEqual(resetEmails, ['learner@example.com']);
  assert.match(harness.appElement.innerHTML, /password reset link has been sent/);

  Object.assign(harness.app, {
    auth: { user: { id: '00000000-0000-0000-0000-000000000001' }, username: 'study_user', mode: 'login', recoveryEmail: 'learner@example.com' },
    courses: [{ id: 'course-1', title: 'Test course', code: 'TEST' }],
    course: { id: 'course-1', title: 'Test course', code: 'TEST' },
    data: { metadata: {}, domains: [{ id: 'd-1', name: 'D1' }], questions: [{ id: 'q-1', type: 'single_choice', domainId: 'd-1', prompt: 'Q1?', options: [{ key: 'a', text: 'A1' }], correct: ['a'], explanation: 'E1' }] },
    progress: harness.baseProgress(),
    view: 'dashboard'
  });
  const rotated = await harness.rotateRecoveryCode();
  assert.match(rotated, /^CLAB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[1].fn, 'set_user_recovery_code');
  assert.equal(rpcCalls[1].args.p_recovery_code, harness.normalizeRecoveryCode(rotated));
  assert.match(harness.appElement.innerHTML, /Save your recovery code:/);
});

test('Cloud course summaries and normalized question progress hydrate multi-course overview and course state', async () => {
  const customSupabase = {
    auth: { onAuthStateChange() {} },
    from(table) {
      if (table === 'user_course_progress') {
        return {
          select() {
            return {
              async eq() {
                return {
                  data: [
                    {
                      course_id: 'course-2',
                      answered_count: 15,
                      correct_count: 12,
                      bookmarked_count: 1,
                      streak: 4,
                      best_streak: 7,
                      content_version: '2.1.0',
                      last_activity_at: '2026-11-05T12:00:00.000Z'
                    }
                  ],
                  error: null
                };
              }
            };
          }
        };
      }
      if (table === 'user_data_archive') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return { data: null, error: null };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'user_question_progress') {
        return {
          select() {
            return {
              eq() {
                return {
                  async eq() {
                    return {
                      data: [
                        {
                          question_id: 'q-1',
                          selected_options: ['a'],
                          is_correct: true,
                          bookmarked: true,
                          answered_at: '2026-11-05T12:00:00.000Z',
                          updated_at: '2026-11-05T12:00:00.000Z'
                        }
                      ],
                      error: null
                    };
                  }
                };
              }
            };
          }
        };
      }
      return {};
    }
  };

  const harness = loadAppForTest(customSupabase);
  Object.assign(harness.app, {
    auth: { user: { id: '00000000-0000-0000-0000-000000000001' }, username: 'study_user', mode: 'login' },
    courses: [
      { id: 'course-1', title: 'Course 1', code: 'C1', questionCount: 10 },
      { id: 'course-2', title: 'Course 2', code: 'C2', questionCount: 25 }
    ],
    course: { id: 'course-1', title: 'Course 1', code: 'C1', questionCount: 10 },
    data: {
      metadata: {},
      domains: [{ id: 'd-1', name: 'Domain 1' }],
      questions: [{ id: 'q-1', type: 'single_choice', domainId: 'd-1', prompt: 'Q1?', options: [{ key: 'a', text: 'A1' }], correct: ['a'], explanation: 'E1' }]
    },
    progress: harness.baseProgress(),
    view: 'overview'
  });

  await harness.loadCloudCourseSummaries();
  assert.deepEqual(JSON.parse(JSON.stringify(harness.courseProgressSummary('course-2'))), { answeredCount: 15, correctCount: 12 });

  await harness.restoreCloudProgress();
  assert.equal(harness.app.progress.answers['q-1']?.correct, true);
  assert.equal(harness.app.progress.bookmarks['q-1'], true);

  harness.render();
  assert.match(harness.appElement.innerHTML, /15\/25 answered/);
  assert.match(harness.appElement.innerHTML, /80% accuracy/);
});

test('recordExamAttempt persists completed timed mock exam metrics to user_exam_attempts Once and renders recent mock attempts', async () => {
  const inserted = [];
  const customSupabase = {
    auth: { onAuthStateChange() {} },
    from(table) {
      return {
        async insert(row) {
          inserted.push({ table, row });
          return { error: null };
        }
      };
    }
  };
  const harness = loadAppForTest(customSupabase);
  const questions = [
    { id: 'q-1', type: 'single_choice', domainId: 'd-1', prompt: 'Q1?', options: [{ key: 'a', text: 'A1' }], correct: ['a'], explanation: 'E1' },
    { id: 'q-2', type: 'single_choice', domainId: 'd-2', prompt: 'Q2?', options: [{ key: 'a', text: 'A2' }], correct: ['b'], explanation: 'E2' }
  ];
  const progress = harness.baseProgress();
  progress.answers['q-1'] = { selected: ['a'], correct: true, at: 1 };
  progress.answers['q-2'] = { selected: ['a'], correct: false, at: 2 };

  Object.assign(harness.app, {
    auth: { user: { id: '00000000-0000-0000-0000-000000000001' }, username: 'study_user', mode: 'login' },
    courses: [{ id: 'course-1', title: 'Test course', code: 'TEST' }],
    course: { id: 'course-1', title: 'Test course', code: 'TEST' },
    data: {
      metadata: {},
      domains: [{ id: 'd-1', name: 'D1' }, { id: 'd-2', name: 'D2' }],
      questions
    },
    progress,
    view: 'mock',
    mock: {
      questions,
      index: 0,
      startedAt: Date.now() - 45000,
      endAt: Date.now() - 1000,
      finished: true,
      paused: false,
      remainingWhenPaused: null,
      archived: false
    }
  });

  await harness.recordExamAttempt();
  await harness.recordExamAttempt();
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, 'user_exam_attempts');
  assert.equal(inserted[0].row.course_id, 'course-1');
  assert.equal(inserted[0].row.total_questions, 2);
  assert.equal(inserted[0].row.answered_count, 2);
  assert.equal(inserted[0].row.correct_count, 1);
  assert.equal(inserted[0].row.score_percent, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(inserted[0].row.domain_breakdown)), {
    'd-1': { total: 1, correct: 1, percent: 100 },
    'd-2': { total: 1, correct: 0, percent: 0 }
  });
  harness.render();
  assert.match(harness.appElement.innerHTML, /Recent mock attempts/);
  assert.match(harness.appElement.innerHTML, /50% score/);
});

test('Personal profile links and Chinese Guofeng author modal open and close cleanly', () => {
  const harness = loadAppForTest();
  Object.assign(harness.app, {
    auth: { user: { id: 'u1' }, username: 'tameruict', mode: 'login' },
    courses: [{ id: 'course-1', title: 'Test course', code: 'TEST' }],
    course: { id: 'course-1', title: 'Test course', code: 'TEST' },
    data: {
      metadata: {},
      domains: [{ id: 'd-1', name: 'D1' }],
      questions: [{ id: 'q-1', type: 'single_choice', domainId: 'd-1', prompt: 'Q1?', options: [{ key: 'a', text: 'A1' }], correct: ['a'], explanation: 'E1' }]
    },
    progress: harness.baseProgress(),
    view: 'dashboard',
    authorModalOpen: false
  });

  harness.render();
  assert.match(harness.appElement.innerHTML, /https:\/\/github\.com\/tameruict/);
  assert.match(harness.appElement.innerHTML, /https:\/\/www\.facebook\.com\/profile\.php\?id=61576242522472/);
  assert.doesNotMatch(harness.appElement.innerHTML, /author-modal-card/);

  const openButtons = harness.document.querySelectorAll('[data-action]').filter(el => el.dataset.action === 'open-author-modal');
  assert.ok(openButtons.length >= 1, 'should render open-author-modal triggers');
  openButtons[0].click();

  assert.equal(harness.app.authorModalOpen, true);
  assert.match(harness.appElement.innerHTML, /author-modal-card/);
  assert.match(harness.appElement.innerHTML, /著者档案/);

  const closeButtons = harness.document.querySelectorAll('[data-action]').filter(el => el.dataset.action === 'close-author-modal');
  assert.ok(closeButtons.length >= 1, 'should render close-author-modal triggers');
  closeButtons[0].click();

  assert.equal(harness.app.authorModalOpen, false);
  assert.doesNotMatch(harness.appElement.innerHTML, /author-modal-card/);
});


