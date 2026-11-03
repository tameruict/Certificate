// Import writeups from a tameruict.github.io checkout into Supabase.
// Usage:
//   node scripts/import-writeups.js --source <path-to-github.io> --dry-run
//   node scripts/import-writeups.js --source <path-to-github.io> --apply
// --dry-run is the default and makes NO network calls. --apply requires
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment; those
// values must never be committed or pasted into chat. The script only
// upserts published (draft: false) articles and uploads images that are
// actually referenced; it never rewrites article Markdown (image paths
// are rewritten to the Storage URL at render time by the frontend).
'use strict';

const fs = require('fs');
const path = require('path');

const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Insane']);

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitArray(inner).map(parseValue);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function splitArray(inner) {
  const parts = [];
  let current = '';
  let inQuote = null;
  for (const ch of inner) {
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseFrontmatter(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    throw new Error('missing frontmatter block');
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) throw new Error('unterminated frontmatter block');
  const block = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const data = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    data[trimmed.slice(0, colon).trim()] = parseValue(trimmed.slice(colon + 1));
  }
  return { data, body };
}

function validateArticle(data, sourcePath) {
  const errors = [];
  if (!data.title || typeof data.title !== 'string') errors.push('title is required');
  if (typeof data.description !== 'string' || data.description.length > 180) {
    errors.push('description must be a string of at most 180 characters');
  }
  if (!data.platform) errors.push('platform is required');
  if (!data.category) errors.push('category is required');
  if (!DIFFICULTIES.has(data.difficulty)) errors.push(`difficulty must be one of Easy/Medium/Hard/Insane (got ${data.difficulty})`);
  if (!['vi', 'en'].includes(data.language)) errors.push(`language must be vi or en (got ${data.language})`);
  if (!data.translationKey) errors.push('translationKey is required');
  if (!data.publishedAt || Number.isNaN(Date.parse(String(data.publishedAt)))) errors.push('publishedAt must be a parseable date');
  if (data.tags !== undefined && !Array.isArray(data.tags)) errors.push('tags must be an array');
  if (errors.length) throw new Error(`${sourcePath}: ${errors.join('; ')}`);
}

function findMarkdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findMarkdownFiles(full, out);
    else if (entry.isFile() && /\.md$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function referencedImages(markdown) {
  const images = new Set();
  const re = /\]\((\/images\/[^)\s]+)\)/g;
  let match;
  while ((match = re.exec(markdown)) !== null) images.add(match[1]);
  return [...images];
}

