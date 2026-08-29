import type { LocalRuntimeStatusPayload } from './shared/messages';
import type {
  AnalyzeError,
  AnalyzeResponse,
} from './analyze-contracts';
import {
  isAnalyzeError,
  isAnalyzeResponse,
  isRecord,
} from './analyze-contracts';
import type { AnalysisUiEvent, AnalysisUiState } from './analysis-state';
import {
  canRequestAnalysis,
  INITIAL_ANALYSIS_STATE,
  reduceAnalysisState,
} from './analysis-state';
import { createAnalysisRequestMessage } from './analysis-session';
import { isApplyError, isApplySuccessPayload } from './apply-contracts';
import type { ApplyUiEvent, ApplyUiState } from './apply-state';
import {
  canRequestApply,
  INITIAL_APPLY_STATE,
  reduceApplyState,
} from './apply-state';
import {
  createSettingsRetryMessage,
  getAnalyzeErrorPresentation,
  getApplyErrorPresentation,
  getSettingsErrorPresentation,
} from './error-experience';
import {
  createAnalysisLoadingFeedback,
  didAnalysisLeaveLoading,
  EXTENDED_ANALYSIS_LOADING_MESSAGE,
  INITIAL_ANALYSIS_LOADING_MESSAGE,
} from './loading-feedback';
import type { IssueDisplay, MetricDisplay } from './result-presentation';
import { getResultPresentation, hasSuggestionChange } from './result-presentation';
import type {
  MainToUiMessage,
  PluginMessageEnvelope,
  SelectionSnapshot,
  SettingsErrorCode,
  UiToMainMessage,
} from './shared/messages';

type StableSettingsState = 'unconfigured' | 'configured';
type SettingsState =
  | 'loading'
  | StableSettingsState
  | 'editing'
  | 'saving'
  | 'confirming-delete'
  | 'deleting'
  | 'error';

