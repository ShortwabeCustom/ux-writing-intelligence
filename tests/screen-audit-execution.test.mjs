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
    parent: null,
    characters, hasMissingFont: false,
    getRangeAllFontNames: () => [{ family: 'Inter', style: 'Regular' }],
    absoluteBoundingBox: { x: 0, y: Number(id.replace(/\D/gu, '')) },
  };
}

function frameOf(name, nodes, id = 'frame-1') {
  const frame = {
    id, name, type: 'FRAME', visible: true, removed: false, parent: null,
    children: nodes, absoluteBoundingBox: { x: 0, y: 0 },
  };
  for (const node of nodes) node.parent = frame;
  return frame;
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
  const listeners = new Map();
  const initialFrame = frameOf(frameName, nodes);
  const nodeById = new Map([[initialFrame.id, initialFrame], ...nodes.map((n) => [n.id, n])]);
  let currentSelection = [initialFrame];
  const viewportCalls = [];
  const currentPage = {
    get selection() { return currentSelection; },
    set selection(next) {
      currentSelection = next;
      listeners.get('selectionchange')?.();
    },
  };

  globalThis.__html__ = '';
  globalThis.figma = {
    showUI() {},
    ui: { postMessage: (m) => messages.push(m), onmessage: null },
    on: (event, handler) => listeners.set(event, handler),
    currentPage,
    viewport: { scrollAndZoomIntoView: (selected) => viewportCalls.push(selected) },
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
    send, drain, requests, messages, storageWrites, nodeById, listeners, viewportCalls,
    selected: () => currentSelection,
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
    selectionSnapshot: () => [...messages].reverse()
      .find((m) => m.type === 'SELECTION_CHANGED')?.payload,
    restoredScreens: () => messages.filter((m) => m.type === 'SCREEN_AUDIT_RESTORED')
      .map((m) => m.payload.snapshot),
    restoredTexts: () => messages.filter((m) => m.type === 'TEXT_AUDIT_RESTORED')
      .map((m) => m.payload),
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

  await plugin.changeSelection([frameOf('Pantalla B', [textNode('n9', 'Otro texto')], 'frame-2')]);
  await plugin.startAudit();

  const second = plugin.session();
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(second.frameName, 'Pantalla B');
  assert.equal(second.total, 1);
});

test('19b: navegación selecciona, enfoca y conserva auditoría sin red ni mutación', async () => {
  const plugin = await createPlugin({ count: 3 });
  await plugin.startAudit();
  const session = plugin.session();
  const candidate = session.items[1].candidate;
  const beforeRequests = plugin.analyzeRequests().length;
  const beforeCharacters = plugin.nodeById.get(candidate.nodeId).characters;

  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId,
    candidateId: candidate.nodeId,
  });

  assert.equal(plugin.selected()[0].id, candidate.nodeId);
  assert.equal(plugin.viewportCalls.length, 1);
  assert.equal(plugin.viewportCalls[0][0].id, candidate.nodeId);
  assert.equal(plugin.analyzeRequests().length, beforeRequests);
  assert.equal(plugin.nodeById.get(candidate.nodeId).characters, beforeCharacters);
  assert.equal(plugin.messages.some((m) => m.type === 'SCREEN_AUDIT_INVALIDATED'), false);
  assert.equal(plugin.messages.at(-1).payload.state, 'current');
});

test('19c: selección manual del Frame, TextNode y SceneNode descendiente preserva review', async () => {
  const plugin = await createPlugin({ count: 2 });
  await plugin.startAudit();
  const frame = plugin.nodeById.get('frame-1');
  const rectangle = {
    id: 'rect-1', name: 'Decoración', type: 'RECTANGLE', removed: false, parent: frame,
  };

  await plugin.changeSelection([frame]);
  await plugin.changeSelection([plugin.nodeById.get('n1')]);
  await plugin.changeSelection([rectangle]);

  assert.equal(plugin.messages.some((m) => m.type === 'SCREEN_AUDIT_INVALIDATED'), false);
  assert.equal(plugin.session().status, 'completed');
});

test('19d: auditSessionId incorrecto se ignora', async () => {
  const plugin = await createPlugin({ count: 1 });
  await plugin.startAudit();
  const before = plugin.selected()[0].id;
  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: 'screen-equivocada', candidateId: 'n1',
  });
  assert.equal(plugin.selected()[0].id, before);
  assert.equal(plugin.viewportCalls.length, 0);
});

