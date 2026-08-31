"""
Glosario de producto. AUTORIDAD DETERMINISTA sobre la sugerencia del modelo.

Cada entrada declara si el término debe evitarse en UI y cuál es el término
recomendado. El motor nunca "consulta" al modelo sobre esto: sustituye.
"""
import re

from . import protected_content as pc


class Term:
    __slots__ = ("term", "avoid_in_ui", "recommended", "reason")

    def __init__(self, term, recommended, reason, avoid_in_ui=True):
        self.term = term
        self.recommended = recommended
        self.reason = reason
        self.avoid_in_ui = avoid_in_ui


GLOSSARY: dict[str, Term] = {
    "credenciales": Term(
        "credenciales", "datos de acceso",
        "Es lenguaje interno. La persona usuaria reconoce «datos de acceso»."),
    "credencial": Term(
        "credencial", "dato de acceso",
        "Es lenguaje interno. La persona usuaria reconoce «dato de acceso»."),
    "originación": Term(
        "originación", "solicitud",
        "Es jerga del negocio. En la interfaz el proceso se llama «solicitud»."),
    "originacion": Term(
        "originacion", "solicitud",
        "Es jerga del negocio. En la interfaz el proceso se llama «solicitud»."),
    "onboarding": Term(
        "onboarding", "registro",
        "Término en inglés. En la interfaz se llama «registro»."),
    "loguearte": Term(
        "loguearte", "iniciar sesión",
        "Anglicismo. En la interfaz se dice «iniciar sesión»."),
    "logearte": Term(
        "logearte", "iniciar sesión",
        "Anglicismo. En la interfaz se dice «iniciar sesión»."),
}

_COMPILED = [(re.compile(r"\b" + re.escape(k) + r"\b", re.IGNORECASE), t)
             for k, t in GLOSSARY.items()]


def _match_case(original: str, replacement: str) -> str:
    if original.isupper():
        return replacement.upper()
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def apply(text: str):
    """(texto, [cambios]) — cada cambio es un dict apto para construir un issue."""
    masked, toks = pc.mask(text)
    changes = []

    for rx, term in _COMPILED:
        def sub(m, _t=term):
            repl = _match_case(m.group(0), _t.recommended)
            changes.append({"term": m.group(0), "recommended": _t.recommended,
                            "reason": _t.reason})
            return repl
        masked = rx.sub(sub, masked)

    return pc.unmask(masked, toks), changes


def violations(text: str):
    """Términos de glosario que siguen presentes."""
    masked, _ = pc.mask(text)
    return [t.term for rx, t in _COMPILED if rx.search(masked)]
