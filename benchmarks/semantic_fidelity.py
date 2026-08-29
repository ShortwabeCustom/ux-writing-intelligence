"""
Fidelidad semántica.

ADVERTENCIA DE ALCANCE — LEER ANTES DE CONFIAR EN ESTOS RESULTADOS:

Estos validadores son HEURÍSTICOS. Son familias de expresiones regulares con
conciencia de ventana de negación. NO son comprensión semántica.

Lo que sí garantizan: cuando marcan FAIL, casi siempre hay un defecto real
(alta precisión, elegido a propósito sobre alto recall).
Lo que NO garantizan: que un PASS signifique que el significado se preservó.
Un modelo puede degradar el sentido de una forma que ninguna regex prevé.

Por eso el reporte separa "fallo detectado" de "significado verificado".
"""
import re
import unicodedata

HEURISTIC = True  # todos los checks de este módulo están etiquetados como heurísticos

NEGATION = r"(?:\bno\b|\bnunca\b|\bsin\b|\btampoco\b|\bningún\b|\bninguna\b|\brechaz\w*|\bnegad\w*)"
_NEG_WINDOW = 45

APPROVAL = r"(?:fue|ha sido|han sido|está|estará|quedó|es|son)\s+(?:aprobad\w+|autorizad\w+)|aprobamos|autorizamos|te aprobamos"
CONFIRMATION = r"(?:fue|ha sido|han sido|está|quedó|es)\s+confirmad\w+|confirmamos|te confirmamos"
AVAILABILITY = r"(?:ya\s+)?(?:está|estará|se encuentra)\s+disponible|ya puedes (?:usar|disponer|retirar)|está list\w+ para"
OBLIGATION = r"\bdebes\b|\bdeberás\b|\btienes que\b|\bes necesario\b|\bes obligatorio\b|\bobligatori\w+|\brequerid\w+|\bindispensable\b|\bdebe\b"
PERMISSION = r"\bpuedes\b|\bpodrás\b|\bpuede\b|\bopcional\b|\bsi (?:lo )?(?:quieres|deseas|prefieres)\b"
CONDITIONAL = r"\bsi\b|\ben caso de\b|\bcuando\b|\ba menos que\b|\bsiempre que\b|\bde lo contrario\b"
CAUSE = r"\bporque\b|\bdebido a\b|\bya que\b|\ba causa de\b|\bpor motivo de\b|\bderivado de\b"
RECOVERY = (r"\bint[eé]ntal[oa] de nuevo\b|\bintenta de nuevo\b|\bvuelve a intentar\w*\b|"
            r"\bcontacta\w*\s+(?:a\s+)?(?:soporte|servicio|atención)\b|\bllama\w*\s+a\b|"
            r"\bacude a\b|\brepite la operación\b|\bvuelve a cargar\b|\brefresca\b")
IN_TRANSIT = r"\best[áa]\s+en camino\b|\bva en camino\b|\bya viene\b|\bya sali[oó]\b|\bse dirige\b"

INVENTED_ACTIONS = [
    "confirma tu solicitud", "confirmar tu solicitud", "siguiente paso",
    "contacta a soporte", "contacta soporte", "haz clic", "haz click",
    "da clic", "dar clic", "intentalo de nuevo", "intenta de nuevo",
    "vuelve a intentarlo", "presiona aqui", "toca aqui", "oprime aqui",
    "ingresa a la app", "descarga la app", "llama a servicio al cliente",
    "acude a tu sucursal", "revisa tu correo",
]

_NUM_RE = re.compile(r"\d[\d.,:]*")


