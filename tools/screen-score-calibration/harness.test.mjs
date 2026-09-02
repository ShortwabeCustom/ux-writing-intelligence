import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { calculateScreenScore } from './score-model.mjs';
import { classifyScreenStatus } from './status-model.mjs';
import { SYNTHETIC_CORPUS } from './synthetic-corpus.mjs';
import { randomizeReviewOrder } from './randomize.mjs';

const candidateLambdas = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45];

for (const lambda of candidateLambdas) {
  test(`formula invariants lambda=${lambda}`, () => {
    for (let first = 0; first <= 100; first += 10) {
      for (let second = 0; second <= 100; second += 10) {
        const values = [first, second, 50];
        const result = calculateScreenScore({ scores: values, lambda });
        assert(result.roundedScore >= 0 && result.roundedScore <= 100);
        assert(result.roundedScore <= result.mean + 1e-9);
        assert(result.roundedScore >= result.minimum - 1e-9);
        assert.equal(result.roundedScore, calculateScreenScore({ scores: [...values].reverse(), lambda }).roundedScore);
        for (let index = 0; index < values.length; index += 1) {
          const improved = [...values]; improved[index] = Math.min(100, improved[index] + 5);
          const worsened = [...values]; worsened[index] = Math.max(0, worsened[index] - 5);
          assert(calculateScreenScore({ scores: improved, lambda }).roundedScore >= result.roundedScore);
          assert(calculateScreenScore({ scores: worsened, lambda }).roundedScore <= result.roundedScore);
        }
      }
    }
    for (const value of [0, 20, 40, 70, 100]) {
      assert.equal(calculateScreenScore({ scores: [value], lambda }).roundedScore, value);
      assert.equal(calculateScreenScore({ scores: [value, value, value], lambda }).roundedScore, value);
    }
  });
}

test('input validation rejects invalid numeric inputs', () => {
  for (const scores of [[], [NaN], [Infinity], [-1], [101], ['80']]) {
    assert.throws(() => calculateScreenScore({ scores, lambda: 0.2 }));
  }
  for (const lambda of [-0.1, 1.1, NaN, Infinity, '0.2']) {
    assert.throws(() => calculateScreenScore({ scores: [80], lambda }));
  }
});

test('rounding occurs once after full precision', () => {
  const result = calculateScreenScore({ scores: [100, 73], lambda: 0.25 });
  assert.equal(result.rawScore, 83.125);
  assert.equal(result.clampedScore, 83.125);
  assert.equal(result.roundedScore, 83);
  assert.equal(calculateScreenScore({ scores: [72.5], lambda: 0.2 }).roundedScore, 73);
});

test('status thresholds are deterministic and independently validated', () => {
  assert.equal(classifyScreenStatus({ score: 80, highThreshold: 80, lowThreshold: 60 }), 'Buen nivel');
  assert.equal(classifyScreenStatus({ score: 60, highThreshold: 80, lowThreshold: 60 }), 'Necesita atención');
  assert.equal(classifyScreenStatus({ score: 59, highThreshold: 80, lowThreshold: 60 }), 'Requiere revisión');
  assert.throws(() => classifyScreenStatus({ score: 80, highThreshold: 60, lowThreshold: 80 }));
});

test('synthetic corpus contains required large anti-dilution cases', () => {
  const ids = new Set(SYNTHETIC_CORPUS.map((item) => item.id));
  assert(ids.has('30-100-plus-20'));
  assert(ids.has('30-100-plus-40'));
  assert(ids.has('30-100-plus-60'));
});

test('full population duplication is idempotent', () => {
  for (const lambda of candidateLambdas) {
    const original = calculateScreenScore({ scores: [100, 100, 20], lambda }).roundedScore;
    const duplicated = calculateScreenScore({ scores: [100, 100, 20, 100, 100, 20], lambda }).roundedScore;
    assert.equal(original, duplicated);
  }
});

test('a fixed poor minimum cannot disappear as perfect scores are added', () => {
  for (const lambda of candidateLambdas) {
    const limit = 100 - lambda * (100 - 20);
    const result = calculateScreenScore({ scores: [20, ...Array.from({ length: 999 }, () => 100)], lambda });
    assert(result.roundedScore <= Math.ceil(limit));
    assert(result.roundedScore < 100);
  }
});

test('synthetic JSON export is canonical and reproducible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'screen-score-'));
  const firstPath = join(directory, 'first.json');
  const secondPath = join(directory, 'second.json');
  const script = fileURLToPath(new URL('./evaluate.mjs', import.meta.url));
  for (const output of [firstPath, secondPath]) {
    const run = spawnSync(process.execPath, [script, '--synthetic', '--output', output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  }
  assert.equal(await readFile(firstPath, 'utf8'), await readFile(secondPath, 'utf8'));
  await rm(directory, { recursive: true, force: true });
});

test('review randomization is deterministic and reviewer-specific', () => {
  const records = Array.from({ length: 20 }, (_, index) => ({ screen_id: `SCR-${String(index + 1).padStart(3, '0')}` }));
  const first = randomizeReviewOrder(records, { reviewerId: 'EXP-001' });
  const repeat = randomizeReviewOrder(records, { reviewerId: 'EXP-001' });
  const other = randomizeReviewOrder(records, { reviewerId: 'EXP-002' });
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.map((record) => record.screen_id), other.map((record) => record.screen_id));
  assert.equal(first[0].review_order, 1);
  assert.equal(first[9].block, 1);
  assert.equal(first[10].block, 2);
});
