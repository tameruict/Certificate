'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('production headers enforce a restrictive browser security policy', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
});

test('HTML has no inline executable script or event handlers', () => {
  const html = read('index.html');
  const app = read('lib/app.js');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(app, /\sstyle=/i);
  assert.match(html, /src="lib\/bootstrap\.js"/);
});

test('Supabase migration uses ownership RLS and bounded untrusted payloads', () => {
  const initial = read('supabase/001_user_auth_and_archive.sql');
  const hardening = read('supabase/002_security_hardening.sql');
  for (const table of ['user_data_archive', 'user_profiles']) {
    assert.match(initial, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(initial, new RegExp(`revoke all on table public\\.${table} from anon`, 'i'));
  }
  assert.ok((initial.match(/\(select auth\.uid\(\)\) = user_id/g) || []).length >= 6);
  assert.match(initial, /jsonb_typeof\(payload\) = 'object'/);
  assert.match(initial, /pg_column_size\(payload\) <= 262144/);
  assert.match(hardening, /revoke all on function public\.rls_auto_enable\(\) from public, anon, authenticated/i);
});

test('runtime config endpoint rejects non-read methods and validates public config', () => {
  const source = read('api/config.js');
  assert.match(source, /\['GET', 'HEAD'\]\.includes\(request\.method\)/);
  assert.match(source, /status\(405\)/);
  assert.match(source, /supabase\\\.co/);
  assert.match(source, /sb_publishable_/);
  assert.match(source, /payload\.role === 'anon'/);
  assert.doesNotMatch(source, /sb_secret_/i);
});

test('runtime config never returns a legacy service-role JWT', async () => {
  const source = read('api/config.js');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { default: handler } = await import(moduleUrl);
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  const jwt = (role) => [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'),
    'signature'
  ].join('.');
  const invoke = (method) => {
    const result = { headers: {}, statusCode: 200, body: null };
    const response = {
      setHeader(key, value) { result.headers[key] = value; },
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return result; }
    };
    return handler({ method }, response);
  };
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = jwt('service_role');
    assert.equal(invoke('GET').statusCode, 503);
    process.env.SUPABASE_PUBLISHABLE_KEY = jwt('anon');
    assert.equal(invoke('GET').statusCode, 200);
    assert.equal(invoke('POST').statusCode, 405);
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishable;
  }
});
