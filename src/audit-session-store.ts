import type { AnalyzeResponse } from './analyze-contracts';
import type { AnalysisTransportKind } from './analysis-transport';
import type {
  ScreenAuditNavigationState,
  ScreenAuditReviewFilter,
} from './screen-audit-review';
import type { ScreenAuditSession } from './screen-audit-session';

export interface ScreenAuditReviewSnapshot {
  filter: ScreenAuditReviewFilter;
  activeCandidateId: string | null;
  navigationStates: Record<string, ScreenAuditNavigationState>;
}

export interface ScreenAuditSnapshot {
  frameId: string;
  frameName: string;
  session: ScreenAuditSession;
  completedAt: number;
  review: ScreenAuditReviewSnapshot;
}

export interface TextAuditSnapshot {
  nodeId: string;
  nodeName: string;
  originalText: string;
  requestId: string;
  result: AnalyzeResponse;
  transport: AnalysisTransportKind;
  completedAt: number;
}

export interface AuditSessionStore {
  screenAudits: Map<string, ScreenAuditSnapshot>;
  textAudits: Map<string, TextAuditSnapshot>;
}

export function createAuditSessionStore(): AuditSessionStore {
  return { screenAudits: new Map(), textAudits: new Map() };
}

export function saveScreenAudit(
  store: AuditSessionStore,
  snapshot: ScreenAuditSnapshot,
): boolean {
  if (snapshot.session.status !== 'completed') {
    return false;
  }
  store.screenAudits.set(snapshot.frameId, snapshot);
  return true;
}

export function getScreenAudit(
  store: AuditSessionStore,
  frameId: string,
): ScreenAuditSnapshot | null {
  return store.screenAudits.get(frameId) ?? null;
}

export function updateScreenAuditReview(
  store: AuditSessionStore,
  frameId: string,
  review: ScreenAuditReviewSnapshot,
): boolean {
  const snapshot = getScreenAudit(store, frameId);
  if (snapshot === null) {
    return false;
  }
  store.screenAudits.set(frameId, { ...snapshot, review });
  return true;
}

export function removeFrameAudit(store: AuditSessionStore, frameId: string): boolean {
  return store.screenAudits.delete(frameId);
}

export function saveTextAudit(
  store: AuditSessionStore,
  snapshot: TextAuditSnapshot,
): void {
  store.textAudits.set(snapshot.nodeId, snapshot);
}

export function getTextAudit(
  store: AuditSessionStore,
  nodeId: string,
): TextAuditSnapshot | null {
  return store.textAudits.get(nodeId) ?? null;
}

export type ReconciledTextAuditState = 'current' | 'changed' | 'deleted';

export function reconcileTextAudit(
  snapshot: TextAuditSnapshot,
  node: { id: string; type: string; characters?: string } | null,
): ReconciledTextAuditState {
  if (node === null || node.id !== snapshot.nodeId || node.type !== 'TEXT') {
    return 'deleted';
  }
  return node.characters === snapshot.originalText ? 'current' : 'changed';
}

export function reconcileScreenCandidate(
  expectedText: string,
  node: {
    type: string;
    characters?: string;
    belongsToAuditedFrame: boolean;
  } | null,
): ScreenAuditNavigationState {
  if (node === null || node.type !== 'TEXT' || !node.belongsToAuditedFrame) {
    return 'deleted';
  }
  return node.characters === expectedText ? 'current' : 'changed_since_audit';
}
