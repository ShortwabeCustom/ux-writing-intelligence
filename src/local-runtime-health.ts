/**
 * Salud del runtime local (FASE 8.5.4).
 *
 * Solo lectura de estado. NUNCA dispara inferencia: `/v1/runtime/status`
 * consulta el catálogo de modelos de Ollama, no genera texto.
 */
import type { FetchPort, FetchResponsePort } from './analyze-api';
import { LOCAL_STATUS_ENDPOINT, createLocalHeaders } from './analysis-transport';

export type LocalRuntimeState =
  | 'checking'
  | 'ready'
  | 'unavailable'
  | 'model_missing'
  | 'degraded';

export interface LocalRuntimeStatus {
  state: LocalRuntimeState;
  /** Nombre corto y presentable del modelo. Nunca detalles de infraestructura. */
  modelLabel: string | null;
}

interface RuntimeStatusBody {
  runtime?: unknown;
  ollama?: unknown;
  model?: unknown;
  model_available?: unknown;
}

/** «qwen3.5:4b» -> «Qwen 3.5». La UI no muestra etiquetas de infraestructura. */
export function formatModelLabel(model: unknown): string | null {
  if (typeof model !== 'string' || model.trim().length === 0) {
    return null;
  }

  const family = model.split(':')[0] ?? '';
  const match = /^([a-zA-Z]+)([\d.]*)$/u.exec(family);

  if (match === null) {
    return null;
  }

  const name = match[1] ?? '';
  const version = match[2] ?? '';
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);

  return version.length > 0 ? `${capitalized} ${version}` : capitalized;
}

export function interpretRuntimeStatus(body: unknown): LocalRuntimeStatus {
  if (typeof body !== 'object' || body === null) {
    return { state: 'degraded', modelLabel: null };
  }

  const parsed = body as RuntimeStatusBody;
  const modelLabel = formatModelLabel(parsed.model);

  if (parsed.ollama !== 'ready') {
    return { state: 'unavailable', modelLabel };
  }

  if (parsed.model_available !== true) {
    return { state: 'model_missing', modelLabel };
  }

  if (parsed.runtime !== 'ready') {
    return { state: 'degraded', modelLabel };
  }

  return { state: 'ready', modelLabel };
}

export async function checkLocalRuntime(
  fetchPort: FetchPort,
): Promise<LocalRuntimeStatus> {
  let response: FetchResponsePort;

  try {
    response = await fetchPort(LOCAL_STATUS_ENDPOINT, {
      method: 'GET',
      headers: createLocalHeaders(),
    });
  } catch {
    // El runtime no está corriendo: el fetch ni siquiera conecta.
    return { state: 'unavailable', modelLabel: null };
  }

  if (response.status !== 200) {
    return { state: 'unavailable', modelLabel: null };
  }

  try {
    return interpretRuntimeStatus(JSON.parse(await response.text()) as unknown);
  } catch {
    return { state: 'degraded', modelLabel: null };
  }
}
