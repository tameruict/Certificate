// Pure helpers for the CertLab Write-ups tab. No browser or network
// dependencies, so this module is safe to unit-test under Node.

export function stripDiacritics(value = '') {
  return String(value)
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeArticle(row = {}) {
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  return {
    id: String(row.id ?? row.slug ?? ''),
    slug: String(row.slug ?? ''),
    translationKey: String(row.translation_key ?? row.translationKey ?? row.slug ?? ''),
    language: String(row.language ?? 'vi'),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    platform: String(row.platform ?? ''),
    category: String(row.category ?? ''),
    difficulty: String(row.difficulty ?? ''),
    tags,
    markdown: String(row.markdown ?? ''),
    coverUrl: row.cover_url ?? row.coverUrl ?? null,
    featured: Boolean(row.featured),
    publishedAt: row.published_at ?? row.publishedAt ?? null,
  };
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
}

export function getPlatforms(articles) {
  return uniqueSorted(articles.map((a) => a.platform));
}

export function getCategories(articles) {
  return uniqueSorted(articles.map((a) => a.category));
}

export function sortArticles(articles) {
  return [...articles].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (tb !== ta) return tb - ta;
    return a.title.localeCompare(b.title);
  });
}

export function filterArticles(articles, filters = {}) {
  const query = stripDiacritics(filters.query || '');
  const platform = filters.platform || '';
  const category = filters.category || '';
  const difficulty = filters.difficulty || '';
  const language = filters.language || '';
  return articles.filter((article) => {
    if (language && article.language !== language) return false;
    if (platform && article.platform !== platform) return false;
    if (category && article.category !== category) return false;
    if (difficulty && article.difficulty !== difficulty) return false;
    if (query) {
      const haystack = stripDiacritics(
        [article.title, article.description, article.platform, article.category, article.tags.join(' ')].join(' '),
      );
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

// Rewrite source image paths (/images/...) to the Supabase Storage public
// URL at render time, so the stored Markdown stays identical to the source
// and only the image base ever changes.
export function storageImageBase(supabaseUrl) {
  const url = String(supabaseUrl || '').replace(/\/$/, '');
  return url ? `${url}/storage/v1/object/public/writeup-images` : '';
}

export function rewriteImageUrls(markdown = '', base = '') {
  if (!base) return String(markdown);
  // Relative /images/... paths AND the absolute github.io URLs used by
  // some source articles (critical-ops, jinja-care, spookifier) both
  // rewrite to Storage, so CSP img-src (Supabase only) never blocks them
  // and no article depends on the source site staying up.
  return String(markdown)
    .replace(/\]\(\/images\//g, `](${base}/`)
    .replace(/\]\((?:https?:\/\/)?tameruict\.github\.io\/images\//g, `](${base}/`);
}

export function coverImageUrl(coverUrl, base = '') {
  if (!coverUrl) return null;
  if (base && String(coverUrl).startsWith('/images/')) {
    return `${base}${String(coverUrl).slice('/images'.length)}`;
  }
  return String(coverUrl);
}

export function getStoredLanguage() {
  try {
    if (typeof localStorage === 'undefined') return 'vi';
    return localStorage.getItem('certlab:writeups:language') || 'vi';
  } catch {
    return 'vi';
  }
}

export function setStoredLanguage(language) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('certlab:writeups:language', language);
    }
  } catch {
    // Storage unavailable (private mode, etc.) — language still applies
    // for the current session.
  }
}
