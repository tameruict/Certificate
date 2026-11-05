'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'questions.json');
const COURSE_DIR = path.join(ROOT, 'content', 'comptia-security-plus-sy0-701');
const PUBLISHED_PATH = path.join(COURSE_DIR, 'published-questions.v2.json');
const ARCHIVE_PATH = path.join(COURSE_DIR, 'needs-review-questions.v2.json');
const REPORT_PATH = path.join(ROOT, 'content', 'reports', 'securityplus-migration-report.json');
const COURSE_ID = 'comptia-security-plus-sy0-701';
const REVIEWED_RECORD_COUNT = 302;
const LEGACY_SCHEMA = ['d', 'q', 'o', 'a', 'e'];

const TAG_RULES = [
  ['cryptography', /\b(aes|rsa|ecc|3des|des|cipher|encrypt|decrypt|hashing|sha-?\d+|md5|hmac|salting|key exchange|diffie-hellman|pgp|gpg)\b/i],
  ['pki', /\b(pki|certificate|ca\b|crl|ocsp|csr|x\.509|key escrow|root of trust|public key|private key|digital signature)\b/i],
  ['zero-trust', /\b(zero trust|ztna|implicit trust|policy engine|policy administrator|pe\b|pa\b|pep\b|micro-?segmentation)\b/i],
  ['security-controls', /\b(preventive|detective|corrective|deterrent|compensating|directive|managerial|operational|technical control|physical control|bollard|mantrap|fencing)\b/i],
  ['cia-triad', /\b(confidentiality|integrity|availability|non-repudiation|aaa\b|authentication|authorization|accounting)\b/i],
  ['threat-actors', /\b(apt\b|nation-?state|hacktivist|insider threat|script kiddie|organized crime|shadow it|threat actor)\b/i],
  ['social-engineering', /\b(phishing|spear-?phishing|whaling|vishing|smishing|pretexting|tailgating|piggybacking|impersonation|watering hole|typosquatting|social engineering)\b/i],
  ['malware', /\b(ransomware|trojan|worm|rootkit|spyware|keylogger|botnet|backdoor|logic bomb|fileless|bloatware|malware|virus)\b/i],
  ['application-attacks', /\b(sql injection|sqli|xss|cross-site|csrf|buffer overflow|race condition|directory traversal|command injection|ldap injection|xml|api attack|replay attack|pass-the-hash)\b/i],
  ['password-attacks', /\b(brute force|dictionary attack|rainbow table|credential stuffing|password spraying|birthday attack|downgrade attack)\b/i],
  ['vulnerability-management', /\b(cvss|cve\b|cwe\b|vulnerability scan|credentialed|non-credentialed|penetration test|pentest|red team|blue team|purple team|bug bounty|osint|reconnaissance|false positive|false negative)\b/i],
  ['cloud-security', /\b(iaas|paas|saas|cloud|serverless|container|docker|kubernetes|microservices|iac\b|infrastructure as code|casb|sase|sd-wan|virtualization|hypervisor|vm\b)\b/i],
  ['network-security', /\b(firewall|waf\b|ngfw|ids\b|ips\b|nid[sp]|hid[sp]|vlan|dmz|vpn|ipsec|tls|ssl|wpa[23]?|802\.1x|radius|tacacs|nac\b|port security|dnssec|proxy|load balancer|nat\b|air gap)\b/i],
  ['iam', /\b(mfa\b|2fa|totp|hotp|fido2|biometric|sso\b|saml|oauth|oidc|kerberos|ldap|federation|pam\b|rbac|abac|dac\b|mac\b|least privilege|just-in-time)\b/i],
  ['incident-response', /\b(incident response|containment|eradication|recovery|lessons learned|preparation|triage|forensic|chain of custody|legal hold|order of volatility|playbook|runbook)\b/i],
  ['secops-monitoring', /\b(siem|soar|edr\b|xdr\b|mdr\b|syslog|netflow|snmp|dlp\b|scada|ics\b|iot\b|backup|ups\b|raid|failover|redundancy|high availability)\b/i],
  ['risk-management', /\b(risk|ale\b|sle\b|aro\b|mttr|mtbf|mttf|rto\b|rpo\b|bia\b|business impact|disaster recovery|continuity|qualitative|quantitative|risk register|inherent|residual)\b/i],
  ['governance-compliance', /\b(gdpr|hipaa|pci-?dss|sox\b|iso\s*27001|nist|pii\b|phi\b|aup\b|nda\b|sla\b|mou\b|moa\b|msa\b|sow\b|policy|standard|procedure|guideline|data retention|data classification|privacy|audit)\b/i]
];

const DOMAIN_FALLBACK_TAG = {
  '1': 'general-security',
  '2': 'threats-mitigations',
  '3': 'security-architecture',
  '4': 'security-operations',
  '5': 'governance-risk'
};

