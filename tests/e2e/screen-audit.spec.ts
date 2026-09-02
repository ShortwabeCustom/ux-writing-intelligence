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
  analysisStarted, analysisSucceeded, auditPreflight, auditSession, auditUpdate,
  runtimeStatus, selection,
  TEXT_SELECTION, RESULT_WITH_CHANGE,
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

  await expect(plugin.ui.locator('#screen-audit .audit-scope-label'))
    .toHaveText('Evaluación en contexto');
  await expect(plugin.ui.locator('#screen-audit .audit-scope-explanation'))
    .toHaveText('Considera cómo funciona este texto dentro de la pantalla y junto al contenido que lo rodea.');
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
  await expect(plugin.ui.locator('.audit-item-scope')).toHaveCount(0);
  await expect(plugin.ui.locator('.audit-item-severity').first()).toHaveText('Buen nivel');
  await expect(plugin.ui.locator('.audit-item-provenance').first()).toHaveText('Local');
  await expect(plugin.ui.locator('.audit-item').first())
    .toHaveAttribute('aria-label', /Evaluación en contexto/u);
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
  await expect(results(plugin).nth(1).locator('.audit-item-provenance')).toHaveText('Local');
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
  await expect(results(plugin).nth(1).locator('.audit-item-provenance')).toHaveText('Local');
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

function completedMixedSession() {
  let session = auditSession();
  session = withResult(session, 0, 'local', 96);
  session = withResult(session, 1, 'cloud', 72);
  session = withResult(session, 2, 'local', 48);
  session.items[1]!.result = { ...session.items[1]!.result!, severity: 'medium' };
  session.items[2]!.result = { ...session.items[2]!.result!, severity: 'high' };
  return session;
}

test('26: resumen y filtro por defecto priorizan atención sin score global', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(completedMixedSession()));

  await expect(plugin.ui.locator('#screen-audit-reviewed-count')).toHaveText('3 textos revisados');
  await expect(plugin.ui.locator('#screen-audit-attention-count')).toHaveText('2 necesitan atención');
  await expect(plugin.ui.locator('#screen-audit-good-count')).toHaveText('1 en buen nivel');
  await expect(plugin.ui.locator('[data-filter="attention"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(results(plugin)).toHaveCount(2);

  const text = await panel(plugin).textContent();
  expect(text).not.toMatch(/score global|quality score|screen score|\d+(?:\.\d+)?\/100 de pantalla/iu);
});

test('27: card accesible navega, queda activa y no altera procedencia', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(completedMixedSession()));

  const first = results(plugin).first();
  await expect(first).toHaveAttribute('aria-label', /Ver en pantalla/u);
  await expect(first).toContainText('Ver en pantalla');
  await first.click();
  await plugin.expectMessages('SCREEN_AUDIT_NAVIGATE_TO_ITEM', 1);

  const messages = await plugin.receivedOfType('SCREEN_AUDIT_NAVIGATE_TO_ITEM');
  expect(messages[0]).toMatchObject({
    auditSessionId: 'screen-1', candidateId: AUDIT_CANDIDATES[1].nodeId,
  });
  await expect(first).toHaveAttribute('data-active', 'true');
  await expect(first.locator('.audit-item-meta').first()).toContainText('Nube');
});

test('28: Anterior/Siguiente recorren solo el filtro y respetan límites', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(completedMixedSession()));

  await expect(plugin.ui.locator('#screen-audit-previous')).toBeDisabled();
  await expect(plugin.ui.locator('#screen-audit-next')).toBeEnabled();
  await plugin.ui.locator('#screen-audit-next').click();
  await plugin.expectMessages('SCREEN_AUDIT_NAVIGATE_TO_ITEM', 1);
  await expect(plugin.ui.locator('#screen-audit-next')).toBeDisabled();
  await expect(plugin.ui.locator('#screen-audit-previous')).toBeEnabled();
  await expect(plugin.ui.locator('#screen-audit-active-position')).toContainText('2 de 2 con atención');

  await plugin.ui.locator('#screen-audit-previous').click();
  await plugin.expectMessages('SCREEN_AUDIT_NAVIGATE_TO_ITEM', 2);
  const messages = await plugin.receivedOfType('SCREEN_AUDIT_NAVIGATE_TO_ITEM');
  expect(messages.map((message) => message.candidateId)).toEqual([
    AUDIT_CANDIDATES[2].nodeId,
    AUDIT_CANDIDATES[1].nodeId,
  ]);
});

