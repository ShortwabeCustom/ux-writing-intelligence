import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/analyze-contracts.ts';",
      "export * from './src/analyze-api.ts';",
      "export * from './src/analysis-transport.ts';",
      "export * from './src/local-runtime-health.ts';",
    ].join('\n'),
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});

const moduleSource = bundle.outputFiles[0]?.text;
assert.ok(moduleSource, 'esbuild no produjo el bundle de transporte');

const {
  ACTIVE_TRANSPORT_KIND,
  ANALYZE_ENDPOINT,
  LOCAL_ANALYZE_ENDPOINT,
  LOCAL_STATUS_ENDPOINT,
  createAnalyzeRequest,
  createCloudAnalysisTransport,
  createLocalAnalysisTransport,
  checkLocalRuntime,
  formatModelLabel,
  interpretRuntimeStatus,
  selectAnalysisTransport,
  transportRequiresApiKey,
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

const VALID_RESPONSE = {
  text: 'Continuar',
  locale: 'es-MX',
  score: 96,
  severity: 'low',
  clarity: 5,
  concision: 5,
  utility: 5,
  jargon: false,
  predictability: 5,
  orthography: 5,
  issues: [],
  reason: 'El texto está bien.',
  suggestion: 'Continuar',
};

function recordingFetch(responder) {
  const calls = [];
  const fetchPort = async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  };
  return { calls, fetchPort };
}

function jsonResponse(status, body) {
  return {
    status,
    headersObject: {},
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// --- STEP 30.1 ---------------------------------------------------------------

test('el endpoint local es exactamente el del runtime aprobado', () => {
  assert.equal(LOCAL_ANALYZE_ENDPOINT, 'http://localhost:8787/v1/analyze/text');
  assert.equal(LOCAL_STATUS_ENDPOINT, 'http://localhost:8787/v1/runtime/status');
});

test('el transporte local nunca apunta a Ollama', () => {
  assert.ok(!LOCAL_ANALYZE_ENDPOINT.includes('11434'));
  assert.ok(!LOCAL_ANALYZE_ENDPOINT.includes('api/chat'));
});

// --- STEP 30.2 / 30.3 / 30.4 — encabezados locales ---------------------------

test('la petición local envía Content-Type', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  await createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('Continuar'));
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
});

test('BLOQUEANTE: la petición local NUNCA envía X-API-Key', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  await createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('Continuar'));

  const headerNames = Object.keys(calls[0].options.headers).map((n) => n.toLowerCase());
  assert.ok(!headerNames.includes('x-api-key'), 'la clave de la nube se filtró a localhost');
  assert.equal(headerNames.length, 1, 'el transporte local solo debe enviar Content-Type');
});

test('BLOQUEANTE: la petición local NUNCA envía Authorization', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  await createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('Continuar'));

  const headerNames = Object.keys(calls[0].options.headers).map((n) => n.toLowerCase());
  assert.ok(!headerNames.includes('authorization'));
});

test('BLOQUEANTE: ningún secreto aparece en la petición local completa', async () => {
  const SECRET = 'clave-secreta-de-la-nube-123';
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));

  // El transporte local se construye sin recibir siquiera la clave.
  await selectAnalysisTransport(fetchPort, SECRET).analyze(createAnalyzeRequest('Continuar'));

  const serialized = JSON.stringify(calls[0]);
  assert.ok(!serialized.includes(SECRET), 'un secreto de la nube llegó a localhost');
});

// --- STEP 30.5 — la nube conserva su clave -----------------------------------

test('la petición a la nube sigue enviando X-API-Key', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  await createCloudAnalysisTransport(fetchPort, 'clave-real').analyze(
    createAnalyzeRequest('Continuar'),
  );

  assert.equal(calls[0].url, ANALYZE_ENDPOINT);
  assert.equal(calls[0].options.headers['X-API-Key'], 'clave-real');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
});

