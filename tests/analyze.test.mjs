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
      "export * from './src/analysis-session.ts';",
      "export * from './src/analysis-state.ts';",
      "export * from './src/loading-feedback.ts';",
      "export * from './src/result-presentation.ts';",
      "export * from './src/shared/messages.ts';",
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

if (moduleSource === undefined) {
  throw new Error('Unable to compile analyze modules for testing.');
}

const core = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

const validIssue = {
  category: 'clarity',
  severity: 'medium',
  term: 'proceder',
  reason: 'El verbo es menos directo de lo necesario.',
};

const validResponse = {
  text: 'Proceder con el registro',
  locale: 'es-MX',
  score: 78,
  severity: 'medium',
  clarity: 4,
  concision: 3,
  utility: 4,
  jargon: true,
  predictability: 4,
  orthography: 4,
  issues: [validIssue],
  reason: 'El contenido es comprensible, pero puede ser más directo.',
  suggestion: 'Completa el registro',
};

const mockCredential = ['qa', 'credential', 'fixture'].join('-');

function createResponse(status, body = validResponse, headersObject = {}) {
  return {
    status,
    headersObject,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

async function expectAnalyzeError(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof core.AnalyzeApiError, true);
    assert.equal(error.details.code, expectedCode);
    return true;
  });
}

test('valid AnalyzeResponse and AnalyzeIssue are accepted', () => {
  assert.equal(core.isAnalyzeIssue(validIssue), true);
  assert.equal(core.isAnalyzeResponse(validResponse), true);
  assert.deepEqual(core.parseAnalyzeResponse(validResponse), validResponse);
});

test('score outside 0–100 is rejected', () => {
  assert.equal(core.isAnalyzeResponse({ ...validResponse, score: 101 }), false);
});

test('metric outside 1–5 is rejected', () => {
  assert.equal(core.isAnalyzeResponse({ ...validResponse, clarity: 0 }), false);
  assert.equal(core.isAnalyzeResponse({ ...validResponse, predictability: 6 }), false);
  assert.equal(core.isAnalyzeResponse({ ...validResponse, orthography: 0 }), false);
  assert.equal(core.isAnalyzeResponse({ ...validResponse, orthography: 6 }), false);
});

test('runtime validator requires orthography', () => {
  const { orthography: _orthography, ...missingOrthography } = validResponse;

  assert.equal(core.isAnalyzeResponse(missingOrthography), false);
  assert.throws(() => core.parseAnalyzeResponse(missingOrthography), /INVALID_ANALYZE_RESPONSE/u);
});

test('critical severity is rejected', () => {
  assert.equal(core.isAnalyzeResponse({ ...validResponse, severity: 'critical' }), false);
});

test('numeric jargon is rejected', () => {
  assert.equal(core.isAnalyzeResponse({ ...validResponse, jargon: 2 }), false);
});

test('string-array issues are rejected', () => {
  assert.equal(core.isAnalyzeResponse({ ...validResponse, issues: ['clarity'] }), false);
});

test('request contract, endpoint and headers are exact', async () => {
  let capturedUrl;
  let capturedOptions;
  const result = await core.analyzeText(async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return createResponse(200);
  }, mockCredential, 'Continuar');

  assert.deepEqual(result, validResponse);
  assert.equal(capturedUrl, 'https://writing.productdesign.mx/v1/analyze/text');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
  assert.equal(capturedOptions.headers['X-API-Key'], mockCredential);
  assert.deepEqual(JSON.parse(capturedOptions.body), {
    text: 'Continuar',
    context: 'Texto de interfaz seleccionado en Figma',
    locale: 'es-MX',
  });
});

test('invalid JSON is mapped to INVALID_RESPONSE', async () => {
  await expectAnalyzeError(
    core.analyzeText(async () => createResponse(200, '{invalid'), mockCredential, 'Texto'),
    'INVALID_RESPONSE',
  );
});

