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
      "export * from './src/apply-contracts.ts';",
      "export * from './src/apply-state.ts';",
      "export * from './src/apply-suggestion.ts';",
      "export * from './src/analysis-session.ts';",
      "export * from './src/analysis-state.ts';",
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
  throw new Error('Unable to compile apply modules for testing.');
}

const core = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

const activeSession = {
  requestId: 'analysis-12',
  selectionRevision: 7,
  nodeId: 'text-1',
  originalText: 'Proceder con la originación',
  suggestion: 'Realizar solicitud',
};

const activeSelection = [{
  type: 'TEXT',
  id: 'text-1',
  characters: activeSession.originalText,
}];

function createTextNode({
  characters = activeSession.originalText,
  hasMissingFont = false,
  segments = [{ start: 0, end: characters.length, characters }],
  fonts = [{ family: 'Brand Sans', style: 'Bold' }],
  insertFailure = false,
  deleteFailure = false,
} = {}) {
  let value = characters;
  let shouldFailDelete = deleteFailure;
  const calls = [];

  return {
    type: 'TEXT',
    id: 'text-1',
    hasMissingFont,
    calls,
    get characters() {
      return value;
    },
    getStyledTextSegments(fields) {
      calls.push(['getStyledTextSegments', fields]);
      return segments;
    },
    getRangeAllFontNames(start, end) {
      calls.push(['getRangeAllFontNames', start, end]);
      return fonts;
    },
    insertCharacters(start, insertedText, useStyle) {
      calls.push(['insertCharacters', start, insertedText, useStyle]);

      if (insertFailure) {
        throw new Error('insert failed');
      }

      value = value.slice(0, start) + insertedText + value.slice(start);
    },
    deleteCharacters(start, end) {
      calls.push(['deleteCharacters', start, end]);

      if (shouldFailDelete) {
        shouldFailDelete = false;
        throw new Error('delete failed');
      }

      value = value.slice(0, start) + value.slice(end);
    },
  };
}

async function expectApplyError(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof core.ApplyOperationError, true);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('active analysis is valid for the analyzed node and text', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', activeSession, 7, activeSelection),
    { valid: true },
  );
});

test('successful analysis creates an in-memory apply session with its suggestion', () => {
  assert.deepEqual(core.createApplySession({
    requestId: 'analysis-12',
    requestToken: 4,
    selectionRevision: 7,
    nodeId: 'text-1',
    originalText: activeSession.originalText,
  }, activeSession.suggestion), activeSession);
});

test('incorrect requestId is rejected as stale analysis', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-11', activeSession, 7, activeSelection),
    { valid: false, code: 'STALE_ANALYSIS' },
  );
});

test('missing active session is rejected', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', null, 7, activeSelection),
    { valid: false, code: 'NO_ACTIVE_ANALYSIS' },
  );
});

test('stale revision is rejected as changed selection', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', activeSession, 8, activeSelection),
    { valid: false, code: 'SELECTION_CHANGED' },
  );
});

test('invalid selection and changed nodeId are rejected', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', activeSession, 7, []),
    { valid: false, code: 'INVALID_SELECTION' },
  );
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', activeSession, 7, [{
      ...activeSelection[0],
      id: 'text-2',
    }]),
    { valid: false, code: 'SELECTION_CHANGED' },
  );
});

test('a deleted analyzed node is treated as an invalid analysis', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', activeSession, 7, [{
      ...activeSelection[0],
      removed: true,
    }]),
    { valid: false, code: 'INVALID_SELECTION' },
  );
});

test('manual text changes are never overwritten', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', activeSession, 7, [{
      ...activeSelection[0],
      characters: 'Texto editado manualmente',
    }]),
    { valid: false, code: 'TEXT_CHANGED' },
  );
});

test('empty suggestion is rejected before editing', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', {
      ...activeSession,
      suggestion: '   ',
    }, 7, activeSelection),
    { valid: false, code: 'EMPTY_SUGGESTION' },
  );
});

test('empty original text is rejected', () => {
  assert.deepEqual(
    core.validateApplyRequest('analysis-12', {
      ...activeSession,
      originalText: '',
    }, 7, [{ type: 'TEXT', id: 'text-1', characters: '' }]),
    { valid: false, code: 'TEXT_CHANGED' },
  );
});

test('missing font blocks apply before font loading or mutation', async () => {
  const node = createTextNode({ hasMissingFont: true });
  let loadCalled = false;

  await expectApplyError(
    core.applySuggestionToTextNode(node, activeSession.suggestion, async () => {
      loadCalled = true;
    }),
    'MISSING_FONT',
  );
  assert.equal(loadCalled, false);
  assert.equal(node.calls.length, 0);
});

