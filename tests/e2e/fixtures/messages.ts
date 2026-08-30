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
