/**
 * Validador de los mensajes MAIN -> UI (FASE 8.5.6, STEP 35).
 *
 * Vivía dentro de `ui.ts`, donde no podía probarse: ese fichero toca el DOM al
 * importarse. Se extrajo porque la MISMA clase de fallo apareció tres veces
 * seguidas —un tipo declarado en la unión pero ausente del `switch`, que caía
 * en `default: false` y descartaba el mensaje en silencio— y TypeScript no la
 * detecta.
 *
 * La meta-prueba de tests/message-contracts.test.mjs enumera los tipos
 * declarados y exige que cada uno tenga su caso.
 */
import { isAnalysisMode } from '../analysis-mode';
import {
  isAnalyzeError,
  isAnalyzeResponse,
  isRecord,
} from '../analyze-contracts';
import { isApplyError, isApplySuccessPayload } from '../apply-contracts';
import { isScreenAuditPreflight } from '../screen-audit-contracts';
import { isScreenAuditSession } from '../screen-audit-session';
import type {
  LocalRuntimeStatusPayload,
  MainToUiMessage,
  SelectionSnapshot,
  SettingsErrorCode,
} from './messages';

export function isSelectionSnapshot(value: unknown): value is SelectionSnapshot {
  if (
    !isRecord(value)
    || typeof value.status !== 'string'
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
  ) {
    return false;
  }

  switch (value.status) {
    case 'no-selection':
      return true;
    case 'multiple-selection':
      return typeof value.count === 'number';
    case 'invalid-selection':
      return typeof value.nodeType === 'string' && typeof value.nodeName === 'string';
    case 'empty-text':
      return typeof value.nodeId === 'string'
        && typeof value.nodeName === 'string'
        && typeof value.text === 'string';
    case 'ready':
      return typeof value.nodeId === 'string'
        && typeof value.nodeName === 'string'
        && typeof value.text === 'string';
    case 'frame':
      return typeof value.nodeId === 'string'
        && typeof value.nodeName === 'string';
    default:
      return false;
  }
}

export function isLocalRuntimeState(
  value: unknown,
): value is LocalRuntimeStatusPayload['state'] {
  return value === 'checking'
    || value === 'ready'
    || value === 'unavailable'
    || value === 'model_missing'
    || value === 'degraded';
}

export function isSettingsErrorCode(value: unknown): value is SettingsErrorCode {
  return value === 'INVALID_API_KEY'
    || value === 'STORAGE_READ_FAILED'
    || value === 'STORAGE_SAVE_FAILED'
    || value === 'STORAGE_DELETE_FAILED';
}

