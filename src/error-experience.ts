import type { AnalyzeError, AnalyzeErrorCode } from './analyze-contracts';
import type { ApplyError, ApplyErrorCode } from './apply-contracts';
import type {
  SettingsErrorCode,
  UiToMainMessage,
} from './shared/messages';

export type ErrorRecoverability =
  | 'retryable'
  | 'requires-settings'
  | 'requires-new-analysis'
  | 'blocked'
  | 'recoverable-after-selection';

export type ErrorAction = 'retry' | 'open-settings' | 'none';

export interface ErrorPresentation {
  title: string;
  description: string;
  recoverability: ErrorRecoverability;
  action: ErrorAction;
  actionLabel?: string;
  detail?: string;
}

export function getAnalyzeRecoverability(
  code: AnalyzeErrorCode,
): ErrorRecoverability {
  switch (code) {
    case 'MISSING_API_KEY':
    case 'UNAUTHORIZED':
      return 'requires-settings';
    // El motor local se recupera reintentando: la persona no necesita tocar
    // ajustes ni volver a seleccionar. No se le pide correr comandos.
    case 'LOCAL_RUNTIME_UNAVAILABLE':
    case 'LOCAL_MODEL_NOT_AVAILABLE':
    case 'LOCAL_ANALYSIS_TIMEOUT':
      return 'retryable';
    case 'RATE_LIMITED':
    case 'SERVICE_UNAVAILABLE':
    case 'INVALID_RESPONSE':
    case 'NETWORK_ERROR':
    case 'UNKNOWN_ERROR':
      return 'retryable';
    case 'STALE_SELECTION':
    case 'INVALID_SELECTION':
      return 'recoverable-after-selection';
    default:
      return assertNever(code);
  }
}