test('la nube sin clave falla con MISSING_API_KEY', async () => {
  const { fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  await assert.rejects(
    () => createCloudAnalysisTransport(fetchPort, '   ').analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'MISSING_API_KEY',
  );
});

// --- STEP 30.6 — mismo payload ----------------------------------------------

test('local y nube envían exactamente el mismo AnalyzeRequest', async () => {
  const request = createAnalyzeRequest('Tu visita ha sido confirmada.');

  const local = recordingFetch(() => jsonResponse(200, { ...VALID_RESPONSE, text: request.text }));
  const cloud = recordingFetch(() => jsonResponse(200, { ...VALID_RESPONSE, text: request.text }));

  await createLocalAnalysisTransport(local.fetchPort).analyze(request);
  await createCloudAnalysisTransport(cloud.fetchPort, 'k').analyze(request);

  assert.equal(local.calls[0].options.body, cloud.calls[0].options.body);
  assert.deepEqual(JSON.parse(local.calls[0].options.body), {
    text: 'Tu visita ha sido confirmada.',
    context: 'Texto de interfaz seleccionado en Figma',
    locale: 'es-MX',
  });
});

// --- STEP 30.7 / 30.8 — mismo validador, respuesta válida --------------------

test('local acepta una respuesta 200 válida', async () => {
  const { fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  const result = await createLocalAnalysisTransport(fetchPort).analyze(
    createAnalyzeRequest('Continuar'),
  );
  assert.deepEqual(result, VALID_RESPONSE);
});

test('local y nube usan el mismo validador de respuesta', async () => {
  const invalid = { ...VALID_RESPONSE, clarity: 9 };
  const local = recordingFetch(() => jsonResponse(200, invalid));
  const cloud = recordingFetch(() => jsonResponse(200, invalid));

  await assert.rejects(
    () => createLocalAnalysisTransport(local.fetchPort).analyze(createAnalyzeRequest('Continuar')),
    (error) => error.details.code === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    () => createCloudAnalysisTransport(cloud.fetchPort, 'k').analyze(createAnalyzeRequest('Continuar')),
    (error) => error.details.code === 'INVALID_RESPONSE',
  );
});

test('local rechaza una respuesta cuyo text no es el original (fuente de la verdad)', async () => {
  const { fetchPort } = recordingFetch(
    () => jsonResponse(200, { ...VALID_RESPONSE, text: 'texto normalizado' }),
  );
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('Continuar')),
    (error) => error.details.code === 'INVALID_RESPONSE',
  );
});

test('local preserva placeholders sin normalizar', async () => {
  const source = 'Tu visita será el {{Jueves 10 de abril de 2026}} a las {{6:00 p.m.}}.';
  const { calls, fetchPort } = recordingFetch(
    () => jsonResponse(200, { ...VALID_RESPONSE, text: source, suggestion: source }),
  );
  const result = await createLocalAnalysisTransport(fetchPort).analyze(
    createAnalyzeRequest(source),
  );
  assert.equal(JSON.parse(calls[0].options.body).text, source);
  assert.equal(result.text, source);
  assert.equal(result.suggestion, source);
});

// --- STEP 30.9 a 30.12 — mapeo de errores ------------------------------------

test('runtime inalcanzable mapea a LOCAL_RUNTIME_UNAVAILABLE', async () => {
  const fetchPort = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'LOCAL_RUNTIME_UNAVAILABLE',
  );
});

test('modelo ausente mapea a LOCAL_MODEL_NOT_AVAILABLE', async () => {
  const { fetchPort } = recordingFetch(
    () => jsonResponse(503, { code: 'MODEL_NOT_AVAILABLE', message: 'x' }),
  );
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'LOCAL_MODEL_NOT_AVAILABLE',
  );
});

test('timeout del modelo mapea a LOCAL_ANALYSIS_TIMEOUT', async () => {
  const { fetchPort } = recordingFetch(
    () => jsonResponse(504, { code: 'MODEL_TIMEOUT', message: 'x' }),
  );
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'LOCAL_ANALYSIS_TIMEOUT',
  );
});

test('servicio de inferencia caído mapea a LOCAL_RUNTIME_UNAVAILABLE', async () => {
  const { fetchPort } = recordingFetch(
    () => jsonResponse(503, { code: 'OLLAMA_UNAVAILABLE', message: 'x' }),
  );
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'LOCAL_RUNTIME_UNAVAILABLE',
  );
});

test('JSON local ilegible mapea a INVALID_RESPONSE', async () => {
  const { fetchPort } = recordingFetch(() => jsonResponse(200, '{{{ no es json'));
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'INVALID_RESPONSE',
  );
});

test('respuesta local fuera de contrato mapea a INVALID_RESPONSE', async () => {
  const { fetchPort } = recordingFetch(
    () => jsonResponse(502, { code: 'INVALID_MODEL_RESPONSE', message: 'x' }),
  );
  await assert.rejects(
    () => createLocalAnalysisTransport(fetchPort).analyze(createAnalyzeRequest('x')),
    (error) => error.details.code === 'INVALID_RESPONSE',
  );
});