function classifyQuestion(domainId, prompt, options, explanation) {
  const corpus = `${prompt} ${options.map((o) => o.text).join(' ')} ${explanation}`;
  const tags = [];
  for (const [tag, regex] of TAG_RULES) {
    if (regex.test(corpus)) tags.push(tag);
    if (tags.length === 3) break;
  }
  if (!tags.length) tags.push(DOMAIN_FALLBACK_TAG[domainId] || 'general-security');

  let objectiveId = `${domainId}.1`;
  if (domainId === '1') {
    if (/\b(aes|rsa|ecc|3des|des|cipher|encrypt|decrypt|hash|sha|md5|hmac|salt|pki|certificate|ca\b|crl|ocsp|csr|public key|private key|digital signature|key exchange|steganography|blockchain)\b/i.test(corpus)) {
      objectiveId = '1.3';
    } else if (/\b(confidentiality|integrity|availability|cia\b|non-repudiation|aaa\b|authentication|authorization|accounting|zero trust|ztna|gap analysis|deception|honeypot|honeynet|honeyfile)\b/i.test(corpus)) {
      objectiveId = '1.2';
    } else {
      objectiveId = '1.1';
    }
  } else if (domainId === '2') {
    if (/\b(cvss|cve\b|vulnerability scan|penetration test|pentest|red team|blue team|purple team|bug bounty|osint|reconnaissance|false positive|false negative|patch|remediation|compensating)\b/i.test(corpus)) {
      objectiveId = '2.3';
    } else if (/\b(apt\b|nation-?state|hacktivist|insider|script kiddie|organized crime|shadow it|supply chain|phishing|spear-?phishing|whaling|vishing|smishing|watering hole|impersonation|pretexting|social engineering|threat actor|motivation|vector)\b/i.test(corpus)) {
      objectiveId = '2.1';
    } else {
      objectiveId = '2.2';
    }
  } else if (domainId === '3') {
    if (/\b(firewall|waf\b|ngfw|ids\b|ips\b|vlan|dmz|vpn|ipsec|tls|wpa|802\.1x|radius|tacacs|nac\b|port security|proxy|load balancer|nat\b|segmentation|air gap|network|jump server|bastion)\b/i.test(corpus)) {
      objectiveId = '3.2';
    } else {
      objectiveId = '3.1';
    }
  } else if (domainId === '4') {
    if (/\b(mfa\b|2fa|totp|hotp|fido|biometric|sso\b|saml|oauth|oidc|kerberos|ldap|federation|pam\b|rbac|abac|dac\b|mac\b|least privilege|just-in-time|access control|identity|authentication|authorization|privilege|account)\b/i.test(corpus)) {
      objectiveId = '4.1';
    } else {
      objectiveId = '4.2';
    }
  } else if (domainId === '5') {
    if (/\b(risk|ale\b|sle\b|aro\b|mttr|mtbf|mttf|rto\b|rpo\b|bia\b|business impact|qualitative|quantitative|risk register|inherent|residual|avoid|transfer|mitigate|accept|vendor|third-party|supply chain)\b/i.test(corpus)) {
      objectiveId = '5.1';
    } else {
      objectiveId = '5.2';
    }
  }

  let difficulty = 'medium';
  if (prompt.length < 95 && !/\b(best|most likely|first|next|primary|scenario|administrator|engineer|analyst)\b/i.test(prompt)) {
    difficulty = 'easy';
  } else if (prompt.length > 220 || /\b(most appropriate|least likely|first step|given the following|which of the following combinations)\b/i.test(prompt)) {
    difficulty = 'hard';
  }

  return { difficulty, tags, objective_id: objectiveId };
}