test('invalid response contract is mapped to INVALID_RESPONSE', async () => {
  await expectAnalyzeError(
    core.analyzeText(async () => createResponse(200, { score: 90 }), mockCredential, 'Texto'),
    'INVALID_RESPONSE',
  );
});

for (const status of [401, 403]) {
  test(`${status} is mapped to UNAUTHORIZED`, async () => {
    await expectAnalyzeError(
      core.analyzeText(async () => createResponse(status), mockCredential, 'Texto'),
      'UNAUTHORIZED',
    );
  });
}

test('429 is mapped to RATE_LIMITED with valid Retry-After', async () => {
  await assert.rejects(
    core.analyzeText(
      async () => createResponse(429, validResponse, { 'Retry-After': '30' }),
      mockCredential,
      'Texto',
    ),
    (error) => {
      assert.equal(error.details.code, 'RATE_LIMITED');
      assert.equal(error.details.retryAfterSeconds, 30);
      return true;
    },
  );
});

test('unsafe Retry-After is ignored', () => {
  assert.equal(core.parseRetryAfterSeconds({ 'retry-after': '-1' }), undefined);
  assert.equal(core.parseRetryAfterSeconds({ 'retry-after': 'tomorrow' }), undefined);
});

test('502 is mapped to INVALID_RESPONSE and never SERVICE_UNAVAILABLE', async () => {
  await expectAnalyzeError(
    core.analyzeText(async () => createResponse(502), mockCredential, 'Texto'),
    'INVALID_RESPONSE',
  );
  assert.equal(core.mapHttpError(502, {}).details.code, 'INVALID_RESPONSE');
  assert.notEqual(core.mapHttpError(502, {}).details.code, 'SERVICE_UNAVAILABLE');
});

for (const status of [503, 504]) {
  test(`${status} is mapped to SERVICE_UNAVAILABLE`, async () => {
    await expectAnalyzeError(
      core.analyzeText(async () => createResponse(status), mockCredential, 'Texto'),
      'SERVICE_UNAVAILABLE',
    );
  });
}

test('network failure is mapped to NETWORK_ERROR', async () => {
  await expectAnalyzeError(
    core.analyzeText(async () => { throw new Error('offline'); }, mockCredential, 'Texto'),
    'NETWORK_ERROR',
  );
});

test('analysis intent uses only the current ready selection revision', () => {
  const selectionA = {
    status: 'ready',
    revision: 4,
    nodeId: 'node-a',
    nodeName: 'Text A',
    text: 'Texto A',
  };
  const selectionB = {
    status: 'ready',
    revision: 5,
    nodeId: 'node-b',
    nodeName: 'Text B',
    text: 'Texto B',
  };

  assert.deepEqual(core.createAnalysisRequestMessage(selectionA), {
    type: 'ANALYZE_REQUEST',
    selectionRevision: 4,
  });
  assert.deepEqual(core.createAnalysisRequestMessage(selectionB), {
    type: 'ANALYZE_REQUEST',
    selectionRevision: 5,
  });
});

test('invalid, empty and whitespace selection states cannot create an Analyze request', () => {
  const states = [
    { status: 'no-selection', revision: 2 },
    { status: 'multiple-selection', revision: 2, count: 2 },
    {
      status: 'invalid-selection',
      revision: 2,
      nodeType: 'FRAME',
      nodeName: 'Frame',
    },
    {
      status: 'empty-text',
      revision: 2,
      nodeId: 'empty',
      nodeName: 'Empty',
      text: '',
    },
    {
      status: 'empty-text',
      revision: 2,
      nodeId: 'whitespace',
      nodeName: 'Whitespace',
      text: '   \n\t',
    },
  ];

  for (const state of states) {
    assert.equal(core.createAnalysisRequestMessage(state), null);
  }
});

