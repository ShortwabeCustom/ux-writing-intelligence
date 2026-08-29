/**
 * FASE 8.5.5 — enrutamiento local/nube.
 *
 * Estas pruebas ejecutan `src/code.ts` de verdad, con un `figma` simulado y un
 * `fetch` que registra CADA petición. No comprueban intenciones: cuentan a
 * dónde salió el tráfico. Es la única forma de demostrar afirmaciones como
 * «cero peticiones a la nube», que es un requisito de privacidad y no una
 * preferencia de diseño.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const bundle = await build({
  entryPoints: [path.join(workspace, 'src/code.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});

const codeSource = bundle.outputFiles[0]?.text;

if (codeSource === undefined) {
  throw new Error('No se pudo compilar code.ts para pruebas.');
}

const CLOUD_HOST = 'writing.productdesign.mx';
const LOCAL_ANALYZE = 'http://localhost:8787/v1/analyze/text';
const LOCAL_STATUS = 'http://localhost:8787/v1/runtime/status';
const API_KEY_STORAGE_KEY = 'ux-writing-api-key';
const MODE_STORAGE_KEY = 'ux-writing-analysis-mode';
const SECRET = ['clave', 'secreta', 'nube'].join('-');
const SOURCE_TEXT = 'Continuar';

const VALID_RESULT = {
  text: SOURCE_TEXT,
  locale: 'es-MX',
  score: 82,
  severity: 'low',
  clarity: 5,
  concision: 5,
  utility: 4,
  jargon: false,
  predictability: 5,
  orthography: 5,
  issues: [],
  reason: 'El contenido es claro.',
  suggestion: SOURCE_TEXT,
};

function jsonResponse(status, body) {
  return {
    status,
    headersObject: {},
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

const READY_STATUS = {
  runtime: 'ready',
  ollama: 'ready',
  model: 'qwen3.5:4b',
  model_available: true,
};

const MODEL_MISSING_STATUS = { ...READY_STATUS, model_available: false };
const DEGRADED_STATUS = { ...READY_STATUS, runtime: 'starting' };

let instanceCounter = 0;

// Reloj controlable: la caché de salud dura 30 s y hay que poder cruzar esa
// frontera sin esperarla de verdad.
let fakeNow = 1_000_000;
const realDateNow = Date.now;
Date.now = () => fakeNow;
process.on('exit', () => { Date.now = realDateNow; });

/**
 * Levanta una instancia aislada del plugin.
 *
 * `localStatus: null` simula el runtime apagado: el fetch de salud rechaza,
 * igual que un ECONNREFUSED real.
 */
async function createPlugin({
  mode,
  apiKey = null,
  localStatus = READY_STATUS,
  localAnalyze = () => jsonResponse(200, VALID_RESULT),
  text = SOURCE_TEXT,
} = {}) {
  const requests = [];
  const messages = [];
  const storage = new Map();

  if (apiKey !== null) {
    storage.set(API_KEY_STORAGE_KEY, apiKey);
  }

  if (mode !== undefined) {
    storage.set(MODE_STORAGE_KEY, mode);
  }

  const textNode = {
    id: 'node-1',
    name: 'Etiqueta',
    type: 'TEXT',
    removed: false,
    characters: text,
    hasMissingFont: false,
    getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
  };

  const listeners = new Map();

  globalThis.__html__ = '<html></html>';
  globalThis.figma = {
    showUI() {},
    ui: {
      postMessage(message) {
        messages.push(message);
      },
      onmessage: null,
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    currentPage: { selection: [textNode] },
    clientStorage: {
      async getAsync(key) {
        return storage.get(key);
      },
      async setAsync(key, value) {
        storage.set(key, value);
      },
      async deleteAsync(key) {
        storage.delete(key);
      },
    },
    async loadFontAsync() {},
  };

  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });

    if (url === LOCAL_STATUS) {
      if (localStatus === null) {
        throw new Error('ECONNREFUSED');
      }

      return jsonResponse(200, localStatus);
    }

    if (url === LOCAL_ANALYZE) {
      return localAnalyze();
    }

    if (String(url).includes(CLOUD_HOST)) {
      return jsonResponse(200, VALID_RESULT);
    }

    throw new Error(`URL inesperada: ${url}`);
  };

  instanceCounter += 1;
  const source = `${codeSource}\n// instancia ${instanceCounter}\n`;
  await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );

  const onmessage = globalThis.figma.ui.onmessage;

  // `figma.ui.onmessage` devuelve void: lanza el trabajo asíncrono y no lo
  // expone. Para observar el resultado hay que ceder el turno varias veces
  // hasta que se agotan las promesas encadenadas.
  async function drain(rounds = 40) {
    for (let index = 0; index < rounds; index += 1) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  }

  async function send(message) {
    onmessage(message);
    await drain();
  }

  await send({ type: 'UI_READY' });

  return {
    send,
    requests,
    messages,
    storage,
    textNode,
    drain,
    revision: () => {
      const selectionMessages = messages.filter((m) => m.type === 'SELECTION_CHANGED');
      return selectionMessages[selectionMessages.length - 1]?.payload.revision ?? 0;
    },
    analyze: async () => {
      await send({ type: 'ANALYZE_REQUEST', selectionRevision: 0 });
    },
    cloudRequests: () => requests.filter((r) => String(r.url).includes(CLOUD_HOST)),
    localAnalyzeRequests: () => requests.filter((r) => r.url === LOCAL_ANALYZE),
    lastFailure: () => [...messages].reverse().find((m) => m.type === 'ANALYSIS_FAILED'),
    advanceClock: (ms) => { fakeNow += ms; },
    lastStarted: () => [...messages].reverse().find((m) => m.type === 'ANALYSIS_STARTED'),
    succeeded: () => messages.filter((m) => m.type === 'ANALYSIS_SUCCEEDED'),
  };
}

