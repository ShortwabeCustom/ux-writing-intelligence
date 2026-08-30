/**
 * Ejecución progresiva de Screen Audit en el DOM real (FASE 9.2B, STEP 33).
 *
 * La decisión de 9.2A fue no acelerar la auditoría sino hacer útil la espera.
 * Estas pruebas verifican precisamente eso: que el primer resultado aparezca
 * de inmediato y que la procedencia de cada uno diga la verdad.
 */
import { test, expect } from './fixtures/plugin-fixture';
import {
  AUDIT_CANDIDATES, FRAME_SELECTION, analysisMode, apiKeyStatus,
  auditPreflight, auditSession, auditUpdate, runtimeStatus, selection,
  withChanged, withFailure, withResult,
} from './fixtures/messages';

type Plugin = Parameters<Parameters<typeof test>[1]>[0]['plugin'];

async function readyToAudit(plugin: Plugin, mode: 'auto' | 'local' | 'cloud' = 'auto'): Promise<void> {
  await plugin.send(analysisMode(mode));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('ready'));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(auditPreflight());
}

const panel = (plugin: Plugin) => plugin.ui.locator('#screen-audit');
const results = (plugin: Plugin) => plugin.ui.locator('#screen-audit-results .audit-item');

// --- 1..3 — arranque ----------------------------------------------------------

test('01 y 02: el CTA arranca la auditoría y la pantalla pasa a estado en curso', async ({ plugin }) => {
  await readyToAudit(plugin);

  const cta = plugin.ui.locator('#audit-screen-button');
  await expect(cta).toBeEnabled();
  await cta.click();

  await plugin.expectMessages('START_SCREEN_AUDIT', 1);

  await plugin.send(auditUpdate(auditSession()));
  await expect(panel(plugin)).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-title')).toHaveText('Auditando pantalla');
  await expect(plugin.ui.locator('#screen-audit-frame')).toHaveText('Domicilio');

  // El preflight cede el sitio: repetir sus conteos con otro significado
  // confundiría.
  await expect(plugin.ui.locator('#screen-preflight')).toBeHidden();
});

test('03: al comenzar no hay ningún resultado', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(auditSession()));

  await expect(plugin.ui.locator('#screen-audit-progress')).toHaveText('0 de 3 analizados');
  await expect(results(plugin)).toHaveCount(0);
});

// --- 4..8 — entrega progresiva ------------------------------------------------

test('04 BLOQUEANTE: el primer resultado se pinta sin esperar al resto', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  await plugin.send(auditUpdate(session));

  session = withResult(session, 0, 'local');
  await plugin.send(auditUpdate(session));

  await expect(results(plugin)).toHaveCount(1);
  await expect(plugin.ui.locator('#screen-audit-progress')).toHaveText('1 de 3 analizados');
  // La auditoría sigue en marcha: el resultado no esperó al final.
  await expect(plugin.ui.locator('#screen-audit-title')).toHaveText('Auditando pantalla');
});

test('05 y 06: cada resultado se suma sin borrar los anteriores, en orden visual', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  await plugin.send(auditUpdate(session));

  session = withResult(session, 0, 'local');
  await plugin.send(auditUpdate(session));
  session = withResult(session, 1, 'local');
  await plugin.send(auditUpdate(session));

  await expect(results(plugin)).toHaveCount(2);

  const layers = await plugin.ui.locator('.audit-item-layer').allTextContents();
  expect(layers).toEqual([
    AUDIT_CANDIDATES[0].layerName,
    AUDIT_CANDIDATES[1].layerName,
  ]);
});

test('07: el candidato en curso avanza del 1 al 2', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-current'))
    .toContainText(AUDIT_CANDIDATES[0].text);

  session = withResult(session, 0, 'local');
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-current'))
    .toContainText(AUDIT_CANDIDATES[1].text);
});

test('08: el progreso es un conteo real, nunca una estimación de tiempo', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  await plugin.send(auditUpdate(session));

  for (const expected of ['1 de 3 analizados', '2 de 3 analizados']) {
    session = withResult(session, session.currentIndex, 'local');
    await plugin.send(auditUpdate(session));
    await expect(plugin.ui.locator('#screen-audit-progress')).toHaveText(expected);
  }

  const text = await panel(plugin).textContent();
  expect(text).not.toMatch(/%|casi|estimad|quedan \d+ segundos|minutos restantes/iu);
});

// --- 9, 10 — cierre -----------------------------------------------------------

test('09: la auditoría completada lo dice con conteos verdaderos', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  for (let index = 0; index < 3; index += 1) {
    session = withResult(session, index, 'local');
  }
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-title')).toHaveText('Auditoría completada');
  await expect(plugin.ui.locator('#screen-audit-progress'))
    .toHaveText('3 de 3 textos revisados');
  await expect(results(plugin)).toHaveCount(3);
  await expect(plugin.ui.locator('#screen-audit-current')).toHaveText('');
});

