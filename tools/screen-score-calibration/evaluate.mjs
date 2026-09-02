import { readFile } from 'node:fs/promises';
import { calculateScreenScore, CANDIDATE_LAMBDAS, FORMULA_FAMILY, HARNESS_VERSION, MODEL_VERSION_CANDIDATE } from './score-model.mjs';
import { CANDIDATE_THRESHOLDS, classifyScreenStatus } from './status-model.mjs';
import { ASYMPTOTIC_GOOD_COUNTS, ASYMPTOTIC_WORSTS, SYNTHETIC_CORPUS } from './synthetic-corpus.mjs';
import { exportResults } from './export-results.mjs';

const round = (value) => Number(value.toFixed(6));
const repeat = (value, count) => Array.from({ length: count }, () => value);

function parseArgs(argv) {
  const args = { input: null, output: null, synthetic: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--synthetic') args.synthetic = true;
    else if (argument === '--input') args.input = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (argument === '--help') {
      console.log('Usage: npm run screen-score:synthetic | npm run screen-score:calibrate -- <file.json> [--output file.json]');
      process.exit(0);
    }
  }
  return args;
}

async function loadCorpus(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const records = Array.isArray(parsed) ? parsed : parsed.screens;
  if (!Array.isArray(records)) throw new TypeError('corpus must be an array or an object with screens');
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || !Array.isArray(record.contextual_scores)) {
      throw new TypeError(`record ${index} requires contextual_scores`);
    }
    return { ...record, id: record.screen_id ?? `screen-${String(index + 1).padStart(3, '0')}`, scores: record.contextual_scores };
  });
}

function resultFor(scores) {
  const result = {};
  for (const lambda of CANDIDATE_LAMBDAS) {
    const calculated = calculateScreenScore({ scores, lambda });
    result[`lambda_${lambda.toFixed(2)}`] = calculated.roundedScore;
  }
  return result;
}

function thresholdRows(scores) {
  return CANDIDATE_LAMBDAS.flatMap((lambda) => {
    const value = calculateScreenScore({ scores, lambda }).roundedScore;
    return CANDIDATE_THRESHOLDS.map(({ highThreshold, lowThreshold }) => ({
      lambda, highThreshold, lowThreshold, score: value,
      status: classifyScreenStatus({ score: value, highThreshold, lowThreshold }),
    }));
  });
}

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

