"""
FASE 8.5.1 — Validador determinista de salida de modelo.

NO intenta juzgar toda la calidad de UX Writing. Solo verifica invariantes
de alta confianza, donde un FAIL es objetivamente un defecto.

Uso como librería:
    from validate_output import extract_json, validate
"""

import json
import re
import unicodedata

# --------------------------------------------------------------------------
# Extracción de JSON
# --------------------------------------------------------------------------

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.MULTILINE)


def extract_json(raw: str):
    """Devuelve (obj|None, error|None). Tolera fences y bloques <think>."""
    if raw is None:
        return None, "respuesta vacía"
    txt = _THINK_RE.sub("", raw)
    txt = _FENCE_RE.sub("", txt).strip()
    if not txt:
        return None, "respuesta vacía tras limpiar"

    try:
        return json.loads(txt), None
    except Exception:
        pass

    # Primer objeto balanceado
    start = txt.find("{")
    if start == -1:
        return None, "no hay '{' en la respuesta"
    depth, in_str, esc = 0, False, False
    for i in range(start, len(txt)):
        ch = txt[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(txt[start:i + 1]), None
                except Exception as e:
                    return None, f"JSON malformado: {e}"
    return None, "objeto JSON sin cerrar"


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

SCORE_KEYS = ["clarity", "concision", "utility", "predictability", "orthography"]

PLACEHOLDER_RE = re.compile(r"\{\{.*?\}\}", re.DOTALL)
URL_RE = re.compile(r"https?://[^\s,\)]+")
EMAIL_RE = re.compile(r"[\w.\-+]+@[\w\-]+\.[\w.\-]+")

# Palabras inequívocamente inglesas (no son también español).
ENGLISH_MARKERS = {
    "the", "and", "your", "you", "please", "click", "here", "with", "this",
    "that", "will", "message", "button", "user", "text", "should", "must",
    "change", "improve", "clarity", "suggestion", "instead", "because",
    "make", "sure", "need", "does", "have", "been", "from", "when", "there",
}

# Acciones que el modelo NO debe inventar si no están en el origen.
INVENTED_ACTIONS = [
    "confirma tu solicitud",
    "siguiente paso",
    "contacta a soporte",
    "contacta soporte",
    "haz clic",
    "haz click",
    "da clic",
    "dar clic",
    "inténtalo de nuevo",
    "intentalo de nuevo",
    "intenta de nuevo",
    "vuelve a intentarlo",
    "presiona aquí",
    "toca aquí",
    "ingresa a la app",
    "llama a servicio al cliente",
]


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def _norm_compare(s: str) -> str:
    """Normalización para comparar 'cambió o no cambió' el texto."""
    s = s.strip().casefold()
    s = re.sub(r"\s+", " ", s)
    return s.rstrip(".")


def _words(s: str):
    return set(re.findall(r"[a-záéíóúüñ]+", s.casefold()))


def _all_text(obj) -> str:
    """suggestion + razones de issues, para checks de idioma."""
    parts = [str(obj.get("suggestion", ""))]
    for it in obj.get("issues", []) or []:
        if isinstance(it, dict):
            parts += [str(it.get("reason", "")), str(it.get("term", "")),
                      str(it.get("category", ""))]
    return "\n".join(parts)


# --------------------------------------------------------------------------
# Checks individuales -> (bool, reason)
# --------------------------------------------------------------------------

def _c_json_valid(src, obj, raw):
    if not isinstance(obj, dict):
        return False, "la respuesta no es un objeto JSON"
    missing = [k for k in SCORE_KEYS if k not in obj]
    if missing:
        return False, f"faltan claves de score: {missing}"
    bad = []
    for k in SCORE_KEYS:
        v = obj[k]
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not (1 <= v <= 5):
            bad.append(f"{k}={v!r}")
    if bad:
        return False, f"scores fuera de rango 1..5: {bad}"
    if "jargon" not in obj or not isinstance(obj["jargon"], bool):
        return False, f"'jargon' ausente o no booleano: {obj.get('jargon')!r}"
    if not isinstance(obj.get("issues", []), list):
        return False, "'issues' no es lista"
    if "suggestion" not in obj or not isinstance(obj["suggestion"], str):
        return False, "'suggestion' ausente o no string"
    return True, "contrato JSON completo y tipado correcto"


def _c_spanish(src, obj, raw):
    hits = _words(_all_text(obj)) & ENGLISH_MARKERS
    if len(hits) >= 2:
        return False, f"contaminación en inglés: {sorted(hits)}"
    return True, "sin contaminación en inglés"


def _c_no_empty(src, obj, raw):
    s = str(obj.get("suggestion", "")).strip()
    if not s:
        return False, "suggestion vacía"
    return True, "suggestion no vacía"


def _c_placeholders(src, obj, raw):
    s = str(obj.get("suggestion", ""))
    lost = []
    for pat, label in ((PLACEHOLDER_RE, "placeholder"), (URL_RE, "URL"), (EMAIL_RE, "email")):
        for tok in pat.findall(src):
            if tok not in s:
                lost.append(f"{label} {tok!r}")
    if lost:
        return False, "no preservado byte-a-byte: " + "; ".join(lost)
    return True, "placeholders/URLs/emails preservados byte-a-byte"


def _boundary_check(token, label):
    def fn(src, obj, raw):
        s = _strip_accents(str(obj.get("suggestion", ""))).casefold()
        if token in s:
            return False, f"frontera de token corrompida: aparece {label!r}"
        return True, f"sin corrupción {label!r}"
    return fn


def _c_no_invented(src, obj, raw):
    s = _strip_accents(str(obj.get("suggestion", ""))).casefold()
    src_n = _strip_accents(src).casefold()
    found = [a for a in INVENTED_ACTIONS
             if _strip_accents(a).casefold() in s
             and _strip_accents(a).casefold() not in src_n]
    if found:
        return False, f"acción inventada ausente del origen: {found}"
    return True, "sin acciones de producto inventadas"


def _c_orto_prestamo(src, obj, raw):
    s = str(obj.get("suggestion", "")).casefold()
    if "préstamo" in s:
        return True, "corrige a 'préstamo' con tilde"
    if "prestamo" in s:
        return False, "mantiene 'prestamo' sin tilde"
    return False, f"no produjo 'préstamo'; suggestion={s[:80]!r}"


def _c_orto_como(src, obj, raw):
    s = str(obj.get("suggestion", "")).casefold()
    if "cómo" in s:
        return True, "corrige a 'cómo' con tilde"
    return False, f"no produjo 'cómo' con tilde; suggestion={s[:80]!r}"


def _c_orto_comma(src, obj, raw):
    s = str(obj.get("suggestion", ""))
    if re.search(r"\s+,", s):
        return False, "espacio antes de coma no corregido"
    if re.search(r",(?=\S)", s):
        return False, "falta espacio después de coma"
    return True, "espaciado de coma correcto"


def _c_orto_double_space(src, obj, raw):
    s = str(obj.get("suggestion", ""))
    if re.search(r"[^\S\n]{2,}", s):
        return False, "doble espacio no corregido"
    return True, "sin dobles espacios"


def _glossary_check(needle, label):
    def fn(src, obj, raw):
        s = _strip_accents(str(obj.get("suggestion", ""))).casefold()
        if needle in s:
            return False, f"conserva jerga {label!r} en la suggestion"
        return True, f"elimina jerga {label!r}"
    return fn


def _c_good_text(src, obj, raw):
    s = str(obj.get("suggestion", ""))
    if _norm_compare(s) == _norm_compare(src):
        return True, "texto correcto no reescrito"
    return False, f"reescritura innecesaria: {src!r} -> {s!r}"


def _c_multiline(src, obj, raw):
    s = str(obj.get("suggestion", ""))
    exp = len([p for p in re.split(r"\n\s*\n", src) if p.strip()])
    got = len([p for p in re.split(r"\n\s*\n", s) if p.strip()])
    if exp != got:
        return False, f"párrafos: origen={exp}, suggestion={got}"
    return True, f"estructura multilínea preservada ({exp} párrafos)"


CHECKS = {
    "JSON_VALID": _c_json_valid,
    "SPANISH_OUTPUT": _c_spanish,
    "NO_EMPTY_SUGGESTION": _c_no_empty,
    "PROTECTED_PLACEHOLDERS_PRESERVED": _c_placeholders,
    "NO_APPBANCO": _boundary_check("appbanco", "AppBanco"),
    "NO_NOFUE": _boundary_check("nofue", "nofue"),
    "NO_HAYERRORES": _boundary_check("hayerrores", "hayerrores"),
    "NO_INVENTED_ACTION": _c_no_invented,
    "ORTHOGRAPHY_PRESTAMO": _c_orto_prestamo,
    "ORTHOGRAPHY_COMO": _c_orto_como,
    "ORTHOGRAPHY_COMMA_SPACING": _c_orto_comma,
    "ORTHOGRAPHY_DOUBLE_SPACE": _c_orto_double_space,
    "GLOSSARY_CREDENCIALES": _glossary_check("credencial", "credenciales"),
    "GLOSSARY_ORIGINACION": _glossary_check("originaci", "originación"),
    "GOOD_TEXT_NO_UNNECESSARY_CHANGE": _c_good_text,
    "MULTILINE_SAFE": _c_multiline,
}

# Fallos que se cuentan como CRÍTICOS de selección de modelo (STEP 18).
CRITICAL_CHECKS = {
    "JSON_VALID",
    "PROTECTED_PLACEHOLDERS_PRESERVED",
    "NO_INVENTED_ACTION",
    "SPANISH_OUTPUT",
    "NO_APPBANCO",
    "NO_NOFUE",
    "NO_HAYERRORES",
    "NO_EMPTY_SUGGESTION",
}


def validate(case, raw):
    """Devuelve dict con results por check y agregados."""
    obj, err = extract_json(raw)
    results = []
    if obj is None:
        for name in case["checks"]:
            results.append({
                "check": name, "status": "FAIL",
                "reason": f"no se pudo extraer JSON ({err})",
                "critical": name in CRITICAL_CHECKS,
            })
    else:
        for name in case["checks"]:
            fn = CHECKS.get(name)
            if fn is None:
                results.append({"check": name, "status": "SKIP",
                                "reason": "check no implementado", "critical": False})
                continue
            try:
                ok, reason = fn(case["text"], obj, raw)
            except Exception as e:
                ok, reason = False, f"error del validador: {e}"
            results.append({"check": name, "status": "PASS" if ok else "FAIL",
                            "reason": reason, "critical": (not ok) and name in CRITICAL_CHECKS})

    total = sum(1 for r in results if r["status"] != "SKIP")
    passed = sum(1 for r in results if r["status"] == "PASS")
    return {
        "case_id": case["id"],
        "category": case["category"],
        "json_ok": obj is not None,
        "json_error": err,
        "parsed": obj,
        "checks": results,
        "passed": passed,
        "total": total,
        "case_status": "PASS" if passed == total else "FAIL",
        "critical_failures": [r["check"] for r in results if r["critical"]],
    }


if __name__ == "__main__":
    import sys
    print("Módulo de validación. Checks disponibles:")
    for k in CHECKS:
        print("  -", k, "(CRÍTICO)" if k in CRITICAL_CHECKS else "")
    sys.exit(0)
