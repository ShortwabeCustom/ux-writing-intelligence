import type { FetchPort } from './analyze-api';
import { AnalyzeApiError } from './analyze-api';
import type { AnalysisTransportKind } from './analysis-transport';
import {
  createAnalyzeRequest,
  selectAnalysisTransport,
  transportRequiresApiKey,
} from './analysis-transport';
import type { AnalysisMode } from './analysis-mode';
import { DEFAULT_ANALYSIS_MODE, getAnalysisMode, saveAnalysisMode } from './analysis-mode';
import type { AnalysisBlockedReason, AnalysisRoute } from './analysis-routing';
import { resolveAnalysisTransport, routeNeedsLocalStatus } from './analysis-routing';
import type { LocalRuntimeState, LocalRuntimeStatus } from './local-runtime-health';
import { checkLocalRuntime } from './local-runtime-health';
import { getApiKey, deleteApiKey, getApiKeyConfigured, saveApiKey } from './api-key-storage';
import type { AnalysisContext } from './analysis-session';
import {
  createApplySession,
  isAnalysisContextCurrent,
  validateAnalysisSelection,
} from './analysis-session';
import type {
  ApplyError,
  ApplyErrorCode,
  ApplySession,
} from './apply-contracts';
import {
  acquireApplyLock,
  ApplyOperationError,
  applySuggestionToTextNode,
  createApplySuccessPayload,
  getApplyPreflightError,
  validateApplyContext,
  validateApplyRequest,
} from './apply-suggestion';
import type {
  AnalyzeError,
  AnalyzeErrorCode,
} from './analyze-contracts';
import type {
  MainToUiMessage,
  SelectionSnapshot,
  SelectionState,
  SettingsErrorCode,
  UiToMainMessage,
} from './shared/messages';
import {
  createApiKeyStatusMessage,
  isUiToMainMessage,
} from './shared/messages';
import { getSelectionState } from './selection';
import type { ScreenNodeLike } from './screen-audit-discovery';
import { buildPreflight } from './screen-audit-discovery';
import type { ScreenAuditSession } from './screen-audit-session';
import {
  createSession,
  isRunnable,
  reduceScreenAuditSession,
} from './screen-audit-session';
import {
  belongsToFrame,
  isSelectionInsideAuditedFrame,
} from './screen-audit-selection';
import {
  createAuditSessionStore,
  getScreenAudit,
  getTextAudit,
  reconcileScreenCandidate,
  reconcileTextAudit,
  removeFrameAudit,
  saveScreenAudit,
  saveTextAudit,
  updateScreenAuditReview,
} from './audit-session-store';
import type {
  ScreenAuditSnapshot,
  TextAuditSnapshot,
} from './audit-session-store';

figma.showUI(__html__, {
  width: 360,
  height: 560,
  themeColors: true,
});

let isUiReady = false;
let selectionRevision = 0;
let analysisRequestCounter = 0;
let activeRequestToken = 0;
let activeApplySession: ApplySession | null = null;
let invalidatedApplyRequest: {
  requestId: string;
  code: 'SELECTION_CHANGED' | 'STALE_ANALYSIS';
} | null = null;
let applyInFlightRequestId: string | null = null;
let currentSelectionSnapshot = createSelectionSnapshot();
/** Revisión propia del preflight de Screen Audit. Independiente de la de Text
 *  Audit para que ninguna de las dos herede la obsolescencia de la otra. */
let screenPreflightRevision = 0;
/** Preflight vigente. Es la fuente de los candidatos que audita 9.2B. */
let currentPreflight: ReturnType<typeof buildPreflight> | null = null;
/** Sesión de auditoría en curso. Solo en memoria: nada se persiste. */
let screenAuditSession: ScreenAuditSession | null = null;
let screenAuditCounter = 0;
/** Session-scoped, in-memory only. Contains serializable snapshots, never nodes. */
const auditSessionStore = createAuditSessionStore();
const pluginFetch = fetch as unknown as FetchPort;

/**
 * Frescura del estado del motor local.
 *
 * Evita repetir GET /v1/runtime/status en cada evento de UI sin llegar a
 * confiar en un estado viejo al momento de enrutar. No sustituye a la
 * comprobación real: un runtime puede caerse dentro de esta ventana, y por eso
 * un fallo posterior al POST se trata como fallo posterior al POST.
 */
const LOCAL_STATUS_TTL_MS = 30_000;
let cachedLocalStatus: LocalRuntimeStatus | null = null;
let cachedLocalStatusAt = 0;

export function getCurrentSelectionState(): SelectionState {
  return getSelectionState(figma.currentPage.selection);
}

function createSelectionSnapshot(): SelectionSnapshot {
  return {
    ...getCurrentSelectionState(),
    revision: selectionRevision,
  };
}

function sendMessage(message: MainToUiMessage): void {
  if (isUiReady) {
    figma.ui.postMessage(message);
  }
}

/**
 * Consulta el estado del motor local y lo publica a la UI.
 *
 * Se invoca en momentos puntuales — arranque del plugin y reintento
 * explícito — nunca en cada cambio de selección ni en cada tecla. No dispara
 * inferencia: el runtime responde con su catálogo de modelos.
 */
function publishLocalRuntimeStatus(status: LocalRuntimeStatus): void {
  cachedLocalStatus = status;
  cachedLocalStatusAt = Date.now();
  sendMessage({ type: 'LOCAL_RUNTIME_STATUS', payload: status });
}

async function refreshLocalRuntimeStatus(): Promise<LocalRuntimeStatus> {
  const status = await checkLocalRuntime(pluginFetch);
  publishLocalRuntimeStatus(status);
  return status;
}

