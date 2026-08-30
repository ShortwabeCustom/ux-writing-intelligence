/**
 * Constructores de mensajes MAIN -> UI para las pruebas de interfaz.
 *
 * Se importan los tipos reales del producto: si un contrato cambia, esto deja
 * de compilar en vez de fallar silenciosamente en tiempo de ejecución.
 */
import type {
  MainToUiMessage,
  SelectionSnapshot,
} from '../../../src/shared/messages';
import type { AnalyzeResponse } from '../../../src/analyze-contracts';
import type { ScreenAuditPreflight } from '../../../src/screen-audit-contracts';

export const GOOD_RESULT: AnalyzeResponse = {
  text: 'Tu visita ha sido confirmada.',
  locale: 'es-MX',
  score: 100,
  severity: 'low',
  clarity: 5,
  concision: 5,
  utility: 5,
  jargon: false,
  predictability: 5,
  orthography: 5,
  issues: [],
  reason: 'El texto es claro, conciso y fácil de interpretar.',
  suggestion: 'Tu visita ha sido confirmada.',
};

export const RESULT_WITH_CHANGE: AnalyzeResponse = {
  ...GOOD_RESULT,
  text: 'prestamo',
  score: 97,
  orthography: 4,
  issues: [{
    category: 'orthography',
    severity: 'medium',
    term: 'prestamo',
    reason: 'Falta la tilde en «préstamo».',
  }],
  reason: 'Corregir la ortografía evita dudas sobre el contenido.',
  suggestion: 'préstamo',
};

export function selection(snapshot: SelectionSnapshot): MainToUiMessage {
  return { type: 'SELECTION_CHANGED', payload: snapshot };
}

export const TEXT_SELECTION: SelectionSnapshot = {
  status: 'ready',
  revision: 1,
  nodeId: 't1',
  nodeName: 'CTA',
  text: 'prestamo',
};

export const FRAME_SELECTION: SelectionSnapshot = {
  status: 'frame',
  revision: 2,
  nodeId: 'f1',
  nodeName: 'Domicilio',
};

export function unsupportedSelection(nodeType: string, nodeName: string): SelectionSnapshot {
  return { status: 'invalid-selection', revision: 3, nodeType, nodeName };
}

export const MULTIPLE_SELECTION: SelectionSnapshot = {
  status: 'multiple-selection',
  revision: 4,
  count: 3,
};

export function runtimeStatus(
  state: 'checking' | 'ready' | 'unavailable' | 'model_missing' | 'degraded',
  modelLabel: string | null = 'Qwen 3.5',
): MainToUiMessage {
  return { type: 'LOCAL_RUNTIME_STATUS', payload: { state, modelLabel } };
}

export function analysisMode(mode: 'auto' | 'local' | 'cloud'): MainToUiMessage {
  return { type: 'ANALYSIS_MODE_STATUS', payload: { mode } };
}

export function apiKeyStatus(configured: boolean): MainToUiMessage {
  return { type: 'API_KEY_STATUS', payload: { configured } };
}

export function analysisStarted(
  transport: 'local' | 'cloud',
  requestId = 'analysis-1',
): MainToUiMessage {
  return { type: 'ANALYSIS_STARTED', requestId, transport };
}

export function analysisSucceeded(
  result: AnalyzeResponse,
  requestId = 'analysis-1',
): MainToUiMessage {
  return { type: 'ANALYSIS_SUCCEEDED', requestId, result };
}

export function analysisFailed(
  code: string,
  cloudRetryAvailable = false,
  requestId: string | null = 'analysis-1',
): MainToUiMessage {
  return {
    type: 'ANALYSIS_FAILED',
    requestId,
    error: { code },
    cloudRetryAvailable,
  } as MainToUiMessage;
}

export function applyBlocked(code: string, requestId = 'analysis-1'): MainToUiMessage {
  return { type: 'APPLY_BLOCKED', requestId, error: { code } } as MainToUiMessage;
}

/** Preflight con contenido variado: listos y omitidos por motivos distintos. */
export function preflight(
  overrides: Partial<ScreenAuditPreflight> = {},
): MainToUiMessage {
  const candidates: ScreenAuditPreflight['candidates'] = [
    {
      nodeId: 'n1',
      text: 'Tu visita ha sido confirmada',
      layerName: 'Título',
      parentName: 'Header',
      order: 0,
      status: 'ready',
      skipReason: null,
      context: 'Pantalla: Domicilio. Capa: Título. Contenedor: Header.',
    },
    {
      nodeId: 'n2',
      text: 'Continuar',
      layerName: 'CTA',
      parentName: 'Footer',
      order: 1,
      status: 'ready',
      skipReason: null,
      context: 'Pantalla: Domicilio. Capa: CTA. Contenedor: Footer.',
    },
    {
      nodeId: 'n3',
      text: '9:41',
      layerName: 'Hora',
      parentName: 'Status bar',
      order: 2,
      status: 'skipped',
      skipReason: 'numeric_only',
      context: 'Pantalla: Domicilio. Capa: Hora. Contenedor: Status bar.',
    },
    {
      nodeId: 'n4',
      text: '{{Jueves 10 de abril}}',
      layerName: 'Fecha',
      parentName: 'Body',
      order: 3,
      status: 'skipped',
      skipReason: 'protected_only',
      context: 'Pantalla: Domicilio. Capa: Fecha. Contenedor: Body.',
    },
    {
      nodeId: 'n5',
      text: 'Oculto',
      layerName: 'Aviso',
      parentName: 'Body',
      order: 4,
      status: 'skipped',
      skipReason: 'hidden',
      context: 'Pantalla: Domicilio. Capa: Aviso. Contenedor: Body.',
    },
  ];

  const resolved: ScreenAuditPreflight = {
    frameId: 'f1',
    frameName: 'Domicilio',
    revision: 2,
    detectedCount: candidates.length,
    eligibleCount: candidates.filter((c) => c.status === 'ready').length,
    skippedCount: candidates.filter((c) => c.status === 'skipped').length,
    candidates,
    ...overrides,
  };

  return { type: 'SCREEN_PREFLIGHT_READY', payload: { preflight: resolved } };
}