test('19e: texto modificado se selecciona, marca obsolescencia y no reanaliza', async () => {
  const plugin = await createPlugin({ count: 1 });
  await plugin.startAudit();
  const session = plugin.session();
  plugin.nodeById.get('n1').characters = 'Texto modificado manualmente';
  const beforeRequests = plugin.analyzeRequests().length;

  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId, candidateId: 'n1',
  });

  assert.equal(plugin.selected()[0].id, 'n1');
  assert.equal(plugin.messages.at(-1).payload.state, 'changed_since_audit');
  assert.equal(plugin.analyzeRequests().length, beforeRequests);
});

test('19f: nodo eliminado es seguro y permite revisar otro resultado', async () => {
  const plugin = await createPlugin({ count: 2 });
  await plugin.startAudit();
  const session = plugin.session();
  plugin.nodeById.get('n1').removed = true;
  plugin.nodeById.delete('n1');

  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId, candidateId: 'n1',
  });
  assert.equal(plugin.messages.at(-1).payload.state, 'deleted');

  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId, candidateId: 'n2',
  });
  assert.equal(plugin.selected()[0].id, 'n2');
});

test('19g: nodo fuera del Frame se rechaza y Frame eliminado inutiliza sesión', async () => {
  const plugin = await createPlugin({ count: 2 });
  await plugin.startAudit();
  const session = plugin.session();
  plugin.nodeById.get('n1').parent = frameOf('Otra', [], 'frame-other');
  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId, candidateId: 'n1',
  });
  assert.equal(plugin.messages.at(-1).payload.state, 'deleted');
  assert.equal(plugin.viewportCalls.length, 0);

  plugin.nodeById.get('frame-1').removed = true;
  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId, candidateId: 'n2',
  });
  assert.equal(plugin.messages.at(-1).type, 'SCREEN_AUDIT_FRAME_UNAVAILABLE');
});

test('19h: múltiples Frames restauran snapshots independientes sin análisis', async () => {
  const plugin = await createPlugin({ count: 2, frameName: 'Domicilio' });
  const frameA = plugin.nodeById.get('frame-1');
  await plugin.startAudit();
  const sessionA = plugin.session();
  await plugin.send({
    type: 'UPDATE_SCREEN_AUDIT_REVIEW_STATE',
    auditSessionId: sessionA.sessionId, filter: 'all', activeCandidateId: 'n2',
  });

  const nodeB = textNode('b1', 'Pantalla B');
  const frameB = frameOf('Domicilio', [nodeB], 'frame-b');
  plugin.nodeById.set(frameB.id, frameB);
  plugin.nodeById.set(nodeB.id, nodeB);
  await plugin.changeSelection([frameB]);
  await plugin.startAudit();
  const sessionB = plugin.session();
  const requestsAfterAudits = plugin.analyzeRequests().length;

  await plugin.changeSelection([frameA]);
  let restored = plugin.restoredScreens().at(-1);
  assert.equal(restored.frameId, 'frame-1');
  assert.equal(restored.session.sessionId, sessionA.sessionId);
  assert.equal(restored.review.filter, 'all');
  assert.equal(restored.review.activeCandidateId, 'n2');
  assert.equal(plugin.analyzeRequests().length, requestsAfterAudits);

  await plugin.changeSelection([frameB]);
  restored = plugin.restoredScreens().at(-1);
  assert.equal(restored.frameId, 'frame-b');
  assert.equal(restored.session.sessionId, sessionB.sessionId);
  assert.equal(plugin.analyzeRequests().length, requestsAfterAudits);
});

