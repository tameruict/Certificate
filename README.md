# CertLab Study

CertLab Study is a static certification-study workspace with username/password authentication and per-user progress archiving through Supabase.

## Supabase setup

1. Create or open the Supabase project for the URL in `.env.example`.
2. In **Project Settings → API**, copy the browser-safe **publishable key** (or legacy `anon` key). Never use a `service_role` or secret key in this repository.
3. In Vercel, open **Project Settings → Environment Variables** and add:

   ```text
   SUPABASE_URL=https://enpwqvojhqiuryhzujrn.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   ```

   Enable the variables for the environments you deploy to, then redeploy. The `/api/config` function reads these variables at runtime.

   For local static-server testing only, copy `config.example.js` to an ignored `config.js` and put the key there:

   ```js
   window.CERTLAB_SUPABASE_CONFIG = Object.freeze({
     url: 'https://enpwqvojhqiuryhzujrn.supabase.co',
     anonKey: 'YOUR_PUBLISHABLE_OR_ANON_KEY'
   });
   ```

   `config.example.js` is a safe template. `config.js` is ignored and must never be committed.

4. Run the migrations **in order** in the Supabase SQL Editor:
   - `supabase/001_user_auth_and_archive.sql` — creates `user_profiles` and `user_data_archive`, enables RLS.
   - `supabase/002_security_hardening.sql` — revokes leaked public function, tightens constraints.
   - `supabase/003_expand_payload_and_versioning.sql` — raises payload cap to 1 MB, adds `content_version` column and covering index.
5. In **Authentication → Providers → Email**, turn off **Confirm email** for this username-only flow, or confirm newly created users manually. Usernames are mapped to syntactically valid internal addresses (`<username>@users.certlab.app`) because Supabase Auth authenticates email/phone credentials. These synthetic addresses are not mailboxes.

The app stores the normal study state in browser `localStorage` for offline resilience and upserts the same state to `user_data_archive` whenever it changes. Passwords are never stored in the application database; Supabase Auth manages password hashing and sessions.

## Password and username rules

- Username: 3–32 lowercase characters, numbers, `.`, `_`, or `-`; must start with a letter or number.
- Password: at least 12 characters and must contain lowercase, uppercase, a number, and a symbol.

## Run locally

Serve the directory over HTTP (ES modules and `fetch()` are not supported reliably from `file://`):

```powershell
python -m http.server 8000
```

Open <http://localhost:8000/>.

## Add a course

Certifications are content, not code. Scaffold a new draft course, add questions,
validate, then publish. See [docs/AUTHORING.md](docs/AUTHORING.md) for the full guide.

```powershell
node scripts/new-course.js --id iso-27001-2022 --title "ISO/IEC 27001:2022" --provider ISO --code 27001 --category Governance --domains "A.5:Organizational;A.6:People;A.7:Physical;A.8:Technological"
node scripts/import-questions.js --course iso-27001-2022 --in raw-questions.json
npm run validate
```

## Validate

```powershell
npm run ci          # node --check + validate-content + node --test
```

Individual steps:

```powershell
node --check lib/app.js
node --check lib/supabase.js
node scripts/validate-content.js
node --test
```

## Data-security notes

- The publishable/anon key is intended for browser use; it will be visible to a browser after `/api/config` returns it. Supabase security comes from RLS policies, not from hiding this public key.
- Never put a `service_role` or secret key in `SUPABASE_PUBLISHABLE_KEY`.
- RLS policies require `auth.uid() = user_id` for profile and archive reads/writes.
- Do not commit `config.js`, `.env` files, service-role keys, or exported user data.


