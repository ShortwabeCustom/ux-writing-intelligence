/**
 * Preferencia de motor de análisis (FASE 8.5.5).
 *
 * El modo vive en `clientStorage` bajo una clave propia. NUNCA comparte clave
 * con la API Key de la nube: son dos datos con ciclos de vida distintos y
 * mezclarlos haría que borrar uno destruyera el otro.
 */
import type { ClientStoragePort } from './api-key-storage';

export type AnalysisMode = 'auto' | 'local' | 'cloud';

export const ANALYSIS_MODE_STORAGE_KEY = 'ux-writing-analysis-mode';

/**
 * `auto` es el valor por defecto y también el de migración.
 *
 * Razón: preserva la continuidad del servicio para quien ya tenía API Key
 * configurada, prioriza el procesamiento local cuando está disponible y no
 * obliga a nadie a reconfigurar el plugin. Un default de `local` dejaría sin
 * servicio a quien no tiene el runtime instalado; uno de `cloud` enviaría
 * contenido a la nube sin necesidad.
 */
export const DEFAULT_ANALYSIS_MODE: AnalysisMode = 'auto';

export const ANALYSIS_MODE_LABEL: Record<AnalysisMode, string> = {
  auto: 'Automático',
  local: 'Solo local',
  cloud: 'Solo nube',
};

export function isAnalysisMode(value: unknown): value is AnalysisMode {
  return value === 'auto' || value === 'local' || value === 'cloud';
}

/**
 * Lee el modo persistido.
 *
 * Migración (STEP 3): si no hay valor almacenado —o si el valor guardado no
 * es reconocible— se devuelve `auto` sin escribir nada. No se toca la API Key
 * existente y no se le pide a nadie reconfigurar.
 */
export async function getAnalysisMode(
  storage: ClientStoragePort,
): Promise<AnalysisMode> {
  const storedValue = await storage.getAsync(ANALYSIS_MODE_STORAGE_KEY);
  return isAnalysisMode(storedValue) ? storedValue : DEFAULT_ANALYSIS_MODE;
}

/** Persiste el modo. Solo debe invocarse tras una acción explícita. */
export async function saveAnalysisMode(
  storage: ClientStoragePort,
  mode: AnalysisMode,
): Promise<void> {
  await storage.setAsync(ANALYSIS_MODE_STORAGE_KEY, mode);
}