test('19h-bis: reauditar Frame A reemplaza solo A y preserva snapshot de Frame B', async () => {
  const plugin = await createPlugin({ count: 1, frameName: 'Frame A' });
  const frameA = plugin.nodeById.get('frame-1');
  await plugin.startAudit();
  const firstSessionA = plugin.session().sessionId;

  const nodeB = textNode('b1', 'Texto B');
  const frameB = frameOf('Frame B', [nodeB], 'frame-b');
  plugin.nodeById.set(frameB.id, frameB);
  plugin.nodeById.set(nodeB.id, nodeB);
  await plugin.changeSelection([frameB]);
  await plugin.startAudit();
  const sessionB = plugin.session();

  plugin.nodeById.get('n1').characters = 'Texto A corregido';
  await plugin.changeSelection([frameA]);
  await plugin.send({
    type: 'START_SCREEN_AUDIT', selectionRevision: plugin.selectionSnapshot().revision,
  });
  assert.notEqual(plugin.session().sessionId, firstSessionA);
  assert.equal(plugin.session().items[0].candidate.text, 'Texto A corregido');

  const beforeRestoreB = plugin.analyzeRequests().length;
  await plugin.changeSelection([frameB]);
  const restoredB = plugin.restoredScreens().at(-1);
  assert.equal(restoredB.frameId, 'frame-b');
  assert.equal(restoredB.session.sessionId, sessionB.sessionId);
  assert.equal(restoredB.session.items[0].candidate.text, 'Texto B');
  assert.equal(plugin.analyzeRequests().length, beforeRestoreB);
});

test('19i: múltiples Text Audits se restauran por nodeId sin red', async () => {
  const plugin = await createPlugin({ count: 2 });
  const textA = plugin.nodeById.get('n1');
  const textB = plugin.nodeById.get('n2');

  await plugin.changeSelection([textA]);
  await plugin.send({
    type: 'ANALYZE_REQUEST', selectionRevision: plugin.selectionSnapshot().revision,
  });
  await plugin.changeSelection([textB]);
  await plugin.send({
    type: 'ANALYZE_REQUEST', selectionRevision: plugin.selectionSnapshot().revision,
  });
  const requestsAfterAnalyses = plugin.analyzeRequests().length;

  await plugin.changeSelection([textA]);
  assert.equal(plugin.restoredTexts().at(-1).snapshot.nodeId, 'n1');
  assert.equal(plugin.restoredTexts().at(-1).state, 'current');
  assert.equal(plugin.analyzeRequests().length, requestsAfterAnalyses);

  await plugin.changeSelection([textB]);
  assert.equal(plugin.restoredTexts().at(-1).snapshot.nodeId, 'n2');
  assert.equal(plugin.analyzeRequests().length, requestsAfterAnalyses);
});

test('19j: Text Audit modificado restaura histórico stale y no analiza', async () => {
  const plugin = await createPlugin({ count: 2 });
  const textA = plugin.nodeById.get('n1');
  const textB = plugin.nodeById.get('n2');
  await plugin.changeSelection([textA]);
  await plugin.send({
    type: 'ANALYZE_REQUEST', selectionRevision: plugin.selectionSnapshot().revision,
  });
  const beforeRestore = plugin.analyzeRequests().length;
  textA.characters = 'Contenido actualizado';
  await plugin.changeSelection([textB]);
  await plugin.changeSelection([textA]);

  assert.equal(plugin.restoredTexts().at(-1).state, 'changed');
  assert.equal(plugin.restoredTexts().at(-1).snapshot.result.text, 'Continuar');
  assert.equal(plugin.analyzeRequests().length, beforeRestore);
});

test('19k: restore reconcilia changed, deleted, moved y renames sin red', async () => {
  const plugin = await createPlugin({ count: 3 });
  const frameA = plugin.nodeById.get('frame-1');
  await plugin.startAudit();
  const beforeRestore = plugin.analyzeRequests().length;

  plugin.nodeById.get('n1').characters = 'Cambió';
  plugin.nodeById.get('n1').name = 'Título renombrado';
  plugin.nodeById.get('n2').removed = true;
  plugin.nodeById.delete('n2');
  plugin.nodeById.get('n3').parent = frameOf('Otra', [], 'frame-other');
  frameA.name = 'Frame renombrado';

  const outside = frameOf('Salida', [], 'frame-outside');
  plugin.nodeById.set(outside.id, outside);
  await plugin.changeSelection([outside]);
  await plugin.changeSelection([frameA]);

  const restored = plugin.restoredScreens().at(-1);
  assert.equal(restored.frameName, 'Frame renombrado');
  assert.equal(restored.session.items[0].candidate.layerName, 'Título renombrado');
  assert.equal(restored.review.navigationStates.n1, 'changed_since_audit');
  assert.equal(restored.review.navigationStates.n2, 'deleted');
  assert.equal(restored.review.navigationStates.n3, 'deleted');
  assert.equal(plugin.analyzeRequests().length, beforeRestore);
});