test('font loading failure blocks mutation', async () => {
  const node = createTextNode();

  await expectApplyError(
    core.applySuggestionToTextNode(node, activeSession.suggestion, async () => {
      throw new Error('font unavailable');
    }),
    'FONT_LOAD_FAILED',
  );
  assert.equal(node.calls.some(([name]) => name === 'insertCharacters'), false);
});

test('mixed character styles are rejected', async () => {
  const node = createTextNode({
    segments: [
      { start: 0, end: 8, characters: 'Proceder' },
      { start: 8, end: activeSession.originalText.length, characters: ' con la originación' },
    ],
  });

  await expectApplyError(
    core.applySuggestionToTextNode(node, activeSession.suggestion, async () => {}),
    'MIXED_STYLES_UNSUPPORTED',
  );
  assert.equal(node.calls.some(([name]) => name === 'insertCharacters'), false);
});

test('preflight detects mixed styles without loading fonts or mutating text', () => {
  const node = createTextNode({
    segments: [
      { start: 0, end: 8, characters: 'Proceder' },
      { start: 8, end: activeSession.originalText.length, characters: ' con la originación' },
    ],
  });

  assert.equal(core.getApplyPreflightError(node), 'MIXED_STYLES_UNSUPPORTED');
  assert.deepEqual(node.calls.map(([name]) => name), ['getStyledTextSegments']);
});

test('preflight detects a missing font without inspecting styles or mutating text', () => {
  const node = createTextNode({ hasMissingFont: true });

  assert.equal(core.getApplyPreflightError(node), 'MISSING_FONT');
  assert.deepEqual(node.calls, []);
});

test('preflight inspection failure defers safely to authoritative Apply validation', () => {
  const node = createTextNode();
  node.getStyledTextSegments = () => {
    throw new Error('inspection unavailable');
  };

  assert.equal(core.getApplyPreflightError(node), null);
});

test('mixed-style inspection covers the required character properties', () => {
  for (const field of [
    'fontName',
    'fontSize',
    'textCase',
    'textDecoration',
    'letterSpacing',
    'lineHeight',
    'fills',
    'textStyleId',
    'fillStyleId',
    'openTypeFeatures',
  ]) {
    assert.equal(core.APPLY_STYLE_FIELDS.includes(field), true);
  }
});

test('homogeneous text loads its actual fonts and applies with insert/delete', async () => {
  const node = createTextNode({
    fonts: [
      { family: 'Brand Sans', style: 'Bold' },
      { family: 'Brand Sans', style: 'Bold' },
    ],
  });
  const loadedFonts = [];
  const result = await core.applySuggestionToTextNode(
    node,
    activeSession.suggestion,
    async (font) => loadedFonts.push(font),
  );

  assert.deepEqual(loadedFonts, [{ family: 'Brand Sans', style: 'Bold' }]);
  assert.deepEqual(result, {
    previousText: activeSession.originalText,
    appliedText: activeSession.suggestion,
  });
  assert.equal(node.characters, activeSession.suggestion);
  assert.deepEqual(
    node.calls.find(([name]) => name === 'insertCharacters'),
    ['insertCharacters', 0, activeSession.suggestion, 'AFTER'],
  );
  assert.deepEqual(
    node.calls.find(([name]) => name === 'deleteCharacters'),
    [
      'deleteCharacters',
      activeSession.suggestion.length,
      activeSession.suggestion.length + activeSession.originalText.length,
    ],
  );
});

test('insert/delete strategy supports a suggestion longer than the original', async () => {
  const node = createTextNode({ characters: 'Guardar' });
  const longerSuggestion = 'Guardar y continuar con el siguiente paso';
  const result = await core.applySuggestionToTextNode(
    node,
    longerSuggestion,
    async () => {},
  );

  assert.equal(result.previousText, 'Guardar');
  assert.equal(result.appliedText, longerSuggestion);
  assert.equal(node.characters, longerSuggestion);
});

test('context is revalidated after fonts load and before mutation', async () => {
  const node = createTextNode();

  await expectApplyError(
    core.applySuggestionToTextNode(
      node,
      activeSession.suggestion,
      async () => {},
      () => 'SELECTION_CHANGED',
    ),
    'SELECTION_CHANGED',
  );
  assert.equal(node.calls.some(([name]) => name === 'insertCharacters'), false);
});