/** Estado del motor local, reutilizando el resultado reciente si lo hay. */
async function getLocalRuntimeStatus(): Promise<LocalRuntimeStatus> {
  if (
    cachedLocalStatus !== null
    && Date.now() - cachedLocalStatusAt < LOCAL_STATUS_TTL_MS
  ) {
    return cachedLocalStatus;
  }

  return refreshLocalRuntimeStatus();
}

async function sendLocalRuntimeStatus(): Promise<void> {
  sendMessage({
    type: 'LOCAL_RUNTIME_STATUS',
    payload: { state: 'checking', modelLabel: null },
  });

  await refreshLocalRuntimeStatus();
}

async function readAnalysisMode(): Promise<AnalysisMode> {
  try {
    return await getAnalysisMode(figma.clientStorage);
  } catch {
    // Un fallo de lectura no debe dejar el plugin sin política. `auto` es el
    // valor de migración y el más conservador disponible.
    return DEFAULT_ANALYSIS_MODE;
  }
}

async function sendAnalysisModeStatus(): Promise<void> {
  sendMessage({
    type: 'ANALYSIS_MODE_STATUS',
    payload: { mode: await readAnalysisMode() },
  });
}

async function isCloudConfigured(): Promise<boolean> {
  try {
    return await getApiKeyConfigured(figma.clientStorage);
  } catch {
    return false;
  }
}

function sendSelectionState(): void {
  sendMessage({
    type: 'SELECTION_CHANGED',
    payload: currentSelectionSnapshot,
  });
}

function handleSelectionChange(): void {
  invalidateApplySession('SELECTION_CHANGED');
  selectionRevision += 1;
  activeRequestToken += 1;
  currentSelectionSnapshot = createSelectionSnapshot();

  // Navigation initiated by the plugin and manual selection inside the same
  // audited Frame share one semantic rule. No race-prone "ignore next event"
  // flag is needed: compatible descendants preserve the review context.
  if (screenAuditSession !== null && isSelectionInsideAuditedFrame(
    figma.currentPage.selection,
    screenAuditSession.frameId,
  )) {
    sendSelectionState();
    const selected = figma.currentPage.selection;
    if (selected.length === 1 && selected[0]?.type === 'TEXT') {
      restoreTextAudit(selected[0], selectionRevision);
    }
    return;
  }

  invalidateScreenPreflight();
  sendSelectionState();
  activateStoredContextsForSelection();
}

function findStoredScreenContextForSelection(): {
  frame: FrameNode;
  snapshot: ScreenAuditSnapshot;
} | null {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    return null;
  }

  let current: BaseNode | null = selection[0];
  while (current !== null) {
    if (current.type === 'FRAME') {
      const frameId = current.id;
      const snapshot = getScreenAudit(auditSessionStore, frameId);
      if (snapshot !== null && selection.every((node) => belongsToFrame(node, frameId))) {
        return { frame: current, snapshot };
      }
    }
    current = current.parent ?? null;
  }
  return null;
}

function activateStoredContextsForSelection(): void {
  const revision = selectionRevision;
  const screenContext = findStoredScreenContextForSelection();

  if (screenContext === null) {
    sendScreenPreflightIfFrameSelected();
  } else {
    void restoreScreenAudit(screenContext.snapshot, revision);
  }

  const selected = figma.currentPage.selection;
  if (selected.length === 1 && selected[0]?.type === 'TEXT') {
    restoreTextAudit(selected[0], revision);
  }

  void cleanupDeletedFrameAudits();
}

async function restoreScreenAudit(
  snapshot: ScreenAuditSnapshot,
  expectedRevision: number,
): Promise<void> {
  let frame: BaseNode | null = null;
  try {
    frame = await figma.getNodeByIdAsync(snapshot.frameId);
  } catch {
    return;
  }

  if (expectedRevision !== selectionRevision) {
    return;
  }
  if (frame === null || frame.removed || frame.type !== 'FRAME') {
    removeFrameAudit(auditSessionStore, snapshot.frameId);
    return;
  }

  const navigationStates = { ...snapshot.review.navigationStates };
  const items = await Promise.all(snapshot.session.items.map(async (item) => {
    let node: BaseNode | null = null;
    try {
      node = await figma.getNodeByIdAsync(item.candidate.nodeId);
    } catch {
      node = null;
    }

    navigationStates[item.candidate.nodeId] = reconcileScreenCandidate(
      item.candidate.text,
      node === null ? null : {
        type: node.type,
        characters: node.type === 'TEXT' ? node.characters : undefined,
        belongsToAuditedFrame: belongsToFrame(node, snapshot.frameId),
      },
    );

    return node?.type === 'TEXT' && belongsToFrame(node, snapshot.frameId)
      ? { ...item, candidate: { ...item.candidate, layerName: node.name } }
      : item;
  }));

  if (expectedRevision !== selectionRevision) {
    return;
  }

  const session: ScreenAuditSession = {
    ...snapshot.session,
    frameName: frame.name,
    items,
  };
  const restored: ScreenAuditSnapshot = {
    ...snapshot,
    frameName: frame.name,
    session,
    review: { ...snapshot.review, navigationStates },
  };
  saveScreenAudit(auditSessionStore, restored);
  screenAuditSession = session;
  currentPreflight = null;
  sendMessage({ type: 'SCREEN_AUDIT_RESTORED', payload: { snapshot: restored } });
}

