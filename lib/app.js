import { supabase, isSupabaseConfigured } from './supabase.js';
﻿const $ = (selector, root = document) => root.querySelector(selector);
const app = {
  catalog: null, courses: [], course: null, data: null, progress: null,
  view: 'dashboard', questionIndex: 0, flashIndex: 0, flashBack: false,
  practiceFilter: 'all', practiceDiffFilter: 'all', practiceTagFilter: 'all',
  mock: null, timer: null, pending: new Set(), catalogSearch: '',
  auth: { user: null, username: '', mode: 'login' }, authReady: false
};

const DEFAULT_PATHS = (id) => ({
  course: `content/${id}/course.json`,
  objectives: `content/${id}/objectives.json`,
  questions: `content/${id}/questions.v2.json`
});
const safeArray = (value) => Array.isArray(value) ? value : [];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const slug = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Safe markdown-lite: bold, italic, inline-code, bullet lists only. esc() runs first so
// user content is safe; the only HTML tags added are known-safe structural ones.
function mdLite(raw) {
  if (!raw) return '';
  const lines = String(raw).split('\n');
  let out = '', inList = false;
  for (const line of lines) {
    const t = line.trim();
    const isBullet = /^[-*•]\s/.test(t);
    const content = esc(isBullet ? t.replace(/^[-*•]\s+/, '') : t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    if (isBullet) {
      if (!inList) { out += '<ul class="notes-list">'; inList = true; }
      out += `<li>${content}</li>`;
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      if (content) out += `<p>${content}</p>`;
    }
  }
  if (inList) out += '</ul>';
  return out;
}
const courseKey = (id) => `certlab:progress:${id}`;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PASSWORD_RULES = [
  { test: value => value.length >= 12, label: 'at least 12 characters' },
  { test: value => /[a-z]/.test(value), label: 'a lowercase letter' },
  { test: value => /[A-Z]/.test(value), label: 'an uppercase letter' },
  { test: value => /\d/.test(value), label: 'a number' },
  { test: value => /[^A-Za-z0-9]/.test(value), label: 'a symbol' }
];
// Supabase Auth requires a syntactically valid email domain even though this
// username-only flow never uses the synthetic address for mail delivery.
const usernameEmail = username => `${username}@users.certlab.app`;
function normalizeUsername(value) { return String(value || '').trim().toLowerCase(); }
function passwordIssues(value) { return PASSWORD_RULES.filter(rule => !rule.test(value)).map(rule => rule.label); }
function friendlyAuthError(error) {
  const message = String(error?.message || error || 'Authentication failed.');
  if (/invalid login credentials/i.test(message)) return 'Username or password is incorrect.';
  if (/email not confirmed/i.test(message)) return 'This account needs confirmation. Disable email confirmations for synthetic usernames or provision confirmed users in Supabase Auth.';
  if (/email.*rate limit|rate limit.*email/i.test(message)) return 'Supabase is rate-limiting signup emails. Disable Confirm email in Authentication > Providers > Email, wait for the cooldown, then try again.';
  if (/already registered|already been registered/i.test(message)) return 'That username is already registered.';
  if (/password/i.test(message) && /weak|short|strength|least/i.test(message)) return 'Choose a stronger password: 12+ characters with upper/lowercase, a number, and a symbol.';
  return message;
}
function renderAuth(message = '') {
  const signup = app.auth.mode === 'signup';
  const setup = !isSupabaseConfigured;
  const notice = message ? `<div class="auth-notice ${message.kind === 'success' ? 'good' : 'bad'}" role="alert">${esc(message.text || message)}</div>` : '';
  $('#app').innerHTML = `<main class="auth-shell"><section class="auth-card card" aria-labelledby="auth-title"><div class="brand auth-brand"><div class="brand-logo">CL</div><div><strong>CertLab Study</strong><small>Private certification workspace</small></div></div><div class="eyebrow">Secure sign-in</div><h1 id="auth-title">${signup ? 'Create your study account' : 'Welcome back'}</h1><p class="subtle">Use a username and a strong password. Your progress is archived to your Supabase account.</p>${setup ? `<div class="auth-notice bad"><b>Supabase is not configured yet.</b><p>Set the publishable/anon key in <code>config.js</code> and run <code>supabase/001_user_auth_and_archive.sql</code> in your project.</p></div>` : ''}${notice}<form id="auth-form" class="auth-form" novalidate><label class="field">Username<input id="auth-username" name="username" autocomplete="username" minlength="3" maxlength="32" pattern="[a-z0-9][a-z0-9._-]{2,31}" required placeholder="e.g. study_user"></label><label class="field">Password<input id="auth-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="12" required placeholder="12+ characters"></label>${signup ? `<label class="field">Confirm password<input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required></label>` : ''}<p class="password-help">${PASSWORD_RULES.map(rule => `• ${esc(rule.label)}`).join('<br>')}</p><button class="btn primary auth-submit" type="submit" ${setup ? 'disabled' : ''}>${signup ? 'Create account' : 'Sign in'}</button></form><button class="btn auth-switch" type="button" data-auth-mode="${signup ? 'login' : 'signup'}">${signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></main>`;
  bindAuthEvents();
}
function bindAuthEvents() {
  $('#auth-form')?.addEventListener('submit', event => { event.preventDefault(); void submitAuth(event.currentTarget); });
  $('[data-auth-mode]')?.addEventListener('click', () => { app.auth.mode = $('[data-auth-mode]').dataset.authMode; renderAuth(); });
}
async function ensureProfile(username) {
  if (!supabase || !app.auth.user || !username) return;
  const { error } = await supabase.from('user_profiles').upsert({ user_id: app.auth.user.id, username, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  app.auth.username = username;
}
async function loadProfile() {
  if (!supabase || !app.auth.user) return;
  const { data, error } = await supabase.from('user_profiles').select('username').eq('user_id', app.auth.user.id).maybeSingle();
  if (error) { if (!/relation .* does not exist|schema cache/i.test(error.message || '')) throw error; return; }
  app.auth.username = data?.username || app.auth.user.user_metadata?.username || '';
}
async function submitAuth(form) {
  if (!supabase || !isSupabaseConfigured) return;
  const values = new FormData(form); const username = normalizeUsername(values.get('username')); const password = String(values.get('password') || '');
  const issues = []; if (!USERNAME_PATTERN.test(username)) issues.push('Username must be 3–32 characters using lowercase letters, numbers, dot, underscore, or hyphen.');
  const passwordProblems = passwordIssues(password); if (passwordProblems.length) issues.push(`Password needs ${passwordProblems.join(', ')}.`);
  if (app.auth.mode === 'signup' && password !== String(values.get('confirm') || '')) issues.push('Passwords do not match.');
  if (issues.length) { renderAuth({ kind: 'error', text: issues.join(' ') }); return; }
  const button = $('.auth-submit'); if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try {
    if (app.auth.mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: usernameEmail(username), password, options: { data: { username } } });
      if (error) throw error;
      if (!data.session) { renderAuth({ kind: 'success', text: 'Account created. If email confirmations are enabled, an administrator must confirm this username before sign-in.' }); return; }
      await activateSession(data.session, username);
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) throw error;
      await activateSession(data.session, username);
    }
    await startWorkspace();
  } catch (error) { renderAuth({ kind: 'error', text: friendlyAuthError(error) }); }
}
async function activateSession(session, fallbackUsername = '') {
  app.auth.user = session?.user || null; app.auth.username = fallbackUsername || app.auth.user?.user_metadata?.username || ''; app.authReady = Boolean(app.auth.user);
  if (!app.auth.user) return;
  try { if (app.auth.username) await ensureProfile(app.auth.username); else await loadProfile(); } catch (error) {
    if (!/relation .* does not exist|schema cache/i.test(error.message || '')) throw error;
  }
}
async function startWorkspace() { if (!app.auth.user) return; await loadCatalog(); const route = parseRoute(); await go(route, !location.hash); }
async function logout() {
  if (supabase) await supabase.auth.signOut(); clearInterval(app.timer); app.auth = { user: null, username: '', mode: 'login' }; app.authReady = false; app.course = null; app.data = null; app.progress = null; renderAuth();
}
async function restoreCloudProgress() {
  if (!supabase || !app.auth.user || !app.course) return;
  const { data, error } = await supabase.from('user_data_archive').select('payload,updated_at').eq('user_id', app.auth.user.id).eq('course_id', app.course.id).maybeSingle();
  if (error) { if (!/relation .* does not exist|schema cache/i.test(error.message || '')) toast(`Cloud archive unavailable: ${error.message}`); return; }
  const cloudProgress = data?.payload; const localAt = Date.parse(app.progress.updatedAt || '') || 0; const cloudAt = Date.parse(data?.updated_at || cloudProgress?.updatedAt || '') || 0;
  if (cloudProgress && cloudAt > localAt) { app.progress = { ...baseProgress(), ...cloudProgress, answers: cloudProgress.answers || {}, bookmarks: cloudProgress.bookmarks || {} }; localStorage.setItem(courseKey(app.course.id), JSON.stringify(app.progress)); }
  else if (cloudProgress && localAt > cloudAt) void archiveProgress();
}
async function archiveProgress() {
  if (!supabase || !app.auth.user || !app.course || !app.progress) return;
  // Stamp the content version so we can detect bank updates later.
  const bankVersion = app.course._manifest?.question_bank?.content_version ?? null;
  if (bankVersion && app.progress.contentVersion !== bankVersion) app.progress.contentVersion = bankVersion;
  const updatedAt = app.progress.updatedAt || new Date().toISOString();
  // Warn when the payload approaches the 256 KB database constraint.
  const payloadJson = JSON.stringify(app.progress);
  if (payloadJson.length > 230000) toast(`Progress archive is large (${Math.round(payloadJson.length/1024)} KB). Consider resetting old courses to free space.`);
  if (payloadJson.length > 262144) { toast('Progress archive is too large to sync. Reset course progress to re-enable cloud sync.'); return; }
  const { error } = await supabase.from('user_data_archive').upsert({ user_id: app.auth.user.id, course_id: app.course.id, payload: app.progress, updated_at: updatedAt }, { onConflict: 'user_id,course_id' });
  if (error && !/relation .* does not exist|schema cache/i.test(error.message || '')) toast(`Cloud archive failed: ${error.message}`);
}

