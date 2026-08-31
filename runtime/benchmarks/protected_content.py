"""
Contenido protegido: {{placeholders}}, URLs y correos.

Doble rol:
  1. Enmascarar antes de que cualquier regla determinista toque el texto.
  2. Verificar que el modelo los devolvió byte por byte.
"""
import re

PLACEHOLDER_RE = re.compile(r"\{\{.*?\}\}", re.DOTALL)
URL_RE = re.compile(r"https?://[^\s,\)\]]+")
EMAIL_RE = re.compile(r"[\w.\-+]+@[\w\-]+\.[\w.\-]+")

PATTERNS = [(PLACEHOLDER_RE, "placeholder"), (URL_RE, "url"), (EMAIL_RE, "email")]

_MASK = "\x00PROT{}\x00"


def extract(text):
    """Lista de (token, tipo) en orden de aparición."""
    found = []
    for pat, kind in PATTERNS:
        for m in pat.finditer(text):
            found.append((m.group(0), kind))
    return found


def mask(text):
    """Sustituye contenido protegido por centinelas no imprimibles."""
    tokens = []

    def repl(m):
        tokens.append(m.group(0))
        return _MASK.format(len(tokens) - 1)

    out = text
    for pat, _ in PATTERNS:
        out = pat.sub(repl, out)
    return out, tokens


def unmask(text, tokens):
    for i, tok in enumerate(tokens):
        text = text.replace(_MASK.format(i), tok)
    return text


def verify(source, candidate):
    """(ok, [razones]) — cada token del origen debe seguir presente, idéntico."""
    problems = []
    for tok, kind in extract(source):
        if tok not in candidate:
            problems.append(f"{kind} perdido o alterado: {tok!r}")
    # placeholders inventados que no existían en el origen
    src_ph = {t for t, k in extract(source) if k == "placeholder"}
    for m in PLACEHOLDER_RE.finditer(candidate):
        if m.group(0) not in src_ph:
            problems.append(f"placeholder inventado: {m.group(0)!r}")
    return (not problems), problems