function restoreTextAudit(node: TextNode, expectedRevision: number): void {
  const snapshot = getTextAudit(auditSessionStore, node.id);
  if (snapshot === null || expectedRevision !== selectionRevision) {
    return;
  }

  const state = reconcileTextAudit(snapshot, node);
  if (state === 'deleted') {
    return;
  }

  const restored: TextAuditSnapshot = { ...snapshot, nodeName: node.name };
  saveTextAudit(auditSessionStore, restored);

  if (state === 'current') {
    activeApplySession = createApplySession({
      requestId: snapshot.requestId,
      requestToken: activeRequestToken,
      selectionRevision,
      nodeId: node.id,
      originalText: snapshot.originalText,
    }, snapshot.result.suggestion);
    invalidatedApplyRequest = null;
  }

  sendMessage({
    type: 'TEXT_AUDIT_RESTORED',
    payload: { snapshot: restored, state },
  });

  if (state === 'current') {
    const preflightError = getApplyPreflightError(node);
    if (preflightError !== null) {
      sendMessage({
        type: 'APPLY_BLOCKED',
        requestId: snapshot.requestId,
        error: { code: preflightError },
      });
    }
  }
}

async function cleanupDeletedFrameAudits(): Promise<void> {
  for (const frameId of auditSessionStore.screenAudits.keys()) {
    try {
      const node = await figma.getNodeByIdAsync(frameId);
      if (node === null || node.removed || node.type !== 'FRAME') {
        removeFrameAudit(auditSessionStore, frameId);
      }
    } catch {
      // A transient document lookup failure must not destroy a valid snapshot.
    }
  }
}

/**
 * Invalida el preflight vigente.
 *
 * Un descubrimiento obsoleto no puede pintarse contra una selección nueva:
 * mostraría textos que ya no están en pantalla.
 */
function invalidateScreenPreflight(): void {
  screenPreflightRevision += 1;
  currentPreflight = null;
  invalidateScreenAudit();
  sendMessage({
    type: 'SCREEN_PREFLIGHT_INVALIDATED',
    payload: { revision: screenPreflightRevision },
  });
}

/**
 * Mata la auditoría en curso.
 *
 * Cualquier respuesta que llegue después queda huérfana: el bucle comprueba la
 * identidad de sesión tras cada espera y la descarta. Un resultado de una
 * pantalla no puede pintarse sobre otra.
 */
function invalidateScreenAudit(): void {
  if (screenAuditSession === null) {
    return;
  }

  const sessionId = screenAuditSession.sessionId;
  screenAuditSession = reduceScreenAuditSession(
    screenAuditSession, { type: 'INVALIDATED' });
  screenAuditSession = null;
  sendMessage({ type: 'SCREEN_AUDIT_INVALIDATED', payload: { sessionId } });
}

/**
 * Descubrimiento de Screen Audit (FASE 9.1).
 *
 * SOLO LECTURA y SIN RED. No analiza nada: no llama al runtime local ni a la
 * nube. No requiere API Key ni motor local disponible. No escribe en
 * clientStorage. No registra el contenido de ningún texto.
 */
function sendScreenPreflightIfFrameSelected(): void {
  if (currentSelectionSnapshot.status !== 'frame') {
    return;
  }

  const node = figma.currentPage.selection[0];

  if (node?.type !== 'FRAME' || node.id !== currentSelectionSnapshot.nodeId) {
    return;
  }

  const revision = screenPreflightRevision;

  try {
    const preflight = buildPreflight(
      node as unknown as ScreenNodeLike,
      revision,
    );

    // La selección pudo cambiar mientras se recorría el árbol.
    if (revision !== screenPreflightRevision) {
      return;
    }

    currentPreflight = preflight;
    sendMessage({ type: 'SCREEN_PREFLIGHT_READY', payload: { preflight } });
  } catch {
    // Fallo interno real del recorrido. Nunca se usa para estados ordinarios
    // de selección, que tienen su propia representación.
    sendMessage({
      type: 'SCREEN_PREFLIGHT_ERROR',
      payload: { code: 'DISCOVERY_FAILED' },
    });
  }
}

function invalidateApplySession(
  code: 'SELECTION_CHANGED' | 'STALE_ANALYSIS',
): void {
  if (activeApplySession !== null) {
    invalidatedApplyRequest = {
      requestId: activeApplySession.requestId,
      code,
    };
    activeApplySession = null;
  }
}

function sendSettingsError(code: SettingsErrorCode): void {
  sendMessage({
    type: 'SETTINGS_ERROR',
    payload: { code },
  });
}

function sendAnalysisFailure(
  requestId: string | null,
  code: AnalyzeErrorCode,
  cloudRetryAvailable: boolean,
  retryAfterSeconds?: number,
): void {
  const error: AnalyzeError = retryAfterSeconds === undefined
    ? { code }
    : { code, retryAfterSeconds };

  sendMessage({
    type: 'ANALYSIS_FAILED',
    requestId,
    error,
    cloudRetryAvailable,
  });
}

function blockedReasonToErrorCode(
  reason: AnalysisBlockedReason,
): AnalyzeErrorCode {
  switch (reason) {
    case 'CLOUD_NOT_CONFIGURED':
      return 'CLOUD_NOT_CONFIGURED';
    case 'NO_LOCAL_NO_CLOUD':
      return 'NO_ANALYSIS_ENGINE_AVAILABLE';
    case 'LOCAL_ONLY_MODEL_MISSING':
      return 'LOCAL_MODEL_NOT_AVAILABLE';
    case 'LOCAL_ONLY_UNAVAILABLE':
    case 'LOCAL_STATUS_UNKNOWN':
      return 'LOCAL_RUNTIME_UNAVAILABLE';
    default:
      return assertNever(reason);
  }
}

/**
 * Resuelve la ruta ANTES de enviar el texto.
 *
 * Lee la salud local solo si la política la necesita, y consulta si la nube
 * está configurada solo cuando la nube sigue siendo una opción. En
 * `auto` + local listo no se toca el almacenamiento de la API Key.
 */