test('edit failure is mapped and inserted suggestion is rolled back', async () => {
  const node = createTextNode({ deleteFailure: true });

  await expectApplyError(
    core.applySuggestionToTextNode(node, activeSession.suggestion, async () => {}),
    'EDIT_FAILED',
  );
  assert.equal(node.characters, activeSession.originalText);
});

test('apply lock blocks a second simultaneous apply', () => {
  const firstLock = core.acquireApplyLock(null, 'analysis-12');
  const secondLock = core.acquireApplyLock(firstLock, 'analysis-12');

  assert.equal(firstLock, 'analysis-12');
  assert.equal(secondLock, null);
});

test('mixed styles become a blocked local Apply state', () => {
  const blocked = core.reduceApplyState(core.INITIAL_APPLY_STATE, {
    type: 'APPLY_BLOCKED',
    requestId: 'analysis-12',
    error: { code: 'MIXED_STYLES_UNSUPPORTED' },
  });

  assert.deepEqual(blocked, {
    status: 'blocked',
    requestId: 'analysis-12',
    error: { code: 'MIXED_STYLES_UNSUPPORTED' },
  });
  assert.equal(core.canRequestApply(blocked), false);
});

test('blocked Apply prevents a second APPLY_SUGGESTION request', () => {
  const blocked = {
    status: 'blocked',
    requestId: 'analysis-12',
    error: { code: 'MIXED_STYLES_UNSUPPORTED' },
  };

  assert.equal(core.canRequestApply(blocked), false);
  assert.equal(core.canRequestApply(blocked), false);
});

test('selection change and new analysis clear a local Apply warning', () => {
  const blocked = {
    status: 'blocked',
    requestId: 'analysis-12',
    error: { code: 'MIXED_STYLES_UNSUPPORTED' },
  };

  assert.deepEqual(
    core.reduceApplyState(blocked, { type: 'SELECTION_CHANGED' }),
    core.INITIAL_APPLY_STATE,
  );
  assert.deepEqual(
    core.reduceApplyState(blocked, { type: 'ANALYZE_REQUESTED' }),
    core.INITIAL_APPLY_STATE,
  );
});

test('successful retry clears a previous local Apply warning', () => {
  const failed = core.reduceApplyState({
    status: 'applying',
    requestId: 'analysis-12',
  }, {
    type: 'APPLY_FAILED',
    requestId: 'analysis-12',
    error: { code: 'FONT_LOAD_FAILED' },
  });
  const retrying = core.reduceApplyState(failed, {
    type: 'APPLY_REQUESTED',
    requestId: 'analysis-12',
  });
  const success = core.reduceApplyState(retrying, {
    type: 'APPLY_SUCCEEDED',
    requestId: 'analysis-12',
    payload: core.createApplySuccessPayload(activeSession, activeSession.suggestion, 8),
  });

  assert.equal(failed.status, 'error');
  assert.equal(success.status, 'success');
  assert.equal('error' in success, false);
});

test('selection sync invalidates analysis while preserving pending apply result', () => {
  const applying = core.reduceApplyState(core.INITIAL_APPLY_STATE, {
    type: 'APPLY_REQUESTED',
    requestId: 'analysis-12',
  });
  const afterSelectionSync = core.reduceApplyState(applying, {
    type: 'SELECTION_CHANGED',
  });
  const analysisResult = {
    status: 'success',
    requestId: 'analysis-12',
    result: {},
  };
  const invalidatedAnalysis = core.reduceAnalysisState(analysisResult, {
    type: 'SELECTION_CHANGED',
  });

  assert.deepEqual(afterSelectionSync, applying);
  assert.deepEqual(invalidatedAnalysis, { status: 'idle' });
});

test('successful apply preserves previous/applied text and updated revision', () => {
  const payload = core.createApplySuccessPayload(
    activeSession,
    activeSession.suggestion,
    8,
  );
  const applying = {
    status: 'applying',
    requestId: 'analysis-12',
  };
  const success = core.reduceApplyState(applying, {
    type: 'APPLY_SUCCEEDED',
    requestId: 'analysis-12',
    payload,
  });

  assert.deepEqual(payload, {
    nodeId: 'text-1',
    previousText: activeSession.originalText,
    appliedText: activeSession.suggestion,
    selectionRevision: 8,
  });
  assert.equal(success.status, 'success');
});