const mainView = getElement<HTMLElement>('main-view');
const settingsView = getElement<HTMLElement>('settings-view');
const openSettingsButton = getElement<HTMLButtonElement>('open-settings-button');
const closeSettingsButton = getElement<HTMLButtonElement>('close-settings-button');
const statePanel = getElement<HTMLElement>('state-panel');
const eyebrow = getElement<HTMLElement>('state-eyebrow');
const title = getElement<HTMLHeadingElement>('state-title');
const description = getElement<HTMLParagraphElement>('state-description');
const selectionDetails = getElement<HTMLElement>('selection-details');
const selectionContextLabel = getElement<HTMLElement>('selection-context-label');
const nodeName = getElement<HTMLElement>('node-name');
const selectedText = getElement<HTMLElement>('selected-text');
const readyStatus = getElement<HTMLElement>('ready-status');
const localEngineRow = getElement<HTMLElement>('local-engine-row');
const localEngineDetail = getElement<HTMLElement>('local-engine-detail');
const localEngineRetry = getElement<HTMLButtonElement>('local-engine-retry');
const apiKeyStatusRow = getElement<HTMLElement>('api-key-status-row');
const apiKeyStatusText = getElement<HTMLElement>('api-key-status-text');
const configureApiKeyButton = getElement<HTMLButtonElement>('configure-api-key-button');
const analyzeButton = getElement<HTMLButtonElement>('analyze-button');
const phaseNote = getElement<HTMLElement>('phase-note');
const applySuccessFeedbackPanel = getElement<HTMLElement>('apply-success-feedback');
const applySuccessFeedbackTitle = getElement<HTMLElement>('apply-success-feedback-title');
const applySuccessFeedbackDescription = getElement<HTMLElement>('apply-success-feedback-description');
const analysisLoadingPanel = getElement<HTMLElement>('analysis-loading');
const analysisLoadingMessage = getElement<HTMLElement>('analysis-loading-message');
const analysisResultPanel = getElement<HTMLElement>('analysis-result');
const analysisErrorPanel = getElement<HTMLElement>('analysis-error');
const analysisErrorTitle = getElement<HTMLElement>('analysis-error-title');
const analysisErrorMessage = getElement<HTMLElement>('analysis-error-message');
const analysisRetryAfter = getElement<HTMLElement>('analysis-retry-after');
const analysisOpenSettingsButton = getElement<HTMLButtonElement>('analysis-open-settings-button');
const analysisScore = getElement<HTMLElement>('analysis-score');
const analysisSeverity = getElement<HTMLElement>('analysis-severity');
const analysisClarity = getElement<HTMLElement>('analysis-clarity');
const analysisClarityBar = getElement<HTMLElement>('analysis-clarity-bar');
const analysisConcision = getElement<HTMLElement>('analysis-concision');
const analysisConcisionBar = getElement<HTMLElement>('analysis-concision-bar');
const analysisUtility = getElement<HTMLElement>('analysis-utility');
const analysisUtilityBar = getElement<HTMLElement>('analysis-utility-bar');
const analysisPredictability = getElement<HTMLElement>('analysis-predictability');
const analysisPredictabilityBar = getElement<HTMLElement>('analysis-predictability-bar');
const analysisOrthography = getElement<HTMLElement>('analysis-orthography');
const analysisOrthographyBar = getElement<HTMLElement>('analysis-orthography-bar');
const analysisJargon = getElement<HTMLElement>('analysis-jargon');
const analysisReasonSection = getElement<HTMLElement>('analysis-reason-section');
const analysisReason = getElement<HTMLElement>('analysis-reason');
const analysisSuggestion = getElement<HTMLElement>('analysis-suggestion');
const suggestionChangeContent = getElement<HTMLElement>('suggestion-change-content');
const noChangeContent = getElement<HTMLElement>('no-change-content');
const applyLocalFeedbackPanel = getElement<HTMLElement>('apply-local-feedback');
const applyLocalFeedbackTitle = getElement<HTMLElement>('apply-local-feedback-title');
const applyLocalFeedbackDescription = getElement<HTMLElement>('apply-local-feedback-description');
const applySuggestionButton = getElement<HTMLButtonElement>('apply-suggestion-button');
const applyLoadingIndicator = getElement<HTMLElement>('apply-loading-indicator');
const applyButtonLabel = getElement<HTMLElement>('apply-button-label');
const analysisIssuesSection = getElement<HTMLElement>('analysis-issues-section');
const analysisIssues = getElement<HTMLElement>('analysis-issues');
const analyzeAgainButton = getElement<HTMLButtonElement>('analyze-again-button');
const applyErrorFallbackPanel = getElement<HTMLElement>('apply-error-fallback');
const applyErrorFallbackTitle = getElement<HTMLElement>('apply-error-fallback-title');
const applyErrorFallbackDescription = getElement<HTMLElement>('apply-error-fallback-description');
const retryAnalysisButton = getElement<HTMLButtonElement>('retry-analysis-button');
const settingsLoading = getElement<HTMLElement>('settings-loading');
const apiKeyForm = getElement<HTMLFormElement>('api-key-form');
const formHeading = getElement<HTMLHeadingElement>('form-heading');
const apiKeyInput = getElement<HTMLInputElement>('api-key-input');
const apiKeyInputError = getElement<HTMLElement>('api-key-input-error');
const saveApiKeyButton = getElement<HTMLButtonElement>('save-api-key-button');
const cancelEditButton = getElement<HTMLButtonElement>('cancel-edit-button');
const configuredPanel = getElement<HTMLElement>('configured-panel');
const changeApiKeyButton = getElement<HTMLButtonElement>('change-api-key-button');
const requestDeleteButton = getElement<HTMLButtonElement>('request-delete-button');
const deleteConfirmation = getElement<HTMLElement>('delete-confirmation');
const cancelDeleteButton = getElement<HTMLButtonElement>('cancel-delete-button');
const confirmDeleteButton = getElement<HTMLButtonElement>('confirm-delete-button');
const settingsErrorPanel = getElement<HTMLElement>('settings-error');
const settingsErrorTitle = getElement<HTMLElement>('settings-error-title');
const settingsErrorMessage = getElement<HTMLElement>('settings-error-message');
const retrySettingsButton = getElement<HTMLButtonElement>('retry-settings-button');

let currentSelectionState: SelectionSnapshot = {
  status: 'no-selection',
  revision: 0,
};
let apiKeyConfigured = false;
let hasApiKeyStatus = false;
let settingsState: SettingsState = 'loading';
let stableSettingsState: StableSettingsState = 'unconfigured';
let settingsErrorCode: SettingsErrorCode | null = null;
let pendingApiKey: string | null = null;
let analysisState: AnalysisUiState = INITIAL_ANALYSIS_STATE;
let applyState: ApplyUiState = INITIAL_APPLY_STATE;
const analysisLoadingFeedback = createAnalysisLoadingFeedback({
  onExtended: (): void => {
    if (analysisState.status === 'loading') {
      analysisLoadingMessage.textContent = EXTENDED_ANALYSIS_LOADING_MESSAGE;
    }
  },
});

function getElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(`Missing required UI element: ${id}`);
  }

  return element as TElement;
}

function postToMain(message: UiToMainMessage): void {
  const envelope: PluginMessageEnvelope<UiToMainMessage> = {
    pluginMessage: message,
  };

  parent.postMessage(envelope, '*');
}

function setReadyContentVisible(isVisible: boolean): void {
  selectionDetails.hidden = !isVisible;
  readyStatus.hidden = !isVisible;
  apiKeyStatusRow.hidden = !isVisible;
  analyzeButton.hidden = !isVisible;
  phaseNote.hidden = !isVisible;
}

function canAnalyze(): boolean {
  return currentSelectionState.status === 'ready'
    && apiKeyConfigured
    && canRequestAnalysis(analysisState)
    && applyState.status !== 'applying';
}

function renderAnalyzeAvailability(): void {
  analyzeButton.disabled = !canAnalyze();
  analyzeButton.textContent = analysisState.status === 'loading'
    ? 'Analizando…'
    : applyState.status === 'success'
      ? 'Analizar texto actualizado'
      : 'Analizar texto';

  if (analysisState.status === 'loading') {
    phaseNote.textContent = 'Analizando contenido…';
    return;
  }

  if (!hasApiKeyStatus) {
    phaseNote.textContent = 'Comprobando configuración';
    return;
  }

  phaseNote.textContent = apiKeyConfigured
    ? 'Configuración lista'
    : 'Configura tu API Key para continuar';
}

function renderApiKeyIndicator(): void {
  if (!hasApiKeyStatus) {
    apiKeyStatusText.textContent = 'Comprobando configuración…';
    configureApiKeyButton.hidden = true;
    renderAnalyzeAvailability();
    return;
  }

  if (apiKeyConfigured) {
    apiKeyStatusText.textContent = 'API Key configurada';
    configureApiKeyButton.hidden = true;
    renderAnalyzeAvailability();
    return;
  }

  apiKeyStatusText.textContent = 'API Key pendiente de configurar';
  configureApiKeyButton.hidden = false;
  renderAnalyzeAvailability();
}

function renderSelectionState(state: SelectionSnapshot): void {
  currentSelectionState = state;
  applyState = reduceApplyState(applyState, { type: 'SELECTION_CHANGED' });
  updateAnalysisState({ type: 'SELECTION_CHANGED' });
  statePanel.dataset.state = state.status;
  setReadyContentVisible(false);

  switch (state.status) {
    case 'no-selection':
      eyebrow.textContent = 'Sin selección';
      title.textContent = 'Selecciona un texto';
      description.textContent =
        'Selecciona una capa de texto en Figma para comenzar el análisis.';
      break;

    case 'multiple-selection':
      eyebrow.textContent = `${state.count} capas seleccionadas`;
      title.textContent = 'Selecciona una sola capa';
      description.textContent =
        'Para analizar el contenido, selecciona únicamente una capa de texto.';
      break;

    case 'invalid-selection':
      eyebrow.textContent = state.nodeName;
      title.textContent = 'Esta capa no contiene texto';
      description.textContent =
        'Selecciona directamente una capa de texto para continuar.';
      break;

    case 'empty-text':
      eyebrow.textContent = state.nodeName;
      title.textContent = 'Este texto está vacío';
      description.textContent = 'Agrega contenido a la capa de texto antes de analizarla.';
      break;

    case 'ready':
      eyebrow.textContent = 'Capa de texto';
      title.textContent = 'Texto seleccionado';
      description.textContent = 'Contenido detectado en la selección actual.';
      nodeName.textContent = state.nodeName;
      selectedText.textContent = state.text.length > 0 ? state.text : 'El texto está vacío.';
      selectedText.title = state.text;
      selectedText.setAttribute(
        'aria-label',
        state.text.length > 0 ? `Texto seleccionado: ${state.text}` : 'El texto está vacío.',
      );
      readyStatus.textContent = 'Texto listo';
      renderApiKeyIndicator();
      setReadyContentVisible(true);
      break;

    default:
      assertNever(state);
  }

  renderAnalysis();
}

