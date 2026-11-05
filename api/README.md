# API Serverless Endpoints (`api`)

## Overview
Serverless HTTP endpoint package (Vercel Functions) that exposes validated browser-safe runtime configuration (Supabase project URL and publishable/anon key) to the static web client.

## Interface
- `handler(request, response)` (default export in `config.js`): Serverless request handler serving `/api/config` with `{ url, anonKey }` JSON payload.

## Invariants
- Only `GET` and `HEAD` HTTP methods are permitted; all other methods return HTTP `405` with `Allow: GET, HEAD`.
- Responses always set `Cache-Control: no-store, max-age=0`, `Content-Type: application/json; charset=utf-8`, and `X-Content-Type-Options: nosniff`.
- `SUPABASE_URL` defaults to `https://enpwqvojhqiuryhzujrn.supabase.co` and must match `/^https:\/\/[a-z0-9-]+\.supabase\.co$/i`.
- `anonKey` (resolved from `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`) must either match `/^sb_publishable_[A-Za-z0-9_-]+$/` or be a 3-part JWT whose base64url-decoded payload has `role === 'anon'`; secret or `service_role` keys are rejected with HTTP `503`.

## Side Effects
- Reads `process.env.SUPABASE_URL`, `process.env.SUPABASE_PUBLISHABLE_KEY`, and `process.env.SUPABASE_ANON_KEY`.
- Sets HTTP response headers, status code (`200`, `405`, or `503`), and serializes JSON response body via `response.end()`.

## Verification
- Run: `npm test`