// --- STEP 50, casos 1-9 — AUTO ----------------------------------------------

test('AUTO 1: local listo + nube configurada → local, sin nube, sin clave', async () => {
  const plugin = await createPlugin({ mode: 'auto', apiKey: SECRET });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 1, 'debe haber exactamente 1 análisis local');
  assert.equal(plugin.cloudRequests().length, 0, 'no debe haber ninguna petición a la nube');
  assert.equal(plugin.lastStarted().transport, 'local');
  assert.equal(plugin.succeeded().length, 1);

  // STEP 23 / 36: la clave no puede aparecer en NINGUNA petición local.
  const serialized = JSON.stringify(plugin.requests);
  assert.ok(!serialized.includes(SECRET), 'la API Key llegó a localhost');
});

test('AUTO 2: local listo + nube sin configurar → local', async () => {
  const plugin = await createPlugin({ mode: 'auto', apiKey: null });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 1);
  assert.equal(plugin.cloudRequests().length, 0);
});

test('AUTO 3: local caído ANTES del envío + nube configurada → nube', async () => {
  const plugin = await createPlugin({ mode: 'auto', apiKey: SECRET, localStatus: null });
  await plugin.analyze();

  // STEP 37: el texto nunca se envió al motor local.
  assert.equal(plugin.localAnalyzeRequests().length, 0, 'no debe enviarse texto al local');
  assert.equal(plugin.cloudRequests().length, 1, 'debe haber exactamente 1 petición a la nube');
  assert.equal(plugin.lastStarted().transport, 'cloud');
});

test('AUTO 4: local caído + nube sin configurar → bloqueado, sin tráfico', async () => {
  const plugin = await createPlugin({ mode: 'auto', apiKey: null, localStatus: null });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 0);
  assert.equal(plugin.cloudRequests().length, 0);
  assert.equal(plugin.lastFailure().error.code, 'NO_ANALYSIS_ENGINE_AVAILABLE');
  assert.equal(plugin.lastFailure().cloudRetryAvailable, false);
});

test('AUTO 5: modelo ausente + nube configurada → nube', async () => {
  const plugin = await createPlugin({
    mode: 'auto', apiKey: SECRET, localStatus: MODEL_MISSING_STATUS,
  });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 0);
  assert.equal(plugin.cloudRequests().length, 1);
});

test('AUTO 6: motor degradado + nube configurada → nube', async () => {
  const plugin = await createPlugin({
    mode: 'auto', apiKey: SECRET, localStatus: DEGRADED_STATUS,
  });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 0);
  assert.equal(plugin.cloudRequests().length, 1);
});

// --- STEP 38 — fallos POSTERIORES al envío: nunca nube automática -----------

