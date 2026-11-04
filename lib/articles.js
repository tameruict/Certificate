// Supabase adapter for the Write-ups tab. This is the only Write-ups
// module that talks to Supabase; all filtering, sorting and Markdown
// rendering live in writeups.js / markdown.js so they stay testable.
import { supabase, isSupabaseConfigured, SUPABASE_URL } from './supabase.js';
import { normalizeArticle, storageImageBase } from './writeups.js';

export function articlesAvailable() {
  return Boolean(supabase && isSupabaseConfigured);
}

export function articlesImageBase() {
  return storageImageBase(SUPABASE_URL);
}

const LIST_COLUMNS =
  'id,slug,translation_key,language,title,description,platform,category,difficulty,tags,cover_url,featured,published_at';

export async function fetchArticleList() {
  if (!articlesAvailable()) return { articles: [], error: 'supabase_not_configured' };
  const { data, error } = await supabase
    .from('study_articles')
    .select(LIST_COLUMNS)
    .eq('is_draft', false)
    .order('published_at', { ascending: false });
  if (error) return { articles: [], error: error.message || 'fetch_failed' };
  return { articles: (data || []).map(normalizeArticle), error: null };
}

export async function fetchArticleDetail(slug, language) {
  if (!articlesAvailable()) return { article: null, error: 'supabase_not_configured' };
  const { data, error } = await supabase
    .from('study_articles')
    .select(`${LIST_COLUMNS},markdown`)
    .eq('slug', slug)
    .eq('language', language)
    .eq('is_draft', false)
    .maybeSingle();
  if (error) return { article: null, error: error.message || 'fetch_failed' };
  return { article: data ? normalizeArticle(data) : null, error: null };
}

// Q-C6: return { progress, error } instead of silently swallowing errors
// as {}. Must ship together with the app.js loadWriteups change (Q-C3),
// which is the only caller and now reads .progress / .error.
export async function fetchArticleProgress(userId) {
  if (!articlesAvailable() || !userId) return { progress: {}, error: null };
  const { data, error } = await supabase
    .from('study_article_progress')
    .select('article_id,bookmarked,completed,last_read_at')
    .eq('user_id', userId);
  if (error) return { progress: {}, error: error.message || 'fetch_failed' };
  const map = {};
  for (const row of data || []) map[row.article_id] = row;
  return { progress: map, error: null };
}

export async function saveArticleProgress(userId, articleId, patch = {}) {
  if (!articlesAvailable() || !userId || !articleId) return { error: 'not_available' };
  const row = { user_id: userId, article_id: articleId };
  // Only send the fields the caller actually changed; unset flags must
  // not silently clear a stored bookmark.
  if (patch.bookmarked !== undefined) row.bookmarked = Boolean(patch.bookmarked);
  if (patch.completed !== undefined) row.completed = Boolean(patch.completed);
  // Q-C4: last_read_at is set ONLY when the caller says the article was
  // actually opened/read (patch.lastRead === true, from loadWriteupDetail).
  // Bookmark/completed toggles no longer skew "recently read" ordering.
  if (patch.lastRead === true) row.last_read_at = new Date().toISOString();
  const { error } = await supabase
    .from('study_article_progress')
    .upsert(row, { onConflict: 'user_id,article_id' });
  return { error: error ? error.message : null };
}