function updateAnalysisState(event: AnalysisUiEvent): void {
  const previousState = analysisState;
  analysisState = reduceAnalysisState(analysisState, event);

  if (
    event.type === 'ANALYZE_REQUESTED'
    && previousState.status !== 'loading'
    && analysisState.status === 'loading'
  ) {
    analysisLoadingFeedback.start();
  } else if (didAnalysisLeaveLoading(previousState, analysisState)) {
    analysisLoadingFeedback.clear();
  }

  renderAnalysis();
}

function updateApplyState(event: ApplyUiEvent): void {
  applyState = reduceApplyState(applyState, event);
  renderApplyState();
  renderAnalyzeAvailability();
}

function renderAnalysis(): void {
  statePanel.dataset.analysisState = analysisState.status;
  selectionContextLabel.textContent = analysisState.status === 'success'
    ? 'Texto analizado'
    : 'Texto seleccionado';
  analysisLoadingPanel.hidden = true;
  analysisResultPanel.hidden = true;
  analysisErrorPanel.hidden = true;

  switch (analysisState.status) {
    case 'idle':
      break;
    case 'loading':
      analysisLoadingMessage.textContent = analysisLoadingFeedback.isExtended()
        ? EXTENDED_ANALYSIS_LOADING_MESSAGE
        : INITIAL_ANALYSIS_LOADING_MESSAGE;
      analysisLoadingPanel.hidden = false;
      break;
    case 'success':
      renderAnalysisResult(analysisState.result);
      analysisResultPanel.hidden = false;
      break;
    case 'error':
      renderAnalysisError(analysisState.error);
      analysisErrorPanel.hidden = false;
      break;
    default:
      assertNever(analysisState);
  }

  renderAnalyzeAvailability();

  if (currentSelectionState.status === 'ready') {
    const showPrimaryAnalyze = analysisState.status === 'idle'
      || analysisState.status === 'loading';
    analyzeButton.hidden = !showPrimaryAnalyze;
    phaseNote.hidden = !showPrimaryAnalyze || analysisState.status === 'loading';
  }

  renderApplyState();
}

function renderApplyState(): void {
  const resultHasSuggestionChange = analysisState.status === 'success'
    && hasSuggestionChange(analysisState.result);
  const isApplying = applyState.status === 'applying';
  applySuggestionButton.disabled = !resultHasSuggestionChange || !canRequestApply(applyState);
  applySuggestionButton.hidden = !resultHasSuggestionChange;
  applyButtonLabel.textContent = isApplying ? 'Aplicando…' : 'Aplicar al texto';
  applyLoadingIndicator.hidden = !isApplying;
  applySuccessFeedbackPanel.hidden = true;
  applyLocalFeedbackPanel.hidden = true;
  applyErrorFallbackPanel.hidden = true;

  if (!resultHasSuggestionChange) {
    return;
  }

  if (applyState.status === 'success') {
    applySuccessFeedbackPanel.dataset.status = 'success';
    applySuccessFeedbackTitle.textContent = 'Sugerencia aplicada';
    applySuccessFeedbackDescription.textContent = 'El texto seleccionado se actualizó en Figma.';
    applySuccessFeedbackPanel.hidden = false;
    return;
  }

  if (applyState.status === 'error' || applyState.status === 'blocked') {
    const copy = getApplyErrorPresentation(applyState.error);
    const hasVisibleSuggestion = analysisState.status === 'success';
    const panel = hasVisibleSuggestion
      ? applyLocalFeedbackPanel
      : applyErrorFallbackPanel;
    const feedbackTitle = hasVisibleSuggestion
      ? applyLocalFeedbackTitle
      : applyErrorFallbackTitle;
    const feedbackDescription = hasVisibleSuggestion
      ? applyLocalFeedbackDescription
      : applyErrorFallbackDescription;

    panel.dataset.status = 'error';
    feedbackTitle.textContent = copy.title;
    feedbackDescription.textContent = copy.description;
    panel.hidden = false;
  }
}