test('19l: Screen histórico y Text individual coexisten sin mezclar scores', async () => {
  const plugin = await createPlugin({
    count: 1,
    analyze: (body) => jsonResponse(200, {
      ...resultFor(body.text),
      score: body.text === 'Texto actualizado' ? 97 : 60,
    }),
  });
  const frameA = plugin.nodeById.get('frame-1');
  const candidate = plugin.nodeById.get('n1');
  await plugin.startAudit();
  assert.equal(plugin.session().items[0].result.score, 60);

  candidate.characters = 'Texto actualizado';
  await plugin.changeSelection([candidate]);
  await plugin.send({
    type: 'ANALYZE_REQUEST', selectionRevision: plugin.selectionSnapshot().revision,
  });
  assert.equal(plugin.restoredTexts().length, 0);

  const outside = frameOf('Otra', [], 'frame-outside');
  plugin.nodeById.set(outside.id, outside);
  await plugin.changeSelection([outside]);
  const beforeRestore = plugin.analyzeRequests().length;
  await plugin.changeSelection([frameA]);
  const restoredScreen = plugin.restoredScreens().at(-1);
  assert.equal(restoredScreen.session.items[0].result.score, 60);
  assert.equal(restoredScreen.review.navigationStates.n1, 'changed_since_audit');

  await plugin.changeSelection([candidate]);
  const restoredText = plugin.restoredTexts().at(-1);
  assert.equal(restoredText.snapshot.result.score, 97);
  assert.equal(restoredText.state, 'current');
  assert.equal(plugin.analyzeRequests().length, beforeRestore);
});

test('19l-bis: reauditoría explícita relee characters y reemplaza el score histórico', async () => {
  const plugin = await createPlugin({
    count: 2,
    analyze: (body) => jsonResponse(200, {
      ...resultFor(body.text),
      score: body.text === 'Préstamo corregido' ? 100 : 63,
    }),
  });
  const frame = plugin.nodeById.get('frame-1');
  const candidate = plugin.nodeById.get('n1');

  await plugin.startAudit();
  const historicalSessionId = plugin.session().sessionId;
  assert.equal(plugin.session().items[0].result.score, 63);

  candidate.characters = 'Préstamo corregido';
  await plugin.changeSelection([candidate]);
  await plugin.send({
    type: 'ANALYZE_REQUEST', selectionRevision: plugin.selectionSnapshot().revision,
  });

  const beforePassiveReturn = plugin.analyzeRequests().length;
  await plugin.changeSelection([frame]);
  assert.equal(
    plugin.analyzeRequests().length,
    beforePassiveReturn,
    'volver al Frame sin reauditar debe hacer 0 llamadas',
  );

  await plugin.send({
    type: 'START_SCREEN_AUDIT', selectionRevision: plugin.selectionSnapshot().revision,
  });

  assert.notEqual(plugin.session().sessionId, historicalSessionId);
  assert.equal(
    plugin.analyzeRequests().length - beforePassiveReturn,
    2,
    'cada candidato ready debe producir una nueva llamada explícita',
  );
  const reauditBodies = plugin.analyzeRequests().slice(beforePassiveReturn)
    .map((request) => JSON.parse(request.options.body).text);
  assert.deepEqual(reauditBodies, ['Préstamo corregido', 'Guardar cambios']);
  assert.equal(plugin.session().items[0].candidate.text, 'Préstamo corregido');
  assert.equal(plugin.session().items[0].result.score, 100);
});

