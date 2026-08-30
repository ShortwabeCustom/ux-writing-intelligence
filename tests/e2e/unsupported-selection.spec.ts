/**
 * Copia de selección no soportada en el DOM real (FASE 9.1.2).
 *
 * El defecto de 9.1.1 —«Esta capa no contiene texto» ante una instancia que sí
 * tenía texto dentro— solo se descubrió abriendo Figma. Estas pruebas lo
 * hacen verificable.
 */
import { test, expect } from './fixtures/plugin-fixture';
import {
  FRAME_SELECTION, MULTIPLE_SELECTION, analysisMode, preflight,
  selection, unsupportedSelection,
} from './fixtures/messages';

const UNSUPPORTED_TITLE = 'Esta selección no se puede auditar';
const UNSUPPORTED_BODY =
  'Selecciona una capa de texto para analizarla o un Frame para revisar su contenido.';

for (const nodeType of ['GROUP', 'INSTANCE', 'SECTION', 'COMPONENT']) {
  test(`11 y 12: ${nodeType} renderiza la guía correcta`, async ({ plugin }) => {
    await plugin.send(analysisMode('auto'));
    await plugin.send(selection(unsupportedSelection(nodeType, 'Input Datepicker')));

    await expect(plugin.ui.locator('#state-title')).toHaveText(UNSUPPORTED_TITLE);
    await expect(plugin.ui.locator('#state-description')).toHaveText(UNSUPPORTED_BODY);
    await expect(plugin.ui.locator('#state-eyebrow')).toHaveText('Input Datepicker');
  });
}

test('05 BLOQUEANTE: la copia NO afirma que no haya texto dentro', async ({ plugin }) => {
  // Una instancia puede contener mucho texto visible. Decir lo contrario es
  // falso, y fue exactamente lo que se encontró en Figma real.
  await plugin.send(selection(unsupportedSelection('INSTANCE', 'Input Datepicker')));

  const rendered = await plugin.ui.locator('#state-panel').textContent();
  expect(rendered).not.toMatch(/no contiene texto/iu);
});

test('13: una raíz no soportada NO renderiza el estado de pantalla', async ({ plugin }) => {
  await plugin.send(selection(unsupportedSelection('GROUP', 'Grupo')));

  await expect(plugin.ui.locator('#state-title')).not.toHaveText('Pantalla seleccionada');
  await expect(plugin.ui.locator('#screen-preflight')).toBeHidden();
});

test('13b: un preflight anterior no sobrevive a una raíz no soportada', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());
  await expect(plugin.ui.locator('#screen-preflight')).toBeVisible();

  await plugin.send({ type: 'SCREEN_PREFLIGHT_INVALIDATED', payload: { revision: 9 } });
  await plugin.send(selection(unsupportedSelection('INSTANCE', 'Tarjeta')));

  await expect(plugin.ui.locator('#screen-preflight')).toBeHidden();
  await expect(plugin.ui.locator('#state-title')).toHaveText(UNSUPPORTED_TITLE);
});

test('14: la selección múltiple conserva su guía propia', async ({ plugin }) => {
  await plugin.send(selection(MULTIPLE_SELECTION));

  await expect(plugin.ui.locator('#state-title')).toHaveText('Selecciona una sola capa');
  await expect(plugin.ui.locator('#state-eyebrow')).toHaveText('3 capas seleccionadas');
  await expect(plugin.ui.locator('#screen-preflight')).toBeHidden();
});

test('los estados de selección no se colapsan entre sí', async ({ plugin }) => {
  const titles: string[] = [];

  for (const message of [
    selection(unsupportedSelection('GROUP', 'G')),
    selection({ status: 'empty-text', revision: 5, nodeId: 'n', nodeName: 'N', text: ' ' }),
    selection(MULTIPLE_SELECTION),
    selection({ status: 'no-selection', revision: 6 }),
  ]) {
    await plugin.send(message);
    titles.push((await plugin.ui.locator('#state-title').textContent()) ?? '');
  }

  expect(new Set(titles).size).toBe(titles.length);
  expect(titles[1]).toBe('Este texto está vacío');
});

test('la copia no expone vocabulario técnico', async ({ plugin }) => {
  await plugin.send(selection(unsupportedSelection('INSTANCE', 'Tarjeta')));

  const rendered = await plugin.ui.locator('#state-panel').textContent();
  expect(rendered).not.toMatch(/TextNode|FrameNode|InstanceNode|payload|enum/iu);
});