async function resolveRoute(mode: AnalysisMode): Promise<AnalysisRoute> {
  let localRuntimeState: LocalRuntimeState = 'checking';

  if (routeNeedsLocalStatus(mode)) {
    localRuntimeState = (await getLocalRuntimeStatus()).state;
  }

  const cloudStillPossible = mode === 'cloud'
    || (mode === 'auto' && localRuntimeState !== 'ready');
  const cloudConfigured = cloudStillPossible ? await isCloudConfigured() : false;

  return resolveAnalysisTransport({ mode, localRuntimeState, cloudConfigured });
}

/**
 * ¿Ofrecer la acción explícita «Usar análisis en la nube» tras un fallo?
 *
 * Nunca en `local`: quien eligió Solo local afirmó que su contenido no sale
 * de esta Mac, y ofrecer la nube ahí contradiría esa promesa. Tampoco cuando
 * el fallo ya ocurrió en la nube.
 */
async function canOfferCloudRetry(
  mode: AnalysisMode,
  transport: AnalysisTransportKind,
): Promise<boolean> {
  if (mode === 'local' || transport !== 'local') {
    return false;
  }

  return isCloudConfigured();
}

function sendApplyFailure(
  requestId: string | null,
  code: ApplyErrorCode,
): void {
  const error: ApplyError = { code };

  sendMessage({
    type: 'APPLY_FAILED',
    requestId,
    error,
  });
}

async function sendApiKeyStatus(): Promise<void> {
  try {
    const configured = await getApiKeyConfigured(figma.clientStorage);
    sendMessage(createApiKeyStatusMessage('API_KEY_STATUS', configured));
  } catch {
    sendSettingsError('STORAGE_READ_FAILED');
  }
}

function isContextCurrent(context: AnalysisContext): boolean {
  return isAnalysisContextCurrent(
    context,
    activeRequestToken,
    selectionRevision,
    getCurrentSelectionState(),
  );
}

function refreshSelectionIfRequestBecameStale(context: AnalysisContext): void {
  if (
    context.requestToken === activeRequestToken
    && context.selectionRevision === selectionRevision
  ) {
    selectionRevision += 1;
    activeRequestToken += 1;
    currentSelectionSnapshot = createSelectionSnapshot();
    sendSelectionState();
  }
}

function synchronizeSelectionAfterInvalidAnalysis(): void {
  selectionRevision += 1;
  activeRequestToken += 1;
  currentSelectionSnapshot = createSelectionSnapshot();
  sendSelectionState();
}

/**
 * Punto de entrada compartido del análisis.
 *
 * Local y nube pasan por aquí: mismas guardas de obsolescencia, mismo
 * requestId, misma sesión de Apply, mismo contrato de respuesta. El
 * transporte se decide abajo y no duplica ninguna de esas reglas.
 *
 * `forcedTransport` lo usan las DOS acciones explícitas de recuperación, cada
 * una con su transporte fijo: «Reintentar local» fuerza local y «Usar análisis
 * en la nube» fuerza nube. Ninguna consulta la política de AUTO, así que
 * ninguna puede cambiar de destino con el paso del tiempo. Nunca las activa un
 * fallo por sí solo.
 */
