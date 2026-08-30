import type { LocalRuntimeStatusPayload } from './shared/messages';
import type { AnalysisMode } from './analysis-mode';
import { ANALYSIS_MODE_LABEL, DEFAULT_ANALYSIS_MODE, isAnalysisMode } from './analysis-mode';
import type { AnalysisRoute } from './analysis-routing';
import { resolveAnalysisTransport } from './analysis-routing';
import type { AnalysisTransportKind } from './analysis-transport';
import { describeBlockedRoute, resolveEngineDisplay } from './engine-display';
import type { ScreenAuditCandidate, ScreenAuditPreflight } from './screen-audit-contracts';
import {
  describeCounts,
  readyCandidates,
  skippedCandidates,
  toDisplay,
} from './screen-audit-presentation';
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
import { getAnalysisProvenance } from './analysis-state';
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
import { getSelectionPresentation } from './selection-presentation';
import type {
  MainToUiMessage,
  PluginMessageEnvelope,
  SelectionSnapshot,
  SettingsErrorCode,
  UiToMainMessage,
} from './shared/messages';
import { isMainToUiMessage } from './shared/main-to-ui';

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
const screenPreflightPanel = getElement<HTMLElement>('screen-preflight');
const screenName = getElement<HTMLElement>('screen-name');
const screenReadyCount = getElement<HTMLElement>('screen-ready-count');
const screenSkippedCount = getElement<HTMLElement>('screen-skipped-count');
const screenDetected = getElement<HTMLElement>('screen-detected');
const screenDetectedList = getElement<HTMLElement>('screen-detected-list');
const screenSkipped = getElement<HTMLElement>('screen-skipped');
const screenSkippedList = getElement<HTMLElement>('screen-skipped-list');
const screenError = getElement<HTMLElement>('screen-error');
const engineRow = getElement<HTMLElement>('engine-row');
const engineName = getElement<HTMLElement>('engine-name');
const engineDetail = getElement<HTMLElement>('engine-detail');
const engineRetry = getElement<HTMLButtonElement>('engine-retry');
const cloudRetryBlock = getElement<HTMLElement>('cloud-retry-block');
const useCloudButton = getElement<HTMLButtonElement>('use-cloud-button');
const settingsLocalState = getElement<HTMLElement>('settings-local-state');
const settingsCheckLocalButton = getElement<HTMLButtonElement>('settings-check-local-button');
const modeAutoInput = getElement<HTMLInputElement>('mode-auto');
const modeLocalInput = getElement<HTMLInputElement>('mode-local');
const modeCloudInput = getElement<HTMLInputElement>('mode-cloud');
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
const analysisLoadingEngine = getElement<HTMLElement>('analysis-loading-engine');
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
let analysisMode: AnalysisMode = DEFAULT_ANALYSIS_MODE;
let localRuntimeState: LocalRuntimeStatusPayload = {
  state: 'checking',
  modelLabel: null,
};
/** ¿El último fallo admite la acción explícita hacia la nube? Lo decide el
 *  hilo principal; la UI nunca lo infiere por su cuenta. */
let cloudRetryAvailable = false;
/** Preflight vigente. `null` mientras no haya un frame seleccionado o cuando
 *  el descubrimiento anterior quedó obsoleto. */
let screenPreflight: ScreenAuditPreflight | null = null;
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

  if (!isVisible) {
    apiKeyStatusRow.hidden = true;
  }

  analyzeButton.hidden = !isVisible;
  phaseNote.hidden = !isVisible;
}

/**
 * Ruta que usaría la SIGUIENTE petición.
 *
 * Misma función pura que aplica el hilo principal. La UI la usa para mostrar
 * el motor y habilitar el botón; la decisión vinculante se vuelve a resolver
 * en `code.ts` justo antes de enviar el texto, con el estado más reciente.
 */
function currentRoute(): AnalysisRoute {
  return resolveAnalysisTransport({
    mode: analysisMode,
    localRuntimeState: localRuntimeState.state,
    cloudConfigured: apiKeyConfigured,
  });
}

function canAnalyze(): boolean {
  return currentSelectionState.status === 'ready'
    && currentRoute().status === 'ready'
    && canRequestAnalysis(analysisState)
    && applyState.status !== 'applying';
}

/**
 * Motor activo, visible ANTES de analizar.
 *
 * Que el uso de la nube sea evidente antes de pulsar «Analizar texto» es lo
 * que impide que el contenido salga del equipo sin que nadie lo advierta. La
 * decisión vive en `resolveEngineDisplay`, que es pura y está probada.
 */
