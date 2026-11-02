'use strict';

// Lightweight, dependency-free hygiene lint for first-party JavaScript.
//
// Deliberately small: this is not a replacement for ESLint/Prettier (see
// the follow-up proposal in the pull request body). It only enforces
// rules that pass on the current codebase, so it cannot produce false
// positives on existing files:
//
//   - every file ends with exactly one trailing newline
//   - no trailing whitespace on any line
//   - no tab characters (the codebase uses spaces)
//   - no CRLF line endings
//
// Rules intentionally NOT enforced, with reasons:
//   - No BOM rule: lib/supabase.js currently starts with a UTF-8 BOM.
//     That BOM is harmless in a browser module and removing it would be
//     an unrelated diff in this PR, so it is left alone and not linted.
//   - No indentation / style rules: without a real formatter those would
//     be guesswork and would fail on existing files (notably lib/app.js,
//     which is intentionally not refactored in this PR).
//
// Walks the same directories as scripts/check-all.js, only when they
// exist, and reports every violation before exiting non-zero.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIRECTORIES = ['lib', 'scripts', 'tests', 'api'];

function collectJsFiles(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) found.push(full);
    }
  };
  walk(directory);
  return found;
}

function lintFile(file) {
  const relative = path.relative(ROOT, file);
  const issues = [];
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\r')) issues.push(`${relative}: CRLF line ending found (use LF).`);
  if (!text.endsWith('\n') || text.endsWith('\n\n')) {
    issues.push(`${relative}: must end with exactly one newline.`);
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('\t')) issues.push(`${relative}:${index + 1}: tab character found (use spaces).`);
    if (line !== line.trimEnd()) issues.push(`${relative}:${index + 1}: trailing whitespace.`);
  });
  return issues;
}

function main() {
  const files = [];
  for (const directory of DIRECTORIES) {
    const full = path.join(ROOT, directory);
    if (fs.existsSync(full)) files.push(...collectJsFiles(full));
  }
  files.sort();
  if (files.length === 0) {
    console.error('lint: no JavaScript files found.');
    process.exitCode = 1;
    return;
  }
  const issues = files.flatMap(lintFile);
  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    console.error(`Lint failed: ${issues.length} issue(s) in ${files.length} file(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Lint passed: ${files.length} file(s).`);
}

main();