test('Analyze Again transitions directly from result to loading', () => {
  const result = {
    status: 'success',
    requestId: 'analysis-1',
    result: validResponse,
  };
  const loading = core.reduceAnalysisState(result, {
    type: 'ANALYZE_REQUESTED',
  });

  assert.deepEqual(loading, { status: 'loading', requestId: null });
  assert.equal('result' in loading, false);
});

test('double Analyze Again preserves the single active request', () => {
  const loading = {
    status: 'loading',
    requestId: 'analysis-2',
  };

  assert.deepEqual(
    core.reduceAnalysisState(loading, { type: 'ANALYZE_REQUESTED' }),
    loading,
  );
});

test('new success replaces the previous result completely', () => {
  const previous = {
    status: 'success',
    requestId: 'analysis-1',
    result: validResponse,
  };
  const loading = core.reduceAnalysisState(previous, {
    type: 'ANALYZE_REQUESTED',
  });
  const started = core.reduceAnalysisState(loading, {
    type: 'ANALYSIS_STARTED',
    requestId: 'analysis-2',
  });
  const replacement = {
    ...validResponse,
    text: 'Texto actualizado',
    score: 91,
  };
  const success = core.reduceAnalysisState(started, {
    type: 'ANALYSIS_SUCCEEDED',
    requestId: 'analysis-2',
    result: replacement,
  });

  assert.deepEqual(success, {
    status: 'success',
    requestId: 'analysis-2',
    result: replacement,
  });
  assert.notDeepEqual(success.result, previous.result);
});

test('missing API key is rejected before fetch', async () => {
  let fetchCalled = false;
  await expectAnalyzeError(
    core.analyzeText(async () => {
      fetchCalled = true;
      return createResponse(200);
    }, '   ', 'Texto'),
    'MISSING_API_KEY',
  );
  assert.equal(fetchCalled, false);
});

test('stale revision and changed text are rejected', () => {
  const snapshot = {
    status: 'ready',
    revision: 4,
    nodeId: 'node-1',
    nodeName: 'Label',
    text: 'Continuar',
  };
  const current = {
    status: 'ready',
    nodeId: 'node-1',
    nodeName: 'Label',
    text: 'Continuar',
  };

  assert.deepEqual(core.validateAnalysisSelection(3, snapshot, current), {
    valid: false,
    code: 'STALE_SELECTION',
  });
  assert.deepEqual(core.validateAnalysisSelection(4, snapshot, {
    ...current,
    text: 'Guardar',
  }), {
    valid: false,
    code: 'STALE_SELECTION',
  });
});

test('analysis context rejects older requests and changed selection', () => {
  const context = {
    requestId: 'analysis-1',
    requestToken: 6,
    selectionRevision: 2,
    nodeId: 'node-1',
    originalText: 'Continuar',
  };
  const current = {
    status: 'ready',
    nodeId: 'node-1',
    nodeName: 'Label',
    text: 'Continuar',
  };

  assert.equal(core.isAnalysisContextCurrent(context, 6, 2, current), true);
  assert.equal(core.isAnalysisContextCurrent(context, 7, 2, current), false);
  assert.equal(core.isAnalysisContextCurrent(context, 6, 3, current), false);
});

test('old response is ignored by UI state reducer', () => {
  const loading = { status: 'loading', requestId: 'analysis-2' };
  const nextState = core.reduceAnalysisState(loading, {
    type: 'ANALYSIS_SUCCEEDED',
    requestId: 'analysis-1',
    result: validResponse,
  });
  assert.deepEqual(nextState, loading);
});

test('selection and API key changes clear analysis result', () => {
  const success = {
    status: 'success',
    requestId: 'analysis-1',
    result: validResponse,
  };
  assert.deepEqual(core.reduceAnalysisState(success, { type: 'SELECTION_CHANGED' }), {
    status: 'idle',
  });
  assert.deepEqual(core.reduceAnalysisState(success, { type: 'API_KEY_CHANGED' }), {
    status: 'idle',
  });
});