test('los errores locales no se colapsan en un solo código genérico', async () => {
  const codes = new Set();
  for (const [status, body] of [
    [503, { code: 'MODEL_NOT_AVAILABLE' }],
    [504, { code: 'MODEL_TIMEOUT' }],
    [503, { code: 'OLLAMA_UNAVAILABLE' }],
    [502, { code: 'INVALID_MODEL_RESPONSE' }],
  ]) {
    const { fetchPort } = recordingFetch(() => jsonResponse(status, body));
    await createLocalAnalysisTransport(fetchPort)
      .analyze(createAnalyzeRequest('x'))
      .catch((error) => codes.add(error.details.code));
  }
  assert.equal(codes.size, 4, 'cada fallo local debe tener su propio código');
});

// --- Política de transporte (STEP 8 / 21) ------------------------------------

test('el transporte activo de esta fase es local', () => {
  assert.equal(ACTIVE_TRANSPORT_KIND, 'local');
  assert.equal(transportRequiresApiKey('local'), false);
  assert.equal(transportRequiresApiKey('cloud'), true);
});

test('selectAnalysisTransport devuelve el transporte local', () => {
  const { fetchPort } = recordingFetch(() => jsonResponse(200, VALID_RESPONSE));
  assert.equal(selectAnalysisTransport(fetchPort, 'clave').kind, 'local');
});

test('NO hay fallback automático a la nube cuando el local falla', async () => {
  const urls = [];
  const fetchPort = async (url) => {
    urls.push(url);
    throw new Error('ECONNREFUSED');
  };

  await selectAnalysisTransport(fetchPort, 'clave')
    .analyze(createAnalyzeRequest('Continuar'))
    .catch(() => {});

  assert.equal(urls.length, 1, 'hubo más de una petición: se intentó un fallback');
  assert.ok(!urls.some((u) => u.includes('writing.productdesign.mx')),
    'el fallo local disparó una petición a la nube');
});

// --- STEP 32 — salud del runtime ---------------------------------------------

test('salud: runtime listo', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, {
    runtime: 'ready', ollama: 'ready', model: 'qwen3.5:4b', model_available: true,
  }));
  const status = await checkLocalRuntime(fetchPort);
  assert.deepEqual(status, { state: 'ready', modelLabel: 'Qwen 3.5' });
  assert.equal(calls[0].url, LOCAL_STATUS_ENDPOINT);
  assert.equal(calls[0].options.method, 'GET');
});

test('salud: runtime inalcanzable', async () => {
  const fetchPort = async () => { throw new Error('ECONNREFUSED'); };
  assert.deepEqual(await checkLocalRuntime(fetchPort), {
    state: 'unavailable', modelLabel: null,
  });
});

test('salud: modelo ausente', async () => {
  const { fetchPort } = recordingFetch(() => jsonResponse(200, {
    runtime: 'degraded', ollama: 'ready', model: 'qwen3.5:4b', model_available: false,
  }));
  assert.equal((await checkLocalRuntime(fetchPort)).state, 'model_missing');
});

test('salud: servicio de inferencia caído', async () => {
  const { fetchPort } = recordingFetch(() => jsonResponse(200, {
    runtime: 'degraded', ollama: 'unavailable', model: 'qwen3.5:4b', model_available: false,
  }));
  assert.equal((await checkLocalRuntime(fetchPort)).state, 'unavailable');
});

test('la comprobación de salud NUNCA llama al endpoint de análisis', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, {
    runtime: 'ready', ollama: 'ready', model: 'qwen3.5:4b', model_available: true,
  }));
  await checkLocalRuntime(fetchPort);
  assert.ok(!calls.some((c) => c.url.includes('/v1/analyze/text')));
  assert.equal(calls.length, 1);
});

test('la salud no envía X-API-Key', async () => {
  const { calls, fetchPort } = recordingFetch(() => jsonResponse(200, {
    runtime: 'ready', ollama: 'ready', model: 'qwen3.5:4b', model_available: true,
  }));
  await checkLocalRuntime(fetchPort);
  const names = Object.keys(calls[0].options.headers).map((n) => n.toLowerCase());
  assert.ok(!names.includes('x-api-key'));
});

test('la etiqueta del modelo no expone infraestructura', () => {
  assert.equal(formatModelLabel('qwen3.5:4b'), 'Qwen 3.5');
  assert.equal(formatModelLabel(null), null);
  assert.ok(!String(formatModelLabel('qwen3.5:4b')).includes('8787'));
  assert.ok(!String(formatModelLabel('qwen3.5:4b')).includes('127.0.0.1'));
});

test('un cuerpo de estado inesperado degrada en vez de romper', () => {
  assert.equal(interpretRuntimeStatus(null).state, 'degraded');
  assert.equal(interpretRuntimeStatus({}).state, 'unavailable');
});