function toast(message) {
  let node = $('#toast');
  if (!node) { node = document.createElement('div'); node.id = 'toast'; node.className = 'toast'; document.body.append(node); }
  node.textContent = message; node.classList.remove('hidden'); clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.add('hidden'), 2600);
}
function fetchJson(path) {
  if (!path) return Promise.resolve(null);
  return fetch(path, { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  });
}
function pathValue(source, key) {
  return source?.paths?.[key] || source?.bundle?.[key] || source?.files?.[key] ||
    source?.[`${key}Path`] || source?.[`${key}_path`] || source?.[`${key}Url`] || source?.[`${key}_url`] || null;
}
function contentPath(path, parentPath = null) {
  if (!path) return null;
  const value = String(path);
  if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('/') || value.startsWith('content/')) return value;
  if (parentPath && parentPath.includes('/')) return `${parentPath.slice(0, parentPath.lastIndexOf('/') + 1)}${value}`;
  return `content/${value}`;
}
function bundlePaths(course, manifest, manifestPath = null) {
  const coursePath = contentPath(pathValue(course, 'course') || (typeof course.bundle === 'string' ? course.bundle : null) || DEFAULT_PATHS(course.id).course);
  const metadataQuestionPath = manifest?.question_bank?.path || manifest?.questionBank?.path;
  return {
    course: coursePath,
    objectives: contentPath(pathValue(course, 'objectives') || pathValue(manifest, 'objectives'), manifestPath || coursePath),
    questions: contentPath(pathValue(course, 'questions') || pathValue(manifest, 'questions') || metadataQuestionPath || DEFAULT_PATHS(course.id).questions, manifestPath || coursePath)
  };
}
function unwrap(value, keys) { for (const key of keys) if (Array.isArray(value?.[key])) return value[key]; return Array.isArray(value) ? value : []; }
function optionKey(option, index) { return String(option?.id ?? option?.key ?? option?.value ?? index); }
function normalizeQuestion(raw, index) {
  const rawOptions = safeArray(raw?.options ?? raw?.o ?? raw?.choices ?? raw?.answers);
  const options = rawOptions.map((option, optionIndex) => ({
    key: optionKey(option, optionIndex),
    text: typeof option === 'string' ? option : String(option?.text ?? option?.label ?? option?.content ?? option?.value ?? '')
  }));
  const answerRaw = raw?.correctOptionIds ?? raw?.correct_option_ids ?? raw?.correctOptions ?? raw?.correctAnswers ?? raw?.correctAnswer ?? raw?.correct ?? raw?.answer ?? raw?.a;
  const answers = safeArray(answerRaw ?? []).flatMap(value => {
    const candidate = typeof value === 'object' && value !== null ? (value.id ?? value.key ?? value.value ?? value.index) : value;
    if (typeof candidate === 'number' && options[candidate]) return [options[candidate].key];
    const matched = options.find(option => option.key === String(candidate));
    return matched ? [matched.key] : [];
  });
  return {
    id: String(raw?.id ?? raw?.questionId ?? raw?.question_id ?? `question-${index + 1}`),
    prompt: String(raw?.prompt ?? raw?.question ?? raw?.q ?? raw?.text ?? ''),
    domainId: String(raw?.domainId ?? raw?.domain_id ?? raw?.domain ?? raw?.d ?? 'general'),
    objectiveId: raw?.objectiveId ?? raw?.objective_id ?? raw?.objective ?? null,
    type: ['multiple_choice', 'multiple', 'multi_select', 'multiple_select'].includes(raw?.type) || answers.length > 1 ? 'multiple_choice' : 'single_choice',
    options, correct: [...new Set(answers)],
    explanation: String(raw?.explanation ?? raw?.rationale ?? raw?.e ?? ''),
    difficulty: raw?.difficulty ?? null,
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    sourceIndex: index
  };
}
function domainFrom(raw, index) {
  return {
    id: String(raw?.id ?? raw?.domainId ?? raw?.domain_id ?? raw?.code ?? index + 1),
    name: String(raw?.name ?? raw?.title ?? raw?.domain ?? `Domain ${index + 1}`),
    description: String(raw?.description ?? raw?.summary ?? raw?.notes ?? ''),
    weight: raw?.weight ?? raw?.examWeight ?? raw?.percentage ?? null,
    objectives: unwrap(raw, ['objectives', 'items', 'topics'])
  };
}
function normalizeData(course, parts) {
  const metadata = parts.course?.course ?? parts.course?.metadata ?? parts.course ?? course;
  const objectivesRaw = unwrap(parts.objectives, ['domains', 'objectives', 'items']);
  const metadataDomains = unwrap(metadata, ['domains', 'objectives']);
  const domains = (objectivesRaw.length ? objectivesRaw : metadataDomains).map(domainFrom);
  const questionList = unwrap(parts.questions, ['records', 'questions', 'items', 'data']).map(normalizeQuestion).filter(question => question.prompt && question.options.length);
  const knownDomains = new Map(domains.map(domain => [domain.id, domain]));
  questionList.forEach(question => { if (!knownDomains.has(question.domainId)) knownDomains.set(question.domainId, domainFrom({ id: question.domainId, name: question.domainId }, knownDomains.size)); });
  return { metadata, domains: [...knownDomains.values()], questions: questionList };
}
function baseProgress() { return { version: 2, answers: {}, bookmarks: {}, streak: 0, migratedLegacy: false, updatedAt: null, contentVersion: null }; }
function loadProgress(id) {
  try { const parsed = JSON.parse(localStorage.getItem(courseKey(id))); return parsed && typeof parsed === 'object' ? { ...baseProgress(), ...parsed, answers: parsed.answers || {}, bookmarks: parsed.bookmarks || {} } : baseProgress(); }
  catch { return baseProgress(); }
}
function migrateLegacyProgress() {
  if (app.progress.migratedLegacy || app.course.id !== 'comptia-security-plus-sy0-701') return;
  try {
    const legacy = JSON.parse(localStorage.getItem('secplus-progress'));
    if (!legacy || typeof legacy !== 'object') return;
    const questions = app.data.questions;
    Object.entries(legacy.answers || {}).forEach(([legacyId, correct]) => {
      const index = Number(legacyId);
      const question = Number.isInteger(index) ? questions[index] : questions.find(item => item.id === legacyId);
      if (question && typeof correct === 'boolean' && !app.progress.answers[question.id]) {
        app.progress.answers[question.id] = { selected: [], correct, migrated: true, at: Date.now() };
      }
    });
    app.progress.streak = Number(legacy.streak) || app.progress.streak;
    app.progress.migratedLegacy = true; saveProgress(false);
  } catch { /* A malformed legacy record must never block the catalog. */ }
}
function saveProgress(shouldRender = true) {
  app.progress.updatedAt = new Date().toISOString();
  localStorage.setItem(courseKey(app.course.id), JSON.stringify(app.progress));
  void archiveProgress();
  if (shouldRender) render();
}
function answered() { return Object.keys(app.progress?.answers || {}).length; }
function correctCount() { return Object.values(app.progress?.answers || {}).filter(result => result.correct).length; }
function percent(value, total) { return total ? Math.round(value / total * 100) : 0; }
function domainQuestions(domainId) { return app.data.questions.filter(question => String(question.domainId) === String(domainId)); }
function domainFor(id) { return app.data.domains.find(domain => String(domain.id) === String(id)); }
function domainName(id) { return domainFor(id)?.name || String(id); }
function isCorrect(question, selected) { return selected.length === question.correct.length && selected.every(key => question.correct.includes(key)); }
function keyLabel(index) { return String.fromCharCode(65 + index); }

