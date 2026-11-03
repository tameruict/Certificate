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

export async function fetchArticleProgress(userId) {
  if (!articlesAvailable() || !userId) return {};
  const { data, error } = await supabase
    .from('study_article_progress')
    .select('article_id,bookmarked,completed,last_read_at')
    .eq('user_id', userId);
  if (error || !data) return {};
  const map = {};
  for (const row of data) map[row.article_id] = row;
  return map;
}

export async function saveArticleProgress(userId, articleId, patch = {}) {
  if (!articlesAvailable() || !userId || !articleId) return { error: 'not_available' };
  const row = {
    user_id: userId,
    article_id: articleId,
    bookmarked: Boolean(patch.bookmarked),
    completed: Boolean(patch.completed),
    last_read_at: new Date().toISOString(),
  };
  // Only send the fields the caller actually changed, plus the key and
  // timestamp; unset flags must not silently clear a stored bookmark.
  if (patch.bookmarked === undefined) delete row.bookmarked;
  if (patch.completed === undefined) delete row.completed;
  const { error } = await supabase
    .from('study_article_progress')
    .upsert(row, { onConflict: 'user_id,article_id' });
  return { error: error ? error.message : null };
}
