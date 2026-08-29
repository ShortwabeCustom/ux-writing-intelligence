import type {
  ApplyErrorCode,
  ApplySession,
  ApplySuccessPayload,
} from './apply-contracts';

export interface ApplySelectionNode {
  type: string;
  id: string;
  characters?: string;
  removed?: boolean;
}

export type ApplyRequestValidation =
  | { valid: true }
  | { valid: false; code: ApplyErrorCode };

export type FontLoader = (font: FontName) => Promise<void>;
export type ApplyRevalidator = () => ApplyErrorCode | null;

export const APPLY_STYLE_FIELDS = [
  'fontName',
  'fontSize',
  'fontWeight',
  'textCase',
  'textDecoration',
  'letterSpacing',
  'lineHeight',
  'fills',
  'textStyleId',
  'fillStyleId',
  'openTypeFeatures',
] satisfies Array<keyof Omit<StyledTextSegment, 'characters' | 'start' | 'end'>>;

export class ApplyOperationError extends Error {
  readonly code: ApplyErrorCode;

  constructor(code: ApplyErrorCode) {
    super(code);
    this.name = 'ApplyOperationError';
    this.code = code;
  }
}

export function validateApplyContext(
  session: ApplySession,
  currentSelectionRevision: number,
  selection: readonly ApplySelectionNode[],
): ApplyRequestValidation {
  if (session.selectionRevision !== currentSelectionRevision) {
    return { valid: false, code: 'SELECTION_CHANGED' };
  }

  if (selection.length !== 1 || selection[0]?.type !== 'TEXT') {
    return { valid: false, code: 'INVALID_SELECTION' };
  }

  const node = selection[0];

  if (node.removed === true) {
    return { valid: false, code: 'INVALID_SELECTION' };
  }

  if (node.id !== session.nodeId) {
    return { valid: false, code: 'SELECTION_CHANGED' };
  }

  if (node.characters !== session.originalText || session.originalText.length === 0) {
    return { valid: false, code: 'TEXT_CHANGED' };
  }

  if (session.suggestion.trim().length === 0) {
    return { valid: false, code: 'EMPTY_SUGGESTION' };
  }

  return { valid: true };
}

export function validateApplyRequest(
  requestId: string,
  session: ApplySession | null,
  currentSelectionRevision: number,
  selection: readonly ApplySelectionNode[],
): ApplyRequestValidation {
  if (session === null) {
    return { valid: false, code: 'NO_ACTIVE_ANALYSIS' };
  }

  if (requestId !== session.requestId) {
    return { valid: false, code: 'STALE_ANALYSIS' };
  }

  return validateApplyContext(session, currentSelectionRevision, selection);
}

export function acquireApplyLock(
  inFlightRequestId: string | null,
  requestId: string,
): string | null {
  return inFlightRequestId === null ? requestId : null;
}

export function hasMixedCharacterStyles(node: TextNode): boolean {
  return node.getStyledTextSegments(APPLY_STYLE_FIELDS).length !== 1;
}

export function getApplyPreflightError(node: TextNode): ApplyErrorCode | null {
  if (node.hasMissingFont) {
    return 'MISSING_FONT';
  }

  try {
    return hasMixedCharacterStyles(node)
      ? 'MIXED_STYLES_UNSUPPORTED'
      : null;
  } catch {
    // Preflight is advisory. Apply keeps the authoritative error handling.
    return null;
  }
}

export function getUniqueFontNames(node: TextNode): FontName[] {
  const uniqueFonts = new Map<string, FontName>();

  for (const font of node.getRangeAllFontNames(0, node.characters.length)) {
    uniqueFonts.set(`${font.family}\u0000${font.style}`, font);
  }

  return [...uniqueFonts.values()];
}

export async function applySuggestionToTextNode(
  node: TextNode,
  suggestion: string,
  loadFont: FontLoader,
  revalidate: ApplyRevalidator = () => null,
): Promise<{ previousText: string; appliedText: string }> {
  const previousText = node.characters;

  if (previousText.length === 0) {
    throw new ApplyOperationError('TEXT_CHANGED');
  }

  if (suggestion.trim().length === 0) {
    throw new ApplyOperationError('EMPTY_SUGGESTION');
  }

  if (node.hasMissingFont) {
    throw new ApplyOperationError('MISSING_FONT');
  }

  let fonts: FontName[];

  try {
    if (hasMixedCharacterStyles(node)) {
      throw new ApplyOperationError('MIXED_STYLES_UNSUPPORTED');
    }

    fonts = getUniqueFontNames(node);
  } catch (error: unknown) {
    if (error instanceof ApplyOperationError) {
      throw error;
    }

    throw new ApplyOperationError('EDIT_FAILED');
  }

  try {
    await Promise.all(fonts.map(loadFont));
  } catch {
    throw new ApplyOperationError('FONT_LOAD_FAILED');
  }

  const revalidationError = revalidate();

  if (revalidationError !== null) {
    throw new ApplyOperationError(revalidationError);
  }

  let insertedSuggestion = false;

  try {
    node.insertCharacters(0, suggestion, 'AFTER');
    insertedSuggestion = true;
    node.deleteCharacters(suggestion.length, suggestion.length + previousText.length);
  } catch {
    if (insertedSuggestion) {
      try {
        node.deleteCharacters(0, suggestion.length);
      } catch {
        // Figma owns undo; the original edit error remains the safe UI result.
      }
    }

    throw new ApplyOperationError('EDIT_FAILED');
  }

  return {
    previousText,
    appliedText: node.characters,
  };
}

export function createApplySuccessPayload(
  session: ApplySession,
  appliedText: string,
  nextSelectionRevision: number,
): ApplySuccessPayload {
  return {
    nodeId: session.nodeId,
    previousText: session.originalText,
    appliedText,
    selectionRevision: nextSelectionRevision,
  };
}
