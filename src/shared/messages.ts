import type { AnalyzeError, AnalyzeResponse } from '../analyze-contracts';
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
      return true;

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
