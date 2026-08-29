/**
 * Meta-prueba de contratos de mensajes (FASE 8.5.6, STEP 35).
 *
 * MOTIVO: la misma clase de fallo apareció TRES veces en fases previas —un
 * tipo declarado en la unión pero ausente del `switch` del validador, que caía
 * en `default: false` y descartaba el mensaje en silencio—. TypeScript no la
 * detecta: el `switch` es exhaustivo sobre lo que sabe, y el valor entrante es
 * `unknown`.
 *
 * Consecuencias reales: el indicador del motor se quedó en «Comprobando…» para
 * siempre, y el botón de reintento no hacía nada.
 *
 * Esta prueba lee la unión declarada en el fuente y exige que TODO discriminante
 * sea aceptado por su validador con una muestra válida.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/shared/messages.ts';",
      "export * from './src/shared/main-to-ui.ts';",
      "export * from './src/analyze-contracts.ts';",
    ].join('\n'),
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});

const core = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const messagesSource = await readFile(
  path.join(workspace, 'src/shared/messages.ts'), 'utf8',
);

/** Discriminantes declarados en una unión de tipos del fuente. */
function declaredTypes(unionName) {
  const start = messagesSource.indexOf(`export type ${unionName} =`);
  assert.notEqual(start, -1, `no se encontró la unión ${unionName}`);
  const body = messagesSource.slice(start, messagesSource.indexOf('\n\n', start));
  return [...body.matchAll(/type: '([A-Z_]+)'/gu)].map((m) => m[1]);
}

const VALID_RESPONSE = {
  text: 'Continuar', locale: 'es-MX', score: 90, severity: 'low',
  clarity: 5, concision: 5, utility: 5, jargon: false,
  predictability: 5, orthography: 5, issues: [],
  reason: 'Claro.', suggestion: 'Continuar',
};

/** Una muestra válida por tipo de mensaje. */
const UI_TO_MAIN_SAMPLES = {
  UI_READY: {},
  CHECK_LOCAL_RUNTIME: {},
  OPEN_SETTINGS: {},
  REQUEST_API_KEY_STATUS: {},
  DELETE_API_KEY: {},
  SAVE_API_KEY: { apiKey: 'una-clave' },
  SET_ANALYSIS_MODE: { mode: 'local' },
  ANALYZE_REQUEST: { selectionRevision: 0 },
  RETRY_LOCAL_ANALYSIS: { selectionRevision: 0 },
  USE_CLOUD_FOR_CURRENT_ANALYSIS: { selectionRevision: 0 },
  APPLY_SUGGESTION: { requestId: 'analysis-1' },
};

const MAIN_TO_UI_SAMPLES = {
  ANALYSIS_MODE_STATUS: { payload: { mode: 'auto' } },
  LOCAL_RUNTIME_STATUS: { payload: { state: 'ready', modelLabel: 'Qwen 3.5' } },
  SELECTION_CHANGED: {
    payload: {
      status: 'ready', revision: 0, nodeId: 'n1', nodeName: 'T', text: 'Hola',
    },
  },
  API_KEY_STATUS: { payload: { configured: true } },
  API_KEY_SAVED: { payload: { configured: true } },
  API_KEY_DELETED: { payload: { configured: false } },
  SETTINGS_ERROR: { payload: { code: 'STORAGE_READ_FAILED' } },
  ANALYSIS_STARTED: { requestId: 'a1', transport: 'local' },
  ANALYSIS_SUCCEEDED: { requestId: 'a1', result: VALID_RESPONSE },
  ANALYSIS_FAILED: {
    requestId: 'a1', error: { code: 'UNKNOWN_ERROR' }, cloudRetryAvailable: false,
  },
  APPLY_STARTED: { requestId: 'a1' },
  APPLY_BLOCKED: { requestId: 'a1', error: { code: 'MISSING_FONT' } },
  APPLY_SUCCEEDED: {
    requestId: 'a1',
    payload: {
      requestId: 'a1', nodeId: 'n1', appliedText: 'Hola',
      previousText: 'hola', selectionRevision: 1,
    },
  },
  APPLY_FAILED: { requestId: 'a1', error: { code: 'UNKNOWN_ERROR' } },
};