async function loadCatalog() {
  const raw = await fetchJson('content/catalog.json');
  const listedCourses = unwrap(raw, ['courses', 'items', 'catalog']).map((course, index) => ({
    ...course, id: String(course.id ?? course.slug ?? course.courseId ?? `course-${index + 1}`),
    title: String(course.title ?? course.name ?? course.courseName ?? `Course ${index + 1}`),
    code: String(course.code ?? course.examCode ?? course.exam_code ?? ''),
    description: String(course.description ?? course.summary ?? ''),
    accent: course.accent ?? course.color ?? null
  }));
  const allCourses = await Promise.all(listedCourses.map(async course => {
    const bundle = bundlePaths(course, null).course;
    try {
      const manifest = await fetchJson(bundle);
      const merged = { ...course, ...(manifest?.course ?? manifest ?? {}), id: course.id, bundle: course.bundle, _manifest: manifest, _bundlePath: bundle };
      merged.title = String(merged.title ?? merged.name ?? course.title);
      merged.code = String(merged.code || merged.examCode || merged.exam_code || course.code || '');
      merged.description = String(merged.description || merged.summary || course.description || '');
      merged.questionCount = merged.questionCount ?? merged.question_bank?.record_count ?? merged.questionBank?.recordCount;
      merged.category = String(merged.category || course.category || '');
      return merged;
    } catch (error) { return { ...course, _bundlePath: bundle, _bundleError: error.message }; }
  }));
  const courses = allCourses.filter(course => course.published !== false && course.status !== 'needs_review' && course.availability?.application !== 'excluded');
  if (!courses.length) throw new Error('The catalog does not contain any published, application-available courses.');
  app.catalog = raw; app.courses = courses;
}
async function loadCourse(id) {
  const course = app.courses.find(item => item.id === id);
  if (!course) throw new Error(`Unknown course: ${id}`);
  clearInterval(app.timer); app.timer = null; app.mock = null;
  const initialPaths = bundlePaths(course, null);
  let manifest = course._manifest || course;
  try { if (!course._manifest) manifest = await fetchJson(initialPaths.course); } catch (error) {
    if (pathValue(course, 'course')) throw error;
  }
  const paths = bundlePaths(course, manifest, initialPaths.course);
  const [objectives, questions] = await Promise.all([paths.objectives ? fetchJson(paths.objectives) : Promise.resolve(null), fetchJson(paths.questions)]);
  app.course = { ...course, ...(manifest?.course ?? manifest ?? {}) };
  app.course.id = course.id; app.course.title = app.course.title ?? course.title;
  app.course.code = app.course.code || app.course.examCode || app.course.exam_code || course.code;
  app.course.description = app.course.description || app.course.summary || course.description;
  app.data = normalizeData(app.course, { course: manifest, objectives, questions });
  if (!app.data.questions.length) throw new Error(`No usable questions were found for ${app.course.title}.`);
  app.progress = loadProgress(app.course.id); migrateLegacyProgress();
  await restoreCloudProgress();
  app.questionIndex = 0; app.flashIndex = 0; app.flashBack = false; app.practiceFilter = 'all';
}
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'course') return { courseId: parts[1], view: parts[2] || 'dashboard' };
  return { courseId: app.courses[0]?.id, view: 'dashboard' };
}
async function go(route, replace = false) {
  const courseId = route.courseId || app.course?.id || app.courses[0].id;
  const view = ['dashboard','notes','practice','flashcards','mock','review','overview'].includes(route.view) ? route.view : 'dashboard';
  const target = `#course/${encodeURIComponent(courseId)}/${view}`;
  if (location.hash !== target) { if (replace) location.replace(target); else location.hash = target; return; }
  if (!app.course || app.course.id !== courseId) await loadCourse(courseId);
  app.view = view; render();
}
function navButton(view, icon, label) { return `<button class="${app.view === view ? 'active' : ''}" data-view="${view}">${icon} ${esc(label)}</button>`; }
function buildCoursePickerOptions() {
  const groups = new Map();
  for (const course of app.courses) {
    const cat = course.category || '';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(course);
  }
  const option = course => `<option value="${esc(course.id)}" ${course.id === app.course.id ? 'selected' : ''}>${esc(course.title)}${course.code ? ` — ${esc(course.code)}` : ''}</option>`;
  if (groups.size === 1 && groups.has('')) return [...groups.get('')].map(option).join('');
  let out = '';
  for (const [cat, courses] of groups) {
    if (!cat) { out += courses.map(option).join(''); continue; }
    out += `<optgroup label="${esc(cat)}">${courses.map(option).join('')}</optgroup>`;
  }
  return out;
}
function layoutHtml(content) {
  const coursePickerOptions = buildCoursePickerOptions();
  const domains = app.data.domains.map(domain => `<button class="domain-link" data-domain="${esc(domain.id)}">${esc(domain.name)}</button>`).join('');
  return `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-logo">CL</div><div><strong>CertLab Study</strong><small>Certification workspace</small></div></div><label class="side-label" for="course-picker">Current course</label><select id="course-picker" class="course-select" aria-label="Select course">${coursePickerOptions}</select><nav class="nav" aria-label="Study views">${navButton('dashboard','⌂','Overview')}${navButton('notes','▤','Domain notes')}${navButton('practice','✓','Practice')}${navButton('flashcards','◇','Flashcards')}${navButton('mock','◷','Timed mock')}${navButton('review','↺','Review')}</nav><div class="side-label">Domains</div><div class="domain-links">${domains}</div><div class="side-foot">Signed in as <b>${esc(app.auth.username || 'study user')}</b>. Progress is saved locally and archived to Supabase.</div><button class="btn small logout-btn" data-action="logout">Sign out</button></aside><main id="main" class="main" tabindex="-1">${content}</main></div>`;
}
function topbar(title, detail = '') { return `<header class="topbar"><div><div class="eyebrow">${esc(app.course.code || 'Certification course')}</div><h1>${esc(title)}</h1>${detail ? `<p class="subtle">${esc(detail)}</p>` : ''}</div><div class="top-actions"><span class="pill">${esc(app.auth.username || 'Signed in')} · ${answered()} / ${app.data.questions.length} answered</span><button class="btn small" data-action="reset-progress">Reset progress</button></div></header>`; }
function statsHtml() { const total = app.data.questions.length, done = answered(), correct = correctCount(); return `<section class="grid stats"><article class="card stat"><div class="stat-icon">◌</div><div><small>Completion</small><b>${percent(done,total)}%</b></div></article><article class="card stat"><div class="stat-icon">✓</div><div><small>Correct</small><b>${correct}</b></div></article><article class="card stat"><div class="stat-icon">!</div><div><small>To review</small><b>${done-correct}</b></div></article><article class="card stat"><div class="stat-icon">↗</div><div><small>Accuracy</small><b>${percent(correct,done)}%</b></div></article></section>`; }
function courseCard(course) {
  const saved = loadProgress(course.id), questionCount = course.questionCount ?? course.questions ?? '—';
  const complete = typeof questionCount === 'number' ? percent(Object.keys(saved.answers || {}).length, questionCount) : 0;
  const accentStyle = course.accent ? `style="--course-accent:${esc(course.accent)}"` : '';
  return `<article class="card course-card" data-course-card="${esc(course.id)}" ${accentStyle}><div class="eyebrow">${esc(course.code || course.category || 'Certification')}</div><h3>${esc(course.title)}</h3><p class="subtle">${esc(course.description || 'Open this course workspace.')}</p><div class="meta"><span>${esc(questionCount)} questions</span>${course.provider ? `<span>${esc(course.provider)}</span>` : ''}</div><progress class="progress" max="100" value="${complete}" aria-label="${complete}% locally complete"></progress><div class="progress-label">${complete}% locally complete</div></article>`;
}
function renderCatalogSection() {
  const q = app.catalogSearch.trim().toLowerCase();
  const visible = q ? app.courses.filter(c => (c.title+c.code+c.provider+c.category).toLowerCase().includes(q)) : app.courses;
  // Group by category
  const groups = new Map();
  for (const c of visible) { const cat = c.category || ''; if (!groups.has(cat)) groups.set(cat, []); groups.get(cat).push(c); }
  let sections = '';
  for (const [cat, courses] of groups) {
    const heading = cat ? `<h3 class="catalog-cat-heading">${esc(cat)}</h3>` : '';
    sections += `${heading}<div class="grid course-grid">${courses.map(courseCard).join('')}</div>`;
  }
  if (!visible.length) sections = '<p class="empty">No courses match your search.</p>';
  return sections;
}
function renderDashboard() {
  const title = app.data.metadata?.title || app.course.title;
  const domains = app.data.domains.map(domain => { const qs = domainQuestions(domain.id), done = qs.filter(question => app.progress.answers[question.id]).length, complete = percent(done, qs.length); return `<article class="card domain-card" data-domain="${esc(domain.id)}"><div class="eyebrow">${esc(domain.weight ? `${domain.weight}% exam weight` : `Domain ${domain.id}`)}</div><h3>${esc(domain.name)}</h3><p class="subtle">${esc(domain.description || `${qs.length} practice questions`)}</p><progress class="progress" max="100" value="${complete}" aria-label="${done} of ${qs.length} answered"></progress><div class="progress-label">${done}/${qs.length} answered</div></article>`; }).join('');
  const searchBar = `<div class="catalog-search-wrap"><input id="catalog-search" class="catalog-search" type="search" placeholder="Search certifications…" value="${esc(app.catalogSearch)}" aria-label="Search courses"></div>`;
  return topbar(title, app.data.metadata?.description || app.course.description) + statsHtml() + `<section class="section-head"><div><h2>Study this course</h2><p>Choose a domain or continue where you left off.</p></div><button class="btn primary" data-view="practice">Continue practice</button></section><section class="grid domain-grid">${domains}</section><section class="section-head"><div><h2>Course catalog</h2><p>Switch among certification tracks without mixing progress.</p></div>${searchBar}</section>${renderCatalogSection()}`;
}
function objectiveCard(item, domain) {
  if (typeof item === 'string') return `<div class="objective"><b>${esc(item)}</b></div>`;
  const title = item.title ?? item.name ?? item.id ?? 'Objective';
  const objId = item.id ?? null;
  // Per-objective progress: count questions tagged to this objective
  const objQs = objId ? app.data.questions.filter(q => q.domainId === String(domain.id) && q.objectiveId != null && String(q.objectiveId) === String(objId)) : [];
  const objDone = objQs.filter(q => app.progress.answers[q.id]).length;
  const progressBadge = objQs.length ? `<span class="obj-progress">${objDone}/${objQs.length}</span>` : '';
  const refs = Array.isArray(item.refs) && item.refs.length ? `<p class="obj-refs">${item.refs.map(r => `<code>${esc(r)}</code>`).join(' ')}</p>` : '';
  const summary = item.summary ? `<p class="subtle">${esc(item.summary)}</p>` : '';
  const notes = item.notes_md ? `<div class="notes-md">${mdLite(item.notes_md)}</div>` : '';
  return `<div class="objective"><div class="objective-hd"><b>${esc(title)}</b>${progressBadge}</div>${summary}${notes}${refs}</div>`;
}
function renderNotes() {
  const cards = app.data.domains.map(domain => {
    const objItems = safeArray(domain.objectives);
    const objectives = objItems.length
      ? objItems.map(item => objectiveCard(item, domain)).join('')
      : `<div class="objective"><b>Practice focus</b><p>Use the course questions tagged to this domain to validate your understanding.</p></div>`;
    return `<article class="card"><div class="eyebrow">${esc(domain.weight ? `${domain.weight}% exam weight` : `Domain ${domain.id}`)}</div><h2>${esc(domain.name)}</h2>${domain.description ? `<p class="subtle">${esc(domain.description)}</p>` : ''}<div class="objective-list">${objectives}</div><div class="question-actions"><span class="meta">${domainQuestions(domain.id).length} practice questions</span><button class="btn small" data-domain-practice="${esc(domain.id)}">Practice domain</button></div></article>`;
  }).join('');
  return topbar('Domain notes', 'Review objectives and study notes, then validate each domain in practice.') + `<section class="grid">${cards}</section>`;
}
function filteredQuestions() {
  let list = app.practiceFilter === 'all' ? app.data.questions : domainQuestions(app.practiceFilter);
  if (app.practiceDiffFilter !== 'all') list = list.filter(q => q.difficulty === app.practiceDiffFilter);
  if (app.practiceTagFilter !== 'all') list = list.filter(q => q.tags.includes(app.practiceTagFilter));
  return list;
}
function questionHtml(question, position, total, mode) {
  const record = app.progress.answers[question.id]; const selected = record?.selected || pendingValues(question.id);
  const submitted = Boolean(record); const multiple = question.type === 'multiple_choice';
  const options = question.options.map((option, index) => { const chosen = selected.includes(option.key); const isCorrectOption = question.correct.includes(option.key); const resultClass = submitted ? (isCorrectOption ? 'correct' : chosen ? 'incorrect' : '') : chosen ? 'selected' : ''; return `<button class="option ${resultClass}" data-option="${esc(option.key)}" data-question="${esc(question.id)}" ${submitted ? 'disabled' : ''}><span class="option-key">${keyLabel(index)}</span><span>${esc(option.text)}</span></button>`; }).join('');
  const feedback = submitted ? `<div class="explanation"><b class="status ${record.correct ? 'good' : 'bad'}">${record.correct ? 'Correct' : 'Not quite'}</b>${question.explanation ? `<p>${esc(question.explanation)}</p>` : ''}</div>` : '';
  return `<article class="card question-card"><div class="question-number">${esc(mode)} · ${position + 1} of ${total}${multiple ? ' · Select all that apply' : ''}</div><div class="question-text">${esc(question.prompt)}</div><div class="options" role="group" aria-label="Answer options">${options}</div>${feedback}<div class="question-actions"><button class="btn small" data-bookmark="${esc(question.id)}">${app.progress.bookmarks[question.id] ? '★ Saved for review' : '☆ Save for review'}</button><div>${!submitted ? `<button class="btn primary" data-submit="${esc(question.id)}" ${selected.length ? '' : 'disabled'}>Check answer</button>` : `<button class="btn primary" data-next="${esc(mode)}">Next question</button>`}</div></div></article>`;
}
function renderPractice() {
  const all = filteredQuestions();
  if (app.questionIndex >= all.length) app.questionIndex = 0;
  if (!all.length) return topbar('Practice questions','Answer explanations appear after you check an answer.') + `<section class="card"><p class="empty">No questions match the current filters. Try clearing some filters.</p><div class="question-actions"><button class="btn" data-action="clear-practice-filters">Clear filters</button></div></section>`;
  const question = all[app.questionIndex];
  const domainOpts = [`<option value="all">All domains (${app.data.questions.length})</option>`, ...app.data.domains.map(d => `<option value="${esc(d.id)}" ${app.practiceFilter === d.id ? 'selected' : ''}>${esc(d.name)} (${domainQuestions(d.id).length})</option>`)].join('');
  // Difficulty options — only show if any question has difficulty set
  const hasDiff = app.data.questions.some(q => q.difficulty);
  const diffOpts = hasDiff ? `<label class="field">Difficulty<select id="diff-filter"><option value="all">All</option>${['easy','medium','hard'].map(d => `<option value="${d}" ${app.practiceDiffFilter===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}</select></label>` : '';
  // Tag options — collect all unique tags
  const allTags = [...new Set(app.data.questions.flatMap(q => q.tags))].sort();
  const tagOpts = allTags.length ? `<label class="field">Tag<select id="tag-filter"><option value="all">All tags</option>${allTags.map(t => `<option value="${esc(t)}" ${app.practiceTagFilter===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>` : '';
  return topbar('Practice questions','Answer explanations appear after you check an answer.') + `<section class="question-tools"><label class="field">Domain<select id="practice-filter">${domainOpts}</select></label>${diffOpts}${tagOpts}<button class="btn small" data-action="shuffle-practice">Shuffle</button><span class="meta">${all.length} available</span></section><section class="section-head"><div><h2>${esc(domainName(question.domainId))}</h2></div></section>${questionHtml(question, app.questionIndex, all.length, 'practice')}`;
}
function renderFlashcards() { const questions = filteredQuestions(); if (app.flashIndex >= questions.length) app.flashIndex = 0; const question = questions[app.flashIndex]; const face = app.flashBack ? (question.explanation || question.correct.map(key => question.options.find(option => option.key === key)?.text).join('\n')) : question.prompt; return topbar('Flashcards','Click the card to reveal the explanation and reinforce recall.') + `<section class="question-tools"><label class="field">Scope<select id="flash-filter"><option value="all">All domains</option>${app.data.domains.map(domain => `<option value="${esc(domain.id)}" ${app.practiceFilter === domain.id ? 'selected' : ''}>${esc(domain.name)}</option>`).join('')}</select></label><span class="meta">${app.flashIndex + 1} / ${questions.length}</span></section><section class="flashcard" data-flip-card><div class="flash-inner"><div>${esc(face)}<small>${app.flashBack ? 'Explanation — click to see the prompt' : 'Prompt — click to reveal'}</small></div></div></section><div class="question-actions"><button class="btn" data-flash="prev">← Previous</button><button class="btn primary" data-flash="next">Next →</button></div>`; }
function startMock() { const size = Math.min(Number(app.data.metadata?.mockQuestionCount ?? app.course.mockQuestionCount ?? 20), app.data.questions.length); const seconds = Number(app.data.metadata?.mockDurationSeconds ?? app.course.mockDurationSeconds ?? size * 75); app.mock = { questions: [...app.data.questions].sort(() => Math.random() - .5).slice(0,size), index:0, endAt: Date.now() + seconds * 1000, finished:false }; app.timer = setInterval(() => render(), 1000); }
function renderMock() { if (!app.mock) return topbar('Timed mock exam','Simulate a focused, timed assessment.') + `<section class="card mock-banner"><h2>Ready for a timed mock?</h2><p class="subtle">The mock samples questions from this course. Answers are saved to this course progress after checking.</p><button class="btn primary" data-action="start-mock">Start timed mock</button></section>`; const remaining = Math.max(0, Math.ceil((app.mock.endAt - Date.now()) / 1000)); if (remaining === 0 && !app.mock.finished) { app.mock.finished = true; clearInterval(app.timer); app.timer = null; } const current = app.mock.questions[app.mock.index]; if (app.mock.finished) { const results = app.mock.questions.map(question => app.progress.answers[question.id]).filter(Boolean); const score = results.filter(result => result.correct).length; return topbar('Mock completed',`Score: ${score}/${app.mock.questions.length}.`) + `<section class="card"><h2>Time is up</h2><p class="subtle">Your checked answers remain in course progress. Review missed questions to target weak areas.</p><div class="question-actions"><button class="btn" data-view="review">Review missed questions</button><button class="btn primary" data-action="start-mock">Start another mock</button></div></section>`; } return topbar('Timed mock exam','Use the timer as a pacing guide.') + `<section class="card mock-banner"><div class="question-actions"><span>Question ${app.mock.index + 1} of ${app.mock.questions.length}</span><span class="timer">${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}</span><button class="btn danger small" data-action="finish-mock">Finish mock</button></div></section><section class="section-head"><div><h2>${esc(domainName(current.domainId))}</h2></div></section>${questionHtml(current,app.mock.index,app.mock.questions.length,'mock')}`; }
function renderAllOverview() {
  // Aggregate progress across all courses using localStorage (no server call needed).
  let totalQ = 0, totalAnswered = 0, totalCorrect = 0;
  const rows = app.courses.map(course => {
    const saved = loadProgress(course.id);
    const qCount = typeof (course.questionCount ?? course.questions) === 'number' ? (course.questionCount ?? course.questions) : 0;
    const answered = Object.keys(saved.answers || {}).length;
    const correct = Object.values(saved.answers || {}).filter(r => r.correct).length;
    totalQ += qCount; totalAnswered += answered; totalCorrect += correct;
    const pct = percent(answered, qCount);
    const acc = percent(correct, answered);
    const accentStyle = course.accent ? `style="--course-accent:${esc(course.accent)}"` : '';
    return `<article class="card course-card overview-row" data-course-card="${esc(course.id)}" ${accentStyle}><div class="eyebrow">${esc(course.category || course.code || 'Cert')}</div><h3>${esc(course.title)}</h3><div class="meta"><span>${answered}/${qCount} answered</span><span>${acc}% accuracy</span></div><progress class="progress" max="100" value="${pct}" aria-label="${pct}% complete"></progress><div class="progress-label">${pct}% complete</div></article>`;
  }).join('');
  const overallAcc = percent(totalCorrect, totalAnswered);
  const overallPct = percent(totalAnswered, totalQ);
  return `<header class="topbar"><div><div class="eyebrow">All certifications</div><h1>Study overview</h1><p class="subtle">Progress across all courses in your catalog.</p></div><div class="top-actions"><span class="pill">${app.auth.username || 'Signed in'} · ${totalAnswered} answered total</span></div></header><section class="grid stats"><article class="card stat"><div class="stat-icon">◌</div><div><small>Overall completion</small><b>${overallPct}%</b></div></article><article class="card stat"><div class="stat-icon">✓</div><div><small>Total correct</small><b>${totalCorrect}</b></div></article><article class="card stat"><div class="stat-icon">↗</div><div><small>Overall accuracy</small><b>${overallAcc}%</b></div></article><article class="card stat"><div class="stat-icon">◻</div><div><small>Courses</small><b>${app.courses.length}</b></div></article></section><section class="section-head"><div><h2>Per-course progress</h2></div></section><section class="grid course-grid">${rows}</section>`;
}
function renderReview() { const review = app.data.questions.filter(question => app.progress.bookmarks[question.id] || app.progress.answers[question.id]?.correct === false); const rows = review.map(question => `<div class="review-row"><div><b>${esc(domainName(question.domainId))}</b><div class="subtle">${esc(question.prompt.slice(0,120))}${question.prompt.length > 120 ? '…' : ''}</div></div><button class="btn small" data-open-question="${esc(question.id)}">Open</button></div>`).join(''); return topbar('Review queue','Saved and incorrect questions across this course.') + `<section class="card">${rows || '<p class="empty">No questions in review yet. Save a question or practice to build your review queue.</p>'}</section>`; }
function render() {
  if (!app.course || !app.data) return;
  const body = ({dashboard:renderDashboard,notes:renderNotes,practice:renderPractice,flashcards:renderFlashcards,mock:renderMock,review:renderReview,overview:renderAllOverview}[app.view] || renderDashboard)();
  $('#app').innerHTML = layoutHtml(body);
  bindEvents();
}
function pendingValues(questionId) { return [...app.pending].filter(value => value.startsWith(`${questionId}:`)).map(value => value.slice(questionId.length + 1)); }
function toggleOption(questionId, key) { const question = app.data.questions.find(item => item.id === questionId); if (!question) return; const token = `${questionId}:${key}`; if (question.type === 'single_choice') [...app.pending].filter(item => item.startsWith(`${questionId}:`)).forEach(item => app.pending.delete(item)); if (app.pending.has(token)) app.pending.delete(token); else app.pending.add(token); render(); }
function submitAnswer(questionId) { const question = app.data.questions.find(item => item.id === questionId); const selected = pendingValues(questionId); if (!question || !selected.length) return; app.progress.answers[questionId] = { selected, correct: isCorrect(question, selected), at: Date.now() }; [...app.pending].filter(item => item.startsWith(`${questionId}:`)).forEach(item => app.pending.delete(item)); saveProgress(); }
function nextQuestion(mode) { if (mode === 'mock' && app.mock) app.mock.index = (app.mock.index + 1) % app.mock.questions.length; else { const list = filteredQuestions(); app.questionIndex = (app.questionIndex + 1) % list.length; } render(); }
function openQuestion(id) { const question = app.data.questions.find(item => item.id === id); if (!question) return; app.practiceFilter = 'all'; app.questionIndex = app.data.questions.indexOf(question); go({ courseId: app.course.id, view:'practice' }); }
function bindEvents() {
  $('#course-picker')?.addEventListener('change', event => go({courseId:event.target.value,view:'dashboard'}));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => go({courseId:app.course.id,view:button.dataset.view})));
  document.querySelectorAll('[data-domain]').forEach(button => button.addEventListener('click', () => { app.practiceFilter = button.dataset.domain; app.questionIndex = 0; go({courseId:app.course.id,view:'notes'}); }));
  document.querySelectorAll('[data-domain-practice]').forEach(button => button.addEventListener('click', () => { app.practiceFilter = button.dataset.domainPractice; app.questionIndex=0; go({courseId:app.course.id,view:'practice'}); }));
  document.querySelectorAll('[data-course-card]').forEach(button => button.addEventListener('click', () => go({courseId:button.dataset.courseCard,view:'dashboard'})));
  document.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => toggleOption(button.dataset.question, button.dataset.option)));
  document.querySelectorAll('[data-submit]').forEach(button => button.addEventListener('click', () => submitAnswer(button.dataset.submit)));
  document.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => nextQuestion(button.dataset.next)));
  document.querySelectorAll('[data-bookmark]').forEach(button => button.addEventListener('click', () => { const id=button.dataset.bookmark; app.progress.bookmarks[id] = !app.progress.bookmarks[id]; if (!app.progress.bookmarks[id]) delete app.progress.bookmarks[id]; saveProgress(); }));
  $('[data-flip-card]')?.addEventListener('click', () => { app.flashBack=!app.flashBack; render(); });
  document.querySelectorAll('[data-flash]').forEach(button => button.addEventListener('click', () => { const list=filteredQuestions(); app.flashIndex=(app.flashIndex+(button.dataset.flash==='next'?1:-1)+list.length)%list.length; app.flashBack=false; render(); }));
  $('#practice-filter')?.addEventListener('change', event => { app.practiceFilter=event.target.value; app.questionIndex=0; render(); });
  $('#diff-filter')?.addEventListener('change', event => { app.practiceDiffFilter=event.target.value; app.questionIndex=0; render(); });
  $('#tag-filter')?.addEventListener('change', event => { app.practiceTagFilter=event.target.value; app.questionIndex=0; render(); });
  $('#flash-filter')?.addEventListener('change', event => { app.practiceFilter=event.target.value; app.flashIndex=0; app.flashBack=false; render(); });
  $('#catalog-search')?.addEventListener('input', event => { app.catalogSearch=event.target.value; render(); });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => { const action=button.dataset.action; if (action==='logout') { void logout(); return; } if (action==='shuffle-practice') { app.data.questions.sort(()=>Math.random()-.5); app.questionIndex=0; render(); } if (action==='start-mock') { clearInterval(app.timer); startMock(); render(); } if (action==='finish-mock' && app.mock) { app.mock.finished=true; clearInterval(app.timer); app.timer=null; render(); } if (action==='reset-progress' && confirm(`Reset local progress for ${app.course.title}?`)) { app.progress=baseProgress(); saveProgress(); toast('Course progress reset.'); } if (action==='clear-practice-filters') { app.practiceFilter='all'; app.practiceDiffFilter='all'; app.practiceTagFilter='all'; app.questionIndex=0; render(); } }));
  document.querySelectorAll('[data-open-question]').forEach(button => button.addEventListener('click', () => openQuestion(button.dataset.openQuestion)));
}
function showError(error) { console.error(error); $('#app').innerHTML = `<main class="error-screen"><h1>Could not load the study catalog</h1><p>Run this app from a local web server and ensure the catalog bundle files are present.</p><pre class="error-detail">${esc(error.message || error)}</pre><button class="btn primary" id="retry">Retry</button></main>`; $('#retry')?.addEventListener('click', boot); }
async function boot() { try { if (!supabase || !isSupabaseConfigured) { renderAuth(); return; } const { data, error } = await supabase.auth.getSession(); if (error) throw error; if (!data.session) { renderAuth(); return; } await activateSession(data.session); await startWorkspace(); } catch (error) { showError(error); } }
if (supabase) supabase.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT') { app.auth = { user: null, username: '', mode: 'login' }; app.authReady = false; renderAuth(); } });
window.addEventListener('hashchange', () => { const route=parseRoute(); go(route).catch(showError); });
boot();
