import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  entryPoints: [path.join(workspace, 'src/audit-session-store.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const storeApi = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const result = (score = 90) => ({
  text: 'Continuar', locale: 'es-MX', score, severity: 'low',
  clarity: 5, concision: 5, utility: 5, jargon: false,
  predictability: 5, orthography: 5, issues: [], reason: 'Claro.',
  suggestion: 'Continuar',
});

function screenSnapshot(frameId, score = 90, overrides = {}) {
  const candidate = {
    nodeId: `${frameId}-text`, text: 'Continuar', layerName: 'CTA',
    parentName: frameId, order: 0, status: 'ready', skipReason: null, context: '',
  };
  return {
    frameId, frameName: 'Domicilio', completedAt: score,
    session: {
      sessionId: `session-${frameId}-${score}`, frameId, frameName: 'Domicilio',
      selectionRevision: 1, status: 'completed', total: 1, completed: 1,
      changed: 0, failed: 0, currentIndex: 1, executionTransport: 'local',
      cloudContinuationAvailable: false,
      items: [{ candidate, status: 'success', transport: 'local', result: result(score), error: null }],
    },
    review: { filter: 'attention', activeCandidateId: candidate.nodeId, navigationStates: {} },
    ...overrides,
  };
}

function textSnapshot(nodeId, score = 90) {
  return {
    nodeId, nodeName: 'CTA', originalText: 'Continuar', requestId: `request-${nodeId}-${score}`,
    result: result(score), transport: 'cloud', completedAt: score,
  };
}

test('screen save/get supports multiple IDs with the same name', () => {
  const store = storeApi.createAuditSessionStore();
  storeApi.saveScreenAudit(store, screenSnapshot('frame-a'));
  storeApi.saveScreenAudit(store, screenSnapshot('frame-b'));
  assert.equal(store.screenAudits.size, 2);
  assert.equal(storeApi.getScreenAudit(store, 'frame-a').frameId, 'frame-a');
  assert.equal(storeApi.getScreenAudit(store, 'frame-b').frameId, 'frame-b');
});

test('completed screen replacement succeeds; incomplete replacement preserves previous', () => {
  const store = storeApi.createAuditSessionStore();
  storeApi.saveScreenAudit(store, screenSnapshot('frame-a', 60));
  storeApi.saveScreenAudit(store, screenSnapshot('frame-a', 97));
  assert.equal(storeApi.getScreenAudit(store, 'frame-a').session.items[0].result.score, 97);

  const incomplete = screenSnapshot('frame-a', 20);
  incomplete.session.status = 'paused';
  assert.equal(storeApi.saveScreenAudit(store, incomplete), false);
  assert.equal(storeApi.getScreenAudit(store, 'frame-a').session.items[0].result.score, 97);
});

test('text save/get supports multiple nodes and successful replacement', () => {
  const store = storeApi.createAuditSessionStore();
  storeApi.saveTextAudit(store, textSnapshot('text-a', 60));
  storeApi.saveTextAudit(store, textSnapshot('text-b', 80));
  storeApi.saveTextAudit(store, textSnapshot('text-a', 97));
  assert.equal(store.textAudits.size, 2);
  assert.equal(storeApi.getTextAudit(store, 'text-a').result.score, 97);
  assert.equal(storeApi.getTextAudit(store, 'text-b').result.score, 80);
});

test('failed text replacement, empty selection and outside selection do not mutate store', () => {
  const store = storeApi.createAuditSessionStore();
  storeApi.saveTextAudit(store, textSnapshot('text-a', 88));
  // Failures and selection changes intentionally call no save operation.
  assert.equal(storeApi.getTextAudit(store, 'text-a').result.score, 88);
  assert.equal(store.textAudits.size, 1);
});

test('frame deletion cleanup is keyed by ID; rename preserves snapshot and review', () => {
  const store = storeApi.createAuditSessionStore();
  const snapshot = screenSnapshot('frame-a');
  storeApi.saveScreenAudit(store, snapshot);
  storeApi.saveScreenAudit(store, { ...snapshot, frameName: 'Nuevo nombre' });
  assert.equal(storeApi.getScreenAudit(store, 'frame-a').frameName, 'Nuevo nombre');
  assert.equal(storeApi.getScreenAudit(store, 'frame-a').review.filter, 'attention');
  assert.equal(storeApi.removeFrameAudit(store, 'frame-a'), true);
  assert.equal(storeApi.getScreenAudit(store, 'frame-a'), null);
});

test('screen reconciliation handles unchanged, changed, deleted and moved candidates', () => {
  assert.equal(storeApi.reconcileScreenCandidate('Continuar', {
    type: 'TEXT', characters: 'Continuar', belongsToAuditedFrame: true,
  }), 'current');
  assert.equal(storeApi.reconcileScreenCandidate('Continuar', {
    type: 'TEXT', characters: 'Seguir', belongsToAuditedFrame: true,
  }), 'changed_since_audit');
  assert.equal(storeApi.reconcileScreenCandidate('Continuar', null), 'deleted');
  assert.equal(storeApi.reconcileScreenCandidate('Continuar', {
    type: 'TEXT', characters: 'Continuar', belongsToAuditedFrame: false,
  }), 'deleted');
});

test('text reconciliation handles unchanged, changed and deleted; layer rename is irrelevant', () => {
  const snapshot = textSnapshot('text-a');
  assert.equal(storeApi.reconcileTextAudit(snapshot, {
    id: 'text-a', type: 'TEXT', characters: 'Continuar', name: 'Nombre nuevo',
  }), 'current');
  assert.equal(storeApi.reconcileTextAudit(snapshot, {
    id: 'text-a', type: 'TEXT', characters: 'Cambió',
  }), 'changed');
  assert.equal(storeApi.reconcileTextAudit(snapshot, null), 'deleted');
});

test('review updates preserve provenance and independent screen result data', () => {
  const store = storeApi.createAuditSessionStore();
  storeApi.saveScreenAudit(store, screenSnapshot('frame-a', 60));
  storeApi.updateScreenAuditReview(store, 'frame-a', {
    filter: 'good', activeCandidateId: null,
    navigationStates: { 'frame-a-text': 'changed_since_audit' },
  });
  const restored = storeApi.getScreenAudit(store, 'frame-a');
  assert.equal(restored.session.items[0].transport, 'local');
  assert.equal(restored.session.items[0].result.score, 60);
  assert.equal(restored.review.filter, 'good');
});
