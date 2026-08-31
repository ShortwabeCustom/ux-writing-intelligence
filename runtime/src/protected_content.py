"""
Contenido protegido: {{placeholders}}, URLs y correos.

Dos responsabilidades:
  1. enmascarar antes de que cualquier regla determinista toque el texto;
  2. verificar que un candidato los conserva byte por byte.
"""
import re

PLACEHOLDER_RE = re.compile(r"\{\{.*?\}\}", re.DOTALL)
URL_RE = re.compile(r"https?://[^\s,\)\]]+")
EMAIL_RE = re.compile(r"[\w.\-+]+@[\w\-]+\.[\w.\-]+")

_PATTERNS = ((PLACEHOLDER_RE, "placeholder"), (URL_RE, "URL"), (EMAIL_RE, "correo"))
_MASK = "\x00P{}\x00"


def extract(text: str):
    return [(m.group(0), kind) for pat, kind in _PATTERNS for m in pat.finditer(text)]


def mask(text: str):
    tokens: list[str] = []

    def repl(m):
        tokens.append(m.group(0))
        return _MASK.format(len(tokens) - 1)

    out = text
    for pat, _ in _PATTERNS:
        out = pat.sub(repl, out)
    return out, tokens


def unmask(text: str, tokens) -> str:
    for i, tok in enumerate(tokens):
        text = text.replace(_MASK.format(i), tok)
    return text


def verify(source: str, candidate: str):
    """(ok, [razones]). Byte por byte, sin tolerancia."""
    problems = []
    for tok, kind in extract(source):
        if tok not in candidate:
            problems.append(f"{kind} perdido o alterado: {tok}")
    source_ph = {t for t, k in extract(source) if k == "placeholder"}
    for m in PLACEHOLDER_RE.finditer(candidate):
        if m.group(0) not in source_ph:
            problems.append(f"placeholder inventado: {m.group(0)}")
    return (not problems), problems
