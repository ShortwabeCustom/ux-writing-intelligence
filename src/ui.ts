import type { LocalRuntimeStatusPayload } from './shared/messages';
import type { AnalysisMode } from './analysis-mode';
import { ANALYSIS_MODE_LABEL, DEFAULT_ANALYSIS_MODE, isAnalysisMode } from './analysis-mode';
import type { AnalysisRoute } from './analysis-routing';
import { resolveAnalysisTransport } from './analysis-routing';
import type { AnalysisTransportKind } from './analysis-transport';
import { describeBlockedRoute, resolveEngineDisplay } from './engine-display';
import type { ScreenAuditCandidate, ScreenAuditPreflight } from './screen-audit-contracts';
import {
  describeAuditTitle,
  describeChanged,
  describeCounts,
  describeExecutionTransport,
  describeItemProvenance,
  describeProgress,
  previewText,
  progressRatio,
  readyCandidates,
  skippedCandidates,
  toDisplay,
} from './screen-audit-presentation';
import type { ScreenAuditItem, ScreenAuditSession } from './screen-audit-session';
import type {
  ScreenAuditNavigationState,
  ScreenAuditReviewFilter,
} from './screen-audit-review';
import {
  describeNavigationState,
  filterReviewItems,
  getDefaultReviewFilter,
  getReviewCounts,
  getReviewNavigation,
  normalizeActiveCandidateId,
  navigableReviewItems,
  reviewableItems,
} from './screen-audit-review';
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
const auditScreenButton = getElement<HTMLButtonElement>('audit-screen-button');
const screenAuditPanel = getElement<HTMLElement>('screen-audit');
const screenAuditTitle = getElement<HTMLElement>('screen-audit-title');
const screenAuditFrame = getElement<HTMLElement>('screen-audit-frame');
const screenAuditProgress = getElement<HTMLElement>('screen-audit-progress');
const screenAuditChanged = getElement<HTMLElement>('screen-audit-changed');
const screenAuditEngine = getElement<HTMLElement>('screen-audit-engine');
const screenAuditProgressFill = getElement<HTMLElement>('screen-audit-progress-fill');
const screenAuditCurrent = getElement<HTMLElement>('screen-audit-current');
const screenAuditReview = getElement<HTMLElement>('screen-audit-review');
const screenAuditReviewedCount = getElement<HTMLElement>('screen-audit-reviewed-count');
const screenAuditAttentionCount = getElement<HTMLElement>('screen-audit-attention-count');
const screenAuditGoodCount = getElement<HTMLElement>('screen-audit-good-count');
const screenAuditFilters = getElement<HTMLElement>('screen-audit-filters');
const screenAuditActivePosition = getElement<HTMLElement>('screen-audit-active-position');
const screenAuditPrevious = getElement<HTMLButtonElement>('screen-audit-previous');
const screenAuditNext = getElement<HTMLButtonElement>('screen-audit-next');
const screenAuditReaudit = getElement<HTMLButtonElement>('screen-audit-reaudit');
const screenAuditFrameUnavailable = getElement<HTMLElement>('screen-audit-frame-unavailable');
const screenAuditResults = getElement<HTMLElement>('screen-audit-results');
const screenAuditPaused = getElement<HTMLElement>('screen-audit-paused');
const screenAuditPausedTitle = getElement<HTMLElement>('screen-audit-paused-title');
const screenAuditPausedMessage = getElement<HTMLElement>('screen-audit-paused-message');
const screenAuditRetryLocal = getElement<HTMLButtonElement>('screen-audit-retry-local');
const screenAuditCloudBlock = getElement<HTMLElement>('screen-audit-cloud-block');
const screenAuditContinueCloud = getElement<HTMLButtonElement>('screen-audit-continue-cloud');
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
const textAuditStale = getElement<HTMLElement>('text-audit-stale');
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
/** Auditoría en curso. Solo en memoria: nada se persiste. */
let screenAuditSession: ScreenAuditSession | null = null;
let screenAuditReviewSessionId: string | null = null;
let screenAuditReviewCompleted = false;
let screenAuditReviewFilter: ScreenAuditReviewFilter = 'all';
let screenAuditActiveCandidateId: string | null = null;
let screenAuditNavigationStates: Record<string, ScreenAuditNavigationState> = {};
let auditedFrameUnavailable = false;
let settingsState: SettingsState = 'loading';
let stableSettingsState: StableSettingsState = 'unconfigured';
let settingsErrorCode: SettingsErrorCode | null = null;
let pendingApiKey: string | null = null;
let analysisState: AnalysisUiState = INITIAL_ANALYSIS_STATE;
let applyState: ApplyUiState = INITIAL_APPLY_STATE;
let restoredTextAuditIsStale = false;
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
  const auditing = screenAuditSession !== null;

  renderScreenAudit();

  // Durante la auditoría manda el panel de ejecución: mostrar el preflight a
  // la vez repetiría los mismos conteos con otro significado.
  screenPreflightPanel.hidden = selection.status !== 'frame' || auditing;

  if (selection.status !== 'frame' || auditing) {
    return;
  }

  // El CTA se habilita solo si HAY una ruta de análisis inicial. El preflight
  // en sí sigue funcionando sin motor y sin clave.
  auditScreenButton.disabled = currentRoute().status !== 'ready'
    || (screenPreflight?.eligibleCount ?? 0) === 0;

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

