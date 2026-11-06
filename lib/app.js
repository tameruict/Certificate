import { supabase, isSupabaseConfigured } from './supabase.js';
import { fetchArticleList, fetchArticleDetail, fetchArticleProgress, saveArticleProgress, articlesImageBase } from './articles.js';
import { renderMarkdownWithToc } from './markdown.js';
import { filterArticles, sortArticles, getPlatforms, getCategories, rewriteImageUrls, coverImageUrl, getStoredLanguage, setStoredLanguage } from './writeups.js';

const $ = (selector, root = document) => root.querySelector(selector);

function getStoredTheme() {
  try {
    if (typeof localStorage === 'undefined') return 'light';
    return localStorage.getItem('certlab:theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', next);
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('certlab:theme', next);
  } catch { /* ignore storage errors */ }
  return next;
}

const app = {
  catalog: null, courses: [], course: null, data: null, progress: null,
  courseSummaries: {}, examHistory: [],
  view: 'dashboard', questionIndex: 0, flashIndex: 0, flashBack: false,
  practiceFilter: 'all', practiceDiffFilter: 'all', practiceTagFilter: 'all', reviewFilter: 'all',
  mock: null, timer: null, pending: new Set(), catalogSearch: '',
  theme: applyTheme(getStoredTheme()),
  auth: { user: null, username: '', mode: 'login', recoveryCode: '', activeRecoveryCode: '', hasRecoveryCode: false, recoveryEmail: '' }, authReady: false,
  authorModalOpen: false,
  writeups: {
    loaded: false, loading: false, articles: [], progress: {}, error: null,
    filters: { query: '', platform: '', category: '', difficulty: '', language: getStoredLanguage() },
    viewMode: 'gallery',
    selectedSlug: null, detail: null, detailError: null, detailLoading: false
  }
};

