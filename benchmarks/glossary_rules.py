"""
Glosario de producto. AUTORIDAD DETERMINISTA.

La sugerencia del modelo nunca gana sobre el glosario.
Este mapa es el que producción ya posee; aquí se reproduce para paridad.
"""
import re

import protected_content as pc

# término prohibido -> reemplazo canónico de producto
GLOSSARY = {
    "credenciales": "datos de acceso",
    "credencial": "dato de acceso",
    "originación": "solicitud",
    "originacion": "solicitud",
    "onboarding": "registro",
    "loguearte": "iniciar sesión",
    "logearte": "iniciar sesión",
}

_COMPILED = [(re.compile(r"\b" + re.escape(k) + r"\b", re.IGNORECASE), k, v)
             for k, v in GLOSSARY.items()]


def _match_case(original, replacement):
    if original.isupper():
        return replacement.upper()
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def apply(text):
    """Aplica autoridad del glosario. Devuelve (texto, [cambios])."""
    masked, toks = pc.mask(text)
    changes = []
    for rx, term, repl in _COMPILED:
        def sub(m):
            changes.append(f"glosario: {m.group(0)!r} -> {_match_case(m.group(0), repl)!r}")
            return _match_case(m.group(0), repl)
        masked = rx.sub(sub, masked)
    return pc.unmask(masked, toks), changes


def violations(text):
    """Términos de jerga que siguen presentes."""
    masked, _ = pc.mask(text)
    return [term for rx, term, _ in _COMPILED if rx.search(masked)]
