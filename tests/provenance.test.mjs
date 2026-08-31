/**
 * Procedencia del análisis (FASE 8.5.5.3).
 *
 * El transporte REALMENTE usado por una petición es la autoridad para la
 * carga, la tarjeta de motor y la pantalla de resultado. Nunca se deduce del
 * estado de salud del motor local, ni del modo persistido, ni re-resolviendo
 * la ruta después de la petición.
 *
 * Defecto que originó esta fase: un resultado de la nube seguía anunciándose
 * como «Local / Procesado en esta Mac».
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/analysis-state.ts';",
      "export * from './src/engine-display.ts';",
      "export * from './src/analysis-routing.ts';",
    ].join('\n'),
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});

const core = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const RESULT = { text: 'Continuar', locale: 'es-MX', score: 90, severity: 'low' };

/** Recorre el ciclo completo de una petición y devuelve el estado final. */
function runAnalysis({ optimisticTransport, startedTransport, requestId = 'analysis-1' }) {
  let state = core.reduceAnalysisState(core.INITIAL_ANALYSIS_STATE, {
    type: 'ANALYZE_REQUESTED',
    transport: optimisticTransport,
  });
  state = core.reduceAnalysisState(state, {
    type: 'ANALYSIS_STARTED', requestId, transport: startedTransport,
  });
  const loading = state;
  state = core.reduceAnalysisState(state, {
    type: 'ANALYSIS_SUCCEEDED', requestId, result: RESULT,
  });
  return { loading, success: state };
}

function engineOf(state, route, mode) {
  return core.resolveEngineDisplay({
    activeTransport: core.getAnalysisProvenance(state),
    route,
    mode,
  }).kind;
}

const LOCAL_READY_ROUTE = { status: 'ready', transport: 'local', reason: 'AUTO_LOCAL_READY' };
const CLOUD_ROUTE = { status: 'ready', transport: 'cloud', reason: 'AUTO_LOCAL_UNAVAILABLE_CLOUD' };

// --- 1..4 — procedencia por origen de la petición -----------------------------

test('1. resultado local → procedencia local', () => {
  const { success } = runAnalysis({ optimisticTransport: null, startedTransport: 'local' });
  assert.equal(core.getAnalysisProvenance(success), 'local');
  assert.equal(engineOf(success, LOCAL_READY_ROUTE, 'auto'), 'local');
});

test('2. resultado en modo Solo nube → procedencia nube', () => {
  const { success } = runAnalysis({ optimisticTransport: null, startedTransport: 'cloud' });
  assert.equal(core.getAnalysisProvenance(success), 'cloud');
  assert.equal(engineOf(success, CLOUD_ROUTE, 'cloud'), 'cloud');
});

test('3. resultado por enrutamiento previo a la nube → procedencia nube', () => {
  const { success } = runAnalysis({ optimisticTransport: null, startedTransport: 'cloud' });
  assert.equal(engineOf(success, CLOUD_ROUTE, 'auto'), 'cloud');
});

test('4. retry explícito tras fallo local → procedencia nube', () => {
  // La interfaz fija «cloud» desde el clic, antes de enviar nada.
  const { loading, success } = runAnalysis({
    optimisticTransport: 'cloud', startedTransport: 'cloud',
  });

  assert.equal(loading.transport, 'cloud', 'la carga no anunció la nube');
  assert.equal(core.getAnalysisProvenance(success), 'cloud');
});

// --- 5 — el resultado no cambia de dueño -------------------------------------

test('5. BLOQUEANTE: el motor local vuelve a estar listo y el resultado sigue siendo de la nube', () => {
  const { success } = runAnalysis({
    optimisticTransport: 'cloud', startedTransport: 'cloud',
  });

  // El runtime local revive: la ruta de la SIGUIENTE petición sería local...
  const engine = engineOf(success, LOCAL_READY_ROUTE, 'auto');

  // ...pero lo que se está mirando lo procesó la nube.
  assert.equal(engine, 'cloud', 'el resultado de la nube se atribuyó al motor local');
  assert.equal(core.getAnalysisProvenance(success), 'cloud');
});

// --- 6, 7 — carga y resultado coinciden con el transporte --------------------

