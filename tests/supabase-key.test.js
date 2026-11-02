'use strict';

// Tests for the browser-safe key check in lib/supabase.js.
//
// lib/supabase.js is a browser ESM module that imports Supabase from a
// CDN, so it cannot be imported directly under Node. Instead this test
// reads the file, asserts the validator is exported, and evaluates only
// the extracted isBrowserSafeKey function (its body uses only atob,
// which Node provides). That keeps the test pointed at the real function
// rather than a duplicated copy of its logic.
//
// All keys below are synthetic test data generated for this test only.
// No real key is used anywhere in this file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SUPABASE_PATH = path.resolve(__dirname, '../lib/supabase.js');

function loadIsBrowserSafeKey() {
  const source = fs.readFileSync(SUPABASE_PATH, 'utf8');
  assert.match(source, /export function isBrowserSafeKey\(/, 'isBrowserSafeKey must be exported from lib/supabase.js');
  const start = source.indexOf('function isBrowserSafeKey');
  const end = source.indexOf('export const isSupabaseConfigured');
  assert.ok(start !== -1 && end !== -1 && end > start, 'could not locate isBrowserSafeKey in lib/supabase.js');
  const fnSource = source.slice(start, end);
  // Evaluate the extracted declaration only.
  return new Function(`${fnSource}; return isBrowserSafeKey;`)();
}

// Build a synthetic JWT-shaped token: header.payload.signature, where the
// payload is a JSON object with the given role. The signature part is a
// dummy string; isBrowserSafeKey never verifies signatures.
function syntheticJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.synthetic-test-signature`;
}

const isBrowserSafeKey = loadIsBrowserSafeKey();

test('publishable keys (sb_publishable_) are browser-safe', () => {
  assert.equal(isBrowserSafeKey('sb_publishable_syntheticTestKey123_-'), true);
});

test('synthetic JWT with role anon is browser-safe', () => {
  assert.equal(isBrowserSafeKey(syntheticJwt({ role: 'anon' })), true);
});

test('synthetic JWT with role service_role is not browser-safe', () => {
  assert.equal(isBrowserSafeKey(syntheticJwt({ role: 'service_role' })), false);
});

test('synthetic JWT with any other role is not browser-safe', () => {
  assert.equal(isBrowserSafeKey(syntheticJwt({ role: 'authenticated' })), false);
  assert.equal(isBrowserSafeKey(syntheticJwt({})), false);
});

test('malformed keys are not browser-safe', () => {
  assert.equal(isBrowserSafeKey(''), false);
  assert.equal(isBrowserSafeKey('not-a-key'), false);
  assert.equal(isBrowserSafeKey('sb_publishable_'), false);
  assert.equal(isBrowserSafeKey('sb_publishable_bad chars!'), false);
  assert.equal(isBrowserSafeKey('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9'), false);
  assert.equal(isBrowserSafeKey('eyJ.invalid.invalid'), false);
  // Header does not decode to a JWT header shape, but the payload segment
  // is not valid JSON either, so the function must reject it, not throw.
  assert.equal(isBrowserSafeKey('eyJx.eyJx.sig'), false);
});
