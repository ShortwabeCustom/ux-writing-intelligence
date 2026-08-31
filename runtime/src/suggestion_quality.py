"""
Decisión sobre la sugerencia final: guardas, no-op de alta calidad,
issues visibles y razón determinista.

Principio rector (STEP 10): `response.text` SIEMPRE es `request.text`.
El significado pertenece al origen. El modelo solo propone una sugerencia,
y esa propuesta debe sobrevivir a todas las guardas para llegar a la persona.
"""
import re

from . import (boundary_integrity, glossary, locale_integrity, orthography,
               protected_content, semantic_fidelity)

# Capas de seguridad, en el orden en que se aplican.
LAYERS = ("protected_content", "boundary", "meta", "locale", "semantic")


def deterministic_floor(text: str):
    """
    Piso determinista: lo que el producto puede afirmar sin ayuda del modelo.
    Ortografía primero, glosario después.
    """
    t, ortho_changes = orthography.apply(text)
    t, glossary_changes = glossary.apply(t)
    return t, ortho_changes, glossary_changes


def guard(source: str, candidate: str, context: str = ""):
    """
    (ok, [(capa, razón)]) — valida un candidato contra todas las capas.
    """
    rejections = []

    if not (candidate or "").strip():
        return False, [("empty", "la sugerencia está vacía")]

    ok, problems = protected_content.verify(source, candidate)
    rejections += [("protected_content", p) for p in problems]

    ok, problems = boundary_integrity.check(source, candidate)
    rejections += [("boundary", p) for p in problems]

    rejections += [("meta", m) for m in locale_integrity.detect_meta(candidate)]

    english = locale_integrity.detect_english(source, candidate, context)
    if english:
        rejections.append(("locale", f"contiene palabras en inglés: {', '.join(english)}"))

    ok, problems = semantic_fidelity.check(source, candidate, context)
    rejections += [("semantic", p) for p in problems]

    return (not rejections), rejections


def build_issues(ortho_changes, glossary_changes, source_ortho_violations):
    """Issues visibles construidos SOLO con evidencia determinista del producto."""
    issues = []

    for ch in glossary_changes:
        issues.append({
            "category": "glosario",
            "severity": "high",
            "term": ch["term"],
            "reason": f"{ch['reason']} Usa «{ch['recommended']}».",
        })

    for ch in ortho_changes:
        issues.append({
            "category": "ortografia",
            "severity": "medium" if ch["kind"] == "accent" else "low",
            "term": ch.get("term"),
            "reason": ch["reason"],
        })

    return issues


def _cosmetic_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().casefold()).rstrip(".;:,!")


def is_cosmetic_variation(floor: str, candidate: str) -> bool:
    """
    ¿El candidato solo cambia mayúsculas o puntuación final respecto del piso?

    Un nodo de texto en Figma que dice «no fue posible» y vuelve como
    «No fue posible.» cambió la cadena que se renderiza sin aportar nada. Es
    reescritura gratuita, no una mejora, y el piso determinista es preferible.
    """
    return _cosmetic_key(floor) == _cosmetic_key(candidate) and floor != candidate


def explainable_jargon(glossary_changes) -> bool:
    """
    STEP 12: `jargon` es true SOLO cuando hay evidencia de producto que lo
    explique. La opinión del modelo no es autoridad aquí.

    Limitación conocida y aceptada: la evidencia está acotada al glosario. Un
    término jergoso que no esté en el glosario no marca `jargon`, porque no
    podríamos justificarlo ante la persona usuaria. Preferimos un falso
    negativo explicable a un verdadero positivo inexplicable.
    """
    return bool(glossary_changes)


def is_high_quality_noop(score, issues, orthography_score, glossary_changes) -> bool:
    """STEP 21."""
    return (score >= 90
            and not issues
            and orthography_score == 5
            and not glossary_changes)


# --- Razón determinista (STEP 20) -------------------------------------------
# Prioridad: glosario > ortografía > claridad > utilidad > concisión >
#            predictibilidad > limpio.
# Textos orientados a la persona usuaria, sin lenguaje de implementación.

_WEAK = 3  # 3 o menos se considera criterio débil


def deterministic_reason(criteria, glossary_changes, ortho_changes) -> str:
    if glossary_changes:
        ch = glossary_changes[0]
        return (f"«{ch['term']}» es lenguaje interno. "
                f"En la interfaz conviene decir «{ch['recommended']}».")

    if ortho_changes:
        accents = [c for c in ortho_changes if c["kind"] == "accent"]
        if accents:
            return accents[0]["reason"]
        return ortho_changes[0]["reason"]

    if criteria["clarity"] <= _WEAK:
        return "El texto cuesta entenderlo en una sola lectura."
    if criteria["utility"] <= _WEAK:
        return "Al texto le falta decir qué gana la persona o qué sigue después."
    if criteria["concision"] <= _WEAK:
        return "Se puede decir lo mismo con menos palabras."
    if criteria["predictability"] <= _WEAK:
        return "El texto no anticipa con claridad lo que va a pasar."

    return "El texto está bien: es claro, breve y dice lo que la persona necesita."
