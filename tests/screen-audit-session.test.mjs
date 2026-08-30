/**
 * Máquina de estados de la auditoría de pantalla (FASE 9.2B, STEP 35).
 *
 * Reductor puro. Estas pruebas no dependen del DOM ni de la red: cubren las
 * transiciones, los contadores y —lo más delicado— que la procedencia de cada
 * resultado no se reescriba nunca.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: "export * from './src/screen-audit-session.ts';",
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});

const core = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const RESULT = {
  text: 'Continuar', locale: 'es-MX', score: 96, severity: 'low',
  clarity: 5, concision: 5, utility: 5, jargon: false,
  predictability: 5, orthography: 5, issues: [],
  reason: 'Claro.', suggestion: 'Continuar',
};

function candidate(index) {
  return {
    nodeId: `n${index}`,
    text: `Texto ${index}`,
    layerName: `Capa ${index}`,
    parentName: 'Body',
    order: index,
    status: 'ready',
    skipReason: null,
    context: `Pantalla: X. Capa: Capa ${index}.`,
  };
}

function session(count = 3, transport = 'local') {
  return core.createSession({
    sessionId: 'screen-1',
    frameId: 'f1',
    frameName: 'Domicilio',
    selectionRevision: 2,
    candidates: Array.from({ length: count }, (_, i) => candidate(i)),
    transport,
  });
}

const reduce = core.reduceScreenAuditSession;

function succeedAt(state, index, transport = 'local') {
  return reduce(reduce(state, { type: 'ITEM_STARTED', index }),
    { type: 'ITEM_SUCCEEDED', index, result: RESULT, transport });
}

// --- creación ----------------------------------------------------------------

test('la sesión nace lista para ejecutar, con contadores en cero', () => {
  const state = session(3);

  assert.equal(state.status, 'running');
  assert.equal(state.total, 3);
  assert.equal(state.completed, 0);
  assert.equal(state.changed, 0);
  assert.equal(state.failed, 0);
  assert.equal(state.currentIndex, 0);
  assert.equal(state.executionTransport, 'local');
  assert.ok(state.items.every((i) => i.status === 'pending'));
});

test('una pantalla sin candidatos nace completada', () => {
  assert.equal(session(0).status, 'completed');
});

// --- éxito y avance ----------------------------------------------------------

test('cada éxito avanza el índice y suma un analizado', () => {
  let state = succeedAt(session(3), 0);

  assert.equal(state.items[0].status, 'success');
  assert.equal(state.completed, 1);
  assert.equal(state.currentIndex, 1);
  assert.equal(state.status, 'running');

  state = succeedAt(state, 1);
  assert.equal(state.completed, 2);
  assert.equal(state.currentIndex, 2);
});

test('el último éxito cierra la auditoría', () => {
  let state = session(2);
  state = succeedAt(state, 0);
  state = succeedAt(state, 1);

  assert.equal(state.status, 'completed');
  assert.equal(state.completed, 2);
});

// --- texto cambiado ----------------------------------------------------------

test('un texto que cambió NO cuenta como analizado', () => {
  let state = reduce(session(3), { type: 'ITEM_CHANGED', index: 0 });

  assert.equal(state.items[0].status, 'changed');
  assert.equal(state.changed, 1);
  assert.equal(state.completed, 0, 'un texto cambiado se contó como analizado');
  assert.equal(state.currentIndex, 1, 'no continuó con el siguiente');
  assert.equal(state.status, 'running');
});

test('un texto cambiado no bloquea a los siguientes', () => {
  let state = reduce(session(3), { type: 'ITEM_CHANGED', index: 0 });
  state = succeedAt(state, 1);
  state = succeedAt(state, 2);

  assert.equal(state.status, 'completed');
  assert.equal(state.completed, 2);
  assert.equal(state.changed, 1);
  assert.equal(state.completed + state.changed, state.total);
});

// --- fallo y pausa -----------------------------------------------------------

test('BLOQUEANTE: un fallo de transporte PAUSA, no salta al siguiente', () => {
  const state = reduce(session(3), {
    type: 'ITEM_FAILED', index: 0,
    error: { code: 'LOCAL_RUNTIME_UNAVAILABLE' },
    transport: 'local', cloudContinuationAvailable: true,
  });

  assert.equal(state.status, 'paused');
  assert.equal(state.failed, 1);
  assert.equal(state.currentIndex, 0, 'avanzó pese al fallo');
  assert.equal(state.items[1].status, 'pending');
  assert.equal(state.cloudContinuationAvailable, true);
});

test('reanudar reintenta el elemento que falló, no el siguiente', () => {
  let state = reduce(session(3), {
    type: 'ITEM_FAILED', index: 0, error: { code: 'LOCAL_ANALYSIS_TIMEOUT' },
    transport: 'local', cloudContinuationAvailable: true,
  });
  state = reduce(state, { type: 'RESUMED', transport: 'local' });

  assert.equal(state.status, 'running');
  assert.equal(state.currentIndex, 0);
  assert.equal(state.items[0].status, 'pending');
  assert.equal(state.items[0].error, null);
  assert.equal(state.failed, 0);
  assert.equal(state.cloudContinuationAvailable, false);
});

// --- procedencia por elemento ------------------------------------------------

test('BLOQUEANTE: continuar en la nube NO reescribe la procedencia anterior', () => {
  let state = session(4, 'local');
  state = succeedAt(state, 0, 'local');
  state = succeedAt(state, 1, 'local');

  state = reduce(state, {
    type: 'ITEM_FAILED', index: 2, error: { code: 'LOCAL_RUNTIME_UNAVAILABLE' },
    transport: 'local', cloudContinuationAvailable: true,
  });
  state = reduce(state, { type: 'RESUMED', transport: 'cloud' });
  state = succeedAt(state, 2, 'cloud');
  state = succeedAt(state, 3, 'cloud');

  assert.equal(state.items[0].transport, 'local', 'un resultado local se repintó');
  assert.equal(state.items[1].transport, 'local', 'un resultado local se repintó');
  assert.equal(state.items[2].transport, 'cloud');
  assert.equal(state.items[3].transport, 'cloud');
  assert.equal(state.executionTransport, 'cloud');
  assert.equal(state.status, 'completed');
});

test('el transporte de ejecución no altera resultados ya cerrados', () => {
  let state = succeedAt(session(2, 'local'), 0, 'local');
  const before = state.items[0].transport;

  state = reduce(state, {
    type: 'ITEM_FAILED', index: 1, error: { code: 'LOCAL_ANALYSIS_TIMEOUT' },
    transport: 'local', cloudContinuationAvailable: true,
  });
  state = reduce(state, { type: 'RESUMED', transport: 'cloud' });

  assert.equal(state.items[0].transport, before);
});

// --- invalidación ------------------------------------------------------------

test('BLOQUEANTE: una sesión invalidada ignora cualquier evento posterior', () => {
  let state = reduce(session(3), { type: 'INVALIDATED' });
  assert.equal(state.status, 'invalidated');

  const after = succeedAt(state, 0);
  assert.equal(after.status, 'invalidated');
  assert.equal(after.completed, 0, 'una respuesta tardía entró en una sesión muerta');
});

test('un evento fuera del índice actual se ignora', () => {
  // Una respuesta tardía no puede atribuirse a otro candidato.
  const state = succeedAt(session(3), 2);

  assert.equal(state.completed, 0);
  assert.equal(state.currentIndex, 0);
  assert.equal(state.items[2].status, 'pending');
});

test('la pertenencia a la sesión se comprueba por identificador', () => {
  const state = session(2);

  assert.equal(core.belongsToSession(state, 'screen-1'), true);
  assert.equal(core.belongsToSession(state, 'screen-2'), false);
  assert.equal(core.belongsToSession(null, 'screen-1'), false);
});

// --- utilidades --------------------------------------------------------------

test('isRunnable refleja si queda trabajo', () => {
  assert.equal(core.isRunnable(session(1)), true);
  assert.equal(core.isRunnable(session(0)), false);
  assert.equal(core.isRunnable(succeedAt(session(1), 0)), false);
  assert.equal(core.isRunnable(reduce(session(1), { type: 'INVALIDATED' })), false);
});

test('resolvedItems devuelve éxitos y cambiados, en orden visual', () => {
  let state = succeedAt(session(3), 0);
  state = reduce(state, { type: 'ITEM_CHANGED', index: 1 });

  const resolved = core.resolvedItems(state);
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map((i) => i.candidate.order), [0, 1]);
});

test('el reductor no muta el estado recibido', () => {
  const original = session(2);
  const snapshot = JSON.stringify(original);
  succeedAt(original, 0);

  assert.equal(JSON.stringify(original), snapshot);
});

test('el contrato de sesión se valida y rechaza formas inválidas', () => {
  assert.equal(core.isScreenAuditSession(session(2)), true);
  assert.equal(core.isScreenAuditSession({ ...session(2), status: 'x' }), false);
  assert.equal(core.isScreenAuditSession({ ...session(2), items: [{}] }), false);
  assert.equal(core.isScreenAuditSession(null), false);
});