test('29: cambiar filtro actualiza activo en UI sin navegar canvas', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(completedMixedSession()));
  await plugin.ui.locator('[data-filter="good"]').click();

  await plugin.expectMessages('SCREEN_AUDIT_NAVIGATE_TO_ITEM', 0);
  await expect(results(plugin)).toHaveCount(1);
  await expect(results(plugin).first()).toContainText(AUDIT_CANDIDATES[0].layerName);
  await expect(results(plugin).first()).toHaveAttribute('data-active', 'true');
});

test('30: estados cambiado y eliminado conservan resultado y procedencia', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(completedMixedSession()));

  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATION_RESULT',
    payload: {
      sessionId: 'screen-1', candidateId: AUDIT_CANDIDATES[1].nodeId,
      state: 'changed_since_audit',
    },
  });
  const changed = plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[1].nodeId}"]`);
  await expect(changed).toContainText('Este texto cambió desde la auditoría.');
  await expect(changed).toContainText('Resultado histórico');
  await expect(changed).toContainText('72/100');
  await expect(changed.locator('.audit-item-provenance')).toHaveText('Nube');

  await plugin.send({
    type: 'SCREEN_AUDIT_NAVIGATION_RESULT',
    payload: {
      sessionId: 'screen-1', candidateId: AUDIT_CANDIDATES[2].nodeId,
      state: 'deleted',
    },
  });
  const deleted = plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[2].nodeId}"]`);
  await expect(deleted).toContainText('Este texto ya no está disponible.');
  await expect(deleted).toContainText('48/100');
  await expect(deleted.locator('.audit-item-provenance')).toHaveText('Local');
});

test('31: fallo durante Screen Audit usa copy de interrupción', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(withFailure(auditSession(), 0, true)));
  await expect(plugin.ui.locator('#screen-audit-paused-message'))
    .toContainText('El análisis local se interrumpió.');
});

test('32: Frame eliminado muestra estado claro y deshabilita navegación', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(auditUpdate(completedMixedSession()));
  await plugin.send({
    type: 'SCREEN_AUDIT_FRAME_UNAVAILABLE', payload: { sessionId: 'screen-1' },
  });

  await expect(plugin.ui.locator('#screen-audit-frame-unavailable')).toBeVisible();
  await expect(plugin.ui.locator('#screen-audit-next')).toBeDisabled();
  await expect(results(plugin).first()).toBeDisabled();
});

function restoredScreenMessage(
  filter: 'all' | 'attention' | 'good' = 'attention',
  activeCandidateId: string | null = AUDIT_CANDIDATES[2].nodeId,
  navigationStates: Record<string, 'current' | 'changed_since_audit' | 'deleted'> = {},
) {
  const session = completedMixedSession();
  return {
    type: 'SCREEN_AUDIT_RESTORED',
    payload: {
      snapshot: {
        frameId: session.frameId,
        frameName: session.frameName,
        session,
        completedAt: 100,
        review: { filter, activeCandidateId, navigationStates },
      },
    },
  } as const;
}

test('33: Screen restore recupera resultados, filtro y activo sin loading ni navegación', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(restoredScreenMessage());

  await expect(panel(plugin)).toBeVisible();
  await expect(results(plugin)).toHaveCount(2);
  await expect(plugin.ui.locator('[data-filter="attention"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[2].nodeId}"]`))
    .toHaveAttribute('data-active', 'true');
  await expect(plugin.ui.locator('#analysis-loading')).toBeHidden();
  await plugin.expectMessages('SCREEN_AUDIT_NAVIGATE_TO_ITEM', 0);
});

test('34: Screen restore presenta changed/deleted y aplica fallback activo seguro', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(restoredScreenMessage('attention', AUDIT_CANDIDATES[2].nodeId, {
    [AUDIT_CANDIDATES[1].nodeId]: 'changed_since_audit',
    [AUDIT_CANDIDATES[2].nodeId]: 'deleted',
  }));

  const changed = plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[1].nodeId}"]`);
  const deleted = plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[2].nodeId}"]`);
  await expect(changed).toContainText('Este texto cambió desde la auditoría.');
  await expect(changed).toContainText('Resultado histórico');
  await expect(changed).toHaveAttribute('data-active', 'true');
  await expect(deleted).toContainText('Este texto ya no está disponible.');
  await expect(deleted).toBeDisabled();
  await plugin.expectMessages('SCREEN_AUDIT_NAVIGATE_TO_ITEM', 0);
});

function restoredTextMessage(state: 'current' | 'changed', score = 97) {
  return {
    type: 'TEXT_AUDIT_RESTORED',
    payload: {
      snapshot: {
        nodeId: TEXT_SELECTION.nodeId,
        nodeName: TEXT_SELECTION.nodeName,
        originalText: RESULT_WITH_CHANGE.text,
        requestId: 'analysis-restored',
        result: { ...RESULT_WITH_CHANGE, score },
        transport: 'cloud',
        completedAt: 200,
      },
      state,
    },
  } as const;
}

