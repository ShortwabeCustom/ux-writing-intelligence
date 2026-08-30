/**
 * Copia de los estados de selección (FASE 9.1.1).
 *
 * MOTIVO: el smoke en Figma real encontró un texto factualmente falso. Una
 * instancia llamada «Input Datepicker», con «Calle» y «C 27» visibles dentro,
 * mostraba «Esta capa no contiene texto». El problema no era el contenido sino
 * el tipo de la raíz seleccionada.
 *
 * La copia se extrajo a un módulo puro precisamente para que este tipo de
 * afirmación pueda comprobarse sin abrir Figma.
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
      "export * from './src/selection-presentation.ts';",
      "export * from './src/selection.ts';",
    ].join('\n'),
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});

const core = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const UNSUPPORTED_TITLE = 'Esta selección no se puede auditar';

/** Estado de selección real para un nodo raíz de un tipo dado. */
function stateFor(type, name = 'Input Datepicker') {
  return core.getSelectionState([{ type, id: 'n1', name }]);
}

// --- 1, 2 — raíces contenedoras no soportadas --------------------------------

test('1 y 2: GROUP e INSTANCE usan la copia de selección no auditable', () => {
  for (const type of ['GROUP', 'INSTANCE']) {
    const copy = core.getSelectionPresentation(stateFor(type));
    assert.equal(copy.title, UNSUPPORTED_TITLE, type);
  }
});

test('1b: SECTION y COMPONENT usan la misma copia', () => {
  for (const type of ['SECTION', 'COMPONENT']) {
    const copy = core.getSelectionPresentation(stateFor(type));
    assert.equal(copy.title, UNSUPPORTED_TITLE, type);
  }
});

// --- 3, 4, 5 — contenido de la copia -----------------------------------------

test('3 y 4: la copia orienta hacia una capa de texto o un Frame', () => {
  const copy = core.getSelectionPresentation(stateFor('INSTANCE'));

  assert.match(copy.description, /capa de texto/u);
  assert.match(copy.description, /Frame/u);
});

test('5 BLOQUEANTE: la copia NO afirma que no haya texto', () => {
  // Una instancia puede contener mucho texto. Decir lo contrario es falso.
  for (const type of ['GROUP', 'INSTANCE', 'SECTION', 'COMPONENT']) {
    const copy = core.getSelectionPresentation(stateFor(type));
    const full = `${copy.title} ${copy.description}`;

    assert.doesNotMatch(full, /no contiene texto/iu, type);
  }
});

test('la copia no expone vocabulario técnico', () => {
  const copy = core.getSelectionPresentation(stateFor('INSTANCE'));
  const full = `${copy.eyebrow} ${copy.title} ${copy.description}`;

  assert.doesNotMatch(full, /TextNode|FrameNode|InstanceNode|payload|enum|node|root/iu);
});

// --- 6, 7, 8 — el contrato de selección no cambia ----------------------------

test('6: FRAME sigue entrando a Screen Audit', () => {
  const state = stateFor('FRAME', 'Domicilio');

  assert.equal(state.status, 'frame');
  assert.equal(
    core.getSelectionPresentation(state).title,
    'Pantalla seleccionada',
  );
});

test('7: un nodo de texto sigue entrando a Text Audit', () => {
  const state = core.getSelectionState([
    { type: 'TEXT', id: 't1', name: 'CTA', characters: 'Continuar' },
  ]);

  assert.equal(state.status, 'ready');
  assert.equal(core.getSelectionPresentation(state).title, 'Texto seleccionado');
});

test('8: la selección múltiple conserva su estado y su copia', () => {
  const state = core.getSelectionState([
    { type: 'FRAME', id: 'f1', name: 'A' },
    { type: 'TEXT', id: 't1', name: 'B', characters: 'x' },
  ]);

  assert.equal(state.status, 'multiple-selection');

  const copy = core.getSelectionPresentation(state);
  assert.equal(copy.title, 'Selecciona una sola capa');
  assert.equal(copy.eyebrow, '2 capas seleccionadas');
});

// --- estados semánticamente distintos, no colapsados -------------------------

test('BLOQUEANTE: «capa vacía» y «raíz no soportada» siguen siendo distintos', () => {
  // Una capa de texto SÍ soportada pero sin contenido es otra cosa, y su
  // copia debe seguir diciendo lo que de verdad ocurre.
  const emptyText = core.getSelectionState([
    { type: 'TEXT', id: 't1', name: 'Etiqueta', characters: '   ' },
  ]);
  assert.equal(emptyText.status, 'empty-text');

  const emptyCopy = core.getSelectionPresentation(emptyText);
  const unsupportedCopy = core.getSelectionPresentation(stateFor('GROUP'));

  assert.equal(emptyCopy.title, 'Este texto está vacío');
  assert.notEqual(emptyCopy.title, unsupportedCopy.title);
  assert.notEqual(emptyCopy.description, unsupportedCopy.description);
});

test('cada estado de selección tiene una copia propia y no vacía', () => {
  const states = [
    { status: 'no-selection' },
    { status: 'multiple-selection', count: 3 },
    { status: 'invalid-selection', nodeType: 'GROUP', nodeName: 'G' },
    { status: 'empty-text', nodeId: 'n', nodeName: 'N', text: ' ' },
    { status: 'frame', nodeId: 'f', nodeName: 'F' },
    { status: 'ready', nodeId: 'r', nodeName: 'R', text: 'Hola' },
  ];

  const titles = states.map((s) => core.getSelectionPresentation(s).title);

  assert.equal(new Set(titles).size, states.length, 'hay estados con la misma copia');
  for (const state of states) {
    const copy = core.getSelectionPresentation(state);
    assert.ok(copy.title.length > 0 && copy.description.length > 0, state.status);
  }
});