test('MAIN to UI analysis messages never include API key fields', () => {
  const messages = [
    { type: 'ANALYSIS_STARTED', requestId: 'analysis-1' },
    { type: 'ANALYSIS_SUCCEEDED', requestId: 'analysis-1', result: validResponse },
    {
      type: 'ANALYSIS_FAILED',
      requestId: 'analysis-1',
      error: { code: 'UNAUTHORIZED' },
    },
  ];
  assert.equal(JSON.stringify(messages).includes('apiKey'), false);
  assert.equal(JSON.stringify(messages).includes(mockCredential), false);
});

test('result severity uses human presentation labels', () => {
  assert.equal(core.getSeverityLabel('low'), 'Buen nivel');
  assert.equal(core.getSeverityLabel('medium'), 'Necesita atención');
  assert.equal(core.getSeverityLabel('high'), 'Requiere revisión');
});

test('issue severity uses Spanish presentation labels', () => {
  assert.equal(core.getIssueSeverityLabel('low'), 'Baja');
  assert.equal(core.getIssueSeverityLabel('medium'), 'Media');
  assert.equal(core.getIssueSeverityLabel('high'), 'Alta');
});

test('known issue categories use UX Writing labels', () => {
  assert.equal(core.getIssueCategoryLabel('jargon'), 'Jerga');
  assert.equal(core.getIssueCategoryLabel('clarity'), 'Claridad');
  assert.equal(core.getIssueCategoryLabel('concision'), 'Concisión');
  assert.equal(core.getIssueCategoryLabel('utility'), 'Utilidad');
  assert.equal(core.getIssueCategoryLabel('predictability'), 'Predictibilidad');
  assert.equal(core.getIssueCategoryLabel('orthography'), 'Ortografía');
});

test('unknown issue category becomes readable without breaking presentation', () => {
  assert.equal(core.getIssueCategoryLabel('information_architecture'), 'Information architecture');
  assert.equal(core.getIssueCategoryLabel('  custom-tone  '), 'Custom tone');
  assert.equal(core.getIssueCategoryLabel(''), 'Oportunidad');
});

test('metric display keeps the /5 value visible and exposes a proportional bar', () => {
  assert.deepEqual(core.getMetricDisplay('Claridad', 4), {
    label: 'Claridad',
    value: 4,
    valueLabel: '4/5',
    percentage: 80,
  });
});

test('orthography renders through the same metric presentation at 5/5 and 3/5', () => {
  const excellent = core.getResultPresentation({ ...validResponse, orthography: 5 });
  const needsWork = core.getResultPresentation({ ...validResponse, orthography: 3 });

  assert.deepEqual(excellent.metrics[4], {
    label: 'Ortografía',
    value: 5,
    valueLabel: '5/5',
    percentage: 100,
  });
  assert.equal(needsWork.metrics[4].valueLabel, '3/5');
  assert.equal(needsWork.metrics[4].percentage, 60);
});

test('orthography issues appear in Opportunities with a user-facing label', () => {
  const presentation = core.getResultPresentation({
    ...validResponse,
    orthography: 4,
    issues: [{
      category: 'orthography',
      severity: 'medium',
      term: 'prestamo',
      reason: 'Falta la tilde en “préstamo”.',
    }],
    suggestion: 'préstamo',
  });

  assert.equal(presentation.showIssuesSection, true);
  assert.deepEqual(presentation.issues[0], {
    categoryLabel: 'Ortografía',
    severityLabel: 'Media',
    severity: 'medium',
    term: 'prestamo',
    reason: 'Falta la tilde en “préstamo”.',
  });
  assert.equal(presentation.hasSuggestionChange, true);
  assert.equal(presentation.isNoChange, false);
});

test('empty issues and jargon false do not create empty or false-warning sections', () => {
  const presentation = core.getResultPresentation({
    ...validResponse,
    jargon: false,
    issues: [],
  });

  assert.equal(presentation.showIssuesSection, false);
  assert.equal(presentation.issues.length, 0);
  assert.equal(presentation.showJargonWarning, false);
});