def _n(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn").casefold()


def _asserts(text, pattern):
    """Aserción positiva del patrón SIN negación en la ventana previa."""
    t = _n(text)
    pat = _n(pattern)
    for m in re.finditer(pat, t):
        window = t[max(0, m.start() - _NEG_WINDOW):m.start()]
        if not re.search(_n(NEGATION), window):
            return True
    return False


def _present(text, pattern):
    return bool(re.search(_n(pattern), _n(text)))


# ---------------------------------------------------------------------------
# Validadores de hechos. fn(source, candidate, value) -> (ok, reason)
# ---------------------------------------------------------------------------

def _f_approved(src, cand, val):
    pos = _asserts(cand, APPROVAL)
    if val is False and pos:
        return False, "afirma aprobación que el origen niega o no afirma"
    if val is True and not pos:
        return False, "pierde la afirmación de aprobación del origen"
    return True, f"estado de aprobación coherente (approved={val})"


def _f_confirmed(src, cand, val):
    pos = _asserts(cand, CONFIRMATION)
    if val is False and pos:
        return False, "convierte en 'confirmado' algo que el origen no confirma"
    if val is True and not pos:
        return False, "pierde la confirmación del origen"
    return True, f"estado de confirmación coherente (confirmed={val})"


def _f_available(src, cand, val):
    pos = _asserts(cand, AVAILABILITY)
    if val is False and pos:
        return False, "afirma disponibilidad que el origen no establece"
    return True, f"disponibilidad coherente (available={val})"


def _f_requirement(src, cand, val):
    has_obl = _present(cand, OBLIGATION) and not _present(src, OBLIGATION)
    if val is False and has_obl:
        return False, "convierte permiso/opción en obligación ('debes', 'tienes que'…)"
    if val is True and not _present(cand, OBLIGATION):
        return False, "pierde el carácter obligatorio del origen"
    return True, f"modalidad deóntica coherente (requirement={val})"


def _f_optional(src, cand, val):
    if val is True and _present(cand, OBLIGATION) and not _present(src, OBLIGATION):
        return False, "convierte un campo opcional en obligatorio"
    if val is True and not _present(cand, r"\bopcional\b|\bsi (?:lo )?(?:quieres|deseas)\b|\bpuedes\b"):
        return False, "pierde la marca de opcionalidad"
    return True, f"opcionalidad preservada (optional={val})"


def _f_modality(src, cand, val):
    if val == "permission":
        if _present(cand, OBLIGATION) and not _present(src, OBLIGATION):
            return False, "modalidad de permiso convertida en obligación"
        if not _present(cand, PERMISSION):
            return False, "pierde el marcador de permiso ('puedes', 'podrás'…)"
    if val == "obligation" and not _present(cand, OBLIGATION):
        return False, "pierde el marcador de obligación"
    return True, f"modalidad preservada ({val})"


def _f_negation(src, cand, val):
    if val is True and not _present(cand, NEGATION):
        return False, "elimina la negación del origen"
    return True, "negación preservada"


def _f_conditional(src, cand, val):
    if val is True and not _present(cand, CONDITIONAL):
        return False, "convierte una condición en certeza (pierde 'si'/'cuando')"
    return True, "estructura condicional preservada"


def _f_in_transit(src, cand, val):
    pos = _present(cand, IN_TRANSIT)
    if val is False and pos:
        return False, "afirma que ya va en camino; el origen solo promete avisar"
    return True, f"estado de tránsito coherente (in_transit={val})"


def _f_cause_stated(src, cand, val):
    if val is False and _present(cand, CAUSE) and not _present(src, CAUSE):
        return False, "inventa una causa que el origen no da"
    return True, f"causalidad coherente (cause_stated={val})"


def _f_recovery_path(src, cand, val):
    if val is False and _present(cand, RECOVERY) and not _present(src, RECOVERY):
        return False, "inventa una ruta de recuperación que el origen no ofrece"
    return True, f"ruta de recuperación coherente (recovery_path={val})"


def _f_status(src, cand, val):
    lemmas = {
        "scheduled": r"agendad\w+|programad\w+",
        "confirmed": r"confirmad\w+",
        "registered": r"registrad\w+|registramos|qued\w+ registrad\w+",
        "received": r"recibid\w+|recibimos|se recibi\w+",
        "approved": r"aprobad\w+|autorizad\w+",
        "rejected": r"rechazad\w+|no fue posible|no se aprob",
        "in_review": r"en revisi[óo]n|revisando|en proceso",
        "saved": r"guardad\w+|guardamos|se guard\w+|almacenad\w+",
    }
    pat = lemmas.get(val)
    if pat and not _present(cand, pat):
        return False, f"pierde o cambia el estado del origen (status={val})"
    for other, opat in lemmas.items():
        if other != val and val in lemmas and _present(cand, opat) and not _present(src, opat):
            return False, f"introduce el estado ajeno '{other}' (origen: {val})"
    return True, f"estado preservado ({val})"


def _f_no_new_numbers(src, cand, val):
    if val is not True:
        return True, "no aplica"
    s = {x.rstrip(".,") for x in _NUM_RE.findall(src)}
    c = {x.rstrip(".,") for x in _NUM_RE.findall(cand)}
    new, lost = c - s, s - c
    if new:
        return False, f"introduce cifras que no están en el origen: {sorted(new)}"
    if lost:
        return False, f"pierde cifras del origen: {sorted(lost)}"
    return True, "cifras del origen intactas"


def _f_preserve_literals(src, cand, val):
    missing = [t for t in (val or []) if t not in cand]
    if missing:
        return False, f"pierde literales obligatorios: {missing}"
    return True, "literales obligatorios preservados"


def _f_action_verb(src, cand, val):
    """val = {'keep': 'consulta', 'reject': ['confirma','autoriza']}"""
    keep = val.get("keep")
    if keep and not _present(cand, r"\b" + keep + r"\w*\b"):
        return False, f"pierde la acción del origen ('{keep}')"
    for bad in val.get("reject", []):
        if _present(cand, r"\b" + bad + r"\w*\b") and not _present(src, r"\b" + bad + r"\w*\b"):
            return False, f"sustituye la acción por otra distinta ('{bad}')"
    return True, "acción de usuario preservada"


FACT_CHECKS = {
    "approved": _f_approved,
    "confirmed": _f_confirmed,
    "available": _f_available,
    "requirement": _f_requirement,
    "optional": _f_optional,
    "modality": _f_modality,
    "negation": _f_negation,
    "conditional": _f_conditional,
    "in_transit": _f_in_transit,
    "cause_stated": _f_cause_stated,
    "recovery_path": _f_recovery_path,
    "status": _f_status,
    "no_new_numbers": _f_no_new_numbers,
    "preserve_literals": _f_preserve_literals,
    "action_verb": _f_action_verb,
}

# Hechos cuyo incumplimiento es CRÍTICO (STEP 9).
CRITICAL_FACTS = {
    "approved", "confirmed", "available", "requirement", "optional", "modality",
    "negation", "conditional", "in_transit", "cause_stated", "recovery_path",
    "status", "no_new_numbers", "preserve_literals", "action_verb",
}


def check_facts(source, candidate, facts):
    """[(clave, ok, razón, crítico)] — todos heurísticos."""
    out = []
    for key, val in (facts or {}).items():
        fn = FACT_CHECKS.get(key)
        if fn is None:
            out.append((key, True, "hecho sin validador implementado (SKIP)", False))
            continue
        try:
            ok, reason = fn(source, candidate, val)
        except Exception as e:
            ok, reason = False, f"error del validador: {e}"
        out.append((key, ok, reason, (not ok) and key in CRITICAL_FACTS))
    return out


def invented_actions(source, candidate):
    s, c = _n(source), _n(candidate)
    return [a for a in INVENTED_ACTIONS if _n(a) in c and _n(a) not in s]


def forbidden_hits(candidate, patterns):
    return [p for p in (patterns or []) if re.search(_n(p), _n(candidate))]
