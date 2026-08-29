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
  sendSelectionState();
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

async function handleUiMessage(message: UiToMainMessage): Promise<void> {
  switch (message.type) {
    case 'UI_READY':
      isUiReady = true;
      currentSelectionSnapshot = createSelectionSnapshot();
      sendSelectionState();
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
