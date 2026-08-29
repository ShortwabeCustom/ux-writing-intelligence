export type AnalyzeSeverity = 'low' | 'medium' | 'high';

export interface AnalyzeRequest {
  text: string;
  context: string;
  locale: 'es-MX';
}

export interface AnalyzeIssue {
  category: string;
  severity: AnalyzeSeverity;
  term: string | null;
  reason: string;
}

export interface AnalyzeResponse {
  text: string;
  locale: string;
  score: number;
  severity: AnalyzeSeverity;
  clarity: number;
  concision: number;
  utility: number;
  jargon: boolean;
  predictability: number;
  orthography: number;
  issues: AnalyzeIssue[];
  reason: string;
  suggestion: string;
}

export type AnalyzeErrorCode =
  // Runtime local (FASE 8.5.4)
  | 'LOCAL_RUNTIME_UNAVAILABLE'
  | 'LOCAL_MODEL_NOT_AVAILABLE'
  | 'LOCAL_ANALYSIS_TIMEOUT'
  // Enrutamiento (FASE 8.5.5): el análisis se bloquea ANTES de enviar texto
  | 'CLOUD_NOT_CONFIGURED'
  | 'NO_ANALYSIS_ENGINE_AVAILABLE'
  // Nube (sin cambios)
  | 'MISSING_API_KEY'
  | 'INVALID_SELECTION'
  | 'STALE_SELECTION'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface AnalyzeError {
  code: AnalyzeErrorCode;
  retryAfterSeconds?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum;
}

export function isAnalyzeSeverity(value: unknown): value is AnalyzeSeverity {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function isAnalyzeIssue(value: unknown): value is AnalyzeIssue {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.category === 'string'
    && isAnalyzeSeverity(value.severity)
    && (typeof value.term === 'string' || value.term === null)
    && typeof value.reason === 'string';
}

export function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.text === 'string'
    && typeof value.locale === 'string'
    && isNumberInRange(value.score, 0, 100)
    && isAnalyzeSeverity(value.severity)
    && isNumberInRange(value.clarity, 1, 5)
    && isNumberInRange(value.concision, 1, 5)
    && isNumberInRange(value.utility, 1, 5)
    && typeof value.jargon === 'boolean'
    && isNumberInRange(value.predictability, 1, 5)
    && isNumberInRange(value.orthography, 1, 5)
    && Array.isArray(value.issues)
    && value.issues.every(isAnalyzeIssue)
    && typeof value.reason === 'string'
    && typeof value.suggestion === 'string';
}

export function parseAnalyzeResponse(value: unknown): AnalyzeResponse {
  if (!isAnalyzeResponse(value)) {
    throw new Error('INVALID_ANALYZE_RESPONSE');
  }

  return value;
}

export function isAnalyzeErrorCode(value: unknown): value is AnalyzeErrorCode {
  return value === 'LOCAL_RUNTIME_UNAVAILABLE'
    || value === 'LOCAL_MODEL_NOT_AVAILABLE'
    || value === 'LOCAL_ANALYSIS_TIMEOUT'
    || value === 'CLOUD_NOT_CONFIGURED'
    || value === 'NO_ANALYSIS_ENGINE_AVAILABLE'
    || value === 'MISSING_API_KEY'
    || value === 'INVALID_SELECTION'
    || value === 'STALE_SELECTION'
    || value === 'UNAUTHORIZED'
    || value === 'RATE_LIMITED'
    || value === 'SERVICE_UNAVAILABLE'
    || value === 'INVALID_RESPONSE'
    || value === 'NETWORK_ERROR'
    || value === 'UNKNOWN_ERROR';
}

export function isAnalyzeError(value: unknown): value is AnalyzeError {
  if (!isRecord(value) || !isAnalyzeErrorCode(value.code)) {
    return false;
  }

  return value.retryAfterSeconds === undefined
    || (
      typeof value.retryAfterSeconds === 'number'
      && Number.isSafeInteger(value.retryAfterSeconds)
      && value.retryAfterSeconds >= 0
    );
}
