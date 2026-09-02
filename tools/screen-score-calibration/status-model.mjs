export const CANDIDATE_THRESHOLDS = Object.freeze([
  Object.freeze({ highThreshold: 80, lowThreshold: 60 }),
  Object.freeze({ highThreshold: 85, lowThreshold: 65 }),
  Object.freeze({ highThreshold: 85, lowThreshold: 70 }),
  Object.freeze({ highThreshold: 90, lowThreshold: 70 }),
]);

export function classifyScreenStatus({ score, highThreshold, lowThreshold }) {
  validateThresholds(highThreshold, lowThreshold);
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError('score must be a finite number from 0 to 100');
  }
  if (score >= highThreshold) return 'Buen nivel';
  if (score >= lowThreshold) return 'Necesita atención';
  return 'Requiere revisión';
}

export function validateThresholds(highThreshold, lowThreshold) {
  if (
    typeof highThreshold !== 'number' || !Number.isFinite(highThreshold)
    || typeof lowThreshold !== 'number' || !Number.isFinite(lowThreshold)
    || lowThreshold < 0 || lowThreshold >= highThreshold || highThreshold > 100
  ) {
    throw new RangeError('thresholds must satisfy 0 <= low < high <= 100');
  }
}