function renderEngineRow(): void {
  // En una pantalla no hay análisis todavía, así que anunciar un motor sería
  // prometer algo que esta fase no hace.
  if (currentSelectionState.status === 'frame') {
    engineRow.hidden = true;
    return;
  }

  engineRow.hidden = false;

  const display = resolveEngineDisplay({
    activeTransport: getAnalysisProvenance(analysisState),
    route: currentRoute(),
    mode: analysisMode,
  });

  engineRow.dataset['engine'] = display.kind;
  engineName.textContent = display.name;
  engineDetail.textContent = display.detail;
  engineRetry.hidden = !display.showRecheck;
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

  const route = currentRoute();

  if (route.status === 'ready') {
    phaseNote.textContent = route.transport === 'local'
      ? 'Listo para analizar en esta Mac'
      : 'Listo para analizar en la nube';
    return;
  }

  phaseNote.textContent = route.reason === 'LOCAL_STATUS_UNKNOWN'
    ? 'Comprobando el motor de análisis'
    : describeBlockedRoute(route.reason);
}

/**
 * Indicador de API Key en la pantalla principal.
 *
 * Solo aparece cuando la nube es realmente el motor activo. Mostrarlo con el
 * motor local activo daba a entender que la clave era necesaria para analizar
 * en esta Mac, y no lo es.
 */
function renderApiKeyIndicator(): void {
  renderEngineRow();

  const route = currentRoute();
  const cloudIsRelevant = analysisMode !== 'local'
    && (route.status !== 'ready' || route.transport === 'cloud');

  if (!cloudIsRelevant) {
    apiKeyStatusRow.hidden = true;
    configureApiKeyButton.hidden = true;
    renderAnalyzeAvailability();
    return;
  }

  apiKeyStatusRow.hidden = currentSelectionState.status !== 'ready';

  if (!hasApiKeyStatus) {
    apiKeyStatusText.textContent = 'Comprobando configuración…';
    configureApiKeyButton.hidden = true;
    renderAnalyzeAvailability();
    return;
  }

  if (apiKeyConfigured) {
    apiKeyStatusText.textContent = 'Servicio en la nube configurado';
    configureApiKeyButton.hidden = true;
    renderAnalyzeAvailability();
    return;
  }

  apiKeyStatusText.textContent = 'Servicio en la nube sin configurar';
  configureApiKeyButton.hidden = false;
  renderAnalyzeAvailability();
}

/**
 * Preflight de Screen Audit.
 *
 * Copia deliberada: se dice «listos para auditar», nunca «resueltos» ni «no
 * necesitan IA». En esta fase solo se sabe qué es estructuralmente apto; la
 * calidad de la redacción no se ha evaluado todavía.
 */
function renderScreenPreflight(): void {
  const selection = currentSelectionState;
  screenPreflightPanel.hidden = selection.status !== 'frame';

  if (selection.status !== 'frame') {
    return;
  }

  screenName.textContent = selection.nodeName;

  if (screenPreflight === null) {
    screenReadyCount.textContent = 'Leyendo el contenido de la pantalla…';
    screenSkippedCount.textContent = '';
    screenDetected.hidden = true;
    screenSkipped.hidden = true;
    return;
  }

  // Un frame SÍ soportado que no contiene textos es un estado distinto de una
  // raíz no soportada, y no debe confundirse con ella.
  if (screenPreflight.detectedCount === 0) {
    screenReadyCount.textContent = 'Esta pantalla no contiene textos.';
    screenSkippedCount.textContent = '';
    screenDetected.hidden = true;
    screenSkipped.hidden = true;
    return;
  }

  const counts = describeCounts(screenPreflight);
  screenReadyCount.textContent = counts.ready;
  screenSkippedCount.textContent = screenPreflight.skippedCount > 0
    ? counts.skipped
    : '';

  const ready = readyCandidates(screenPreflight);
  const skipped = skippedCandidates(screenPreflight);

  screenDetected.hidden = ready.length === 0;
  screenSkipped.hidden = skipped.length === 0;
  renderCandidateList(screenDetectedList, ready, false);
  renderCandidateList(screenSkippedList, skipped, true);
}

function renderCandidateList(
  container: HTMLElement,
  candidates: ScreenAuditCandidate[],
  showReason: boolean,
): void {
  container.replaceChildren();

  for (const candidate of candidates) {
    const display = toDisplay(candidate);
    const item = document.createElement('article');
    item.className = 'screen-item';

    const layer = document.createElement('span');
    layer.className = 'screen-item-layer';
    layer.textContent = display.layerName;
    item.appendChild(layer);

    // Recorte VISUAL. La fuente permanece intacta en el contrato.
    const preview = document.createElement('span');
    preview.className = 'screen-item-preview';
    preview.textContent = display.preview;
    item.appendChild(preview);

    if (showReason && display.reason.length > 0) {
      const reason = document.createElement('span');
      reason.className = 'screen-item-reason';
      reason.textContent = display.reason;
      item.appendChild(reason);
    }

    container.appendChild(item);
  }
}

