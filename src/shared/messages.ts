import type { AnalyzeError, AnalyzeResponse } from '../analyze-contracts';
import type { AnalysisMode } from '../analysis-mode';
import { isAnalysisMode } from '../analysis-mode';
import type { AnalysisTransportKind } from '../analysis-transport';
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

export type MainToUiMessage =
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
