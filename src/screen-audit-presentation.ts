/**
 * Presentación del preflight (FASE 9.1).
 *
 * Traduce el resultado determinista a lenguaje de producto. Nunca expone
 * identificadores internos, valores de enumeración ni vocabulario técnico.
 */
import type { AnalysisTransportKind } from './analysis-transport';
import type { ScreenAuditItem, ScreenAuditSession } from './screen-audit-session';
import type {
  ScreenAuditCandidate,
  ScreenAuditPreflight,
  ScreenAuditSkipReason,
} from './screen-audit-contracts';

/** Longitud del recorte VISUAL. La fuente almacenada nunca se recorta. */
export const PREVIEW_MAX_LENGTH = 64;

export function describeSkipReason(reason: ScreenAuditSkipReason): string {
  switch (reason) {
    case 'empty':
      return 'Texto vacío';
    case 'hidden':
      return 'Texto oculto';
    case 'protected_only':
      return 'Solo contiene contenido dinámico';
    case 'numeric_only':
      return 'Solo contiene números o valores';
    case 'non_language':
      return 'No contiene texto de interfaz';
    case null:
      return '';
    default:
      return '';
  }
}

/**
 * Recorte para mostrar. Solo afecta a lo que se pinta.
 *
 * Los saltos de línea se representan con un separador para que una vista
 * previa de una línea no colapse el contenido de forma engañosa.
 */
export function previewText(text: string): string {
  const singleLine = text.replace(/\s*\n\s*/gu, ' ⏎ ');

  return singleLine.length <= PREVIEW_MAX_LENGTH
    ? singleLine
    : `${singleLine.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

/**
 * Resumen en lenguaje de producto.
 *
 * NOTA DELIBERADA: se dice «listos para auditar», no «resueltos» ni «no
 * necesitan IA». En esta fase solo sabemos qué es estructuralmente apto y qué
 * se descartó de forma determinista. Todavía no se ha evaluado la calidad de
 * ningún texto, y afirmarlo sería mentir.
 */
export function describeCounts(preflight: ScreenAuditPreflight): {
  ready: string;
  skipped: string;
} {
  const { eligibleCount, skippedCount } = preflight;

  return {
    ready: eligibleCount === 1
      ? '1 texto listo para auditar'
      : `${eligibleCount} textos listos para auditar`,
    skipped: skippedCount === 1
      ? '1 omitido automáticamente'
      : `${skippedCount} omitidos automáticamente`,
  };
}

export interface CandidateDisplay {
  layerName: string;
  preview: string;
  reason: string;
}

export function toDisplay(candidate: ScreenAuditCandidate): CandidateDisplay {
  return {
    layerName: candidate.layerName,
    preview: previewText(candidate.text),
    reason: describeSkipReason(candidate.skipReason),
  };
}

/** Candidatos listos, en orden visual. */
export function readyCandidates(
  preflight: ScreenAuditPreflight,
): ScreenAuditCandidate[] {
  return preflight.candidates.filter((c) => c.status === 'ready');
}

/** Candidatos omitidos, en orden visual. */
export function skippedCandidates(
  preflight: ScreenAuditPreflight,
): ScreenAuditCandidate[] {
  return preflight.candidates.filter((c) => c.status === 'skipped');
}

// --- Ejecución (FASE 9.2B) ---------------------------------------------------

/**
 * Progreso REAL, por elementos completados.
 *
 * Nunca una estimación temporal: la regeneración semántica puede duplicar la
 * latencia de un texto y no se sabe de antemano cuál la disparará, así que
 * cualquier porcentaje basado en tiempo sería una invención.
 */
export function describeProgress(session: ScreenAuditSession): string {
  const noun = session.total === 1 ? 'texto' : 'textos';

  if (session.status === 'completed') {
    return `${session.completed} de ${session.total} ${noun} revisados`;
  }

  return `${session.completed} de ${session.total} analizados`;
}

export function describeChanged(session: ScreenAuditSession): string {
  if (session.changed === 0) {
    return '';
  }

  return session.changed === 1
    ? '1 cambió durante la auditoría'
    : `${session.changed} cambiaron durante la auditoría`;
}

export function progressRatio(session: ScreenAuditSession): number {
  if (session.total === 0) {
    return 0;
  }

  const resolved = session.completed + session.changed;
  return Math.min(1, resolved / session.total);
}

export function describeExecutionTransport(
  transport: AnalysisTransportKind | null,
): string {
  if (transport === 'local') {
    return 'Procesado en esta Mac';
  }

  if (transport === 'cloud') {
    return 'Procesamiento mediante servicio en la nube';
  }

  return '';
}

/** Procedencia de UN resultado. Nunca se deduce del estado del motor. */
export function describeItemProvenance(item: ScreenAuditItem): string {
  if (item.status === 'changed') {
    return 'El texto cambió durante la auditoría';
  }

  return item.transport === 'cloud' ? 'Nube' : 'Local';
}

export function describeAuditTitle(session: ScreenAuditSession): string {
  switch (session.status) {
    case 'completed':
      return 'Auditoría completada';
    case 'paused':
      return 'Auditoría en pausa';
    default:
      return 'Auditando pantalla';
  }
}
