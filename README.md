# CertLab Study

CertLab Study is a static certification-study workspace with username/password authentication and per-user progress archiving through Supabase.

## Supabase setup

1. Create or open the Supabase project for the URL in `config.js`.
2. In **Project Settings → API**, copy the browser-safe **publishable key** (or legacy `anon` key). Never use a `service_role` or secret key in this repository.
3. Put that key in your local `config.js` file (never commit the real value):

   ```js
   window.CERTLAB_SUPABASE_CONFIG = Object.freeze({
     url: 'https://enpwqvojhqiuryhzujrn.supabase.co',
     anonKey: 'YOUR_PUBLISHABLE_OR_ANON_KEY'
   });
   ```

   `config.example.js` is a safe template. `config.js` is committed with an empty key so the app can show a setup warning. Replace the empty value locally and do not commit a real key.

4. Run `supabase/001_user_auth_and_archive.sql` in the Supabase SQL Editor. The migration creates `user_profiles` and `user_data_archive`, enables RLS, and limits every row to its authenticated owner.
5. In **Authentication → Providers → Email**, turn off **Confirm email** for this username-only flow, or confirm newly created users manually. Usernames are mapped to internal synthetic addresses (`<username>@users.certlab.invalid`) because Supabase Auth authenticates email/phone credentials.

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

## Validate

```powershell
node --check lib/app.js
node --check lib/supabase.js
node scripts/validate-content.js
node --test tests/content-foundation.test.js
```

## Data-security notes

- Only the public publishable/anon key belongs in browser configuration.
- RLS policies require `auth.uid() = user_id` for profile and archive reads/writes.
- Do not commit a real key in `config.js`, `.env` files, service-role keys, or exported user data; restore the empty placeholder before pushing.


