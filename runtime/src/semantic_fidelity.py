"""
Fidelidad semántica en tiempo de ejecución.

DIFERENCIA IMPORTANTE CON EL HARNESS DE BENCHMARK (FASE 8.5.2):

El harness recibía expectativas declaradas por caso (`facts`). En producción no
existe tal metadato: solo hay el texto de origen. Por eso todas las reglas de
este módulo derivan la expectativa DEL PROPIO ORIGEN:

    si el origen niega        -> el candidato debe seguir negando
    si el origen no da causa  -> el candidato no puede inventar una
    si el origen permite      -> el candidato no puede obligar

ADVERTENCIA DE ALCANCE:
Son reglas heurísticas de alta precisión, no comprensión semántica. Un RECHAZO
casi siempre señala un defecto real; una ACEPTACIÓN solo significa que ninguna
regla conocida detectó violación. No prueba que el significado se preservó.
"""
import re
import unicodedata

NEGATION = r"(?:\bno\b|\bnunca\b|\bsin\b|\btampoco\b|\bningun\w*\b|\brechaz\w*|\bnegad\w*)"
_NEG_WINDOW = 45

APPROVAL = r"(?:fue|ha sido|han sido|esta|estara|quedo|es|son)\s+(?:aprobad\w+|autorizad\w+)|aprobamos|autorizamos"
CONFIRMATION = r"(?:fue|ha sido|han sido|esta|quedo|es)\s+confirmad\w+|confirmamos"
AVAILABILITY = r"(?:ya\s+)?(?:esta|estara|se encuentra)\s+disponible|ya puedes (?:usar|disponer|retirar)|esta list\w+ para"
OBLIGATION = r"\bdebes\b|\bdeberas\b|\btienes que\b|\bes necesario\b|\bes obligatorio\b|\bobligatori\w+|\brequerid\w+|\bindispensable\b"
PERMISSION = r"\bpuedes\b|\bpodras\b|\bopcional\b|\bsi (?:lo )?(?:quieres|deseas|prefieres)\b"
CONDITIONAL = r"\bsi\b|\ben caso de\b|\bcuando\b|\ba menos que\b|\bsiempre que\b|\bde lo contrario\b"
CAUSE = r"\bporque\b|\bdebido a\b|\bya que\b|\ba causa de\b|\bpor motivo de\b|\bderivado de\b"
RECOVERY = (r"\bintentalo de nuevo\b|\bintenta de nuevo\b|\bvuelve a intentar\w*\b|"
            r"\bcontacta\w*\s+(?:a\s+)?(?:soporte|servicio|atencion)\b|\bllama\w*\s+a\b|"
            r"\bacude a\b|\brepite la operacion\b|\bvuelve a cargar\b|\brefresca\b|"
            r"\brevisa tu conexion\b|\bverifica tu conexion\b")
IN_TRANSIT = r"\besta\s+en camino\b|\bva en camino\b|\bya viene\b|\bya salio\b|\bse dirige\b"

INVENTED_ACTIONS = (
    "confirma tu solicitud", "confirmar tu solicitud", "siguiente paso",
    "contacta a soporte", "contacta soporte", "haz clic", "haz click",
    "da clic", "dar clic", "intentalo de nuevo", "intenta de nuevo",
    "vuelve a intentarlo", "presiona aqui", "toca aqui", "oprime aqui",
    "ingresa a la app", "descarga la app", "llama a servicio al cliente",
    "acude a tu sucursal", "revisa tu correo", "revisa tu conexion",
)

# Cada estado enumera TODAS sus formas verbales usuales, incluida la primera
# persona del plural ("agendamos", "guardamos"), que es la voz habitual del
# producto. Omitirla produce falsos positivos: el texto conserva el estado pero
# la regla no lo reconoce. Ese error ya se cometió una vez y se corrigió aquí.
STATUS_LEMMAS = {
    "scheduled": r"agendad\w+|agendamos|program\w+",
    "confirmed": r"confirmad\w+|confirmamos",
    "registered": r"registrad\w+|registramos",
    "received": r"recibid\w+|recibimos",
    "approved": r"aprobad\w+|aprobamos|autorizad\w+|autorizamos",
    "rejected": r"rechazad\w+|rechazamos",
    "in_review": r"en revision|revisando|en proceso",
    "saved": r"guardad\w+|guardamos|almacenad\w+|almacenamos",
}

_NUM_RE = re.compile(r"\d[\d.,:]*")

# Palabras funcionales: no cuentan como "contenido".
_STOPWORDS = frozenset("""
el la los las un una unos unas de del al a ante con en para por sin sobre tras
y o u e que se su sus tu tus mi mis es son fue ser esta estan estan lo le les
te nos ya no si mas muy como cuando donde porque pero este esta estos estas ese
esa eso esto hay han ha he del me nuestra nuestro cual quien
""".split())

# Umbral de "fragmento corto". Por debajo de este número de palabras de
# contenido, el texto es una etiqueta o una frase mínima: no hay espacio para
# una elaboración legítima, así que agregar conceptos es invención.
_SHORT_FRAGMENT_MAX_CONTENT_WORDS = 4


def _content_words(text: str) -> set:
    return {w for w in re.findall(r"[a-zaeiounu]{3,}", _n(text))
            if w not in _STOPWORDS}


