"""
Harness de PARIDAD DE PRODUCCIÓN.

Esto NO es el Local Runtime. No expone HTTP. Es una capa de evaluación que
reproduce los contratos de comportamiento que UX Writing Intelligence ya posee,
para juzgar a los modelos DENTRO de la arquitectura del producto y no en crudo.

Pipeline:

    origen
      |
      +-- ortografía determinista  ---+
      |                               |--> final_determinista (piso de seguridad)
      +-- glosario determinista    ---+
      |
      +-- sugerencia del modelo --> guardas --> ¿segura?
                                                 sí -> se acepta y se le REIMPONE
                                                       la autoridad determinista
                                                 no -> se descarta; gana el
                                                       final_determinista

STEP 3A: el significado es del origen, nunca del modelo.
STEP 10: se reportan dos niveles, RAW (modelo solo) y FINAL (dentro del producto).
"""
import re
import unicodedata

import boundary_integrity as bi
import glossary_rules as gl
import orthography_rules as ort
import protected_content as pc
import semantic_fidelity as sf

# --- Fuga de meta / tokens de control (STEP 3I) -----------------------------
META_PATTERNS = [
    (r"/no_?think|/think\b", "token de control del modelo"),
    (r"<\s*/?\s*think\s*>", "etiqueta de razonamiento"),
    (r"<\|.*?\|>", "token especial del tokenizer"),
    (r"```", "bloque de código en el texto de usuario"),
    (r"\bel texto (?:original )?(?:est[áa]|es|no)\b", "comentario del asistente sobre el texto"),
    (r"\bcumple con los criterios\b", "comentario de evaluación"),
    (r"\bse recomienda\b|\brecomiendo\b", "comentario de recomendación"),
    (r"\bcomo (?:asistente|modelo|IA)\b", "auto-referencia del modelo"),
    (r"\b(?:clarity|concision|utility|predictability|jargon|suggestion|schema)\b",
     "nombre de campo del esquema filtrado"),
    (r"\bno hay problemas\b|\bno se detect\w+ problemas\b", "veredicto del asistente"),
    (r"^\s*(?:nota|aclaración|explicación)\s*:", "nota meta"),
]

ENGLISH_MARKERS = {
    "the", "and", "your", "you", "please", "click", "here", "with", "this",
    "that", "will", "message", "button", "user", "text", "should", "must",
    "instead", "because", "make", "sure", "need", "does", "have", "been",
    "from", "when", "there", "original", "change", "improve",
}


