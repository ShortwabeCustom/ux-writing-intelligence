import type {
  AnalyzeIssue,
  AnalyzeResponse,
  AnalyzeSeverity,
} from './analyze-contracts';

export interface MetricDisplay {
  label: string;
  value: number;
  valueLabel: string;
  percentage: number;
}

export interface IssueDisplay {
  categoryLabel: string;
  severityLabel: string;
  severity: AnalyzeSeverity;
  term: string | null;
  reason: string;
}

export interface ResultPresentation {
  severityLabel: string;
  metrics: MetricDisplay[];
  showJargonWarning: boolean;
  showIssuesSection: boolean;
  issues: IssueDisplay[];
  showGeneralReason: boolean;
  generalReason: string;
  suggestion: string;
  hasSuggestionChange: boolean;
  isNoChange: boolean;
}

const ISSUE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  jargon: 'Jerga',
  clarity: 'Claridad',
  concision: 'Concisión',
  utility: 'Utilidad',
  predictability: 'Predictibilidad',
  orthography: 'Ortografía',
  tone: 'Tono',
  consistency: 'Consistencia',
};

export function getSeverityLabel(severity: AnalyzeSeverity): string {
  switch (severity) {
    case 'low':
      return 'Buen nivel';
    case 'medium':
      return 'Necesita atención';
    case 'high':
      return 'Requiere revisión';
    default:
      return assertNever(severity);
  }
}

export function getIssueSeverityLabel(severity: AnalyzeSeverity): string {
  switch (severity) {
    case 'low':
      return 'Baja';
    case 'medium':
      return 'Media';
    case 'high':
      return 'Alta';
    default:
      return assertNever(severity);
  }
}

export function getIssueCategoryLabel(category: string): string {
  const normalizedCategory = category.trim().toLocaleLowerCase('es-MX');
  const knownLabel = ISSUE_CATEGORY_LABELS[normalizedCategory];

  if (knownLabel !== undefined) {
    return knownLabel;
  }

  const readableCategory = normalizedCategory
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (readableCategory.length === 0) {
    return 'Oportunidad';
  }

  return readableCategory.charAt(0).toLocaleUpperCase('es-MX')
    + readableCategory.slice(1);
}

export function getMetricDisplay(label: string, value: number): MetricDisplay {
  return {
    label,
    value,
    valueLabel: `${value}/5`,
    percentage: Math.max(0, Math.min(100, (value / 5) * 100)),
  };
}

export function hasSuggestionChange(result: AnalyzeResponse): boolean {
  return result.suggestion !== result.text;
}

export function isNoChangeResult(result: AnalyzeResponse): boolean {
  return !hasSuggestionChange(result)
    && result.issues.length === 0
    && result.orthography === 5;
}

export function getResultPresentation(result: AnalyzeResponse): ResultPresentation {
  return {
    severityLabel: getSeverityLabel(result.severity),
    metrics: [
      getMetricDisplay('Claridad', result.clarity),
      getMetricDisplay('Concisión', result.concision),
      getMetricDisplay('Utilidad', result.utility),
      getMetricDisplay('Predictibilidad', result.predictability),
      getMetricDisplay('Ortografía', result.orthography),
    ],
    showJargonWarning: result.jargon,
    showIssuesSection: result.issues.length > 0,
    issues: result.issues.map(getIssueDisplay),
    showGeneralReason: !result.issues.some(
      (issue) => issue.reason === result.reason,
    ),
    generalReason: result.reason,
    suggestion: result.suggestion,
    hasSuggestionChange: hasSuggestionChange(result),
    isNoChange: isNoChangeResult(result),
  };
}

function getIssueDisplay(issue: AnalyzeIssue): IssueDisplay {
  return {
    categoryLabel: getIssueCategoryLabel(issue.category),
    severityLabel: getIssueSeverityLabel(issue.severity),
    severity: issue.severity,
    term: issue.term,
    reason: issue.reason,
  };
}

function assertNever(_value: never): never {
  throw new Error('Unhandled presentation value.');
}
