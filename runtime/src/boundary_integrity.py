"""
Integridad de fronteras de origen. RELATIVA AL ORIGEN, sin listas negras.

Detecta UNA sola cosa: que el candidato fusione palabras que en el origen
estaban separadas.

    origen "App Banco"  ->  candidato "AppBanco"   RECHAZADO
    origen "no fue"     ->  candidato "nofue"      RECHAZADO
    origen "tuApp"      ->  candidato "tu App"     PERMITIDO (repara, no fusiona)

No hay lista negra de términos: una lista negra solo encuentra los defectos
que ya conocíamos. El espaciado y la puntuación pertenecen a orthography.py;
la fuga de meta, a locale_integrity.py.
"""
import re
import unicodedata

from . import protected_content as pc

_WORD_RE = re.compile(r"[\wáéíóúüñÁÉÍÓÚÜÑ]+")


def _norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn").casefold()


def check(source: str, candidate: str):
    """(ok, [razones])"""
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
            problems.append(f"une «{a}» y «{b}» en una sola palabra")

    return (not problems), problems
