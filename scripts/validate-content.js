'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VALID_STATUSES = new Set(['draft', 'needs_review', 'published']);
const VALID_TYPES = new Set(['single_select', 'multi_select']);

function readJson(filePath, issues, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    issues.push(`${label}: cannot read valid JSON (${error.message}).`);
    return null;
  }
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateQuestion(question, context, domainIds, courseIsPublished, issues) {
  const prefix = `${context} question ${question && question.id ? question.id : '<missing id>'}`;
  if (!question || typeof question !== 'object' || Array.isArray(question)) {
    issues.push(`${context}: record must be an object.`);
    return;
  }
  for (const key of ['id', 'prompt', 'domain_id', 'status']) {
    if (!isNonBlankString(question[key])) issues.push(`${prefix}: '${key}' must be a non-blank string.`);
  }
  if ((courseIsPublished || question.status === 'published') && !isNonBlankString(question.explanation)) {
    issues.push(`${prefix}: published records require a non-blank explanation.`);
  }
  if (!VALID_TYPES.has(question.type)) issues.push(`${prefix}: type must be single_select or multi_select.`);
  if (!VALID_STATUSES.has(question.status)) issues.push(`${prefix}: invalid status '${question.status}'.`);
  if (!domainIds.has(question.domain_id)) issues.push(`${prefix}: domain_id '${question.domain_id}' is not defined by the course.`);
  if (!Array.isArray(question.options) || question.options.length < 2) {
    issues.push(`${prefix}: requires at least two options.`);
  }
  const optionIds = new Set();
  for (const option of question.options || []) {
    if (!option || !isNonBlankString(option.id) || !isNonBlankString(option.text)) {
      issues.push(`${prefix}: every option needs non-blank id and text.`);
      continue;
    }
    if (optionIds.has(option.id)) issues.push(`${prefix}: duplicate option id '${option.id}'.`);
    optionIds.add(option.id);
  }
  if (!Array.isArray(question.correct_option_ids) || question.correct_option_ids.length === 0) {
    issues.push(`${prefix}: requires one or more correct_option_ids.`);
  } else {
    const correctIds = new Set(question.correct_option_ids);
    if (correctIds.size !== question.correct_option_ids.length) issues.push(`${prefix}: duplicate correct option ids.`);
    for (const optionId of correctIds) {
      if (!optionIds.has(optionId)) issues.push(`${prefix}: correct option '${optionId}' does not exist.`);
    }
    if (question.type === 'single_select' && correctIds.size !== 1) issues.push(`${prefix}: single_select requires exactly one correct option.`);
    if (question.type === 'multi_select' && correctIds.size < 2) issues.push(`${prefix}: multi_select requires at least two correct options.`);
  }
  if (!question.provenance || !isNonBlankString(question.provenance.kind)) {
    issues.push(`${prefix}: provenance.kind is required.`);
  }
  if (courseIsPublished && question.status !== 'published') {
    issues.push(`${prefix}: published courses cannot contain '${question.status}' records.`);
  }
}

