export const FORMULA_FAMILY = 'mean_worst_blend';
export const HARNESS_VERSION = '1.0.0';
export const MODEL_VERSION_CANDIDATE = '1';
export const CANDIDATE_LAMBDAS = Object.freeze([0.20, 0.25, 0.30, 0.35, 0.40, 0.45]);

export function calculateScreenScore({ scores, lambda }) {
  validateScores(scores);
  validateLambda(lambda);

  const count = scores.length;
  const mean = scores.reduce((total, score) => total + score, 0) / count;
  const minimum = Math.min(...scores);
  const rawScore = (1 - lambda) * mean + lambda * minimum;
  const clampedScore = Math.max(0, Math.min(100, rawScore));
  const roundedScore = Math.round(clampedScore);

  return { count, mean, minimum, lambda, rawScore, clampedScore, roundedScore };
}

export function validateScores(scores) {
  if (!Array.isArray(scores) || scores.length === 0) {
    throw new TypeError('scores must be a non-empty array');
  }
  for (const score of scores) {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new RangeError('scores must contain finite numbers from 0 to 100');
    }
  }
}

export function validateLambda(lambda) {
  if (typeof lambda !== 'number' || !Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new RangeError('lambda must be a finite number from 0 to 1');
  }
}