function canonicalLegacyQuestion(question) { return JSON.stringify({ d: question.d, q: question.q, o: question.o, a: question.a, e: question.e }); }
function fingerprint(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableQuestionId(question, occurrences) { const base = `secplus-sy0-701-${fingerprint(canonicalLegacyQuestion(question)).slice(0, 16)}`; const count = (occurrences.get(base) || 0) + 1; occurrences.set(base, count); return count === 1 ? base : `${base}-${count}`; }
function normalizeLegacyQuestion(question, index, occurrences) {
  for (const key of LEGACY_SCHEMA) if (!(key in question)) throw new Error(`Legacy record ${index} is missing '${key}'.`);
  if (!Number.isInteger(question.d) || question.d < 1 || question.d > 5) throw new Error(`Legacy record ${index} has invalid domain.`);
  if (!Array.isArray(question.o) || question.o.length < 2) throw new Error(`Legacy record ${index} has invalid options.`);
  if (!Number.isInteger(question.a) || question.a < 0 || question.a >= question.o.length) throw new Error(`Legacy record ${index} has invalid answer index.`);
  const optionIds = question.o.map((_, optionIndex) => `option_${optionIndex + 1}`);
  const prompt = String(question.q).trim();
  const options = question.o.map((text, optionIndex) => ({ id: optionIds[optionIndex], text: String(text).trim() }));
  const explanation = String(question.e).trim();
  const domainId = String(question.d);
  const meta = classifyQuestion(domainId, prompt, options, explanation);
  return {
    id: stableQuestionId(question, occurrences),
    type: 'single_select',
    prompt,
    options,
    correct_option_ids: [optionIds[question.a]],
    explanation,
    domain_id: domainId,
    objective_id: meta.objective_id,
    difficulty: meta.difficulty,
    tags: meta.tags,
    status: 'needs_review',
    provenance: { kind: 'legacy_migration', source_file: 'questions.json', source_record_index: index, source_schema: 'd-q-o-a-e' }
  };
}
function makePublishedRecord(record) { return { ...record, status: 'published', provenance: { kind: 'original', source_file: 'questions.json', source_record_index: record.provenance.source_record_index, authoring_note: 'Reviewed original Security+ study material preserved from the established first 302-record bank; not an exam item.' } }; }
function buildMigration(legacyQuestions) {
  if (!Array.isArray(legacyQuestions) || legacyQuestions.length < REVIEWED_RECORD_COUNT) throw new Error(`questions.json must contain at least ${REVIEWED_RECORD_COUNT} records.`);
  const occurrences = new Map(); const normalized = legacyQuestions.map((question, index) => normalizeLegacyQuestion(question, index, occurrences)); const publishedRecords = normalized.slice(0, REVIEWED_RECORD_COUNT).map(makePublishedRecord); const archiveRecords = normalized.slice(REVIEWED_RECORD_COUNT); const duplicateIdSuffixes = [...occurrences.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const publishedDocument = { schema_version: '2.0', course_id: COURSE_ID, question_bank_status: 'published', content_origin: 'original', records: publishedRecords };
  const archiveDocument = { schema_version: '2.0', course_id: COURSE_ID, question_bank_status: 'needs_review', content_origin: 'legacy_migration', records: archiveRecords };
  const report = { report_version: '1.0', migration: 'legacy-securityplus-to-content-v2', source: { path: 'questions.json', record_count: legacyQuestions.length, sha256: fingerprint(JSON.stringify(legacyQuestions)), schema: LEGACY_SCHEMA }, outputs: { published: { path: 'content/comptia-security-plus-sy0-701/published-questions.v2.json', record_count: publishedRecords.length, sha256: fingerprint(JSON.stringify(publishedDocument)), question_bank_status: 'published', provenance: 'reviewed_original_subset' }, needs_review: { path: 'content/comptia-security-plus-sy0-701/needs-review-questions.v2.json', record_count: archiveRecords.length, sha256: fingerprint(JSON.stringify(archiveDocument)), question_bank_status: 'needs_review', provenance: 'legacy_migration' } }, accounting: { migrated: normalized.length, skipped: 0, published: publishedRecords.length, needs_review: archiveRecords.length, single_select: normalized.length, multi_select: 0, duplicate_id_suffixes: duplicateIdSuffixes, records_without_explanation: archiveRecords.filter((record) => !record.explanation).length }, id_strategy: 'secplus-sy0-701 + first 16 hex chars of SHA-256 over canonical legacy fields; deterministic duplicate suffix only for identical records.', app_eligibility: 'The reviewed original 302-record subset is published. The remaining legacy records are archived and excluded until editorial review changes that bank and its records to published.' };
  return { publishedDocument, archiveDocument, report };
}
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function run(args = process.argv.slice(2)) { const checkOnly = args.includes('--check'); const { publishedDocument, archiveDocument, report } = buildMigration(JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'))); const expected = [[PUBLISHED_PATH, json(publishedDocument)], [ARCHIVE_PATH, json(archiveDocument)], [REPORT_PATH, json(report)]]; if (checkOnly) { if (!expected.every(([filePath, contents]) => fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents)) throw new Error('Migration output is stale. Run: node scripts/migrate-securityplus-v2.js'); console.log(`Migration is current: ${report.accounting.published} published and ${report.accounting.needs_review} needs_review records.`); return report; } for (const [filePath, contents] of expected) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, contents, 'utf8'); } console.log(`Migrated ${report.accounting.migrated} records: ${report.accounting.published} published, ${report.accounting.needs_review} archived for review.`); return report; }
if (require.main === module) { try { run(); } catch (error) { console.error(`Migration failed: ${error.message}`); process.exitCode = 1; } }
module.exports = { buildMigration, canonicalLegacyQuestion, stableQuestionId, classifyQuestion, run };
