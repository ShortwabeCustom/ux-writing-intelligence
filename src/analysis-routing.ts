/**
 * Política de enrutamiento de análisis (FASE 8.5.5).
 *
 * Función pura: decide QUÉ motor procesará el texto, antes de enviarlo.
 * No hace red, no lee almacenamiento y no conoce la API Key.
 *
 * PRINCIPIO CENTRAL DE PRIVACIDAD
 * ------------------------------------------------------------------
 * La nube solo puede elegirse automáticamente AQUÍ, es decir ANTES de que el
 * texto salga del plugin. Una vez que el POST local empezó, ningún fallo
 * puede reencaminar a la nube automáticamente: eso enviaría a un servicio
 * remoto un contenido que la persona pidió procesar localmente. Después del
 * POST solo existe la acción explícita de la persona usuaria.
 */
import type { AnalysisTransportKind } from './analysis-transport';
import type { AnalysisMode } from './analysis-mode';
import type { LocalRuntimeState } from './local-runtime-health';

export type AnalysisRouteReason =
  | 'AUTO_LOCAL_READY'
  | 'AUTO_LOCAL_UNAVAILABLE_CLOUD'
  | 'AUTO_MODEL_MISSING_CLOUD'
  | 'AUTO_DEGRADED_CLOUD'
  | 'LOCAL_ONLY'
  | 'CLOUD_ONLY';

export type AnalysisBlockedReason =
  | 'NO_LOCAL_NO_CLOUD'
  | 'LOCAL_ONLY_UNAVAILABLE'
  | 'LOCAL_ONLY_MODEL_MISSING'
  | 'CLOUD_NOT_CONFIGURED'
  | 'LOCAL_STATUS_UNKNOWN';

export type AnalysisRoute =
  | {
      status: 'ready';
      transport: AnalysisTransportKind;
      reason: AnalysisRouteReason;
    }
  | {
      status: 'blocked';
      reason: AnalysisBlockedReason;
    };

export interface AnalysisRouteInput {
  mode: AnalysisMode;
  localRuntimeState: LocalRuntimeState;
  cloudConfigured: boolean;
}

export function resolveAnalysisTransport(
  input: AnalysisRouteInput,
): AnalysisRoute {
  const { mode, localRuntimeState, cloudConfigured } = input;

  // SOLO NUBE. No se consulta el estado local: sería una comprobación inútil.
  if (mode === 'cloud') {
    return cloudConfigured
      ? { status: 'ready', transport: 'cloud', reason: 'CLOUD_ONLY' }
      : { status: 'blocked', reason: 'CLOUD_NOT_CONFIGURED' };
  }

  // SOLO LOCAL. Garantía de privacidad: nunca devuelve `cloud`, ni siquiera
  // con API Key configurada y motor local caído. Quien elige este modo está
  // afirmando que su contenido no sale de esta Mac.
  if (mode === 'local') {
    switch (localRuntimeState) {
      case 'ready':
        return { status: 'ready', transport: 'local', reason: 'LOCAL_ONLY' };
      case 'model_missing':
        return { status: 'blocked', reason: 'LOCAL_ONLY_MODEL_MISSING' };
      case 'checking':
        return { status: 'blocked', reason: 'LOCAL_STATUS_UNKNOWN' };
      default:
        return { status: 'blocked', reason: 'LOCAL_ONLY_UNAVAILABLE' };
    }
  }

  // AUTOMÁTICO. Local primero, siempre.
  if (localRuntimeState === 'ready') {
    return { status: 'ready', transport: 'local', reason: 'AUTO_LOCAL_READY' };
  }

  // Estado local aún desconocido: no se decide a ciegas. Quien llama debe
  // refrescar la salud antes de enrutar.
  if (localRuntimeState === 'checking') {
    return { status: 'blocked', reason: 'LOCAL_STATUS_UNKNOWN' };
  }

  if (!cloudConfigured) {
    return { status: 'blocked', reason: 'NO_LOCAL_NO_CLOUD' };
  }

  if (localRuntimeState === 'model_missing') {
    return {
      status: 'ready',
      transport: 'cloud',
      reason: 'AUTO_MODEL_MISSING_CLOUD',
    };
  }

  if (localRuntimeState === 'degraded') {
    return {
      status: 'ready',
      transport: 'cloud',
      reason: 'AUTO_DEGRADED_CLOUD',
    };
  }

  return {
    status: 'ready',
    transport: 'cloud',
    reason: 'AUTO_LOCAL_UNAVAILABLE_CLOUD',
  };
}

/**
 * ¿La ruta necesita conocer el estado del motor local?
 *
 * Solo NUBE puede prescindir de la comprobación (STEP 8).
 */
export function routeNeedsLocalStatus(mode: AnalysisMode): boolean {
  return mode !== 'cloud';
}
