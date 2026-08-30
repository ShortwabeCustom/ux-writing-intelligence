/**
 * Flujo de Text Audit en el DOM real (FASE 9.1.2).
 */
import { test, expect } from './fixtures/plugin-fixture';
import {
  FRAME_SELECTION, GOOD_RESULT, RESULT_WITH_CHANGE, TEXT_SELECTION,
  analysisFailed, analysisMode, analysisStarted, analysisSucceeded,
  apiKeyStatus, applyBlocked, preflight, runtimeStatus, selection,
} from './fixtures/messages';

type Plugin = Parameters<Parameters<typeof test>[1]>[0]['plugin'];

async function analyze(plugin: Plugin): Promise<void> {
  await plugin.send(analysisMode('auto'));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(TEXT_SELECTION));
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('local'));
}

test('01: una capa de texto renderiza Text Audit', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(TEXT_SELECTION));

  await expect(plugin.ui.locator('#state-title')).toHaveText('Texto seleccionado');
  await expect(plugin.ui.locator('#selected-text')).toHaveText('prestamo');
  await expect(plugin.ui.locator('#analyze-button')).toBeEnabled();
  await expect(plugin.ui.locator('#screen-preflight')).toBeHidden();
});

test('el análisis publica ANALYZE_REQUEST hacia el hilo principal', async ({ plugin }) => {
  await analyze(plugin);

  await plugin.expectMessages('ANALYZE_REQUEST', 1);

  const requests = await plugin.receivedOfType('ANALYZE_REQUEST');
  expect(requests[0].selectionRevision).toBe(TEXT_SELECTION.revision);
});

test('23: un resultado sin cambios renderiza «No requiere cambios»', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection({ ...TEXT_SELECTION, text: GOOD_RESULT.text }));
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisSucceeded(GOOD_RESULT));

  await expect(plugin.ui.locator('#no-change-content')).toBeVisible();
  await expect(plugin.ui.locator('#no-change-content')).toContainText('No requiere cambios');
  await expect(plugin.ui.locator('#analysis-score')).toHaveText('100');
  // Sin cambios no hay nada que aplicar.
  await expect(plugin.ui.locator('#apply-suggestion-button')).toBeHidden();
});

test('un resultado con sugerencia la muestra y habilita Aplicar', async ({ plugin }) => {
  await analyze(plugin);
  await plugin.send(analysisSucceeded(RESULT_WITH_CHANGE));

  await expect(plugin.ui.locator('#analysis-suggestion')).toHaveText('préstamo');
  await expect(plugin.ui.locator('#analysis-orthography')).toHaveText('4/5');
  await expect(plugin.ui.locator('#apply-suggestion-button')).toBeEnabled();
});

test('24: los estilos mixtos avisan y bloquean Aplicar', async ({ plugin }) => {
  await analyze(plugin);
  await plugin.send(analysisSucceeded(RESULT_WITH_CHANGE));
  await plugin.send(applyBlocked('MIXED_STYLES_UNSUPPORTED'));

  await expect(plugin.ui.locator('#apply-local-feedback')).toBeVisible();
  await expect(plugin.ui.locator('#apply-suggestion-button')).toBeDisabled();

  const warning = await plugin.ui.locator('#apply-local-feedback').textContent();
  expect(warning).not.toMatch(/TextNode|payload|enum/iu);
});

test('25: un error de análisis renderiza su estado propio', async ({ plugin }) => {
  await analyze(plugin);
  await plugin.send(analysisFailed('SERVICE_UNAVAILABLE', false));

  await expect(plugin.ui.locator('#analysis-error')).toBeVisible();
  await expect(plugin.ui.locator('#analysis-error-title'))
    .toHaveText('El servicio no está disponible');
  await expect(plugin.ui.locator('#analysis-result')).toBeHidden();
});

test('la API Key no se presenta como requisito con el motor local activo', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(TEXT_SELECTION));

  await expect(plugin.ui.locator('#api-key-status-row')).toBeHidden();
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Local');
});

test('el modo Solo local muestra su promesa de privacidad', async ({ plugin }) => {
  await plugin.send(analysisMode('local'));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(TEXT_SELECTION));

  await expect(plugin.ui.locator('#engine-detail'))
    .toHaveText('Solo procesamiento en esta Mac');
  await expect(plugin.ui.locator('#api-key-status-row')).toBeHidden();
});

// --- red ---------------------------------------------------------------------

test('BLOQUEANTE: el preflight de pantalla no genera ninguna petición de análisis', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());

  await plugin.ui.locator('#screen-detected summary').click();
  await plugin.ui.locator('#screen-skipped summary').click();

  const analysisCalls = plugin.networkRequests().filter(
    (url) => url.includes('/v1/analyze/text'),
  );
  expect(analysisCalls).toHaveLength(0);

  const toLocal = plugin.networkRequests().filter((url) => url.includes('localhost:8787'));
  const toCloud = plugin.networkRequests().filter(
    (url) => url.includes('writing.productdesign.mx'),
  );
  expect(toLocal).toHaveLength(0);
  expect(toCloud).toHaveLength(0);

  // Y la interfaz tampoco pidió al hilo principal que analizara nada.
  await plugin.expectMessages('ANALYZE_REQUEST', 0);
  await plugin.expectMessages('RETRY_LOCAL_ANALYSIS', 0);
  await plugin.expectMessages('USE_CLOUD_FOR_CURRENT_ANALYSIS', 0);
});

test('toda la red de la suite se sirve desde disco: nada sale fuera', async ({ plugin }) => {
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(preflight());

  const external = plugin.networkRequests().filter(
    (url) => !url.startsWith('http://plugin.test/'),
  );
  expect(external).toHaveLength(0);
});