function renderAnalysisResult(result: AnalyzeResponse): void {
  const presentation = getResultPresentation(result);

  analysisScore.textContent = String(result.score);
  analysisScore.parentElement?.setAttribute(
    'aria-label',
    `UX Writing Score: ${result.score} de 100`,
  );
  analysisSeverity.textContent = presentation.severityLabel;
  analysisSeverity.className = `result-severity severity-${result.severity}`;

  renderMetric(analysisClarity, analysisClarityBar, presentation.metrics[0]);
  renderMetric(analysisConcision, analysisConcisionBar, presentation.metrics[1]);
  renderMetric(analysisUtility, analysisUtilityBar, presentation.metrics[2]);
  renderMetric(
    analysisPredictability,
    analysisPredictabilityBar,
    presentation.metrics[3],
  );
  renderMetric(
    analysisOrthography,
    analysisOrthographyBar,
    presentation.metrics[4],
  );

  analysisJargon.hidden = !presentation.showJargonWarning;
  analysisReason.textContent = presentation.generalReason;
  analysisReasonSection.hidden = !presentation.showGeneralReason;
  analysisSuggestion.textContent = presentation.suggestion;
  suggestionChangeContent.hidden = presentation.isNoChange;
  noChangeContent.hidden = !presentation.isNoChange;
  analysisIssuesSection.hidden = !presentation.showIssuesSection;
  renderIssues(presentation.issues);
}

function renderMetric(
  valueElement: HTMLElement,
  barElement: HTMLElement,
  metric: MetricDisplay | undefined,
): void {
  if (metric === undefined) {
    throw new Error('Missing metric presentation.');
  }

  valueElement.textContent = metric.valueLabel;
  valueElement.setAttribute('aria-label', `${metric.label}: ${metric.value} de 5`);
  barElement.style.width = `${metric.percentage}%`;
}

function renderIssues(issues: IssueDisplay[]): void {
  analysisIssues.replaceChildren();

  for (const issue of issues) {
    const item = document.createElement('article');
    item.className = 'issue-item';

    const header = document.createElement('div');
    header.className = 'issue-header';

    const category = document.createElement('strong');
    category.textContent = issue.categoryLabel;

    const severity = document.createElement('span');
    severity.className = `severity-badge severity-${issue.severity}`;
    severity.textContent = issue.severityLabel;

    header.append(category, severity);
    item.appendChild(header);

    if (issue.term !== null) {
      const term = document.createElement('p');
      term.className = 'issue-term';
      term.textContent = `“${issue.term}”`;
      item.appendChild(term);
    }

    const reason = document.createElement('p');
    reason.className = 'issue-reason';
    reason.textContent = issue.reason;
    item.appendChild(reason);
    analysisIssues.appendChild(item);
  }
}

function renderAnalysisError(error: AnalyzeError): void {
  const presentation = getAnalyzeErrorPresentation(error);

  analysisErrorTitle.textContent = presentation.title;
  analysisErrorMessage.textContent = presentation.description;
  analysisRetryAfter.textContent = presentation.detail ?? '';
  analysisRetryAfter.hidden = presentation.detail === undefined;
  analysisOpenSettingsButton.hidden = presentation.action !== 'open-settings';
  analysisOpenSettingsButton.textContent = presentation.actionLabel ?? 'Abrir Configuración';
  retryAnalysisButton.hidden = presentation.action !== 'retry';
  retryAnalysisButton.textContent = presentation.actionLabel ?? 'Intentar nuevamente';
  retryAnalysisButton.disabled = presentation.action === 'retry' && !canAnalyze();
}

function requestAnalysis(): void {
  const requestMessage = createAnalysisRequestMessage(currentSelectionState);

  if (!canAnalyze() || requestMessage === null) {
    return;
  }

  updateApplyState({ type: 'ANALYZE_REQUESTED' });
  updateAnalysisState({ type: 'ANALYZE_REQUESTED' });
  postToMain(requestMessage);
}

function requestApplySuggestion(): void {
  if (analysisState.status !== 'success' || !canRequestApply(applyState)) {
    return;
  }

  const requestId = analysisState.requestId;
  updateApplyState({ type: 'APPLY_REQUESTED', requestId });
  postToMain({
    type: 'APPLY_SUGGESTION',
    requestId,
  });
}

function setSettingsState(nextState: SettingsState): void {
  settingsState = nextState;
  renderSettings();
}

