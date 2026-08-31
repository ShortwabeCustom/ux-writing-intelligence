"""
Ortografía determinista es-MX. AUTORIDAD sobre la sugerencia del modelo.

POLÍTICA CONSERVADORA, DELIBERADA:

Solo se corrige lo inequívoco. Los pares acentuales cuyo sentido depende del
contexto sintáctico quedan FUERA:

    esta / está      mas / más       aun / aún
    si / sí          solicito / solicitó       el / él

Desambiguarlos exige análisis sintáctico. Un corrector que se equivoque ahí
cambia el significado, que es precisamente lo que esta capa existe para
proteger. Se prefiere no corregir a corregir mal.
"""
import re

from . import protected_content as pc

# Formas sin tilde que NO son palabras válidas en español: corregirlas es seguro.
SAFE_ACCENTS = {
    "prestamo": "préstamo", "prestamos": "préstamos",
    "credito": "crédito", "creditos": "créditos",
    "telefono": "teléfono", "telefonos": "teléfonos",
    "codigo": "código", "codigos": "códigos",
    "numero": "número", "numeros": "números",
    "sesion": "sesión",
    "aqui": "aquí", "asi": "así",
    "tambien": "también", "despues": "después",
    "rapido": "rápido", "facil": "fácil", "dificil": "difícil",
    "ultimo": "último", "ultima": "última",
    "proximo": "próximo", "proxima": "próxima",
    "minimo": "mínimo", "maximo": "máximo",
    "dias": "días", "mexico": "México",
    "podras": "podrás", "deberas": "deberás", "tendras": "tendrás",
    "estara": "estará", "sera": "será", "vendra": "vendrá",
}

# Pares excluidos a propósito. Se documentan para que la omisión sea explícita
# y auditable, no un olvido.
AMBIGUOUS_EXCLUDED = frozenset({
    "esta", "mas", "aun", "si", "solicito", "el", "tu", "mi", "se", "de",
})

_CION_RE = re.compile(r"\b([a-záéíóúüñ]{3,}?)cion\b", re.IGNORECASE)

INTERROGATIVES = {
    "como": "cómo", "cuando": "cuándo", "donde": "dónde",
    "cuanto": "cuánto", "cuanta": "cuánta", "cuantos": "cuántos",
    "cuantas": "cuántas", "quien": "quién", "quienes": "quiénes",
    "cual": "cuál", "cuales": "cuáles", "que": "qué",
}
_QUESTION_SPAN_RE = re.compile(r"¿[^?]*\?|(?<![¿\w])[A-ZÁÉÍÓÚÑ][^.?!¿]*\?")
_WORD_RE = re.compile(r"\b[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+\b")


def _preserve_case(orig: str, repl: str) -> str:
    if orig.isupper():
        return repl.upper()
    if orig[:1].isupper():
        return repl[:1].upper() + repl[1:]
    return repl