def _n(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn").casefold()


def _norm_cmp(s):
    return re.sub(r"\s+", " ", (s or "").strip().casefold()).rstrip(".")


def detect_meta(text):
    hits = []
    for pat, label in META_PATTERNS:
        if re.search(pat, _n(text), re.IGNORECASE | re.MULTILINE):
            hits.append(label)
    return hits


def detect_english(text):
    words = set(re.findall(r"[a-z]+", _n(text)))
    hits = words & ENGLISH_MARKERS
    return sorted(hits) if len(hits) >= 2 else []


# --- Validación de salida estructurada (STEP 4) -----------------------------
SCORE_KEYS = ["clarity", "concision", "utility", "predictability"]

SCHEMA = {
    "type": "object",
    "properties": {
        "clarity": {"type": "integer", "minimum": 1, "maximum": 5},
        "concision": {"type": "integer", "minimum": 1, "maximum": 5},
        "utility": {"type": "integer", "minimum": 1, "maximum": 5},
        "predictability": {"type": "integer", "minimum": 1, "maximum": 5},
        "jargon": {"type": "boolean"},
        "reason": {"type": "string"},
        "suggestion": {"type": "string"},
    },
    "required": ["clarity", "concision", "utility", "predictability",
                 "jargon", "reason", "suggestion"],
}


def validate_structure(obj):
    if not isinstance(obj, dict):
        return False, "la respuesta no es un objeto"
    for k in SCORE_KEYS:
        v = obj.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or not (1 <= v <= 5):
            return False, f"'{k}' inválido: {v!r}"
    if not isinstance(obj.get("jargon"), bool):
        return False, f"'jargon' no booleano: {obj.get('jargon')!r}"
    for k in ("reason", "suggestion"):
        if not isinstance(obj.get(k), str):
            return False, f"'{k}' ausente o no string"
    return True, "esquema conforme"


# --- Guardas sobre un texto candidato ---------------------------------------

def evaluate(source, candidate, case):
    """
    Aplica todos los contratos a un texto candidato.
    Devuelve dict con checks y la lista de fallos CRÍTICOS.
    """
    checks, critical = [], []

    def add(name, ok, reason, is_crit, heuristic=False):
        checks.append({"check": name, "status": "PASS" if ok else "FAIL",
                       "reason": reason, "heuristic": heuristic})
        if not ok and is_crit:
            critical.append(name)

    if not (candidate or "").strip():
        add("NO_EMPTY", False, "texto vacío", True)
        return {"checks": checks, "critical": critical}
    add("NO_EMPTY", True, "texto no vacío", True)

    meta = detect_meta(candidate)
    add("NO_META_LEAKAGE", not meta, "; ".join(meta) if meta else "sin fuga de meta/control", True)

    eng = detect_english(candidate)
    add("LOCALE_ES_MX", not eng, f"marcadores en inglés: {eng}" if eng else "español", True)

    ok, probs = pc.verify(source, candidate)
    add("PROTECTED_CONTENT", ok, "; ".join(probs) if probs else
        "placeholders/URLs/emails intactos", True)

    ok, probs = bi.check(source, candidate)
    add("SOURCE_BOUNDARY", ok, "; ".join(probs) if probs else
        "fronteras de token intactas", True)

    inv = sf.invented_actions(source, candidate)
    add("NO_INVENTED_ACTION", not inv, f"acciones inventadas: {inv}" if inv else
        "sin acciones de producto inventadas", True)

    forb = sf.forbidden_hits(candidate, case.get("forbidden"))
    add("NO_FORBIDDEN_PHRASE", not forb, f"frases prohibidas del caso: {forb}" if forb else
        "sin frases prohibidas", True)

    gv = gl.violations(candidate)
    add("GLOSSARY_CLEAN", not gv, f"jerga presente: {gv}" if gv else
        "sin jerga de glosario", False)

    ov = ort.violations(candidate)
    add("ORTHOGRAPHY_CLEAN", not ov, f"defectos: {ov}" if ov else
        "ortografía conforme", False)

    for key, ok, reason, crit in sf.check_facts(source, candidate, case.get("facts")):
        add(f"FACT:{key}", ok, reason, crit, heuristic=True)

    # STEP 6: solo se aplica cuando el caso declara explícitamente que ningún
    # concepto nuevo es admisible. NUNCA de forma general: una reescritura
    # legítima de UX Writing añade palabras y no por eso es un defecto.
    if case.get("strict_content"):
        added = added_content_words(source, candidate)
        add("NO_ADDED_CONTENT", not added,
            f"introduce contenido ausente del origen: {added}" if added else
            "sin contenido añadido", True)

    if case.get("no_op"):
        same = _norm_cmp(candidate) == _norm_cmp(ort.apply(gl.apply(source)[0])[0])
        add("NO_UNNECESSARY_REWRITE", same,
            "texto correcto conservado" if same else
            f"reescritura innecesaria: {source!r} -> {candidate!r}", False)

    return {"checks": checks, "critical": critical}


STOPWORDS_ES = {
    "el","la","los","las","un","una","unos","unas","de","del","al","a","ante","con",
    "en","para","por","sin","sobre","tras","y","o","u","e","que","se","su","sus","tu",
    "tus","mi","mis","es","son","fue","ser","está","estan","están","lo","le","les",
    "te","nos","ya","no","si","sí","más","muy","como","cuando","donde","porque","pero",
    "este","esta","estos","estas","ese","esa","eso","esto","hay","han","ha","he",
}


def added_content_words(source, candidate):
    """Palabras de contenido del candidato ausentes del origen.

    HEURÍSTICO Y DE ALCANCE RESTRINGIDO. Solo se invoca en casos marcados
    `"strict_content": true`, que son normalizaciones puras del origen
    (ortografía, espaciado) donde cualquier concepto nuevo es invención.
    Aplicarlo de forma general rechazaría reescrituras legítimas.
    """
    def words(t):
        return {w for w in re.findall(r"[a-záéíóúüñ]{3,}", _n(t)) if w not in STOPWORDS_ES}
    # Los términos que el glosario introduce por autoridad del producto no son
    # invención del modelo: "credenciales" -> "datos de acceso" añade palabras
    # legítimamente. Se descuentan siempre.
    allowed = set()
    for repl in gl.GLOSSARY.values():
        allowed |= words(repl)
    return sorted(words(candidate) - words(source) - allowed)


# --- Pipeline de paridad -----------------------------------------------------

def deterministic_floor(source):
    """Piso determinista: ortografía + glosario aplicados al ORIGEN."""
    t, oc = ort.apply(source)
    t, gc = gl.apply(t)
    return t, oc + gc


def run_parity(source, model_obj, case):
    """
    Devuelve el resultado en dos niveles (STEP 10).
    """
    struct_ok, struct_reason = validate_structure(model_obj) if model_obj else (False, "sin objeto")
    raw_suggestion = (model_obj or {}).get("suggestion", "") if struct_ok else ""

    floor, floor_changes = deterministic_floor(source)

    # --- RAW: el modelo solo, sin red de seguridad ---
    raw_eval = evaluate(source, raw_suggestion, case) if struct_ok else {
        "checks": [{"check": "STRUCTURED_OUTPUT", "status": "FAIL",
                    "reason": struct_reason, "heuristic": False}],
        "critical": ["STRUCTURED_OUTPUT"],
    }
    if struct_ok:
        raw_eval["checks"].insert(0, {"check": "STRUCTURED_OUTPUT", "status": "PASS",
                                      "reason": struct_reason, "heuristic": False})

    # --- FINAL: decisión del producto ---
    if not struct_ok:
        final_text = floor
        decision = "salida estructurada inválida; se usa el piso determinista"
    elif raw_eval["critical"]:
        final_text = floor
        decision = ("sugerencia del modelo rechazada por fallo crítico "
                    f"({', '.join(sorted(set(raw_eval['critical'])))}); "
                    "se usa el piso determinista")
    else:
        # Sugerencia aceptada, pero la autoridad determinista se REIMPONE encima.
        t, oc = ort.apply(raw_suggestion)
        t, gc = gl.apply(t)
        final_text = t
        decision = ("sugerencia del modelo aceptada" +
                    (f"; autoridad determinista reimpuesta ({len(oc + gc)} cambios)"
                     if (oc + gc) else "; sin correcciones adicionales"))

    final_eval = evaluate(source, final_text, case)

    return {
        "structured_ok": struct_ok,
        "structured_reason": struct_reason,
        "raw_suggestion": raw_suggestion,
        "deterministic_floor": floor,
        "floor_changes": floor_changes,
        "final_text": final_text,
        "decision": decision,
        "raw": raw_eval,
        "final": final_eval,
        "raw_critical": sorted(set(raw_eval["critical"])),
        "final_critical": sorted(set(final_eval["critical"])),
        "raw_pass": not raw_eval["critical"] and all(
            c["status"] == "PASS" for c in raw_eval["checks"]),
        "final_pass": not final_eval["critical"] and all(
            c["status"] == "PASS" for c in final_eval["checks"]),
    }


# ---------------------------------------------------------------------------
# STEP 7 — TAXONOMÍA DE DEFECTOS
# ---------------------------------------------------------------------------
TAXONOMY = {
    "STRUCTURED_OUTPUT": "STRUCTURED_OUTPUT_FAILURE",
    "FACT:approved": "SEMANTIC_STATE_CHANGE",
    "FACT:confirmed": "SEMANTIC_STATE_CHANGE",
    "FACT:available": "SEMANTIC_STATE_CHANGE",
    "FACT:status": "SEMANTIC_STATE_CHANGE",
    "FACT:in_transit": "SEMANTIC_STATE_CHANGE",
    "FACT:negation": "NEGATION_LOSS",
    "FACT:requirement": "MODALITY_CHANGE",
    "FACT:optional": "MODALITY_CHANGE",
    "FACT:modality": "MODALITY_CHANGE",
    "FACT:conditional": "MODALITY_CHANGE",
    "FACT:action_verb": "INVENTED_ACTION",
    "NO_INVENTED_ACTION": "INVENTED_ACTION",
    "NO_FORBIDDEN_PHRASE": "INVENTED_ACTION",
    "NO_ADDED_CONTENT": "INVENTED_ACTION",
    "FACT:recovery_path": "INVENTED_RECOVERY",
    "FACT:cause_stated": "INVENTED_RECOVERY",
    # Hechos que deben sobrevivir literalmente (montos, fechas, cifras).
    "FACT:no_new_numbers": "PROTECTED_CONTENT_LOSS",
    "FACT:preserve_literals": "PROTECTED_CONTENT_LOSS",
    "PROTECTED_CONTENT": "PROTECTED_CONTENT_LOSS",
    "SOURCE_BOUNDARY": "SOURCE_BOUNDARY_CORRUPTION",
    "NO_META_LEAKAGE": "META_OUTPUT_LEAKAGE",
    "LOCALE_ES_MX": "LOCALE_CONTAMINATION",
    "NO_EMPTY": "EMPTY_OUTPUT",
    "NO_UNNECESSARY_REWRITE": "UNNECESSARY_REWRITE",
    "GLOSSARY_CLEAN": "GLOSSARY_RAW_FAILURE",
    "ORTHOGRAPHY_CLEAN": "ORTHOGRAPHY_RAW_FAILURE",
}


def taxon(check_name):
    return TAXONOMY.get(check_name, "OTHER")


def classify_failures(evaluation):
    """Cuenta los FAIL de una evaluación por categoría de la taxonomía."""
    out = {}
    for c in evaluation["checks"]:
        if c["status"] == "FAIL":
            out[taxon(c["check"])] = out.get(taxon(c["check"]), 0) + 1
    return out


# ---------------------------------------------------------------------------
# STEP 3 — INTERVENCIONES DE LA CAPA DE SEGURIDAD
# ---------------------------------------------------------------------------
_REJECTION_REASON = {
    "PROTECTED_CONTENT": "protected_content_rejection",
    "FACT:preserve_literals": "protected_content_rejection",
    "FACT:no_new_numbers": "protected_content_rejection",
    "SOURCE_BOUNDARY": "boundary_rejection",
    "LOCALE_ES_MX": "locale_rejection",
    "NO_META_LEAKAGE": "meta_output_rejection",
    "STRUCTURED_OUTPUT": "structured_output_rejection",
    "NO_EMPTY": "empty_output_rejection",
}


def classify_interventions(source, result, case):
    """
    Razones por las que la capa determinista intervino sobre la salida del modelo.
    Un caso puede acumular varias.
    """
    reasons = set()

    rejected = (not result["structured_ok"]) or bool(result["raw_critical"])
    if rejected:
        for c in result["raw_critical"]:
            reasons.add(_REJECTION_REASON.get(c, "semantic_fidelity_rejection"))

    # Correcciones deterministas efectivamente aplicadas al texto final.
    ortho_ch = [c for c in result["floor_changes"] if not c.startswith("glosario:")]
    gloss_ch = [c for c in result["floor_changes"] if c.startswith("glosario:")]
    if rejected:
        if ortho_ch:
            reasons.add("orthography_override")
        if gloss_ch:
            reasons.add("glossary_override")
    else:
        t, oc = ort.apply(result["raw_suggestion"])
        _, gc = gl.apply(t)
        if oc:
            reasons.add("orthography_override")
        if gc:
            reasons.add("glossary_override")

    # No-op de alta calidad: el modelo reescribió texto correcto y el FINAL lo revirtió.
    if case.get("no_op"):
        raw_rewrote = any(c["check"] == "NO_UNNECESSARY_REWRITE" and c["status"] == "FAIL"
                          for c in result["raw"]["checks"])
        final_ok = all(c["status"] == "PASS" for c in result["final"]["checks"]
                       if c["check"] == "NO_UNNECESSARY_REWRITE")
        if raw_rewrote and final_ok:
            reasons.add("high_quality_noop")

    # Fallback literal al origen.
    if rejected and _norm_cmp(result["final_text"]) == _norm_cmp(source):
        reasons.add("fallback_to_source")

    return sorted(reasons)
