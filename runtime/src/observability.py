"""
Observabilidad segura.

REGLA ABSOLUTA: nunca se registra contenido.
Ni el texto de origen, ni la sugerencia, ni el contexto, ni el prompt, ni la
salida cruda del modelo, ni claves. Solo métricas y banderas booleanas.
"""
import json
import logging
import sys

logger = logging.getLogger("uxw.runtime")

# Campos permitidos. Cualquier otro se descarta antes de emitir el registro.
ALLOWED_FIELDS = frozenset({
    "event",
    "analysis_duration_ms",
    "ollama_call_count",
    "structured_retry_used",
    "semantic_regeneration_used",
    "glossary_override_used",
    "orthography_override_used",
    "fallback_suggestion_used",
    "protected_content_rejection_used",
    "boundary_rejection_used",
    "semantic_rejection_used",
    "meta_rejection_used",
    "locale_rejection_used",
    "high_quality_noop",
    "score",
    "severity",
    "issue_count",
    "text_length",
    "error_code",
    "status",
})


def configure(level=logging.INFO):
    if logger.handlers:
        return
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(h)
    logger.setLevel(level)
    logger.propagate = False


def log_analysis(**fields):
    """Emite solo campos de la lista blanca. El contenido nunca sale de aquí."""
    safe = {k: v for k, v in fields.items() if k in ALLOWED_FIELDS}
    dropped = set(fields) - set(safe)
    if dropped:
        safe["dropped_fields"] = sorted(dropped)
    logger.info(json.dumps(safe, ensure_ascii=False, sort_keys=True))
    return safe
