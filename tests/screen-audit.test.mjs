/**
 * Screen Audit — descubrimiento y preflight determinista (FASE 9.0 + 9.1).
 *
 * Esta fase NO analiza calidad de redacción. Solo decide qué es
 * estructuralmente apropiado para una auditoría futura. La autoridad sobre
 * ortografía, glosario, fidelidad semántica y fronteras sigue siendo del
 * runtime local, y no se replica aquí.
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
      "export * from './src/screen-audit-contracts.ts';",
      "export * from './src/screen-audit-eligibility.ts';",
      "export * from './src/screen-audit-discovery.ts';",
      "export * from './src/screen-audit-presentation.ts';",
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

let idCounter = 0;

function text(characters, overrides = {}) {
  idCounter += 1;
  return {
    id: `t${idCounter}`,
    name: overrides.name ?? `Capa ${idCounter}`,
    type: 'TEXT',
    visible: overrides.visible ?? true,
    characters,
    absoluteBoundingBox: overrides.box === undefined
      ? { x: 0, y: idCounter }
      : overrides.box,
    ...(overrides.opacity === undefined ? {} : { opacity: overrides.opacity }),
  };
}

function container(name, children, overrides = {}) {
  idCounter += 1;
  return {
    id: `c${idCounter}`,
    name,
    type: overrides.type ?? 'FRAME',
    visible: overrides.visible ?? true,
    children,
    absoluteBoundingBox: { x: 0, y: 0 },
    ...(overrides.opacity === undefined ? {} : { opacity: overrides.opacity }),
  };
}

const frame = (children, name = 'Domicilio') => container(name, children);

function classify(source, visible = true) {
  const result = core.classifyText({ text: source, effectivelyVisible: visible });
  return result.status === 'ready' ? 'ready' : result.skipReason;
}

// --- 01, 02 — contrato de selección ------------------------------------------

test('01: exactamente un nodo de texto sigue siendo Text Audit', () => {
  assert.deepEqual(
    core.getSelectionState([
      { type: 'TEXT', id: 't1', name: 'CTA', characters: 'Continuar' },
    ]),
    { status: 'ready', nodeId: 't1', nodeName: 'CTA', text: 'Continuar' },
  );
});

test('02: exactamente un frame produce el estado de pantalla', () => {
  assert.deepEqual(
    core.getSelectionState([{ type: 'FRAME', id: 'f1', name: 'Domicilio' }]),
    { status: 'frame', nodeId: 'f1', nodeName: 'Domicilio' },
  );
});

test('02b: el frame es la ÚNICA raíz autorizada en esta fase', () => {
  for (const type of ['GROUP', 'SECTION', 'COMPONENT', 'INSTANCE']) {
    assert.equal(
      core.getSelectionState([{ type, id: 'x', name: 'N' }]).status,
      'invalid-selection',
      `${type} no puede ser raíz de Screen Audit`,
    );
  }
});

test('02c: más de un nodo nunca es Screen Audit', () => {
  assert.equal(
    core.getSelectionState([
      { type: 'FRAME', id: 'f1', name: 'A' },
      { type: 'TEXT', id: 't1', name: 'B', characters: 'x' },
    ]).status,
    'multiple-selection',
  );
});

// --- 03 — descubrimiento -----------------------------------------------------

test('03: un frame con cinco textos válidos da eligibleCount = 5', () => {
  const preflight = core.buildPreflight(frame([
    text('Continuar'), text('Cancelar'), text('Tu visita fue confirmada'),
    text('¿Qué necesitas?'), text('Guardar cambios'),
  ]), 0);

  assert.equal(preflight.detectedCount, 5);
  assert.equal(preflight.eligibleCount, 5);
  assert.equal(preflight.skippedCount, 0);
});

test('03b: descubre textos en profundidad, dentro de frames anidados', () => {
  const preflight = core.buildPreflight(frame([
    text('Nivel 1'),
    container('Header', [
      text('Nivel 2'),
      container('Inner', [text('Nivel 3')]),
    ]),
  ]), 0);

  assert.equal(preflight.detectedCount, 3);
  assert.equal(preflight.eligibleCount, 3);
});

// --- 04..12 — clasificación determinista -------------------------------------

test('04: cadena vacía se omite por vacía', () => {
  assert.equal(classify(''), 'empty');
});

test('05: solo espacios en blanco se omite por vacía', () => {
  for (const blank of [' ', '\n', '\t', '   \n   ']) {
    assert.equal(classify(blank), 'empty', JSON.stringify(blank));
  }
});

test('06: solo números se omite', () => {
  for (const value of ['97540', '205', '14/50', '$1,250.00', '90%']) {
    assert.equal(classify(value), 'numeric_only', value);
  }
});

test('07 y 08: horas se omiten, con y sin sufijo', () => {
  for (const value of ['9:41', '9:41 p.m.', '12:30 p.m.', '9:41 a.m.']) {
    assert.equal(classify(value), 'numeric_only', value);
  }
});

test('09: solo un placeholder se omite como contenido dinámico', () => {
  assert.equal(classify('{{date}}'), 'protected_only');
  assert.equal(classify('{{firstName}}'), 'protected_only');
});

test('10: placeholder con emoji sigue siendo solo contenido dinámico', () => {
  assert.equal(classify('📅 {{date}}'), 'protected_only');
});

test('11: solo un correo se omite', () => {
  assert.equal(classify('alexis@example.com'), 'protected_only');
});

test('12: solo una URL se omite', () => {
  assert.equal(classify('https://productdesign.mx'), 'protected_only');
  assert.equal(classify('www.productdesign.mx'), 'protected_only');
});

test('13 y 14: lenguaje natural junto a un placeholder SÍ entra', () => {
  assert.equal(classify('Hola {{firstName}}'), 'ready');
  assert.equal(classify('Tu visita será {{date}}'), 'ready');
  assert.equal(classify('Consulta:\nhttps://productdesign.mx'), 'ready');
});

// --- 15..17 — visibilidad efectiva -------------------------------------------

test('15: un texto oculto se omite', () => {
  const preflight = core.buildPreflight(
    frame([text('Continuar', { visible: false })]), 0,
  );

  assert.equal(preflight.candidates[0].skipReason, 'hidden');
  assert.equal(preflight.eligibleCount, 0);
});

test('16: un texto visible con un ancestro oculto se omite', () => {
  const preflight = core.buildPreflight(frame([
    container('Oculto', [text('Continuar')], { visible: false }),
  ]), 0);

  assert.equal(preflight.candidates[0].skipReason, 'hidden');
});

test('16b: opacidad cero en un ancestro también oculta', () => {
  const preflight = core.buildPreflight(frame([
    container('Transparente', [text('Continuar')], { opacity: 0 }),
  ]), 0);

  assert.equal(preflight.candidates[0].skipReason, 'hidden');
});

test('17: el texto dentro de una instancia visible SÍ entra', () => {
  const preflight = core.buildPreflight(frame([
    container('Tarjeta', [text('Continuar')], { type: 'INSTANCE' }),
  ]), 0);

  assert.equal(preflight.eligibleCount, 1);
  assert.equal(preflight.candidates[0].parentName, 'Tarjeta');
});

test('17b: también dentro de un componente anidado', () => {
  const preflight = core.buildPreflight(frame([
    container('Botón', [text('Aceptar')], { type: 'COMPONENT' }),
  ]), 0);

  assert.equal(preflight.eligibleCount, 1);
});

// --- 18..21 — Unicode y no-lenguaje ------------------------------------------

test('18: el español acentuado entra sin problema', () => {
  for (const value of ['¿Qué pasó?', 'Contraseña', 'Préstamo', '¡Listo!',
    'No pudimos completar la solicitud.']) {
    assert.equal(classify(value), 'ready', value);
  }
});

test('19 y 20: palabras cortas válidas nunca se omiten por ser cortas', () => {
  for (const value of ['Sí', 'OK', 'No', 'Ver']) {
    assert.equal(classify(value), 'ready', value);
  }
});

test('21: contenido sin lenguaje se omite', () => {
  for (const value of ['---', '•••', '→', '✅', '🎉', '???']) {
    assert.equal(classify(value), 'non_language', value);
  }
});

test('21b: alto recall — ante la duda, entra', () => {
  // Un nombre propio podría ser dato de ejemplo, pero decidirlo exigiría
  // conocimiento semántico que no tenemos. Omitirlo sería el error caro.
  for (const value of ['Izamal', 'María', 'Yucatán', 'Banco']) {
    assert.equal(classify(value), 'ready', value);
  }
});

// --- 22..25 — fuente exacta --------------------------------------------------

test('22: candidate.text es idéntico a node.characters', () => {
  const sources = [
    'Continuar', '  espacios  ', 'con\ttab', 'ÁÉÍÓÚñü¿¡',
    'Tu visita será el {{Jueves 10 de abril}}', '🎉 Listo',
  ];
  const preflight = core.buildPreflight(frame(sources.map((s) => text(s))), 0);

  const stored = preflight.candidates.map((c) => c.text).sort();
  assert.deepEqual(stored, [...sources].sort());
});

test('23: el texto multilínea se conserva exactamente', () => {
  const source = 'Primera línea\n\nSegunda línea\n  Tercera con sangría';
  const preflight = core.buildPreflight(frame([text(source)]), 0);

  assert.equal(preflight.candidates[0].text, source);
  assert.equal(preflight.candidates[0].text.split('\n').length, 4);
});

test('24: los espacios dobles se conservan en la fuente', () => {
  const source = 'no  fue  posible';
  const preflight = core.buildPreflight(frame([text(source)]), 0);

  assert.equal(preflight.candidates[0].text, source);
  assert.ok(preflight.candidates[0].text.includes('  '));
});

test('25: los placeholders se conservan carácter por carácter', () => {
  const source = 'Tu visita será el {{Jueves 10 de abril de 2026}} a las {{6:00 p.m.}}.';
  const preflight = core.buildPreflight(frame([text(source)]), 0);

  assert.equal(preflight.candidates[0].text, source);
  assert.equal(preflight.candidates[0].status, 'ready');
});

test('25b: clasificar no altera la fuente ni siquiera al recortar', () => {
  const source = '   Continuar   ';
  const preflight = core.buildPreflight(frame([text(source)]), 0);

  assert.equal(preflight.candidates[0].text, source);
  assert.equal(preflight.candidates[0].status, 'ready');
});

// --- 26..28 — orden visual ---------------------------------------------------

test('26: se ordena por Y ascendente, no por orden del árbol', () => {
  const preflight = core.buildPreflight(frame([
    text('Abajo', { box: { x: 0, y: 300 } }),
    text('Arriba', { box: { x: 0, y: 10 } }),
    text('Medio', { box: { x: 0, y: 150 } }),
  ]), 0);

  assert.deepEqual(
    preflight.candidates.map((c) => c.text),
    ['Arriba', 'Medio', 'Abajo'],
  );
  assert.deepEqual(preflight.candidates.map((c) => c.order), [0, 1, 2]);
});

test('27: con la misma Y se ordena por X ascendente', () => {
  const preflight = core.buildPreflight(frame([
    text('Derecha', { box: { x: 200, y: 50 } }),
    text('Izquierda', { box: { x: 10, y: 50 } }),
    text('Centro', { box: { x: 100, y: 50 } }),
  ]), 0);

  assert.deepEqual(
    preflight.candidates.map((c) => c.text),
    ['Izquierda', 'Centro', 'Derecha'],
  );
});

test('28: sin geometría se conserva el orden de descubrimiento, sin romper', () => {
  const preflight = core.buildPreflight(frame([
    text('Primero', { box: null }),
    text('Segundo', { box: null }),
    text('Tercero', { box: null }),
  ]), 0);

  assert.deepEqual(
    preflight.candidates.map((c) => c.text),
    ['Primero', 'Segundo', 'Tercero'],
  );
});

test('28b: los nodos sin geometría van al final, sin perderse', () => {
  const preflight = core.buildPreflight(frame([
    text('Sin caja', { box: null }),
    text('Con caja', { box: { x: 0, y: 5 } }),
  ]), 0);

  assert.deepEqual(preflight.candidates.map((c) => c.text), ['Con caja', 'Sin caja']);
  assert.equal(preflight.detectedCount, 2, 'no se perdió ningún texto');
});

// --- contexto y contadores ---------------------------------------------------

test('el contexto se prepara con la forma acordada', () => {
  const preflight = core.buildPreflight(
    container('Domicilio', [
      container('Footer', [text('Continuar', { name: 'CTA' })]),
    ]), 0,
  );

  assert.equal(
    preflight.candidates[0].context,
    'Pantalla: Domicilio. Capa: CTA. Contenedor: Footer.',
  );
});

test('los contadores cuadran siempre', () => {
  const preflight = core.buildPreflight(frame([
    text('Continuar'), text(''), text('97540'), text('{{date}}'),
    text('✅'), text('Hola {{nombre}}'), text('Oculto', { visible: false }),
  ]), 0);

  assert.equal(preflight.detectedCount, 7);
  assert.equal(preflight.eligibleCount, 2);
  assert.equal(preflight.skippedCount, 5);
  assert.equal(
    preflight.eligibleCount + preflight.skippedCount,
    preflight.detectedCount,
  );
});

test('la prioridad de clasificación es determinista', () => {
  // Vacío gana a oculto.
  assert.equal(classify('   ', false), 'empty');
  // Oculto gana a cualquier motivo de contenido.
  assert.equal(classify('97540', false), 'hidden');
  assert.equal(classify('{{date}}', false), 'hidden');
});

test('los duplicados NO se eliminan: el mismo texto puede no ser equivalente', () => {
  const preflight = core.buildPreflight(frame([
    container('Pago', [text('Continuar')]),
    container('Registro', [text('Continuar')]),
  ]), 0);

  assert.equal(preflight.eligibleCount, 2, 'se eliminó un candidato duplicado');
  assert.equal(core.countExactRepeats(preflight), 1);
  assert.notEqual(
    preflight.candidates[0].context,
    preflight.candidates[1].context,
    'el contexto debe distinguirlos',
  );
});

// --- 35 — frontera de serialización ------------------------------------------

test('35: el preflight solo contiene datos planos y serializables', () => {
  const preflight = core.buildPreflight(frame([
    text('Continuar'), container('Header', [text('Título')]),
  ]), 7);

  // Si hubiera un nodo de Figma dentro, esto lanzaría o filtraría estructura.
  const roundTrip = JSON.parse(JSON.stringify(preflight));
  assert.deepEqual(roundTrip, preflight);

  for (const candidate of preflight.candidates) {
    assert.deepEqual(
      Object.keys(candidate).sort(),
      ['context', 'layerName', 'nodeId', 'order', 'parentName',
        'skipReason', 'status', 'text'].sort(),
    );
    for (const value of Object.values(candidate)) {
      assert.ok(
        ['string', 'number'].includes(typeof value) || value === null,
        'se serializó algo que no es un dato plano',
      );
    }
  }
});

test('el preflight pasa su propio validador y rechaza formas inválidas', () => {
  const preflight = core.buildPreflight(frame([text('Continuar')]), 3);

  assert.equal(core.isScreenAuditPreflight(preflight), true);
  assert.equal(core.isScreenAuditPreflight({ ...preflight, revision: -1 }), false);
  assert.equal(core.isScreenAuditPreflight({ ...preflight, candidates: [{}] }), false);
  assert.equal(core.isScreenAuditPreflight(null), false);
});

// --- presentación -------------------------------------------------------------

test('los motivos se muestran en lenguaje de producto, sin enumeraciones', () => {
  const reasons = ['empty', 'hidden', 'protected_only', 'numeric_only', 'non_language'];
  const labels = reasons.map((r) => core.describeSkipReason(r));

  assert.equal(new Set(labels).size, reasons.length, 'hay motivos con la misma copia');

  for (const label of labels) {
    assert.ok(label.length > 0);
    assert.doesNotMatch(label, /TextNode|FrameNode|payload|enum|node|runtime/iu);
    assert.doesNotMatch(label, /_/u, 'se filtró un valor de enumeración');
  }
});

test('el recorte de la vista previa es SOLO visual', () => {
  const source = 'a'.repeat(200);
  const preflight = core.buildPreflight(frame([text(source)]), 0);

  assert.equal(preflight.candidates[0].text.length, 200, 'se recortó la fuente');
  assert.ok(core.previewText(source).length <= core.PREVIEW_MAX_LENGTH);
});

test('el resumen no afirma que nada se haya resuelto ni analizado', () => {
  const preflight = core.buildPreflight(frame([
    text('Continuar'), text('97540'),
  ]), 0);
  const counts = core.describeCounts(preflight);

  assert.equal(counts.ready, '1 texto listo para auditar');
  assert.equal(counts.skipped, '1 omitido automáticamente');

  // En esta fase no se ha evaluado la calidad de ningún texto. Decir
  // «resueltos» o «no necesitan IA» sería mentir.
  for (const phrase of [counts.ready, counts.skipped]) {
    assert.doesNotMatch(phrase, /resuelt|analizad|sin ia|no necesitan/iu);
  }
});
