'use strict';

// Scaffold a new certification course so adding a cert never means hand-writing
// catalog + bundle JSON from scratch. The new course is registered as a *draft*
// (published:false) so it validates but stays hidden from the application until
// its bank is filled and its status is flipped to "published".
//
// Usage:
//   node scripts/new-course.js --id iso-27001-2022 --title "ISO/IEC 27001:2022" \
//     --provider ISO --code "27001" --category Governance \
//     --domains "A.5:Organizational;A.6:People;A.7:Physical;A.8:Technological"
//
// After running: fill content/<id>/published-questions.v2.json (see docs/AUTHORING.md
// or scripts/import-questions.js), run `node scripts/validate-content.js`, then set
// the course + bank + catalog entry status to "published" and published:true.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const CATALOG_PATH = path.join(CONTENT_DIR, 'catalog.json');
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[token.slice(2)] = true; }
      else { args[token.slice(2)] = next; i += 1; }
    }
  }
  return args;
}

function parseDomains(spec) {
  // "A.5:Organizational;A.6:People" -> [{id:"A.5",title:"Organizational"}, ...]
  return String(spec || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const idx = part.indexOf(':');
      if (idx === -1) throw new Error(`Invalid domain "${part}". Use "id:Title".`);
      const id = part.slice(0, idx).trim();
      const title = part.slice(idx + 1).trim();
      if (!id || !title) throw new Error(`Invalid domain "${part}". Both id and title are required.`);
      return { id, title };
    });
}

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const id = String(args.id || '').trim();
  const title = String(args.title || '').trim();
  const provider = String(args.provider || '').trim();
  const code = String(args.code || '').trim();
  const category = String(args.category || '').trim();
  const summary = String(args.summary || `Draft study bank for ${title || id}.`).trim();

  if (!id || !title) throw new Error('Both --id and --title are required.');
  if (!ID_PATTERN.test(id)) throw new Error(`--id "${id}" must match ${ID_PATTERN} (lowercase letters, numbers, . _ -).`);

  const domains = args.domains ? parseDomains(args.domains) : [{ id: '1', title: 'General' }];
  const seen = new Set();
  for (const domain of domains) {
    if (seen.has(domain.id)) throw new Error(`Duplicate domain id "${domain.id}".`);
    seen.add(domain.id);
  }

  const courseDir = path.join(CONTENT_DIR, id);
  if (fs.existsSync(courseDir)) throw new Error(`content/${id}/ already exists. Choose a different --id or edit it directly.`);

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (!Array.isArray(catalog.courses)) throw new Error('catalog.json has no courses array.');
  if (catalog.courses.some(entry => entry && entry.id === id)) throw new Error(`Catalog already contains a course with id "${id}".`);

  const course = {
    schema_version: '2.0',
    id,
    title,
    provider: provider || undefined,
    exam_code: code || undefined,
    category: category || undefined,
    summary,
    status: 'draft',
    availability: { application: 'draft' },
    domains,
    question_bank: { path: 'published-questions.v2.json', record_count: 0, status: 'draft' }
  };
  // Drop undefined optional fields so the bundle stays clean.
  for (const key of Object.keys(course)) if (course[key] === undefined) delete course[key];

  const questionBank = {
    schema_version: '2.0',
    course_id: id,
    question_bank_status: 'draft',
    content_origin: 'original',
    records: []
  };

  const objectives = {
    schema_version: '2.1',
    course_id: id,
    domains: domains.map(domain => ({
      id: domain.id,
      objectives: [
        { id: `${domain.id}.1`, title: 'First objective', summary: '', notes_md: '', refs: [] }
      ]
    }))
  };

  fs.mkdirSync(courseDir, { recursive: true });
  fs.writeFileSync(path.join(courseDir, 'course.json'), json(course), 'utf8');
  fs.writeFileSync(path.join(courseDir, 'published-questions.v2.json'), json(questionBank), 'utf8');
  fs.writeFileSync(path.join(courseDir, 'objectives.json'), json(objectives), 'utf8');

  catalog.courses.push({ id, bundle: `${id}/course.json`, published: false, status: 'draft' });
  fs.writeFileSync(CATALOG_PATH, json(catalog), 'utf8');

  console.log(`Scaffolded draft course "${id}".`);
  console.log(`  content/${id}/course.json`);
  console.log(`  content/${id}/published-questions.v2.json  (empty — fill it in)`);
  console.log(`  content/${id}/objectives.json`);
  console.log('  catalog.json  (added as published:false, status:"draft")');
  console.log('\nNext:');
  console.log('  1. Add questions (see docs/AUTHORING.md or scripts/import-questions.js).');
  console.log('  2. node scripts/validate-content.js');
  console.log('  3. Flip status to "published" in course.json, the bank, and catalog.json (published:true).');
  return { id, courseDir };
}

if (require.main === module) {
  try { run(); }
  catch (error) { console.error(`new-course failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { run, parseArgs, parseDomains };