function validateRepository(root = ROOT) {
  const issues = [];
  const catalogPath = path.join(root, 'content', 'catalog.json');
  const catalog = readJson(catalogPath, issues, 'catalog');
  const summary = { catalog: 'content/catalog.json', courses: [], published_courses: 0, records: 0 };
  if (!catalog) return { valid: false, issues, summary };

  if (catalog.schema_version !== '2.0') issues.push('catalog: schema_version must be 2.0.');
  if (!Array.isArray(catalog.courses) || catalog.courses.length === 0) {
    issues.push('catalog: courses must be a non-empty array.');
    return { valid: false, issues, summary };
  }

  const catalogIds = new Set();
  for (const entry of catalog.courses) {
    const entryLabel = `catalog course ${entry && entry.id ? entry.id : '<missing id>'}`;
    if (!entry || !isNonBlankString(entry.id) || !isNonBlankString(entry.bundle)) {
      issues.push(`${entryLabel}: id and bundle are required.`);
      continue;
    }
    if (catalogIds.has(entry.id)) issues.push(`${entryLabel}: duplicate catalog id.`);
    catalogIds.add(entry.id);
    if (typeof entry.published !== 'boolean') issues.push(`${entryLabel}: published must be boolean.`);
    if (!VALID_STATUSES.has(entry.status)) issues.push(`${entryLabel}: invalid status '${entry.status}'.`);

    const bundlePath = path.resolve(path.join(root, 'content'), entry.bundle);
    if (!bundlePath.startsWith(path.join(root, 'content') + path.sep)) {
      issues.push(`${entryLabel}: bundle must stay inside content/.`);
      continue;
    }
    const course = readJson(bundlePath, issues, entryLabel);
    if (!course) continue;
    if (course.schema_version !== '2.0') issues.push(`${entryLabel}: bundle schema_version must be 2.0.`);
    if (course.id !== entry.id) issues.push(`${entryLabel}: bundle id must match catalog id.`);
    if (course.status !== entry.status) issues.push(`${entryLabel}: bundle status must match catalog status.`);
    if (!course.availability || !isNonBlankString(course.availability.application)) {
      issues.push(`${entryLabel}: availability.application is required.`);
    }
    if (entry.published && course.availability && course.availability.application !== 'published') {
      issues.push(`${entryLabel}: published course must have application availability 'published'.`);
    }
    if (!entry.published && course.availability && course.availability.application === 'published') {
      issues.push(`${entryLabel}: unpublished course cannot have application availability 'published'.`);
    }
    if (!Array.isArray(course.domains) || course.domains.length === 0) {
      issues.push(`${entryLabel}: domains must be non-empty.`);
    }
    const domainIds = new Set();
    for (const domain of course.domains || []) {
      if (!domain || !isNonBlankString(domain.id) || !isNonBlankString(domain.title)) {
        issues.push(`${entryLabel}: every domain needs id and title.`);
      } else if (domainIds.has(domain.id)) {
        issues.push(`${entryLabel}: duplicate domain id '${domain.id}'.`);
      } else domainIds.add(domain.id);
    }
    if (!course.question_bank || !isNonBlankString(course.question_bank.path) || !Number.isInteger(course.question_bank.record_count)) {
      issues.push(`${entryLabel}: question_bank.path and integer record_count are required.`);
      continue;
    }
    const questionPath = path.resolve(path.dirname(bundlePath), course.question_bank.path);
    if (!questionPath.startsWith(path.dirname(bundlePath) + path.sep)) {
      issues.push(`${entryLabel}: question_bank.path must stay in its course bundle.`);
      continue;
    }
    const bank = readJson(questionPath, issues, entryLabel);
    if (!bank) continue;
    if (bank.schema_version !== '2.0') issues.push(`${entryLabel}: question bank schema_version must be 2.0.`);
    if (bank.course_id !== entry.id) issues.push(`${entryLabel}: question bank course_id must match catalog id.`);
    if (!VALID_STATUSES.has(bank.question_bank_status)) issues.push(`${entryLabel}: invalid question_bank_status.`);
    if (bank.question_bank_status !== course.question_bank.status) issues.push(`${entryLabel}: question bank status must match course question_bank status.`);
    if (!Array.isArray(bank.records)) {
      issues.push(`${entryLabel}: question bank records must be an array.`);
      continue;
    }
    if (bank.records.length !== course.question_bank.record_count) issues.push(`${entryLabel}: record_count does not match question bank.`);
    const questionIds = new Set();
    for (const question of bank.records) {
      if (question && question.id && questionIds.has(question.id)) issues.push(`${entryLabel}: duplicate question id '${question.id}'.`);
      if (question && question.id) questionIds.add(question.id);
      validateQuestion(question, entryLabel, domainIds, entry.published, issues);
    }
    if (entry.published && (entry.status !== 'published' || course.status !== 'published' || bank.question_bank_status !== 'published')) {
      issues.push(`${entryLabel}: every publication status must be published.`);
    }
    if (course.archived_question_banks !== undefined && !Array.isArray(course.archived_question_banks)) {
      issues.push(`${entryLabel}: archived_question_banks must be an array when present.`);
    }
    for (const archived of course.archived_question_banks || []) {
      const archiveLabel = `${entryLabel} archived bank`;
      if (!archived || !isNonBlankString(archived.path) || !Number.isInteger(archived.record_count) || !VALID_STATUSES.has(archived.status)) {
        issues.push(`${archiveLabel}: path, integer record_count, and valid status are required.`);
        continue;
      }
      if (archived.application !== 'excluded') issues.push(`${archiveLabel}: must be explicitly excluded from the application.`);
      const archivedPath = path.resolve(path.dirname(bundlePath), archived.path);
      if (!archivedPath.startsWith(path.dirname(bundlePath) + path.sep)) {
        issues.push(`${archiveLabel}: path must stay in its course bundle.`);
        continue;
      }
      if (archivedPath === questionPath) issues.push(`${archiveLabel}: cannot duplicate the active question_bank.`);
      const archivedBank = readJson(archivedPath, issues, archiveLabel);
      if (!archivedBank) continue;
      if (archivedBank.schema_version !== '2.0' || archivedBank.course_id !== entry.id) {
        issues.push(`${archiveLabel}: schema_version and course_id must match the active bundle.`);
      }
      if (archivedBank.question_bank_status !== archived.status) issues.push(`${archiveLabel}: status must match its bank.`);
      if (!Array.isArray(archivedBank.records) || archivedBank.records.length !== archived.record_count) {
        issues.push(`${archiveLabel}: record_count does not match its bank.`);
        continue;
      }
      const archivedIds = new Set();
      for (const question of archivedBank.records) {
        if (question && question.id && archivedIds.has(question.id)) issues.push(`${archiveLabel}: duplicate question id '${question.id}'.`);
        if (question && question.id) archivedIds.add(question.id);
        validateQuestion(question, archiveLabel, domainIds, false, issues);
      }
    }
    summary.courses.push({ id: entry.id, published: entry.published, record_count: bank.records.length, status: entry.status });
    summary.records += bank.records.length;
    if (entry.published) summary.published_courses += 1;
  }
  return { valid: issues.length === 0, issues, summary };
}

function run() {
  const result = validateRepository();
  if (!result.valid) {
    console.error(`Content validation failed with ${result.issues.length} issue(s):`);
    for (const issue of result.issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return result;
  }
  console.log(`Content validation passed: ${result.summary.courses.length} courses, ${result.summary.published_courses} published, ${result.summary.records} records.`);
  for (const course of result.summary.courses) {
    console.log(`- ${course.id}: ${course.record_count} records, ${course.status}${course.published ? ' (published)' : ' (excluded)'}`);
  }
  return result;
}

if (require.main === module) run();

module.exports = { validateRepository, validateQuestion, run };
