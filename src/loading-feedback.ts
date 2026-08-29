import type { AnalysisUiState } from './analysis-state';

export const EXTENDED_ANALYSIS_DELAY_MS = 8_000;
export const INITIAL_ANALYSIS_LOADING_MESSAGE = 'Analizando contenido…';
export const EXTENDED_ANALYSIS_LOADING_MESSAGE =
  'El análisis está tomando un poco más de lo habitual…';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AnalysisLoadingFeedbackOptions {
  onExtended: () => void;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

export interface AnalysisLoadingFeedback {
  start: () => void;
  clear: () => void;
  isExtended: () => boolean;
}

export function didAnalysisLeaveLoading(
  previousState: AnalysisUiState,
  nextState: AnalysisUiState,
): boolean {
  return previousState.status === 'loading' && nextState.status !== 'loading';
}

export function createAnalysisLoadingFeedback(
  options: AnalysisLoadingFeedbackOptions,
): AnalysisLoadingFeedback {
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  let activeTimer: TimerHandle | null = null;
  let generation = 0;
  let extended = false;

  function clear(): void {
    generation += 1;
    extended = false;

    if (activeTimer !== null) {
      cancel(activeTimer);
      activeTimer = null;
    }
  }

  function start(): void {
    clear();
    const activeGeneration = generation;

    activeTimer = schedule(() => {
      if (generation !== activeGeneration) {
        return;
      }

      activeTimer = null;
      extended = true;
      options.onExtended();
    }, EXTENDED_ANALYSIS_DELAY_MS);
  }

  return {
    start,
    clear,
    isExtended: () => extended,
  };
}