test('10 BLOQUEANTE: no aparece ninguna puntuación global de pantalla', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withResult(session, 0, 'local', 96);
  session = withResult(session, 1, 'local', 80);
  session = withResult(session, 2, 'local', 64);
  await plugin.send(auditUpdate(session));

  const text = await panel(plugin).textContent();
  // Promediar textos distintos no significaría nada y requiere su propia
  // definición de producto.
  expect(text).not.toMatch(/Pantalla \d+\/100|puntuación global|score de pantalla/iu);
  expect(text).toContain('96/100');
  expect(text).toContain('80/100');
  expect(text).toContain('64/100');
});

// --- 11..15 — procedencia por elemento ----------------------------------------

test('11 y 12: cada resultado muestra el motor que lo produjo', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withResult(session, 0, 'local');
  session = withResult(session, 1, 'cloud');
  await plugin.send(auditUpdate(session));

  const metas = await plugin.ui.locator('.audit-item-meta').allTextContents();
  expect(metas[0]).toContain('Local');
  expect(metas[1]).toContain('Nube');
});

test('13 BLOQUEANTE: los resultados locales siguen siendo locales tras pasar a la nube', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withResult(session, 0, 'local');
  await plugin.send(auditUpdate(session));

  session = withFailure(session, 1, true);
  await plugin.send(auditUpdate(session));

  await plugin.ui.locator('#screen-audit-continue-cloud').click();
  await plugin.expectMessages('CONTINUE_SCREEN_AUDIT_CLOUD', 1);

  // El hilo principal responde primero con el candidato fallido reintentándose
  // en la nube. Todavía no es éxito y el resultado local previo no se repinta.
  session = {
    ...session,
    status: 'running',
    executionTransport: 'cloud',
    failed: 0,
    cloudContinuationAvailable: false,
    items: session.items.map((item, index) => index === 1
      ? { ...item, status: 'pending' as const, transport: null, error: null }
      : item),
  };
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-current'))
    .toContainText(AUDIT_CANDIDATES[1].text);
  await expect(plugin.ui.locator('#screen-audit-engine'))
    .toHaveText('Procesamiento mediante servicio en la nube');
  await expect(plugin.ui.locator('.audit-item-meta').first()).toContainText('Local');

  // Después, el actual y los pendientes se resuelven en la nube.
  session = withResult(session, 1, 'cloud');
  session = withResult(session, 2, 'cloud');
  await plugin.send(auditUpdate(session));

  const metas = await plugin.ui.locator('.audit-item-meta').allTextContents();
  expect(metas[0]).toContain('Local');
  expect(metas[1]).toContain('Nube');
  expect(metas[2]).toContain('Nube');
});

test('15 BLOQUEANTE: un aviso posterior de motor listo NO repinta resultados de nube', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession({ executionTransport: 'cloud' });
  session = withResult(session, 0, 'cloud');
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('.audit-item-meta').first()).toContainText('Nube');

  // El motor local vuelve a estar disponible: la ruta de la SIGUIENTE
  // auditoría cambiaría, pero lo que se está mirando lo procesó la nube.
  await plugin.send(runtimeStatus('ready'));

  await expect(plugin.ui.locator('.audit-item-meta').first()).toContainText('Nube');
});

// --- 17..21 — obsolescencia, pausa y recuperación -----------------------------

test('17: un texto que cambió se muestra como cambiado, no como analizado', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withResult(session, 0, 'local');
  session = withChanged(session, 1);
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-progress')).toHaveText('1 de 3 analizados');
  await expect(plugin.ui.locator('#screen-audit-changed'))
    .toHaveText('1 cambió durante la auditoría');
  await expect(plugin.ui.locator('.audit-item').nth(1))
    .toContainText('El texto cambió durante la auditoría');
});

test('18 y 19 BLOQUEANTE: un fallo local pausa y no avanza al siguiente', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withResult(session, 0, 'local');
  session = withFailure(session, 1, true);
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-paused')).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-title')).toHaveText('Auditoría en pausa');
  await expect(plugin.ui.locator('#screen-audit-progress')).toHaveText('1 de 3 analizados');

  // El primero conserva su resultado y el segundo conserva el contexto del
  // fallo. El tercero sigue pendiente: no aparece ni se anuncia como actual.
  await expect(results(plugin)).toHaveCount(2);
  await expect(results(plugin).nth(0)).toContainText(AUDIT_CANDIDATES[0].layerName);
  await expect(results(plugin).nth(0).locator('.audit-item-meta')).toContainText('Local');
  await expect(results(plugin).nth(1)).toContainText(AUDIT_CANDIDATES[1].layerName);
  await expect(results(plugin).nth(1)).toContainText('No se pudo analizar');
  await expect(results(plugin).nth(1).locator('.audit-item-meta')).toContainText('Local');
  await expect(results(plugin).filter({ hasText: AUDIT_CANDIDATES[2].text })).toHaveCount(0);
  await expect(plugin.ui.locator('#screen-audit-current'))
    .toContainText(AUDIT_CANDIDATES[1].text);

  await expect(plugin.ui.locator('#screen-audit-retry-local')).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-continue-cloud')).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-title')).not.toHaveText('Auditoría completada');
});