def apply(text: str):
    """(texto_corregido, [cambios])."""
    masked, toks = pc.mask(text)
    changes = []
    out = masked

    # 1. Espaciado y puntuación
    before = out
    out = re.sub(r"[^\S\n]+([,;:.!?])", r"\1", out)
    if out != before:
        changes.append({"kind": "spacing", "reason": "Sobra un espacio antes del signo de puntuación."})

    before = out
    out = re.sub(r"([,;:])(?=[^\s\d\x00])", r"\1 ", out)
    if out != before:
        changes.append({"kind": "spacing", "reason": "Falta un espacio después de la coma."})

    before = out
    out = re.sub(r"[^\S\n]{2,}", " ", out)
    if out != before:
        changes.append({"kind": "spacing", "reason": "Hay espacios de más entre palabras."})

    before = out
    out = re.sub(r"[^\S\n]+\n", "\n", out)
    out = re.sub(r"[ \t]+$", "", out)
    if out != before:
        changes.append({"kind": "spacing", "reason": "Sobran espacios al final de la línea."})

    # 2. Tildes inequívocas
    def acc(m):
        w = m.group(0)
        low = w.casefold()
        if low in AMBIGUOUS_EXCLUDED:
            return w
        repl = SAFE_ACCENTS.get(low)
        if repl and repl.casefold() != low:
            changes.append({"kind": "accent", "term": w, "recommended": _preserve_case(w, repl),
                            "reason": f"«{w}» se escribe con tilde: «{_preserve_case(w, repl)}»."})
            return _preserve_case(w, repl)
        return w

    out = _WORD_RE.sub(acc, out)

    def cion(m):
        w = m.group(0)
        repl = w[:-4] + "ción"
        changes.append({"kind": "accent", "term": w, "recommended": _preserve_case(w, repl),
                        "reason": f"«{w}» se escribe con tilde: «{_preserve_case(w, repl)}»."})
        return _preserve_case(w, repl)

    out = _CION_RE.sub(cion, out)

    # 3. Interrogativos dentro de una pregunta
    def fix_question(m):
        span = m.group(0)

        def inner(mm):
            w = mm.group(0)
            repl = INTERROGATIVES.get(w.casefold())
            if repl:
                changes.append({"kind": "accent", "term": w, "recommended": _preserve_case(w, repl),
                                "reason": f"En una pregunta, «{w}» lleva tilde: «{_preserve_case(w, repl)}»."})
                return _preserve_case(w, repl)
            return w

        return _WORD_RE.sub(inner, span, count=2)

    out = _QUESTION_SPAN_RE.sub(fix_question, out)

    # 4. Signo de apertura faltante
    before = out
    out = re.sub(r"(?<![¿\w])(?<!\S)([A-ZÁÉÍÓÚÑ][^.?!¿\n]*\?)", lambda m: "¿" + m.group(1), out)
    if out != before:
        changes.append({"kind": "punctuation", "reason": "Falta el signo «¿» de apertura."})

    return pc.unmask(out, toks), changes


def violations(text: str):
    """Defectos ortográficos aún presentes."""
    masked, _ = pc.mask(text)
    bad = []
    if re.search(r"[^\S\n]{2,}", masked):
        bad.append("espacios múltiples")
    if re.search(r"[^\S\n]+[,;:.!?]", masked):
        bad.append("espacio antes de puntuación")
    if re.search(r"[,;:](?=[^\s\d\x00])", masked):
        bad.append("falta espacio tras coma")
    for w in re.findall(r"\b[a-záéíóúüñ]+\b", masked.casefold()):
        if w not in AMBIGUOUS_EXCLUDED and w in SAFE_ACCENTS and SAFE_ACCENTS[w].casefold() != w:
            bad.append(f"falta tilde en «{w}»")

    # Sufijo -cion. Va aquí por la misma razón que los interrogativos: apply()
    # lo corrige, así que violations() tiene que verlo o el puntaje miente.
    for m in _CION_RE.finditer(masked):
        bad.append(f"falta tilde en «{m.group(0)}»")
    if re.search(r"(?<![¿\w])[A-ZÁÉÍÓÚÑ][^.?!¿\n]*\?", masked):
        bad.append("falta «¿» de apertura")

    # Interrogativos sin tilde dentro de una pregunta. Debe contarse aquí:
    # si apply() lo corrige y genera un issue visible, el puntaje tiene que
    # reflejarlo. Si no, la respuesta se contradice — muestra un defecto de
    # ortografía y a la vez una ortografía perfecta.
    for span in _QUESTION_SPAN_RE.findall(masked):
        for word in _WORD_RE.findall(span)[:2]:
            if word.casefold() in INTERROGATIVES:
                bad.append(f"falta tilde en «{word}»")
                break

    return bad


def score(text: str) -> int:
    """Puntaje 1..5 de ortografía a partir del número de defectos detectados."""
    n = len(violations(text))
    return {0: 5, 1: 4, 2: 3, 3: 2}.get(n, 1)
