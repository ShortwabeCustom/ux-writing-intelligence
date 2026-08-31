"""
Ortografía determinista es-MX. AUTORIDAD sobre la sugerencia del modelo.

Alcance deliberadamente CONSERVADOR: solo correcciones inequívocas.
Palabras cuyo acento cambia el significado según contexto
(esta/está, solicito/solicitó, mas/más, aun/aún, el/él, si/sí)
quedan FUERA: un corrector determinista no puede desambiguarlas sin
análisis sintáctico, y equivocarse ahí sería peor que no corregir.
"""
import re

import protected_content as pc

# Tildes inequívocas: estas formas sin tilde no son palabras válidas en español.
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

# Sufijo -cion -> -ción (inequívoco en singular).
_CION_RE = re.compile(r"\b([a-záéíóúüñ]{3,}?)cion\b", re.IGNORECASE)

# Interrogativos: solo dentro de una pregunta.
INTERROGATIVES = {
    "como": "cómo", "cuando": "cuándo", "donde": "dónde",
    "cuanto": "cuánto", "cuanta": "cuánta", "cuantos": "cuántos",
    "cuantas": "cuántas", "quien": "quién", "quienes": "quiénes",
    "cual": "cuál", "cuales": "cuáles", "que": "qué",
}
_QUESTION_SPAN_RE = re.compile(r"¿[^?]*\?|(?<![¿\w])[A-ZÁÉÍÓÚÑ][^.?!¿]*\?")


def _preserve_case(orig, repl):
    if orig.isupper():
        return repl.upper()
    if orig[:1].isupper():
        return repl[:1].upper() + repl[1:]
    return repl


def apply(text):
    """Devuelve (texto_corregido, [cambios])."""
    masked, toks = pc.mask(text)
    changes = []
    out = masked

    # --- 1. Espaciado / puntuación --------------------------------------
    before = out
    out = re.sub(r"[^\S\n]+([,;:.!?])", r"\1", out)
    if out != before:
        changes.append("puntuación: espacio antes de signo eliminado")

    before = out
    out = re.sub(r"([,;:])(?=[^\s\d\x00])", r"\1 ", out)
    if out != before:
        changes.append("puntuación: espacio añadido tras coma")

    before = out
    out = re.sub(r"[^\S\n]{2,}", " ", out)
    if out != before:
        changes.append("espaciado: espacios múltiples colapsados")

    before = out
    out = re.sub(r"[^\S\n]+\n", "\n", out)
    out = re.sub(r"[ \t]+$", "", out)
    if out != before:
        changes.append("espaciado: espacios finales eliminados")

    # --- 2. Tildes inequívocas ------------------------------------------
    def acc(m):
        w = m.group(0)
        repl = SAFE_ACCENTS.get(w.casefold())
        if repl and repl.casefold() != w.casefold():
            changes.append(f"tilde: {w!r} -> {_preserve_case(w, repl)!r}")
            return _preserve_case(w, repl)
        return w

    out = re.sub(r"\b[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+\b", acc, out)

    def cion(m):
        w = m.group(0)
        repl = w[:-4] + "ción"
        changes.append(f"tilde: {w!r} -> {_preserve_case(w, repl)!r}")
        return _preserve_case(w, repl)

    out = _CION_RE.sub(cion, out)

    # --- 3. Interrogativos dentro de preguntas ---------------------------
    def fix_question(m):
        span = m.group(0)
        def inner(mm):
            w = mm.group(0)
            repl = INTERROGATIVES.get(w.casefold())
            if repl:
                changes.append(f"interrogativo: {w!r} -> {_preserve_case(w, repl)!r}")
                return _preserve_case(w, repl)
            return w
        return re.sub(r"\b[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+\b", inner, span, count=2)

    out = _QUESTION_SPAN_RE.sub(fix_question, out)

    # --- 4. Signo de apertura faltante ------------------------------------
    before = out
    out = re.sub(r"(?<![¿\w])(?<!\S)([A-ZÁÉÍÓÚÑ][^.?!¿\n]*\?)",
                 lambda m: "¿" + m.group(1), out)
    if out != before:
        changes.append("puntuación: '¿' de apertura restaurado")

    return pc.unmask(out, toks), changes


def violations(text):
    """Defectos ortográficos que siguen presentes tras aplicar autoridad."""
    masked, _ = pc.mask(text)
    bad = []
    if re.search(r"[^\S\n]{2,}", masked):
        bad.append("espacios múltiples")
    if re.search(r"[^\S\n]+[,;:.!?]", masked):
        bad.append("espacio antes de puntuación")
    if re.search(r"[,;:](?=[^\s\d\x00])", masked):
        bad.append("falta espacio tras coma")
    for w in re.findall(r"\b[a-záéíóúüñ]+\b", masked.casefold()):
        if w in SAFE_ACCENTS and SAFE_ACCENTS[w].casefold() != w:
            bad.append(f"falta tilde: {w!r}")
    if re.search(r"(?<![¿\w])[A-ZÁÉÍÓÚÑ][^.?!¿\n]*\?", masked):
        bad.append("falta '¿' de apertura")
    return bad