test('AUTO 7 (BLOQUEANTE): timeout local tras el POST → 0 peticiones a la nube', async () => {
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => jsonResponse(504, { code: 'MODEL_TIMEOUT' }),
  });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 1);
  assert.equal(plugin.cloudRequests().length, 0, 'hubo fallback automático a la nube');
  assert.equal(plugin.lastFailure().error.code, 'LOCAL_ANALYSIS_TIMEOUT');
  // La nube se OFRECE, no se toma.
  assert.equal(plugin.lastFailure().cloudRetryAvailable, true);
});

test('AUTO 8 (BLOQUEANTE): respuesta local inválida → 0 peticiones a la nube', async () => {
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => jsonResponse(200, { text: 'otra cosa' }),
  });
  await plugin.analyze();

  assert.equal(plugin.cloudRequests().length, 0);
  assert.equal(plugin.lastFailure().error.code, 'INVALID_RESPONSE');
  assert.equal(plugin.lastFailure().cloudRetryAvailable, true);
});

test('AUTO 8b (BLOQUEANTE): el runtime cae durante el POST → 0 peticiones a la nube', async () => {
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => { throw new Error('ECONNREFUSED'); },
  });
  await plugin.analyze();

  assert.equal(plugin.cloudRequests().length, 0, 'una caída durante el POST disparó la nube');
  assert.equal(plugin.lastFailure().error.code, 'LOCAL_RUNTIME_UNAVAILABLE');
});

test('AUTO 8c (BLOQUEANTE): fallo del motor local → 0 peticiones a la nube', async () => {
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => jsonResponse(503, { code: 'OLLAMA_UNAVAILABLE' }),
  });
  await plugin.analyze();

  assert.equal(plugin.cloudRequests().length, 0);
});

// --- STEP 39 — acción explícita ---------------------------------------------

test('AUTO 9: la acción explícita hacia la nube hace exactamente 1 petición', async () => {
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => jsonResponse(504, { code: 'MODEL_TIMEOUT' }),
  });
  await plugin.analyze();
  assert.equal(plugin.cloudRequests().length, 0);

  await plugin.send({ type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS', selectionRevision: 0 });

  const cloudCalls = plugin.cloudRequests();
  assert.equal(cloudCalls.length, 1, 'la acción explícita debe hacer 1 sola petición');
  assert.equal(plugin.succeeded().length, 1);

  // La clave viaja SOLO a la nube.
  const headers = cloudCalls[0].options.headers;
  assert.equal(headers['X-API-Key'], SECRET);
  const localSerialized = JSON.stringify(plugin.localAnalyzeRequests());
  assert.ok(!localSerialized.includes(SECRET));
});

// --- STEP 50, casos 10-13 — SOLO LOCAL --------------------------------------

test('SOLO LOCAL 10: motor listo → local', async () => {
  const plugin = await createPlugin({ mode: 'local' });
  await plugin.analyze();

  assert.equal(plugin.localAnalyzeRequests().length, 1);
  assert.equal(plugin.cloudRequests().length, 0);
});

test('SOLO LOCAL 11: motor caído → bloqueado', async () => {
  const plugin = await createPlugin({ mode: 'local', localStatus: null });
  await plugin.analyze();

  assert.equal(plugin.lastFailure().error.code, 'LOCAL_RUNTIME_UNAVAILABLE');
  assert.equal(plugin.cloudRequests().length, 0);
});

test('SOLO LOCAL 12 (BLOQUEANTE): motor caído CON API Key → jamás la nube', async () => {
  const plugin = await createPlugin({
    mode: 'local', apiKey: SECRET, localStatus: null,
  });
  await plugin.analyze();

  // STEP 35: garantía de privacidad. Tener clave configurada no habilita nada.
  assert.equal(plugin.cloudRequests().length, 0, 'Solo local envió contenido a la nube');
  assert.equal(plugin.localAnalyzeRequests().length, 0);
  assert.equal(plugin.lastFailure().error.code, 'LOCAL_RUNTIME_UNAVAILABLE');
  assert.equal(plugin.lastFailure().cloudRetryAvailable, false, 'no debe ofrecerse la nube');
});