async function handleAnalyzeRequest(
  selectionRevisionFromUi: number,
  forcedTransport?: AnalysisTransportKind,
): Promise<void> {
  const selectionValidation = validateAnalysisSelection(
    selectionRevisionFromUi,
    currentSelectionSnapshot,
    getCurrentSelectionState(),
  );

  if (!selectionValidation.valid) {
    synchronizeSelectionAfterInvalidAnalysis();
    sendAnalysisFailure(null, selectionValidation.code, false);
    return;
  }

  const mode = await readAnalysisMode();

  // ------------------------------------------------------------------
  // DECISIÓN DE TRANSPORTE — ocurre ANTES de que el texto salga del plugin.
  // Este es el ÚNICO punto donde la nube puede elegirse automáticamente.
  // ------------------------------------------------------------------
  let route: AnalysisRoute;

  if (forcedTransport === 'local') {
    // «Reintentar local». Transporte fijo, sin excepciones: ni el modo, ni la
    // antigüedad del estado de salud, ni tener API Key configurada pueden
    // convertir este reintento en una petición a la nube. Si el motor local
    // sigue caído, el resultado correcto es OTRO error local.
    //
    // Se refresca la salud para que el indicador diga la verdad, pero ese
    // dato NO participa en la elección de transporte.
    if (routeNeedsLocalStatus(mode)) {
      await refreshLocalRuntimeStatus();
    }

    route = { status: 'ready', transport: 'local', reason: 'LOCAL_ONLY' };
  } else if (forcedTransport === 'cloud') {
    // Petición explícita de la persona. Aun así se verifica el modo: en Solo
    // local no existe ruta a la nube, ni siquiera pedida a mano.
    if (mode === 'local') {
      sendAnalysisFailure(null, 'NO_ANALYSIS_ENGINE_AVAILABLE', false);
      return;
    }

    route = await isCloudConfigured()
      ? { status: 'ready', transport: 'cloud', reason: 'CLOUD_ONLY' }
      : { status: 'blocked', reason: 'CLOUD_NOT_CONFIGURED' };
  } else {
    route = await resolveRoute(mode);
  }

  if (route.status === 'blocked') {
    // No se envió texto a ninguna parte. La selección sigue siendo válida, así
    // que no se invalida ni se toca la sesión de Apply.
    sendAnalysisFailure(null, blockedReasonToErrorCode(route.reason), false);
    return;
  }

  // Resolver la ruta implicó E/S asíncrona. La selección pudo cambiar en ese
  // intervalo, y analizar el texto nuevo bajo la intención vieja sería un
  // error silencioso: se revalida contra la MISMA revisión que pidió la UI.
  const revalidation = validateAnalysisSelection(
    selectionRevisionFromUi,
    currentSelectionSnapshot,
    getCurrentSelectionState(),
  );

  if (!revalidation.valid) {
    synchronizeSelectionAfterInvalidAnalysis();
    sendAnalysisFailure(null, revalidation.code, false);
    return;
  }

  invalidateApplySession('STALE_ANALYSIS');

  analysisRequestCounter += 1;
  activeRequestToken += 1;

  const requestId = `analysis-${analysisRequestCounter}`;
  const context: AnalysisContext = {
    requestId,
    requestToken: activeRequestToken,
    selectionRevision,
    nodeId: revalidation.nodeId,
    originalText: revalidation.originalText,
  };

  sendMessage({
    type: 'ANALYSIS_STARTED',
    requestId,
    transport: route.transport,
  });

  // La API Key solo se lee cuando el transporte elegido la necesita. El
  // transporte local NO la requiere y nunca debe recibirla.
  let apiKey: string | null = null;

  if (transportRequiresApiKey(route.transport)) {
    try {
      apiKey = await getApiKey(figma.clientStorage);
    } catch {
      if (isContextCurrent(context)) {
        sendAnalysisFailure(requestId, 'UNKNOWN_ERROR', false);
      } else {
        refreshSelectionIfRequestBecameStale(context);
      }
      return;
    }

    if (!isContextCurrent(context)) {
      refreshSelectionIfRequestBecameStale(context);
      return;
    }

    if (apiKey === null) {
      sendAnalysisFailure(requestId, 'MISSING_API_KEY', false);
      return;
    }
  }

  const transport = selectAnalysisTransport(pluginFetch, route.transport, apiKey);

  try {
    const result = await transport.analyze(
      createAnalyzeRequest(context.originalText),
    );

    if (!isContextCurrent(context)) {
      refreshSelectionIfRequestBecameStale(context);
      return;
    }

    // Un análisis local exitoso es la prueba más fuerte de que el motor está
    // listo. Sin esto, el indicador podía quedarse en «Comprobando…» pese a
    // haber respondido correctamente.
    if (route.transport === 'local') {
      publishLocalRuntimeStatus({
        state: 'ready',
        modelLabel: cachedLocalStatus?.modelLabel ?? null,
      });
    }

    activeApplySession = createApplySession(context, result.suggestion);
    invalidatedApplyRequest = null;

    const analyzedNode = figma.currentPage.selection[0];
    saveTextAudit(auditSessionStore, {
      nodeId: context.nodeId,
      nodeName: analyzedNode?.type === 'TEXT' ? analyzedNode.name : '',
      originalText: context.originalText,
      requestId,
      result,
      transport: route.transport,
      completedAt: Date.now(),
    });

    sendMessage({
      type: 'ANALYSIS_SUCCEEDED',
      requestId,
      result,
    });

    const selectedNode = figma.currentPage.selection[0];

    if (selectedNode?.type === 'TEXT' && selectedNode.id === context.nodeId) {
      const preflightError = getApplyPreflightError(selectedNode);

      if (preflightError !== null) {
        sendMessage({
          type: 'APPLY_BLOCKED',
          requestId,
          error: { code: preflightError },
        });
      }
    }
  } catch (error: unknown) {
    // ------------------------------------------------------------------
    // FALLO POSTERIOR AL POST.
    //
    // El texto YA salió hacia el transporte elegido. Aquí NO se reencamina a
    // la nube bajo ninguna circunstancia: hacerlo enviaría a un servicio
    // remoto un contenido que la persona pidió procesar localmente, sin que
    // ella lo supiera. Solo se informa el fallo y, si la nube es una opción
    // legítima, se ofrece una acción que debe pulsar a mano.
    // ------------------------------------------------------------------
    if (!isContextCurrent(context)) {
      refreshSelectionIfRequestBecameStale(context);
      return;
    }

    const cloudRetryAvailable = await canOfferCloudRetry(mode, route.transport);

    if (!isContextCurrent(context)) {
      refreshSelectionIfRequestBecameStale(context);
      return;
    }

    if (error instanceof AnalyzeApiError) {
      sendAnalysisFailure(
        requestId,
        error.details.code,
        cloudRetryAvailable,
        error.details.retryAfterSeconds,
      );
      return;
    }

    sendAnalysisFailure(requestId, 'UNKNOWN_ERROR', cloudRetryAvailable);
  }
}

function synchronizeSelectionAfterInvalidApply(): void {
  selectionRevision += 1;
  activeRequestToken += 1;
  currentSelectionSnapshot = createSelectionSnapshot();
  sendSelectionState();
}

function getApplyRevalidationError(session: ApplySession): ApplyErrorCode | null {
  if (activeApplySession !== session) {
    return selectionRevision !== session.selectionRevision
      ? 'SELECTION_CHANGED'
      : 'STALE_ANALYSIS';
  }

  const validation = validateApplyContext(
    session,
    selectionRevision,
    figma.currentPage.selection,
  );

  return validation.valid ? null : validation.code;
}