function createMetricBucket() {
  return { mae: [], categorical: [], falseReassurance: 0, falseAlarm: 0, criticalCases: 0 };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function expertMetrics(records) {
  const labelled = records.filter((record) => Array.isArray(record.expert?.numeric_ratings) || Array.isArray(record.expert?.status_votes));
  if (labelled.length === 0) return { expert_labels: 'ABSENT' };
  const metrics = Object.fromEntries(CANDIDATE_LAMBDAS.map((lambda) => [`lambda_${lambda.toFixed(2)}`, createMetricBucket()]));
  const strata = { n: {}, worst_score: {} };
  for (const record of labelled) {
    const numericReference = median(record.expert?.numeric_ratings ?? []);
    const statusVotes = record.expert?.status_votes ?? [];
    const statusReference = statusVotes.length === 0 ? null : [...new Set(statusVotes)].sort((a, b) => statusVotes.filter((status) => status === b).length - statusVotes.filter((status) => status === a).length || a.localeCompare(b))[0];
    for (const lambda of CANDIDATE_LAMBDAS) {
      const key = `lambda_${lambda.toFixed(2)}`;
      const value = calculateScreenScore({ scores: record.contextual_scores, lambda }).roundedScore;
      const metric = metrics[key];
      const buckets = [metric, (strata.n[record.n_stratum ?? nStratum(record.contextual_scores.length)] ??= createMetricBucket()), (strata.worst_score[record.worst_score_stratum ?? worstStratum(Math.min(...record.contextual_scores))] ??= createMetricBucket())];
      if (numericReference !== null) buckets.forEach((bucket) => bucket.mae.push(Math.abs(value - numericReference)));
      if (statusReference !== null) {
        const status = classifyScreenStatus({ score: value, ...(record.thresholds ?? CANDIDATE_THRESHOLDS[0]) });
        buckets.forEach((bucket) => {
          bucket.categorical.push(status === statusReference ? 1 : 0);
          if (statusReference === 'Requiere revisión' && status === 'Buen nivel') bucket.criticalCases += 1;
          if (statusReference !== 'Buen nivel' && status === 'Buen nivel') bucket.falseReassurance += 1;
          if (statusReference === 'Buen nivel' && status !== 'Buen nivel') bucket.falseAlarm += 1;
        });
      }
    }
  }
  const summarize = (metric) => ({
    mae: metric.mae.length ? round(metric.mae.reduce((sum, value) => sum + value, 0) / metric.mae.length) : null,
    categorical_agreement: metric.categorical.length ? round(metric.categorical.reduce((sum, value) => sum + value, 0) / metric.categorical.length) : null,
    false_reassurance_count: metric.falseReassurance,
    false_alarm_count: metric.falseAlarm,
    critical_false_reassurance_count: metric.criticalCases,
  });
  return {
    expert_labels: 'PRESENT',
    labelled_records: labelled.length,
    by_lambda: Object.fromEntries(Object.entries(metrics).map(([key, metric]) => [key, summarize(metric)])),
    by_n_stratum: Object.fromEntries(Object.entries(strata.n).map(([key, metric]) => [key, summarize(metric)])),
    by_worst_score_stratum: Object.fromEntries(Object.entries(strata.worst_score).map(([key, metric]) => [key, summarize(metric)])),
  };
}

function evaluateRecords(records) {
  return records.map((record) => ({
    screen_id: record.id,
    corpus_version: record.corpus_version ?? 'unspecified',
    screen_archetype: record.screen_archetype ?? null,
    count: record.contextual_scores.length,
    mean: round(record.contextual_scores.reduce((sum, value) => sum + value, 0) / record.contextual_scores.length),
    minimum: Math.min(...record.contextual_scores),
    n_stratum: nStratum(record.contextual_scores.length),
    worst_score_stratum: worstStratum(Math.min(...record.contextual_scores)),
    scores: resultFor(record.contextual_scores),
    threshold_matrix: thresholdRows(record.contextual_scores),
  }));
}

function invariantStatus(lambda) {
  const cases = [[0], [20], [40, 100], [100, 100, 20], [70, 70, 70]];
  for (const scores of cases) {
    const result = calculateScreenScore({ scores, lambda });
    if (result.roundedScore < 0 || result.roundedScore > 100
      || result.roundedScore > result.mean || result.roundedScore < result.minimum) return 'FAIL';
    if (result.roundedScore !== calculateScreenScore({ scores: [...scores].reverse(), lambda }).roundedScore) return 'FAIL';
  }
  return 'PASS';
}

function asymptoticRows() {
  return ASYMPTOTIC_WORSTS.flatMap((worst) => CANDIDATE_LAMBDAS.map((lambda) => ({
    worst, lambda,
    rows: ASYMPTOTIC_GOOD_COUNTS.map((goodCount) => {
      const result = calculateScreenScore({ scores: [worst, ...repeat(100, goodCount)], lambda });
      return { input_count: result.count, mean: round(result.mean), minimum: result.minimum, score: result.roundedScore };
    }),
    theoretical_limit: round(100 - lambda * (100 - worst)),
  })));
}

function duplicationRows() {
  const cases = {
    A: [100, 100, 20], B: [...repeat(100, 6), 20], C: [100, 100, 20, 20],
    D: [...repeat(100, 4), 20, 20], E: [100, 100, 20, 100, 100, 20],
  };
  return Object.entries(cases).map(([id, scores]) => ({ id, count: scores.length, mean: round(scores.reduce((sum, value) => sum + value, 0) / scores.length), minimum: Math.min(...scores), scores: resultFor(scores) }));
}

function perturbationRows() {
  const base = [100, 100, 35];
  return [-10, -5, -1, 1, 5, 10].flatMap((change) => CANDIDATE_LAMBDAS.map((lambda) => {
    const next = [...base]; next[2] = Math.max(0, Math.min(100, next[2] + change));
    const oldScore = calculateScreenScore({ scores: base, lambda }).roundedScore;
    const newScore = calculateScreenScore({ scores: next, lambda }).roundedScore;
    return { change, lambda, old_score: oldScore, new_score: newScore, delta: newScore - oldScore };
  }));
}

function printTable(rows) {
  console.table(rows.map((row) => ({ id: row.screen_id ?? row.id, count: row.count, mean: row.mean, minimum: row.minimum, ...row.scores })));
}

function buildReport(records) {
  return {
    harness_version: HARNESS_VERSION,
    formula_family: FORMULA_FAMILY,
    screen_score_model_version_candidate: MODEL_VERSION_CANDIDATE,
    parameter_status: 'UNLOCKED',
    candidate_lambdas: [...CANDIDATE_LAMBDAS],
    candidate_thresholds: CANDIDATE_THRESHOLDS.map((thresholds) => ({ ...thresholds })),
    invariant_status_by_lambda: Object.fromEntries(CANDIDATE_LAMBDAS.map((lambda) => [lambda.toFixed(2), invariantStatus(lambda)])),
    corpus_version: records[0]?.corpus_version ?? 'synthetic-v1',
    expert_metrics: expertMetrics(records),
    cases: evaluateRecords(records),
    asymptotic: asymptoticRows(),
    duplication: duplicationRows(),
    perturbation: perturbationRows(),
    parameter_decision: 'INSUFFICIENT EVIDENCE',
  };
}

const args = parseArgs(process.argv.slice(2));
let records;
if (args.synthetic || !args.input) records = SYNTHETIC_CORPUS.map(({ id, scores }) => ({ id, contextual_scores: [...scores], corpus_version: 'synthetic-v1' }));
else records = await loadCorpus(args.input);
const report = buildReport(records);
printTable(report.cases);
console.log(`FORMULA: ${FORMULA_FAMILY}`);
console.log(`LAMBDA CANDIDATES: ${CANDIDATE_LAMBDAS.join(', ')}`);
console.log(`EXPERT-LABELLED CORPUS: ${report.expert_metrics.expert_labels}`);
console.log('PARAMETER DECISION: INSUFFICIENT EVIDENCE');
if (args.output) await exportResults(args.output, report);
