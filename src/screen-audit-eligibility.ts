/**
 * Elegibilidad determinista de Screen Audit (FASE 9.1).
 *
 * Función pura. Decide si un texto es ESTRUCTURALMENTE apropiado para entrar
 * a una auditoría futura. NO juzga la calidad de la redacción: esa autoridad
 * es del runtime local y no se replica aquí.
 *
 * SESGO DELIBERADO: alto recall. Ante la duda, se marca `ready`. Un texto de
 * más en la lista cuesta una inferencia futura; un texto de menos desaparece
 * sin que nadie se entere, y ese es el error caro.
 */
import type { ScreenAuditSkipReason } from './screen-audit-contracts';

export interface EligibilityInput {
  text: string;
  /** Visibilidad efectiva: el nodo y toda su ascendencia hasta el frame. */
  effectivelyVisible: boolean;
}

export interface EligibilityResult {
  status: 'ready' | 'skipped';
  skipReason: ScreenAuditSkipReason;
}

/** Segmentos protegidos que el producto ya reconoce. */
const PLACEHOLDER_RE = /\{\{[^}]*\}\}/gu;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/giu;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/giu;

/** Detección de letras consciente de Unicode. Nunca `[A-Za-z]`: eso dejaría
 *  fuera «Sí», «Contraseña», «Préstamo» y «¿Qué pasó?». */
const LETTER_RE = /\p{L}/u;

/**
 * Sufijos de hora. Se retiran ANTES de comprobar si quedan letras, porque
 * «9:41 p.m.» sí contiene letras y sin esto se clasificaría mal.
 */
const TIME_SUFFIX_RE = /\b(?:a\.?\s?m\.?|p\.?\s?m\.?|hrs?)\b/giu;

/** Puntuación y símbolos que acompañan a valores numéricos. */
const NUMERIC_NOISE_RE = /[\d\s.,:;/%$€£¥¢+\-–—()#*×x]/giu;

export function hasLetters(text: string): boolean {
  return LETTER_RE.test(text);
}

/** Retira los segmentos protegidos. SOLO para clasificar: nunca se guarda. */
export function stripProtectedSegments(text: string): string {
  return text
    .replace(EMAIL_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(PLACEHOLDER_RE, ' ');
}

export function containsProtectedSegment(text: string): boolean {
  return stripProtectedSegments(text) !== text;
}

/**
 * ¿El resto es un valor numérico o estructural, sin copia de interfaz?
 *
 * Conservador a propósito: exige al menos un dígito y que, tras retirar
 * dígitos, puntuación y sufijos de hora, no quede ni una letra. Así
 * «Tu visita será el 10 de abril» conserva letras y NO se omite.
 */
export function isNumericOrStructural(text: string): boolean {
  if (!/\d/u.test(text)) {
    return false;
  }

  const remainder = text
    .replace(TIME_SUFFIX_RE, ' ')
    .replace(NUMERIC_NOISE_RE, ' ');

  return !hasLetters(remainder);
}

/**
 * Clasificación. La prioridad es fija y el primer motivo que aplica gana.
 *
 *   1. vacío
 *   2. oculto
 *   3. solo contenido protegido
 *   4. solo números o valores
 *   5. sin lenguaje
 *   6. listo
 */
export function classifyText(input: EligibilityInput): EligibilityResult {
  const { text, effectivelyVisible } = input;

  // `trim()` se usa SOLO como sonda. La fuente almacenada nunca se altera.
  if (text.trim().length === 0) {
    return { status: 'skipped', skipReason: 'empty' };
  }

  if (!effectivelyVisible) {
    return { status: 'skipped', skipReason: 'hidden' };
  }

  const withoutProtected = stripProtectedSegments(text);

  // Solo contenido protegido: había segmentos protegidos y, al retirarlos, no
  // queda lenguaje natural. «Hola {{nombre}}» sí conserva «Hola» y sigue vivo.
  if (containsProtectedSegment(text) && !hasLetters(withoutProtected)) {
    return { status: 'skipped', skipReason: 'protected_only' };
  }

  if (!hasLetters(withoutProtected)) {
    return isNumericOrStructural(withoutProtected)
      ? { status: 'skipped', skipReason: 'numeric_only' }
      : { status: 'skipped', skipReason: 'non_language' };
  }

  // Quedan letras, pero podrían ser solo el sufijo de una hora: «9:41 p.m.».
  if (isNumericOrStructural(withoutProtected)) {
    return { status: 'skipped', skipReason: 'numeric_only' };
  }

  return { status: 'ready', skipReason: null };
}
