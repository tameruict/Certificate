# Frontend Application & Client Library (`lib`)

## Overview
Browser ES module package implementing the CertLab Study single-page application, runtime configuration bootstrap, Supabase client initialization, Markdown rendering with Table of Contents extraction, and study writeup/article filtering and progress synchronization.

## Interface
- `lib/bootstrap.js`:
  - Module entry side-effect script (`<script type="module" src="lib/bootstrap.js">`) that fetches `/api/config` to populate `window.CERTLAB_SUPABASE_CONFIG` when unset and dynamically imports `./app.js`.
- `lib/supabase.js`:
  - `SUPABASE_URL: string`
  - `SUPABASE_ANON_KEY: string`
  - `isSupabaseConfigured: boolean`
  - `supabase: SupabaseClient | null`
- `lib/articles.js`:
  - `articlesAvailable(): boolean`
  - `articlesImageBase(): string`
  - `fetchArticleList(): Promise<{ articles: object[], error: string | null }>`
  - `fetchArticleDetail(slug: string, language: string): Promise<{ article: object | null, error: string | null }>`
  - `fetchArticleProgress(userId: string): Promise<Record<string, { article_id: string, bookmarked: boolean, completed: boolean, last_read_at: string }>>`
  - `saveArticleProgress(userId: string, articleId: string, patch?: { bookmarked?: boolean, completed?: boolean }): Promise<{ error: string | null }>`
- `lib/markdown.js`:
  - `escHtml(value?: string): string`
  - `slugify(value?: string): string`
  - `extractHeadings(markdown?: string): Array<{ level: number, text: string, id: string }>`
  - `renderMarkdownWithToc(markdown?: string): { html: string, headings: Array<{ level: number, text: string, id: string }> }`
  - `renderMarkdown(markdown?: string): string`
- `lib/writeups.js`:
  - `stripDiacritics(value?: string): string`
  - `normalizeArticle(row?: object): object`
  - `uniqueSorted(values: any[]): string[]`
  - `getPlatforms(articles: object[]): string[]`
  - `getCategories(articles: object[]): string[]`
  - `sortArticles(articles: object[]): object[]`
  - `filterArticles(articles: object[], filters?: { query?: string, platform?: string, category?: string, difficulty?: string, language?: string }): object[]`
  - `storageImageBase(supabaseUrl: string): string`
  - `rewriteImageUrls(markdown?: string, base?: string): string`
  - `coverImageUrl(coverUrl: string | null | undefined, base?: string): string | null`
  - `getStoredLanguage(): string`
  - `setStoredLanguage(language: string): void`
- `lib/app.js`:
  - Main SPA runtime controller managing course catalog loading, TOEIC-style CBT practice/exam sessions with sticky question navigator palette (`paletteHtml`, `jumpToQuestion`, `prevQuestion`, `nextQuestion`), flashcards, review queue filters, Notion-style writeup database (`gallery`/`table` views, breadcrumb navigation, property table, sticky TOC rail) and collapsible domain objective toggles, Light/Dark theme persistence (`certlab:theme`), local storage persistence, and Supabase auth/archive sync.

## Invariants
- `isSupabaseConfigured` is `true` if and only if `SUPABASE_URL` matches `/^https:\/\/[^/]+\.supabase\.co$/` and `SUPABASE_ANON_KEY` is either an `sb_publishable_*` key or a 3-part JWT whose decoded payload has `role === 'anon'`; otherwise `supabase` is `null`.
- `window.CERTLAB_SUPABASE_CONFIG` is populated and `Object.freeze`'d before importing `./app.js` only when `/api/config` responds `200 OK` with both `url` and `anonKey`.
- `fetchArticleList` and `fetchArticleDetail` only query non-draft rows (`is_draft = false`) and short-circuit with error `'supabase_not_configured'` when `articlesAvailable()` is `false`.
- `saveArticleProgress` omits undefined `bookmarked`/`completed` keys from the upsert payload so partial updates never overwrite existing flags in `study_article_progress` (`onConflict: 'user_id,article_id'`).
- All raw Markdown text is HTML-escaped via `escHtml` before emitting structural or inline HTML tags; links and image sources with `javascript:`, `data:`, or `vbscript:` schemes are rejected by `isSafeUrl` and downgraded to plain text.
- `extractHeadings` and `renderMarkdownWithToc` ignore lines inside fenced code blocks (` ``` `) and assign deterministic duplicate suffixes (`-2`, `-3`, ...) to colliding heading slugs in top-down order.
- `normalizeArticle` coerces raw database row fields to consistent shapes with default language `'vi'` and stringified `tags` array; `sortArticles` sorts non-mutatingly by `publishedAt` descending then `title` ascending; `filterArticles` performs diacritic-insensitive substring matching across `title`, `description`, `platform`, `category`, and `tags`.
- Authentication maps usernames (`/^[a-z0-9][a-z0-9._-]{2,31}$/`) to synthetic internal emails (`${username}@users.certlab.app`) and enforces five password rules (at least 12 characters, lowercase, uppercase, digit, symbol).
- `loadCatalog` excludes courses where `published === false`, `status === 'needs_review'`, or `availability.application === 'excluded'`, throwing an error if no eligible courses remain.
- `archiveProgress` refuses to sync payloads exceeding `262,144` bytes (256 KiB limit, warning at `> 230,000` bytes), and `restoreCloudProgress` resolves local versus cloud state by the newer `updatedAt`/`updated_at` timestamp.

## Side Effects
- `lib/bootstrap.js` performs a top-level `fetch('/api/config', { cache: 'no-store' })`, mutates `window.CERTLAB_SUPABASE_CONFIG` when unconfigured, and dynamically imports `./app.js`.
- `lib/supabase.js` reads `globalThis.CERTLAB_SUPABASE_CONFIG` at module evaluation time and initializes the Supabase client with browser session persistence and token auto-refresh.
- `lib/articles.js` performs asynchronous Supabase queries and upserts against the `study_articles` and `study_article_progress` tables.
- `lib/writeups.js` reads and writes the `'certlab:writeups:language'` key in `localStorage`.
- `lib/app.js` mutates the DOM (`#app`, `#toast`, document event listeners), manages timer intervals, reads/writes course progress in `localStorage` (`certlab:progress:<courseId>` and legacy `secplus-progress`), fetches static JSON course bundles (`content/catalog.json`, `content/<id>/*`), and executes Supabase Auth plus `user_profiles` and `user_data_archive` queries/upserts.

## Verification
- Run: `npm test`
