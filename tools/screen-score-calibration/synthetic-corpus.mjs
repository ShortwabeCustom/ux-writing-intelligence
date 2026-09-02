const repeat = (value, count) => Array.from({ length: count }, () => value);

export const SYNTHETIC_CORPUS = Object.freeze([
  ['one-100', [100]],
  ['one-20', [20]],
  ['all-100-4', repeat(100, 4)],
  ['all-90-4', repeat(90, 4)],
  ['all-70-4', repeat(70, 4)],
  ['all-40-4', repeat(40, 4)],
  ['100-plus-20', [100, 20]],
  ['three-100-plus-20', [...repeat(100, 3), 20]],
  ['nine-100-plus-20', [...repeat(100, 9), 20]],
  ['29-100-plus-20', [...repeat(100, 29), 20]],
  ['99-100-plus-20', [...repeat(100, 99), 20]],
  ['100-plus-40', [100, 40]],
  ['100-plus-60', [100, 60]],
  ['100-100-40-40', [100, 100, 40, 40]],
  ['90-90-90-10', [90, 90, 90, 10]],
  ['100-60-60-60', [100, 60, 60, 60]],
  ['40-100', [40, 100]],
  ['duplicate-high', [...repeat(100, 6), 20]],
  ['duplicate-low', [100, 100, 20, 20]],
  ['same-mean-uniform-70', repeat(70, 4)],
  ['same-mean-concentrated-70', [100, 100, 40, 40]],
  ['same-mean-moderate-70', [100, 60, 60, 60]],
  ['same-mean-severe-70', [90, 90, 90, 10]],
  ['30-100-plus-20', [...repeat(100, 30), 20]],
  ['30-100-plus-40', [...repeat(100, 30), 40]],
  ['30-100-plus-60', [...repeat(100, 30), 60]],
].map(([id, scores]) => Object.freeze({ id, scores: Object.freeze(scores) })));

export const ASYMPTOTIC_WORSTS = Object.freeze([20, 40, 60]);
export const ASYMPTOTIC_GOOD_COUNTS = Object.freeze([1, 3, 9, 29, 99, 999]);
