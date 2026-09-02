import { readFile, writeFile } from 'node:fs/promises';
import { calculateScreenScore } from './score-model.mjs';

export const CORPUS_VERSION = 'screen-score-calibration-exploratory-v1';
export const ARCHETYPES = Object.freeze([
  'form', 'onboarding_setup', 'transactional', 'confirmation_success',
  'errors_blockers', 'empty_states', 'informational', 'decision_selection',
  'dense_complex_content',
]);

function nStratum(count) {
  if (count <= 3) return 'small';
  if (count <= 10) return 'medium';
  if (count <= 30) return 'large';
  return 'very_large';
}

function worstStratum(value) {
  if (value <= 20) return '0-20';
  if (value <= 40) return '21-40';
  if (value <= 60) return '41-60';
  if (value <= 80) return '61-80';
  return '81-100';
}

function distributionKey(scores) {
  return [...scores].sort((a, b) => a - b).join(',');
}

function parseArgs(argv) {
  const args = { input: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') args.input = argv[++index];
    else if (argv[index] === '--output') args.output = argv[++index];
  }
  return args;
}

async function loadRecords(input) {
  if (input === null) return [];
  const value = JSON.parse(await readFile(input, 'utf8'));
  const records = Array.isArray(value) ? value : value.screens;
  if (!Array.isArray(records)) throw new TypeError('input must be an array or an object with screens');
  return records;
}

function normalizeRecord(record, index, distributionCounts) {
  if (!record || typeof record !== 'object') throw new TypeError(`record ${index} must be an object`);
  const id = record.screen_id;
  if (typeof id !== 'string' || !/^SCR-[0-9]{3}$/u.test(id)) throw new TypeError(`record ${index} requires screen_id SCR-###`);
  if (!ARCHETYPES.includes(record.primary_archetype)) throw new TypeError(`${id} requires one primary_archetype`);
  if (record.privacy_status === 'EXCLUDE') return { ...record, included: false, exclusion_reason: 'privacy EXCLUDE' };
  if (record.privacy_status === 'REDACTION_REQUIRED') return { ...record, included: false, exclusion_reason: 'privacy REDACTION_REQUIRED' };
  if (record.privacy_status !== 'SAFE') throw new TypeError(`${id} requires privacy_status SAFE, REDACTION_REQUIRED, or EXCLUDE`);
  if (record.audit_state !== 'current_complete' || record.audit_complete !== true || record.audit_current !== true) return { ...record, included: false, exclusion_reason: 'audit is not current_complete' };
  if (!Array.isArray(record.contextual_scores) || record.contextual_scores.length === 0) throw new TypeError(`${id} requires contextual_scores`);
  if (record.ready_count !== record.contextual_scores.length || record.analyzed_success_count !== record.ready_count) throw new TypeError(`${id} requires analyzed_success_count == ready_count == score count`);
  const result = calculateScreenScore({ scores: record.contextual_scores, lambda: 0 });
  const key = distributionKey(record.contextual_scores);
  const possibleDuplicate = (distributionCounts.get(key) ?? 0) > 0;
  distributionCounts.set(key, (distributionCounts.get(key) ?? 0) + 1);
  return {
    screen_id: id,
    corpus_version: CORPUS_VERSION,
    primary_archetype: record.primary_archetype,
    ready_count: record.ready_count,
    analyzed_success_count: record.analyzed_success_count,
    contextual_scores: [...record.contextual_scores],
    mean_score: result.mean,
    minimum_score: result.minimum,
    principal_risk_index: record.principal_risk_index ?? record.contextual_scores.indexOf(result.minimum),
    score_distribution: { count: result.count, mean: result.mean, minimum: result.minimum },
    n_stratum: nStratum(result.count),
    worst_score_stratum: worstStratum(result.minimum),
    audit_state: 'current_complete',
    audit_complete: true,
    audit_current: true,
    privacy_status: 'SAFE',
    scoring_contract_version: record.scoring_contract_version ?? null,
    source_provenance_summary: record.source_provenance_summary ?? null,
    ...(possibleDuplicate ? { possible_duplicate: true } : {}),
  };
}

function countBy(records, property) {
  return records.reduce((counts, record) => {
    counts[record[property]] = (counts[record[property]] ?? 0) + 1;
    return counts;
  }, {});
}

export function prepareCorpus(records) {
  const distributionCounts = new Map();
  const normalized = records.map((record, index) => normalizeRecord(record, index, distributionCounts));
  const included = normalized.filter((record) => record.included !== false);
  const privacyStatusCounts = Object.fromEntries(['SAFE', 'REDACTION_REQUIRED', 'EXCLUDE'].map((status) => [status, records.filter((record) => record.privacy_status === status).length]));
  const missingArchetypes = ARCHETYPES.filter((archetype) => (countBy(included, 'primary_archetype')[archetype] ?? 0) === 0);
  const missingWorstStrata = ['0-20', '21-40', '41-60', '61-80', '81-100'].filter((stratum) => (countBy(included, 'worst_score_stratum')[stratum] ?? 0) === 0);
  return {
    corpus_version: CORPUS_VERSION,
    status: 'PREPARATION',
    target_screen_count: 40,
    current_eligible_screen_count: included.length,
    archetype_counts: countBy(included, 'primary_archetype'),
    n_stratum_counts: countBy(included, 'n_stratum'),
    worst_score_stratum_counts: countBy(included, 'worst_score_stratum'),
    privacy_status_counts: privacyStatusCounts,
    coverage_gaps: [
      ...(missingArchetypes.length ? [`CORPUS COVERAGE GAP: archetypes missing: ${missingArchetypes.join(', ')}`] : []),
      ...(missingWorstStrata.length ? [`CORPUS COVERAGE GAP: worst-score strata missing: ${missingWorstStrata.join(', ')}`] : []),
    ],
    possible_duplicate_ids: included.filter((record) => record.possible_duplicate).map((record) => record.screen_id),
    records: included,
  };
}

const args = parseArgs(process.argv.slice(2));
const report = prepareCorpus(await loadRecords(args.input));
console.log(`CORPUS: ${report.corpus_version}`);
console.log(`CURRENT ELIGIBLE: ${report.current_eligible_screen_count}`);
console.log(`COVERAGE GAPS: ${report.coverage_gaps.length}`);
console.log(`POSSIBLE DUPLICATES: ${report.possible_duplicate_ids.length}`);
if (args.output) await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