async function handleApplyRequest(requestId: string): Promise<void> {
  const acquiredLock = acquireApplyLock(applyInFlightRequestId, requestId);

  if (acquiredLock === null) {
    return;
  }

  const session = activeApplySession;

  if (session === null) {
    const invalidatedCode = invalidatedApplyRequest?.requestId === requestId
      ? invalidatedApplyRequest.code
      : 'NO_ACTIVE_ANALYSIS';
    sendApplyFailure(requestId, invalidatedCode);
    return;
  }

  const validation = validateApplyRequest(
    requestId,
    session,
    selectionRevision,
    figma.currentPage.selection,
  );

  if (!validation.valid) {
    if (
      validation.code === 'TEXT_CHANGED'
      || validation.code === 'SELECTION_CHANGED'
      || validation.code === 'INVALID_SELECTION'
    ) {
      invalidateApplySession(
        validation.code === 'SELECTION_CHANGED'
          ? 'SELECTION_CHANGED'
          : 'STALE_ANALYSIS',
      );
      synchronizeSelectionAfterInvalidApply();
    }

    sendApplyFailure(requestId, validation.code);
    return;
  }

  applyInFlightRequestId = acquiredLock;
  sendMessage({ type: 'APPLY_STARTED', requestId });

  const node = figma.currentPage.selection[0] as TextNode;

  try {
    const result = await applySuggestionToTextNode(
      node,
      session.suggestion,
      (font) => figma.loadFontAsync(font),
      () => getApplyRevalidationError(session),
    );

    activeApplySession = null;
    invalidatedApplyRequest = {
      requestId,
      code: 'STALE_ANALYSIS',
    };
    selectionRevision += 1;
    activeRequestToken += 1;
    currentSelectionSnapshot = createSelectionSnapshot();
    sendSelectionState();

    sendMessage({
      type: 'APPLY_SUCCEEDED',
      requestId,
      payload: createApplySuccessPayload(
        session,
        result.appliedText,
        selectionRevision,
      ),
    });
  } catch (error: unknown) {
    const code = error instanceof ApplyOperationError
      ? error.code
      : 'UNKNOWN_ERROR';

    if (
      code === 'TEXT_CHANGED'
      || code === 'SELECTION_CHANGED'
      || code === 'INVALID_SELECTION'
      || code === 'STALE_ANALYSIS'
      || (code === 'EDIT_FAILED' && node.characters !== session.originalText)
    ) {
      invalidateApplySession(
        code === 'SELECTION_CHANGED'
          ? 'SELECTION_CHANGED'
          : 'STALE_ANALYSIS',
      );

      if (selectionRevision === session.selectionRevision) {
        synchronizeSelectionAfterInvalidApply();
      }
    }

    sendApplyFailure(requestId, code);
  } finally {
    applyInFlightRequestId = null;
  }
}


// =============================================================================
// Screen Audit — ejecución secuencial progresiva (FASE 9.2B)
//
// Estrategia elegida por medición en FASE 9.2A. Un candidato, UNA petición de
// las que ya existen, y el resultado a la vista en cuanto llega.
//
// Sin lotes: agrupar perdía textos en silencio. Sin paralelismo: Ollama encola
// y no aporta nada. La secuencialidad estricta no es una política que haya que
// vigilar, es la forma del bucle: un solo `await` en curso a la vez.
// =============================================================================

function publishScreenAudit(): void {
  if (screenAuditSession !== null) {
    sendMessage({
      type: 'SCREEN_AUDIT_UPDATED',
      payload: { session: screenAuditSession },
    });
  }
}

function persistCompletedScreenAudit(session: ScreenAuditSession): void {
  if (session.status !== 'completed') {
    return;
  }

  saveScreenAudit(auditSessionStore, {
    frameId: session.frameId,
    frameName: session.frameName,
    session,
    completedAt: Date.now(),
    review: {
      filter: 'all',
      activeCandidateId: null,
      navigationStates: {},
    },
  });
}

function applyScreenAuditEvent(sessionId: string, event: Parameters<typeof reduceScreenAuditSession>[1]): boolean {
  if (screenAuditSession === null || screenAuditSession.sessionId !== sessionId) {
    return false;
  }

  screenAuditSession = reduceScreenAuditSession(screenAuditSession, event);
  if (screenAuditSession.status === 'completed') {
    persistCompletedScreenAudit(screenAuditSession);
  }
  publishScreenAudit();
  return true;
}

/**
 * Revalida el nodo justo antes de enviarlo.
 *
 * Una auditoría puede durar más de un minuto y el documento puede cambiar
 * mientras tanto. Analizar una fuente obsoleta produciría un veredicto sobre
 * un texto que ya no existe.
 */
async function revalidateCandidate(nodeId: string, expected: string): Promise<boolean> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    return node !== null
      && node.type === 'TEXT'
      && (node as TextNode).characters === expected;
  } catch {
    return false;
  }
}

async function runScreenAudit(sessionId: string): Promise<void> {
  // Un único bucle con espera: por construcción no puede haber dos peticiones
  // de Screen Audit en vuelo.
  while (
    screenAuditSession !== null
    && screenAuditSession.sessionId === sessionId
    && isRunnable(screenAuditSession)
  ) {
    const index = screenAuditSession.currentIndex;
    const item = screenAuditSession.items[index];
    const transport = screenAuditSession.executionTransport;

    if (item === undefined || transport === null) {
      return;
    }

    const candidate = item.candidate;

    if (!await revalidateCandidate(candidate.nodeId, candidate.text)) {
      // Obsolescencia del documento: se marca y se continúa con seguridad.
      // No se analiza la fuente vieja ni se toca el texto nuevo.
      if (!applyScreenAuditEvent(sessionId, { type: 'ITEM_CHANGED', index })) {
        return;
      }
      continue;
    }

    if (!applyScreenAuditEvent(sessionId, { type: 'ITEM_STARTED', index })) {
      return;
    }

    let apiKey: string | null = null;

    if (transportRequiresApiKey(transport)) {
      try {
        apiKey = await getApiKey(figma.clientStorage);
      } catch {
        apiKey = null;
      }

      if (apiKey === null) {
        applyScreenAuditEvent(sessionId, {
          type: 'ITEM_FAILED',
          index,
          error: { code: 'MISSING_API_KEY' },
          transport,
          cloudContinuationAvailable: false,
        });
        return;
      }
    }

    const client = selectAnalysisTransport(pluginFetch, transport, apiKey);

    try {
      const result = await client.analyze({
        // FUENTE EXACTA: el texto y el contexto son los que preparó el
        // preflight de 9.1, carácter por carácter.
        text: candidate.text,
        context: candidate.context,
        locale: 'es-MX',
      });

      if (!applyScreenAuditEvent(sessionId, {
        type: 'ITEM_SUCCEEDED', index, result, transport,
      })) {
        return;
      }
    } catch (error: unknown) {
      const code = error instanceof AnalyzeApiError
        ? error.details.code
        : 'UNKNOWN_ERROR';

      // FALLO POSTERIOR AL POST. El texto ya salió hacia el transporte
      // elegido. Aquí NO se reencamina: se pausa. Continuar en la nube exige
      // que la persona lo pida.
      const cloudContinuationAvailable = transport === 'local'
        && await canOfferCloudRetry(await readAnalysisMode(), transport);

      applyScreenAuditEvent(sessionId, {
        type: 'ITEM_FAILED',
        index,
        error: { code },
        transport,
        cloudContinuationAvailable,
      });
      return;
    }
  }

  if (screenAuditSession !== null
      && screenAuditSession.sessionId === sessionId
      && screenAuditSession.status === 'running') {
    applyScreenAuditEvent(sessionId, { type: 'COMPLETED' });
  }
}

