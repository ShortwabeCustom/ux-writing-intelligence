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

  // FASE 9.1: FRAME es la única raíz autorizada de Screen Audit. Grupos,
  // secciones, componentes e instancias quedan fuera EN LA RAÍZ; sus textos
  // internos sí se descubren cuando cuelgan de un frame seleccionado.
  if (node.type === 'FRAME') {
    return {
      status: 'frame',
      nodeId: node.id,
      nodeName: node.name,
    };
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
