import assert from 'node:assert/strict';
import { calculateScreenScore, CANDIDATE_LAMBDAS } from './score-model.mjs';
import { classifyScreenStatus } from './status-model.mjs';

function score(scores, lambda) {
  return calculateScreenScore({ scores, lambda }).roundedScore;
}

function assertInvariants(lambda) {
  for (let first = 0; first <= 100; first += 5) {
    for (let second = 0; second <= 100; second += 5) {
      const values = [first, second, 50];
      const result = calculateScreenScore({ scores: values, lambda });
      assert(result.roundedScore >= 0 && result.roundedScore <= 100);
      assert(score(values, lambda) <= result.mean + 1e-9);
      assert(score(values, lambda) >= result.minimum - 1e-9);
      assert.equal(score(values, lambda), score([...values].reverse(), lambda));
      for (let index = 0; index < values.length; index += 1) {
        const improved = [...values];
        improved[index] = Math.min(100, improved[index] + 5);
        assert(score(improved, lambda) >= score(values, lambda));
        const worsened = [...values];
        worsened[index] = Math.max(0, worsened[index] - 5);
        assert(score(worsened, lambda) <= score(values, lambda));
      }
    }
  }

  for (const value of [0, 1, 20, 40, 70, 99, 100]) {
    assert.equal(score([value], lambda), value);
    assert.equal(score([value, value, value], lambda), value);
  }
  assert.equal(score([100, 100, 20], lambda), score([100, 20, 100], lambda));
  assert.equal(score([100, 100, 20], lambda), score([100, 100, 20, 100, 100, 20], lambda));
}

function run() {
  for (const lambda of CANDIDATE_LAMBDAS) assertInvariants(lambda);
  assert.equal(classifyScreenStatus({ score: 80, highThreshold: 80, lowThreshold: 60 }), 'Buen nivel');
  assert.equal(classifyScreenStatus({ score: 60, highThreshold: 80, lowThreshold: 60 }), 'Necesita atención');
  assert.equal(classifyScreenStatus({ score: 59, highThreshold: 80, lowThreshold: 60 }), 'Requiere revisión');
  console.log(`INVARIANTS: PASS (${CANDIDATE_LAMBDAS.length} lambdas)`);
}

run();