test('35: Text Audit restore muestra resultado y provenance sin loading', async ({ plugin }) => {
  await plugin.send(selection(TEXT_SELECTION));
  await plugin.send(restoredTextMessage('current'));

  await expect(plugin.ui.locator('#analysis-result')).toBeVisible();
  await expect(plugin.ui.locator('#analysis-score')).toHaveText('97');
  await expect(plugin.ui.locator('#analysis-loading')).toBeHidden();
  await expect(plugin.ui.locator('#engine-row')).toContainText('Nube');
  await expect(plugin.ui.locator('#text-audit-stale')).toBeHidden();
});

test('36: Text Audit stale conserva histórico, avisa y bloquea Apply', async ({ plugin }) => {
  await plugin.send(selection({ ...TEXT_SELECTION, text: 'Texto actualizado' }));
  await plugin.send(restoredTextMessage('changed'));

  await expect(plugin.ui.locator('#analysis-score')).toHaveText('97');
  await expect(plugin.ui.locator('#text-audit-stale'))
    .toContainText('Este texto cambió desde el análisis.');
  await expect(plugin.ui.locator('#text-audit-stale')).toContainText('Resultado histórico');
  await expect(plugin.ui.locator('#apply-suggestion-button')).toBeHidden();
  await expect(plugin.ui.locator('#analyze-again-button')).toHaveText('Analizar de nuevo');
});

test('37: Screen y Text restaurados permanecen separados y sin score global', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(restoredScreenMessage('all', AUDIT_CANDIDATES[1].nodeId));
  await plugin.send(selection(TEXT_SELECTION));
  await plugin.send(restoredTextMessage('current', 97));

  await expect(panel(plugin)).toBeVisible();
  await expect(plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[1].nodeId}"]`))
    .toContainText('72/100');
  await expect(plugin.ui.locator('#analysis-score')).toHaveText('97');
  const screenText = await panel(plugin).textContent();
  expect(screenText).not.toMatch(/score global|screen score|quality score/iu);
});

test('38: reauditoría oculta resultados históricos y empieza en 0 de N', async ({ plugin }) => {
  await readyToAudit(plugin);
  await plugin.send(restoredScreenMessage('all', AUDIT_CANDIDATES[0].nodeId));
  await expect(results(plugin)).toHaveCount(3);

  await plugin.ui.locator('#screen-audit-reaudit').click();
  await plugin.expectMessages('START_SCREEN_AUDIT', 1);

  await plugin.send(auditUpdate(auditSession({ sessionId: 'screen-2' })));
  await expect(plugin.ui.locator('#screen-audit-progress')).toHaveText('0 de 3 analizados');
  await expect(results(plugin)).toHaveCount(0);
  await expect(plugin.ui.locator('#screen-audit-review')).toBeHidden();
});

test('39: resultado nuevo 100 reemplaza 63 y coincide con Text Audit renderizado', async ({ plugin }) => {
  await readyToAudit(plugin);
  const historical = completedMixedSession();
  historical.items[0]!.result = { ...historical.items[0]!.result!, score: 63 };
  await plugin.send(auditUpdate(historical));
  await plugin.ui.locator('[data-filter="all"]').click();
  await expect(plugin.ui.locator(`[data-candidate-id="${AUDIT_CANDIDATES[0].nodeId}"]`))
    .toContainText('63/100');

  let fresh = auditSession({ sessionId: 'screen-2' });
  await plugin.send(auditUpdate(fresh));
  fresh = withResult(fresh, 0, 'local', 100);
  fresh = withResult(fresh, 1, 'local', 100);
  fresh = withResult(fresh, 2, 'local', 100);
  await plugin.send(auditUpdate(fresh));

  const freshCard = plugin.ui.locator(
    `[data-candidate-id="${AUDIT_CANDIDATES[0].nodeId}"]`,
  );
  await expect(freshCard).toContainText('100/100');
  await expect(freshCard).not.toContainText('63/100');

  await plugin.send(selection(TEXT_SELECTION));
  await plugin.ui.locator('#analyze-button').click();
  await plugin.send(analysisStarted('local', 'analysis-parity'));
  await plugin.send(analysisSucceeded({
    ...RESULT_WITH_CHANGE,
    text: TEXT_SELECTION.text,
    suggestion: TEXT_SELECTION.text,
    score: 100,
  }, 'analysis-parity'));
  await expect(plugin.ui.locator('#analysis-score')).toHaveText('100');
  await expect(freshCard).toContainText('100/100');
});
