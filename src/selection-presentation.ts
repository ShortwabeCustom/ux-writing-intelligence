/**
 * Copia de los estados de selección (FASE 9.1.1).
 *
 * Función pura, extraída de la interfaz para poder probarla: la copia vivía
 * dentro de un `switch` en `ui.ts`, y ese fichero toca el DOM al importarse.
 *
 * Motivo de la extracción: el smoke real encontró un texto factualmente
 * falso. Una instancia con «Calle» y «C 27» visibles dentro mostraba «Esta
 * capa no contiene texto». El problema no era el contenido, sino el tipo de
 * la raíz seleccionada, y nadie podía verificar esa copia sin abrir Figma.
 */
import type { SelectionState } from './shared/messages';

export interface SelectionPresentation {
  eyebrow: string;
  title: string;
  description: string;
}

export function getSelectionPresentation(
  state: SelectionState,
): SelectionPresentation {
  switch (state.status) {
    case 'no-selection':
      return {
        eyebrow: 'Sin selección',
        title: 'Selecciona un texto',
        description:
          'Selecciona una capa de texto en Figma para comenzar el análisis.',
      };

    case 'multiple-selection':
      return {
        eyebrow: `${state.count} capas seleccionadas`,
        title: 'Selecciona una sola capa',
        description:
          'Para analizar el contenido, selecciona únicamente una capa de texto.',
      };

    case 'invalid-selection':
      // Significa «raíz no soportada», NO «no hay texto dentro». Un grupo o
      // una instancia pueden contener mucho texto: lo que ocurre es que no
      // son raíces autorizadas de auditoría.
      return {
        eyebrow: state.nodeName,
        title: 'Esta selección no se puede auditar',
        description:
          'Selecciona una capa de texto para analizarla o un Frame para revisar su contenido.',
      };

    case 'empty-text':
      // Estado genuinamente distinto: la capa SÍ está soportada y sí es de
      // texto; simplemente no tiene contenido. No debe colapsarse con el
      // anterior.
      return {
        eyebrow: state.nodeName,
        title: 'Este texto está vacío',
        description: 'Agrega contenido a la capa de texto antes de analizarla.',
      };

    case 'frame':
      return {
        eyebrow: 'Pantalla',
        title: 'Pantalla seleccionada',
        description: 'Revisaremos el contenido de esta pantalla antes de auditarla.',
      };

    case 'ready':
      return {
        eyebrow: 'Capa de texto',
        title: 'Texto seleccionado',
        description: 'Contenido detectado en la selección actual.',
      };

    default:
      return assertNever(state);
  }
}

function assertNever(_value: never): never {
  throw new Error('Unhandled selection state.');
}
