import type { ScreenAuditItem, ScreenAuditSession } from './screen-audit-session';

export type ScreenAuditReviewFilter = 'all' | 'attention' | 'good';
export type ScreenAuditNavigationState = 'current' | 'changed_since_audit' | 'deleted';
export type ScreenAuditReviewClassification = 'attention' | 'good';

export interface ScreenAuditReviewCounts {
  reviewed: number;
  attention: number;
  good: number;
}

export function reviewableItems(session: ScreenAuditSession): ScreenAuditItem[] {
  return session.items.filter((item) => (
    item.status === 'success' || item.status === 'changed' || item.status === 'error'
  ));
}

/** Reuses the result severity already responsible for Buen nivel/attention labels. */
export function classifyReviewItem(
  item: ScreenAuditItem,
  navigationState: ScreenAuditNavigationState = 'current',
): ScreenAuditReviewClassification {
  if (navigationState !== 'current' || item.status !== 'success' || item.result === null) {
    return 'attention';
  }

  return item.result.severity === 'low' ? 'good' : 'attention';
}

export function getReviewCounts(
  items: readonly ScreenAuditItem[],
  states: Readonly<Record<string, ScreenAuditNavigationState>> = {},
): ScreenAuditReviewCounts {
  let attention = 0;
  let good = 0;

  for (const item of items) {
    if (classifyReviewItem(item, states[item.candidate.nodeId]) === 'good') {
      good += 1;
    } else {
      attention += 1;
    }
  }

  return { reviewed: items.length, attention, good };
}

export function getDefaultReviewFilter(counts: ScreenAuditReviewCounts): ScreenAuditReviewFilter {
  return counts.attention > 0 ? 'attention' : 'all';
}

export function filterReviewItems(
  items: readonly ScreenAuditItem[],
  filter: ScreenAuditReviewFilter,
  states: Readonly<Record<string, ScreenAuditNavigationState>> = {},
): ScreenAuditItem[] {
  if (filter === 'all') {
    return [...items];
  }

  return items.filter((item) => classifyReviewItem(
    item,
    states[item.candidate.nodeId],
  ) === filter);
}

export function navigableReviewItems(
  items: readonly ScreenAuditItem[],
  states: Readonly<Record<string, ScreenAuditNavigationState>> = {},
): ScreenAuditItem[] {
  return items.filter((item) => states[item.candidate.nodeId] !== 'deleted');
}

export function getActiveReviewIndex(
  items: readonly ScreenAuditItem[],
  activeCandidateId: string | null,
): number {
  return activeCandidateId === null
    ? -1
    : items.findIndex((item) => item.candidate.nodeId === activeCandidateId);
}

export function normalizeActiveCandidateId(
  items: readonly ScreenAuditItem[],
  activeCandidateId: string | null,
): string | null {
  return getActiveReviewIndex(items, activeCandidateId) >= 0
    ? activeCandidateId
    : items[0]?.candidate.nodeId ?? null;
}

export function getReviewNavigation(
  items: readonly ScreenAuditItem[],
  activeCandidateId: string | null,
): { index: number; hasPrevious: boolean; hasNext: boolean } {
  const index = getActiveReviewIndex(items, activeCandidateId);
  return {
    index,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < items.length - 1,
  };
}

export function describeNavigationState(state: ScreenAuditNavigationState): string {
  switch (state) {
    case 'changed_since_audit':
      return 'Este texto cambió desde la auditoría.';
    case 'deleted':
      return 'Este texto ya no está disponible.';
    case 'current':
      return '';
  }
}
