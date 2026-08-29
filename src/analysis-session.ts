import type {
  SelectionSnapshot,
  SelectionState,
  UiToMainMessage,
} from './shared/messages';
import type { ApplySession } from './apply-contracts';

export interface AnalysisContext {
  requestId: string;
  requestToken: number;
  selectionRevision: number;
  nodeId: string;
  originalText: string;
}

export function createAnalysisRequestMessage(
  selection: SelectionSnapshot,
): UiToMainMessage | null {
  return selection.status === 'ready'
    ? {
        type: 'ANALYZE_REQUEST',
        selectionRevision: selection.revision,
      }
    : null;
}

export function createApplySession(
  context: AnalysisContext,
  suggestion: string,
): ApplySession {
  return {
    requestId: context.requestId,
    selectionRevision: context.selectionRevision,
    nodeId: context.nodeId,
    originalText: context.originalText,
    suggestion,
  };
}

export type AnalysisSelectionValidation =
  | {
      valid: true;
      nodeId: string;
      originalText: string;
    }
  | {
      valid: false;
      code: 'INVALID_SELECTION' | 'STALE_SELECTION';
    };

export function validateAnalysisSelection(
  requestedRevision: number,
  snapshot: SelectionSnapshot,
  currentSelection: SelectionState,
): AnalysisSelectionValidation {
  if (requestedRevision !== snapshot.revision) {
    return { valid: false, code: 'STALE_SELECTION' };
  }

  if (snapshot.status !== 'ready' || currentSelection.status !== 'ready') {
    return { valid: false, code: 'INVALID_SELECTION' };
  }

  if (
    currentSelection.nodeId !== snapshot.nodeId
    || currentSelection.text !== snapshot.text
  ) {
    return { valid: false, code: 'STALE_SELECTION' };
  }

  return {
    valid: true,
    nodeId: currentSelection.nodeId,
    originalText: currentSelection.text,
  };
}

export function isAnalysisContextCurrent(
  context: AnalysisContext,
  activeRequestToken: number,
  selectionRevision: number,
  currentSelection: SelectionState,
): boolean {
  return context.requestToken === activeRequestToken
    && context.selectionRevision === selectionRevision
    && currentSelection.status === 'ready'
    && currentSelection.nodeId === context.nodeId
    && currentSelection.text === context.originalText;
}
