import type { AnalyzeError, AnalyzeResponse } from './analyze-contracts';
import type { AnalysisTransportKind } from './analysis-transport';

/**
 * Procedencia del análisis (FASE 8.5.5.3).
 *
 * `transport` viaja DENTRO del estado, heredado de la carga que lo originó.
 * No se vuelve a deducir en ningún momento: ni del estado de salud del motor
 * local, ni del modo persistido, ni re-resolviendo la ruta. Un resultado de la
 * nube sigue siendo de la nube aunque el motor local vuelva a estar listo
 * mientras se mira en pantalla.
 */
export type AnalysisTransportProvenance = AnalysisTransportKind | null;

export type AnalysisUiState =
  | { status: 'idle' }
  | {
      status: 'loading';
      requestId: string | null;
      transport: AnalysisTransportProvenance;
    }
  | {
      status: 'success';
      requestId: string;
      result: AnalyzeResponse;
      transport: AnalysisTransportProvenance;
    }
  | {
      status: 'error';
      requestId: string | null;
      error: AnalyzeError;
      transport: AnalysisTransportProvenance;
    };

export type AnalysisUiEvent =
  | { type: 'ANALYZE_REQUESTED'; transport: AnalysisTransportProvenance }
  | { type: 'ANALYSIS_STARTED'; requestId: string; transport: AnalysisTransportKind }
  | { type: 'ANALYSIS_SUCCEEDED'; requestId: string; result: AnalyzeResponse }
  | {
      type: 'ANALYSIS_RESTORED';
      requestId: string;
      result: AnalyzeResponse;
      transport: AnalysisTransportKind;
    }
  | { type: 'ANALYSIS_FAILED'; requestId: string | null; error: AnalyzeError }
  | { type: 'ANALYSIS_VALIDATION_FAILED'; error: AnalyzeError }
  | { type: 'SELECTION_CHANGED' }
  | { type: 'API_KEY_CHANGED' };

export const INITIAL_ANALYSIS_STATE: AnalysisUiState = { status: 'idle' };

export function reduceAnalysisState(
  state: AnalysisUiState,
  event: AnalysisUiEvent,
): AnalysisUiState {
  switch (event.type) {
    case 'ANALYZE_REQUESTED':
      return state.status === 'loading'
        ? state
        : { status: 'loading', requestId: null, transport: event.transport };

    case 'ANALYSIS_STARTED':
      // El hilo principal es la autoridad sobre el transporte: aquí se fija el
      // que de verdad recibirá el texto.
      return state.status === 'loading' && state.requestId === null
        ? {
            status: 'loading',
            requestId: event.requestId,
            transport: event.transport,
          }
        : state;

    case 'ANALYSIS_SUCCEEDED':
      // La procedencia se HEREDA de la carga; nunca se recalcula.
      return state.status === 'loading' && state.requestId === event.requestId
        ? {
            status: 'success',
            requestId: event.requestId,
            result: event.result,
            transport: state.transport,
          }
        : state;

    case 'ANALYSIS_RESTORED':
      return {
        status: 'success',
        requestId: event.requestId,
        result: event.result,
        transport: event.transport,
      };

    case 'ANALYSIS_FAILED':
      if (state.status !== 'loading') {
        return state;
      }

      if (event.requestId !== null && state.requestId !== event.requestId) {
        return state;
      }

      if (event.requestId === null && state.requestId !== null) {
        return state;
      }

      return {
        status: 'error',
        requestId: event.requestId,
        error: event.error,
        transport: state.transport,
      };

    case 'ANALYSIS_VALIDATION_FAILED':
      // Fallo de validación: no llegó a elegirse transporte.
      return {
        status: 'error',
        requestId: null,
        error: event.error,
        transport: state.status === 'loading' ? state.transport : null,
      };

    case 'SELECTION_CHANGED':
    case 'API_KEY_CHANGED':
      return INITIAL_ANALYSIS_STATE;

    default:
      return assertNever(event);
  }
}

export function canRequestAnalysis(state: AnalysisUiState): boolean {
  return state.status !== 'loading';
}

/** Transporte que produjo lo que se está mostrando. */
export function getAnalysisProvenance(
  state: AnalysisUiState,
): AnalysisTransportProvenance {
  return state.status === 'idle' ? null : state.transport;
}

function assertNever(_value: never): never {
  throw new Error('Unhandled analysis event.');
}
