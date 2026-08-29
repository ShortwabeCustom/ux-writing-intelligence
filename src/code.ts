import type { FetchPort } from './analyze-api';
import { AnalyzeApiError } from './analyze-api';
import {
  ACTIVE_TRANSPORT_KIND,
  createAnalyzeRequest,
  selectAnalysisTransport,
  transportRequiresApiKey,
} from './analysis-transport';
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
async function sendLocalRuntimeStatus(): Promise<void> {
  sendMessage({
    type: 'LOCAL_RUNTIME_STATUS',
    payload: { state: 'checking', modelLabel: null },
  });

  const status = await checkLocalRuntime(pluginFetch);

  sendMessage({ type: 'LOCAL_RUNTIME_STATUS', payload: status });
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
  retryAfterSeconds?: number,
): void {
  const error: AnalyzeError = retryAfterSeconds === undefined
    ? { code }
    : { code, retryAfterSeconds };

  sendMessage({
    type: 'ANALYSIS_FAILED',
    requestId,
    error,
  });
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

async function handleAnalyzeRequest(selectionRevisionFromUi: number): Promise<void> {
  const currentSelection = getCurrentSelectionState();
  const selectionValidation = validateAnalysisSelection(
    selectionRevisionFromUi,
    currentSelectionSnapshot,
    currentSelection,
  );

  if (!selectionValidation.valid) {
    synchronizeSelectionAfterInvalidAnalysis();
    sendAnalysisFailure(null, selectionValidation.code);
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
    nodeId: selectionValidation.nodeId,
    originalText: selectionValidation.originalText,
  };

  sendMessage({ type: 'ANALYSIS_STARTED', requestId });

  // La API Key solo se lee cuando el transporte activo la necesita. El
  // transporte local NO la requiere y nunca debe recibirla.
  let apiKey: string | null = null;

  if (transportRequiresApiKey(ACTIVE_TRANSPORT_KIND)) {
    try {
      apiKey = await getApiKey(figma.clientStorage);
    } catch {
      if (isContextCurrent(context)) {
        sendAnalysisFailure(requestId, 'UNKNOWN_ERROR');
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
      sendAnalysisFailure(requestId, 'MISSING_API_KEY');
      return;
    }
  }

  const transport = selectAnalysisTransport(pluginFetch, apiKey);

  try {
    const result = await transport.analyze(
      createAnalyzeRequest(context.originalText),
    );

    if (!isContextCurrent(context)) {
      refreshSelectionIfRequestBecameStale(context);
      return;
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
    if (!isContextCurrent(context)) {
      refreshSelectionIfRequestBecameStale(context);
      return;
    }

    if (error instanceof AnalyzeApiError) {
      sendAnalysisFailure(
        requestId,
        error.details.code,
        error.details.retryAfterSeconds,
      );
      return;
    }

    sendAnalysisFailure(requestId, 'UNKNOWN_ERROR');
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
      await sendLocalRuntimeStatus();
      break;

    case 'CHECK_LOCAL_RUNTIME':
      await sendLocalRuntimeStatus();
      break;

    case 'OPEN_SETTINGS':
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