/**
 * Auditoría en curso.
 *
 * La interfaz es un renderizador puro de la sesión que envía el hilo
 * principal. No deduce procedencia, ni progreso, ni estado: los recibe.
 */
function renderScreenAudit(): void {
  const session = screenAuditSession;
  screenAuditPanel.hidden = session === null;

  if (session === null) {
    return;
  }

  synchronizeReviewState(session);

  screenAuditTitle.textContent = describeAuditTitle(session);
  screenAuditFrame.textContent = session.frameName;
  screenAuditProgress.textContent = describeProgress(session);

  const changed = describeChanged(session);
  screenAuditChanged.textContent = changed;
  screenAuditChanged.hidden = changed.length === 0;

  screenAuditEngine.textContent = describeExecutionTransport(session.executionTransport);
  screenAuditProgressFill.style.width = `${Math.round(progressRatio(session) * 100)}%`;

  const current = session.items[session.currentIndex];
  screenAuditCurrent.textContent = current === undefined
    ? ''
    : session.status === 'running'
      ? `Analizando «${previewText(current.candidate.text)}»…`
      : session.status === 'paused' && current.status === 'error'
        ? `Candidato actual: «${previewText(current.candidate.text)}»`
        : '';

  renderAuditResults(session);
  renderAuditPause(session);
}

function synchronizeReviewState(session: ScreenAuditSession): void {
  if (screenAuditReviewSessionId !== session.sessionId) {
    screenAuditReviewSessionId = session.sessionId;
    screenAuditReviewCompleted = false;
    screenAuditReviewFilter = 'all';
    screenAuditActiveCandidateId = null;
    screenAuditNavigationStates = {};
    auditedFrameUnavailable = false;
  }

  if (session.status === 'completed' && !screenAuditReviewCompleted) {
    const items = reviewableItems(session);
    screenAuditReviewFilter = getDefaultReviewFilter(
      getReviewCounts(items, screenAuditNavigationStates),
    );
    screenAuditActiveCandidateId = normalizeActiveCandidateId(
      filterReviewItems(items, screenAuditReviewFilter, screenAuditNavigationStates),
      null,
    );
    screenAuditReviewCompleted = true;
    publishScreenReviewState();
  }
}

function publishScreenReviewState(): void {
  const session = screenAuditSession;
  if (session === null || session.status !== 'completed') {
    return;
  }
  postToMain({
    type: 'UPDATE_SCREEN_AUDIT_REVIEW_STATE',
    auditSessionId: session.sessionId,
    filter: screenAuditReviewFilter,
    activeCandidateId: screenAuditActiveCandidateId,
  });
}

