"""
Meta-pruebas de consistencia determinista (FASE 8.5.6, STEP 33 y 34).

MOTIVO: tres defectos distintos de fases previas tuvieron la misma forma —una
regla que CORRIGE el texto pero no se CONTABILIZA, dejando `orthography = 5`
junto a un issue visible, o un puntaje penalizado sin explicación—.

Las pruebas anteriores usaban listas escritas a mano, así que una regla nueva
entraba sin cobertura. Estas derivan los casos de las PROPIAS TABLAS de reglas:
añadir una entrada al diccionario la somete automáticamente al contrato.
"""
import pytest

from src import glossary as g
from src import orthography as o
from src import suggestion_quality as sq


# =============================================================================
# STEP 33 — ortografía
# =============================================================================

def _accent_cases():
    """Un caso por entrada corregible de SAFE_ACCENTS."""
    return [w for w, fixed in o.SAFE_ACCENTS.items()
            if w not in o.AMBIGUOUS_EXCLUDED and fixed.casefold() != w]


@pytest.mark.parametrize("word", _accent_cases())
def test_toda_tilde_corregida_se_contabiliza(word):
    """Si apply() la corrige, violations() debe verla y el puntaje bajar."""
    text = f"Revisa tu {word} ahora"
    corrected, changes = o.apply(text)

    assert corrected != text, f"«{word}» está en la tabla pero no se corrigió"
    assert changes, "hubo corrección sin evidencia asociada"
    assert o.violations(text), f"«{word}» se corrige pero no se contabiliza"
    assert o.score(text) < 5, "hay corrección pero el puntaje es perfecto"
    assert o.score(corrected) == 5, "el texto ya corregido no puntúa 5"


@pytest.mark.parametrize("word", sorted(o.INTERROGATIVES))
def test_todo_interrogativo_corregido_se_contabiliza(word):
    text = f"¿{_capitalize(word)} puedo continuar?"
    corrected, changes = o.apply(text)

    assert corrected != text, f"«{word}» está en la tabla pero no se corrigió"
    assert changes
    assert o.violations(text), f"«{word}» se corrige pero no se contabiliza"
    assert o.score(text) < 5
    assert o.score(corrected) == 5


def _capitalize(word: str) -> str:
    return word[:1].upper() + word[1:]


@pytest.mark.parametrize("stem", ["informa", "opera", "valida", "confirma"])
def test_sufijo_cion_corregido_se_contabiliza(stem):
    text = f"Revisa la {stem}cion"
    corrected, changes = o.apply(text)

    assert corrected != text
    assert changes
    assert o.violations(text), "el sufijo -cion se corrige pero no se contabiliza"
    assert o.score(text) < 5
    assert o.score(corrected) == 5


def test_ninguna_regla_corrige_en_silencio():
    """Contrato general: corrección implica evidencia, en ambos sentidos."""
    muestras = [
        "prestamo", "¿Como funciona?", "hola ,María", "no  fue posible",
        "Revisa tu informacion", "Tu codigo es 123", "El maximo es 10",
        "Continuar", "Tu visita ha sido confirmada.", "¿Cómo funciona?",
    ]

    for text in muestras:
        corrected, _ = o.apply(text)
        cambio = corrected != text
        contado = bool(o.violations(text))
        assert cambio == contado, (
            f"«{text}»: corrige={cambio} pero contabiliza={contado}")
        assert (o.score(text) < 5) == cambio, (
            f"«{text}»: el puntaje no concuerda con la corrección")


def test_los_pares_excluidos_no_se_tocan():
    """La omisión es deliberada y debe seguir siéndolo."""
    for word in o.AMBIGUOUS_EXCLUDED:
        text = f"Revisa {word} dato"
        assert o.apply(text)[0] == text, f"«{word}» está excluido pero se corrigió"
        assert o.violations(text) == []


# =============================================================================
# STEP 34 — glosario
# =============================================================================

@pytest.mark.parametrize("key", sorted(g.GLOSSARY))
def test_todo_termino_del_glosario_es_visible_y_explicado(key):
    """Sin penalizaciones ocultas: sustituir implica issue, jerga y motivo."""
    term = g.GLOSSARY[key]
    text = f"Ingresa tus {key} para continuar"
    corrected, changes = g.apply(text)

    assert corrected != text, f"«{key}» está en el glosario pero no se sustituyó"
    assert changes, f"«{key}» se sustituyó sin evidencia"

    change = changes[0]
    assert change.get("reason"), "la sustitución no explica por qué"
    assert change["reason"] == term.reason, "el motivo no es el declarado"

    # La sugerencia debe contener el término recomendado, no el evitado.
    assert term.recommended.split()[0].casefold() in corrected.casefold(), (
        "el término recomendado no aparece en la sugerencia")
    assert key.casefold() not in corrected.casefold(), (
        "el término que debía evitarse sobrevivió")


@pytest.mark.parametrize("key", sorted(g.GLOSSARY))
def test_todo_termino_del_glosario_marca_jerga(key):
    """Un término del glosario en el texto implica jargon=True."""
    text = f"Ingresa tus {key} para continuar"
    assert g.violations(text), f"«{key}» no marca jerga"


def test_glosario_sin_penalizacion_oculta():
    """Un texto limpio no debe generar jerga ni sustituciones."""
    for text in ["Continuar", "Ingresa tus datos de acceso",
                 "Tu visita ha sido confirmada."]:
        corrected, changes = g.apply(text)
        assert corrected == text
        assert changes == []
        assert g.violations(text) == []


def test_cada_termino_recomendado_esta_limpio():
    """El reemplazo no puede volver a disparar el glosario: sería un bucle."""
    for key, term in g.GLOSSARY.items():
        assert g.apply(term.recommended)[0] == term.recommended, (
            f"el reemplazo de «{key}» vuelve a activar el glosario")
