import type { AnalyzeError, AnalyzeResponse } from '../analyze-contracts';
import type { AnalysisMode } from '../analysis-mode';
import { isAnalysisMode } from '../analysis-mode';
import type { AnalysisTransportKind } from '../analysis-transport';
import type { ScreenAuditPreflight } from '../screen-audit-contracts';
import { isScreenAuditPreflight } from '../screen-audit-contracts';
import type { ScreenAuditSession } from '../screen-audit-session';
import type { ScreenAuditNavigationState } from '../screen-audit-review';
import type {
  ScreenAuditSnapshot,
  TextAuditSnapshot,
} from '../audit-session-store';
import type { ApplyError, ApplySuccessPayload } from '../apply-contracts';

export type SelectionState =
  | {
      status: 'no-selection';
    }
  | {
      status: 'multiple-selection';
      count: number;
    }
  | {
      status: 'invalid-selection';
      nodeType: string;
      nodeName: string;
    }
  | {
      status: 'empty-text';
      nodeId: string;
      nodeName: string;
      text: string;
    }
  | {
      status: 'ready';
      nodeId: string;
      nodeName: string;
      text: string;
    }
  | {
      status: 'frame';
      nodeId: string;
      nodeName: string;
    };

export type SelectionSnapshot = SelectionState & {
  revision: number;
};

export type SettingsErrorCode =
  | 'INVALID_API_KEY'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_SAVE_FAILED'
  | 'STORAGE_DELETE_FAILED';

export type LocalRuntimeStatusPayload = {
  state: 'checking' | 'ready' | 'unavailable' | 'model_missing' | 'degraded';
  modelLabel: string | null;
};

export type ScreenPreflightErrorCode = 'DISCOVERY_FAILED';

export type MainToUiMessage =
  | {
      type: 'SCREEN_AUDIT_RESTORED';
      payload: { snapshot: ScreenAuditSnapshot };
    }
  | {
      type: 'TEXT_AUDIT_RESTORED';
      payload: {
        snapshot: TextAuditSnapshot;
        state: 'current' | 'changed';
      };
    }
  | {
      type: 'SCREEN_AUDIT_NAVIGATION_RESULT';
      payload: {
        sessionId: string;
        candidateId: string;
        state: ScreenAuditNavigationState;
      };
    }
  | {
      type: 'SCREEN_AUDIT_FRAME_UNAVAILABLE';
      payload: { sessionId: string };
    }
  | {
      /**
       * Instantánea completa de la auditoría en curso.
       *
       * Se envía la sesión entera en cada cambio en lugar de diferencias: la
       * interfaz queda como un renderizador puro y no puede desincronizarse
       * del hilo principal, que es justo la clase de defecto que costó tres
       * correcciones en 8.5.x.
       */
      type: 'SCREEN_AUDIT_UPDATED';
      payload: {
        session: ScreenAuditSession;
      };
    }
  | {
      type: 'SCREEN_AUDIT_INVALIDATED';
      payload: {
        sessionId: string;
      };
    }
  | {
      type: 'SCREEN_PREFLIGHT_READY';
      payload: {
        preflight: ScreenAuditPreflight;
      };
    }
  | {
      type: 'SCREEN_PREFLIGHT_INVALIDATED';
      payload: {
        revision: number;
      };
    }
  | {
      type: 'SCREEN_PREFLIGHT_ERROR';
      payload: {
        code: ScreenPreflightErrorCode;
      };
    }
  | {
      type: 'ANALYSIS_MODE_STATUS';
      payload: {
        mode: AnalysisMode;
      };
    }
  | {
      type: 'LOCAL_RUNTIME_STATUS';
      payload: LocalRuntimeStatusPayload;
    }
  | {
      type: 'SELECTION_CHANGED';
      payload: SelectionSnapshot;
    }
  | {
      type: 'API_KEY_STATUS';
      payload: {
        configured: boolean;
      };
    }
  | {
      type: 'API_KEY_SAVED';
      payload: {
        configured: true;
      };
    }
  | {
      type: 'API_KEY_DELETED';
      payload: {
        configured: false;
      };
    }
  | {
      type: 'SETTINGS_ERROR';
      payload: {
        code: SettingsErrorCode;
      };
    }
  | {
      type: 'ANALYSIS_STARTED';
      requestId: string;
      /** Motor que procesará ESTA petición. Ya está decidido: el texto se
       *  envía a este transporte y a ningún otro. */
      transport: AnalysisTransportKind;
    }
  | {
      type: 'ANALYSIS_SUCCEEDED';
      requestId: string;
      result: AnalyzeResponse;
    }
  | {
      type: 'ANALYSIS_FAILED';
      requestId: string | null;
      error: AnalyzeError;
      /** ¿Se le puede ofrecer a la persona la acción explícita de analizar en
       *  la nube? Nunca implica que la nube vaya a usarse sola. */
      cloudRetryAvailable: boolean;
    }
  | {
      type: 'APPLY_STARTED';
      requestId: string;
    }
  | {
      type: 'APPLY_BLOCKED';
      requestId: string;
      error: ApplyError;
    }
  | {
      type: 'APPLY_SUCCEEDED';
      requestId: string;
      payload: ApplySuccessPayload;
    }
  | {
      type: 'APPLY_FAILED';
      requestId: string | null;
      error: ApplyError;
    };

