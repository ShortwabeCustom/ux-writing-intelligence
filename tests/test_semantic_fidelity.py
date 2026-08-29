"""
Las expectativas se derivan del ORIGEN, no de metadatos por caso: en producción
solo existe el texto que llega en la petición.
"""
import pytest

from src import semantic_fidelity as sf

RECHAZOS = [
    ("Hubo un problema al guardar.",
     "Hubo un problema al guardar. Revisa tu conexión a internet e inténtalo de nuevo.",
     "ruta de recuperación inventada"),
    ("Hubo un problema al guardar.",
     "Hubo un problema al guardar porque tu sesión expiró.",
     "causa inventada"),
    ("No fue posible aprobar el incremento.",
     "Fue posible aprobar el incremento.",
     "negación eliminada"),
    ("Puedes usar tu préstamo inicial.",
     "Debes usar tu préstamo inicial.",
     "permiso convertido en obligación"),
    ("Este campo es opcional.",
     "Este campo es obligatorio.",
     "opcional convertido en obligatorio"),
    ("Tu visita ha sido agendada.",
     "Tu visita ha sido confirmada.",
     "estado cambiado"),
    ("Si no recibimos tu confirmación, la visita no se llevará a cabo.",
     "La visita no se llevará a cabo.",
     "condición convertida en certeza"),
    ("Te avisaremos cuando tu asesor esté en camino.",
     "Tu asesor está en camino.",
     "tránsito afirmado sin base"),
    ("El monto mínimo es de 3,000 pesos.",
     "El monto mínimo es de 5,000 pesos.",
     "monto alterado"),
    ("Tu pago vence el 15 de mayo.",
     "Tu pago vence pronto.",
     "fecha perdida"),
    ("Consulta tu solicitud.",
     "Confirma tu solicitud.",
     "acción inventada"),
    ("Tu solicitud está en revisión.",
     "Tu solicitud fue aprobada.",
     "aprobación afirmada sin base"),
]

ACEPTACIONES = [
    ("Hubo un problema al guardar.", "Ocurrió un problema al guardar."),
    ("No fue posible aprobar el incremento.", "No pudimos aprobar el incremento."),
    ("Puedes usar tu préstamo inicial.", "Puedes usar tu préstamo inicial."),
    ("Tu visita ha sido agendada.", "Ya agendamos tu visita."),
    ("El monto mínimo es de 3,000 pesos.", "El monto mínimo es de 3,000 pesos."),
    ("Este campo es opcional.", "Este campo es opcional."),
]


@pytest.mark.parametrize("source,candidate,label", RECHAZOS)
def test_rechaza(source, candidate, label):
    ok, problems = sf.check(source, candidate)
    assert not ok, f"debió rechazar: {label}"
    assert problems


@pytest.mark.parametrize("source,candidate", ACEPTACIONES)
def test_acepta_reescrituras_fieles(source, candidate):
    ok, problems = sf.check(source, candidate)
    assert ok, f"rechazo indebido: {problems}"


def test_contexto_autoriza_lo_que_el_origen_no_dice():
    """Si el contexto de pantalla ya ofrece el reintento, deja de ser invención."""
    ok, _ = sf.check("Hubo un problema al guardar.",
                     "Hubo un problema al guardar. Inténtalo de nuevo.",
                     context="La pantalla muestra un botón: Inténtalo de nuevo")
    assert ok


# Regresión de la clase de bug que apareció en FASE 8.5.2: un estado expresado
# en primera persona del plural no debe leerse como pérdida de estado.
PRIMERA_PERSONA = [
    ("Tu visita ha sido agendada.", "Ya agendamos tu visita."),
    ("Tus cambios fueron guardados.", "Guardamos tus cambios."),
    ("Tu solicitud fue registrada.", "Registramos tu solicitud."),
    ("Tu documentación fue recibida.", "Recibimos tu documentación."),
]


@pytest.mark.parametrize("source,candidate", PRIMERA_PERSONA)
def test_primera_persona_plural_conserva_el_estado(source, candidate):
    ok, problems = sf.check(source, candidate)
    assert ok, f"falso positivo de estado: {problems}"


def test_todos_los_estados_reconocen_su_propio_lema():
    """Auto-consistencia: cada patrón debe reconocer un texto que lo expresa."""
    ejemplos = {
        "scheduled": "Tu visita ha sido agendada.",
        "confirmed": "Tu visita ha sido confirmada.",
        "registered": "Tu solicitud quedó registrada.",
        "received": "Recibimos tu documentación.",
        "approved": "Tu préstamo fue aprobado.",
        "rejected": "Tu incremento fue rechazado.",
        "in_review": "Tu solicitud está en revisión.",
        "saved": "Guardamos tus cambios.",
    }
    for estado, texto in ejemplos.items():
        ok, problems = sf.check(texto, texto)
        assert ok, f"el origen falla su propia expectativa ({estado}): {problems}"


# Expansión inventada en fragmentos cortos. Alta precisión: solo se dispara
# cuando el candidato conserva TODO el origen y además agrega conceptos.
EXPANSIONES_INVALIDAS = [
    ("no  fue posible", "no fue posible continuar"),
    ("Continuar", "Continuar con tu solicitud"),
    ("Reintentar", "Reintentar el pago ahora"),
]

REFORMULACIONES_VALIDAS = [
    ("Hubo un problema al guardar.", "Ocurrió un problema al guardar."),
    ("Ingresa tus credenciales", "Ingresa tus datos de acceso"),
    ("prestamo", "préstamo"),
    ("Tu visita ha sido agendada.", "Ya agendamos tu visita."),
]


@pytest.mark.parametrize("source,candidate", EXPANSIONES_INVALIDAS)
def test_rechaza_expansion_inventada(source, candidate):
    ok, problems = sf.check(source, candidate)
    assert not ok and any("no estaban" in p for p in problems)


@pytest.mark.parametrize("source,candidate", REFORMULACIONES_VALIDAS)
def test_acepta_reformulacion_de_fragmento_corto(source, candidate):
    ok, problems = sf.check(source, candidate)
    assert ok, f"rechazo indebido: {problems}"


def test_texto_largo_puede_reescribirse_con_libertad():
    """La regla de expansión NO aplica a textos con contenido suficiente."""
    src = ("Escribe el monto que quieres solicitar. El monto mínimo es de 3,000 pesos "
           "y el máximo depende de tu historial de pagos con nosotros.")
    cand = ("Escribe el monto que necesitas. El monto mínimo es de 3,000 pesos y el "
            "máximo depende de tu historial de pagos con nosotros.")
    assert sf.invented_expansion(src, cand) == []


def test_el_contexto_autoriza_conceptos_del_origen():
    ok, _ = sf.check("Continuar", "Continuar con el registro",
                     context="Pantalla de registro de usuario")
    assert ok