test('19l-parity: mismo nodeId/text reemplaza 63 por 100 en ejecución y snapshot', async () => {
  let screenRuns = 0;
  const plugin = await createPlugin({
    count: 1,
    frameName: 'Pantalla sintética',
    analyze: (body) => {
      const individual = body.context === 'Texto de interfaz seleccionado en Figma';
      if (!individual) screenRuns += 1;
      return jsonResponse(200, {
        ...resultFor(body.text),
        score: individual || screenRuns === 2 ? 100 : 63,
      });
    },
  });
  const frame = plugin.nodeById.get('frame-1');
  const node = plugin.nodeById.get('n1');
  node.name = '1. ¿Desde qué cuenta';
  node.characters = 'Préstamo';

  await plugin.startAudit();
  const historicalSessionId = plugin.session().sessionId;
  const historicalCandidate = plugin.session().items[0].candidate;
  assert.equal(historicalCandidate.nodeId, node.id);
  assert.equal(historicalCandidate.layerName, node.name);
  assert.equal(historicalCandidate.text, node.characters);
  assert.equal(plugin.session().items[0].result.score, 63);

  await plugin.changeSelection([node]);
  await plugin.send({
    type: 'ANALYZE_REQUEST', selectionRevision: plugin.selectionSnapshot().revision,
  });
  const individualRequest = JSON.parse(plugin.analyzeRequests().at(-1).options.body);
  const individualResult = [...plugin.messages].reverse()
    .find((message) => message.type === 'ANALYSIS_SUCCEEDED').result;
  assert.equal(individualResult.score, 100);

  const beforePassiveReturn = plugin.analyzeRequests().length;
  await plugin.changeSelection([frame]);
  assert.equal(plugin.analyzeRequests().length, beforePassiveReturn);

  await plugin.send({
    type: 'START_SCREEN_AUDIT', selectionRevision: plugin.selectionSnapshot().revision,
  });
  const screenRequest = JSON.parse(plugin.analyzeRequests().at(-1).options.body);
  const completed = plugin.session();

  assert.deepEqual(individualRequest, {
    text: 'Préstamo',
    context: 'Texto de interfaz seleccionado en Figma',
    locale: 'es-MX',
  });
  assert.deepEqual(screenRequest, {
    text: 'Préstamo',
    context: 'Pantalla: Pantalla sintética. Capa: 1. ¿Desde qué cuenta. Contenedor: Pantalla sintética.',
    locale: 'es-MX',
  });
  assert.deepEqual(
    { ...screenRequest, context: individualRequest.context },
    individualRequest,
    'context debe ser la única diferencia del payload normalizado',
  );
  assert.notEqual(completed.sessionId, historicalSessionId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.items[0].result.score, 100);

  const outside = frameOf('Fuera', [], 'frame-outside');
  plugin.nodeById.set(outside.id, outside);
  await plugin.changeSelection([outside]);
  await plugin.changeSelection([frame]);
  const restored = plugin.restoredScreens().at(-1);
  assert.equal(restored.session.sessionId, completed.sessionId);
  assert.equal(restored.session.items[0].result.score, 100);
});

test('19l-ter: reauditoría reconstruye candidatos nuevos, eliminados, movidos y elegibilidad', async () => {
  const plugin = await createPlugin({ count: 5 });
  const frame = plugin.nodeById.get('frame-1');
  const becomesReady = plugin.nodeById.get('n4');
  const becomesHidden = plugin.nodeById.get('n5');
  becomesReady.visible = false;

  await plugin.startAudit();
  const beforeReaudit = plugin.analyzeRequests().length;

  const deleted = plugin.nodeById.get('n2');
  deleted.removed = true;
  plugin.nodeById.delete(deleted.id);

  const moved = plugin.nodeById.get('n3');
  const otherFrame = frameOf('Otra pantalla', [moved], 'frame-other');
  plugin.nodeById.set(otherFrame.id, otherFrame);

  becomesReady.visible = true;
  becomesHidden.visible = false;
  const added = textNode('n6', 'Nuevo candidato');
  added.parent = frame;
  plugin.nodeById.set(added.id, added);
  frame.children = [plugin.nodeById.get('n1'), becomesReady, becomesHidden, added];

  await plugin.send({
    type: 'START_SCREEN_AUDIT', selectionRevision: plugin.selectionSnapshot().revision,
  });

  const newRequests = plugin.analyzeRequests().slice(beforeReaudit)
    .map((request) => JSON.parse(request.options.body).text);
  assert.deepEqual(newRequests, ['Continuar', 'Ver detalles', 'Nuevo candidato']);
  assert.deepEqual(
    plugin.session().items.map((item) => item.candidate.nodeId),
    ['n1', 'n4', 'n6'],
  );
  assert.ok(!plugin.session().items.some((item) => item.candidate.nodeId === 'n2'));
  assert.ok(!plugin.session().items.some((item) => item.candidate.nodeId === 'n3'));
  assert.ok(!plugin.session().items.some((item) => item.candidate.nodeId === 'n5'));
});

