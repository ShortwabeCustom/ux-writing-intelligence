/** Selection policy for preserving a Screen Audit review context. */

export interface AuditNodeLike {
  readonly id: string;
  readonly removed: boolean;
  readonly parent: AuditNodeLike | null;
}

/** True only when every selected node is the audited Frame or its descendant. */
export function isSelectionInsideAuditedFrame(
  selection: readonly AuditNodeLike[],
  auditedFrameId: string,
): boolean {
  return selection.length > 0 && selection.every(
    (node) => !node.removed && belongsToFrame(node, auditedFrameId),
  );
}

/** Walks ancestors instead of relying on a one-shot selectionchange flag. */
export function belongsToFrame(
  node: AuditNodeLike,
  auditedFrameId: string,
): boolean {
  let current: AuditNodeLike | null = node;

  while (current !== null && !current.removed) {
    if (current.id === auditedFrameId) {
      return true;
    }
    current = current.parent;
  }

  return false;
}
