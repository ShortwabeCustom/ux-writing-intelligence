const BLOCK_SIZE = 10;

function hashSeed(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.codePointAt(0), 16777619);
  return value >>> 0;
}

function nextRandom(state) {
  let value = state.value;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value / 4294967296;
}

export function randomizeReviewOrder(records, { reviewerId, protocolVersion = 'expert-study-v1' }) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (typeof reviewerId !== 'string' || reviewerId.length === 0) throw new TypeError('reviewerId is required');
  const state = { value: hashSeed(`${reviewerId}:${protocolVersion}`) || 1 };
  const remaining = records.map((record, sourceIndex) => ({ ...record, sourceIndex }));
  const ordered = [];
  while (remaining.length > 0) {
    const index = Math.floor(nextRandom(state) * remaining.length);
    ordered.push(remaining.splice(index, 1)[0]);
  }
  return ordered.map((record, index) => ({
    ...record,
    review_order: index + 1,
    block: Math.floor(index / BLOCK_SIZE) + 1,
  }));
}
