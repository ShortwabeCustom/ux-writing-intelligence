/**
 * Verdad del motor anunciado (FASE 8.5.5.2, STEP 4 y 9).
 *
 * Defecto 2: el retry explícito forzaba la nube pero la interfaz seguía
 * diciendo «Local», porque la etiqueta se derivaba del estado del motor local
 * en vez del transporte realmente usado.
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

const LOCAL_READY = { status: 'ready', transport: 'local', reason: 'AUTO_LOCAL_READY' };
const CLOUD_READY = { status: 'ready', transport: 'cloud', reason: 'AUTO_LOCAL_UNAVAILABLE_CLOUD' };
const BLOCKED_LOCAL = { status: 'blocked', reason: 'LOCAL_ONLY_UNAVAILABLE' };

test('BLOQUEANTE: el retry explícito a la nube anuncia Nube, no Local', () => {
  // Escenario exacto del defecto: la salud local todavía dice «listo» —la
  // caché no ha caducado— pero la persona forzó la nube.
  const display = core.resolveEngineDisplay({
    activeTransport: 'cloud',
    route: LOCAL_READY,
    mode: 'auto',
  });

  assert.equal(display.kind, 'cloud');
  assert.equal(display.name, 'Nube');
  assert.match(display.detail, /nube/u);
});

test('BLOQUEANTE: el reintento local anuncia Local aunque la salud diga caído', () => {
  const display = core.resolveEngineDisplay({
    activeTransport: 'local',
    route: CLOUD_READY,
    mode: 'auto',
  });

  assert.equal(display.kind, 'local');
  assert.equal(display.name, 'Local');
});

test('el transporte real tiene prioridad sobre la ruta prospectiva', () => {
  // Ocho combinaciones: si hay transporte activo, la ruta es irrelevante.
  for (const route of [LOCAL_READY, CLOUD_READY, BLOCKED_LOCAL]) {
    for (const mode of ['auto', 'local', 'cloud']) {
      assert.equal(
        core.resolveEngineDisplay({ activeTransport: 'cloud', route, mode }).kind,
        'cloud',
      );
      assert.equal(
        core.resolveEngineDisplay({ activeTransport: 'local', route, mode }).kind,
        'local',
      );
    }
  }
});

test('sin petición activa se anuncia la ruta que se usaría', () => {
  assert.equal(
    core.resolveEngineDisplay({ activeTransport: null, route: LOCAL_READY, mode: 'auto' }).kind,
    'local',
  );
  assert.equal(
    core.resolveEngineDisplay({ activeTransport: null, route: CLOUD_READY, mode: 'auto' }).kind,
    'cloud',
  );
});

test('Solo local caído se anuncia bloqueado, nunca como nube', () => {
  const display = core.resolveEngineDisplay({
    activeTransport: null, route: BLOCKED_LOCAL, mode: 'local',
  });

  assert.equal(display.kind, 'blocked');
  assert.equal(display.detail, 'Motor local no disponible.');
  assert.ok(!display.detail.toLowerCase().includes('nube'));
});

test('cada motivo de bloqueo tiene una explicación propia y en lenguaje de producto', () => {
  const reasons = [
    'LOCAL_ONLY_MODEL_MISSING',
    'LOCAL_ONLY_UNAVAILABLE',
    'CLOUD_NOT_CONFIGURED',
    'NO_LOCAL_NO_CLOUD',
  ];
  const texts = reasons.map((reason) => core.describeBlockedRoute(reason));

  assert.equal(new Set(texts).size, reasons.length, 'hay motivos con la misma copia');

  for (const text of texts) {
    assert.ok(text.length > 0);
    // STEP 43: la UI normal nunca expone infraestructura.
    assert.doesNotMatch(text, /127\.0\.0\.1|8787|11434|ollama|uvicorn|localhost/iu);
  }
});

test('la ruta se anuncia igual que el transporte que se invocará', () => {
  // Recorre la matriz de enrutamiento y comprueba que la etiqueta coincide
  // con el transporte que devuelve la política.
  const cases = [
    { mode: 'auto', localRuntimeState: 'ready', cloudConfigured: true, expected: 'local' },
    { mode: 'auto', localRuntimeState: 'ready', cloudConfigured: false, expected: 'local' },
    { mode: 'auto', localRuntimeState: 'unavailable', cloudConfigured: true, expected: 'cloud' },
    { mode: 'local', localRuntimeState: 'ready', cloudConfigured: true, expected: 'local' },
    { mode: 'cloud', localRuntimeState: 'unavailable', cloudConfigured: true, expected: 'cloud' },
  ];

  for (const testCase of cases) {
    const route = core.resolveAnalysisTransport(testCase);
    const display = core.resolveEngineDisplay({
      activeTransport: null, route, mode: testCase.mode,
    });

    assert.equal(route.transport, testCase.expected);
    assert.equal(display.kind, testCase.expected,
      `${testCase.mode}/${testCase.localRuntimeState}: etiqueta y transporte no coinciden`);
  }
});
