/**
 * Descubrimiento de textos dentro de un frame (FASE 9.1).
 *
 * Solo LECTURA. No muta el documento, no carga fuentes, no cambia la
 * selección y no mueve el viewport.
 *
 * Trabaja sobre una forma estructural mínima —no sobre tipos de Figma— para
 * poder probarse sin la aplicación. El hilo principal adapta los nodos reales.
 */
import type {
  ScreenAuditCandidate,
  ScreenAuditPreflight,
} from './screen-audit-contracts';
import { classifyText } from './screen-audit-eligibility';

/** Forma mínima que necesita el descubrimiento. */
export interface ScreenNodeLike {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly opacity?: number;
  /** Presente solo en nodos de texto. */
  readonly characters?: string;
  readonly children?: readonly ScreenNodeLike[];
  readonly absoluteBoundingBox?: { readonly x: number; readonly y: number } | null;
}

interface DiscoveredNode {
  node: ScreenNodeLike;
  parentName: string | null;
  effectivelyVisible: boolean;
  discoveryIndex: number;
}

/**
 * Visibilidad efectiva.
 *
 * Un texto no es auditable si él mismo está oculto, o si CUALQUIER ancestro
 * entre él y el frame raíz lo está. Se considera también `opacity === 0`
 * cuando está disponible.
 *
 * Deliberadamente simple: no se interpretan recortes, modos de fusión, alfa
 * de relleno ni renderizado. Una heurística visual sofisticada sería
 * inexplicable y difícil de justificar cuando se equivocara.
 */
export function isNodeVisible(node: ScreenNodeLike): boolean {
  if (node.visible === false) {
    return false;
  }

  return node.opacity === undefined || node.opacity > 0;
}

function isTextNode(node: ScreenNodeLike): boolean {
  return node.type === 'TEXT' && typeof node.characters === 'string';
}

/** Recorre el subárbol del frame y recoge todos los nodos de texto. */
export function collectTextNodes(root: ScreenNodeLike): DiscoveredNode[] {
  const found: DiscoveredNode[] = [];

  const walk = (
    node: ScreenNodeLike,
    parentName: string | null,
    ancestorsVisible: boolean,
  ): void => {
    const visibleHere = ancestorsVisible && isNodeVisible(node);

    if (isTextNode(node)) {
      found.push({
        node,
        parentName,
        effectivelyVisible: visibleHere,
        discoveryIndex: found.length,
      });
      return;
    }

    for (const child of node.children ?? []) {
      // Los textos dentro de instancias y componentes anidados SÍ cuentan:
      // la restricción de esta fase es sobre el tipo de la RAÍZ seleccionada,
      // no sobre lo que hay debajo.
      walk(child, node.name, visibleHere);
    }
  };

  // La raíz es el frame: su propia visibilidad no descalifica a sus hijos,
  // porque es lo que la persona seleccionó deliberadamente.
  for (const child of root.children ?? []) {
    walk(child, root.name, true);
  }

  return found;
}

/**
 * Orden visual: primero Y ascendente, luego X ascendente.
 *
 * Los nodos sin geometría se colocan al final conservando el orden de
 * descubrimiento. Nunca se rompe el preflight por una geometría ausente.
 */
function sortVisually(nodes: DiscoveredNode[]): DiscoveredNode[] {
  return [...nodes].sort((left, right) => {
    const leftBox = left.node.absoluteBoundingBox;
    const rightBox = right.node.absoluteBoundingBox;

    if (leftBox == null && rightBox == null) {
      return left.discoveryIndex - right.discoveryIndex;
    }

    if (leftBox == null) {
      return 1;
    }

    if (rightBox == null) {
      return -1;
    }

    if (leftBox.y !== rightBox.y) {
      return leftBox.y - rightBox.y;
    }

    if (leftBox.x !== rightBox.x) {
      return leftBox.x - rightBox.x;
    }

    return left.discoveryIndex - right.discoveryIndex;
  });
}

/**
 * Contexto determinista que la fase semántica futura podrá reutilizar.
 *
 * SOLO SE PREPARA. No se envía a ninguna parte: no hay red en esta fase.
 */
export function buildContext(
  frameName: string,
  layerName: string,
  parentName: string | null,
): string {
  const base = `Pantalla: ${frameName}. Capa: ${layerName}.`;
  return parentName === null ? base : `${base} Contenedor: ${parentName}.`;
}

export function buildPreflight(
  frame: ScreenNodeLike,
  revision: number,
): ScreenAuditPreflight {
  const discovered = sortVisually(collectTextNodes(frame));

  const candidates: ScreenAuditCandidate[] = discovered.map((entry, index) => {
    // FUENTE DE LA VERDAD: se guarda `characters` tal cual. La clasificación
    // usa cadenas derivadas temporales, nunca sustituye el original.
    const text = entry.node.characters ?? '';
    const { status, skipReason } = classifyText({
      text,
      effectivelyVisible: entry.effectivelyVisible,
    });

    return {
      nodeId: entry.node.id,
      text,
      layerName: entry.node.name,
      parentName: entry.parentName,
      order: index,
      status,
      skipReason,
      context: buildContext(frame.name, entry.node.name, entry.parentName),
    };
  });

  const eligibleCount = candidates.filter((c) => c.status === 'ready').length;

  return {
    frameId: frame.id,
    frameName: frame.name,
    revision,
    detectedCount: candidates.length,
    eligibleCount,
    skippedCount: candidates.length - eligibleCount,
    candidates,
  };
}

/**
 * Recuento diagnóstico de cadenas repetidas.
 *
 * NO elimina candidatos y NO promete menos llamadas al modelo: dos textos
 * idénticos en contextos distintos pueden no ser equivalentes. «Continuar» en
 * un pie de pago no es «Continuar» en un onboarding.
 */
export function countExactRepeats(preflight: ScreenAuditPreflight): number {
  const seen = new Set<string>();
  let repeats = 0;

  for (const candidate of preflight.candidates) {
    if (candidate.status !== 'ready') {
      continue;
    }

    if (seen.has(candidate.text)) {
      repeats += 1;
    } else {
      seen.add(candidate.text);
    }
  }

  return repeats;
}
