import type {
  AnalyzeError,
  AnalyzeErrorCode,
  AnalyzeRequest,
  AnalyzeResponse,
} from './analyze-contracts';
import { parseAnalyzeResponse } from './analyze-contracts';

export const ANALYZE_ENDPOINT = 'https://writing.productdesign.mx/v1/analyze/text';
export const ANALYZE_CONTEXT = 'Texto de interfaz seleccionado en Figma';

export interface FetchOptionsPort {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponsePort {
  status: number;
  headersObject: Record<string, string>;
  text(): Promise<string>;
}

export type FetchPort = (
  url: string,
  options?: FetchOptionsPort,
) => Promise<FetchResponsePort>;

export class AnalyzeApiError extends Error {
  readonly details: AnalyzeError;

  constructor(code: AnalyzeErrorCode, retryAfterSeconds?: number) {
    super(code);
    this.name = 'AnalyzeApiError';
    this.details = retryAfterSeconds === undefined
      ? { code }
      : { code, retryAfterSeconds };
  }
}

export function createAnalyzeRequest(text: string): AnalyzeRequest {
  return {
    text,
    context: ANALYZE_CONTEXT,
    locale: 'es-MX',
  };
}

export function parseRetryAfterSeconds(
  headers: Record<string, string>,
): number | undefined {
  const retryAfterEntry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'retry-after',
  );
  const value = retryAfterEntry?.[1]?.trim();

  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

export function mapHttpError(
  status: number,
  headers: Record<string, string>,
): AnalyzeApiError {
  if (status === 401 || status === 403) {
    return new AnalyzeApiError('UNAUTHORIZED');
  }

  if (status === 429) {
    return new AnalyzeApiError(
      'RATE_LIMITED',
      parseRetryAfterSeconds(headers),
    );
  }

  if (status === 502) {
    return new AnalyzeApiError('INVALID_RESPONSE');
  }

  if (status === 503 || status === 504) {
    return new AnalyzeApiError('SERVICE_UNAVAILABLE');
  }

  return new AnalyzeApiError('UNKNOWN_ERROR');
}

export async function analyzeText(
  fetchPort: FetchPort,
  apiKey: string,
  text: string,
): Promise<AnalyzeResponse> {
  if (apiKey.trim().length === 0) {
    throw new AnalyzeApiError('MISSING_API_KEY');
  }

  let response: FetchResponsePort;

  try {
    response = await fetchPort(ANALYZE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(createAnalyzeRequest(text)),
    });
  } catch {
    throw new AnalyzeApiError('NETWORK_ERROR');
  }

  if (response.status !== 200) {
    throw mapHttpError(response.status, response.headersObject);
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new AnalyzeApiError('INVALID_RESPONSE');
  }

  try {
    return parseAnalyzeResponse(parsedBody);
  } catch {
    throw new AnalyzeApiError('INVALID_RESPONSE');
  }
}