export function getAnalyzeErrorPresentation(
  error: AnalyzeError,
): ErrorPresentation {
  switch (error.code) {
    case 'LOCAL_RUNTIME_UNAVAILABLE':
      return {
        title: 'Motor local no disponible',
        description: 'No pudimos iniciar el análisis local.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Reintentar',
      };
    case 'LOCAL_MODEL_NOT_AVAILABLE':
      return {
        title: 'Modelo local no disponible',
        description: 'El motor de UX Writing aún no está listo para analizar.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Reintentar',
      };
    case 'LOCAL_ANALYSIS_TIMEOUT':
      return {
        title: 'El análisis está tardando demasiado',
        description: 'Inténtalo nuevamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Reintentar',
      };
    case 'MISSING_API_KEY':
      return {
        title: 'Configura tu API Key',
        description: 'Necesitas una API Key para analizar contenido.',
        recoverability: 'requires-settings',
        action: 'open-settings',
        actionLabel: 'Configurar',
      };
    case 'UNAUTHORIZED':
      return {
        title: 'Revisa tu API Key',
        description: 'La API Key no es válida. Actualízala en Configuración para continuar.',
        recoverability: 'requires-settings',
        action: 'open-settings',
        actionLabel: 'Abrir Configuración',
      };
    case 'RATE_LIMITED':
      return {
        title: 'Has realizado varios análisis',
        description: 'Espera un momento antes de volver a intentarlo.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
        detail: error.retryAfterSeconds === undefined
          ? undefined
          : `Podrás volver a intentarlo en aproximadamente ${error.retryAfterSeconds} s.`,
      };
    case 'SERVICE_UNAVAILABLE':
      return {
        title: 'El servicio no está disponible',
        description: 'No pudimos completar el análisis en este momento.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    case 'NETWORK_ERROR':
      return {
        title: 'No pudimos conectar',
        description: 'Revisa tu conexión e inténtalo nuevamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    case 'INVALID_RESPONSE':
      return {
        title: 'No pudimos procesar la respuesta',
        description: 'El análisis no pudo completarse correctamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    case 'STALE_SELECTION':
      return {
        title: 'El texto cambió',
        description: 'La selección cambió durante el análisis. Selecciona el texto que quieres revisar e inténtalo nuevamente.',
        recoverability: 'recoverable-after-selection',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    case 'INVALID_SELECTION':
      return {
        title: 'Selecciona una capa de texto',
        description: 'Selecciona una sola capa de texto para continuar.',
        recoverability: 'recoverable-after-selection',
        action: 'none',
      };
    case 'UNKNOWN_ERROR':
      return {
        title: 'No pudimos completar el análisis',
        description: 'Inténtalo nuevamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    default:
      return assertNever(error.code);
  }
}

export function getSettingsRecoverability(
  code: SettingsErrorCode,
): ErrorRecoverability {
  return code === 'INVALID_API_KEY' ? 'requires-settings' : 'retryable';
}

export function getSettingsErrorPresentation(
  code: SettingsErrorCode,
): ErrorPresentation {
  switch (code) {
    case 'INVALID_API_KEY':
      return {
        title: 'Revisa tu API Key',
        description: 'Ingresa una API Key para continuar.',
        recoverability: 'requires-settings',
        action: 'none',
      };
    case 'STORAGE_READ_FAILED':
      return {
        title: 'No pudimos leer la configuración',
        description: 'Inténtalo nuevamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Volver a intentar',
      };
    case 'STORAGE_SAVE_FAILED':
      return {
        title: 'No pudimos guardar la configuración',
        description: 'Inténtalo nuevamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    case 'STORAGE_DELETE_FAILED':
      return {
        title: 'No pudimos eliminar la clave',
        description: 'Inténtalo nuevamente.',
        recoverability: 'retryable',
        action: 'retry',
        actionLabel: 'Intentar nuevamente',
      };
    default:
      return assertNever(code);
  }
}

export function createSettingsRetryMessage(
  code: SettingsErrorCode,
  pendingApiKey: string | null,
): UiToMainMessage | null {
  switch (code) {
    case 'STORAGE_READ_FAILED':
      return { type: 'REQUEST_API_KEY_STATUS' };
    case 'STORAGE_SAVE_FAILED':
      return pendingApiKey === null
        ? null
        : { type: 'SAVE_API_KEY', apiKey: pendingApiKey };
    case 'STORAGE_DELETE_FAILED':
      return { type: 'DELETE_API_KEY' };
    case 'INVALID_API_KEY':
      return null;
    default:
      return assertNever(code);
  }
}

export function getApplyRecoverability(
  code: ApplyErrorCode,
): ErrorRecoverability {
  switch (code) {
    case 'FONT_LOAD_FAILED':
    case 'EDIT_FAILED':
    case 'UNKNOWN_ERROR':
      return 'retryable';
    case 'NO_ACTIVE_ANALYSIS':
    case 'STALE_ANALYSIS':
    case 'TEXT_CHANGED':
    case 'EMPTY_SUGGESTION':
      return 'requires-new-analysis';
    case 'INVALID_SELECTION':
    case 'SELECTION_CHANGED':
      return 'recoverable-after-selection';
    case 'MISSING_FONT':
    case 'MIXED_STYLES_UNSUPPORTED':
      return 'blocked';
    default:
      return assertNever(code);
  }
}

export function getApplyErrorPresentation(
  error: ApplyError,
): ErrorPresentation {
  const recoverability = getApplyRecoverability(error.code);

  switch (error.code) {
    case 'NO_ACTIVE_ANALYSIS':
      return {
        title: 'No hay un análisis vigente',
        description: 'Analiza nuevamente el texto antes de aplicar una sugerencia.',
        recoverability,
        action: 'none',
      };
    case 'STALE_ANALYSIS':
      return {
        title: 'Este análisis ya no está vigente',
        description: 'Analiza nuevamente el texto antes de aplicar una sugerencia.',
        recoverability,
        action: 'none',
      };
    case 'INVALID_SELECTION':
      return {
        title: 'El texto ya no está disponible',
        description: 'Selecciona otra capa de texto para continuar.',
        recoverability,
        action: 'none',
      };
    case 'SELECTION_CHANGED':
      return {
        title: 'La selección cambió',
        description: 'Selecciona nuevamente el texto que quieres modificar.',
        recoverability,
        action: 'none',
      };
    case 'TEXT_CHANGED':
      return {
        title: 'El texto cambió',
        description: 'Analízalo nuevamente antes de aplicar una sugerencia.',
        recoverability,
        action: 'none',
      };
    case 'EMPTY_SUGGESTION':
      return {
        title: 'La sugerencia está vacía',
        description: 'Genera un nuevo análisis antes de intentarlo nuevamente.',
        recoverability,
        action: 'none',
      };
    case 'MISSING_FONT':
      return {
        title: 'Hay una fuente no disponible',
        description: 'Resuelve la fuente faltante en Figma antes de aplicar la sugerencia.',
        recoverability,
        action: 'none',
      };
    case 'FONT_LOAD_FAILED':
      return {
        title: 'No pudimos cargar la fuente',
        description: 'Revisa las fuentes del archivo e inténtalo nuevamente.',
        recoverability,
        action: 'retry',
        actionLabel: 'Aplicar al texto',
      };
    case 'MIXED_STYLES_UNSUPPORTED':
      return {
        title: 'Este texto usa estilos mixtos',
        description: 'Para conservar su formato, aplica la sugerencia manualmente.',
        recoverability,
        action: 'none',
      };
    case 'EDIT_FAILED':
      return {
        title: 'No pudimos actualizar el texto',
        description: 'Revisa que la capa permita edición e inténtalo nuevamente.',
        recoverability,
        action: 'retry',
        actionLabel: 'Aplicar al texto',
      };
    case 'UNKNOWN_ERROR':
      return {
        title: 'No pudimos aplicar la sugerencia',
        description: 'Inténtalo nuevamente o analiza el texto otra vez.',
        recoverability,
        action: 'retry',
        actionLabel: 'Aplicar al texto',
      };
    default:
      return assertNever(error.code);
  }
}

function assertNever(_value: never): never {
  throw new Error('Unhandled error experience value.');
}