export function isMainToUiMessage(value: unknown): value is MainToUiMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'SCREEN_AUDIT_RESTORED':
      return isRecord(value.payload)
        && isRecord(value.payload.snapshot)
        && typeof value.payload.snapshot.frameId === 'string'
        && typeof value.payload.snapshot.frameName === 'string'
        && typeof value.payload.snapshot.completedAt === 'number'
        && isScreenAuditSession(value.payload.snapshot.session)
        && value.payload.snapshot.session.status === 'completed'
        && value.payload.snapshot.session.frameId === value.payload.snapshot.frameId
        && isRecord(value.payload.snapshot.review)
        && (value.payload.snapshot.review.filter === 'all'
          || value.payload.snapshot.review.filter === 'attention'
          || value.payload.snapshot.review.filter === 'good')
        && (typeof value.payload.snapshot.review.activeCandidateId === 'string'
          || value.payload.snapshot.review.activeCandidateId === null)
        && isRecord(value.payload.snapshot.review.navigationStates)
        && Object.values(value.payload.snapshot.review.navigationStates).every(
          (state) => state === 'current'
            || state === 'changed_since_audit'
            || state === 'deleted',
        );
    case 'TEXT_AUDIT_RESTORED':
      return isRecord(value.payload)
        && (value.payload.state === 'current' || value.payload.state === 'changed')
        && isRecord(value.payload.snapshot)
        && typeof value.payload.snapshot.nodeId === 'string'
        && typeof value.payload.snapshot.nodeName === 'string'
        && typeof value.payload.snapshot.originalText === 'string'
        && typeof value.payload.snapshot.requestId === 'string'
        && isAnalyzeResponse(value.payload.snapshot.result)
        && (value.payload.snapshot.transport === 'local'
          || value.payload.snapshot.transport === 'cloud')
        && typeof value.payload.snapshot.completedAt === 'number';
    case 'SCREEN_AUDIT_NAVIGATION_RESULT':
      return isRecord(value.payload)
        && typeof value.payload.sessionId === 'string'
        && typeof value.payload.candidateId === 'string'
        && (value.payload.state === 'current'
          || value.payload.state === 'changed_since_audit'
          || value.payload.state === 'deleted');
    case 'SCREEN_AUDIT_FRAME_UNAVAILABLE':
      return isRecord(value.payload)
        && typeof value.payload.sessionId === 'string';
    case 'SCREEN_AUDIT_UPDATED':
      return isRecord(value.payload)
        && isScreenAuditSession(value.payload.session);
    case 'SCREEN_AUDIT_INVALIDATED':
      return isRecord(value.payload)
        && typeof value.payload.sessionId === 'string';
    case 'SCREEN_PREFLIGHT_READY':
      return isRecord(value.payload)
        && isScreenAuditPreflight(value.payload.preflight);
    case 'SCREEN_PREFLIGHT_INVALIDATED':
      return isRecord(value.payload)
        && typeof value.payload.revision === 'number'
        && Number.isSafeInteger(value.payload.revision)
        && value.payload.revision >= 0;
    case 'SCREEN_PREFLIGHT_ERROR':
      return isRecord(value.payload)
        && value.payload.code === 'DISCOVERY_FAILED';
    case 'SELECTION_CHANGED':
      return isSelectionSnapshot(value.payload);
    case 'API_KEY_STATUS':
      return isRecord(value.payload)
        && typeof value.payload.configured === 'boolean';
    case 'API_KEY_SAVED':
      return isRecord(value.payload)
        && value.payload.configured === true;
    case 'API_KEY_DELETED':
      return isRecord(value.payload)
        && value.payload.configured === false;
    case 'SETTINGS_ERROR':
      return isRecord(value.payload)
        && isSettingsErrorCode(value.payload.code);
    // Faltaba en FASE 8.5.4: sin este caso la UI descartaba TODOS los avisos
    // de estado del motor, y el indicador se quedaba en «Comprobando…».
    case 'LOCAL_RUNTIME_STATUS':
      return isRecord(value.payload)
        && isLocalRuntimeState(value.payload.state)
        && (typeof value.payload.modelLabel === 'string'
          || value.payload.modelLabel === null);
    case 'ANALYSIS_MODE_STATUS':
      return isRecord(value.payload) && isAnalysisMode(value.payload.mode);
    case 'ANALYSIS_STARTED':
      return typeof value.requestId === 'string'
        && (value.transport === 'local' || value.transport === 'cloud');
    case 'ANALYSIS_SUCCEEDED':
      return typeof value.requestId === 'string'
        && isAnalyzeResponse(value.result);
    case 'ANALYSIS_FAILED':
      return (typeof value.requestId === 'string' || value.requestId === null)
        && isAnalyzeError(value.error)
        && typeof value.cloudRetryAvailable === 'boolean';
    case 'APPLY_STARTED':
      return typeof value.requestId === 'string';
    case 'APPLY_BLOCKED':
      return typeof value.requestId === 'string'
        && isApplyError(value.error);
    case 'APPLY_SUCCEEDED':
      return typeof value.requestId === 'string'
        && isApplySuccessPayload(value.payload);
    case 'APPLY_FAILED':
      return (typeof value.requestId === 'string' || value.requestId === null)
        && isApplyError(value.error);
    default:
      return false;
  }
}