test('20: continuar en la nube se ofrece con su aviso y envía la acción', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withFailure(session, 0, true);
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-cloud-block')).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-cloud-block .cloud-retry-note'))
    .toHaveText('Los textos pendientes se enviarán al servicio en la nube.');

  await plugin.ui.locator('#screen-audit-retry-local').click();
  await plugin.expectMessages('RETRY_SCREEN_AUDIT_LOCAL', 1);
  await plugin.expectMessages('CONTINUE_SCREEN_AUDIT_CLOUD', 0);
});

test('21 BLOQUEANTE: en Solo local un fallo NUNCA ofrece la nube', async ({ plugin }) => {
  await readyToAudit(plugin, 'local');
  let session = auditSession();
  session = withResult(session, 0, 'local');
  // El hilo principal nunca marca la continuación como disponible en este modo.
  session = withFailure(session, 1, false);
  await plugin.send(auditUpdate(session));

  await expect(plugin.ui.locator('#screen-audit-paused')).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-cloud-block')).toBeHidden();
  await expect(plugin.ui.locator('#screen-audit-retry-local')).toBeVisible();
  await expect(results(plugin)).toHaveCount(2);
  await expect(results(plugin).nth(1)).toContainText('No se pudo analizar');
  await expect(results(plugin).nth(1).locator('.audit-item-meta')).toContainText('Local');
  await expect(plugin.ui.locator('#screen-audit-current'))
    .toContainText(AUDIT_CANDIDATES[1].text);
});

// --- 16, 22..25 — invalidación, bloqueo y lenguaje ----------------------------

test('16: invalidar la auditoría retira su estado de la pantalla', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(withResult(auditSession(), 0, 'local')));
  await expect(panel(plugin)).toBeVisible();

  await plugin.send({
    type: 'SCREEN_AUDIT_INVALIDATED', payload: { sessionId: 'screen-1' },
  });

  await expect(panel(plugin)).toBeHidden();
});

test('22: en Solo nube sin clave el CTA queda bloqueado', async ({ plugin }) => {
  await plugin.send(analysisMode('cloud'));
  await plugin.send(apiKeyStatus(false));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(auditPreflight());

  await expect(plugin.ui.locator('#audit-screen-button')).toBeDisabled();
});

test('23: AUTO con local caído anuncia la nube ANTES de auditar', async ({ plugin }) => {
  await plugin.send(analysisMode('auto'));
  await plugin.send(apiKeyStatus(true));
  await plugin.send(runtimeStatus('unavailable', null));
  await plugin.send(selection(FRAME_SELECTION));
  await plugin.send(auditPreflight());

  await expect(plugin.ui.locator('#audit-screen-button')).toBeEnabled();

  // Y al arrancar, el panel declara el motor sin sorpresas.
  await plugin.send(auditUpdate(auditSession({ executionTransport: 'cloud' })));
  await expect(plugin.ui.locator('#screen-audit-engine'))
    .toHaveText('Procesamiento mediante servicio en la nube');
});

test('23b: una auditoría local declara que se procesa en esta Mac', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(auditSession()));

  await expect(plugin.ui.locator('#screen-audit-engine'))
    .toHaveText('Procesado en esta Mac');
});

test('24: la fuente larga se recorta solo visualmente', async ({ plugin }) => {
  const longText = `Este texto es deliberadamente largo ${'y '.repeat(80)}final`;
  await readyToAudit(plugin);

  const session = auditSession();
  session.items[0].candidate = { ...session.items[0].candidate, text: longText };
  await plugin.send(auditUpdate(withResult(session, 0, 'local')));

  const preview = await plugin.ui.locator('.audit-item-preview').first().textContent();
  expect(preview!.length).toBeLessThan(longText.length);
  expect(preview!.endsWith('…')).toBe(true);
});

test('25: no se muestra ningún identificador técnico', async ({ plugin }) => {
  await readyToAudit(plugin);
  let session = auditSession();
  session = withResult(session, 0, 'local');
  session = withFailure(session, 1, true);
  await plugin.send(auditUpdate(session));

  const text = await panel(plugin).textContent();
  expect(text).not.toMatch(/screen-1|n0|n1|f1|sessionId|requestId|nodeId/u);
  expect(text).not.toMatch(/TextNode|FrameNode|payload|LOCAL_RUNTIME_UNAVAILABLE/u);
});