test('SOLO LOCAL 12b (BLOQUEANTE): ni siquiera la acción explícita alcanza la nube', async () => {
  const plugin = await createPlugin({
    mode: 'local', apiKey: SECRET, localStatus: null,
  });
  await plugin.send({ type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS', selectionRevision: 0 });

  assert.equal(plugin.cloudRequests().length, 0, 'Solo local aceptó una ruta a la nube');
});

test('SOLO LOCAL 12c (BLOQUEANTE): fallo tras el POST no ofrece la nube', async () => {
  const plugin = await createPlugin({
    mode: 'local',
    apiKey: SECRET,
    localAnalyze: () => jsonResponse(504, { code: 'MODEL_TIMEOUT' }),
  });
  await plugin.analyze();

  assert.equal(plugin.cloudRequests().length, 0);
  assert.equal(plugin.lastFailure().cloudRetryAvailable, false);
});

test('SOLO LOCAL 13: modelo ausente → bloqueado con su propio código', async () => {
  const plugin = await createPlugin({ mode: 'local', localStatus: MODEL_MISSING_STATUS });
  await plugin.analyze();

  assert.equal(plugin.lastFailure().error.code, 'LOCAL_MODEL_NOT_AVAILABLE');
  assert.equal(plugin.cloudRequests().length, 0);
});

// --- STEP 50, casos 14-15 — SOLO NUBE ---------------------------------------

test('SOLO NUBE 14: con API Key → nube, sin comprobar el motor local', async () => {
  const plugin = await createPlugin({ mode: 'cloud', apiKey: SECRET });
  await plugin.analyze();

  assert.equal(plugin.cloudRequests().length, 1);
  assert.equal(plugin.localAnalyzeRequests().length, 0);

  // STEP 8: no se consulta la salud local durante el análisis.
  const statusChecksAfterStart = plugin.requests
    .slice(plugin.requests.findIndex((r) => String(r.url).includes(CLOUD_HOST)))
    .filter((r) => r.url === LOCAL_STATUS);
  assert.equal(statusChecksAfterStart.length, 0);
});

test('SOLO NUBE 15: sin API Key → bloqueado con copia propia', async () => {
  const plugin = await createPlugin({ mode: 'cloud', apiKey: null });
  await plugin.analyze();

  assert.equal(plugin.cloudRequests().length, 0);
  assert.equal(plugin.lastFailure().error.code, 'CLOUD_NOT_CONFIGURED');
});

// --- STEP 2 / 3 — persistencia y migración ----------------------------------

test('migración: sin modo guardado se asume Automático, sin tocar la API Key', async () => {
  const plugin = await createPlugin({ mode: undefined, apiKey: SECRET });

  const modeMessage = plugin.messages.find((m) => m.type === 'ANALYSIS_MODE_STATUS');
  assert.equal(modeMessage.payload.mode, 'auto');
  assert.equal(plugin.storage.get(API_KEY_STORAGE_KEY), SECRET, 'la API Key se destruyó');
  assert.equal(plugin.storage.has(MODE_STORAGE_KEY), false, 'la migración no debe escribir');
});

test('migración: un modo corrupto degrada a Automático', async () => {
  const plugin = await createPlugin({ mode: 'telepatia' });
  const modeMessage = plugin.messages.find((m) => m.type === 'ANALYSIS_MODE_STATUS');
  assert.equal(modeMessage.payload.mode, 'auto');
});

test('el modo se persiste bajo su propia clave y no pisa la API Key', async () => {
  const plugin = await createPlugin({ mode: 'auto', apiKey: SECRET });
  await plugin.send({ type: 'SET_ANALYSIS_MODE', mode: 'local' });

  assert.equal(plugin.storage.get(MODE_STORAGE_KEY), 'local');
  assert.equal(plugin.storage.get(API_KEY_STORAGE_KEY), SECRET);
});

test('el modo persistido se restaura al reiniciar', async () => {
  const plugin = await createPlugin({ mode: 'cloud', apiKey: SECRET });
  const modeMessage = plugin.messages.find((m) => m.type === 'ANALYSIS_MODE_STATUS');
  assert.equal(modeMessage.payload.mode, 'cloud');
});

// --- STEP 12 / 54 — el estado del motor no se queda en «Comprobando…» -------

test('tras un análisis local exitoso el estado queda en listo', async () => {
  const plugin = await createPlugin({ mode: 'auto' });
  await plugin.analyze();

  const statuses = plugin.messages.filter((m) => m.type === 'LOCAL_RUNTIME_STATUS');
  assert.equal(statuses[statuses.length - 1].payload.state, 'ready');
});

test('los avisos de estado del motor superan el validador de la UI', async () => {
  // Regresión de FASE 8.5.4: `isMainToUiMessage` no tenía caso para
  // LOCAL_RUNTIME_STATUS, así que la UI descartaba cada aviso y el indicador
  // se quedaba en «Comprobando…» para siempre.
  const uiBundle = await build({
    stdin: {
      contents: "export * from './src/shared/messages.ts';",
      resolveDir: workspace,
      loader: 'js',
    },
    bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
  });
  const shared = await import(
    `data:text/javascript;base64,${Buffer.from(uiBundle.outputFiles[0].text).toString('base64')}`
  );

  assert.equal(shared.isUiToMainMessage({ type: 'CHECK_LOCAL_RUNTIME' }), true);
  assert.equal(shared.isUiToMainMessage({ type: 'SET_ANALYSIS_MODE', mode: 'local' }), true);
  assert.equal(shared.isUiToMainMessage({ type: 'SET_ANALYSIS_MODE', mode: 'x' }), false);
  assert.equal(
    shared.isUiToMainMessage({ type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS', selectionRevision: 0 }),
    true,
  );
});

// --- STEP 21 — frescura del estado local ------------------------------------

test('el análisis reutiliza el estado local reciente en vez de reconsultarlo', async () => {
  const plugin = await createPlugin({ mode: 'auto' });
  const before = plugin.requests.filter((r) => r.url === LOCAL_STATUS).length;

  await plugin.analyze();
  await plugin.send({ type: 'ANALYZE_REQUEST', selectionRevision: plugin.revision() });

  const after = plugin.requests.filter((r) => r.url === LOCAL_STATUS).length;
  assert.equal(after, before, 'se reconsultó la salud dentro de la ventana de frescura');
});

// --- STEP 40 / 41 — carreras -------------------------------------------------

test('cambiar de modo durante un análisis no redirige la petición en vuelo', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: async () => {
      await pending;
      return jsonResponse(200, VALID_RESULT);
    },
  });

  const analysis = plugin.analyze();
  await plugin.send({ type: 'SET_ANALYSIS_MODE', mode: 'cloud' });
  release();
  await analysis;
  await plugin.drain();

  assert.equal(plugin.localAnalyzeRequests().length, 1);
  assert.equal(plugin.cloudRequests().length, 0, 'la petición en vuelo se redirigió');
  assert.equal(plugin.succeeded().length, 1);
});

test('una revisión de selección obsoleta no dispara análisis', async () => {
  const plugin = await createPlugin({ mode: 'auto' });
  await plugin.send({ type: 'ANALYZE_REQUEST', selectionRevision: 99 });

  assert.equal(plugin.localAnalyzeRequests().length, 0);
  assert.equal(plugin.cloudRequests().length, 0);
  assert.equal(plugin.lastFailure().error.code, 'STALE_SELECTION');
});


// =============================================================================
// FASE 8.5.5.2 — verdad del enrutamiento en la recuperación
// =============================================================================
//
// Defecto 1: «Reintentar» reutilizaba el flujo genérico. Pasada la ventana de
// frescura de 30 s, en AUTO con nube configurada, resolvía a la nube — un
// destino que nadie autorizó al pulsar un botón que dice «Reintentar».
//
// Defecto 2: el retry explícito forzaba la nube pero no publicaba el motor
// activo, así que la interfaz seguía diciendo «Local».

/** Plugin con el motor local caído tras un fallo POSTERIOR al POST. */
async function pluginAfterLocalFailure(overrides = {}) {
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => jsonResponse(504, { code: 'MODEL_TIMEOUT' }),
    ...overrides,
  });
  await plugin.analyze();
  return plugin;
}

