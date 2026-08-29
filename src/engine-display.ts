/**
 * Qué motor se anuncia en la interfaz (FASE 8.5.5.2).
 *
 * Función pura, extraída de la UI para poder probarla.
 *
 * REGLA CENTRAL: el estado del motor local y el transporte en uso son cosas
 * distintas. Con el motor local caído y un retry explícito a la nube, el motor
 * activo es la NUBE, aunque la salud local diga «no disponible». Derivar la
 * etiqueta solo de `localRuntimeState` fue el defecto 2 de esta fase: la
 * interfaz decía «Local» mientras el contenido se procesaba en la nube.
 */
import type { AnalysisMode } from './analysis-mode';
import type { AnalysisRoute } from './analysis-routing';
import type { AnalysisTransportKind } from './analysis-transport';

export type EngineDisplayKind = 'local' | 'cloud' | 'blocked' | 'unknown';

export interface EngineDisplay {
  kind: EngineDisplayKind;
  name: string;
  detail: string;
  /** ¿Ofrecer «Comprobar de nuevo»? */
  showRecheck: boolean;
}

export interface EngineDisplayInput {
  /** Transporte de la petición en curso o de la ya mostrada. `null` si no hay. */
  activeTransport: AnalysisTransportKind | null;
  /** Ruta que se usaría en la SIGUIENTE petición. */
  route: AnalysisRoute;
  mode: AnalysisMode;
}

function localDisplay(mode: AnalysisMode): EngineDisplay {
  return {
    kind: 'local',
    name: 'Local',
    detail: mode === 'local'
      ? 'Solo procesamiento en esta Mac'
      : 'Procesado en esta Mac',
    showRecheck: false,
  };
}

function cloudDisplay(mode: AnalysisMode, localUnavailable: boolean): EngineDisplay {
  return {
    kind: 'cloud',
    name: 'Nube',
    detail: mode === 'cloud' || !localUnavailable
      ? 'Procesamiento mediante servicio en la nube'
      : 'El motor local no está disponible.',
    showRecheck: mode !== 'cloud' && localUnavailable,
  };
}

export function describeBlockedRoute(
  reason: Extract<AnalysisRoute, { status: 'blocked' }>['reason'],
): string {
  switch (reason) {
    case 'LOCAL_STATUS_UNKNOWN':
      return '';
    case 'LOCAL_ONLY_MODEL_MISSING':
      return 'El motor local aún no está listo.';
    case 'LOCAL_ONLY_UNAVAILABLE':
      return 'Motor local no disponible.';
    case 'CLOUD_NOT_CONFIGURED':
      return 'Configura el servicio en la nube para usar este modo.';
    case 'NO_LOCAL_NO_CLOUD':
      return 'El motor local no está disponible y la nube no está configurada.';
    default:
      return assertNever(reason);
  }
}

export function resolveEngineDisplay(input: EngineDisplayInput): EngineDisplay {
  const { activeTransport, route, mode } = input;

  // El transporte real manda sobre la ruta prospectiva.
  if (activeTransport === 'local') {
    return localDisplay(mode);
  }

  if (activeTransport === 'cloud') {
    return {
      kind: 'cloud',
      name: 'Nube',
      detail: 'Procesamiento mediante servicio en la nube',
      showRecheck: false,
    };
  }

  if (route.status === 'ready') {
    return route.transport === 'local'
      ? localDisplay(mode)
      : cloudDisplay(mode, mode !== 'cloud');
  }

  if (route.reason === 'LOCAL_STATUS_UNKNOWN') {
    return {
      kind: 'unknown',
      name: 'Comprobando…',
      detail: '',
      showRecheck: mode !== 'cloud',
    };
  }

  return {
    kind: 'blocked',
    name: 'Sin motor disponible',
    detail: describeBlockedRoute(route.reason),
    showRecheck: mode !== 'cloud',
  };
}

function assertNever(_value: never): never {
  throw new Error('Unhandled blocked route reason.');
}
