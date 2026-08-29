import type { AnalyzeError, AnalyzeResponse } from './analyze-contracts';

export type AnalysisUiState =
  | { status: 'idle' }
  | { status: 'loading'; requestId: string | null }
  | { status: 'success'; requestId: string; result: AnalyzeResponse }
  | { status: 'error'; requestId: string | null; error: AnalyzeError };

export type AnalysisUiEvent =
  | { type: 'ANALYZE_REQUESTED' }
  | { type: 'ANALYSIS_STARTED'; requestId: string }
  | { type: 'ANALYSIS_SUCCEEDED'; requestId: string; result: AnalyzeResponse }
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
        : { status: 'loading', requestId: null };

    case 'ANALYSIS_STARTED':
      return state.status === 'loading' && state.requestId === null
        ? { status: 'loading', requestId: event.requestId }
        : state;

    case 'ANALYSIS_SUCCEEDED':
      return state.status === 'loading' && state.requestId === event.requestId
        ? { status: 'success', requestId: event.requestId, result: event.result }
        : state;

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
      };

    case 'ANALYSIS_VALIDATION_FAILED':
      return {
        status: 'error',
        requestId: null,
        error: event.error,
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

function assertNever(_value: never): never {
  throw new Error('Unhandled analysis event.');
}
