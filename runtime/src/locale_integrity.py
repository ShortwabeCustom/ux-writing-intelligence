"""
Integridad de idioma y ausencia de fuga de meta/modelo.

Dos comprobaciones distintas, deliberadamente separadas:

  - LOCALE: el texto visible debe ser español de México.
  - META: nada del modelo, su razonamiento, su esquema o su rol puede llegar
    a la persona usuaria.
"""
import re
import unicodedata

# Palabras inequívocamente inglesas que NO son también españolas.
ENGLISH_MARKERS = frozenset({
    "the", "and", "your", "you", "please", "click", "here", "with", "this",
    "that", "will", "message", "button", "user", "text", "should", "must",
    "instead", "because", "make", "sure", "need", "does", "have", "been",
    "from", "when", "there", "change", "improve", "field", "submit",
})

META_PATTERNS = (
    (r"/no_?think|/think\b", "token de control del modelo"),
    (r"<\s*/?\s*think\s*>", "etiqueta de razonamiento"),
    (r"<\|.*?\|>", "token especial del tokenizador"),
    (r"```", "bloque de código"),
    (r"^\s*(?:system|assistant|user)\s*:", "marca de rol de conversación"),
    (r"\bel texto (?:original )?(?:esta|es|no)\b", "comentario del asistente sobre el texto"),
    (r"\bcumple con los criterios\b", "comentario de evaluación"),
    (r"\bse recomienda\b|\brecomiendo\b", "comentario de recomendación"),
    (r"\bcomo (?:asistente|modelo|ia)\b", "auto-referencia del modelo"),
    (r"\b(?:clarity|concision|utility|predictability|jargon|suggestion|schema)\b",
     "nombre de campo del esquema"),
    (r"\bno hay problemas\b|\bno se detect\w+ problemas\b", "veredicto del asistente"),
    (r"^\s*(?:nota|aclaracion|explicacion)\s*:", "nota meta"),
    (r"\bformato de (?:salida|respuesta)\b", "discusión del formato de respuesta"),
)


def _n(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn").casefold()


def detect_meta(text: str):
    return [label for pat, label in META_PATTERNS
            if re.search(pat, _n(text), re.IGNORECASE | re.MULTILINE)]


def detect_english(source: str, candidate: str, context: str = ""):
    """
    Contaminación en inglés RELATIVA AL ORIGEN.

    No se penaliza lo que ya venía en el texto original ni lo que está dentro
    de URLs, correos, placeholders, siglas o nombres de marca: eso es contenido
    legítimo, no un fallo de idioma.
    """
    from . import protected_content as pc

    masked_cand, _ = pc.mask(candidate)
    masked_ref, _ = pc.mask(f"{source}\n{context}")

    # Se ignoran las siglas y los nombres propios (mayúscula inicial).
    cleaned = re.sub(r"\b[A-ZÁÉÍÓÚÑ][\wáéíóúüñ]*\b", " ", masked_cand)
    cleaned = re.sub(r"\b[A-Z]{2,}\b", " ", cleaned)

    cand_words = set(re.findall(r"[a-z]+", _n(cleaned)))
    ref_words = set(re.findall(r"[a-z]+", _n(masked_ref)))
    hits = sorted((cand_words & ENGLISH_MARKERS) - ref_words)
    return hits if len(hits) >= 2 else []