test('APPLY_SUGGESTION runtime message accepts only type and requestId', () => {
  assert.equal(core.isUiToMainMessage({
    type: 'APPLY_SUGGESTION',
    requestId: 'analysis-12',
  }), true);
  assert.equal(core.isUiToMainMessage({
    type: 'APPLY_SUGGESTION',
    requestId: 'analysis-12',
    suggestion: 'Contenido que nunca debe llegar a MAIN desde UI',
  }), false);
  assert.equal(core.isUiToMainMessage({
    type: 'APPLY_SUGGESTION',
  }), false);
});

test('Apply feedback is local to Suggestion and not duplicated in the top feedback', async () => {
  const [template, errorExperienceSource] = await Promise.all([
    readFile(path.join(workspace, 'ui/ui.html'), 'utf8'),
    readFile(path.join(workspace, 'src/error-experience.ts'), 'utf8'),
  ]);
  const suggestionStart = template.indexOf('class="result-section suggestion-section"');
  const localFeedback = template.indexOf('id="apply-local-feedback"');
  const applyButton = template.indexOf('id="apply-suggestion-button"');

  assert.equal(suggestionStart >= 0, true);
  assert.equal(localFeedback > suggestionStart, true);
  assert.equal(localFeedback < applyButton, true);
  assert.equal(template.includes('id="apply-feedback"'), false);
  assert.equal(errorExperienceSource.includes("title: 'Este texto usa estilos mixtos'"), true);
  assert.equal(
    errorExperienceSource.includes("description: 'Para conservar su formato, aplica la sugerencia manualmente.'"),
    true,
  );
});

test('Analyze Again stays enabled when Apply is blocked', async () => {
  const template = await readFile(path.join(workspace, 'ui/ui.html'), 'utf8');
  const button = template.match(/<button id="analyze-again-button"[^>]*>/u)?.[0];

  assert.notEqual(button, undefined);
  assert.equal(button.includes('disabled'), false);
});

test('no-op result suppresses Apply and mixed-style feedback eligibility', () => {
  const text = 'María, completa tus datos y revisa que sean correctos.';
  const result = {
    text,
    locale: 'es-MX',
    score: 94,
    severity: 'low',
    clarity: 5,
    concision: 5,
    utility: 5,
    jargon: false,
    predictability: 5,
    orthography: 5,
    issues: [],
    reason: 'El texto es claro.',
    suggestion: text,
  };
  const mixedStyles = core.reduceApplyState({ status: 'idle' }, {
    type: 'APPLY_BLOCKED',
    requestId: 'analysis-12',
    error: { code: 'MIXED_STYLES_UNSUPPORTED' },
  });

  assert.equal(core.hasSuggestionChange(result), false);
  assert.equal(mixedStyles.status, 'blocked');
  assert.equal(core.hasSuggestionChange(result) && mixedStyles.status === 'blocked', false);
});

test('real change keeps homogeneous Apply enabled and mixed-style Apply blocked', () => {
  const result = {
    text: 'Ingresa tus credenciales',
    locale: 'es-MX',
    score: 74,
    severity: 'medium',
    clarity: 4,
    concision: 4,
    utility: 3,
    jargon: true,
    predictability: 4,
    orthography: 4,
    issues: [],
    reason: 'Puede usar lenguaje más familiar.',
    suggestion: 'Ingresa tus datos de acceso',
  };
  const homogeneous = { status: 'idle' };
  const mixed = core.reduceApplyState(homogeneous, {
    type: 'APPLY_BLOCKED',
    requestId: 'analysis-13',
    error: { code: 'MIXED_STYLES_UNSUPPORTED' },
  });

  assert.equal(core.hasSuggestionChange(result), true);
  assert.equal(core.canRequestApply(homogeneous), true);
  assert.equal(core.canRequestApply(mixed), false);
});

test('UI wires Orthography, the positive no-change state and exact Apply gating', async () => {
  const [template, uiSource] = await Promise.all([
    readFile(path.join(workspace, 'ui/ui.html'), 'utf8'),
    readFile(path.join(workspace, 'src/ui.ts'), 'utf8'),
  ]);

  assert.equal(template.includes('No requiere cambios'), true);
  assert.equal(template.includes('Este texto ya tiene un buen nivel de UX Writing.'), true);
  assert.equal(template.includes('id="analysis-orthography"'), true);
  assert.equal(template.includes('id="analysis-orthography-bar"'), true);
  assert.equal(uiSource.includes('presentation.metrics[4]'), true);
  assert.equal(uiSource.includes('noChangeContent.hidden = !presentation.isNoChange'), true);
  assert.equal(uiSource.includes('hasSuggestionChange(analysisState.result)'), true);
  assert.equal(uiSource.includes('applySuggestionButton.hidden = !resultHasSuggestionChange'), true);
});
