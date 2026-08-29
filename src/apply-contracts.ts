import { isRecord } from './analyze-contracts';

export type ApplyErrorCode =
  | 'NO_ACTIVE_ANALYSIS'
  | 'STALE_ANALYSIS'
  | 'INVALID_SELECTION'
  | 'SELECTION_CHANGED'
  | 'TEXT_CHANGED'
  | 'EMPTY_SUGGESTION'
  | 'MISSING_FONT'
  | 'FONT_LOAD_FAILED'
  | 'MIXED_STYLES_UNSUPPORTED'
  | 'EDIT_FAILED'
  | 'UNKNOWN_ERROR';

export interface ApplyError {
  code: ApplyErrorCode;
}

export interface ApplySession {
  requestId: string;
  selectionRevision: number;
  nodeId: string;
  originalText: string;
  suggestion: string;
}

export interface ApplySuccessPayload {
  nodeId: string;
  previousText: string;
  appliedText: string;
  selectionRevision: number;
}

export function isApplyErrorCode(value: unknown): value is ApplyErrorCode {
  return value === 'NO_ACTIVE_ANALYSIS'
    || value === 'STALE_ANALYSIS'
    || value === 'INVALID_SELECTION'
    || value === 'SELECTION_CHANGED'
    || value === 'TEXT_CHANGED'
    || value === 'EMPTY_SUGGESTION'
    || value === 'MISSING_FONT'
    || value === 'FONT_LOAD_FAILED'
    || value === 'MIXED_STYLES_UNSUPPORTED'
    || value === 'EDIT_FAILED'
    || value === 'UNKNOWN_ERROR';
}

export function isApplyError(value: unknown): value is ApplyError {
  return isRecord(value) && isApplyErrorCode(value.code);
}

export function isApplySuccessPayload(value: unknown): value is ApplySuccessPayload {
  return isRecord(value)
    && typeof value.nodeId === 'string'
    && typeof value.previousText === 'string'
    && typeof value.appliedText === 'string'
    && typeof value.selectionRevision === 'number'
    && Number.isSafeInteger(value.selectionRevision)
    && value.selectionRevision >= 0;
}
