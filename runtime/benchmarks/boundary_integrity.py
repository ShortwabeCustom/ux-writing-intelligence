"""
Integridad de fronteras de origen. RELATIVA AL ORIGEN, sin listas negras.

STEP 5 (8.5.2B): este módulo detecta UNA sola cosa — que el candidato fusione
palabras que en el origen estaban separadas. Nada más.

Deliberadamente NO contiene:
  - listas negras de términos ("appbanco", "nofue", "hayerrores"). Una lista
    negra solo encuentra los defectos que ya conocíamos; la detección relativa
    al origen encuentra los que no.
  - reglas de espaciado/puntuación. Eso es ortografía y vive en
    orthography_rules.py. Mezclarlas hacía que un espacio antes de coma se
    reportara como corrupción de frontera, que es un defecto distinto.
  - patrones de meta-salida. Eso vive en production_parity.detect_meta().

Reparar una frontera SÍ está permitido:
    origen    "tuApp"
    candidato "tu App"   -> PERMITIDO (el módulo solo penaliza fusionar)
"""
import re
import unicodedata

import protected_content as pc

_WORD_RE = re.compile(r"[\wáéíóúüñÁÉÍÓÚÜÑ]+")


def _norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn").casefold()


def check(source, candidate):
    """
    (ok, [razones]) — solo fusión de tokens adyacentes del origen.

    Heurística: para cada par de palabras contiguas (a, b) del origen, si el
    candidato contiene la concatenación 'ab' como palabra y NO contiene la
    forma separada 'a b', se considera frontera corrompida.
    """
    problems = []
    cand_masked, _ = pc.mask(candidate)
    cand_n = _norm(cand_masked)

    src_masked, _ = pc.mask(source)
    words = _WORD_RE.findall(src_masked)

    for a, b in zip(words, words[1:]):
        if len(a) < 2 or len(b) < 2:
            continue
        na, nb = _norm(a), _norm(b)
        glued = na + nb
        if re.search(r"\b" + re.escape(glued) + r"\b", cand_n) and f"{na} {nb}" not in cand_n:
            problems.append(f"fusiona {a!r}+{b!r} -> {glued!r} (en el origen iban separadas)")

    return (not problems), problems