function renderSettings(): void {
  settingsLoading.hidden = true;
  apiKeyForm.hidden = true;
  configuredPanel.hidden = true;
  deleteConfirmation.hidden = true;
  settingsErrorPanel.hidden = true;

  const isBusy = settingsState === 'saving' || settingsState === 'deleting';
  closeSettingsButton.disabled = isBusy;

  switch (settingsState) {
    case 'loading':
      settingsLoading.hidden = false;
      break;
    case 'unconfigured':
      renderApiKeyForm(false, false);
      break;
    case 'editing':
      renderApiKeyForm(true, false);
      break;
    case 'saving':
      renderApiKeyForm(apiKeyConfigured, true);
      break;
    case 'configured':
      configuredPanel.hidden = false;
      break;
    case 'confirming-delete':
      deleteConfirmation.hidden = false;
      cancelDeleteButton.disabled = false;
      confirmDeleteButton.disabled = false;
      confirmDeleteButton.textContent = 'Eliminar';
      break;
    case 'deleting':
      deleteConfirmation.hidden = false;
      cancelDeleteButton.disabled = true;
      confirmDeleteButton.disabled = true;
      confirmDeleteButton.textContent = 'Eliminando…';
      break;
    case 'error':
      if (settingsErrorCode === null) {
        setSettingsState(stableSettingsState);
        return;
      }

      const presentation = getSettingsErrorPresentation(settingsErrorCode);
      settingsErrorTitle.textContent = presentation.title;
      settingsErrorMessage.textContent = presentation.description;
      retrySettingsButton.textContent = presentation.actionLabel ?? 'Intentar nuevamente';
      settingsErrorPanel.hidden = false;
      break;
    default:
      assertNever(settingsState);
  }
}

function renderApiKeyForm(isEditing: boolean, isSaving: boolean): void {
  apiKeyForm.hidden = false;
  formHeading.textContent = isEditing ? 'Cambiar API Key' : 'Agregar API Key';
  saveApiKeyButton.textContent = isSaving
    ? 'Guardando…'
    : isEditing
      ? 'Guardar nueva clave'
      : 'Guardar clave';
  apiKeyInput.disabled = isSaving;
  saveApiKeyButton.disabled = isSaving;
  cancelEditButton.hidden = !isEditing || isSaving;
  apiKeyInputError.hidden = true;
}

function openSettings(): void {
  mainView.hidden = true;
  settingsView.hidden = false;
  settingsErrorCode = null;
  pendingApiKey = null;
  setSettingsState('loading');
  postToMain({ type: 'OPEN_SETTINGS' });
}

function closeSettings(): void {
  if (settingsState === 'saving' || settingsState === 'deleting') {
    return;
  }

  apiKeyInput.value = '';
  apiKeyInputError.hidden = true;
  settingsErrorCode = null;
  pendingApiKey = null;
  settingsView.hidden = true;
  mainView.hidden = false;
  renderSelectionState(currentSelectionState);
}

function applyApiKeyStatus(configured: boolean): void {
  apiKeyConfigured = configured;
  hasApiKeyStatus = true;
  stableSettingsState = configured ? 'configured' : 'unconfigured';
  settingsErrorCode = null;
  pendingApiKey = null;
  apiKeyInput.value = '';
  renderApiKeyIndicator();

  if (!settingsView.hidden) {
    setSettingsState(stableSettingsState);
  }
}

function showSettingsError(code: SettingsErrorCode): void {
  if (code === 'INVALID_API_KEY') {
    setSettingsState(apiKeyConfigured ? 'editing' : 'unconfigured');
    apiKeyInputError.textContent = 'Ingresa una API Key para continuar.';
    apiKeyInputError.hidden = false;
    apiKeyInput.focus();
    return;
  }

  settingsErrorCode = code;
  setSettingsState('error');
}

function isSelectionSnapshot(value: unknown): value is SelectionSnapshot {
  if (
    !isRecord(value)
    || typeof value.status !== 'string'
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
  ) {
    return false;
  }

  switch (value.status) {
    case 'no-selection':
      return true;
    case 'multiple-selection':
      return typeof value.count === 'number';
    case 'invalid-selection':
      return typeof value.nodeType === 'string' && typeof value.nodeName === 'string';
    case 'empty-text':
      return typeof value.nodeId === 'string'
        && typeof value.nodeName === 'string'
        && typeof value.text === 'string';
    case 'ready':
      return typeof value.nodeId === 'string'
        && typeof value.nodeName === 'string'
        && typeof value.text === 'string';
    default:
      return false;
  }
}

