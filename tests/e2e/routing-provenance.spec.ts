/**
 * Procedencia del análisis en el DOM real (FASE 9.1.2).
 *
 * Aquí vive la regresión que motivó toda esta infraestructura: en 8.5.5.3 el
 * estado resolvía «nube» correctamente y la tarjeta de motor seguía pintando
 * «Local», porque `renderAnalysis` no repintaba la tarjeta. Las pruebas puras
 * no podían verlo: la decisión ya era correcta, fallaba el repintado.
 */
import { test, expect } from './fixtures/plugin-fixture';
import {
  GOOD_RESULT, TEXT_SELECTION, analysisFailed, analysisMode, analysisStarted,
  analysisSucceeded, apiKeyStatus, runtimeStatus, selection,
} from './fixtures/messages';

type Plugin = Parameters<Parameters<typeof test>[1]>[0]['plugin'];

/** Deja la UI lista para analizar y pulsa «Analizar texto». */
async function startAnalysis(plugin: Plugin, mode: 'auto' | 'cloud'): Promise<void> {
  await plugin.send(analysisMode(mode));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(TEXT_SELECTION));

  const analyze = plugin.ui.locator('#analyze-button');
  await expect(analyze).toBeEnabled();
  await analyze.click();
}

test('19: la carga local anuncia Local y «Procesando en esta Mac»', async ({ plugin }) => {
  await startAnalysis(plugin, 'auto');
  await plugin.send(analysisStarted('local'));

  await expect(plugin.ui.locator('#analysis-loading')).toBeVisible();
  await expect(plugin.ui.locator('#analysis-loading-engine'))
    .toHaveText('Procesando en esta Mac');
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Local');
});

test('20: la carga en la nube anuncia Nube y «Procesando en la nube»', async ({ plugin }) => {
  await startAnalysis(plugin, 'cloud');
  await plugin.send(analysisStarted('cloud'));

  await expect(plugin.ui.locator('#analysis-loading-engine'))
    .toHaveText('Procesando en la nube');
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Nube');
});

test('21: el retry explícito repinta la tarjeta a Nube al pulsarlo', async ({ plugin }) => {
  await startAnalysis(plugin, 'auto');
  await plugin.send(analysisStarted('local'));
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Local');

  await plugin.send(analysisFailed('LOCAL_ANALYSIS_TIMEOUT', true));
  await expect(plugin.ui.locator('#analysis-error-title'))
    .toHaveText('El análisis está tardando demasiado');

  // La tarjeta sigue diciendo Local: el fallo FUE local, y eso es verdad.
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Local');

  const cloudButton = plugin.ui.locator('#use-cloud-button');
  await expect(cloudButton).toBeVisible();
  await cloudButton.click();

  // Sin esperar respuesta: el repintado debe ocurrir en el clic.
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Nube');
  await expect(plugin.ui.locator('#analysis-loading-engine'))
    .toHaveText('Procesando en la nube');
});

test('22 OBLIGATORIA: un resultado de la nube sigue siendo Nube aunque el motor local vuelva', async ({ plugin }) => {
  await startAnalysis(plugin, 'auto');
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisFailed('LOCAL_ANALYSIS_TIMEOUT', true));

  await plugin.ui.locator('#use-cloud-button').click();
  await plugin.send(analysisStarted('cloud', 'analysis-2'));
  await plugin.send(analysisSucceeded(GOOD_RESULT, 'analysis-2'));

  await expect(plugin.ui.locator('#analysis-result')).toBeVisible();
  await expect(plugin.ui.locator('#engine-name')).toHaveText('Nube');

  // EL PUNTO EXACTO DE LA REGRESIÓN: llega un aviso de que el motor local ya
  // está listo. La ruta de la SIGUIENTE petición sería local, pero lo que se
  // está mirando lo procesó la nube y debe seguir diciéndolo.
  await plugin.send(runtimeStatus('ready'));

  await expect(plugin.ui.locator('#engine-name')).toHaveText('Nube');
  await expect(plugin.ui.locator('#engine-detail'))
    .toHaveText('Procesamiento mediante servicio en la nube');
});

test('«Reintentar local» conserva Local y no ofrece la nube por sí solo', async ({ plugin }) => {
  await startAnalysis(plugin, 'auto');
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisFailed('LOCAL_RUNTIME_UNAVAILABLE', true));

  const retry = plugin.ui.locator('#retry-analysis-button');
  await expect(retry).toHaveText('Reintentar local');
  await retry.click();

  await expect(plugin.ui.locator('#engine-name')).toHaveText('Local');

  await plugin.expectMessages('RETRY_LOCAL_ANALYSIS', 1);
  await plugin.expectMessages('USE_CLOUD_FOR_CURRENT_ANALYSIS', 0);
});

test('un fallo sin nube disponible NO ofrece la acción de nube', async ({ plugin }) => {
  await startAnalysis(plugin, 'auto');
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisFailed('LOCAL_RUNTIME_UNAVAILABLE', false));

  await expect(plugin.ui.locator('#cloud-retry-block')).toBeHidden();
});

test('el aviso de privacidad acompaña siempre a la acción de nube', async ({ plugin }) => {
  await startAnalysis(plugin, 'auto');
  await plugin.send(analysisStarted('local'));
  await plugin.send(analysisFailed('LOCAL_ANALYSIS_TIMEOUT', true));

  // Se acota al bloque de Text Audit: FASE 9.2B añadió otra nota equivalente
  // dentro del panel de auditoría de pantalla.
  await expect(plugin.ui.locator('#cloud-retry-block .cloud-retry-note'))
    .toHaveText('El contenido se enviará al servicio en la nube para realizar el análisis.');
});