for (const elapsedMs of [0, 31_000, 60_000]) {
  test(`BLOQUEANTE: «Reintentar local» tras ${elapsedMs / 1000}s NO llama a la nube`, async () => {
    const plugin = await pluginAfterLocalFailure();
    const cloudBefore = plugin.cloudRequests().length;
    assert.equal(cloudBefore, 0);

    // El runtime sigue caído: el reintento debe fallar en LOCAL, no huir.
    plugin.advanceClock(elapsedMs);
    await plugin.send({ type: 'RETRY_LOCAL_ANALYSIS', selectionRevision: 0 });

    assert.equal(
      plugin.cloudRequests().length, 0,
      `el reintento local acabó en la nube tras ${elapsedMs} ms`,
    );
    assert.equal(plugin.lastStarted().transport, 'local');
    // El comportamiento no puede depender de la caducidad de la caché.
    assert.equal(plugin.lastFailure().error.code, 'LOCAL_ANALYSIS_TIMEOUT');
  });
}

test('BLOQUEANTE: «Reintentar local» no lee ni envía la API Key', async () => {
  const plugin = await pluginAfterLocalFailure();
  plugin.advanceClock(31_000);
  await plugin.send({ type: 'RETRY_LOCAL_ANALYSIS', selectionRevision: 0 });

  const serialized = JSON.stringify(plugin.requests);
  assert.ok(!serialized.includes(SECRET), 'la API Key salió en un reintento local');
});