function isSettingsErrorCode(value: unknown): value is SettingsErrorCode {
  return value === 'INVALID_API_KEY'
    || value === 'STORAGE_READ_FAILED'
    || value === 'STORAGE_SAVE_FAILED'
    || value === 'STORAGE_DELETE_FAILED';
}

function isMainToUiMessage(value: unknown): value is MainToUiMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'SELECTION_CHANGED':
      return isSelectionSnapshot(value.payload);
    case 'API_KEY_STATUS':
      return isRecord(value.payload)
        && typeof value.payload.configured === 'boolean';
    case 'API_KEY_SAVED':
      return isRecord(value.payload)
        && value.payload.configured === true;
    case 'API_KEY_DELETED':
      return isRecord(value.payload)
        && value.payload.configured === false;
    case 'SETTINGS_ERROR':
      return isRecord(value.payload)
        && isSettingsErrorCode(value.payload.code);
    case 'ANALYSIS_STARTED':
      return typeof value.requestId === 'string';
    case 'ANALYSIS_SUCCEEDED':
      return typeof value.requestId === 'string'
        && isAnalyzeResponse(value.result);
    case 'ANALYSIS_FAILED':
      return (typeof value.requestId === 'string' || value.requestId === null)
        && isAnalyzeError(value.error);
    case 'APPLY_STARTED':
      return typeof value.requestId === 'string';
    case 'APPLY_BLOCKED':
      return typeof value.requestId === 'string'
        && isApplyError(value.error);
    case 'APPLY_SUCCEEDED':
      return typeof value.requestId === 'string'
        && isApplySuccessPayload(value.payload);
    case 'APPLY_FAILED':
      return (typeof value.requestId === 'string' || value.requestId === null)
        && isApplyError(value.error);
    default:
      return false;
  }
}

function handleMainMessage(message: MainToUiMessage): void {
  switch (message.type) {
    case 'SELECTION_CHANGED':
      renderSelectionState(message.payload);
      break;
    case 'API_KEY_STATUS':
      applyApiKeyStatus(message.payload.configured);
      break;
    case 'API_KEY_SAVED':
    case 'API_KEY_DELETED':
      applyApiKeyStatus(message.payload.configured);
      updateApplyState({ type: 'ANALYZE_REQUESTED' });
      updateAnalysisState({ type: 'API_KEY_CHANGED' });
      break;
    case 'SETTINGS_ERROR':
      showSettingsError(message.payload.code);
      break;
    case 'ANALYSIS_STARTED':
      updateAnalysisState({
        type: 'ANALYSIS_STARTED',
        requestId: message.requestId,
      });
      break;
    case 'ANALYSIS_SUCCEEDED':
      updateAnalysisState({
        type: 'ANALYSIS_SUCCEEDED',
        requestId: message.requestId,
        result: message.result,
      });
      break;
    case 'ANALYSIS_FAILED':
      updateAnalysisState(message.requestId === null
        ? {
            type: 'ANALYSIS_VALIDATION_FAILED',
            error: message.error,
          }
        : {
            type: 'ANALYSIS_FAILED',
            requestId: message.requestId,
            error: message.error,
          });
      break;
    case 'LOCAL_RUNTIME_STATUS':
      renderLocalRuntimeStatus(message.payload);
      break;
    case 'APPLY_STARTED':
      updateApplyState({
        type: 'APPLY_STARTED',
        requestId: message.requestId,
      });
      break;
    case 'APPLY_BLOCKED':
      if (
        analysisState.status === 'success'
        && analysisState.requestId === message.requestId
      ) {
        updateApplyState({
          type: 'APPLY_BLOCKED',
          requestId: message.requestId,
          error: message.error,
        });
      }
      break;
    case 'APPLY_SUCCEEDED':
      updateApplyState({
        type: 'APPLY_SUCCEEDED',
        requestId: message.requestId,
        payload: message.payload,
      });
      break;
    case 'APPLY_FAILED':
      updateApplyState({
        type: 'APPLY_FAILED',
        requestId: message.requestId,
        error: message.error,
      });
      break;
    default:
      assertNever(message);
  }
}

/**
 * Estado del motor local.
 *
 * Deliberadamente sin detalles de infraestructura: no se muestran host,
 * puerto, ni nombres de servicios. Eso vive en los registros de desarrollo.
 */
