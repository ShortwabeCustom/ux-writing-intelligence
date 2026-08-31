"""
Orquestación del análisis. Aquí vive el presupuesto de llamadas y la decisión
final sobre la sugerencia.

PRESUPUESTO DE LLAMADAS A OLLAMA (STEP 23/25) — máximo absoluto: 2.

    llamada 1  análisis inicial                                   (siempre)
    llamada 2  UNA de estas dos, nunca ambas:
                 - reintento por salida estructurada inválida     (STEP 24)
                 - regeneración por rechazo semántico             (STEP 25)

Un reintento estructurado consume el mismo presupuesto que una regeneración
semántica, así que la secuencia "inicial + estructurado + semántico" es
imposible por construcción. No hay bucles recursivos.

Los fallos de transporte (timeout, conexión, error HTTP) NO se reintentan:
se mapean a errores de servicio.
"""
import time

import httpx

from . import config, ollama_client, scoring, suggestion_quality
from .ollama_client import InvalidModelResponse, OllamaError


class AnalysisResult:
    __slots__ = ("response", "telemetry")

    def __init__(self, response, telemetry):
        self.response = response
        self.telemetry = telemetry


async def analyze(client: httpx.AsyncClient, text: str, context: str = "",
                  locale: str = config.LOCALE) -> AnalysisResult:
    started = time.perf_counter()
    tel = {
        "ollama_call_count": 0,
        "structured_retry_used": False,
        "semantic_regeneration_used": False,
        "glossary_override_used": False,
        "orthography_override_used": False,
        "fallback_suggestion_used": False,
        "protected_content_rejection_used": False,
        "boundary_rejection_used": False,
        "semantic_rejection_used": False,
        "meta_rejection_used": False,
        "locale_rejection_used": False,
        "high_quality_noop": False,
    }

    # --- 1. Piso determinista (no depende del modelo) -----------------------
    floor, ortho_changes, glossary_changes = suggestion_quality.deterministic_floor(text)
    tel["orthography_override_used"] = bool(ortho_changes)
    tel["glossary_override_used"] = bool(glossary_changes)

    from . import orthography
    orthography_score = orthography.score(text)

    # --- 2. Llamada 1 -------------------------------------------------------
    try:
        tel["ollama_call_count"] += 1
        model_out = await ollama_client.analyze(client, text, context)
    except InvalidModelResponse:
        # STEP 24: un único reintento, solo por salida no parseable/no conforme.
        if config.MAX_STRUCTURED_RETRIES < 1 or tel["ollama_call_count"] >= config.MAX_OLLAMA_CALLS:
            raise
        tel["structured_retry_used"] = True
        tel["ollama_call_count"] += 1
        model_out = await ollama_client.analyze(client, text, context)

    criteria = {
        "clarity": model_out["clarity"],
        "concision": model_out["concision"],
        "utility": model_out["utility"],
        "predictability": model_out["predictability"],
        "orthography": orthography_score,
    }

    # --- 3. Evidencia visible y jerga explicable ----------------------------
    issues = suggestion_quality.build_issues(
        ortho_changes, glossary_changes, orthography.violations(text))
    jargon = suggestion_quality.explainable_jargon(glossary_changes)
    score = scoring.compute_score(criteria, jargon)
    severity = scoring.severity_for(score)

    # --- 4. No-op de alta calidad (STEP 21) ---------------------------------
    if suggestion_quality.is_high_quality_noop(score, issues, orthography_score, glossary_changes):
        tel["high_quality_noop"] = True
        final_suggestion = text
    else:
        final_suggestion = await _resolve_suggestion(
            client, text, context, model_out, floor, tel)

    reason = suggestion_quality.deterministic_reason(criteria, glossary_changes, ortho_changes)

    tel["analysis_duration_ms"] = round((time.perf_counter() - started) * 1000, 1)
    tel["score"] = score
    tel["severity"] = severity
    tel["issue_count"] = len(issues)
    tel["text_length"] = len(text)

    response = {
        "text": text,                      # STEP 10: SIEMPRE el original
        "locale": locale,
        "score": score,
        "severity": severity,
        "clarity": criteria["clarity"],
        "concision": criteria["concision"],
        "utility": criteria["utility"],
        "jargon": jargon,
        "predictability": criteria["predictability"],
        "orthography": orthography_score,
        "issues": issues,
        "reason": reason,
        "suggestion": final_suggestion,
    }
    return AnalysisResult(response, tel)


def _record_rejections(rejections, tel):
    layers = {layer for layer, _ in rejections}
    if "protected_content" in layers:
        tel["protected_content_rejection_used"] = True
    if "boundary" in layers:
        tel["boundary_rejection_used"] = True
    if "semantic" in layers:
        tel["semantic_rejection_used"] = True
    if "meta" in layers:
        tel["meta_rejection_used"] = True
    if "locale" in layers:
        tel["locale_rejection_used"] = True
    return layers


async def _resolve_suggestion(client, text, context, model_out, floor, tel) -> str:
    """Aplica guardas; regenera como máximo una vez; si no, cae al piso."""
    candidate = model_out.get("suggestion", "")
    ok, rejections = suggestion_quality.guard(text, candidate, context)

    if ok:
        return _settle(candidate, floor)

    layers = _record_rejections(rejections, tel)

    # STEP 25: una sola regeneración, solo por rechazo semántico y solo si
    # queda presupuesto (es decir, si no se gastó ya en un reintento estructurado).
    semantic_only_recoverable = "semantic" in layers
    if (semantic_only_recoverable
            and not tel["structured_retry_used"]
            and tel["ollama_call_count"] < config.MAX_OLLAMA_CALLS
            and config.MAX_SEMANTIC_REGENERATIONS >= 1):
        tel["semantic_regeneration_used"] = True
        tel["ollama_call_count"] += 1
        try:
            regenerated = await ollama_client.analyze(client, text, context, stricter=True)
        except OllamaError:
            tel["fallback_suggestion_used"] = True
            return floor
        candidate2 = regenerated.get("suggestion", "")
        ok2, rejections2 = suggestion_quality.guard(text, candidate2, context)
        if ok2:
            return _settle(candidate2, floor)
        _record_rejections(rejections2, tel)

    tel["fallback_suggestion_used"] = True
    return floor


def _settle(candidate: str, floor: str) -> str:
    """
    Cierra la sugerencia aceptada.

    1. Se le reimpone la autoridad determinista: el glosario y la ortografía
       mandan incluso sobre un candidato que pasó todas las guardas.
    2. Si lo único que aporta frente al piso es mayúscula o puntuación final,
       gana el piso: no se reescribe por reescribir.
    """
    out, _, _ = suggestion_quality.deterministic_floor(candidate)
    if suggestion_quality.is_cosmetic_variation(floor, out):
        return floor
    return out
