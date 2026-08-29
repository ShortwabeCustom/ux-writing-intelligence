import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/error-experience.ts';",
      "export * from './src/analysis-state.ts';",
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

const source = bundle.outputFiles[0]?.text;

if (source === undefined) {
  throw new Error('Unable to compile error experience modules for testing.');
}

const core = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('unauthorized requires Settings and never offers retry as primary action', () => {
  assert.deepEqual(core.getAnalyzeErrorPresentation({ code: 'UNAUTHORIZED' }), {
    title: 'Revisa tu API Key',
    description: 'La API Key no es válida. Actualízala en Configuración para continuar.',
    recoverability: 'requires-settings',
    action: 'open-settings',
    actionLabel: 'Abrir Configuración',
  });
});

test('missing API key routes to Settings with the requested copy', () => {
  assert.deepEqual(core.getAnalyzeErrorPresentation({ code: 'MISSING_API_KEY' }), {
    title: 'Configura tu API Key',
    description: 'Necesitas una API Key para analizar contenido.',
    recoverability: 'requires-settings',
    action: 'open-settings',
    actionLabel: 'Configurar',
  });
});

test('retryable Analyze failures share the retry action without technical wording', () => {
  const expected = {
    RATE_LIMITED: ['Has realizado varios análisis', 'Espera un momento antes de volver a intentarlo.'],
    SERVICE_UNAVAILABLE: ['El servicio no está disponible', 'No pudimos completar el análisis en este momento.'],
    NETWORK_ERROR: ['No pudimos conectar', 'Revisa tu conexión e inténtalo nuevamente.'],
    INVALID_RESPONSE: ['No pudimos procesar la respuesta', 'El análisis no pudo completarse correctamente.'],
    UNKNOWN_ERROR: ['No pudimos completar el análisis', 'Inténtalo nuevamente.'],
  };

  for (const [code, [title, description]] of Object.entries(expected)) {
    const presentation = core.getAnalyzeErrorPresentation({ code });
    const visibleCopy = `${presentation.title} ${presentation.description}`;

    assert.equal(presentation.title, title);
    assert.equal(presentation.description, description);
    assert.equal(presentation.action, 'retry');
    assert.equal(presentation.recoverability, 'retryable');
    assert.doesNotMatch(visibleCopy, /\b(?:JSON|schema|contract|502|503|504|backend|Ollama|Qwen)\b/iu);
  }
});

test('rate limit exposes optional approximate retry-after without a countdown', () => {
  const presentation = core.getAnalyzeErrorPresentation({
    code: 'RATE_LIMITED',
    retryAfterSeconds: 42,
  });

  assert.equal(
    presentation.detail,
    'Podrás volver a intentarlo en aproximadamente 42 s.',
  );
});

test('stale selection replaces a previous result with a recoverable error', () => {
  const success = {
    status: 'success',
    requestId: 'analysis-old',
    result: {},
  };
  const next = core.reduceAnalysisState(success, {
    type: 'ANALYSIS_VALIDATION_FAILED',
    error: { code: 'STALE_SELECTION' },
  });

  assert.deepEqual(next, {
    status: 'error',
    requestId: null,
    error: { code: 'STALE_SELECTION' },
    transport: null,
  });
  assert.equal('result' in next, false);
});

test('Analyze loading blocks a second Analyze request', () => {
  const loading = core.reduceAnalysisState(core.INITIAL_ANALYSIS_STATE, {
    type: 'ANALYZE_REQUESTED',
    transport: null,
  });

  assert.equal(core.canRequestAnalysis(loading), false);
  assert.deepEqual(
    core.reduceAnalysisState(loading, { type: 'ANALYZE_REQUESTED' }),
    loading,
  );
});

test('new Analyze request and success clear previous Analyze errors', () => {
  const error = {
    status: 'error',
    requestId: 'analysis-1',
    error: { code: 'NETWORK_ERROR' },
  };
  const loading = core.reduceAnalysisState(error, { type: 'ANALYZE_REQUESTED' });
  const started = core.reduceAnalysisState(loading, {
    type: 'ANALYSIS_STARTED',
    requestId: 'analysis-2',
  });
  const success = core.reduceAnalysisState(started, {
    type: 'ANALYSIS_SUCCEEDED',
    requestId: 'analysis-2',
    result: {},
  });

  assert.equal(loading.status, 'loading');
  assert.equal(success.status, 'success');
  assert.equal('error' in success, false);
});