test('jargon true creates the warning presentation', () => {
  const presentation = core.getResultPresentation({
    ...validResponse,
    jargon: true,
  });

  assert.equal(presentation.showJargonWarning, true);
});

test('exactly duplicated result reason is displayed only as issue reason', () => {
  const duplicateReason = 'El contenido usa un término interno.';
  const presentation = core.getResultPresentation({
    ...validResponse,
    reason: duplicateReason,
    issues: [{
      ...validIssue,
      reason: duplicateReason,
    }],
  });

  assert.equal(presentation.showGeneralReason, false);
});

test('similar but non-identical reasons remain visible without fuzzy matching', () => {
  const presentation = core.getResultPresentation({
    ...validResponse,
    reason: 'El contenido usa un término interno.',
    issues: [{
      ...validIssue,
      reason: 'El contenido usa un término interno',
    }],
  });

  assert.equal(presentation.showGeneralReason, true);
});

test('long result content remains complete in presentation data', () => {
  const longReason = 'Razón extensa '.repeat(100);
  const longSuggestion = 'Sugerencia extensa '.repeat(100);
  const longIssueReason = 'Detalle extenso '.repeat(100);
  const presentation = core.getResultPresentation({
    ...validResponse,
    reason: longReason,
    suggestion: longSuggestion,
    issues: [{
      ...validIssue,
      term: null,
      reason: longIssueReason,
    }],
  });

  assert.equal(presentation.generalReason, longReason);
  assert.equal(presentation.suggestion, longSuggestion);
  assert.equal(presentation.issues[0].reason, longIssueReason);
  assert.equal(presentation.issues[0].term, null);
});

test('exactly identical suggestion is presented as no change without normalization', () => {
  const noChange = core.getResultPresentation({
    ...validResponse,
    text: 'Continuar',
    suggestion: 'Continuar',
    orthography: 5,
    issues: [],
  });
  const whitespaceChange = core.getResultPresentation({
    ...validResponse,
    text: 'Continuar',
    suggestion: 'Continuar ',
  });

  assert.equal(noChange.hasSuggestionChange, false);
  assert.equal(noChange.isNoChange, true);
  assert.equal(whitespaceChange.hasSuggestionChange, true);
  assert.equal(whitespaceChange.isNoChange, false);
});

test('identical suggestion is not a no-change result when issues remain or orthography is below 5', () => {
  const identical = {
    ...validResponse,
    text: 'prestamo',
    suggestion: 'prestamo',
    orthography: 5,
    issues: [],
  };

  assert.equal(core.getResultPresentation({
    ...identical,
    issues: [{
      category: 'orthography',
      severity: 'medium',
      term: 'prestamo',
      reason: 'Revisa la acentuación.',
    }],
  }).isNoChange, false);
  assert.equal(core.getResultPresentation({
    ...identical,
    orthography: 4,
  }).isNoChange, false);
});

test('Continuar 100 and María 94 are no-op results', () => {
  const maria = 'María, completa tus datos y revisa que sean correctos.';
  const fixtures = [
    { text: 'Continuar', suggestion: 'Continuar', score: 100 },
    { text: maria, suggestion: maria, score: 94 },
  ];

  for (const fixture of fixtures) {
    const presentation = core.getResultPresentation({
      ...validResponse,
      ...fixture,
      severity: 'low',
      orthography: 5,
      issues: [],
    });
    assert.equal(presentation.hasSuggestionChange, false);
    assert.equal(presentation.isNoChange, true);
    assert.equal(presentation.severityLabel, 'Buen nivel');
  }
});

test('a real credentials rewrite keeps the Apply experience eligible', () => {
  const result = {
    ...validResponse,
    text: 'Ingresa tus credenciales',
    suggestion: 'Ingresa tus datos de acceso',
  };

  assert.equal(core.hasSuggestionChange(result), true);
  assert.equal(core.canRequestAnalysis({ status: 'success', requestId: 'a', result }), true);
});