test('19m: reauditoría fallida preserva el último Screen snapshot completo', async () => {
  let calls = 0;
  const plugin = await createPlugin({
    count: 1,
    analyze: (body) => {
      calls += 1;
      return calls === 1
        ? jsonResponse(200, { ...resultFor(body.text), score: 88 })
        : jsonResponse(503, { code: 'OLLAMA_UNAVAILABLE' });
    },
  });
  const frame = plugin.nodeById.get('frame-1');
  await plugin.startAudit();
  const completedId = plugin.session().sessionId;

  const outside = frameOf('Otra', [], 'frame-outside');
  plugin.nodeById.set(outside.id, outside);
  await plugin.changeSelection([outside]);
  await plugin.changeSelection([frame]);

  await plugin.send({
    type: 'START_SCREEN_AUDIT', selectionRevision: plugin.selectionSnapshot().revision,
  });
  assert.equal(plugin.session().status, 'paused');

  await plugin.changeSelection([outside]);
  await plugin.changeSelection([frame]);
  const restored = plugin.restoredScreens().at(-1);
  assert.equal(restored.session.sessionId, completedId);
  assert.equal(restored.session.items[0].result.score, 88);
});

test('19n: reanálisis Text fallido preserva el último snapshot válido', async () => {
  let calls = 0;
  const plugin = await createPlugin({
    count: 2,
    analyze: (body) => {
      calls += 1;
      return calls === 1
        ? jsonResponse(200, { ...resultFor(body.text), score: 86 })
        : jsonResponse(503, { code: 'OLLAMA_UNAVAILABLE' });
    },
  });
  const textA = plugin.nodeById.get('n1');
  const textB = plugin.nodeById.get('n2');
  await plugin.changeSelection([textA]);
  const revision = plugin.selectionSnapshot().revision;
  await plugin.send({ type: 'ANALYZE_REQUEST', selectionRevision: revision });
  await plugin.send({ type: 'ANALYZE_REQUEST', selectionRevision: revision });

  await plugin.changeSelection([textB]);
  const beforeRestore = plugin.analyzeRequests().length;
  await plugin.changeSelection([textA]);
  const restored = plugin.restoredTexts().at(-1);
  assert.equal(restored.snapshot.result.score, 86);
  assert.equal(plugin.analyzeRequests().length, beforeRestore);
});

test('19o: el store MAIN sobrevive a un nuevo UI_READY en la misma instancia', async () => {
  const plugin = await createPlugin({ count: 1 });
  await plugin.startAudit();
  const beforeRestore = plugin.analyzeRequests().length;
  await plugin.send({ type: 'UI_READY' });
  assert.equal(plugin.restoredScreens().at(-1).frameId, 'frame-1');
  assert.equal(plugin.analyzeRequests().length, beforeRestore);
});

// --- 20..22 — obsolescencia del documento ------------------------------------

test('20 BLOQUEANTE: START relee un texto cambiado después del preflight', async () => {
  const plugin = await createPlugin({ count: 3 });

  // El documento cambia antes de empezar.
  plugin.nodeById.get('n2').characters = 'Texto editado por la persona';
  await plugin.startAudit();

  const bodies = plugin.analyzeRequests().map((r) => JSON.parse(r.options.body).text);
  assert.ok(!bodies.includes('Guardar cambios'), 'se analizó la fuente vieja');
  assert.ok(bodies.includes('Texto editado por la persona'), 'no se analizó el texto actual');

  const session = plugin.session();
  assert.equal(session.items[1].candidate.text, 'Texto editado por la persona');
  assert.equal(session.items[1].status, 'success');
  assert.equal(session.changed, 0);
  assert.equal(session.completed, 3);
  assert.equal(session.status, 'completed');
});

test('20b BLOQUEANTE: un texto que cambia durante la ejecución no se envía obsoleto', async () => {
  let plugin;
  plugin = await createPlugin({
    count: 3,
    analyze: (body) => {
      if (body.text === 'Continuar') {
        plugin.nodeById.get('n2').characters = 'Cambio durante la auditoría';
      }
      return null;
    },
  });
  await plugin.startAudit();

  const bodies = plugin.analyzeRequests().map((r) => JSON.parse(r.options.body).text);
  assert.ok(!bodies.includes('Guardar cambios'), 'se analizó la fuente vieja');
  assert.ok(!bodies.includes('Cambio durante la auditoría'), 'se analizó sin nuevo preflight');
  assert.equal(plugin.session().items[1].status, 'changed');
  assert.equal(plugin.session().changed, 1);
  assert.equal(plugin.session().completed, 2);
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