test('BLOQUEANTE: todo mensaje UI→MAIN declarado es aceptado por su validador', () => {
  const declared = declaredTypes('UiToMainMessage');
  assert.ok(declared.length > 0);

  for (const type of declared) {
    const sample = UI_TO_MAIN_SAMPLES[type];
    assert.ok(
      sample !== undefined,
      `falta muestra para ${type}: añádela al actualizar el contrato`,
    );
    assert.equal(
      core.isUiToMainMessage({ type, ...sample }), true,
      `el validador DESCARTA ${type}, que sí está declarado`,
    );
  }
});

test('BLOQUEANTE: todo mensaje MAIN→UI declarado es aceptado por su validador', () => {
  const declared = declaredTypes('MainToUiMessage');
  assert.ok(declared.length > 0);

  for (const type of declared) {
    const sample = MAIN_TO_UI_SAMPLES[type];
    assert.ok(sample !== undefined, `falta muestra para ${type}`);
    assert.equal(
      core.isMainToUiMessage({ type, ...sample }), true,
      `el validador DESCARTA ${type}, que sí está declarado`,
    );
  }
});

test('las muestras cubren exactamente los tipos declarados', () => {
  // Si se elimina un tipo, su muestra debe desaparecer: evita que la prueba
  // siga «pasando» sobre un contrato que ya no existe.
  assert.deepEqual(
    Object.keys(UI_TO_MAIN_SAMPLES).sort(),
    declaredTypes('UiToMainMessage').sort(),
  );
  assert.deepEqual(
    Object.keys(MAIN_TO_UI_SAMPLES).sort(),
    declaredTypes('MainToUiMessage').sort(),
  );
});

test('los validadores siguen rechazando lo que no es válido', () => {
  // La prueba anterior sería trivial con un validador que aceptase todo.
  assert.equal(core.isUiToMainMessage({ type: 'INVENTADO' }), false);
  assert.equal(core.isMainToUiMessage({ type: 'INVENTADO' }), false);
  assert.equal(core.isUiToMainMessage(null), false);
  assert.equal(core.isMainToUiMessage('texto'), false);
  assert.equal(core.isUiToMainMessage({ type: 'SET_ANALYSIS_MODE', mode: 'x' }), false);
  assert.equal(core.isUiToMainMessage({ type: 'ANALYZE_REQUEST', selectionRevision: -1 }), false);
  assert.equal(
    core.isMainToUiMessage({ type: 'ANALYSIS_STARTED', requestId: 'a1', transport: 'ollama' }),
    false,
  );
  assert.equal(
    core.isMainToUiMessage({ type: 'LOCAL_RUNTIME_STATUS', payload: { state: 'x', modelLabel: null } }),
    false,
  );
});

// --- STEP 36 — contrato de la respuesta de análisis --------------------------

test('AnalyzeResponse: se valida cada campo requerido, sin valores por defecto', () => {
  for (const field of Object.keys(VALID_RESPONSE)) {
    const incomplete = { ...VALID_RESPONSE };
    delete incomplete[field];
    assert.equal(
      core.isAnalyzeResponse(incomplete), false,
      `falta ${field} y aun así se aceptó la respuesta`,
    );
  }
});

test('AnalyzeResponse: rechaza métricas fuera de rango y severidad inválida', () => {
  const cases = [
    { score: 101 }, { score: -1 },
    { clarity: 0 }, { clarity: 6 },
    { orthography: 0 }, { orthography: 6 },
    { predictability: 6 }, { concision: 0 }, { utility: 6 },
    { severity: 'critical' }, { severity: null },
    { jargon: 'si' },
    { issues: [{ category: 'x', severity: 'nope', term: null, reason: 'r' }] },
    { issues: [{ category: 'x', severity: 'low', reason: 'r' }] },
  ];

  for (const override of cases) {
    assert.equal(
      core.isAnalyzeResponse({ ...VALID_RESPONSE, ...override }), false,
      `se aceptó una respuesta inválida: ${JSON.stringify(override)}`,
    );
  }
});