async function handleStartScreenAudit(selectionRevisionFromUi: number): Promise<void> {
  if (currentSelectionSnapshot.status !== 'frame'
      || currentSelectionSnapshot.revision !== selectionRevisionFromUi) {
    return;
  }

  const selected = figma.currentPage.selection[0];
  if (selected?.type !== 'FRAME' || selected.id !== currentSelectionSnapshot.nodeId) {
    return;
  }

  // START_SCREEN_AUDIT expresa una ejecución nueva, no una restauración. Se
  // vuelve a recorrer el Frame incluso si ya existe un preflight del mismo ID:
  // los nodos pueden haber cambiado, aparecido, desaparecido o movido desde la
  // auditoría anterior. El snapshot completado permanece intacto en el store
  // hasta que esta nueva sesión termine con éxito.
  try {
    currentPreflight = buildPreflight(
      selected as unknown as ScreenNodeLike,
      screenPreflightRevision,
    );
  } catch {
    return;
  }

  // Se captura el preflight ANTES de las esperas. Resolver la ruta es
  // asíncrono, y un cambio de selección en ese intervalo lo invalidaría: sin
  // esta captura, la referencia quedaría en `null` al usarla.
  const preflight = currentPreflight;
  const startRevision = screenPreflightRevision;

  // Se resuelve UNA ruta inicial con la política de enrutamiento que ya
  // existe. No hay una segunda política para Screen Audit.
  const mode = await readAnalysisMode();
  const route = await resolveRoute(mode);

  // La selección pudo cambiar mientras se resolvía la ruta. Auditar entonces
  // sería auditar una pantalla que la persona ya no tiene delante.
  if (route.status === 'blocked'
      || startRevision !== screenPreflightRevision
      || currentPreflight !== preflight) {
    return;
  }

  const candidates = preflight.candidates.filter(
    (candidate) => candidate.status === 'ready',
  );

  screenAuditCounter += 1;
  screenAuditSession = createSession({
    sessionId: `screen-${screenAuditCounter}`,
    frameId: preflight.frameId,
    frameName: preflight.frameName,
    selectionRevision: currentSelectionSnapshot.revision,
    candidates,
    transport: route.transport,
  });

  if (screenAuditSession.status === 'completed') {
    persistCompletedScreenAudit(screenAuditSession);
  }

  publishScreenAudit();
  await runScreenAudit(screenAuditSession.sessionId);
}

async function handleResumeScreenAudit(
  sessionId: string,
  transport: AnalysisTransportKind,
): Promise<void> {
  if (screenAuditSession === null
      || screenAuditSession.sessionId !== sessionId
      || screenAuditSession.status !== 'paused') {
    return;
  }

  // En Solo local no existe continuación en la nube, ni pedida a mano.
  if (transport === 'cloud' && await readAnalysisMode() === 'local') {
    return;
  }

  if (!applyScreenAuditEvent(sessionId, { type: 'RESUMED', transport })) {
    return;
  }

  await runScreenAudit(sessionId);
}

async function handleScreenAuditNavigation(
  auditSessionId: string,
  candidateId: string,
): Promise<void> {
  const session = screenAuditSession;

  if (session === null || session.sessionId !== auditSessionId) {
    return;
  }

  let frame: BaseNode | null = null;
  try {
    frame = await figma.getNodeByIdAsync(session.frameId);
  } catch {
    frame = null;
  }

  if (screenAuditSession?.sessionId !== auditSessionId) {
    return;
  }

  if (frame === null || frame.removed || frame.type !== 'FRAME') {
    screenAuditSession = null;
    removeFrameAudit(auditSessionStore, session.frameId);
    sendMessage({
      type: 'SCREEN_AUDIT_FRAME_UNAVAILABLE',
      payload: { sessionId: auditSessionId },
    });
    return;
  }

  const item = session.items.find(
    (candidate) => candidate.candidate.nodeId === candidateId,
  );

  if (item === undefined) {
    return;
  }

  let node: BaseNode | null = null;
  try {
    node = await figma.getNodeByIdAsync(candidateId);
  } catch {
    node = null;
  }

  if (screenAuditSession?.sessionId !== auditSessionId) {
    return;
  }

  if (frame.removed) {
    screenAuditSession = null;
    removeFrameAudit(auditSessionStore, session.frameId);
    sendMessage({
      type: 'SCREEN_AUDIT_FRAME_UNAVAILABLE',
      payload: { sessionId: auditSessionId },
    });
    return;
  }

  if (node === null || node.removed || node.type !== 'TEXT') {
    recordScreenNavigationState(session, candidateId, 'deleted');
    sendMessage({
      type: 'SCREEN_AUDIT_NAVIGATION_RESULT',
      payload: { sessionId: auditSessionId, candidateId, state: 'deleted' },
    });
    return;
  }

  if (!belongsToFrame(node, session.frameId)) {
    recordScreenNavigationState(session, candidateId, 'deleted');
    sendMessage({
      type: 'SCREEN_AUDIT_NAVIGATION_RESULT',
      payload: { sessionId: auditSessionId, candidateId, state: 'deleted' },
    });
    return;
  }

  const textNode = node as TextNode;
  const state = textNode.characters === item.candidate.text
    ? 'current' as const
    : 'changed_since_audit' as const;

  recordScreenNavigationState(session, candidateId, state);

  figma.currentPage.selection = [textNode];
  figma.viewport.scrollAndZoomIntoView([textNode]);
  sendMessage({
    type: 'SCREEN_AUDIT_NAVIGATION_RESULT',
    payload: { sessionId: auditSessionId, candidateId, state },
  });
}