function renderAuditResults(session: ScreenAuditSession): void {
  screenAuditResults.replaceChildren();

  const items = reviewableItems(session);
  const completed = session.status === 'completed';
  const visibleItems = completed
    ? filterReviewItems(items, screenAuditReviewFilter, screenAuditNavigationStates)
    : items;
  const navigableItems = navigableReviewItems(visibleItems, screenAuditNavigationStates);

  screenAuditReview.hidden = !completed;
  screenAuditFrameUnavailable.hidden = !auditedFrameUnavailable;

  if (completed) {
    const counts = getReviewCounts(items, screenAuditNavigationStates);
    screenAuditReviewedCount.textContent = counts.reviewed === 1
      ? '1 texto revisado'
      : `${counts.reviewed} textos revisados`;
    screenAuditAttentionCount.textContent = counts.attention === 1
      ? '1 necesita atención'
      : `${counts.attention} necesitan atención`;
    screenAuditGoodCount.textContent = counts.good === 1
      ? '1 en buen nivel'
      : `${counts.good} en buen nivel`;

    for (const button of screenAuditFilters.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset['filter'] === screenAuditReviewFilter),
      );
      button.disabled = auditedFrameUnavailable;
    }

    const previousActiveCandidateId = screenAuditActiveCandidateId;
    screenAuditActiveCandidateId = normalizeActiveCandidateId(
      navigableItems,
      screenAuditActiveCandidateId,
    );
    if (screenAuditActiveCandidateId !== previousActiveCandidateId) {
      publishScreenReviewState();
    }
    const navigation = getReviewNavigation(navigableItems, screenAuditActiveCandidateId);
    const subset = screenAuditReviewFilter === 'attention'
      ? 'con atención'
      : screenAuditReviewFilter === 'good'
        ? 'en buen nivel'
        : 'resultados';
    screenAuditActivePosition.textContent = navigation.index < 0
      ? 'No hay resultados en este filtro.'
      : `Resultado seleccionado · ${navigation.index + 1} de ${navigableItems.length} ${subset}`;
    screenAuditPrevious.disabled = auditedFrameUnavailable || !navigation.hasPrevious;
    screenAuditNext.disabled = auditedFrameUnavailable || !navigation.hasNext;
    screenAuditReaudit.hidden = currentSelectionState.status !== 'frame'
      || currentSelectionState.nodeId !== session.frameId;
    screenAuditReaudit.disabled = auditedFrameUnavailable || currentRoute().status !== 'ready';
  }

  for (const item of visibleItems) {
    screenAuditResults.appendChild(buildAuditItem(item));
  }
}

function buildAuditItem(item: ScreenAuditItem): HTMLButtonElement {
  const article = document.createElement('button');
  article.type = 'button';
  article.className = 'audit-item';
  article.dataset['status'] = item.status;
  article.dataset['candidateId'] = item.candidate.nodeId;
  const isActive = item.candidate.nodeId === screenAuditActiveCandidateId;
  article.dataset['active'] = String(isActive);
  article.setAttribute('aria-pressed', String(isActive));
  article.setAttribute('aria-label', `Ver en pantalla: ${item.candidate.layerName}`);
  const navigationState = screenAuditNavigationStates[item.candidate.nodeId] ?? 'current';
  article.disabled = auditedFrameUnavailable || navigationState === 'deleted';
  article.addEventListener('click', (): void => {
    navigateToAuditCandidate(item.candidate.nodeId);
  });

  const header = document.createElement('div');
  header.className = 'audit-item-header';

  const scope = document.createElement('span');
  scope.className = 'audit-item-scope';
  scope.textContent = 'Evaluación en contexto';
  article.appendChild(scope);

  let scoreLabel = '';

  if (item.status === 'success' && item.result !== null) {
    scoreLabel = `${item.result.score} de 100`;
  }

  if (item.status === 'success' && item.result !== null) {
    const score = document.createElement('span');
    score.className = 'audit-item-score';
    // Sin puntuación global de pantalla: promediar textos distintos no
    // significaría nada y requiere su propia definición de producto.
    score.textContent = `${item.result.score}/100`;
    header.appendChild(score);

    const severity = document.createElement('span');
    severity.className = `audit-item-severity severity-${item.result.severity}`;
    severity.textContent = getResultPresentation(item.result).severityLabel;
    header.appendChild(severity);
  }

  article.appendChild(header);

  const preview = document.createElement('span');
  preview.className = 'audit-item-preview';
  preview.textContent = previewText(item.candidate.text);
  article.appendChild(preview);

  const layer = document.createElement('span');
  layer.className = 'audit-item-layer';
  layer.textContent = item.candidate.layerName;
  article.appendChild(layer);

  const meta = document.createElement('span');
  meta.className = 'audit-item-meta';

  if (item.status === 'error') {
    meta.textContent = 'No se pudo analizar';
  } else if (item.status === 'changed') {
    meta.textContent = '';
  }

  if (meta.textContent.length > 0) {
    article.appendChild(meta);
  }

  const navigationMessage = describeNavigationState(navigationState);
  if (navigationMessage.length > 0) {
    const stale = document.createElement('span');
    stale.className = 'audit-item-meta audit-item-navigation-state';
    stale.textContent = navigationMessage;
    article.appendChild(stale);

    if (navigationState === 'changed_since_audit') {
      const historical = document.createElement('span');
      historical.className = 'audit-item-meta audit-item-historical';
      historical.textContent = 'Resultado histórico';
      article.appendChild(historical);
    }
  }

  if (item.status === 'success' || item.status === 'changed' || item.status === 'error') {
    const provenance = document.createElement('span');
    provenance.className = 'audit-item-meta audit-item-provenance';
    provenance.textContent = describeItemProvenance(item);
    article.appendChild(provenance);
  }

  const action = document.createElement('span');
  action.className = 'audit-item-action';
  action.textContent = navigationState === 'deleted' ? 'No disponible' : 'Ver en pantalla';
  article.appendChild(action);
  article.setAttribute(
    'aria-label',
    [
      'Evaluación en contexto',
      scoreLabel,
      item.status === 'success' && item.result !== null
        ? getResultPresentation(item.result).severityLabel
        : '',
      item.candidate.layerName,
      navigationMessage,
      navigationState === 'deleted' ? 'No disponible' : 'Ver en pantalla',
    ].filter((label) => label.length > 0).join(', '),
  );
  return article;
}

