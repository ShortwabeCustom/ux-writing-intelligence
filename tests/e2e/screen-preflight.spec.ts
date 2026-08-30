/**
 * Preflight de Screen Audit en el DOM real (FASE 9.1.2).
 */
import { test, expect } from './fixtures/plugin-fixture';
import {
  FRAME_SELECTION, apiKeyStatus, analysisMode, preflight,
  runtimeStatus, selection,
} from './fixtures/messages';

async function selectFrame(plugin: Parameters<Parameters<typeof test>[1]>[0]['plugin']): Promise<void> {
  await plugin.send(analysisMode('auto'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());
}

test('02 y 03: un frame renderiza el estado de pantalla con su nombre', async ({ plugin }) => {
  await selectFrame(plugin);

  await expect(plugin.ui.locator('#state-title')).toHaveText('Pantalla seleccionada');
  await expect(plugin.ui.locator('#screen-preflight')).toBeVisible();
  await expect(plugin.ui.locator('#screen-name')).toHaveText('Domicilio');
});

test('04 y 05: los contadores de listos y omitidos se renderizan', async ({ plugin }) => {
  await selectFrame(plugin);

  await expect(plugin.ui.locator('#screen-ready-count'))
    .toHaveText('2 textos listos para auditar');
  await expect(plugin.ui.locator('#screen-skipped-count'))
    .toHaveText('3 omitidos automáticamente');
});

test('el resumen no afirma que nada se haya analizado ni resuelto', async ({ plugin }) => {
  await selectFrame(plugin);

  const summary = [
    await plugin.ui.locator('#screen-ready-count').textContent(),
    await plugin.ui.locator('#screen-skipped-count').textContent(),
  ].join(' ');

  expect(summary).not.toMatch(/resuelt|analizad|sin IA|no necesitan/iu);
});

test('06 y 07: «Ver textos detectados» despliega los candidatos listos', async ({ plugin }) => {
  await selectFrame(plugin);

  const list = plugin.ui.locator('#screen-detected-list');
  await expect(list).toBeHidden();

  await plugin.ui.locator('#screen-detected summary').click();

  await expect(list).toBeVisible();
  await expect(list.locator('.screen-item')).toHaveCount(2);
  await expect(list).toContainText('Tu visita ha sido confirmada');
  await expect(list).toContainText('Continuar');
  await expect(list).toContainText('CTA');
});

test('08: la fuente larga se recorta SOLO visualmente', async ({ plugin }) => {
  const longText = `Este es un texto muy largo que describe con todo detalle ${'x'.repeat(120)}`;

  await plugin.send(analysisMode('auto'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight({
    detectedCount: 1,
    eligibleCount: 1,
    skippedCount: 0,
    candidates: [{
      nodeId: 'n1', text: longText, layerName: 'Cuerpo', parentName: null,
      order: 0, status: 'ready', skipReason: null, context: 'Pantalla: Domicilio.',
    }],
  }));

  await plugin.ui.locator('#screen-detected summary').click();
  const preview = await plugin.ui.locator('.screen-item-preview').first().textContent();

  expect(preview!.length).toBeLessThan(longText.length);
  expect(preview!.endsWith('…')).toBe(true);
});

test('09 y 10: los omitidos muestran motivos en lenguaje de producto', async ({ plugin }) => {
  await selectFrame(plugin);

  await plugin.ui.locator('#screen-skipped summary').click();
  const list = plugin.ui.locator('#screen-skipped-list');

  await expect(list.locator('.screen-item')).toHaveCount(3);
  await expect(list).toContainText('Solo contiene números o valores');
  await expect(list).toContainText('Solo contiene contenido dinámico');
  await expect(list).toContainText('Texto oculto');

  // Nunca valores de enumeración ni vocabulario técnico.
  const text = await list.textContent();
  expect(text).not.toMatch(/numeric_only|protected_only|hidden|TextNode|node/u);
});

test('15: el CTA se habilita cuando hay una ruta de análisis inicial', async ({ plugin }) => {
  // FASE 9.2B lo vuelve funcional a propósito: en 9.1 estaba deshabilitado
  // porque no había motor de ejecución.
  await plugin.send(analysisMode('auto'));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());

  await expect(plugin.ui.locator('#audit-screen-button')).toBeEnabled();
});

test('16: sin ruta de análisis el CTA queda deshabilitado', async ({ plugin }) => {
  await plugin.send(analysisMode('local'));
  await plugin.send(runtimeStatus('unavailable', null));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());

  await expect(plugin.ui.locator('#audit-screen-button')).toBeDisabled();
  // Pero el preflight sigue mostrándose: no depende de ningún motor.
  await expect(plugin.ui.locator('#screen-ready-count'))
    .toHaveText('2 textos listos para auditar');
});

test('16b: una pantalla sin candidatos listos no habilita el CTA', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight({
    detectedCount: 0, eligibleCount: 0, skippedCount: 0, candidates: [],
  }));

  await expect(plugin.ui.locator('#audit-screen-button')).toBeDisabled();
});

test('17: el motor local apagado NO oculta el preflight', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(runtimeStatus('unavailable', null));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());

  await expect(plugin.ui.locator('#screen-preflight')).toBeVisible();
  await expect(plugin.ui.locator('#screen-ready-count'))
    .toHaveText('2 textos listos para auditar');
});

test('18: sin API Key el preflight se renderiza igual', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(apiKeyStatus(false));
  await plugin.send(runtimeStatus('unavailable', null));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());

  await expect(plugin.ui.locator('#screen-preflight')).toBeVisible();
  await expect(plugin.ui.locator('#screen-name')).toHaveText('Domicilio');
});

test('la fila de motor se oculta en una pantalla: todavía no hay análisis', async ({ plugin }) => {
  await selectFrame(plugin);

  await expect(plugin.ui.locator('#engine-row')).toBeHidden();
});

test('un preflight invalidado deja de mostrar los conteos anteriores', async ({ plugin }) => {
  await selectFrame(plugin);
  await expect(plugin.ui.locator('#screen-ready-count'))
    .toHaveText('2 textos listos para auditar');

  await plugin.send({
    type: 'SCREEN_PREFLIGHT_INVALIDATED', payload: { revision: 9 },
  });

  await expect(plugin.ui.locator('#screen-ready-count'))
    .toHaveText('Leyendo el contenido de la pantalla…');
});

test('un frame sin textos NO se confunde con una selección no soportada', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight({
    detectedCount: 0, eligibleCount: 0, skippedCount: 0, candidates: [],
  }));

  await expect(plugin.ui.locator('#screen-ready-count'))
    .toHaveText('Esta pantalla no contiene textos.');
  await expect(plugin.ui.locator('#state-title')).toHaveText('Pantalla seleccionada');
});
