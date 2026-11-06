'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectArticles, parseFrontmatter } = require('../scripts/import-writeups.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writeups-test-'));
  const writeups = path.join(dir, 'src', 'content', 'writeups', 'hack-the-box');
  const images = path.join(dir, 'public', 'images', 'cap');
  fs.mkdirSync(writeups, { recursive: true });
  fs.mkdirSync(images, { recursive: true });
  fs.writeFileSync(path.join(images, 'cap-01.png'), Buffer.from('fake-png'));
  fs.writeFileSync(path.join(writeups, 'cap.md'), [
    '---',
    'title: "CAP"',
    'description: "A short description."',
    'platform: "Hack The Box"',
    'category: "Linux"',
    'difficulty: "Easy"',
    'publishedAt: 2026-07-29',
    'tags: ["idor"]',
    'language: "vi"',
    'translationKey: "hack-the-box/cap"',
    'draft: false',
    'featured: true',
    'cover: "/images/cap/cap-01.png"',
    '---',
    '',
    '## Body',
    '',
    '![img](https://tameruict.github.io/images/cap/cap-01.png)',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(writeups, 'reactor.md'), [
    '---',
    'title: "Reactor"',
    'description: "Draft template."',
    'platform: "Hack The Box"',
    'category: "Linux"',
    'difficulty: "Easy"',
    'publishedAt: 2026-08-05',
    'tags: []',
    'language: "vi"',
    'translationKey: "hack-the-box/reactor"',
    'draft: true',
    '---',
    '',
    'Draft.',
    '',
  ].join('\n'));
  return dir;
}

test('import collects published articles, skips drafts, audits images', () => {
  const dir = fixture();
  const report = collectArticles(dir);
  assert.equal(report.articles.length, 1);
  assert.equal(report.articles[0].slug, 'hack-the-box/cap');
  assert.match(report.articles[0].markdown, /\]\(\/images\/cap\/cap-01\.png\)/);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].path.includes('reactor.md'), true);
  assert.deepEqual(report.missingImages, []);
  assert.equal(report.totalImageBytes, 8);
});

test('import rejects a description over 180 characters', () => {
  assert.throws(() => {
    const { validateArticle } = require('../scripts/import-writeups.js');
    validateArticle({
      title: 'T', description: 'x'.repeat(181), platform: 'P', category: 'C',
      difficulty: 'Easy', language: 'vi', translationKey: 'k', publishedAt: '2026-01-01',
    }, 'test.md');
  }, /description/);
});

test('frontmatter parser reads quoted strings and arrays', () => {
  const { data } = parseFrontmatter('---\ntitle: "Hi"\ntags: ["a", "b"]\ndraft: false\n---\n\nBody\n');
  assert.equal(data.title, 'Hi');
  assert.deepEqual(data.tags, ['a', 'b']);
  assert.equal(data.draft, false);
});
