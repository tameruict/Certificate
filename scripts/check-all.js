'use strict';

// Syntax-check every first-party JavaScript file in the repo.
//
// Why a script instead of a shell glob in package.json: npm runs scripts
// through cmd.exe on Windows, where `node --check lib/*.js` style globs do
// not expand, so a globbed "check" script silently checks nothing (or
// fails) on Windows. Walking the directories here is portable.
//
// Directories are checked only when they exist, so a future removal of a
// directory does not break the script; files are checked in sorted order
// and the first failure stops the run with the offending filename.

const { spawnSync } = require('node:child_process');
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

function main() {
  const files = [];
  for (const directory of DIRECTORIES) {
    const full = path.join(ROOT, directory);
    if (fs.existsSync(full)) files.push(...collectJsFiles(full));
  }
  files.sort();
  if (files.length === 0) {
    console.error('check-all: no JavaScript files found.');
    process.exitCode = 1;
    return;
  }
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(`check failed: ${relative}`);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.stdout) process.stdout.write(result.stdout);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`Syntax check passed: ${files.length} file(s).`);
}

main();
