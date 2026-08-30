/**
 * Regresión visual acotada (FASE 9.1.2).
 *
 * Solo unos pocos estados estables y de alto valor. Las aserciones semánticas
 * van primero; las capturas son secundarias, porque un cambio de píxel
 * legítimo no debería romper la suite entera.
 */
import { test, expect } from './fixtures/plugin-fixture';
import {
  FRAME_SELECTION, RESULT_WITH_CHANGE, TEXT_SELECTION,
  analysisMode, analysisStarted, analysisSucceeded, apiKeyStatus,
  applyBlocked, preflight, runtimeStatus, selection, unsupportedSelection,
} from './fixtures/messages';

type Plugin = Parameters<Parameters<typeof test>[1]>[0]['plugin'];

async function ready(plugin: Plugin, mode: 'auto' | 'cloud' = 'auto'): Promise<void> {
  await plugin.send(analysisMode(mode));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(TEXT_SELECTION));
}

const panel = (plugin: Plugin) => plugin.ui.locator('#state-panel');

test('visual: Text Audit listo', async ({ plugin }) => {
  await ready(plugin);
  await expect(panel(plugin)).toHaveScreenshot('text-audit-listo.png');
});

test('visual: preflight de pantalla', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());
  await expect(panel(plugin)).toHaveScreenshot('preflight-pantalla.png');
});

test('visual: selección no soportada', async ({ plugin }) => {
  await plugin.send(selection(unsupportedSelection('INSTANCE', 'Input Datepicker')));
  await expect(panel(plugin)).toHaveScreenshot('seleccion-no-soportada.png');
});

test('visual: carga local', async ({ plugin }) => {
  await ready(plugin);
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('local'));
  await expect(panel(plugin)).toHaveScreenshot('carga-local.png');
});

test('visual: carga en la nube', async ({ plugin }) => {
  await ready(plugin, 'cloud');
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('cloud'));
  await expect(panel(plugin)).toHaveScreenshot('carga-nube.png');
});

test('visual: resultado con sugerencia', async ({ plugin }) => {
  await ready(plugin);
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisSucceeded(RESULT_WITH_CHANGE));
  await expect(panel(plugin)).toHaveScreenshot('resultado.png');
});

test('visual: aviso de estilos mixtos', async ({ plugin }) => {
  await ready(plugin);
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisSucceeded(RESULT_WITH_CHANGE));
  await plugin.send(applyBlocked('MIXED_STYLES_UNSUPPORTED'));
  await expect(panel(plugin)).toHaveScreenshot('estilos-mixtos.png');
});