test('6 y 7. carga y resultado anuncian el transporte de la petición', () => {
  for (const transport of ['local', 'cloud']) {
    const { loading, success } = runAnalysis({
      optimisticTransport: transport, startedTransport: transport,
    });

    assert.equal(loading.transport, transport, `carga (${transport})`);
    assert.equal(success.transport, transport, `resultado (${transport})`);
    // Y con la ruta prospectiva CONTRARIA, para que no pueda colarse.
    const opposite = transport === 'local' ? CLOUD_ROUTE : LOCAL_READY_ROUTE;
    assert.equal(engineOf(loading, opposite, 'auto'), transport);
    assert.equal(engineOf(success, opposite, 'auto'), transport);
  }
});

test('el hilo principal es la autoridad: corrige un transporte optimista erróneo', () => {
  // La UI supuso local, pero el hilo principal enrutó a la nube.
  const { loading, success } = runAnalysis({
    optimisticTransport: 'local', startedTransport: 'cloud',
  });

  assert.equal(loading.transport, 'cloud');
  assert.equal(success.transport, 'cloud');
});

test('un fallo conserva la procedencia de la petición que falló', () => {
  let state = core.reduceAnalysisState(core.INITIAL_ANALYSIS_STATE, {
    type: 'ANALYZE_REQUESTED', transport: 'local',
  });
  state = core.reduceAnalysisState(state, {
    type: 'ANALYSIS_STARTED', requestId: 'a1', transport: 'local',
  });
  state = core.reduceAnalysisState(state, {
    type: 'ANALYSIS_FAILED', requestId: 'a1', error: { code: 'LOCAL_ANALYSIS_TIMEOUT' },
  });

  assert.equal(state.status, 'error');
  assert.equal(state.transport, 'local', 'el fallo local se atribuyó a otro motor');
});

test('una nueva petición no hereda la procedencia de la anterior', () => {
  const { success } = runAnalysis({
    optimisticTransport: 'cloud', startedTransport: 'cloud',
  });
  const next = core.reduceAnalysisState(success, {
    type: 'ANALYZE_REQUESTED', transport: null,
  });

  assert.equal(next.transport, null, 'la procedencia vieja se arrastró');
});

test('un Text Audit restaurado conserva su procedencia sin estado de carga', () => {
  const restored = core.reduceAnalysisState(core.INITIAL_ANALYSIS_STATE, {
    type: 'ANALYSIS_RESTORED',
    requestId: 'analysis-restored',
    result: RESULT,
    transport: 'cloud',
  });
  assert.equal(restored.status, 'success');
  assert.equal(restored.transport, 'cloud');
  assert.equal(restored.result, RESULT);
});

// --- Guarda de cableado -------------------------------------------------------
//
// Las pruebas de arriba cubren la DECISIÓN de procedencia, que ya era correcta
// en 8.5.5.2. El fallo observado en Figma fue de CABLEADO: `renderAnalysis` no
// repintaba la tarjeta del motor, así que la copia de carga se actualizaba y la
// tarjeta se quedaba congelada en «Local».
//
// Sin arnés de DOM en el proyecto no se puede comprobar el repintado de verdad.
// Esta guarda lee el fuente: es débil, y por eso está aislada y etiquetada.

test('guarda de cableado: renderAnalysis repinta la tarjeta del motor', async () => {
  const { readFile } = await import('node:fs/promises');
  const uiSource = await readFile(path.join(workspace, 'src/ui.ts'), 'utf8');

  const start = uiSource.indexOf('function renderAnalysis(): void {');
  assert.notEqual(start, -1, 'no se encontró renderAnalysis');

  const body = uiSource.slice(start, uiSource.indexOf('\n}', start));
  assert.ok(
    body.includes('renderEngineRow()'),
    'renderAnalysis no repinta la tarjeta: la procedencia se mostrará desfasada',
  );
});

test('guarda de cableado: la procedencia no se lee de una variable suelta', async () => {
  const { readFile } = await import('node:fs/promises');
  const uiSource = await readFile(path.join(workspace, 'src/ui.ts'), 'utf8');

  assert.ok(
    !uiSource.includes('let activeAnalysisTransport'),
    'la procedencia volvió a una variable mutable fuera del estado',
  );
});
