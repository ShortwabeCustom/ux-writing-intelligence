/**
 * Sesión de ejecución de Screen Audit (FASE 9.2B).
 *
 * Reductor puro. No hace red, no toca el DOM y no conoce Figma.
 *
 * ESTRATEGIA, decidida por medición en FASE 9.2A: secuencial progresiva. Un
 * candidato, una petición de análisis de las que ya existen, y el resultado a
 * la vista en cuanto llega. Sin lotes: agrupar perdía textos en silencio.
 * Sin paralelismo: Ollama encola y no aporta nada.
 *
 * PROCEDENCIA POR ELEMENTO: cada resultado guarda el transporte que de verdad
 * lo produjo. Ni la salud del motor ni el modo de análisis son procedencia.
 */
import type { AnalyzeError, AnalyzeResponse } from './analyze-contracts';
import { isAnalyzeError, isAnalyzeResponse, isRecord } from './analyze-contracts';
import type { AnalysisTransportKind } from './analysis-transport';
import type { ScreenAuditCandidate } from './screen-audit-contracts';

export type ScreenAuditExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'invalidated';

export type ScreenAuditItemStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'changed'
  | 'error';

export interface ScreenAuditItem {
  candidate: ScreenAuditCandidate;
  status: ScreenAuditItemStatus;
  /** Transporte que produjo ESTE resultado. Nunca se reescribe. */
  transport: AnalysisTransportKind | null;
  result: AnalyzeResponse | null;
  error: AnalyzeError | null;
}

export interface ScreenAuditSession {
  sessionId: string;
  frameId: string;
  frameName: string;
  selectionRevision: number;
  status: ScreenAuditExecutionStatus;
  total: number;
  /** Solo los analizados con éxito. Un texto que cambió NO cuenta. */
  completed: number;
  changed: number;
  failed: number;
  currentIndex: number;
  items: ScreenAuditItem[];
  /** Transporte de la auditoría ACTIVA. Fijo hasta que la persona decida. */
  executionTransport: AnalysisTransportKind | null;
  /** ¿Se puede ofrecer continuar en la nube tras un fallo? */
  cloudContinuationAvailable: boolean;
}

export type ScreenAuditEvent =
  | { type: 'ITEM_STARTED'; index: number }
  | {
      type: 'ITEM_SUCCEEDED';
      index: number;
      result: AnalyzeResponse;
      transport: AnalysisTransportKind;
    }
  | { type: 'ITEM_CHANGED'; index: number }
  | {
      type: 'ITEM_FAILED';
      index: number;
      error: AnalyzeError;
      transport: AnalysisTransportKind;
      cloudContinuationAvailable: boolean;
    }
  | { type: 'RESUMED'; transport: AnalysisTransportKind }
  | { type: 'COMPLETED' }
  | { type: 'INVALIDATED' };

export function createSession(input: {
  sessionId: string;
  frameId: string;
  frameName: string;
  selectionRevision: number;
  candidates: ScreenAuditCandidate[];
  transport: AnalysisTransportKind;
}): ScreenAuditSession {
  return {
    sessionId: input.sessionId,
    frameId: input.frameId,
    frameName: input.frameName,
    selectionRevision: input.selectionRevision,
    status: input.candidates.length === 0 ? 'completed' : 'running',
    total: input.candidates.length,
    completed: 0,
    changed: 0,
    failed: 0,
    currentIndex: 0,
    executionTransport: input.transport,
    cloudContinuationAvailable: false,
    items: input.candidates.map((candidate) => ({
      candidate,
      status: 'pending',
      transport: null,
      result: null,
      error: null,
    })),
  };
}

function replaceItem(
  session: ScreenAuditSession,
  index: number,
  patch: Partial<ScreenAuditItem>,
): ScreenAuditItem[] {
  return session.items.map((item, position) => (
    position === index ? { ...item, ...patch } : item
  ));
}