test('todos los CTA de análisis pasan por el mismo arranque', async () => {
  // El invariante no es «todos llaman a requestAnalysis» —el reintento tras un
  // fallo local debe forzar transporte local— sino que ninguna ruta se salte
  // `startAnalysis`, que es donde viven las guardas y el estado del motor.
  const uiSource = await readFile(path.join(workspace, 'src/ui.ts'), 'utf8');

  assert.match(uiSource, /analyzeButton\.addEventListener\('click', requestAnalysis\)/u);
  assert.match(uiSource, /analyzeAgainButton\.addEventListener\('click', requestAnalysis\)/u);

  for (const entryPoint of [
    'function requestAnalysis',
    'function retryLocalAnalysis',
    'function useCloudForCurrentAnalysis',
  ]) {
    const body = uiSource.slice(uiSource.indexOf(entryPoint));
    assert.ok(
      body.slice(0, body.indexOf('\n}')).includes('startAnalysis('),
      `${entryPoint} no pasa por startAnalysis`,
    );
  }

  // Ninguna acción puede publicar un mensaje de análisis por su cuenta.
  const strayPosts = uiSource.match(/postToMain\(\{\s*\n?\s*type: '(ANALYZE_REQUEST|RETRY_LOCAL_ANALYSIS|USE_CLOUD_FOR_CURRENT_ANALYSIS)'/gu);
  assert.equal(strayPosts, null, 'hay un análisis que no pasa por startAnalysis');
});

test('Settings retry repeats the operation that actually failed', () => {
  assert.deepEqual(
    core.createSettingsRetryMessage('STORAGE_READ_FAILED', null),
    { type: 'REQUEST_API_KEY_STATUS' },
  );
  assert.deepEqual(
    core.createSettingsRetryMessage('STORAGE_SAVE_FAILED', 'temporary-key'),
    { type: 'SAVE_API_KEY', apiKey: 'temporary-key' },
  );
  assert.deepEqual(
    core.createSettingsRetryMessage('STORAGE_DELETE_FAILED', null),
    { type: 'DELETE_API_KEY' },
  );
  assert.equal(
    core.createSettingsRetryMessage('STORAGE_SAVE_FAILED', null),
    null,
  );
});

test('Settings error copy distinguishes read, save and delete failures', () => {
  assert.equal(
    core.getSettingsErrorPresentation('STORAGE_READ_FAILED').title,
    'No pudimos leer la configuración',
  );
  assert.equal(
    core.getSettingsErrorPresentation('STORAGE_SAVE_FAILED').title,
    'No pudimos guardar la configuración',
  );
  assert.equal(
    core.getSettingsErrorPresentation('STORAGE_DELETE_FAILED').title,
    'No pudimos eliminar la clave',
  );
});

test('Apply recoverability mapping separates retries, new analysis and blocking', () => {
  assert.equal(core.getApplyRecoverability('FONT_LOAD_FAILED'), 'retryable');
  assert.equal(core.getApplyRecoverability('EDIT_FAILED'), 'retryable');
  assert.equal(core.getApplyRecoverability('TEXT_CHANGED'), 'requires-new-analysis');
  assert.equal(core.getApplyRecoverability('SELECTION_CHANGED'), 'recoverable-after-selection');
  assert.equal(core.getApplyRecoverability('MISSING_FONT'), 'blocked');
  assert.equal(core.getApplyRecoverability('MIXED_STYLES_UNSUPPORTED'), 'blocked');
});

test('Apply copy matches the local recovery guidance', () => {
  assert.deepEqual(core.getApplyErrorPresentation({ code: 'MISSING_FONT' }), {
    title: 'Hay una fuente no disponible',
    description: 'Resuelve la fuente faltante en Figma antes de aplicar la sugerencia.',
    recoverability: 'blocked',
    action: 'none',
  });
  assert.deepEqual(core.getApplyErrorPresentation({ code: 'TEXT_CHANGED' }), {
    title: 'El texto cambió',
    description: 'Analízalo nuevamente antes de aplicar una sugerencia.',
    recoverability: 'requires-new-analysis',
    action: 'none',
  });
});

test('error regions are contextual, accessible and not nested in duplicate live regions', async () => {
  const template = await readFile(path.join(workspace, 'ui/ui.html'), 'utf8');

  for (const id of [
    'analysis-error',
    'apply-local-feedback',
    'apply-error-fallback',
    'settings-error',
  ]) {
    assert.match(template, new RegExp(`id="${id}"[^>]*role="alert"`, 'u'));
  }

  assert.doesNotMatch(template, /id="state-panel"[^>]*aria-live/u);
  assert.doesNotMatch(template, /class="settings-section"[^>]*aria-live/u);
  assert.equal((template.match(/id="analysis-error"/gu) ?? []).length, 1);
  assert.equal((template.match(/id="apply-local-feedback"/gu) ?? []).length, 1);
  assert.equal((template.match(/id="settings-error"/gu) ?? []).length, 1);
});