function renderSelectionState(state: SelectionSnapshot): void {
  currentSelectionState = state;
  applyState = reduceApplyState(applyState, { type: 'SELECTION_CHANGED' });
  updateAnalysisState({ type: 'SELECTION_CHANGED' });
  statePanel.dataset.state = state.status;
  setReadyContentVisible(false);

  // La copia vive en un módulo puro para poder probarla: en FASE 9.1.1 se
  // descubrió un texto factualmente falso que nadie podía verificar sin abrir
  // Figma.
  const copy = getSelectionPresentation(state);
  eyebrow.textContent = copy.eyebrow;
  title.textContent = copy.title;
  description.textContent = copy.description;

  switch (state.status) {
    case 'no-selection':
    case 'multiple-selection':
    case 'invalid-selection':
    case 'empty-text':
    case 'frame':
      break;

    case 'ready':
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

  renderScreenPreflight();
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

  if (
    event.type === 'ANALYZE_REQUESTED'
    || event.type === 'SELECTION_CHANGED'
    || event.type === 'API_KEY_CHANGED'
  ) {
    cloudRetryAvailable = false;
  }

  renderAnalysis();
}

function updateApplyState(event: ApplyUiEvent): void {
  applyState = reduceApplyState(applyState, event);
  renderApplyState();
  renderAnalyzeAvailability();
}

function renderAnalysis(): void {
  // La tarjeta del motor se repinta AQUÍ. En 8.5.5.2 la decisión de la
  // etiqueta ya era correcta, pero solo se repintaba desde
  // `renderApiKeyIndicator` —selección, estado del runtime o cambio de modo—,
  // así que un retry explícito actualizaba la copia de carga y dejaba la
  // tarjeta congelada diciendo «Local».
  renderEngineRow();
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
      analysisLoadingEngine.textContent = analysisState.transport === null
        ? ''
        : analysisState.transport === 'local'
          ? 'Procesando en esta Mac'
          : 'Procesando en la nube';
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
  // Tras un fallo local, «Reintentar local» debe poder pulsarse aunque la
  // ruta general esté bloqueada: fuerza local y no depende de `canAnalyze()`.
  retryAnalysisButton.disabled = presentation.action === 'retry'
    && (isLocalFailure()
      ? currentSelectionState.status !== 'ready' || !canRequestAnalysis(analysisState)
      : !canAnalyze());

  // La nube solo se ofrece; nunca se toma sola. El hilo principal ya decidió
  // si esta acción es legítima (jamás lo es en Solo local).
  cloudRetryBlock.hidden = !cloudRetryAvailable;
  useCloudButton.disabled = currentSelectionState.status !== 'ready'
    || !canRequestAnalysis(analysisState);
}

/**
 * Arranque común de cualquier análisis.
 *
 * `transport` es el motor ya decidido cuando la acción lo fija —los dos
 * botones de recuperación— y `null` cuando lo resolverá el hilo principal.
 * Fijarlo aquí hace que la interfaz diga la verdad DESDE EL CLIC, sin esperar
 * a la respuesta.
 */
function startAnalysis(
  message: UiToMainMessage,
  transport: AnalysisTransportKind | null,
): void {
  cloudRetryAvailable = false;
  updateApplyState({ type: 'ANALYZE_REQUESTED' });
  // El transporte entra en el estado desde el clic: por eso la tarjeta y la
  // etiqueta de carga dicen «Nube» antes de que salga la petición.
  updateAnalysisState({ type: 'ANALYZE_REQUESTED', transport });
  postToMain(message);
}

function requestAnalysis(): void {
  const requestMessage = createAnalysisRequestMessage(currentSelectionState);

  if (!canAnalyze() || requestMessage === null) {
    return;
  }

  startAnalysis(requestMessage, null);
}

/** ¿El fallo visible proviene del motor local? */
function isLocalFailure(): boolean {
  if (analysisState.status !== 'error') {
    return false;
  }

  const code = analysisState.error.code;
  return code === 'LOCAL_RUNTIME_UNAVAILABLE'
    || code === 'LOCAL_MODEL_NOT_AVAILABLE'
    || code === 'LOCAL_ANALYSIS_TIMEOUT';
}

/**
 * «Reintentar local». Transporte fijo.
 *
 * No pasa por la resolución de ruta: por eso no puede acabar en la nube al
 * caducar la caché de salud, que era el defecto. Si el motor sigue caído, lo
 * correcto es otro error local.
 */
function retryLocalAnalysis(): void {
  if (currentSelectionState.status !== 'ready' || !canRequestAnalysis(analysisState)) {
    return;
  }

  startAnalysis(
    { type: 'RETRY_LOCAL_ANALYSIS', selectionRevision: currentSelectionState.revision },
    'local',
  );
}

function useCloudForCurrentAnalysis(): void {
  if (currentSelectionState.status !== 'ready' || !canRequestAnalysis(analysisState)) {
    return;
  }

  startAnalysis(
    {
      type: 'USE_CLOUD_FOR_CURRENT_ANALYSIS',
      selectionRevision: currentSelectionState.revision,
    },
    'cloud',
  );
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
    case 'SCREEN_PREFLIGHT_READY':
      screenPreflight = message.payload.preflight;
      screenError.hidden = true;
      renderScreenPreflight();
      break;
    case 'SCREEN_PREFLIGHT_INVALIDATED':
      // Un descubrimiento obsoleto no puede pintarse contra otra selección.
      screenPreflight = null;
      screenError.hidden = true;
      renderScreenPreflight();
      break;
    case 'SCREEN_PREFLIGHT_ERROR':
      screenPreflight = null;
      screenError.hidden = false;
      renderScreenPreflight();
      break;
    case 'ANALYSIS_MODE_STATUS':
      renderAnalysisMode(message.payload.mode);
      break;
    case 'ANALYSIS_STARTED':
      updateAnalysisState({
        type: 'ANALYSIS_STARTED',
        requestId: message.requestId,
        transport: message.transport,
      });
      break;
    case 'ANALYSIS_SUCCEEDED':
      cloudRetryAvailable = false;
      updateAnalysisState({
        type: 'ANALYSIS_SUCCEEDED',
        requestId: message.requestId,
        result: message.result,
      });
      break;
    case 'ANALYSIS_FAILED':
      cloudRetryAvailable = message.cloudRetryAvailable;
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
function renderLocalRuntimeStatus(payload: LocalRuntimeStatusPayload): void {
  localRuntimeState = payload;
  settingsLocalState.textContent = describeLocalRuntimeState(payload);
  settingsCheckLocalButton.hidden = payload.state === 'checking';
  renderApiKeyIndicator();
  renderAnalysis();
}

function describeLocalRuntimeState(payload: LocalRuntimeStatusPayload): string {
  switch (payload.state) {
    case 'checking':
      return 'Comprobando…';
    case 'ready':
      return payload.modelLabel === null
        ? 'Listo'
        : `Listo · ${payload.modelLabel}`;
    case 'model_missing':
      return 'Modelo no disponible';
    case 'degraded':
      return 'No disponible';
    case 'unavailable':
      return 'No disponible';
    default:
      return assertNever(payload.state);
  }
}

function renderAnalysisMode(mode: AnalysisMode): void {
  analysisMode = mode;
  modeAutoInput.checked = mode === 'auto';
  modeLocalInput.checked = mode === 'local';
  modeCloudInput.checked = mode === 'cloud';
  renderApiKeyIndicator();
  renderAnalysis();
}

function setAnalysisMode(mode: AnalysisMode): void {
  if (mode === analysisMode) {
    return;
  }

  // Optimista en la UI, persistido por el hilo principal. Un cambio de modo
  // NO redirige una petición en vuelo: afecta a la siguiente.
  renderAnalysisMode(mode);
  postToMain({ type: 'SET_ANALYSIS_MODE', mode });
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
retryAnalysisButton.addEventListener('click', (): void => {
  if (isLocalFailure()) {
    retryLocalAnalysis();
    return;
  }

  requestAnalysis();
});
applySuggestionButton.addEventListener('click', requestApplySuggestion);

// En FASE 8.5.4 este manejador llamaba a `postMessage` en lugar de
// `postToMain`, así que el mensaje salía sin el sobre `pluginMessage` y el
// hilo principal nunca lo recibía.
engineRetry.addEventListener('click', (): void => {
  postToMain({ type: 'CHECK_LOCAL_RUNTIME' });
});

settingsCheckLocalButton.addEventListener('click', (): void => {
  postToMain({ type: 'CHECK_LOCAL_RUNTIME' });
});

useCloudButton.addEventListener('click', useCloudForCurrentAnalysis);

for (const input of [modeAutoInput, modeLocalInput, modeCloudInput]) {
  input.addEventListener('change', (): void => {
    if (input.checked && isAnalysisMode(input.value)) {
      setAnalysisMode(input.value);
    }
  });
}

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