export type UiToMainMessage =
  | {
      type: 'UI_READY';
    }
  | {
      type: 'CHECK_LOCAL_RUNTIME';
    }
  | {
      type: 'SET_ANALYSIS_MODE';
      mode: AnalysisMode;
    }
  | {
      type: 'START_SCREEN_AUDIT';
      selectionRevision: number;
    }
  | {
      type: 'RETRY_SCREEN_AUDIT_LOCAL';
      sessionId: string;
    }
  | {
      type: 'CONTINUE_SCREEN_AUDIT_CLOUD';
      sessionId: string;
    }
  | {
      type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM';
      auditSessionId: string;
      candidateId: string;
    }
  | {
      type: 'UPDATE_SCREEN_AUDIT_REVIEW_STATE';
      auditSessionId: string;
      filter: 'all' | 'attention' | 'good';
      activeCandidateId: string | null;
    }
  | {
      type: 'RETRY_LOCAL_ANALYSIS';
      selectionRevision: number;
    }
  | {
      type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS';
      selectionRevision: number;
    }
  | {
      type: 'OPEN_SETTINGS';
    }
  | {
      type: 'REQUEST_API_KEY_STATUS';
    }
  | {
      type: 'SAVE_API_KEY';
      apiKey: string;
    }
  | {
      type: 'DELETE_API_KEY';
    }
  | {
      type: 'ANALYZE_REQUEST';
      selectionRevision: number;
    }
  | {
      type: 'APPLY_SUGGESTION';
      requestId: string;
    };

export interface PluginMessageEnvelope<TMessage> {
  pluginMessage: TMessage;
}

export function isUiToMainMessage(value: unknown): value is UiToMainMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('type' in value)) {
    return false;
  }

  switch (value.type) {
    case 'UI_READY':
    case 'OPEN_SETTINGS':
    case 'REQUEST_API_KEY_STATUS':
    case 'DELETE_API_KEY':
    // Faltaba en FASE 8.5.4: sin este caso el mensaje caía en `default` y el
    // botón de reintento del motor local no hacía absolutamente nada.
    case 'CHECK_LOCAL_RUNTIME':
      return true;

    case 'SET_ANALYSIS_MODE':
      return 'mode' in value && isAnalysisMode(value.mode);

    // Cada intento de recuperación lleva su transporte fijo. No comparten el
    // flujo genérico de análisis: era justo esa reutilización la que permitía
    // que «Reintentar» acabara en la nube al caducar la caché de salud.
    case 'RETRY_SCREEN_AUDIT_LOCAL':
    case 'CONTINUE_SCREEN_AUDIT_CLOUD':
      return 'sessionId' in value
        && typeof value.sessionId === 'string'
        && value.sessionId.length > 0;

    case 'SCREEN_AUDIT_NAVIGATE_TO_ITEM':
      return 'auditSessionId' in value
        && typeof value.auditSessionId === 'string'
        && value.auditSessionId.length > 0
        && 'candidateId' in value
        && typeof value.candidateId === 'string'
        && value.candidateId.length > 0;

    case 'UPDATE_SCREEN_AUDIT_REVIEW_STATE':
      return 'auditSessionId' in value
        && typeof value.auditSessionId === 'string'
        && value.auditSessionId.length > 0
        && 'filter' in value
        && (value.filter === 'all' || value.filter === 'attention' || value.filter === 'good')
        && 'activeCandidateId' in value
        && (typeof value.activeCandidateId === 'string' || value.activeCandidateId === null);

    case 'START_SCREEN_AUDIT':
    case 'RETRY_LOCAL_ANALYSIS':
    case 'USE_CLOUD_FOR_CURRENT_ANALYSIS':
      return 'selectionRevision' in value
        && typeof value.selectionRevision === 'number'
        && Number.isSafeInteger(value.selectionRevision)
        && value.selectionRevision >= 0;

    case 'SAVE_API_KEY':
      return 'apiKey' in value && typeof value.apiKey === 'string';

    case 'ANALYZE_REQUEST':
      return 'selectionRevision' in value
        && typeof value.selectionRevision === 'number'
        && Number.isSafeInteger(value.selectionRevision)
        && value.selectionRevision >= 0;

    case 'APPLY_SUGGESTION':
      return Object.keys(value).length === 2
        && 'requestId' in value
        && typeof value.requestId === 'string'
        && value.requestId.length > 0;

    default:
      return false;
  }
}

type ApiKeyStatusMessageType =
  | 'API_KEY_STATUS'
  | 'API_KEY_SAVED'
  | 'API_KEY_DELETED';

export function createApiKeyStatusMessage(
  type: ApiKeyStatusMessageType,
  configured: boolean,
): MainToUiMessage {
  if (type === 'API_KEY_SAVED') {
    return {
      type,
      payload: { configured: true },
    };
  }

  if (type === 'API_KEY_DELETED') {
    return {
      type,
      payload: { configured: false },
    };
  }

  return {
    type,
    payload: { configured },
  };
}