function renderLocalRuntimeStatus(
  payload: LocalRuntimeStatusPayload,
): void {
  localEngineRow.dataset['state'] = payload.state;

  const modelSuffix = payload.modelLabel === null
    ? 'Local'
    : `${payload.modelLabel} · Local`;

  switch (payload.state) {
    case 'checking':
      localEngineDetail.textContent = 'Comprobando…';
      localEngineRetry.hidden = true;
      break;
    case 'ready':
      localEngineDetail.textContent = `Listo · ${modelSuffix}`;
      localEngineRetry.hidden = true;
      break;
    case 'model_missing':
      localEngineDetail.textContent = 'El modelo aún no está listo para analizar.';
      localEngineRetry.hidden = false;
      break;
    case 'degraded':
      localEngineDetail.textContent = 'El motor local no está respondiendo bien.';
      localEngineRetry.hidden = false;
      break;
    case 'unavailable':
      localEngineDetail.textContent = 'Motor local no disponible.';
      localEngineRetry.hidden = false;
      break;
    default:
      assertNever(payload.state);
  }
}

function assertNever(_value: never): never {
  throw new Error('Unhandled application state.');
}

openSettingsButton.addEventListener('click', openSettings);
configureApiKeyButton.addEventListener('click', openSettings);
analysisOpenSettingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', closeSettings);
analyzeButton.addEventListener('click', requestAnalysis);
analyzeAgainButton.addEventListener('click', requestAnalysis);
retryAnalysisButton.addEventListener('click', requestAnalysis);
applySuggestionButton.addEventListener('click', requestApplySuggestion);

localEngineRetry.addEventListener('click', (): void => {
  localEngineRetry.hidden = true;
  postMessage({ type: 'CHECK_LOCAL_RUNTIME' });
});

apiKeyForm.addEventListener('submit', (event: SubmitEvent): void => {
  event.preventDefault();

  if (settingsState === 'saving' || settingsState === 'deleting') {
    return;
  }

  const apiKey = apiKeyInput.value.trim();

  if (apiKey.length === 0) {
    apiKeyInputError.textContent = 'Ingresa una API Key para continuar.';
    apiKeyInputError.hidden = false;
    apiKeyInput.focus();
    return;
  }

  pendingApiKey = apiKey;
  settingsErrorCode = null;
  setSettingsState('saving');
  postToMain({ type: 'SAVE_API_KEY', apiKey });
});

cancelEditButton.addEventListener('click', (): void => {
  apiKeyInput.value = '';
  setSettingsState(stableSettingsState);
});

changeApiKeyButton.addEventListener('click', (): void => {
  apiKeyInput.value = '';
  setSettingsState('editing');
  apiKeyInput.focus();
});

requestDeleteButton.addEventListener('click', (): void => {
  if (settingsState !== 'configured') {
    return;
  }

  setSettingsState('confirming-delete');
});

cancelDeleteButton.addEventListener('click', (): void => {
  setSettingsState('configured');
});

confirmDeleteButton.addEventListener('click', (): void => {
  if (settingsState !== 'confirming-delete') {
    return;
  }

  settingsErrorCode = null;
  setSettingsState('deleting');
  postToMain({ type: 'DELETE_API_KEY' });
});

retrySettingsButton.addEventListener('click', (): void => {
  if (settingsState !== 'error' || settingsErrorCode === null) {
    return;
  }

  const retryMessage = createSettingsRetryMessage(
    settingsErrorCode,
    pendingApiKey,
  );

  if (retryMessage === null) {
    return;
  }

  const failedCode = settingsErrorCode;
  settingsErrorCode = null;
  setSettingsState(failedCode === 'STORAGE_READ_FAILED'
    ? 'loading'
    : failedCode === 'STORAGE_SAVE_FAILED'
      ? 'saving'
      : 'deleting');
  postToMain(retryMessage);
});

window.onmessage = (
  event: MessageEvent<PluginMessageEnvelope<unknown>>,
): void => {
  const message = event.data.pluginMessage;

  if (isMainToUiMessage(message)) {
    handleMainMessage(message);
  }
};

renderApiKeyIndicator();
renderSelectionState(currentSelectionState);
renderSettings();
renderApplyState();
postToMain({ type: 'UI_READY' });