// --- Ejecución de Screen Audit (FASE 9.2B) -----------------------------------

import type { ScreenAuditItem, ScreenAuditSession } from '../../../src/screen-audit-session';
import type { AnalysisTransportKind } from '../../../src/analysis-transport';

function auditCandidate(index: number, text: string, layerName: string) {
  return {
    nodeId: `n${index}`,
    text,
    layerName,
    parentName: 'Body',
    order: index,
    status: 'ready' as const,
    skipReason: null,
    context: `Pantalla: Domicilio. Capa: ${layerName}.`,
  };
}

export const AUDIT_CANDIDATES = [
  auditCandidate(0, 'Tu visita ha sido confirmada', 'Título'),
  auditCandidate(1, 'Continuar', 'CTA'),
  auditCandidate(2, 'Cancelar', 'CTA secundario'),
];

function itemFor(index: number): ScreenAuditItem {
  return {
    candidate: AUDIT_CANDIDATES[index]!,
    status: 'pending',
    transport: null,
    result: null,
    error: null,
  };
}

/** Sesión base: recién arrancada, sin nada resuelto. */
export function auditSession(
  overrides: Partial<ScreenAuditSession> = {},
): ScreenAuditSession {
  return {
    sessionId: 'screen-1',
    frameId: 'f1',
    frameName: 'Domicilio',
    selectionRevision: FRAME_SELECTION.revision,
    status: 'running',
    total: AUDIT_CANDIDATES.length,
    completed: 0,
    changed: 0,
    failed: 0,
    currentIndex: 0,
    executionTransport: 'local',
    cloudContinuationAvailable: false,
    items: AUDIT_CANDIDATES.map((_, index) => itemFor(index)),
    ...overrides,
  };
}

/** Aplica un resultado a un elemento, como haría el hilo principal. */
export function withResult(
  session: ScreenAuditSession,
  index: number,
  transport: AnalysisTransportKind,
  score = 96,
): ScreenAuditSession {
  const candidate = AUDIT_CANDIDATES[index]!;
  const items = session.items.map((item, position) => (
    position === index
      ? {
          ...item,
          status: 'success' as const,
          transport,
          result: { ...GOOD_RESULT, text: candidate.text, suggestion: candidate.text, score },
        }
      : item
  ));

  const completed = session.completed + 1;
  const currentIndex = index + 1;

  return {
    ...session,
    items,
    completed,
    currentIndex,
    status: currentIndex >= session.total ? 'completed' : 'running',
  };
}

export function withChanged(
  session: ScreenAuditSession,
  index: number,
): ScreenAuditSession {
  const items = session.items.map((item, position) => (
    position === index ? { ...item, status: 'changed' as const } : item
  ));
  const currentIndex = index + 1;

  return {
    ...session,
    items,
    changed: session.changed + 1,
    currentIndex,
    status: currentIndex >= session.total ? 'completed' : 'running',
  };
}

export function withFailure(
  session: ScreenAuditSession,
  index: number,
  cloudContinuationAvailable: boolean,
): ScreenAuditSession {
  const items = session.items.map((item, position) => (
    position === index
      ? {
          ...item,
          status: 'error' as const,
          transport: 'local' as const,
          error: { code: 'LOCAL_RUNTIME_UNAVAILABLE' as const },
        }
      : item
  ));

  return {
    ...session,
    items,
    status: 'paused',
    failed: 1,
    currentIndex: index,
    cloudContinuationAvailable,
  };
}

export function auditUpdate(session: ScreenAuditSession): MainToUiMessage {
  return { type: 'SCREEN_AUDIT_UPDATED', payload: { session } };
}

/** Preflight coherente con la sesión de ejecución. */
export function auditPreflight(): MainToUiMessage {
  return preflight({
    detectedCount: AUDIT_CANDIDATES.length,
    eligibleCount: AUDIT_CANDIDATES.length,
    skippedCount: 0,
    candidates: AUDIT_CANDIDATES,
  });
}
