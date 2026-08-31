import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/screen-audit-review.ts';",
      "export * from './src/screen-audit-selection.ts';",
    ].join('\n'),
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const core = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const frame = { id: 'frame-1', removed: false, parent: null };
const group = { id: 'group-1', removed: false, parent: frame };
const textA = { id: 'a', removed: false, parent: group };
const textB = { id: 'b', removed: false, parent: frame };
const otherFrame = { id: 'frame-2', removed: false, parent: null };
const outside = { id: 'outside', removed: false, parent: otherFrame };

test('selection contract preserves Frame and descendants', () => {
  assert.equal(core.isSelectionInsideAuditedFrame([frame], frame.id), true);
  assert.equal(core.isSelectionInsideAuditedFrame([textA], frame.id), true);
  assert.equal(core.isSelectionInsideAuditedFrame([group], frame.id), true);
  assert.equal(core.isSelectionInsideAuditedFrame([textA, textB], frame.id), true);
});

test('selection contract invalidates outside, empty, incompatible multi and deleted Frame', () => {
  assert.equal(core.isSelectionInsideAuditedFrame([otherFrame], frame.id), false);
  assert.equal(core.isSelectionInsideAuditedFrame([outside], frame.id), false);
  assert.equal(core.isSelectionInsideAuditedFrame([], frame.id), false);
  assert.equal(core.isSelectionInsideAuditedFrame([textA, outside], frame.id), false);
  frame.removed = true;
  assert.equal(core.isSelectionInsideAuditedFrame([textA], frame.id), false);
  frame.removed = false;
});

function item(id, severity = 'low', status = 'success') {
  return {
    candidate: { nodeId: id, text: id, layerName: id, context: '' },
    status,
    transport: status === 'success' ? 'local' : null,
    error: null,
    result: status === 'success' ? { severity } : null,
  };
}

const items = [item('good'), item('medium', 'medium'), item('high', 'high')];

test('review counts, default filter and filtering are deterministic', () => {
  assert.deepEqual(core.getReviewCounts(items), { reviewed: 3, attention: 2, good: 1 });
  assert.equal(core.getDefaultReviewFilter(core.getReviewCounts(items)), 'attention');
  assert.equal(core.getDefaultReviewFilter(core.getReviewCounts([items[0]])), 'all');
  assert.deepEqual(core.filterReviewItems(items, 'attention').map((x) => x.candidate.nodeId), ['medium', 'high']);
  assert.deepEqual(core.filterReviewItems(items, 'good').map((x) => x.candidate.nodeId), ['good']);
});

test('active index, filter exclusion and Previous/Next boundaries', () => {
  assert.equal(core.getActiveReviewIndex(items, 'medium'), 1);
  assert.equal(core.normalizeActiveCandidateId([items[0]], 'medium'), 'good');
  assert.deepEqual(core.getReviewNavigation(items, 'good'), {
    index: 0, hasPrevious: false, hasNext: true,
  });
  assert.deepEqual(core.getReviewNavigation(items, 'high'), {
    index: 2, hasPrevious: true, hasNext: false,
  });
});

test('changed and deleted presentation becomes attention without changing stored result', () => {
  const storedSeverity = items[0].result.severity;
  assert.equal(core.classifyReviewItem(items[0], 'changed_since_audit'), 'attention');
  assert.equal(core.describeNavigationState('changed_since_audit'), 'Este texto cambió desde la auditoría.');
  assert.equal(core.classifyReviewItem(items[0], 'deleted'), 'attention');
  assert.equal(core.describeNavigationState('deleted'), 'Este texto ya no está disponible.');
  assert.equal(items[0].result.severity, storedSeverity);
});
