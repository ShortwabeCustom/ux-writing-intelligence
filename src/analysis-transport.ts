/**
 * Abstracción de transporte de análisis (FASE 8.5.4).
 *
 * Existe para que la elección local/nube ocurra en UN solo lugar. Sin esto,
 * los condicionales de localhost se esparcirían por el pipeline y cada rama
 * (Analizar, Analizar de nuevo, ortografía, texto largo) podría divergir.
 *
 * Ambos transportes producen el MISMO `AnalyzeResponse` y se validan con el
 * MISMO validador. La diferencia está en la URL, en los encabezados y en el
 * mapeo de errores; nada más.
 */
import type { AnalyzeRequest, AnalyzeResponse } from './analyze-contracts';
import { parseAnalyzeResponse } from './analyze-contracts';
import type { FetchPort, FetchResponsePort } from './analyze-api';
import {
  AnalyzeApiError,
  ANALYZE_ENDPOINT,
  analyzeText,
  createAnalyzeRequest,
} from './analyze-api';

export type AnalysisTransportKind = 'local' | 'cloud';

export interface AnalysisTransport {
  readonly kind: AnalysisTransportKind;
  analyze(request: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse>;
}

/** Base del runtime local. Se usa `localhost` de cara al plugin; el runtime
 *  sigue bindeado a 127.0.0.1. */
export const LOCAL_RUNTIME_BASE = 'http://localhost:8787';
export const LOCAL_ANALYZE_ENDPOINT = `${LOCAL_RUNTIME_BASE}/v1/analyze/text`;
export const LOCAL_HEALTH_ENDPOINT = `${LOCAL_RUNTIME_BASE}/health`;
export const LOCAL_STATUS_ENDPOINT = `${LOCAL_RUNTIME_BASE}/v1/runtime/status`;

/**
 * Encabezados del transporte local.
 *
 * SOLO `Content-Type`. Nunca `X-API-Key`, `Authorization` ni ningún secreto
 * de la nube: el runtime local no autentica y enviarle la clave la expondría
 * a un proceso local sin necesidad alguna. Es un requisito bloqueante de
 * release, con prueba de regresión en tests/transport.test.mjs.
 */
export function createLocalHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

export function createCloudHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-API-Key': apiKey };
}

interface LocalErrorBody {
  code?: unknown;
}

/** Mapea los códigos del runtime local al contrato de errores del plugin. */
export function mapLocalError(status: number, body: string): AnalyzeApiError {
  let runtimeCode: string | undefined;

  try {
    const parsed = JSON.parse(body) as LocalErrorBody;
    if (typeof parsed.code === 'string') {
      runtimeCode = parsed.code;
    }
  } catch {
    runtimeCode = undefined;
  }

  if (runtimeCode === 'MODEL_NOT_AVAILABLE') {
    return new AnalyzeApiError('LOCAL_MODEL_NOT_AVAILABLE');
  }

  if (runtimeCode === 'MODEL_TIMEOUT') {
    return new AnalyzeApiError('LOCAL_ANALYSIS_TIMEOUT');
  }

  if (runtimeCode === 'OLLAMA_UNAVAILABLE') {
    return new AnalyzeApiError('LOCAL_RUNTIME_UNAVAILABLE');
  }

  if (runtimeCode === 'INVALID_MODEL_RESPONSE') {
    return new AnalyzeApiError('INVALID_RESPONSE');
  }

  if (status === 504) {
    return new AnalyzeApiError('LOCAL_ANALYSIS_TIMEOUT');
  }

  if (status === 503) {
    return new AnalyzeApiError('LOCAL_RUNTIME_UNAVAILABLE');
  }

  if (status === 502) {
    return new AnalyzeApiError('INVALID_RESPONSE');
  }

  return new AnalyzeApiError('UNKNOWN_ERROR');
}

async function readBody(response: FetchResponsePort): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function createLocalAnalysisTransport(fetchPort: FetchPort): AnalysisTransport {
  return {
    kind: 'local',
    async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
      let response: FetchResponsePort;

      try {
        response = await fetchPort(LOCAL_ANALYZE_ENDPOINT, {
          method: 'POST',
          headers: createLocalHeaders(),
          body: JSON.stringify(request),
        });
      } catch {
        // Si el runtime local no está corriendo, el fetch falla en la capa de
        // transporte. Eso no es un "error de red" genérico: es el motor local
        // apagado, y la persona necesita saber exactamente eso.
        throw new AnalyzeApiError('LOCAL_RUNTIME_UNAVAILABLE');
      }

      if (response.status !== 200) {
        throw mapLocalError(response.status, await readBody(response));
      }

      let parsedBody: unknown;

      try {
        parsedBody = JSON.parse(await response.text()) as unknown;
      } catch {
        throw new AnalyzeApiError('INVALID_RESPONSE');
      }

      let result: AnalyzeResponse;

      try {
        result = parseAnalyzeResponse(parsedBody);
      } catch {
        throw new AnalyzeApiError('INVALID_RESPONSE');
      }

      // Fuente de la verdad (STEP 16): el runtime debe devolver el texto de
      // origen intacto. Si no coincide carácter por carácter, la respuesta no
      // es confiable y no debe llegar a la UI ni alimentar Apply.
      // Esta comprobación es exclusiva del transporte local: la nube conserva
      // su comportamiento actual sin cambios.
      if (result.text !== request.text) {
        throw new AnalyzeApiError('INVALID_RESPONSE');
      }

      return result;
    },
  };
}

/**
 * Transporte de nube.
 *
 * Delega en `analyzeText`, la implementación de nube que ya existía y que sus
 * pruebas cubren. No se reimplementa aquí: dos copias del mismo transporte
 * acabarían divergiendo, y la nube debe comportarse exactamente igual que
 * antes de esta fase.
 */
export function createCloudAnalysisTransport(
  fetchPort: FetchPort,
  apiKey: string,
): AnalysisTransport {
  return {
    kind: 'cloud',
    analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
      return analyzeText(fetchPort, apiKey, request.text);
    },
  };
}

/**
 * Política de transporte de FASE 8.5.4.
 *
 * LOCAL es la ruta activa. La nube permanece compilada, probada y disponible,
 * pero NO se invoca automáticamente cuando el local falla: durante QA
 * necesitamos ver los fallos locales, no esconderlos tras un fallback.
 * La política de fallback pertenece a FASE 8.5.5.
 */
export const ACTIVE_TRANSPORT_KIND: AnalysisTransportKind = 'local';

export function selectAnalysisTransport(
  fetchPort: FetchPort,
  apiKey: string | null,
): AnalysisTransport {
  if (ACTIVE_TRANSPORT_KIND === 'local') {
    return createLocalAnalysisTransport(fetchPort);
  }

  return createCloudAnalysisTransport(fetchPort, apiKey ?? '');
}

/** El transporte local no requiere API Key; la nube sí. */
export function transportRequiresApiKey(kind: AnalysisTransportKind): boolean {
  return kind === 'cloud';
}

export { createAnalyzeRequest };