export function reduceScreenAuditSession(
  session: ScreenAuditSession,
  event: ScreenAuditEvent,
): ScreenAuditSession {
  // Una sesión invalidada está muerta: ninguna respuesta tardía puede
  // resucitarla ni pintarse contra otra selección.
  if (session.status === 'invalidated' && event.type !== 'INVALIDATED') {
    return session;
  }

  switch (event.type) {
    case 'ITEM_STARTED':
      if (session.status !== 'running' || event.index !== session.currentIndex) {
        return session;
      }
      return {
        ...session,
        items: replaceItem(session, event.index, { status: 'running' }),
      };

    case 'ITEM_SUCCEEDED': {
      if (session.status !== 'running' || event.index !== session.currentIndex) {
        return session;
      }
      const items = replaceItem(session, event.index, {
        status: 'success',
        result: event.result,
        transport: event.transport,
        error: null,
      });
      return advance({
        ...session,
        items,
        completed: session.completed + 1,
      });
    }

    case 'ITEM_CHANGED': {
      // El texto cambió en el documento mientras corría la auditoría. No se
      // analiza una fuente obsoleta ni se toca el texto nuevo: se marca y se
      // sigue con el siguiente.
      if (session.status !== 'running' || event.index !== session.currentIndex) {
        return session;
      }
      const items = replaceItem(session, event.index, { status: 'changed' });
      return advance({ ...session, items, changed: session.changed + 1 });
    }

    case 'ITEM_FAILED': {
      // Un fallo de transporte PAUSA. No se salta al siguiente: en una
      // pantalla larga, un resultado ausente pasaría inadvertido.
      if (session.status !== 'running' || event.index !== session.currentIndex) {
        return session;
      }
      return {
        ...session,
        status: 'paused',
        failed: session.failed + 1,
        cloudContinuationAvailable: event.cloudContinuationAvailable,
        items: replaceItem(session, event.index, {
          status: 'error',
          error: event.error,
          transport: event.transport,
        }),
      };
    }

    case 'RESUMED': {
      if (session.status !== 'paused') {
        return session;
      }
      // El elemento que falló vuelve a intentarse; los ya resueltos conservan
      // intacta su procedencia.
      return {
        ...session,
        status: 'running',
        failed: Math.max(0, session.failed - 1),
        executionTransport: event.transport,
        cloudContinuationAvailable: false,
        items: replaceItem(session, session.currentIndex, {
          status: 'pending',
          error: null,
          transport: null,
        }),
      };
    }

    case 'COMPLETED':
      return session.status === 'running'
        ? { ...session, status: 'completed' }
        : session;

    case 'INVALIDATED':
      return { ...session, status: 'invalidated' };

    default:
      return assertNever(event);
  }
}

/** Avanza al siguiente candidato, o cierra la auditoría si no queda ninguno. */
function advance(session: ScreenAuditSession): ScreenAuditSession {
  const nextIndex = session.currentIndex + 1;

  return nextIndex >= session.total
    ? { ...session, currentIndex: nextIndex, status: 'completed' }
    : { ...session, currentIndex: nextIndex };
}

/** ¿Queda trabajo por hacer en esta sesión? */
export function isRunnable(session: ScreenAuditSession): boolean {
  return session.status === 'running' && session.currentIndex < session.total;
}

/** Elementos ya resueltos, en orden visual. */
export function resolvedItems(session: ScreenAuditSession): ScreenAuditItem[] {
  return session.items.filter(
    (item) => item.status === 'success' || item.status === 'changed',
  );
}

/**
 * ¿Un mensaje pertenece a esta sesión?
 *
 * No basta con el índice: una respuesta tardía de una auditoría anterior
 * podría caer en la posición equivalente de la nueva.
 */
export function belongsToSession(
  session: ScreenAuditSession | null,
  sessionId: string,
): boolean {
  return session !== null && session.sessionId === sessionId;
}

function assertNever(_value: never): never {
  throw new Error('Unhandled screen audit event.');
}

// --- Validación de contrato ---------------------------------------------------

function isItemStatus(value: unknown): value is ScreenAuditItemStatus {
  return value === 'pending' || value === 'running' || value === 'success'
    || value === 'changed' || value === 'error';
}

function isExecutionStatus(value: unknown): value is ScreenAuditExecutionStatus {
  return value === 'idle' || value === 'running' || value === 'paused'
    || value === 'completed' || value === 'invalidated';
}

function isTransport(value: unknown): boolean {
  return value === 'local' || value === 'cloud' || value === null;
}

function isItem(value: unknown): value is ScreenAuditItem {
  if (!isRecord(value)) {
    return false;
  }

  return isScreenAuditCandidateShape(value.candidate)
    && isItemStatus(value.status)
    && isTransport(value.transport)
    && (value.result === null || isAnalyzeResponse(value.result))
    && (value.error === null || isAnalyzeError(value.error));
}

function isScreenAuditCandidateShape(value: unknown): boolean {
  return isRecord(value)
    && typeof value.nodeId === 'string'
    && typeof value.text === 'string'
    && typeof value.context === 'string'
    && typeof value.layerName === 'string';
}

export function isScreenAuditSession(value: unknown): value is ScreenAuditSession {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.sessionId === 'string'
    && typeof value.frameId === 'string'
    && typeof value.frameName === 'string'
    && typeof value.selectionRevision === 'number'
    && isExecutionStatus(value.status)
    && typeof value.total === 'number'
    && typeof value.completed === 'number'
    && typeof value.changed === 'number'
    && typeof value.failed === 'number'
    && typeof value.currentIndex === 'number'
    && isTransport(value.executionTransport)
    && typeof value.cloudContinuationAvailable === 'boolean'
    && Array.isArray(value.items)
    && value.items.every(isItem);
}
