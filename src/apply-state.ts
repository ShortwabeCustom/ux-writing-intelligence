import type { ApplyError, ApplySuccessPayload } from './apply-contracts';
import { getApplyRecoverability } from './error-experience';

export type ApplyUiState =
  | { status: 'idle' }
  | { status: 'applying'; requestId: string }
  | { status: 'blocked'; requestId: string; error: ApplyError }
  | { status: 'success'; requestId: string; payload: ApplySuccessPayload }
  | { status: 'error'; requestId: string | null; error: ApplyError };

export type ApplyUiEvent =
  | { type: 'APPLY_REQUESTED'; requestId: string }
  | { type: 'APPLY_STARTED'; requestId: string }
  | { type: 'APPLY_BLOCKED'; requestId: string; error: ApplyError }
  | { type: 'APPLY_SUCCEEDED'; requestId: string; payload: ApplySuccessPayload }
  | { type: 'APPLY_FAILED'; requestId: string | null; error: ApplyError }
  | { type: 'SELECTION_CHANGED' }
  | { type: 'ANALYZE_REQUESTED' };

export const INITIAL_APPLY_STATE: ApplyUiState = { status: 'idle' };

export function isApplyBlockingError(error: ApplyError): boolean {
  return getApplyRecoverability(error.code) !== 'retryable';
}

export function canRequestApply(state: ApplyUiState): boolean {
  return state.status === 'idle' || state.status === 'error';
}

export function reduceApplyState(
  state: ApplyUiState,
  event: ApplyUiEvent,
): ApplyUiState {
  switch (event.type) {
    case 'APPLY_REQUESTED':
      return state.status === 'applying'
        ? state
        : { status: 'applying', requestId: event.requestId };

    case 'APPLY_STARTED':
      return state.status === 'applying' && state.requestId === event.requestId
        ? state
        : state;

    case 'APPLY_BLOCKED':
      return {
        status: 'blocked',
        requestId: event.requestId,
        error: event.error,
      };

    case 'APPLY_SUCCEEDED':
      return state.status === 'applying' && state.requestId === event.requestId
        ? {
            status: 'success',
            requestId: event.requestId,
            payload: event.payload,
          }
        : state;

    case 'APPLY_FAILED':
      if (state.status !== 'applying') {
        return state;
      }

      if (event.requestId !== null && event.requestId !== state.requestId) {
        return state;
      }

      return isApplyBlockingError(event.error)
        ? {
            status: 'blocked',
            requestId: event.requestId ?? state.requestId,
            error: event.error,
          }
        : {
            status: 'error',
            requestId: event.requestId,
            error: event.error,
          };

    case 'SELECTION_CHANGED':
      return state.status === 'applying' ? state : INITIAL_APPLY_STATE;

    case 'ANALYZE_REQUESTED':
      return INITIAL_APPLY_STATE;

    default:
      return assertNever(event);
  }
}

function assertNever(_value: never): never {
  throw new Error('Unhandled apply event.');
}
