/**
 * Ejecución de Screen Audit en el hilo principal (FASE 9.2B, STEP 34).
 *
 * Ejecuta `src/code.ts` con un `figma` simulado y un `fetch` que registra cada
 * petición con marca de tiempo. Las afirmaciones sobre secuencialidad y sobre
 * privacidad no se leen del código: se cuentan del tráfico.
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

const READY_STATUS = {
  runtime: 'ready', ollama: 'ready', model: 'qwen3.5:4b', model_available: true,
};

let instance = 0;

function jsonResponse(status, body) {
  return {
    status, headersObject: {},
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function resultFor(text) {
  return {
    text, locale: 'es-MX', score: 92, severity: 'low',
    clarity: 5, concision: 5, utility: 4, jargon: false,
    predictability: 5, orthography: 5, issues: [],
    reason: 'Claro.', suggestion: text,
  };
}

function textNode(id, characters, name) {
  return {
    id, name: name ?? `Capa ${id}`, type: 'TEXT', visible: true, removed: false,
    characters, hasMissingFont: false,
    getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
    absoluteBoundingBox: { x: 0, y: Number(id.replace(/\D/gu, '')) },
  };
}

function frameOf(name, nodes) {
  return {
    id: 'frame-1', name, type: 'FRAME', visible: true, removed: false,
    children: nodes, absoluteBoundingBox: { x: 0, y: 0 },
  };
}

const TEXTS = ['Continuar', 'Guardar cambios', 'Cancelar', 'Ver detalles', 'Aceptar'];

async function createPlugin({
  count = 3, mode = 'auto', apiKey = null, localUp = true,
  analyze = () => null, frameName = 'Domicilio',
} = {}) {
  const requests = [];
  const messages = [];
  const storage = new Map();
  const storageWrites = [];

  if (apiKey !== null) storage.set('ux-writing-api-key', apiKey);
  storage.set('ux-writing-analysis-mode', mode);

  const nodes = Array.from({ length: count }, (_, i) => textNode(`n${i + 1}`, TEXTS[i]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let currentSelection = [frameOf(frameName, nodes)];
  const listeners = new Map();

  globalThis.__html__ = '';
  globalThis.figma = {
    showUI() {},
    ui: { postMessage: (m) => messages.push(m), onmessage: null },
    on: (event, handler) => listeners.set(event, handler),
    get currentPage() { return { selection: currentSelection }; },
    async getNodeByIdAsync(id) { return nodeById.get(id) ?? null; },
    clientStorage: {
      async getAsync(k) { return storage.get(k); },
      async setAsync(k, v) { storageWrites.push(k); storage.set(k, v); },
      async deleteAsync(k) { storageWrites.push(k); storage.delete(k); },
    },
    async loadFontAsync() {},
  };

  globalThis.fetch = async (url, options) => {
    const entry = { url, options, startedAt: requests.length, active: true };
    requests.push(entry);

    try {
      if (url === LOCAL_STATUS) {
        if (!localUp) throw new Error('ECONNREFUSED');
        return jsonResponse(200, READY_STATUS);
      }
      if (url === LOCAL_ANALYZE || String(url).includes(CLOUD_HOST)) {
        const body = JSON.parse(options.body);
        const response = await analyze(body, entry, requests);
        return response ?? jsonResponse(200, resultFor(body.text));
      }
      throw new Error('ECONNREFUSED');
    } finally {
      entry.active = false;
    }
  };

  instance += 1;
  await import(`data:text/javascript;base64,${
    Buffer.from(`${codeSource}\n// ${instance}\n`).toString('base64')}`);

  const onmessage = globalThis.figma.ui.onmessage;
  // La auditoría encadena varios `await` por candidato y `onmessage` no
  // devuelve la promesa, así que hay que ceder el turno generosamente.
  const drain = async (rounds = 400) => {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  };
  const send = async (message) => { onmessage(message); await drain(); };

  await send({ type: 'UI_READY' });

  const preflight = () => [...messages].reverse()
    .find((m) => m.type === 'SCREEN_PREFLIGHT_READY')?.payload.preflight;

  return {
    send, drain, requests, messages, storageWrites, nodeById, listeners,
    preflight,
    startAudit: async () => {
      await send({
        type: 'START_SCREEN_AUDIT',
        selectionRevision: preflight().revision,
      });
    },
    changeSelection: async (next) => {
      currentSelection = next;
      listeners.get('selectionchange')?.();
      await drain();
    },
    session: () => [...messages].reverse()
      .find((m) => m.type === 'SCREEN_AUDIT_UPDATED')?.payload.session,
    sessions: () => messages.filter((m) => m.type === 'SCREEN_AUDIT_UPDATED')
      .map((m) => m.payload.session),
    analyzeRequests: () => requests.filter(
      (r) => r.url === LOCAL_ANALYZE || String(r.url).includes(`${CLOUD_HOST}/v1/analyze`)),
    localAnalyze: () => requests.filter((r) => r.url === LOCAL_ANALYZE),
    cloudAnalyze: () => requests.filter((r) => String(r.url).includes(CLOUD_HOST)),
  };
}

// --- 01..07 — secuencialidad y contrato --------------------------------------

test('01: N candidatos producen N peticiones secuenciales', async () => {
  const plugin = await createPlugin({ count: 3 });
  await plugin.startAudit();

  assert.equal(plugin.analyzeRequests().length, 3);
  assert.equal(plugin.session().status, 'completed');
  assert.equal(plugin.session().completed, 3);
});

test('02 y 03 BLOQUEANTE: nunca hay más de UNA petición de auditoría en vuelo', async () => {
  let maxConcurrent = 0;
  let active = 0;

  const plugin = await createPlugin({
    count: 5,
    analyze: async (body) => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((resolve) => { setImmediate(resolve); });
      active -= 1;
      return jsonResponse(200, resultFor(body.text));
    },
  });
  await plugin.startAudit();

  assert.equal(maxConcurrent, 1, `hubo ${maxConcurrent} peticiones simultáneas`);
  assert.equal(plugin.analyzeRequests().length, 5);
});

test('03b: la petición 2 no empieza hasta que la 1 se resuelve', async () => {
  const order = [];
  const plugin = await createPlugin({
    count: 3,
    analyze: async (body) => {
      order.push(`inicio:${body.text}`);
      await new Promise((resolve) => { setImmediate(resolve); });
      order.push(`fin:${body.text}`);
      return jsonResponse(200, resultFor(body.text));
    },
  });
  await plugin.startAudit();

  // Cada inicio va seguido de su propio fin: no hay solapamiento.
  for (let i = 0; i < order.length; i += 2) {
    assert.ok(order[i].startsWith('inicio:'), order.join(' | '));
    assert.equal(order[i + 1], order[i].replace('inicio:', 'fin:'));
  }
});

test('04, 05 y 06: cada petición lleva texto y contexto exactos, nunca un arreglo', async () => {
  const bodies = [];
  const plugin = await createPlugin({
    count: 3,
    analyze: (body) => { bodies.push(body); return null; },
  });
  await plugin.startAudit();

  const candidates = plugin.preflight().candidates.filter((c) => c.status === 'ready');

  assert.equal(bodies.length, candidates.length);
  bodies.forEach((body, index) => {
    assert.equal(body.text, candidates[index].text, 'el texto no es el exacto');
    assert.equal(body.context, candidates[index].context, 'el contexto no es el exacto');
    assert.equal(body.locale, 'es-MX');
    assert.ok(!Array.isArray(body.items), 'se envió un lote');
    assert.deepEqual(Object.keys(body).sort(), ['context', 'locale', 'text']);
  });
});

test('07: el endpoint sigue siendo /v1/analyze/text', async () => {
  const plugin = await createPlugin({ count: 2 });
  await plugin.startAudit();

  assert.ok(plugin.analyzeRequests().every((r) => String(r.url).endsWith('/v1/analyze/text')));
  assert.equal(plugin.requests.filter((r) => String(r.url).includes('analyze/screen')).length, 0);
});

// --- 08, 09, 14, 15 — privacidad --------------------------------------------

test('08 BLOQUEANTE: una auditoría local nunca envía la API Key', async () => {
  const plugin = await createPlugin({ count: 3, apiKey: SECRET });
  await plugin.startAudit();

  assert.equal(plugin.localAnalyze().length, 3);
  assert.ok(!JSON.stringify(plugin.requests).includes(SECRET));
});

test('09: una auditoría en la nube envía la clave SOLO a la nube', async () => {
  const plugin = await createPlugin({ count: 2, mode: 'cloud', apiKey: SECRET });
  await plugin.startAudit();

  const cloud = plugin.cloudAnalyze();
  assert.equal(cloud.length, 2);
  assert.ok(cloud.every((r) => r.options.headers['X-API-Key'] === SECRET));
  assert.equal(plugin.localAnalyze().length, 0);
});

test('14 BLOQUEANTE: en Solo local el conteo de peticiones a la nube es 0', async () => {
  const plugin = await createPlugin({
    count: 3, mode: 'local', apiKey: SECRET,
    analyze: () => jsonResponse(503, { code: 'OLLAMA_UNAVAILABLE' }),
  });
  await plugin.startAudit();

  assert.equal(plugin.cloudAnalyze().length, 0);
  assert.equal(plugin.session().status, 'paused');
  assert.equal(plugin.session().cloudContinuationAvailable, false,
    'Solo local ofreció continuar en la nube');

  // Ni siquiera pedida a mano.
  await plugin.send({
    type: 'CONTINUE_SCREEN_AUDIT_CLOUD',
    sessionId: plugin.session().sessionId,
  });
  assert.equal(plugin.cloudAnalyze().length, 0);
});

test('15: en Solo nube el conteo de análisis locales es 0', async () => {
  const plugin = await createPlugin({ count: 3, mode: 'cloud', apiKey: SECRET });
  await plugin.startAudit();

  assert.equal(plugin.localAnalyze().length, 0);
  assert.equal(plugin.cloudAnalyze().length, 3);
});

// --- 10..13 — enrutamiento y recuperación ------------------------------------

test('10: AUTO con motor listo audita todo en local', async () => {
  const plugin = await createPlugin({ count: 3, apiKey: SECRET });
  await plugin.startAudit();

  const session = plugin.session();
  assert.equal(session.executionTransport, 'local');
  assert.ok(session.items.every((i) => i.transport === 'local'));
  assert.equal(plugin.cloudAnalyze().length, 0);
});

test('11: AUTO con local caído ANTES del primer envío audita en la nube', async () => {
  const plugin = await createPlugin({
    count: 3, apiKey: SECRET, localUp: false,
  });
  await plugin.startAudit();

  assert.equal(plugin.localAnalyze().length, 0, 'se envió texto al motor caído');
  assert.equal(plugin.cloudAnalyze().length, 3);
  assert.equal(plugin.session().executionTransport, 'cloud');
});

test('12 BLOQUEANTE: un fallo local tras el POST no genera NINGUNA petición a la nube', async () => {
  let calls = 0;
  const plugin = await createPlugin({
    count: 4, apiKey: SECRET,
    analyze: (body) => {
      calls += 1;
      return calls === 2
        ? jsonResponse(504, { code: 'MODEL_TIMEOUT' })
        : jsonResponse(200, resultFor(body.text));
    },
  });
  await plugin.startAudit();

  assert.equal(plugin.cloudAnalyze().length, 0, 'hubo fallback automático a la nube');
  const session = plugin.session();
  assert.equal(session.status, 'paused');
  assert.equal(session.completed, 1);
  assert.equal(session.currentIndex, 1, 'la auditoría continuó tras el fallo');
  assert.equal(session.cloudContinuationAvailable, true);
  // Y no se envió el candidato 3 ni el 4.
  assert.equal(plugin.localAnalyze().length, 2);
});

test('13: continuar en la nube afecta solo al pendiente y al actual', async () => {
  let calls = 0;
  const plugin = await createPlugin({
    count: 4, apiKey: SECRET,
    analyze: (body, entry) => {
      calls += 1;
      if (calls === 2 && entry.url === LOCAL_ANALYZE) {
        return jsonResponse(504, { code: 'MODEL_TIMEOUT' });
      }
      return jsonResponse(200, resultFor(body.text));
    },
  });
  await plugin.startAudit();
  assert.equal(plugin.session().status, 'paused');

  await plugin.send({
    type: 'CONTINUE_SCREEN_AUDIT_CLOUD',
    sessionId: plugin.session().sessionId,
  });

  const session = plugin.session();
  assert.equal(session.status, 'completed');
  assert.equal(session.items[0].transport, 'local', 'un resultado local se repintó');
  assert.equal(session.items[1].transport, 'cloud');
  assert.equal(session.items[2].transport, 'cloud');
  assert.equal(session.items[3].transport, 'cloud');
  assert.equal(plugin.cloudAnalyze().length, 3);
});

// --- 16..19 — obsolescencia ---------------------------------------------------

test('16: cambiar de modo durante la auditoría no la reencamina', async () => {
  const plugin = await createPlugin({
    count: 3, apiKey: SECRET,
    analyze: async (body) => {
      await new Promise((resolve) => { setImmediate(resolve); });
      return jsonResponse(200, resultFor(body.text));
    },
  });

  const audit = plugin.startAudit();
  await plugin.send({ type: 'SET_ANALYSIS_MODE', mode: 'cloud' });
  await audit;
  await plugin.drain();

  assert.equal(plugin.cloudAnalyze().length, 0, 'la auditoría en curso se reencaminó');
  assert.equal(plugin.session().executionTransport, 'local');
});

test('17 y 18 BLOQUEANTE: cambiar de selección invalida la auditoría en curso', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let seen = 0;

  const plugin = await createPlugin({
    count: 4,
    analyze: async (body) => {
      seen += 1;
      // El primer candidato pasa; el segundo se queda colgado para poder
      // cambiar de selección con la auditoría realmente en marcha.
      if (seen === 2) {
        await gate;
      }
      return jsonResponse(200, resultFor(body.text));
    },
  });

  const audit = plugin.startAudit();
  await plugin.drain(20);

  const running = plugin.session();
  assert.ok(running, 'la auditoría no llegó a arrancar');
  assert.equal(running.status, 'running');

  await plugin.changeSelection([textNode('otro', 'Texto suelto')]);

  const invalidated = plugin.messages.filter((m) => m.type === 'SCREEN_AUDIT_INVALIDATED');
  assert.ok(invalidated.length >= 1, 'no se invalidó la auditoría en curso');

  const requestsAtInvalidation = plugin.analyzeRequests().length;

  release();
  await audit;
  await plugin.drain();

  // La respuesta tardía no puede reanudar una auditoría muerta ni pintarse
  // contra la selección nueva.
  assert.equal(
    plugin.analyzeRequests().length, requestsAtInvalidation,
    'la auditoría continuó tras invalidarse',
  );

  const updatesAfter = plugin.messages
    .slice(plugin.messages.indexOf(invalidated[invalidated.length - 1]))
    .filter((m) => m.type === 'SCREEN_AUDIT_UPDATED');
  assert.deepEqual(updatesAfter, [], 'se publicó una sesión tras invalidarla');
});

test('17b: cambiar de selección mientras se resuelve la ruta aborta la auditoría', async () => {
  const plugin = await createPlugin({ count: 4 });

  const audit = plugin.startAudit();
  await plugin.changeSelection([textNode('otro', 'Texto suelto')]);
  await audit;
  await plugin.drain();

  // La auditoría ni siquiera llegó a enviar nada de la pantalla anterior.
  assert.equal(plugin.analyzeRequests().length, 0);
});

test('19: un resultado de una pantalla no puede entrar en otra', async () => {
  const plugin = await createPlugin({ count: 3, frameName: 'Pantalla A' });
  await plugin.startAudit();
  const first = plugin.session();
  assert.equal(first.frameName, 'Pantalla A');

  await plugin.changeSelection([frameOf('Pantalla B', [textNode('n9', 'Otro texto')])]);
  await plugin.startAudit();

  const second = plugin.session();
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(second.frameName, 'Pantalla B');
  assert.equal(second.total, 1);
});

// --- 20..22 — obsolescencia del documento ------------------------------------

test('20 BLOQUEANTE: un texto que cambió no se analiza obsoleto', async () => {
  const plugin = await createPlugin({ count: 3 });

  // El documento cambia antes de empezar.
  plugin.nodeById.get('n2').characters = 'Texto editado por la persona';
  await plugin.startAudit();

  const bodies = plugin.analyzeRequests().map((r) => JSON.parse(r.options.body).text);
  assert.ok(!bodies.includes('Guardar cambios'), 'se analizó la fuente vieja');
  assert.ok(!bodies.includes('Texto editado por la persona'), 'se analizó el texto nuevo');

  const session = plugin.session();
  assert.equal(session.items[1].status, 'changed');
  assert.equal(session.changed, 1);
  assert.equal(session.completed, 2, 'un texto cambiado se contó como analizado');
  assert.equal(session.status, 'completed');
});

test('21 y 22: un nodo eliminado se marca y no bloquea a los siguientes', async () => {
  const plugin = await createPlugin({ count: 3 });
  plugin.nodeById.delete('n1');

  await plugin.startAudit();

  const session = plugin.session();
  assert.equal(session.items[0].status, 'changed');
  assert.equal(plugin.analyzeRequests().length, 2, 'se pidió análisis de un nodo borrado');
  assert.equal(session.completed, 2);
  assert.equal(session.status, 'completed');
});

// --- privacidad y persistencia -----------------------------------------------

test('la auditoría no escribe nada en clientStorage', async () => {
  const plugin = await createPlugin({ count: 3, apiKey: SECRET });
  await plugin.startAudit();

  assert.deepEqual(plugin.storageWrites, []);
});

test('no se serializa ningún objeto de Figma hacia la interfaz', async () => {
  const plugin = await createPlugin({ count: 2 });
  await plugin.startAudit();

  for (const message of plugin.messages) {
    const serialized = JSON.stringify(message);
    assert.doesNotMatch(serialized, /getRangeAllFontNames|hasMissingFont|"removed"/u);
    assert.deepEqual(JSON.parse(serialized), message);
  }
});

test('sin ruta de análisis inicial no se envía nada', async () => {
  const plugin = await createPlugin({
    count: 3, mode: 'local', localUp: false,
  });
  await plugin.startAudit();

  assert.equal(plugin.analyzeRequests().length, 0);
  assert.equal(plugin.session(), undefined, 'se creó una sesión sin ruta');
});