test('prestamo to préstamo presents the correction and Apply path', () => {
  const presentation = core.getResultPresentation({
    ...validResponse,
    text: 'prestamo',
    orthography: 4,
    issues: [{
      category: 'orthography',
      severity: 'medium',
      term: 'prestamo',
      reason: 'Falta la tilde en “préstamo”.',
    }],
    suggestion: 'préstamo',
  });

  assert.equal(presentation.metrics[4].valueLabel, '4/5');
  assert.equal(presentation.issues[0].categoryLabel, 'Ortografía');
  assert.equal(presentation.suggestion, 'préstamo');
  assert.equal(presentation.hasSuggestionChange, true);
  assert.equal(presentation.isNoChange, false);
});

test('placeholder text is compared and presented exactly without normalization', () => {
  const placeholderText = 'Tu visita será el {{Jueves 10 de abril de 2026}}\na las {{6:00 p.m.}}.';
  const presentation = core.getResultPresentation({
    ...validResponse,
    text: placeholderText,
    suggestion: placeholderText,
    orthography: 5,
    issues: [],
  });

  assert.equal(presentation.suggestion, placeholderText);
  assert.equal(presentation.hasSuggestionChange, false);
  assert.equal(presentation.isNoChange, true);
});

test('loading feedback changes only after the 8 second timer fires', () => {
  let callback;
  let scheduledDelay;
  let extendedCount = 0;
  const feedback = core.createAnalysisLoadingFeedback({
    onExtended: () => { extendedCount += 1; },
    schedule: (nextCallback, delay) => {
      callback = nextCallback;
      scheduledDelay = delay;
      return 1;
    },
    cancel: () => {},
  });

  feedback.start();
  assert.equal(feedback.isExtended(), false);
  assert.equal(scheduledDelay, 8_000);
  assert.equal(core.INITIAL_ANALYSIS_LOADING_MESSAGE, 'Analizando contenido…');

  callback();
  assert.equal(feedback.isExtended(), true);
  assert.equal(extendedCount, 1);
  assert.equal(
    core.EXTENDED_ANALYSIS_LOADING_MESSAGE,
    'El análisis está tomando un poco más de lo habitual…',
  );
});

test('clearing loading feedback prevents a stale timer callback from updating UI', () => {
  let callback;
  let extendedCount = 0;
  const feedback = core.createAnalysisLoadingFeedback({
    onExtended: () => { extendedCount += 1; },
    schedule: (nextCallback) => {
      callback = nextCallback;
      return 1;
    },
    cancel: () => {},
  });

  feedback.start();
  feedback.clear();
  callback();

  assert.equal(feedback.isExtended(), false);
  assert.equal(extendedCount, 0);
});

test('success, error and invalidation clear loading; stale responses do not', () => {
  const loading = { status: 'loading', requestId: 'analysis-current' };
  const success = core.reduceAnalysisState(loading, {
    type: 'ANALYSIS_SUCCEEDED',
    requestId: 'analysis-current',
    result: validResponse,
  });
  const error = core.reduceAnalysisState(loading, {
    type: 'ANALYSIS_FAILED',
    requestId: 'analysis-current',
    error: { code: 'NETWORK_ERROR' },
  });
  const invalidated = core.reduceAnalysisState(loading, { type: 'SELECTION_CHANGED' });
  const stale = core.reduceAnalysisState(loading, {
    type: 'ANALYSIS_SUCCEEDED',
    requestId: 'analysis-old',
    result: validResponse,
  });

  assert.equal(core.didAnalysisLeaveLoading(loading, success), true);
  assert.equal(core.didAnalysisLeaveLoading(loading, error), true);
  assert.equal(core.didAnalysisLeaveLoading(loading, invalidated), true);
  assert.equal(core.didAnalysisLeaveLoading(loading, stale), false);
});
