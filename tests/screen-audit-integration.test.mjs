/**
 * Screen Audit en el hilo principal (FASE 9.1).
 *
 * Ejecuta `src/code.ts` de verdad con un `figma` simulado y un `fetch` que
 * registra CADA petición. La afirmación central de esta fase —que seleccionar
 * un frame no dispara ningún análisis— no se comprueba leyendo código: se
 * cuenta el tráfico.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  entryPoints: [path.join(workspace, 'src/code.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const codeSource = bundle.outputFiles[0].text;

const LOCAL_ANALYZE = 'http://localhost:8787/v1/analyze/text';
const LOCAL_STATUS = 'http://localhost:8787/v1/runtime/status';
const CLOUD_HOST = 'writing.productdesign.mx';
const SECRET = ['clave', 'nube', 'qa'].join('-');

let instance = 0;
let nodeCounter = 0;

function textNode(characters, overrides = {}) {
  nodeCounter += 1;
  return {
    id: `t${nodeCounter}`,
    name: overrides.name ?? `Capa ${nodeCounter}`,
    type: 'TEXT',
    visible: overrides.visible ?? true,
    removed: false,
    characters,
    hasMissingFont: false,
    getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
    absoluteBoundingBox: overrides.box === undefined
      ? { x: 0, y: nodeCounter }
      : overrides.box,
  };
}

function frameNode(name, children) {
  nodeCounter += 1;
  return {
    id: `f${nodeCounter}`,
    name,
    type: 'FRAME',
    visible: true,
    removed: false,
    children,
    absoluteBoundingBox: { x: 0, y: 0 },
  };
}

async function createPlugin({ selection, apiKey = null, mode = 'auto', localUp = true } = {}) {
  const requests = [];
  const messages = [];
  const storage = new Map();
  const storageWrites = [];
  const consoleCalls = [];

  if (apiKey !== null) storage.set('ux-writing-api-key', apiKey);
  storage.set('ux-writing-analysis-mode', mode);

  const listeners = new Map();
  let currentSelection = selection;

  globalThis.__html__ = '';
  globalThis.figma = {
    showUI() {},
    ui: { postMessage: (m) => messages.push(m), onmessage: null },
    on: (event, handler) => listeners.set(event, handler),
    get currentPage() { return { selection: currentSelection }; },
    clientStorage: {
      async getAsync(key) { return storage.get(key); },
      async setAsync(key, value) { storageWrites.push(key); storage.set(key, value); },
      async deleteAsync(key) { storageWrites.push(key); storage.delete(key); },
    },
    async loadFontAsync() {},
  };

  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === LOCAL_STATUS) {
      if (!localUp) throw new Error('ECONNREFUSED');
      return {
        status: 200, headersObject: {},
        async text() {
          return JSON.stringify({
            runtime: 'ready', ollama: 'ready',
            model: 'qwen3.5:4b', model_available: true,
          });
        },
      };
    }
    throw new Error('ECONNREFUSED');
  };

  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...args) => consoleCalls.push(args.join(' '));
  console.warn = (...args) => consoleCalls.push(args.join(' '));

  instance += 1;
  await import(`data:text/javascript;base64,${
    Buffer.from(`${codeSource}\n// ${instance}\n`).toString('base64')}`);

  console.log = realLog;
  console.warn = realWarn;

  const onmessage = globalThis.figma.ui.onmessage;
  const drain = async (rounds = 30) => {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  };
  const send = async (message) => { onmessage(message); await drain(); };

  await send({ type: 'UI_READY' });

  return {
    send, drain, requests, messages, storage, storageWrites, consoleCalls,
    changeSelection: async (next) => {
      currentSelection = next;
      listeners.get('selectionchange')?.();
      await drain();
    },
    preflight: () => [...messages].reverse()
      .find((m) => m.type === 'SCREEN_PREFLIGHT_READY')?.payload.preflight,
    invalidations: () => messages.filter((m) => m.type === 'SCREEN_PREFLIGHT_INVALIDATED'),
    selectionMessages: () => messages.filter((m) => m.type === 'SELECTION_CHANGED'),
    analysisRequests: () => requests.filter(
      (r) => r.url === LOCAL_ANALYZE || String(r.url).includes(`${CLOUD_HOST}/v1/analyze`),
    ),
    cloudRequests: () => requests.filter((r) => String(r.url).includes(CLOUD_HOST)),
  };
}

const SAMPLE_FRAME = () => frameNode('Domicilio', [
  textNode('Tu visita ha sido confirmada'),
  textNode('{{Jueves 10 de abril}}'),
  textNode('9:41'),
  textNode('Continuar'),
  textNode('', { name: 'Vacío' }),
  textNode('Oculto', { visible: false }),
]);

// --- 02, 03 — el frame produce preflight -------------------------------------

test('02: seleccionar un frame emite SCREEN_PREFLIGHT_READY', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()] });
  const preflight = plugin.preflight();

  assert.ok(preflight, 'no se emitió el preflight');
  assert.equal(preflight.frameName, 'Domicilio');
  assert.equal(preflight.detectedCount, 6);
  assert.equal(preflight.eligibleCount, 2);
  assert.equal(preflight.skippedCount, 4);
});

test('01: seleccionar un solo texto NO emite preflight de pantalla', async () => {
  const plugin = await createPlugin({ selection: [textNode('Continuar')] });

  assert.equal(plugin.preflight(), undefined);
  assert.equal(plugin.selectionMessages().pop().payload.status, 'ready');
});

// --- 30, 31 — cero red -------------------------------------------------------

test('30 y 31 BLOQUEANTE: el preflight no dispara ningún análisis', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()], apiKey: SECRET });

  assert.equal(plugin.analysisRequests().length, 0, 'el preflight llamó a un análisis');
  assert.equal(plugin.cloudRequests().length, 0, 'el preflight llamó a la nube');

  // Matiz importante: la comprobación de salud al abrir el plugin SÍ está
  // permitida y no es una petición de análisis.
  const analyze = plugin.requests.filter((r) => String(r.url).includes('/v1/analyze'));
  assert.equal(analyze.length, 0);
});

test('30b: cambiar de frame repetidamente sigue sin generar análisis', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()], apiKey: SECRET });

  for (let index = 0; index < 5; index += 1) {
    await plugin.changeSelection([frameNode(`Pantalla ${index}`, [textNode('Continuar')])]);
  }

  assert.equal(plugin.analysisRequests().length, 0);
  assert.equal(plugin.cloudRequests().length, 0);
});

// --- 32, 33 — independencia de credenciales y motor --------------------------

test('32: el preflight funciona sin API Key', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()], apiKey: null });

  assert.ok(plugin.preflight());
  assert.equal(plugin.preflight().eligibleCount, 2);
});

test('33: el preflight funciona con el motor local caído', async () => {
  const plugin = await createPlugin({
    selection: [SAMPLE_FRAME()], apiKey: null, localUp: false,
  });

  assert.ok(plugin.preflight(), 'el preflight dependió del motor local');
  assert.equal(plugin.preflight().eligibleCount, 2);
});

test('33b: funciona incluso en modo Solo local con el motor caído', async () => {
  const plugin = await createPlugin({
    selection: [SAMPLE_FRAME()], mode: 'local', localUp: false,
  });

  assert.ok(plugin.preflight());
});

// --- 34 — sin persistencia ---------------------------------------------------

test('34: el preflight no escribe en clientStorage', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()], apiKey: SECRET });

  assert.deepEqual(plugin.storageWrites, [], 'el preflight persistió algo');
});

// --- 29 — obsolescencia ------------------------------------------------------

test('29: cambiar de selección invalida el preflight anterior', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()] });
  const first = plugin.preflight();

  await plugin.changeSelection([textNode('Continuar')]);

  const invalidations = plugin.invalidations();
  assert.ok(invalidations.length >= 1, 'no se invalidó el preflight');
  assert.ok(
    invalidations[invalidations.length - 1].payload.revision > first.revision,
    'la revisión no avanzó',
  );
});

test('29b: cada frame nuevo trae una revisión mayor', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()] });
  const first = plugin.preflight().revision;

  await plugin.changeSelection([frameNode('Otra', [textNode('Guardar')])]);
  const second = plugin.preflight();

  assert.ok(second.revision > first);
  assert.equal(second.frameName, 'Otra');
  assert.equal(second.detectedCount, 1);
});

// --- 35, 36 — frontera y privacidad ------------------------------------------

test('35: no se serializa ningún objeto de Figma hacia la UI', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()] });

  for (const message of plugin.messages) {
    const serialized = JSON.stringify(message);
    assert.doesNotMatch(serialized, /getRangeAllFontNames|hasMissingFont|"removed"/u,
      'se filtró un nodo de Figma a la UI');
    // Y todo mensaje debe sobrevivir un viaje por JSON sin perder nada.
    assert.deepEqual(JSON.parse(serialized), message);
  }
});

test('36 BLOQUEANTE: el contenido de la pantalla no llega a los registros', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()] });
  const logged = plugin.consoleCalls.join('\n');

  for (const fragment of ['Tu visita ha sido confirmada', 'Continuar',
    'Jueves 10 de abril', 'Pantalla: Domicilio']) {
    assert.ok(!logged.includes(fragment), `se registró contenido: ${fragment}`);
  }
});

test('el contexto se prepara pero no viaja a ninguna petición', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()], apiKey: SECRET });
  const preflight = plugin.preflight();

  assert.match(preflight.candidates[0].context, /^Pantalla: Domicilio\./u);
  assert.equal(plugin.requests.filter((r) => r.options?.body).length, 0,
    'el preflight envió un cuerpo de petición');
});

// --- 24, 40 — Text Audit intacto ---------------------------------------------

test('24: Text Audit sigue funcionando tras haber visto un frame', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()], apiKey: SECRET });
  assert.ok(plugin.preflight());

  await plugin.changeSelection([textNode('Continuar')]);

  const selection = plugin.selectionMessages().pop().payload;
  assert.equal(selection.status, 'ready');
  assert.equal(selection.text, 'Continuar');
  // Y el preflight de pantalla ya no está vigente.
  assert.ok(plugin.invalidations().length >= 1);
});

test('una selección no soportada no rompe ni deja preflight colgado', async () => {
  const plugin = await createPlugin({ selection: [SAMPLE_FRAME()] });

  await plugin.changeSelection([
    { id: 'g1', name: 'Grupo', type: 'GROUP', visible: true, removed: false },
  ]);

  assert.equal(plugin.selectionMessages().pop().payload.status, 'invalid-selection');
  assert.ok(plugin.invalidations().length >= 1);
});