function navigateToAuditCandidate(candidateId: string): void {
  const session = screenAuditSession;
  if (session === null || auditedFrameUnavailable) {
    return;
  }

  screenAuditActiveCandidateId = candidateId;
  publishScreenReviewState();
  renderAuditResults(session);
  postToMain({
    type: 'SCREEN_AUDIT_NAVIGATE_TO_ITEM',
    auditSessionId: session.sessionId,
    candidateId,
  });
}

function navigateRelative(offset: -1 | 1): void {
  const session = screenAuditSession;
  if (session === null || session.status !== 'completed') {
    return;
  }

  const visibleItems = filterReviewItems(
    reviewableItems(session),
    screenAuditReviewFilter,
    screenAuditNavigationStates,
  );
  const navigableItems = navigableReviewItems(visibleItems, screenAuditNavigationStates);
  const { index } = getReviewNavigation(navigableItems, screenAuditActiveCandidateId);
  const target = navigableItems[index + offset];
  if (target !== undefined) {
    navigateToAuditCandidate(target.candidate.nodeId);
  }
}

function renderAuditPause(session: ScreenAuditSession): void {
  screenAuditPaused.hidden = session.status !== 'paused';

  if (session.status !== 'paused') {
    return;
  }

  const failed = session.items[session.currentIndex];
  const presentation = failed?.error === undefined || failed.error === null
    ? null
    : getAnalyzeErrorPresentation(failed.error);

  screenAuditPausedTitle.textContent = presentation?.title ?? 'La auditoría se detuvo';
  screenAuditPausedMessage.textContent = failed?.error?.code === 'LOCAL_RUNTIME_UNAVAILABLE'
    ? 'El análisis local se interrumpió. Puedes reintentarlo en esta Mac o continuar en la nube.'
    : presentation?.description ?? 'No pudimos completar el análisis de este texto.';

  // En Solo local nunca se ofrece la nube, aunque haya clave configurada.
  screenAuditCloudBlock.hidden = !session.cloudContinuationAvailable;
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
  restoredTextAuditIsStale = false;
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
  textAuditStale.hidden = true;

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
      textAuditStale.hidden = !restoredTextAuditIsStale;
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
    && hasSuggestionChange(analysisState.result)
    && !restoredTextAuditIsStale;
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
    `Evaluación del texto, ${result.score} de 100, ${presentation.severityLabel}`,
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
    case 'SCREEN_AUDIT_RESTORED':
      screenAuditSession = message.payload.snapshot.session;
      screenPreflight = null;
      screenAuditReviewSessionId = message.payload.snapshot.session.sessionId;
      screenAuditReviewCompleted = true;
      screenAuditReviewFilter = message.payload.snapshot.review.filter;
      screenAuditActiveCandidateId = message.payload.snapshot.review.activeCandidateId;
      screenAuditNavigationStates = {
        ...message.payload.snapshot.review.navigationStates,
      };
      auditedFrameUnavailable = false;
      renderScreenPreflight();
      break;
    case 'TEXT_AUDIT_RESTORED':
      restoredTextAuditIsStale = message.payload.state === 'changed';
      updateAnalysisState({
        type: 'ANALYSIS_RESTORED',
        requestId: message.payload.snapshot.requestId,
        result: message.payload.snapshot.result,
        transport: message.payload.snapshot.transport,
      });
      break;
    case 'SCREEN_AUDIT_UPDATED':
      screenAuditSession = message.payload.session;
      renderScreenPreflight();
      break;
    case 'SCREEN_AUDIT_NAVIGATION_RESULT':
      if (screenAuditSession?.sessionId === message.payload.sessionId) {
        screenAuditNavigationStates[message.payload.candidateId] = message.payload.state;
        screenAuditActiveCandidateId = message.payload.candidateId;
        renderScreenAudit();
      }
      break;
    case 'SCREEN_AUDIT_FRAME_UNAVAILABLE':
      if (screenAuditSession?.sessionId === message.payload.sessionId) {
        auditedFrameUnavailable = true;
        renderScreenAudit();
      }
      break;
    case 'SCREEN_AUDIT_INVALIDATED':
      // Una auditoría obsoleta no puede seguir pintándose contra otra pantalla.
      screenAuditSession = null;
      resetScreenAuditReview();
      renderScreenPreflight();
      break;
    case 'SCREEN_PREFLIGHT_READY':
      screenAuditSession = null;
      resetScreenAuditReview();
      screenPreflight = message.payload.preflight;
      screenError.hidden = true;
      renderScreenPreflight();
      break;
    case 'SCREEN_PREFLIGHT_INVALIDATED':
      // Un descubrimiento obsoleto no puede pintarse contra otra selección.
      screenAuditSession = null;
      resetScreenAuditReview();
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
      restoredTextAuditIsStale = false;
      updateAnalysisState({
        type: 'ANALYSIS_STARTED',
        requestId: message.requestId,
        transport: message.transport,
      });
      break;
    case 'ANALYSIS_SUCCEEDED':
      restoredTextAuditIsStale = false;
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

function resetScreenAuditReview(): void {
  screenAuditReviewSessionId = null;
  screenAuditReviewCompleted = false;
  screenAuditReviewFilter = 'all';
  screenAuditActiveCandidateId = null;
  screenAuditNavigationStates = {};
  auditedFrameUnavailable = false;
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

auditScreenButton.addEventListener('click', (): void => {
  if (currentSelectionState.status !== 'frame' || auditScreenButton.disabled) {
    return;
  }

  postToMain({
    type: 'START_SCREEN_AUDIT',
    selectionRevision: currentSelectionState.revision,
  });
});

screenAuditRetryLocal.addEventListener('click', (): void => {
  if (screenAuditSession === null) {
    return;
  }

  postToMain({
    type: 'RETRY_SCREEN_AUDIT_LOCAL',
    sessionId: screenAuditSession.sessionId,
  });
});

screenAuditContinueCloud.addEventListener('click', (): void => {
  if (screenAuditSession === null) {
    return;
  }

  postToMain({
    type: 'CONTINUE_SCREEN_AUDIT_CLOUD',
    sessionId: screenAuditSession.sessionId,
  });
});

screenAuditFilters.addEventListener('click', (event: MouseEvent): void => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const filter = target.dataset['filter'];
  if (filter !== 'all' && filter !== 'attention' && filter !== 'good') {
    return;
  }

  screenAuditReviewFilter = filter;
  if (screenAuditSession !== null) {
    const visible = filterReviewItems(
      reviewableItems(screenAuditSession),
      filter,
      screenAuditNavigationStates,
    );
    const navigable = navigableReviewItems(visible, screenAuditNavigationStates);
    // Filter changes update UI selection only. Canvas movement remains tied
    // to explicit card/Previous/Next actions.
    screenAuditActiveCandidateId = normalizeActiveCandidateId(
      navigable,
      screenAuditActiveCandidateId,
    );
    publishScreenReviewState();
    renderAuditResults(screenAuditSession);
  }
});

screenAuditPrevious.addEventListener('click', (): void => navigateRelative(-1));
screenAuditNext.addEventListener('click', (): void => navigateRelative(1));
screenAuditReaudit.addEventListener('click', (): void => {
  if (currentSelectionState.status !== 'frame' || screenAuditReaudit.disabled) {
    return;
  }
  postToMain({
    type: 'START_SCREEN_AUDIT',
    selectionRevision: currentSelectionState.revision,
  });
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
