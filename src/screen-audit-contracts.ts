/**
 * Contratos de Screen Audit (FASE 9.0).
 *
 * ALCANCE: descubrimiento y preflight determinista. NO hay análisis de UX
 * Writing aquí. El preflight responde una sola pregunta:
 *
 *   «¿Este texto es estructuralmente apropiado para entrar, en una fase
 *    futura, a una auditoría de UX Writing?»
 *
 * NO responde si la redacción es buena o mala. Esa autoridad vive en el
 * runtime local (ortografía, glosario, fidelidad semántica, fronteras,
 * contenido protegido, puntuación) y NO se replica en TypeScript.
 */

export type ScreenAuditCandidateStatus = 'ready' | 'skipped';

export type ScreenAuditSkipReason =
  | 'empty'
  | 'hidden'
  | 'protected_only'
  | 'numeric_only'
  | 'non_language'
  | null;

export interface ScreenAuditCandidate {
  nodeId: string;
  /** Fuente EXACTA. Idéntica a `node.characters`, punto de código a punto de
   *  código. Nunca recortada, normalizada ni limpiada. */
  text: string;
  layerName: string;
  parentName: string | null;
  /** Posición estable dentro del preflight, ya ordenada visualmente. */
  order: number;
  status: ScreenAuditCandidateStatus;
  skipReason: ScreenAuditSkipReason;
  /** Preparado para la fase semántica futura. NO se envía a ninguna parte. */
  context: string;
}

export interface ScreenAuditPreflight {
  frameId: string;
  frameName: string;
  /** Revisión propia del preflight, independiente de la de Text Audit. */
  revision: number;
  detectedCount: number;
  eligibleCount: number;
  skippedCount: number;
  candidates: ScreenAuditCandidate[];
}

export function isScreenAuditSkipReason(
  value: unknown,
): value is ScreenAuditSkipReason {
  return value === null
    || value === 'empty'
    || value === 'hidden'
    || value === 'protected_only'
    || value === 'numeric_only'
    || value === 'non_language';
}

function isCandidate(value: unknown): value is ScreenAuditCandidate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.nodeId === 'string'
    && typeof candidate.text === 'string'
    && typeof candidate.layerName === 'string'
    && (typeof candidate.parentName === 'string' || candidate.parentName === null)
    && typeof candidate.order === 'number'
    && Number.isSafeInteger(candidate.order)
    && candidate.order >= 0
    && (candidate.status === 'ready' || candidate.status === 'skipped')
    && isScreenAuditSkipReason(candidate.skipReason)
    && typeof candidate.context === 'string';
}

export function isScreenAuditPreflight(
  value: unknown,
): value is ScreenAuditPreflight {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const preflight = value as Record<string, unknown>;

  return typeof preflight.frameId === 'string'
    && typeof preflight.frameName === 'string'
    && typeof preflight.revision === 'number'
    && Number.isSafeInteger(preflight.revision)
    && preflight.revision >= 0
    && typeof preflight.detectedCount === 'number'
    && typeof preflight.eligibleCount === 'number'
    && typeof preflight.skippedCount === 'number'
    && Array.isArray(preflight.candidates)
    && preflight.candidates.every(isCandidate);
}