function recordScreenNavigationState(
  session: ScreenAuditSession,
  candidateId: string,
  state: 'current' | 'changed_since_audit' | 'deleted',
): void {
  const snapshot = getScreenAudit(auditSessionStore, session.frameId);
  if (snapshot === null || snapshot.session.sessionId !== session.sessionId) {
    return;
  }
  updateScreenAuditReview(auditSessionStore, session.frameId, {
    ...snapshot.review,
    activeCandidateId: candidateId,
    navigationStates: {
      ...snapshot.review.navigationStates,
      [candidateId]: state,
    },
  });
}

async function handleUiMessage(message: UiToMainMessage): Promise<void> {
  switch (message.type) {
    case 'UI_READY':
      isUiReady = true;
      currentSelectionSnapshot = createSelectionSnapshot();
      sendSelectionState();
      activateStoredContextsForSelection();
      await sendApiKeyStatus();
      await sendAnalysisModeStatus();
      await sendLocalRuntimeStatus();
      break;

    case 'CHECK_LOCAL_RUNTIME':
      await sendLocalRuntimeStatus();
      break;

    case 'SET_ANALYSIS_MODE':
      try {
        await saveAnalysisMode(figma.clientStorage, message.mode);
      } catch {
        sendSettingsError('STORAGE_SAVE_FAILED');
        return;
      }

      // El cambio de modo afecta a la SIGUIENTE petición. Una solicitud en
      // vuelo conserva el transporte con el que empezó: redirigirla enviaría
      // el mismo texto dos veces, a dos destinos distintos.
      sendMessage({ type: 'ANALYSIS_MODE_STATUS', payload: { mode: message.mode } });

      if (message.mode !== 'cloud') {
        await sendLocalRuntimeStatus();
      }
      break;

    case 'START_SCREEN_AUDIT':
      await handleStartScreenAudit(message.selectionRevision);
      break;

    case 'RETRY_SCREEN_AUDIT_LOCAL':
      await handleResumeScreenAudit(message.sessionId, 'local');
      break;

    case 'CONTINUE_SCREEN_AUDIT_CLOUD':
      await handleResumeScreenAudit(message.sessionId, 'cloud');
      break;

    case 'SCREEN_AUDIT_NAVIGATE_TO_ITEM':
      await handleScreenAuditNavigation(message.auditSessionId, message.candidateId);
      break;

    case 'UPDATE_SCREEN_AUDIT_REVIEW_STATE': {
      const session = screenAuditSession;
      const snapshot = session === null
        ? null
        : getScreenAudit(auditSessionStore, session.frameId);
      if (session !== null
          && session.sessionId === message.auditSessionId
          && snapshot?.session.sessionId === message.auditSessionId) {
        updateScreenAuditReview(auditSessionStore, session.frameId, {
          ...snapshot.review,
          filter: message.filter,
          activeCandidateId: message.activeCandidateId,
        });
      }
      break;
    }

    case 'RETRY_LOCAL_ANALYSIS':
      await handleAnalyzeRequest(message.selectionRevision, 'local');
      break;

    case 'USE_CLOUD_FOR_CURRENT_ANALYSIS':
      await handleAnalyzeRequest(message.selectionRevision, 'cloud');
      break;

    case 'OPEN_SETTINGS':
      await sendApiKeyStatus();
      await sendAnalysisModeStatus();
      await sendLocalRuntimeStatus();
      break;

    case 'REQUEST_API_KEY_STATUS':
      await sendApiKeyStatus();
      break;

    case 'SAVE_API_KEY':
      try {
        const wasSaved = await saveApiKey(figma.clientStorage, message.apiKey);

        if (!wasSaved) {
          sendSettingsError('INVALID_API_KEY');
          return;
        }

        activeRequestToken += 1;
        invalidateApplySession('STALE_ANALYSIS');
        sendMessage(createApiKeyStatusMessage('API_KEY_SAVED', true));
      } catch {
        sendSettingsError('STORAGE_SAVE_FAILED');
      }
      break;

    case 'DELETE_API_KEY':
      try {
        await deleteApiKey(figma.clientStorage);
        activeRequestToken += 1;
        invalidateApplySession('STALE_ANALYSIS');
        sendMessage(createApiKeyStatusMessage('API_KEY_DELETED', false));
      } catch {
        sendSettingsError('STORAGE_DELETE_FAILED');
      }
      break;

    case 'ANALYZE_REQUEST':
      await handleAnalyzeRequest(message.selectionRevision);
      break;

    case 'APPLY_SUGGESTION':
      await handleApplyRequest(message.requestId);
      break;

    default:
      assertNever(message);
  }
}

function assertNever(_value: never): never {
  throw new Error('Unhandled UI message type.');
}

figma.ui.onmessage = (message: unknown): void => {
  if (isUiToMainMessage(message)) {
    void handleUiMessage(message);
  }
};

figma.on('selectionchange', handleSelectionChange);