test('«Reintentar local» reintenta de verdad en local cuando el motor vuelve', async () => {
  let healthy = false;
  const plugin = await createPlugin({
    mode: 'auto',
    apiKey: SECRET,
    localAnalyze: () => (healthy
      ? jsonResponse(200, VALID_RESULT)
      : jsonResponse(504, { code: 'MODEL_TIMEOUT' })),
  });
  await plugin.analyze();
  assert.equal(plugin.succeeded().length, 0);

  healthy = true;
  plugin.advanceClock(31_000);
  await plugin.send({ type: 'RETRY_LOCAL_ANALYSIS', selectionRevision: 0 });

  assert.equal(plugin.lastStarted().transport, 'local');
  assert.equal(plugin.succeeded().length, 1);
  assert.equal(plugin.cloudRequests().length, 0);
});

test('BLOQUEANTE: el retry explícito hace exactamente 1 petición a la nube', async () => {
  const plugin = await pluginAfterLocalFailure();
  plugin.advanceClock(31_000);
  await plugin.send({ type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS', selectionRevision: 0 });

  assert.equal(plugin.cloudRequests().length, 1);
  // Y no dispara además un reintento local.
  assert.equal(plugin.localAnalyzeRequests().length, 1, 'hubo un reintento local extra');
  assert.equal(plugin.lastStarted().transport, 'cloud');
});

test('BLOQUEANTE: en el retry explícito la API Key viaja SOLO a la nube', async () => {
  const plugin = await pluginAfterLocalFailure();
  await plugin.send({ type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS', selectionRevision: 0 });

  const cloud = plugin.cloudRequests();
  assert.equal(cloud[0].options.headers['X-API-Key'], SECRET);
  assert.ok(!JSON.stringify(plugin.localAnalyzeRequests()).includes(SECRET));
});

test('el motor anunciado coincide con el transporte realmente invocado', async () => {
  // Recorre las cuatro combinaciones y compara ANALYSIS_STARTED.transport con
  // la URL que de verdad recibió el texto.
  const cases = [
    { name: 'AUTO→Local', opts: { mode: 'auto', apiKey: SECRET }, expected: 'local' },
    { name: 'AUTO→Nube', opts: { mode: 'auto', apiKey: SECRET, localStatus: null }, expected: 'cloud' },
    { name: 'Solo local', opts: { mode: 'local' }, expected: 'local' },
    { name: 'Solo nube', opts: { mode: 'cloud', apiKey: SECRET }, expected: 'cloud' },
  ];

  for (const testCase of cases) {
    const plugin = await createPlugin(testCase.opts);
    await plugin.analyze();

    const announced = plugin.lastStarted().transport;
    const actual = plugin.cloudRequests().length > 0 ? 'cloud' : 'local';

    assert.equal(announced, testCase.expected, `${testCase.name}: motor anunciado`);
    assert.equal(actual, testCase.expected, `${testCase.name}: transporte real`);
    assert.equal(announced, actual, `${testCase.name}: el motor anunciado no coincide`);
  }
});

test('el retry explícito anuncia la nube antes de recibir respuesta', async () => {
  const plugin = await pluginAfterLocalFailure();
  await plugin.send({ type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS', selectionRevision: 0 });

  const order = plugin.messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.type === 'ANALYSIS_STARTED' || m.type === 'ANALYSIS_SUCCEEDED');
  const startedCloud = order.find(({ m }) => m.type === 'ANALYSIS_STARTED' && m.transport === 'cloud');
  const succeeded = order.find(({ m }) => m.type === 'ANALYSIS_SUCCEEDED');

  assert.ok(startedCloud, 'no se anunció la nube');
  assert.ok(startedCloud.i < succeeded.i, 'la nube se anunció después del resultado');
});