function collectArticles(sourceDir) {
  const writeupsDir = path.join(sourceDir, 'src', 'content', 'writeups');
  const imagesDir = path.join(sourceDir, 'public', 'images');
  if (!fs.existsSync(writeupsDir)) throw new Error(`writeups directory not found: ${writeupsDir}`);
  const files = findMarkdownFiles(writeupsDir);
  const articles = [];
  const skipped = [];
  const seen = new Map();
  const referenced = new Set();
  for (const file of files) {
    const rel = path.relative(sourceDir, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(text);
    if (data.draft === true) {
      skipped.push({ path: rel, reason: 'draft: true' });
      continue;
    }
    validateArticle(data, rel);
    const key = `${data.translationKey}::${data.language}`;
    if (seen.has(key)) throw new Error(`duplicate article ${key} (first: ${seen.get(key)}, duplicate: ${rel})`);
    seen.set(key, rel);
    const images = referencedImages(body);
    images.forEach((img) => referenced.add(img));
    articles.push({
      slug: String(data.translationKey),
      translation_key: String(data.translationKey),
      language: String(data.language),
      library: 'writeups',
      title: String(data.title),
      description: String(data.description),
      platform: String(data.platform),
      category: String(data.category),
      difficulty: String(data.difficulty),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      markdown: body,
      cover_url: data.cover ? String(data.cover) : null,
      source_repo: 'tameruict/tameruict.github.io',
      source_path: rel,
      source_sha: '',
      is_draft: false,
      featured: Boolean(data.featured),
      published_at: new Date(String(data.publishedAt)).toISOString(),
      images,
    });
  }
  // Translation-pair check: warn, do not fail, and never auto-translate.
  const byKey = new Map();
  for (const article of articles) {
    if (!byKey.has(article.translation_key)) byKey.set(article.translation_key, new Set());
    byKey.get(article.translation_key).add(article.language);
  }
  const incompletePairs = [...byKey.entries()]
    .filter(([, langs]) => langs.size < 2)
    .map(([key, langs]) => `${key} (only: ${[...langs].join(',')})`);
  // Image audit against the source checkout.
  const missingImages = [];
  const existingImages = [];
  for (const img of referenced) {
    const filePath = path.join(imagesDir, img.replace('/images/', ''));
    if (fs.existsSync(filePath)) existingImages.push(img);
    else missingImages.push(img);
  }
  let totalImageBytes = 0;
  for (const img of existingImages) {
    totalImageBytes += fs.statSync(path.join(imagesDir, img.replace('/images/', ''))).size;
  }
  return {
    articles, skipped, referenced: [...referenced].sort(), missingImages: missingImages.sort(),
    existingImages: existingImages.sort(), totalImageBytes, incompletePairs,
  };
}

async function applyArticles(report, env) {
  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error('--apply requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment');
  }
  if (report.missingImages.length) {
    throw new Error(`refusing to apply: ${report.missingImages.length} referenced image(s) missing from the source checkout: ${report.missingImages.join(', ')}`);
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates',
  };
  // Upload referenced images first, preserving the source path layout.
  const imagesDir = path.join(env.SOURCE_DIR, 'public', 'images');
  for (const img of report.existingImages) {
    const filePath = path.join(imagesDir, img.replace('/images/', ''));
    const buffer = fs.readFileSync(filePath);
    const objectPath = img.replace('/images/', '');
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/writeup-images/${objectPath}?upsert=true`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: buffer },
    );
    if (!res.ok) throw new Error(`image upload failed for ${img}: HTTP ${res.status}`);
  }
  // Upsert articles (PostgREST on_conflict on the unique key).
  for (const article of report.articles) {
    const { images, ...row } = article;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/study_articles?on_conflict=translation_key,language`,
      { method: 'POST', headers, body: JSON.stringify(row) },
    );
    if (!res.ok) throw new Error(`article upsert failed for ${row.translation_key}/${row.language}: HTTP ${res.status} ${await res.text()}`);
  }
  return { uploadedImages: report.existingImages.length, upsertedArticles: report.articles.length };
}

function printReport(report) {
  console.log(`Articles (published): ${report.articles.length}`);
  console.log(`Skipped (draft): ${report.skipped.length}`);
  for (const item of report.skipped) console.log(`  skipped: ${item.path} (${item.reason})`);
  console.log(`Referenced images: ${report.referenced.length} (${report.existingImages.length} found, ${report.missingImages.length} missing, ${report.totalImageBytes} bytes)`);
  for (const img of report.missingImages) console.log(`  missing image: ${img}`);
  if (report.incompletePairs.length) {
    console.log(`Incomplete translation pairs: ${report.incompletePairs.length}`);
    for (const pair of report.incompletePairs) console.log(`  ${pair}`);
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const sourceIndex = argv.indexOf('--source');
  if (sourceIndex === -1 || !argv[sourceIndex + 1]) {
    console.error('Usage: node scripts/import-writeups.js --source <path-to-github.io> [--dry-run|--apply]');
    return 2;
  }
  const sourceDir = argv[sourceIndex + 1];
  const apply = argv.includes('--apply');
  const report = collectArticles(sourceDir);
  printReport(report);
  if (!apply) {
    console.log('Dry run only: no network calls, nothing written.');
    return report.missingImages.length ? 1 : 0;
  }
  const result = await applyArticles(report, { ...env, SOURCE_DIR: sourceDir });
  console.log(`Applied: ${result.upsertedArticles} articles, ${result.uploadedImages} images.`);
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { parseFrontmatter, validateArticle, collectArticles, referencedImages };
