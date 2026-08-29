import type { SelectionState } from './shared/messages';

export function getSelectionState(
  selection: readonly SceneNode[],
): SelectionState {
  if (selection.length === 0) {
    return { status: 'no-selection' };
  }

  if (selection.length > 1) {
    return {
      status: 'multiple-selection',
      count: selection.length,
    };
  }

  const node = selection[0];

  if (node.removed) {
    return { status: 'no-selection' };
  }

  if (node.type !== 'TEXT') {
    return {
      status: 'invalid-selection',
      nodeType: node.type,
      nodeName: node.name,
    };
  }

  const textNode: TextNode = node;

  if (textNode.characters.trim().length === 0) {
    return {
      status: 'empty-text',
      nodeId: textNode.id,
      nodeName: textNode.name,
      text: textNode.characters,
    };
  }

  return {
    status: 'ready',
    nodeId: textNode.id,
    nodeName: textNode.name,
    text: textNode.characters,
  };
}