const AUTHOR_FB_URL = 'https://www.facebook.com/profile.php?id=61576242522472';
const AUTHOR_GITHUB_URL = 'https://github.com/tameruict';
const GITHUB_SVG = '<svg class="social-svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>';
const FACEBOOK_SVG = '<svg class="social-svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';

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
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateRecoveryCode() {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const chars = Array.from(bytes, b => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `CLAB-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
function normalizeRecoveryCode(value) { return String(value || '').toUpperCase().replace(/[\s-]+/g, ''); }
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
  const mode = ['login', 'signup', 'forgot', 'reset'].includes(app.auth.mode) ? app.auth.mode : 'login';
  const signup = mode === 'signup';
  const forgot = mode === 'forgot';
  const reset = mode === 'reset';
  if (signup && !app.auth.recoveryCode) app.auth.recoveryCode = generateRecoveryCode();
  const setup = !isSupabaseConfigured;
  const notice = message ? `<div class="auth-notice ${message.kind === 'success' ? 'good' : 'bad'}" role="alert">${esc(message.text || message)}</div>` : '';
  const showRules = signup || forgot || reset;
  const rulesHtml = showRules ? `<p class="password-help">${PASSWORD_RULES.map(rule => `• ${esc(rule.label)}`).join('<br>')}</p>` : '';
  const titles = {
    login: 'Welcome back',
    signup: 'Create your study account',
    forgot: 'Recover your password',
    reset: 'Choose a new password'
  };
  const subtitles = {
    login: 'Use a username and a strong password. Your progress is archived to your Supabase account.',
    signup: 'Save your generated recovery code so you can reset your password anytime without losing study progress.',
    forgot: 'Enter your username, recovery code, and a new password — or provide a linked recovery email for a reset link.',
    reset: 'Enter and confirm your new password to complete account recovery.'
  };
  const submitLabels = {
    login: 'Sign in',
    signup: 'Create account',
    forgot: 'Reset password',
    reset: 'Update password'
  };
  const usernameField = !reset ? `<label class="field">Username<input id="auth-username" name="username" autocomplete="username" minlength="3" maxlength="32" pattern="[a-z0-9][a-z0-9._-]{2,31}" ${forgot ? '' : 'required'} placeholder="e.g. study_user"></label>` : '';
  const recoveryCodeField = signup
    ? `<label class="field">Recovery code (save a copy)<input id="auth-recovery-code" name="recoveryCode" value="${esc(app.auth.recoveryCode)}" readonly></label>`
    : forgot
      ? `<label class="field">Recovery code<input id="auth-recovery-code" name="recoveryCode" autocomplete="off" placeholder="e.g. CLAB-XXXX-XXXX-XXXX"></label>`
      : '';
  const recoveryEmailField = (signup || forgot)
    ? `<label class="field">Recovery email (optional)<input id="auth-recovery-email" name="recoveryEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>`
    : '';
  const passwordLabel = (forgot || reset) ? 'New password' : 'Password';
  const passwordField = `<label class="field">${passwordLabel}<input id="auth-password" name="password" type="password" autocomplete="${signup || forgot || reset ? 'new-password' : 'current-password'}" minlength="12" ${forgot ? '' : 'required'} placeholder="12+ characters"></label>`;
  const confirmField = (signup || forgot || reset)
    ? `<label class="field">Confirm password<input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" ${forgot ? '' : 'required'}></label>`
    : '';
  const switchButtons = mode === 'login'
    ? `<button class="btn auth-switch" type="button" data-auth-mode="signup">New here? Create an account</button><button class="btn auth-switch" type="button" data-auth-mode="forgot">Forgot password? Recover account</button>`
    : `<button class="btn auth-switch" type="button" data-auth-mode="login">${signup ? 'Already have an account? Sign in' : 'Back to sign in'}</button>`;
  const authorAuthBar = `<div class="auth-author-bar"><span class="auth-author-seal">泰</span><span>Không gian học tập &amp; luyện thi biên soạn bởi <strong>tameruict</strong></span><span class="auth-author-links"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="${AUTHOR_FB_URL}" target="_blank" rel="noopener noreferrer">Facebook</a></span></div>`;
  $('#app').innerHTML = `<main class="auth-shell"><section class="auth-card card" aria-labelledby="auth-title"><div class="brand auth-brand"><div class="brand-logo seal-stamp" title="翰林书院 · CertLab">研</div><div class="brand-text"><div class="brand-title"><strong>CertLab Study</strong><span class="seal-mark">翰林</span></div><small>Thư Viện Khảo Thí &amp; Nghiên Cứu</small></div></div><div class="eyebrow">Secure sign-in · 登录鉴权</div><h1 id="auth-title">${titles[mode]}</h1><p class="subtle">${subtitles[mode]}</p>${setup ? `<div class="auth-notice"><b>Supabase is not configured yet.</b><p>Set the publishable/anon key in <code>config.js</code> and run <code>supabase/001_user_auth_and_archive.sql</code> in your project.</p></div>` : ''}${notice}<form id="auth-form" class="auth-form" novalidate>${usernameField}${recoveryCodeField}${recoveryEmailField}${passwordField}${confirmField}${rulesHtml}<button class="btn primary auth-submit" type="submit" ${setup ? 'disabled' : ''}>${submitLabels[mode]}</button></form>${switchButtons}${authorAuthBar}</section></main>`;
  bindAuthEvents();
}
function bindAuthEvents() {
  $('#auth-form')?.addEventListener('submit', event => { event.preventDefault(); void submitAuth(event.currentTarget); });
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('[data-auth-mode]').forEach(btn => btn.addEventListener('click', () => {
      app.auth.mode = btn.dataset.authMode;
      if (app.auth.mode === 'signup') app.auth.recoveryCode = generateRecoveryCode();
      renderAuth();
    }));
  }
}
async function ensureProfile(username) {
  if (!supabase || !app.auth.user || !username) return;
  const { error } = await supabase.from('user_profiles').upsert({ user_id: app.auth.user.id, username, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  app.auth.username = username;
}
async function saveRecoveryCredentials(recoveryCode, recoveryEmail = '') {
  if (!supabase || !app.auth.user || typeof supabase.rpc !== 'function') return false;
  const normalizedCode = normalizeRecoveryCode(recoveryCode);
  if (!/^[A-Z0-9]{12,64}$/.test(normalizedCode)) return false;
  const emailArg = String(recoveryEmail || '').trim().toLowerCase() || null;
  const { error } = await supabase.rpc('set_user_recovery_code', {
    p_recovery_code: normalizedCode,
    p_recovery_email: emailArg
  });
  if (error) {
    if (!/function .* does not exist|relation .* does not exist|schema cache/i.test(error.message || '')) throw error;
    return false;
  }
  app.auth.hasRecoveryCode = true;
  if (emailArg) app.auth.recoveryEmail = emailArg;
  app.auth.activeRecoveryCode = recoveryCode;
  return true;
}
async function rotateRecoveryCode() {
  const nextCode = generateRecoveryCode();
  try {
    const saved = await saveRecoveryCredentials(nextCode, app.auth.recoveryEmail || '');
    app.auth.activeRecoveryCode = nextCode;
    render();
    toast(saved ? 'New recovery code generated. Save a copy in a safe place.' : 'Recovery code generated locally (run migration 009 in Supabase to persist).');
  } catch (error) {
    toast(`Could not update recovery code: ${friendlyAuthError(error)}`);
  }
  return nextCode;
}
async function loadProfile() {
  if (!supabase || !app.auth.user) return;
  let { data, error } = await supabase.from('user_profiles').select('username,has_recovery_code,recovery_email').eq('user_id', app.auth.user.id).maybeSingle();
  if (error && /column .* does not exist/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('user_profiles').select('username').eq('user_id', app.auth.user.id).maybeSingle());
  }
  if (error) { if (!/relation .* does not exist|schema cache/i.test(error.message || '')) throw error; return; }
  app.auth.username = data?.username || app.auth.user.user_metadata?.username || '';
  app.auth.hasRecoveryCode = Boolean(data?.has_recovery_code);
  app.auth.recoveryEmail = data?.recovery_email || '';
}
async function submitAuth(form) {
  if (!supabase || !isSupabaseConfigured) return;
  const values = new FormData(form);
  const mode = ['login', 'signup', 'forgot', 'reset'].includes(app.auth.mode) ? app.auth.mode : 'login';
  const username = normalizeUsername(values.get('username'));
  const password = String(values.get('password') || '');
  const confirmPassword = String(values.get('confirm') || '');
  const recoveryCode = String(values.get('recoveryCode') || app.auth.recoveryCode || '').trim();
  const recoveryEmail = String(values.get('recoveryEmail') || '').trim().toLowerCase();
  const issues = [];

  if (mode === 'forgot' && recoveryEmail && !normalizeRecoveryCode(recoveryCode)) {
    if (!EMAIL_PATTERN.test(recoveryEmail)) {
      renderAuth({ kind: 'error', text: 'Enter a valid recovery email address.' });
      return;
    }
    const button = $('.auth-submit'); if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    try {
      const redirectTo = typeof location !== 'undefined' && location.origin ? `${location.origin}${location.pathname || '/'}` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail, redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
      renderAuth({ kind: 'success', text: 'If that recovery email is registered, a password reset link has been sent.' });
    } catch (error) { renderAuth({ kind: 'error', text: friendlyAuthError(error) }); }
    return;
  }

  if (mode !== 'reset' && !USERNAME_PATTERN.test(username)) {
    issues.push('Username must be 3–32 characters using lowercase letters, numbers, dot, underscore, or hyphen.');
  }
  if (recoveryEmail && !EMAIL_PATTERN.test(recoveryEmail)) {
    issues.push('Recovery email must be a valid email address.');
  }
  if (mode === 'forgot' && !/^[A-Z0-9]{12,64}$/.test(normalizeRecoveryCode(recoveryCode))) {
    issues.push('Enter a valid 12–64 character recovery code (e.g. CLAB-XXXX-XXXX-XXXX).');
  }
  const passwordProblems = passwordIssues(password);
  if (passwordProblems.length) issues.push(`Password needs ${passwordProblems.join(', ')}.`);
  if ((mode === 'signup' || mode === 'forgot' || mode === 'reset') && password !== confirmPassword) {
    issues.push('Passwords do not match.');
  }
  if (issues.length) { renderAuth({ kind: 'error', text: issues.join(' ') }); return; }

  const button = $('.auth-submit'); if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try {
    if (mode === 'reset') {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      app.auth.mode = 'login';
      if (data?.user) {
        await activateSession({ user: data.user });
        await startWorkspace();
      } else {
        renderAuth({ kind: 'success', text: 'Password updated. Sign in with your new password.' });
      }
      return;
    }
    if (mode === 'forgot') {
      const { data, error } = await supabase.rpc('reset_password_with_recovery_code', {
        p_username: username,
        p_recovery_code: normalizeRecoveryCode(recoveryCode),
        p_new_password: password
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Invalid username or recovery code.');
      app.auth.mode = 'login';
      renderAuth({ kind: 'success', text: 'Password reset complete. Sign in with your new password.' });
      return;
    }
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: usernameEmail(username), password, options: { data: { username } } });
      if (error) throw error;
      if (!data.session) { renderAuth({ kind: 'success', text: 'Account created. If email confirmations are enabled, an administrator must confirm this username before sign-in.' }); return; }
      await activateSession(data.session, username);
      await saveRecoveryCredentials(recoveryCode, recoveryEmail);
      app.auth.activeRecoveryCode = recoveryCode;
      app.auth.recoveryCode = '';
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
async function loadCloudCourseSummaries() {
  if (!supabase || !app.auth.user || typeof supabase.from !== 'function') return;
  try {
    const query = supabase.from('user_course_progress').select('course_id,answered_count,correct_count,bookmarked_count,streak,best_streak,content_version,last_activity_at,updated_at');
    if (typeof query?.eq !== 'function') return;
    const { data, error } = await query.eq('user_id', app.auth.user.id);
    if (error || !Array.isArray(data)) return;
    for (const row of data) {
      if (row && row.course_id) app.courseSummaries[row.course_id] = row;
    }
  } catch { /* normalized summary table is optional before migration 009 */ }
}
async function startWorkspace() { if (!app.auth.user) return; await Promise.all([loadCatalog(), loadCloudCourseSummaries()]); const route = parseRoute(); await go(route, !location.hash); }
async function logout() {
  if (supabase) await supabase.auth.signOut(); clearInterval(app.timer); app.auth = { user: null, username: '', mode: 'login', recoveryCode: '', activeRecoveryCode: '', hasRecoveryCode: false, recoveryEmail: '' }; app.authReady = false; app.course = null; app.data = null; app.progress = null; app.courseSummaries = {}; app.examHistory = []; renderAuth();
}
async function restoreNormalizedProgress() {
  if (!supabase || !app.auth.user || !app.course || typeof supabase.from !== 'function') return null;
  try {
    const qQuery = supabase.from('user_question_progress').select('question_id,selected_options,is_correct,bookmarked,answered_at,updated_at');
    if (typeof qQuery?.eq !== 'function') return null;
    const { data: qRows, error: qError } = await qQuery.eq('user_id', app.auth.user.id).eq('course_id', app.course.id);
    if (qError || !Array.isArray(qRows) || !qRows.length) return null;
    const summary = app.courseSummaries[app.course.id] || {};
    const answers = {};
    const bookmarks = {};
    let latestMs = Date.parse(summary.last_activity_at || summary.updated_at || '') || 0;
    for (const row of qRows) {
      if (!row?.question_id) continue;
      const rowMs = Date.parse(row.answered_at || row.updated_at || '') || 0;
      if (rowMs > latestMs) latestMs = rowMs;
      if (row.bookmarked) bookmarks[row.question_id] = true;
      if (typeof row.is_correct === 'boolean') {
        answers[row.question_id] = {
          selected: Array.isArray(row.selected_options) ? row.selected_options : [],
          correct: row.is_correct,
          at: rowMs || Date.now()
        };
      }
    }
    return {
      ...baseProgress(),
      answers,
      bookmarks,
      streak: Number(summary.streak) || 0,
      bestStreak: Number(summary.best_streak) || 0,
      contentVersion: summary.content_version || null,
      updatedAt: latestMs ? new Date(latestMs).toISOString() : new Date().toISOString()
    };
  } catch {
    return null;
  }
}
async function restoreCloudProgress() {
  if (!supabase || !app.auth.user || !app.course) return;
  const { data, error } = await supabase.from('user_data_archive').select('payload,updated_at').eq('user_id', app.auth.user.id).eq('course_id', app.course.id).maybeSingle();
  if (error) { if (!/relation .* does not exist|schema cache/i.test(error.message || '')) toast(`Cloud archive unavailable: ${error.message}`); return; }
  let cloudProgress = data?.payload;
  let cloudAt = Date.parse(data?.updated_at || cloudProgress?.updatedAt || '') || 0;
  if (!cloudProgress) {
    const normalized = await restoreNormalizedProgress();
    if (normalized) {
      cloudProgress = normalized;
      cloudAt = Date.parse(normalized.updatedAt || '') || 0;
    }
  }
  const localAt = Date.parse(app.progress.updatedAt || '') || 0;
  if (cloudProgress && cloudAt > localAt) {
    app.progress = { ...baseProgress(), ...cloudProgress, answers: cloudProgress.answers || {}, bookmarks: cloudProgress.bookmarks || {} };
    localStorage.setItem(courseKey(app.course.id), JSON.stringify(app.progress));
  } else if (localAt > cloudAt && (Object.keys(app.progress.answers || {}).length || Object.keys(app.progress.bookmarks || {}).length)) {
    void archiveProgress();
  }
  syncCourseSummaryFromProgress(app.course.id, app.progress);
}
function syncCourseSummaryFromProgress(courseId, progress) {
  if (!courseId || !progress) return;
  const ans = Object.values(progress.answers || {});
  app.courseSummaries[courseId] = {
    course_id: courseId,
    answered_count: ans.length,
    correct_count: ans.filter(r => r && r.correct).length,
    bookmarked_count: Object.keys(progress.bookmarks || {}).filter(k => progress.bookmarks[k]).length,
    streak: Number(progress.streak) || 0,
    best_streak: Number(progress.bestStreak) || 0,
    content_version: progress.contentVersion || null,
    last_activity_at: progress.updatedAt || new Date().toISOString()
  };
}
function courseProgressSummary(courseId) {
  const saved = loadProgress(courseId);
  const localAnswered = Object.keys(saved.answers || {}).length;
  const localCorrect = Object.values(saved.answers || {}).filter(r => r && r.correct).length;
  const localAt = Date.parse(saved.updatedAt || '') || 0;
  const cloud = app.courseSummaries[courseId];
  const cloudAt = Date.parse(cloud?.last_activity_at || cloud?.updated_at || '') || 0;
  if (cloud && (cloudAt > localAt || (!localAnswered && Number(cloud.answered_count) > 0))) {
    return {
      answeredCount: Number(cloud.answered_count) || 0,
      correctCount: Number(cloud.correct_count) || 0
    };
  }
  return { answeredCount: localAnswered, correctCount: localCorrect };
}
async function archiveProgress() {
  if (!supabase || !app.auth.user || !app.course || !app.progress) return;
  const bankVersion = app.course._manifest?.question_bank?.content_version ?? null;
  if (bankVersion && app.progress.contentVersion !== bankVersion) app.progress.contentVersion = bankVersion;
  const updatedAt = app.progress.updatedAt || new Date().toISOString();
  const payloadJson = JSON.stringify(app.progress);
  if (payloadJson.length > 230000) toast(`Progress archive is large (${Math.round(payloadJson.length/1024)} KB). Consider resetting old courses to free space.`);
  if (payloadJson.length > 262144) { toast('Progress archive is too large to sync. Reset course progress to re-enable cloud sync.'); return; }
  const { error } = await supabase.from('user_data_archive').upsert({ user_id: app.auth.user.id, course_id: app.course.id, payload: app.progress, updated_at: updatedAt }, { onConflict: 'user_id,course_id' });
  if (error && !/relation .* does not exist|schema cache/i.test(error.message || '')) toast(`Cloud archive failed: ${error.message}`);
}

function toast(message) {
  let node = $('#toast');
  if (!node && typeof document.createElement === 'function') { node = document.createElement('div'); node.id = 'toast'; node.className = 'toast'; document.body?.append(node); }
  if (!node) return;
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
function baseProgress() { return { version: 2, answers: {}, bookmarks: {}, streak: 0, bestStreak: 0, migratedLegacy: false, updatedAt: null, contentVersion: null }; }
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
  syncCourseSummaryFromProgress(app.course.id, app.progress);
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
async function loadExamHistory(courseId) {
  app.examHistory = [];
  if (!supabase || !app.auth.user || !courseId || typeof supabase.from !== 'function') return;
  try {
    const query = supabase.from('user_exam_attempts').select('id,total_questions,answered_count,correct_count,score_percent,duration_seconds,domain_breakdown,completed_at');
    if (typeof query?.eq !== 'function') return;
    const { data, error } = await query.eq('user_id', app.auth.user.id).eq('course_id', courseId).order('completed_at', { ascending: false }).limit(5);
    if (!error && Array.isArray(data)) app.examHistory = data;
  } catch { /* exam history table is optional before migration 009 */ }
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
  await Promise.all([restoreCloudProgress(), loadExamHistory(app.course.id)]);
  app.questionIndex = 0; app.flashIndex = 0; app.flashBack = false; app.practiceFilter = 'all';
}
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'course') return { courseId: parts[1], view: parts[2] || 'dashboard', writeupSlug: parts[2] === 'writeups' ? (parts[3] || null) : null };
  return { courseId: app.courses[0]?.id, view: 'dashboard', writeupSlug: null };
}
async function go(route, replace = false) {
  const courseId = route.courseId || app.course?.id || app.courses[0].id;
  const view = ['dashboard','notes','practice','flashcards','mock','review','overview','writeups'].includes(route.view) ? route.view : 'dashboard';
  let target = `#course/${encodeURIComponent(courseId)}/${view}`;
  if (view === 'writeups' && route.writeupSlug) target += `/${encodeURIComponent(route.writeupSlug)}`;
  if (location.hash !== target) { if (replace) location.replace(target); else location.hash = target; return; }
  if (!app.course || app.course.id !== courseId) await loadCourse(courseId);
  app.view = view;
  if (view === 'writeups') {
    app.writeups.selectedSlug = route.writeupSlug || null;
    if (!route.writeupSlug) { app.writeups.detail = null; app.writeups.detailError = null; }
    void loadWriteups();
    if (app.writeups.selectedSlug) void loadWriteupDetail(app.writeups.selectedSlug);
  }
  render();
}
async function loadWriteups() {
  const state = app.writeups;
  if (state.loaded || state.loading) return;
  state.loading = true;
  const { articles, error } = await fetchArticleList();
  state.articles = articles;
  state.error = error;
  state.loaded = true;
  state.loading = false;
  if (app.auth.user) state.progress = await fetchArticleProgress(app.auth.user.id);
  if (app.view === 'writeups') render();
}
async function loadWriteupDetail(slug) {
  const state = app.writeups;
  if (!slug) { state.detail = null; state.detailError = null; return; }
  if (state.detail && state.detail.slug === slug && state.detail.language === state.filters.language) return;
  state.detailLoading = true;
  state.detailError = null;
  state.detail = null;
  const { article, error } = await fetchArticleDetail(slug, state.filters.language);
  state.detailLoading = false;
  if (!article) {
    state.detailError = error === 'supabase_not_configured'
      ? 'Write-ups are not available yet: the study_articles table has not been imported into Supabase.'
      : 'This article is not available in the selected language yet.';
    state.detail = null;
  } else {
    state.detail = article;
  }
  if (app.view === 'writeups') render();
}
function navButton(view, icon, label) {
  const active = app.view === view;
  return `<button class="nav-item ${active ? 'active' : ''}" type="button" data-view="${view}"${active ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${esc(label)}</span></button>`;
}
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
function authorModalHtml() {
  return `<div class="modal-backdrop" data-modal-backdrop="true" role="dialog" aria-modal="true" aria-labelledby="author-modal-title"><div class="modal-card author-modal-card" role="document"><div class="modal-decor-top" aria-hidden="true"></div><header class="author-modal-header"><div class="author-modal-stamp" title="Ấn triện tameruict">泰墨</div><div class="author-modal-titles"><div class="eyebrow">Thư Viện Tác Giả · 著者档案</div><h2 id="author-modal-title">tameruict</h2><p class="author-modal-role">Biên soạn &amp; Nghiên cứu An ninh Mạng / IT Certifications</p></div><button class="modal-close-btn" type="button" data-action="close-author-modal" aria-label="Đóng cửa sổ">✕</button></header><div class="author-modal-body"><div class="author-seal-banner"><span class="chinese-seal-large" aria-hidden="true">翰林院</span><div class="author-seal-text"><strong>CertLab Study &amp; CBT Laboratory</strong><small>Không gian khảo thí &amp; nghiên cứu kỹ thuật phong cách Trung Hoa</small></div></div><p class="author-modal-desc">Chào mừng bạn đến với CertLab Study. Toàn bộ lộ trình chứng chỉ quốc tế (CompTIA Security+, Network+, AWS, ISO 27001) và các bài viết phân tích kỹ thuật Write-up được tuyển chọn, kiểm duyệt và biên soạn độc quyền bởi <strong>tameruict</strong>.</p><div class="author-modal-links"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer" class="btn primary author-cta-btn">${GITHUB_SVG}<span>Ghé thăm GitHub: @tameruict</span></a><a href="${AUTHOR_FB_URL}" target="_blank" rel="noopener noreferrer" class="btn author-cta-btn">${FACEBOOK_SVG}<span>Kết nối Facebook cá nhân</span></a></div><div class="author-stats-grid"><div class="author-stat-item"><span class="stat-number">4+</span><span class="stat-label">Khóa chứng chỉ</span></div><div class="author-stat-item"><span class="stat-number">370+</span><span class="stat-label">Câu hỏi CBT v2</span></div><div class="author-stat-item"><span class="stat-number">VI / EN</span><span class="stat-label">Hỗ trợ song ngữ</span></div></div></div><footer class="author-modal-footer"><span class="author-colophon-mark">落款 · tameruict 印</span><button class="btn small" type="button" data-action="close-author-modal">Đóng lại</button></footer></div></div>`;
}

function layoutHtml(content) {
  const coursePickerOptions = buildCoursePickerOptions();
  const cbtViews = new Set(['practice', 'mock', 'flashcards', 'review']);
  const surfaceMode = cbtViews.has(app.view) ? 'cbt' : 'editorial';
  const domains = app.data.domains.map((domain, idx) => {
    const count = domainQuestions(domain.id).length;
    return `<button class="domain-link" type="button" data-domain="${esc(domain.id)}"><span class="domain-link-index">${idx + 1}.</span><span class="domain-link-name">${esc(domain.name)}</span><span class="domain-link-meta">${count}</span></button>`;
  }).join('');
  const themeLabel = app.theme === 'dark' ? '☀ Light' : '☾ Dark';
  const recoveryBanner = app.auth.activeRecoveryCode
    ? `<section class="card auth-notice good recovery-banner" role="status"><div><b>Save your recovery code:</b> <code>${esc(app.auth.activeRecoveryCode)}</code> — keep this code in a safe place so you can reset your password if forgotten.</div><button class="btn small" type="button" data-action="dismiss-recovery-code">Dismiss</button></section>`
    : '';
  const authorSidebarCard = `<div class="sidebar-author-card"><div class="sidebar-author-header"><span class="author-seal-stamp" title="Ấn triện tameruict">泰</span><div class="sidebar-author-meta"><span class="sidebar-author-role">Biên soạn · 著作者</span><span class="sidebar-author-name">tameruict</span></div><button class="author-info-btn" type="button" data-action="open-author-modal" title="Xem hồ sơ cá nhân" aria-label="Xem hồ sơ cá nhân"><svg class="icon-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></button></div><div class="sidebar-author-socials"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer" class="author-social-link" title="GitHub: @tameruict">${GITHUB_SVG}<span>GitHub</span></a><a href="${AUTHOR_FB_URL}" target="_blank" rel="noopener noreferrer" class="author-social-link" title="Facebook cá nhân">${FACEBOOK_SVG}<span>Facebook</span></a></div></div>`;
  const colophon = `<footer class="oriental-colophon"><div class="colophon-seal" aria-hidden="true">落款</div><div class="colophon-text"><span>CertLab Study · Thư Viện Khảo Thí &amp; Nghiên Cứu · Biên soạn bởi <strong>tameruict</strong></span><span class="colophon-links"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub @tameruict</a> · <a href="${AUTHOR_FB_URL}" target="_blank" rel="noopener noreferrer">Facebook Profile</a></span></div></footer>`;
  const modal = app.authorModalOpen ? authorModalHtml() : '';
  return `<div class="layout" data-surface="${surfaceMode}"><aside class="sidebar"><div class="brand"><div class="brand-logo seal-stamp" title="翰林书院 · CertLab">研</div><div class="brand-text"><div class="brand-title"><strong>CertLab Study</strong><span class="seal-mark">翰林</span></div><small>Thư Viện Khảo Thí &amp; Nghiên Cứu</small></div></div>${authorSidebarCard}<label class="side-label" for="course-picker">Current certification</label><select id="course-picker" class="course-select" aria-label="Select course">${coursePickerOptions}</select><div class="side-label">Kinh Viện · Tri Thức · 经院典籍</div><nav class="nav" aria-label="Workspace views">${navButton('dashboard','⌂','Overview')}${navButton('notes','▤','Domain notes')}${navButton('writeups','✎','Write-ups')}${navButton('overview','⊞','All courses')}</nav><div class="side-label">Trường Thi · Khảo Thí · 考棚考场</div><nav class="nav" aria-label="Exam views">${navButton('practice','✓','Practice CBT')}${navButton('mock','◷','Timed mock')}${navButton('flashcards','◇','Flashcards')}${navButton('review','↺','Review queue')}</nav><div class="side-label">Chuyên Đề · Khoa Mục · 科目纲要</div><div class="domain-links">${domains}</div><div class="side-footer-wrap"><div class="side-foot">Signed in as <b>${esc(app.auth.username || 'study user')}</b>. Synced locally &amp; cloud.</div><div class="side-footer-actions"><button class="btn small" type="button" data-action="toggle-theme" aria-label="Toggle color theme">${themeLabel}</button><button class="btn small" type="button" data-action="rotate-recovery-code">Recovery key</button><button class="btn small logout-btn" type="button" data-action="logout">Sign out</button></div></div></aside><main id="main" class="main" tabindex="-1">${recoveryBanner}${content}${colophon}</main></div>${modal}`;
}
function topbar(title, detail = '') {
  const showReset = app.view === 'dashboard' || app.view === 'review';
  const streak = Number(app.progress?.streak) || 0;
  const streakPill = streak > 0 ? `<span class="pill">↗ ${streak} streak</span>` : '';
  const authorBadge = `<div class="topbar-author-badge" data-action="open-author-modal" tabindex="0" role="button" title="Hồ sơ tác giả: tameruict (Click xem chi tiết)" aria-label="Hồ sơ tác giả tameruict"><span class="seal-tag-red">泰</span><span class="topbar-author-name">tameruict</span><span class="topbar-social-icons"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer" class="social-mini-link" title="GitHub: @tameruict" aria-label="GitHub @tameruict">${GITHUB_SVG}</a><a href="${AUTHOR_FB_URL}" target="_blank" rel="noopener noreferrer" class="social-mini-link" title="Facebook cá nhân" aria-label="Facebook">${FACEBOOK_SVG}</a></span></div>`;
  return `<header class="topbar"><div><div class="eyebrow">${esc(app.course.code || 'Certification course')}</div><h1>${esc(title)}</h1>${detail ? `<p class="subtle">${esc(detail)}</p>` : ''}</div><div class="top-actions">${streakPill}${authorBadge}<span class="pill">${esc(app.auth.username || 'Signed in')} · ${answered()} / ${app.data.questions.length} answered</span>${showReset ? '<button class="btn small" type="button" data-action="reset-progress">Reset progress</button>' : ''}</div></header>`;
}
function statsHtml() {
  const total = app.data.questions.length, done = answered(), correct = correctCount();
  return `<section class="grid stats"><article class="card stat"><div class="stat-icon">◌</div><div><small>Completion</small><b>${percent(done,total)}%</b></div></article><article class="card stat"><div class="stat-icon">✓</div><div><small>Correct</small><b>${correct}</b></div></article><article class="card stat"><div class="stat-icon">!</div><div><small>To review</small><b>${done-correct}</b></div></article><article class="card stat"><div class="stat-icon">↗</div><div><small>Accuracy</small><b>${percent(correct,done)}%</b></div></article></section>`;
}
function courseCard(course) {
  const { answeredCount } = courseProgressSummary(course.id);
  const questionCount = course.questionCount ?? course.questions ?? '—';
  const complete = typeof questionCount === 'number' ? percent(answeredCount, questionCount) : 0;
  return `<article class="card course-card" data-course-card="${esc(course.id)}" tabindex="0" role="button" aria-label="Open course: ${esc(course.title)}"><div class="eyebrow">${esc(course.code || course.category || 'Certification')}</div><h3>${esc(course.title)}</h3><p class="subtle">${esc(course.description || 'Open this course workspace.')}</p><div class="meta"><span>${esc(questionCount)} questions</span>${course.provider ? `<span>${esc(course.provider)}</span>` : ''}</div><progress class="progress" max="100" value="${complete}" aria-label="${complete}% locally complete"></progress><div class="progress-label">${complete}% locally complete</div></article>`;
}
function renderCatalogSection() {
  const q = app.catalogSearch.trim().toLowerCase();
  const visible = q ? app.courses.filter(c => (c.title+c.code+c.provider+c.category).toLowerCase().includes(q)) : app.courses;
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
  const domains = app.data.domains.map(domain => { const qs = domainQuestions(domain.id), done = qs.filter(question => app.progress.answers[question.id]).length, complete = percent(done, qs.length); return `<article class="card domain-card" data-domain="${esc(domain.id)}" tabindex="0" role="button" aria-label="Open domain notes: ${esc(domain.name)}"><div class="eyebrow">${esc(domain.weight ? `${domain.weight}% exam weight` : `Domain ${domain.id}`)}</div><h3>${esc(domain.name)}</h3><p class="subtle">${esc(domain.description || `${qs.length} practice questions`)}</p><progress class="progress" max="100" value="${complete}" aria-label="${done} of ${qs.length} answered"></progress><div class="progress-label">${done}/${qs.length} answered (${complete}%)</div></article>`; }).join('');
  const searchBar = `<div class="catalog-search-wrap"><input id="catalog-search" class="catalog-search" type="search" placeholder="Search certifications…" value="${esc(app.catalogSearch)}" aria-label="Search courses"></div>`;
  const scholarBanner = `<section class="card scholar-hero-card"><div class="scholar-hero-stamp" aria-hidden="true">翰林</div><div class="scholar-hero-content"><div class="eyebrow">Thư Viện Khảo Thí &amp; Giám Định An Ninh Thông Tin</div><h2>CertLab Study Space · Tuyển Tập Biên Soạn Bởi tameruict</h2><p class="subtle">Hệ thống tài liệu ôn thi chứng chỉ quốc tế (CompTIA Security+, Network+, AWS, ISO 27001) và tuyển tập Write-ups phòng thủ mã độc / mạng, xây dựng trên tinh thần thư phòng cổ phong kết hợp phòng thi CBT hiện đại.</p><div class="scholar-hero-actions"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer" class="btn small primary scholar-btn">${GITHUB_SVG}<span>GitHub: @tameruict</span></a><a href="${AUTHOR_FB_URL}" target="_blank" rel="noopener noreferrer" class="btn small scholar-btn">${FACEBOOK_SVG}<span>Facebook Profile</span></a><button class="btn small" type="button" data-action="open-author-modal">📜 Xem Thẻ Danh Nhân / Profile</button></div></div></section>`;
  return topbar(title, app.data.metadata?.description || app.course.description) + scholarBanner + statsHtml() + `<section class="section-head"><div><h2>Syllabus domains</h2><p>Select a domain for Notion-style study notes or launch the CBT practice room.</p></div><button class="btn primary" type="button" data-view="practice">Enter Practice CBT →</button></section><section class="grid domain-grid">${domains}</section><section class="section-head"><div><h2>Course catalog</h2><p>Switch among certification tracks without mixing progress.</p></div>${searchBar}</section>${renderCatalogSection()}`;
}
function objectiveCard(item, domain) {
  if (typeof item === 'string') return `<div class="objective notion-callout"><div class="callout-body"><b>${esc(item)}</b></div></div>`;
  const title = item.title ?? item.name ?? item.id ?? 'Objective';
  const objId = item.id ?? null;
  const objQs = objId ? app.data.questions.filter(q => q.domainId === String(domain.id) && q.objectiveId != null && String(q.objectiveId) === String(objId)) : [];
  const objDone = objQs.filter(q => app.progress.answers[q.id]).length;
  const idBadge = objId ? `<span class="obj-code">${esc(objId)}</span>` : '';
  const progressBadge = objQs.length ? `<span class="obj-progress">${objDone}/${objQs.length} answered</span>` : '';
  const refs = Array.isArray(item.refs) && item.refs.length ? `<div class="obj-refs"><span class="prop-label">Refs</span>${item.refs.map(r => `<code>${esc(r)}</code>`).join(' ')}</div>` : '';
  const summary = item.summary ? `<div class="notion-callout objective-summary"><div class="callout-body"><p>${esc(item.summary)}</p></div></div>` : '';
  const notes = item.notes_md ? `<div class="notes-md article-body">${mdLite(item.notes_md)}</div>` : '';
  return `<details class="objective notion-toggle" open><summary class="objective-hd"><div class="objective-title-wrap">${idBadge}<b>${esc(title)}</b></div>${progressBadge}</summary><div class="objective-body">${summary}${notes}${refs}</div></details>`;
}
function writeupsHeader(articleTitle = '') {
  const courseCode = esc(app.course?.code || 'Workspace');
  const trail = articleTitle
    ? `<button class="breadcrumb-link" type="button" data-writeup-back>Write-ups</button><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">${esc(articleTitle)}</span>`
    : `<span class="breadcrumb-current">Write-ups</span>`;
  return `<header class="notion-topbar"><nav class="notion-breadcrumb" aria-label="Breadcrumb"><span class="breadcrumb-root">${courseCode}</span><span class="breadcrumb-sep">/</span>${trail}</nav><div class="notion-topbar-meta"><a href="${AUTHOR_GITHUB_URL}" target="_blank" rel="noopener noreferrer" class="author-header-pill" title="GitHub: @tameruict"><span class="seal-mark-xs">泰</span> tameruict</a><span class="pill">Tủ Sách Kỹ Thuật</span></div></header>`;
}
function renderWriteups() {
  const state = app.writeups;
  if (state.loading) return writeupsHeader() + `<section class="card"><p>Loading write-ups…</p></section>`;
  if (state.error) return writeupsHeader() + `<section class="card"><h2>Write-ups are not available yet</h2><p class="subtle">${esc(state.error === 'supabase_not_configured' ? 'Supabase is not configured for this deployment.' : 'The write-ups library could not be loaded. The study_articles table may not have been imported yet.')}</p><button class="btn" type="button" data-action="retry-writeups">Retry</button></section>`;
  if (state.selectedSlug) {
    if (state.detailLoading) return writeupsHeader('Loading…') + `<section class="card"><p>Loading article…</p></section><button class="btn" type="button" data-writeup-back>← Back to write-ups</button>`;
    if (state.detailError || !state.detail) return writeupsHeader('Not found') + `<section class="card"><h2>Article not found</h2><p class="subtle">${esc(state.detailError || 'This article is not available.')}</p><div class="question-actions"><button class="btn" type="button" data-writeup-back>← Back to write-ups</button></div></section>`;
    const article = state.detail;
    const base = articlesImageBase();
    const { html, headings } = renderMarkdownWithToc(rewriteImageUrls(article.markdown, base));
    const cover = coverImageUrl(article.coverUrl, base);
    const progress = state.progress[article.id] || {};
    const published = article.publishedAt ? esc(String(article.publishedAt).slice(0, 10)) : '—';
    const toc = headings.length
      ? `<aside class="article-toc-rail"><nav class="article-toc" aria-label="Article contents"><div class="toc-title">On this page</div><ul>${headings.map((h) => `<li class="toc-level-${h.level}"><a href="#${esc(h.id)}" data-toc="${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ul></nav></aside>`
      : '';
    return writeupsHeader(article.title) + `<section class="article-view"><div class="article-toolbar"><button class="btn small" type="button" data-writeup-back>← Back to database</button><div class="lang-switch" role="group" aria-label="Article language"><button class="lang-btn ${state.filters.language === 'vi' ? 'active' : ''}" type="button" data-writeup-lang="vi">VI</button><button class="lang-btn ${state.filters.language === 'en' ? 'active' : ''}" type="button" data-writeup-lang="en">EN</button></div></div><div class="notion-page-layout ${headings.length ? 'has-toc' : ''}"><article class="card article-card">${cover ? `<div class="article-cover-banner"><img class="article-cover" src="${esc(cover)}" alt=""></div>` : ''}<div class="article-header"><h1 class="notion-page-title">${esc(article.title)}</h1>${article.description ? `<p class="notion-page-lead">${esc(article.description)}</p>` : ''}<div class="notion-props" role="list" aria-label="Article properties"><div class="notion-prop-row" role="listitem"><span class="notion-prop-key">Platform</span><div class="notion-prop-val"><span class="prop-pill prop-platform">${esc(article.platform || 'General')}</span></div></div><div class="notion-prop-row" role="listitem"><span class="notion-prop-key">Category</span><div class="notion-prop-val"><span class="prop-pill prop-category">${esc(article.category || 'Write-up')}</span></div></div><div class="notion-prop-row" role="listitem"><span class="notion-prop-key">Difficulty</span><div class="notion-prop-val"><span class="prop-pill" data-difficulty="${esc(article.difficulty)}">${esc(article.difficulty || 'Unspecified')}</span></div></div><div class="notion-prop-row" role="listitem"><span class="notion-prop-key">Published</span><div class="notion-prop-val"><span class="prop-date">${published}</span></div></div>${article.tags.length ? `<div class="notion-prop-row" role="listitem"><span class="notion-prop-key">Tags</span><div class="notion-prop-val">${article.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}<div class="notion-prop-row" role="listitem"><span class="notion-prop-key">Status</span><div class="notion-prop-val"><button class="btn small ${progress.bookmarked ? 'primary' : ''}" type="button" data-writeup-bookmark="${esc(article.id)}">${progress.bookmarked ? '★ Bookmarked' : '☆ Bookmark'}</button><button class="btn small ${progress.completed ? 'primary' : ''}" type="button" data-writeup-complete="${esc(article.id)}">${progress.completed ? '✓ Read' : 'Mark as read'}</button></div></div></div></div><hr class="notion-divider"><div class="article-body">${html}</div><div class="question-actions article-footer-actions"><button class="btn" type="button" data-writeup-back>← Back to write-ups</button><div class="top-actions"><button class="btn ${progress.bookmarked ? 'primary' : ''}" type="button" data-writeup-bookmark="${esc(article.id)}">${progress.bookmarked ? '★ Bookmarked' : '☆ Bookmark'}</button><button class="btn ${progress.completed ? 'primary' : ''}" type="button" data-writeup-complete="${esc(article.id)}">${progress.completed ? '✓ Read' : 'Mark as read'}</button></div></div></article>${toc}</div></section>`;
  }
  const filtered = sortArticles(filterArticles(state.articles, state.filters));
  const platforms = getPlatforms(state.articles);
  const categories = getCategories(state.articles);
  const totalInLang = state.articles.filter((a) => a.language === state.filters.language).length;
  const viewMode = state.viewMode || 'gallery';
  const filtersHtml = `<div class="notion-db-header"><div><h1 class="notion-db-title">Write-ups Knowledge Base</h1><p class="subtle">Lab write-ups from tameruict.github.io, stored in Supabase as structured Notion pages.</p></div><div class="notion-db-controls"><div class="lang-switch" role="group" aria-label="Language"><button class="lang-btn ${state.filters.language === 'vi' ? 'active' : ''}" type="button" data-writeup-lang="vi">Tiếng Việt</button><button class="lang-btn ${state.filters.language === 'en' ? 'active' : ''}" type="button" data-writeup-lang="en">English</button></div><div class="view-switch" role="group" aria-label="Database view"><button class="lang-btn ${viewMode === 'gallery' ? 'active' : ''}" type="button" data-writeup-view="gallery">⊞ Gallery</button><button class="lang-btn ${viewMode === 'table' ? 'active' : ''}" type="button" data-writeup-view="table">☰ Table</button></div></div></div><form class="writeup-filters notion-toolbar" role="search"><div class="toolbar-search"><input id="writeup-search" type="search" autocomplete="off" placeholder="Search title, tag, or technique…" value="${esc(state.filters.query)}" aria-label="Search write-ups"></div><div class="toolbar-pills"><select id="writeup-platform" aria-label="Platform"><option value="">Platform: All</option>${platforms.map((p) => `<option value="${esc(p)}" ${state.filters.platform === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select><select id="writeup-category" aria-label="Category"><option value="">Category: All</option>${categories.map((c) => `<option value="${esc(c)}" ${state.filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><select id="writeup-difficulty" aria-label="Difficulty"><option value="">Difficulty: All</option>${['Easy', 'Medium', 'Hard', 'Insane'].map((d) => `<option value="${d}" ${state.filters.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select><select id="writeup-language" class="sr-only" aria-label="Language"><option value="vi" ${state.filters.language === 'vi' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${state.filters.language === 'en' ? 'selected' : ''}>English</option></select><button class="btn small" type="button" data-action="reset-writeup-filters">Reset</button></div><div class="result-summary"><span>Showing <strong>${filtered.length}</strong> of <strong>${totalInLang}</strong></span></div></form>`;
  const renderCard = (article) => {
    const progress = state.progress[article.id] || {};
    const cover = coverImageUrl(article.coverUrl, articlesImageBase());
    const date = article.publishedAt ? esc(String(article.publishedAt).slice(0, 10)) : '';
    return `<article class="card writeup-card" data-writeup-open="${esc(article.slug)}" tabindex="0" role="button" aria-label="Read article: ${esc(article.title)}">${cover ? `<div class="writeup-cover-wrap"><img class="writeup-cover" src="${esc(cover)}" alt="" loading="lazy"></div>` : `<div class="writeup-cover-wrap writeup-cover-placeholder"><span>${esc(article.platform || 'WRITE-UP')}</span></div>`}<div class="writeup-card-body"><div class="writeup-props-top"><span class="prop-pill prop-platform">${esc(article.platform)}</span><span class="prop-pill prop-category">${esc(article.category)}</span><span class="prop-pill" data-difficulty="${esc(article.difficulty)}">${esc(article.difficulty)}</span>${article.featured ? '<span class="prop-pill prop-featured">★ Featured</span>' : ''}</div><h3>${esc(article.title)}</h3><p class="subtle writeup-desc">${esc(article.description)}</p><div class="article-meta">${date ? `<span class="prop-date">${date}</span>` : ''}${article.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${progress.bookmarked ? '<span class="status-pill bookmarked">★ Saved</span>' : ''}${progress.completed ? '<span class="status-pill completed">✓ Read</span>' : ''}</div></div></article>`;
  };
  const renderRow = (article) => {
    const progress = state.progress[article.id] || {};
    const date = article.publishedAt ? esc(String(article.publishedAt).slice(0, 10)) : '—';
    return `<div class="notion-db-row" data-writeup-open="${esc(article.slug)}" tabindex="0" role="button" aria-label="Read article: ${esc(article.title)}"><div class="db-col-title"><strong>${esc(article.title)}</strong>${progress.completed ? '<span class="status-pill completed">✓</span>' : ''}${progress.bookmarked ? '<span class="status-pill bookmarked">★</span>' : ''}</div><div class="db-col-prop"><span class="prop-pill prop-platform">${esc(article.platform)}</span></div><div class="db-col-prop"><span class="prop-pill prop-category">${esc(article.category)}</span></div><div class="db-col-prop"><span class="prop-pill" data-difficulty="${esc(article.difficulty)}">${esc(article.difficulty)}</span></div><div class="db-col-tags">${article.tags.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div><div class="db-col-date">${date}</div></div>`;
  };
  const listHtml = filtered.length
    ? (viewMode === 'table'
        ? `<div class="notion-db-table"><div class="notion-db-row notion-db-head"><div>Title</div><div>Platform</div><div>Category</div><div>Difficulty</div><div>Tags</div><div>Published</div></div>${filtered.map(renderRow).join('')}</div>`
        : `<div class="writeup-list notion-db-gallery">${filtered.map(renderCard).join('')}</div>`)
    : `<div class="card empty"><h3>No results</h3><p class="subtle">Try another keyword or remove some filters.</p><button class="btn" type="button" data-action="reset-writeup-filters">Show all</button></div>`;
  return writeupsHeader() + `<section class="writeup-archive">${filtersHtml}${listHtml}</section>`;
}
function renderNotes() {
  const cards = app.data.domains.map(domain => {
    const objItems = safeArray(domain.objectives);
    const qsCount = domainQuestions(domain.id).length;
    const objectives = objItems.length
      ? objItems.map(item => objectiveCard(item, domain)).join('')
      : `<div class="objective notion-callout"><div class="callout-body"><b>Practice focus</b><p>Use the course questions tagged to this domain to validate your understanding.</p></div></div>`;
    return `<article class="card notion-domain-card"><div class="notion-domain-hd"><div><div class="eyebrow">${esc(domain.weight ? `Domain ${domain.id} · ${domain.weight}% exam weight` : `Domain ${domain.id}`)}</div><h2>${esc(domain.name)}</h2>${domain.description ? `<p class="subtle">${esc(domain.description)}</p>` : ''}</div><div class="top-actions"><span class="pill">${qsCount} practice questions</span><button class="btn small primary" type="button" data-domain-practice="${esc(domain.id)}">Practice domain →</button></div></div><div class="objective-list">${objectives}</div></article>`;
  }).join('');
  return topbar('Domain notes', 'Structured Notion-style exam objectives and reference notes. Expand or collapse any objective block.') + `<section class="notion-notes-stack">${cards}</section><section class="card notion-callout-banner"><div><div class="eyebrow">Supplementary knowledge base</div><h2>Write-ups library</h2><p class="subtle">Supplementary lab write-ups, kept separate from this course exam notes.</p></div><button class="btn primary" type="button" data-view="writeups">Open Write-ups →</button></section>`;
}
function filteredQuestions() {
  let list = app.practiceFilter === 'all' ? app.data.questions : domainQuestions(app.practiceFilter);
  if (app.practiceDiffFilter !== 'all') list = list.filter(q => q.difficulty === app.practiceDiffFilter);
  if (app.practiceTagFilter !== 'all') list = list.filter(q => q.tags.includes(app.practiceTagFilter));
  return list;
}
function paletteHtml(questions, currentIndex, mode) {
  let doneCount = 0, flagCount = 0;
  const cells = questions.map((q, idx) => {
    const rec = app.progress.answers[q.id];
    const flagged = Boolean(app.progress.bookmarks[q.id]);
    if (rec) doneCount++;
    if (flagged) flagCount++;
    const stateClass = [
      idx === currentIndex ? 'is-current' : '',
      rec ? (rec.correct ? 'is-correct' : 'is-incorrect') : '',
      flagged ? 'is-flagged' : ''
    ].filter(Boolean).join(' ');
    return `<button type="button" class="palette-btn ${stateClass}" data-jump-index="${idx}" data-jump-mode="${esc(mode)}" aria-label="Question ${idx + 1}"${idx === currentIndex ? ' aria-current="step"' : ''}>${idx + 1}</button>`;
  }).join('');
  return `<aside class="card cbt-palette" aria-label="Question navigator"><div class="palette-head"><b>Question Navigator</b><span class="meta">${doneCount}/${questions.length} checked</span></div><div class="palette-legend"><span><i class="dot current"></i>Current</span><span><i class="dot correct"></i>Correct</span><span><i class="dot incorrect"></i>Incorrect</span><span><i class="dot flagged"></i>Marked (${flagCount})</span></div><div class="palette-grid">${cells}</div></aside>`;
}
function questionHtml(question, position, total, mode, list = [question]) {
  const record = app.progress.answers[question.id]; const selected = record?.selected || pendingValues(question.id);
  const submitted = Boolean(record); const multiple = question.type === 'multiple_choice';
  const bookmarked = Boolean(app.progress.bookmarks[question.id]);
  const diffBadge = question.difficulty ? `<span class="cbt-badge diff-${esc(question.difficulty)}">${esc(question.difficulty)}</span>` : '';
  const typeBadge = `<span class="cbt-badge">${multiple ? 'Multiple select' : 'Single choice'}</span>`;
  const tagPills = question.tags?.length ? `<div class="cbt-tags">${question.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '';
  const options = question.options.map((option, index) => {
    const chosen = selected.includes(option.key);
    const isCorrectOption = question.correct.includes(option.key);
    const resultClass = submitted ? (isCorrectOption ? 'correct' : chosen ? 'incorrect' : '') : chosen ? 'selected' : '';
    const stateTag = submitted ? (isCorrectOption ? '<span class="opt-state good">✓ Key</span>' : chosen ? '<span class="opt-state bad">✗ Selected</span>' : '') : '';
    return `<button class="option ${resultClass}" type="button" data-option="${esc(option.key)}" data-question="${esc(question.id)}" ${submitted ? 'disabled' : ''}><span class="option-control ${multiple ? 'checkbox' : 'radio'}" aria-hidden="true"></span><span class="option-key">${keyLabel(index)}</span><span class="option-label">${esc(option.text)}</span>${stateTag}</button>`;
  }).join('');
  const feedback = submitted ? `<div class="explanation"><b class="status ${record.correct ? 'good' : 'bad'}">${record.correct ? 'Correct' : 'Not quite'}</b>${question.explanation ? `<p>${esc(question.explanation)}</p>` : ''}</div>` : '';
  return `<div class="cbt-body"><article class="card question-card cbt-sheet"><header class="cbt-sheet-head"><div class="question-number">${esc(mode)} · Question ${position + 1} of ${total}${multiple ? ' · Select all that apply' : ''}</div><div class="cbt-badges"><span class="cbt-badge domain">${esc(domainName(question.domainId))}</span>${typeBadge}${diffBadge}</div></header><div class="cbt-stem"><div class="question-text">${esc(question.prompt)}</div>${tagPills}</div><div class="options" role="group" aria-label="Answer options">${options}</div>${feedback}<div class="question-actions cbt-footer"><div class="cbt-nav-left"><button class="btn small" type="button" data-prev="${esc(mode)}">← Previous</button><button class="btn small ${bookmarked ? 'flagged' : ''}" type="button" data-bookmark="${esc(question.id)}" aria-pressed="${bookmarked ? 'true' : 'false'}">${bookmarked ? '★ Saved for review' : '☆ Save for review'}</button></div><div class="cbt-nav-right">${!submitted ? `<button class="btn small" type="button" data-next="${esc(mode)}">Skip →</button><button class="btn primary" type="button" data-submit="${esc(question.id)}" ${selected.length ? '' : 'disabled'}>Check answer</button>` : `<button class="btn primary" type="button" data-next="${esc(mode)}">Next question</button>`}</div></div></article>${paletteHtml(list, position, mode)}</div>`;
}
function renderPractice() {
  const all = filteredQuestions();
  if (app.questionIndex >= all.length) app.questionIndex = 0;
  if (!all.length) return topbar('Practice questions','Answer explanations appear after you check an answer.') + `<section class="card"><p class="empty">No questions match the current filters. Try clearing some filters.</p><div class="question-actions"><button class="btn" type="button" data-action="clear-practice-filters">Clear filters</button></div></section>`;
  const question = all[app.questionIndex];
  const domainOpts = [`<option value="all">All domains (${app.data.questions.length})</option>`, ...app.data.domains.map(d => `<option value="${esc(d.id)}" ${app.practiceFilter === d.id ? 'selected' : ''}>${esc(d.name)} (${domainQuestions(d.id).length})</option>`)].join('');
  const hasDiff = app.data.questions.some(q => q.difficulty);
  const diffOpts = hasDiff ? `<label class="field">Difficulty<select id="diff-filter"><option value="all">All</option>${['easy','medium','hard'].map(d => `<option value="${d}" ${app.practiceDiffFilter===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}</select></label>` : '';
  const allTags = [...new Set(app.data.questions.flatMap(q => q.tags))].sort();
  const tagOpts = allTags.length ? `<label class="field">Tag<select id="tag-filter"><option value="all">All tags</option>${allTags.map(t => `<option value="${esc(t)}" ${app.practiceTagFilter===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>` : '';
  const answeredInFilter = all.filter(q => app.progress.answers[q.id]).length;
  return topbar('Practice CBT','TOEIC-style CBT practice room — check answers immediately or jump across the question navigator.') + `<section class="question-tools cbt-toolbar"><label class="field">Domain<select id="practice-filter">${domainOpts}</select></label>${diffOpts}${tagOpts}<div class="cbt-toolbar-actions"><button class="btn small" type="button" data-action="shuffle-practice">Shuffle</button><span class="pill">${answeredInFilter} / ${all.length} checked</span></div></section>${questionHtml(question, app.questionIndex, all.length, 'practice', all)}`;
}
function renderFlashcards() {
  const questions = filteredQuestions();
  if (!questions.length) return topbar('Flashcards','Click the card to reveal the explanation and reinforce recall.') + `<section class="card"><p class="empty">No flashcards available for this filter.</p></section>`;
  if (app.flashIndex >= questions.length) app.flashIndex = 0;
  const question = questions[app.flashIndex];
  const bookmarked = Boolean(app.progress.bookmarks[question.id]);
  const answerText = question.correct.map(key => question.options.find(option => option.key === key)?.text).filter(Boolean).join(' • ');
  const face = app.flashBack ? (question.explanation ? `${answerText ? `Answer: ${answerText}\n\n` : ''}${question.explanation}` : answerText) : question.prompt;
  const pct = percent(app.flashIndex + 1, questions.length);
  return topbar('Flashcards','Click the card or press Space/Enter to reveal the explanation and reinforce recall.') + `<section class="question-tools cbt-toolbar"><label class="field">Scope<select id="flash-filter"><option value="all">All domains (${app.data.questions.length})</option>${app.data.domains.map(domain => `<option value="${esc(domain.id)}" ${app.practiceFilter === domain.id ? 'selected' : ''}>${esc(domain.name)} (${domainQuestions(domain.id).length})</option>`).join('')}</select></label><div class="cbt-toolbar-actions"><button class="btn small ${bookmarked ? 'flagged' : ''}" type="button" data-bookmark="${esc(question.id)}" aria-pressed="${bookmarked ? 'true' : 'false'}">${bookmarked ? '★ Saved' : '☆ Save card'}</button><span class="pill">Card ${app.flashIndex + 1} / ${questions.length}</span></div></section><progress class="progress" max="100" value="${pct}" aria-label="Deck position ${app.flashIndex + 1} of ${questions.length}"></progress><section class="flashcard ${app.flashBack ? 'is-back' : 'is-front'}" data-flip-card tabindex="0" role="button" aria-pressed="${app.flashBack ? 'true' : 'false'}" aria-label="${app.flashBack ? 'Show flashcard prompt' : 'Reveal flashcard explanation'}"><div class="flash-inner"><div class="flash-meta"><span class="cbt-badge domain">${esc(domainName(question.domainId))}</span><span class="cbt-badge">${app.flashBack ? 'Back · Answer & Rationale' : 'Front · Question Prompt'}</span></div><div class="flash-content">${esc(face)}</div><small class="flash-hint">${app.flashBack ? 'Explanation — click to see the prompt' : 'Prompt — click to reveal'}</small></div></section><div class="question-actions"><button class="btn" type="button" data-flash="prev">← Previous</button><span class="meta">Tip: Space / Enter to flip</span><button class="btn primary" type="button" data-flash="next">Next →</button></div>`;
}
function mockRemainingSeconds() { if (!app.mock) return 0; if (app.mock.paused) return app.mock.remainingWhenPaused ?? 0; return Math.max(0, Math.ceil((app.mock.endAt - Date.now()) / 1000)); }
function formatMockTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
async function recordExamAttempt() {
  if (!app.mock || !app.mock.finished || app.mock.archived) return;
  app.mock.archived = true;
  if (!app.course || !app.data) return;
  const total = app.mock.questions.length;
  if (!total) return;
  const results = app.mock.questions.map(q => app.progress?.answers?.[q.id]).filter(Boolean);
  const correct = results.filter(r => r.correct).length;
  const scorePercent = percent(correct, total);
  const startedAt = app.mock.startedAt || Date.now();
  const durationSeconds = Math.max(0, Math.min(86400, Math.round((Date.now() - startedAt) / 1000)));
  const breakdown = {};
  for (const domain of app.data.domains) {
    const dQs = app.mock.questions.filter(q => String(q.domainId) === String(domain.id));
    if (!dQs.length) continue;
    const dCorrect = dQs.filter(q => app.progress?.answers?.[q.id]?.correct).length;
    breakdown[domain.id] = { total: dQs.length, correct: dCorrect, percent: percent(dCorrect, dQs.length) };
  }
  const attemptRow = {
    course_id: app.course.id,
    total_questions: total,
    answered_count: results.length,
    correct_count: correct,
    score_percent: scorePercent,
    duration_seconds: durationSeconds,
    domain_breakdown: breakdown,
    completed_at: new Date().toISOString()
  };
  app.examHistory = [attemptRow, ...(app.examHistory || [])].slice(0, 5);
  if (!supabase || !app.auth.user || typeof supabase.from !== 'function') return;
  const { error } = await supabase.from('user_exam_attempts').insert({
    user_id: app.auth.user.id,
    course_id: attemptRow.course_id,
    total_questions: attemptRow.total_questions,
    answered_count: attemptRow.answered_count,
    correct_count: attemptRow.correct_count,
    score_percent: attemptRow.score_percent,
    duration_seconds: attemptRow.duration_seconds,
    domain_breakdown: attemptRow.domain_breakdown
  });
  if (error && !/relation .* does not exist|schema cache/i.test(error.message || '')) {
    toast(`Exam history sync failed: ${error.message}`);
  }
}
function tickMockTimer() {
  if (!app.mock || app.mock.finished || app.mock.paused) return;
  const remaining = mockRemainingSeconds();
  if (remaining === 0) { app.mock.finished = true; clearInterval(app.timer); app.timer = null; void recordExamAttempt(); render(); return; }
  const timerEl = document.querySelector('.timer');
  if (timerEl) { const text = formatMockTime(remaining); if (timerEl.textContent !== text) timerEl.textContent = text; }
}
function startMock() { const size = Math.min(Number(app.data.metadata?.mockQuestionCount ?? app.course.mockQuestionCount ?? 20), app.data.questions.length); const seconds = Number(app.data.metadata?.mockDurationSeconds ?? app.course.mockDurationSeconds ?? size * 75); app.mock = { questions: [...app.data.questions].sort(() => Math.random() - .5).slice(0,size), index:0, startedAt: Date.now(), endAt: Date.now() + seconds * 1000, finished:false, paused:false, remainingWhenPaused:null, archived:false }; app.timer = setInterval(tickMockTimer, 1000); }
function toggleMockPause() {
  if (!app.mock || app.mock.finished) return;
  if (app.mock.paused) { app.mock.endAt = Date.now() + (app.mock.remainingWhenPaused ?? 0) * 1000; app.mock.paused = false; app.mock.remainingWhenPaused = null; clearInterval(app.timer); app.timer = setInterval(tickMockTimer, 1000); }
  else { app.mock.remainingWhenPaused = mockRemainingSeconds(); app.mock.paused = true; clearInterval(app.timer); app.timer = null; }
  render();
}
function renderExamHistorySection() {
  if (!Array.isArray(app.examHistory) || !app.examHistory.length) return '';
  const cards = app.examHistory.map(attempt => {
    const date = attempt.completed_at ? esc(String(attempt.completed_at).slice(0, 10)) : 'Recent';
    const scorePct = Number(attempt.score_percent) || 0;
    const correct = Number(attempt.correct_count) || 0;
    const total = Number(attempt.total_questions) || 0;
    const duration = formatMockTime(Number(attempt.duration_seconds) || 0);
    return `<article class="card domain-card"><div class="eyebrow">${date} · ${duration}</div><h3>${scorePct}% score</h3><progress class="progress" max="100" value="${scorePct}" aria-label="${scorePct}% score"></progress><div class="progress-label">${correct}/${total} correct</div></article>`;
  }).join('');
  return `<section class="section-head"><div><h2>Recent mock attempts</h2><p>Saved CBT mock exam history for this certification.</p></div></section><section class="grid domain-grid">${cards}</section>`;
}
function renderMock() {
  if (!app.mock) {
    const sampleSize = Math.min(Number(app.data.metadata?.mockQuestionCount ?? app.course.mockQuestionCount ?? 20), app.data.questions.length);
    const durationMin = Math.round(Number(app.data.metadata?.mockDurationSeconds ?? app.course.mockDurationSeconds ?? sampleSize * 75) / 60);
    return topbar('Timed mock exam','Simulate a focused, timed TOEIC / ETS style CBT assessment.') + `<section class="card mock-banner"><div class="eyebrow">CBT Exam Simulator</div><h2>Ready for a timed mock?</h2><p class="subtle">The mock samples questions from this course with a live countdown clock and question navigator palette. Answers are saved to this course progress after checking.</p><div class="grid stats cbt-specs"><article class="card stat"><div class="stat-icon">?</div><div><small>Questions</small><b>${sampleSize}</b></div></article><article class="card stat"><div class="stat-icon">◷</div><div><small>Time limit</small><b>${durationMin} min</b></div></article><article class="card stat"><div class="stat-icon">▤</div><div><small>Domains</small><b>${app.data.domains.length}</b></div></article><article class="card stat"><div class="stat-icon">✓</div><div><small>Mode</small><b>CBT Split</b></div></article></div><button class="btn primary" type="button" data-action="start-mock">Start timed mock</button></section>${renderExamHistorySection()}`;
  }
  const remaining = mockRemainingSeconds();
  if (remaining === 0 && !app.mock.finished && !app.mock.paused) { app.mock.finished = true; clearInterval(app.timer); app.timer = null; }
  const current = app.mock.questions[app.mock.index];
  if (app.mock.finished) {
    void recordExamAttempt();
    const results = app.mock.questions.map(question => app.progress.answers[question.id]).filter(Boolean);
    const score = results.filter(result => result.correct).length;
    const total = app.mock.questions.length;
    const pct = percent(score, total);
    const domainBreakdown = app.data.domains.map(domain => {
      const dQs = app.mock.questions.filter(q => String(q.domainId) === String(domain.id));
      if (!dQs.length) return '';
      const dCorrect = dQs.filter(q => app.progress.answers[q.id]?.correct).length;
      const dPct = percent(dCorrect, dQs.length);
      return `<article class="card domain-card"><div class="eyebrow">${esc(domain.weight ? `${domain.weight}% exam weight` : `Domain ${domain.id}`)}</div><h3>${esc(domain.name)}</h3><progress class="progress" max="100" value="${dPct}" aria-label="${dCorrect} of ${dQs.length} correct"></progress><div class="progress-label">${dCorrect}/${dQs.length} correct (${dPct}%)</div></article>`;
    }).filter(Boolean).join('');
    const breakdownHtml = domainBreakdown ? `<section class="section-head"><div><h2>Domain breakdown</h2><p>Performance across sampled exam domains.</p></div></section><section class="grid domain-grid">${domainBreakdown}</section>` : '';
    return topbar('Mock completed',`Score: ${score}/${total}.`) + `<section class="card mock-banner"><div class="eyebrow">Official CBT Score Report</div><h2>Exam session complete — ${pct}%</h2><p class="subtle">Your checked answers remain in course progress. Review missed questions to target weak areas.</p><div class="grid stats cbt-specs"><article class="card stat"><div class="stat-icon">✓</div><div><small>Correct</small><b>${score}/${total}</b></div></article><article class="card stat"><div class="stat-icon">◌</div><div><small>Checked</small><b>${results.length}/${total}</b></div></article><article class="card stat"><div class="stat-icon">!</div><div><small>Missed</small><b>${total - score}</b></div></article><article class="card stat"><div class="stat-icon">↗</div><div><small>Score</small><b>${pct}%</b></div></article></div><div class="question-actions"><button class="btn" type="button" data-view="review">Review missed questions</button><button class="btn primary" type="button" data-action="start-mock">Start another mock</button></div></section>${breakdownHtml}${renderExamHistorySection()}`;
  }
  return topbar('Timed mock exam','Use the timer and question navigator palette as a pacing guide.') + `<section class="card mock-banner cbt-header"><div class="cbt-header-left"><span class="cbt-mode-pill">CBT TIMED EXAM</span><span>Question <b>${app.mock.index + 1}</b> of <b>${app.mock.questions.length}</b></span><span class="cbt-badge domain">${esc(domainName(current.domainId))}</span></div><div class="cbt-header-right"><div class="cbt-clock ${remaining <= 60 ? 'urgent' : ''}"><small>Time Left</small><span class="timer" aria-live="off">${formatMockTime(remaining)}</span></div><button class="btn small" type="button" data-action="pause-mock" aria-pressed="${app.mock.paused ? 'true' : 'false'}">${app.mock.paused ? 'Resume timer' : 'Pause timer'}</button><button class="btn danger small" type="button" data-action="finish-mock">Finish mock</button></div></section>${questionHtml(current, app.mock.index, app.mock.questions.length, 'mock', app.mock.questions)}`;
}
function renderAllOverview() {
  let totalQ = 0, totalAnswered = 0, totalCorrect = 0;
  const rows = app.courses.map(course => {
    const { answeredCount, correctCount: correct } = courseProgressSummary(course.id);
    const qCount = typeof (course.questionCount ?? course.questions) === 'number' ? (course.questionCount ?? course.questions) : 0;
    totalQ += qCount; totalAnswered += answeredCount; totalCorrect += correct;
    const pct = percent(answeredCount, qCount);
    const acc = percent(correct, answeredCount);
    return `<article class="card course-card overview-row" data-course-card="${esc(course.id)}" tabindex="0" role="button" aria-label="Open course: ${esc(course.title)}"><div class="eyebrow">${esc(course.category || course.code || 'Cert')}</div><h3>${esc(course.title)}</h3><div class="meta"><span>${answeredCount}/${qCount} answered</span><span>${acc}% accuracy</span></div><progress class="progress" max="100" value="${pct}" aria-label="${pct}% complete"></progress><div class="progress-label">${pct}% complete</div></article>`;
  }).join('');
  const overallAcc = percent(totalCorrect, totalAnswered);
  const overallPct = percent(totalAnswered, totalQ);
  return `<header class="topbar"><div><div class="eyebrow">All certifications</div><h1>Study overview</h1><p class="subtle">Progress across all courses in your catalog.</p></div><div class="top-actions"><span class="pill">${esc(app.auth.username || 'Signed in')} · ${totalAnswered} answered total</span></div></header><section class="grid stats"><article class="card stat"><div class="stat-icon">◌</div><div><small>Overall completion</small><b>${overallPct}%</b></div></article><article class="card stat"><div class="stat-icon">✓</div><div><small>Total correct</small><b>${totalCorrect}</b></div></article><article class="card stat"><div class="stat-icon">↗</div><div><small>Overall accuracy</small><b>${overallAcc}%</b></div></article><article class="card stat"><div class="stat-icon">◻</div><div><small>Courses</small><b>${app.courses.length}</b></div></article></section><section class="section-head"><div><h2>Per-course progress</h2></div></section><section class="grid course-grid">${rows}</section>`;
}
function renderReview() {
  const allReview = app.data.questions.filter(question => app.progress.bookmarks[question.id] || app.progress.answers[question.id]?.correct === false);
  const flaggedCount = allReview.filter(q => app.progress.bookmarks[q.id]).length;
  const incorrectCount = allReview.filter(q => app.progress.answers[q.id]?.correct === false).length;
  const filter = app.reviewFilter || 'all';
  const review = allReview.filter(q => {
    if (filter === 'flagged') return Boolean(app.progress.bookmarks[q.id]);
    if (filter === 'incorrect') return app.progress.answers[q.id]?.correct === false;
    return true;
  });
  const filterBar = allReview.length
    ? `<div class="cbt-toolbar"><div class="review-filters" role="group" aria-label="Filter review queue"><button class="btn small ${filter === 'all' ? 'primary' : ''}" type="button" data-review-filter="all">All (${allReview.length})</button><button class="btn small ${filter === 'flagged' ? 'primary' : ''}" type="button" data-review-filter="flagged">★ Saved (${flaggedCount})</button><button class="btn small ${filter === 'incorrect' ? 'primary' : ''}" type="button" data-review-filter="incorrect">✗ Incorrect (${incorrectCount})</button></div></div>`
    : '';
  const rows = review.map(question => {
    const isFlagged = Boolean(app.progress.bookmarks[question.id]);
    const isWrong = app.progress.answers[question.id]?.correct === false;
    const qNum = (question.sourceIndex ?? app.data.questions.indexOf(question)) + 1;
    return `<div class="review-row"><div class="review-main"><div class="review-badges"><span class="cbt-badge">#${qNum}</span><span class="cbt-badge domain">${esc(domainName(question.domainId))}</span>${isFlagged ? '<span class="cbt-badge flagged-badge">★ Saved</span>' : ''}${isWrong ? '<span class="cbt-badge bad-badge">✗ Incorrect</span>' : ''}</div><div class="review-prompt">${esc(question.prompt.slice(0,140))}${question.prompt.length > 140 ? '…' : ''}</div></div><div class="review-actions"><button class="btn small ${isFlagged ? 'flagged' : ''}" type="button" data-bookmark="${esc(question.id)}" aria-label="Toggle bookmark">${isFlagged ? '★' : '☆'}</button><button class="btn small primary" type="button" data-open-question="${esc(question.id)}">Open</button></div></div>`;
  }).join('');
  return topbar('Review queue','Saved and incorrect questions across this course.') + `${filterBar}<section class="card">${rows || '<p class="empty">No questions in review yet. Save a question or practice to build your review queue.</p>'}</section>`;
}
let lastRenderedView = null;
let lastRenderedCourseId = null;
const FOCUS_ATTRS = ['data-course-card', 'data-domain', 'data-option', 'data-submit', 'data-next', 'data-prev', 'data-jump-index', 'data-review-filter', 'data-writeup-open', 'data-writeup-lang', 'data-writeup-view', 'data-bookmark', 'data-view', 'data-action', 'data-flip-card', 'data-flash', 'data-open-question', 'data-domain-practice'];
function escapeSelectorValue(value) { if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value); return String(value).replace(/["\\]/g, '\\$&'); }
function captureFocus() {
  if (typeof document.getElementById !== 'function') return null;
  const el = document.activeElement;
  const shell = document.getElementById('app');
  if (!el || el === document.body || !shell || !shell.contains(el)) return null;
  const descriptor = { id: el.id || null, dataset: {} };
  for (const attr of FOCUS_ATTRS) { if (el.hasAttribute(attr)) descriptor.dataset[attr] = el.getAttribute(attr); }
  if (el.id === 'catalog-search' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    descriptor.value = el.value;
    descriptor.selectionStart = typeof el.selectionStart === 'number' ? el.selectionStart : null;
    descriptor.selectionEnd = typeof el.selectionEnd === 'number' ? el.selectionEnd : null;
  }
  if (!descriptor.id && !Object.keys(descriptor.dataset).length) return null;
  return descriptor;
}
function restoreFocus(descriptor) {
  if (!descriptor || typeof document.getElementById !== 'function') return;
  let el = null;
  if (descriptor.id) el = document.getElementById(descriptor.id);
  if (!el && Object.keys(descriptor.dataset).length) {
    const selector = Object.entries(descriptor.dataset).map(([attr, value]) => `[${attr}="${escapeSelectorValue(value)}"]`).join('');
    el = document.querySelector(selector);
  }
  if (!el && descriptor.dataset['data-submit']) el = document.querySelector('[data-next]');
  if (!el || typeof el.focus !== 'function') return;
  el.focus();
  if ((el.id === 'catalog-search' || el.tagName === 'INPUT') && descriptor.selectionStart !== null && descriptor.selectionStart !== undefined && typeof el.setSelectionRange === 'function') {
    try { const len = (el.value || '').length; el.setSelectionRange(Math.min(descriptor.selectionStart, len), Math.min(descriptor.selectionEnd ?? descriptor.selectionStart, len)); } catch { /* selection is best-effort */ }
  }
}
function render() {
  if (!app.course || !app.data) return;
  const savedFocus = captureFocus();
  const viewChanged = lastRenderedView !== null && (lastRenderedView !== app.view || lastRenderedCourseId !== app.course.id);
  const body = ({dashboard:renderDashboard,notes:renderNotes,practice:renderPractice,flashcards:renderFlashcards,mock:renderMock,review:renderReview,overview:renderAllOverview,writeups:renderWriteups}[app.view] || renderDashboard)();
  $('#app').innerHTML = layoutHtml(body);
  bindEvents();
  lastRenderedView = app.view;
  lastRenderedCourseId = app.course.id;
  if (viewChanged && typeof document.getElementById === 'function') { const main = document.getElementById('main'); if (main) main.focus(); }
  else restoreFocus(savedFocus);
}
function pendingValues(questionId) { return [...app.pending].filter(value => value.startsWith(`${questionId}:`)).map(value => value.slice(questionId.length + 1)); }
function toggleOption(questionId, key) { const question = app.data.questions.find(item => item.id === questionId); if (!question) return; const token = `${questionId}:${key}`; if (question.type === 'single_choice') [...app.pending].filter(item => item.startsWith(`${questionId}:`)).forEach(item => app.pending.delete(item)); if (app.pending.has(token)) app.pending.delete(token); else app.pending.add(token); render(); }
function submitAnswer(questionId) { const question = app.data.questions.find(item => item.id === questionId); const selected = pendingValues(questionId); if (!question || !selected.length) return; const correct = isCorrect(question, selected); app.progress.answers[questionId] = { selected, correct, at: Date.now() }; app.progress.streak = correct ? (Number(app.progress.streak) || 0) + 1 : 0; app.progress.bestStreak = Math.max(Number(app.progress.bestStreak) || 0, app.progress.streak); [...app.pending].filter(item => item.startsWith(`${questionId}:`)).forEach(item => app.pending.delete(item)); saveProgress(); }
function nextQuestion(mode) { if (mode === 'mock' && app.mock) app.mock.index = (app.mock.index + 1) % app.mock.questions.length; else { const list = filteredQuestions(); if (list.length) app.questionIndex = (app.questionIndex + 1) % list.length; } render(); }
function prevQuestion(mode) { if (mode === 'mock' && app.mock) app.mock.index = (app.mock.index - 1 + app.mock.questions.length) % app.mock.questions.length; else { const list = filteredQuestions(); if (list.length) app.questionIndex = (app.questionIndex - 1 + list.length) % list.length; } render(); }
function jumpToQuestion(mode, index) { const idx = Number(index); if (!Number.isInteger(idx) || idx < 0) return; if (mode === 'mock' && app.mock) { if (idx < app.mock.questions.length) app.mock.index = idx; } else { const list = filteredQuestions(); if (idx < list.length) app.questionIndex = idx; } render(); }
function openQuestion(id) { const question = app.data.questions.find(item => item.id === id); if (!question) return; app.practiceFilter = 'all'; app.questionIndex = app.data.questions.indexOf(question); go({ courseId: app.course.id, view:'practice' }); }
function bindEvents() {
  $('#course-picker')?.addEventListener('change', event => go({courseId:event.target.value,view:'dashboard'}));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => go({courseId:app.course.id,view:button.dataset.view})));
  document.querySelectorAll('[data-writeup-open]').forEach(button => button.addEventListener('click', () => { app.writeups.selectedSlug = button.dataset.writeupOpen; go({courseId:app.course.id,view:'writeups',writeupSlug:button.dataset.writeupOpen}); void loadWriteupDetail(button.dataset.writeupOpen); }));
  document.querySelectorAll('[data-writeup-back]').forEach(button => button.addEventListener('click', () => go({courseId:app.course.id,view:'writeups'})));
  document.querySelectorAll('[data-writeup-lang]').forEach(button => button.addEventListener('click', () => { const language = button.dataset.writeupLang; if (!language || app.writeups.filters.language === language) return; app.writeups.filters.language = language; setStoredLanguage(language); if (app.writeups.selectedSlug) void loadWriteupDetail(app.writeups.selectedSlug); render(); }));
  document.querySelectorAll('[data-writeup-view]').forEach(button => button.addEventListener('click', () => { app.writeups.viewMode = button.dataset.writeupView || 'gallery'; render(); }));
  document.querySelectorAll('[data-toc]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); if (typeof document.getElementById === 'function') document.getElementById(link.dataset.toc)?.scrollIntoView({ behavior: 'smooth' }); }));
  document.querySelectorAll('[data-writeup-bookmark]').forEach(button => button.addEventListener('click', async () => { const articleId = button.dataset.writeupBookmark; const current = app.writeups.progress[articleId] || {}; const next = !current.bookmarked; app.writeups.progress[articleId] = { ...current, bookmarked: next }; render(); if (app.auth.user) { const { error } = await saveArticleProgress(app.auth.user.id, articleId, { bookmarked: next }); if (error) app.writeups.progress[articleId] = current; } }));
  document.querySelectorAll('[data-writeup-complete]').forEach(button => button.addEventListener('click', async () => { const articleId = button.dataset.writeupComplete; const current = app.writeups.progress[articleId] || {}; const next = !current.completed; app.writeups.progress[articleId] = { ...current, completed: next }; render(); if (app.auth.user) { const { error } = await saveArticleProgress(app.auth.user.id, articleId, { completed: next }); if (error) app.writeups.progress[articleId] = current; } }));
  $('#writeup-search')?.addEventListener('input', event => { app.writeups.filters.query = event.target.value; render(); });
  $('#writeup-platform')?.addEventListener('change', event => { app.writeups.filters.platform = event.target.value; render(); });
  $('#writeup-category')?.addEventListener('change', event => { app.writeups.filters.category = event.target.value; render(); });
  $('#writeup-difficulty')?.addEventListener('change', event => { app.writeups.filters.difficulty = event.target.value; render(); });
  $('#writeup-language')?.addEventListener('change', event => { const language = event.target.value; app.writeups.filters.language = language; setStoredLanguage(language); if (app.writeups.selectedSlug) void loadWriteupDetail(app.writeups.selectedSlug); render(); });
  document.querySelectorAll('[data-domain]').forEach(button => button.addEventListener('click', () => { app.practiceFilter = button.dataset.domain; app.questionIndex = 0; go({courseId:app.course.id,view:'notes'}); }));
  document.querySelectorAll('[data-domain-practice]').forEach(button => button.addEventListener('click', () => { app.practiceFilter = button.dataset.domainPractice; app.questionIndex=0; go({courseId:app.course.id,view:'practice'}); }));
  document.querySelectorAll('[data-course-card]').forEach(button => button.addEventListener('click', () => go({courseId:button.dataset.courseCard,view:'dashboard'})));
  document.querySelectorAll('[data-course-card],[data-domain],[data-flip-card],[data-writeup-open],[data-action="open-author-modal"]').forEach(el => {
    if (el.tagName === 'BUTTON') return;
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { if (event.key === ' ') event.preventDefault(); el.click(); }
    });
  });
  document.querySelectorAll('[data-modal-backdrop]').forEach(backdrop => backdrop.addEventListener('click', event => {
    if (event?.target === backdrop) { app.authorModalOpen = false; render(); }
  }));
  document.querySelectorAll('.topbar-social-icons a, .sidebar-author-socials a, .scholar-hero-actions a, .author-modal-links a').forEach(link => {
    link.addEventListener('click', event => event.stopPropagation());
  });
  document.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => toggleOption(button.dataset.question, button.dataset.option)));
  document.querySelectorAll('[data-submit]').forEach(button => button.addEventListener('click', () => submitAnswer(button.dataset.submit)));
  document.querySelectorAll('[data-next]').forEach(button => button.addEventListener('click', () => nextQuestion(button.dataset.next)));
  document.querySelectorAll('[data-prev]').forEach(button => button.addEventListener('click', () => prevQuestion(button.dataset.prev)));
  document.querySelectorAll('[data-jump-index]').forEach(button => button.addEventListener('click', () => jumpToQuestion(button.dataset.jumpMode, button.dataset.jumpIndex)));
  document.querySelectorAll('[data-review-filter]').forEach(button => button.addEventListener('click', () => { app.reviewFilter = button.dataset.reviewFilter; render(); }));
  document.querySelectorAll('[data-bookmark]').forEach(button => button.addEventListener('click', () => { const id=button.dataset.bookmark; app.progress.bookmarks[id] = !app.progress.bookmarks[id]; if (!app.progress.bookmarks[id]) delete app.progress.bookmarks[id]; saveProgress(); }));
  $('[data-flip-card]')?.addEventListener('click', () => { app.flashBack=!app.flashBack; render(); });
  document.querySelectorAll('[data-flash]').forEach(button => button.addEventListener('click', () => { const list=filteredQuestions(); app.flashIndex=(app.flashIndex+(button.dataset.flash==='next'?1:-1)+list.length)%list.length; app.flashBack=false; render(); }));
  $('#practice-filter')?.addEventListener('change', event => { app.practiceFilter=event.target.value; app.questionIndex=0; render(); });
  $('#diff-filter')?.addEventListener('change', event => { app.practiceDiffFilter=event.target.value; app.questionIndex=0; render(); });
  $('#tag-filter')?.addEventListener('change', event => { app.practiceTagFilter=event.target.value; app.questionIndex=0; render(); });
  $('#flash-filter')?.addEventListener('change', event => { app.practiceFilter=event.target.value; app.flashIndex=0; app.flashBack=false; render(); });
  $('#catalog-search')?.addEventListener('input', event => { app.catalogSearch=event.target.value; render(); });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => {
    if (event?.target?.closest?.('a')) return;
    const action=button.dataset.action;
    if (action==='open-author-modal') { app.authorModalOpen = true; render(); return; }
    if (action==='close-author-modal') { app.authorModalOpen = false; render(); return; }
    if (action==='toggle-theme') { app.theme = applyTheme(app.theme === 'dark' ? 'light' : 'dark'); render(); return; }
    if (action==='rotate-recovery-code') { void rotateRecoveryCode(); return; }
    if (action==='dismiss-recovery-code') { app.auth.activeRecoveryCode = ''; render(); return; }
    if (action==='logout') { void logout(); return; }
    if (action==='shuffle-practice') { app.data.questions.sort(()=>Math.random()-.5); app.questionIndex=0; render(); }
    if (action==='start-mock') { clearInterval(app.timer); startMock(); render(); }
    if (action==='pause-mock') { toggleMockPause(); return; }
    if (action==='finish-mock' && app.mock) { app.mock.finished=true; clearInterval(app.timer); app.timer=null; render(); }
    if (action==='reset-progress' && confirm(`Reset local progress for ${app.course.title}?`)) { app.progress=baseProgress(); saveProgress(); toast('Course progress reset.'); }
    if (action==='clear-practice-filters') { app.practiceFilter='all'; app.practiceDiffFilter='all'; app.practiceTagFilter='all'; app.questionIndex=0; render(); }
    if (action==='retry-writeups') { app.writeups.loaded=false; app.writeups.loading=false; void loadWriteups(); render(); }
    if (action==='reset-writeup-filters') { const language = app.writeups.filters.language; app.writeups.filters = { query:'', platform:'', category:'', difficulty:'', language }; render(); }
  }));
  document.querySelectorAll('[data-open-question]').forEach(button => button.addEventListener('click', () => openQuestion(button.dataset.openQuestion)));
}
function showError(error) { console.error(error); $('#app').innerHTML = `<main class="error-screen"><div class="loading-card"><h1>Could not load the study catalog</h1><p>Run this app from a local web server and ensure the catalog bundle files are present.</p><pre class="error-detail">${esc(error.message || error)}</pre><button class="btn primary" id="retry" type="button">Retry</button></div></main>`; $('#retry')?.addEventListener('click', boot); }
async function boot() { try { if (!supabase || !isSupabaseConfigured) { renderAuth(); return; } const { data, error } = await supabase.auth.getSession(); if (error) throw error; if (!data.session) { renderAuth(); return; } await activateSession(data.session); await startWorkspace(); } catch (error) { showError(error); } }
if (supabase) supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { app.auth = { user: null, username: '', mode: 'login', recoveryCode: '', activeRecoveryCode: '', hasRecoveryCode: false, recoveryEmail: '' }; app.authReady = false; renderAuth(); return; }
  if (event === 'PASSWORD_RECOVERY') { app.auth.user = session?.user || null; app.auth.mode = 'reset'; renderAuth(); }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && app.authorModalOpen) { event.preventDefault(); app.authorModalOpen = false; render(); return; }
  if (!app.course || !app.data) return;
  const active = document.activeElement;
  if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (app.view === 'flashcards') {
    const list = filteredQuestions();
    if (!list.length) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); app.flashIndex = (app.flashIndex + 1) % list.length; app.flashBack = false; render(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); app.flashIndex = (app.flashIndex - 1 + list.length) % list.length; app.flashBack = false; render(); return; }
    if (event.key.toUpperCase() === 'B') { event.preventDefault(); const q = list[app.flashIndex]; if (q) { app.progress.bookmarks[q.id] = !app.progress.bookmarks[q.id]; if (!app.progress.bookmarks[q.id]) delete app.progress.bookmarks[q.id]; saveProgress(); } return; }
  }
  if (app.view === 'practice' || (app.view === 'mock' && app.mock && !app.mock.finished)) {
    const mode = app.view === 'mock' ? 'mock' : 'practice';
    if (event.key === 'ArrowRight') { event.preventDefault(); nextQuestion(mode); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); prevQuestion(mode); return; }
    const current = mode === 'mock' ? app.mock.questions[app.mock.index] : filteredQuestions()[app.questionIndex];
    if (!current) return;
    if (event.key.toUpperCase() === 'B') { event.preventDefault(); app.progress.bookmarks[current.id] = !app.progress.bookmarks[current.id]; if (!app.progress.bookmarks[current.id]) delete app.progress.bookmarks[current.id]; saveProgress(); return; }
    if (event.key === 'Enter' && (!active || active.tagName !== 'BUTTON')) {
      event.preventDefault();
      if (app.progress?.answers?.[current.id]) nextQuestion(mode);
      else if (pendingValues(current.id).length) submitAnswer(current.id);
      return;
    }
    if (app.progress?.answers?.[current.id]) return;
    const keyUpper = event.key.toUpperCase();
    const idx = ['1','2','3','4','5','6'].includes(keyUpper)
      ? Number(keyUpper) - 1
      : (keyUpper.length === 1 && keyUpper >= 'A' && keyUpper <= 'F' ? keyUpper.charCodeAt(0) - 65 : -1);
    if (idx >= 0 && current.options[idx]) {
      event.preventDefault();
      toggleOption(current.id, current.options[idx].key);
    }
  }
});
window.addEventListener('hashchange', () => { const route=parseRoute(); go(route).catch(showError); });
boot();
