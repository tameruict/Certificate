'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('writeups filter is diacritic-insensitive and language-aware', async () => {
  const { filterArticles, sortArticles, rewriteImageUrls, coverImageUrl } = await import('../lib/writeups.js');
  const articles = [
    { title: 'DHCP và DNS', description: '', platform: 'Windows Server', category: 'Networking', difficulty: 'Easy', tags: ['dhcp'], language: 'vi', publishedAt: '2026-08-23' },
    { title: 'DHCP and DNS', description: '', platform: 'Windows Server', category: 'Networking', difficulty: 'Easy', tags: ['dhcp'], language: 'en', publishedAt: '2026-08-22' },
  ];
  assert.equal(filterArticles(articles, { query: 'dhcp', language: 'vi' }).length, 1);
  assert.equal(filterArticles(articles, { query: 'đường', language: 'vi' }).length, 0);
  assert.equal(sortArticles(articles)[0].language, 'vi');
  assert.equal(
    rewriteImageUrls('![alt](/images/cap/cap-01.png)', 'https://x.supabase.co/storage/v1/object/public/writeup-images'),
    '![alt](https://x.supabase.co/storage/v1/object/public/writeup-images/cap/cap-01.png)',
  );
  assert.equal(
    rewriteImageUrls('![alt](https://tameruict.github.io/images/critical-ops/critical-ops-06.png)', 'https://x.supabase.co/storage/v1/object/public/writeup-images'),
    '![alt](https://x.supabase.co/storage/v1/object/public/writeup-images/critical-ops/critical-ops-06.png)',
  );
  assert.equal(
    coverImageUrl('/images/cap/cap-02.png', 'https://x.supabase.co/storage/v1/object/public/writeup-images'),
    'https://x.supabase.co/storage/v1/object/public/writeup-images/cap/cap-02.png',
  );
  assert.equal(
    coverImageUrl('https://tameruict.github.io/images/cap/cap-02.png', 'https://x.supabase.co/storage/v1/object/public/writeup-images'),
    'https://x.supabase.co/storage/v1/object/public/writeup-images/cap/cap-02.png',
  );
});