def _glossary_targets(source: str) -> set:
    """
    Palabras que el glosario introduce por autoridad, PARA ESTE texto.

    La exención es condicional a propósito: solo se eximen los reemplazos de
    términos que realmente aparecen en el origen. Eximir todos los objetivos
    del glosario siempre abriría un hueco — «solicitud» quedaría permitida en
    cualquier texto solo porque es el reemplazo de «originación».
    """
    from . import glossary
    out = set()
    for rx, term in glossary._COMPILED:
        if rx.search(source):
            out |= _content_words(term.recommended)
    return out


def invented_expansion(source: str, candidate: str, context: str = ""):
    """
    Detecta EXPANSIÓN inventada en fragmentos cortos.

    Se dispara solo cuando se cumplen las tres condiciones a la vez:

      1. el origen es un fragmento corto (<= 4 palabras de contenido);
      2. el candidato CONSERVA todas las palabras de contenido del origen,
         es decir, no reformula: expande;
      3. el candidato agrega palabras de contenido nuevas.

    Diseñada para alta precisión. Una reformulación legítima
    ("Hubo un problema" -> "Ocurrió un problema") no cumple la condición 2 y
    por lo tanto NO se rechaza. Los términos que introduce el glosario están
    exentos: "credenciales" -> "datos de acceso" es autoridad, no invención.
    """
    src_words = _content_words(source)
    if not src_words or len(src_words) > _SHORT_FRAGMENT_MAX_CONTENT_WORDS:
        return []
    cand_words = _content_words(candidate)
    if not src_words <= cand_words:
        return []          # reformuló; no es una expansión
    added = cand_words - cand_words.intersection(_content_words(context)) - src_words
    added -= _glossary_targets(source)
    return sorted(added)


def _n(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn").casefold()


def _present(text: str, pattern: str) -> bool:
    return bool(re.search(pattern, _n(text)))


def _asserts(text: str, pattern: str) -> bool:
    """Aserción positiva sin negación en la ventana previa."""
    t = _n(text)
    for m in re.finditer(pattern, t):
        if not re.search(NEGATION, t[max(0, m.start() - _NEG_WINDOW):m.start()]):
            return True
    return False


def check(source: str, candidate: str, context: str = ""):
    """
    (ok, [razones]) — todas las expectativas se derivan del origen (+ contexto).
    """
    problems = []
    ref = f"{source}\n{context}"

    # --- Acciones y rutas de recuperación inventadas -----------------------
    for action in INVENTED_ACTIONS:
        if _n(action) in _n(candidate) and _n(action) not in _n(ref):
            problems.append(f"propone «{action}», que no está en el texto original")

    if _present(candidate, RECOVERY) and not _present(ref, RECOVERY):
        problems.append("inventa una forma de resolver el problema que el texto original no ofrece")

    if _present(candidate, CAUSE) and not _present(ref, CAUSE):
        problems.append("inventa una causa que el texto original no menciona")

    # --- Expansión inventada en fragmentos cortos ---------------------------
    added = invented_expansion(source, candidate, context)
    if added:
        problems.append("agrega al texto original palabras que no estaban: "
                        + ", ".join(f"«{w}»" for w in added))

    # --- Negación ----------------------------------------------------------
    if _present(source, NEGATION) and not _present(candidate, NEGATION):
        problems.append("elimina la negación del texto original")

    # --- Modalidad: permiso / obligación / opcionalidad --------------------
    if _present(candidate, OBLIGATION) and not _present(ref, OBLIGATION):
        if _present(source, PERMISSION):
            problems.append("convierte en obligación algo que el texto original solo permite")
        else:
            problems.append("introduce una obligación que el texto original no establece")

    if _present(source, r"\bopcional\b") and _present(candidate, OBLIGATION):
        problems.append("convierte en obligatorio algo que el texto original marca como opcional")

    # --- Condicionalidad ---------------------------------------------------
    if _present(source, r"\bsi\b|\bcuando\b|\ben caso de\b") and not _present(candidate, CONDITIONAL):
        problems.append("convierte una condición en un hecho seguro")

    # --- Estados de producto ------------------------------------------------
    for pattern, label in ((APPROVAL, "aprobación"), (CONFIRMATION, "confirmación"),
                           (AVAILABILITY, "disponibilidad"), (IN_TRANSIT, "que ya va en camino")):
        if _asserts(candidate, pattern) and not _asserts(ref, pattern):
            problems.append(f"afirma {label} que el texto original no establece")
        if _asserts(source, pattern) and not _asserts(candidate, pattern):
            problems.append(f"pierde la {label} que el texto original afirma")

    src_status = {k for k, p in STATUS_LEMMAS.items() if _present(source, p)}
    if src_status:
        for k, p in STATUS_LEMMAS.items():
            if k not in src_status and _present(candidate, p) and not _present(ref, p):
                problems.append("cambia el estado que reporta el texto original")
                break
        for k in src_status:
            if not _present(candidate, STATUS_LEMMAS[k]):
                problems.append("pierde el estado que reporta el texto original")
                break

    # --- Hechos numéricos: montos, fechas, horas, cifras --------------------
    s_nums = {x.rstrip(".,") for x in _NUM_RE.findall(source)}
    c_nums = {x.rstrip(".,") for x in _NUM_RE.findall(candidate)}
    if c_nums - s_nums:
        problems.append("introduce cifras que no están en el texto original")
    if s_nums - c_nums:
        problems.append("pierde cifras del texto original")

    return (not problems), problems
