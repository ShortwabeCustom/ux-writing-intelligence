"""
Cliente de inferencia por lotes - SOLO EXPERIMENTAL (FASE 9.2A).

AISLADO de produccion. El runtime no importa nada de aqui; aqui si se importan
los modulos de produccion, y en un solo sentido.

Las reglas absolutas sobre `suggestion` son LAS MISMAS que las de produccion.
Lo unico que cambia es que se piden varios textos en una llamada, cada uno con
su identificador. Toda salida se somete despues a las MISMAS capas
deterministas que aplica `analysis_service`.
"""
import hashlib
import json
import time

import httpx

from src import config, orthography, scoring, suggestion_quality
from src.ollama_client import (
    SYSTEM_PROMPT,
    InvalidModelResponse,
    ModelTimeout,
    OllamaUnavailable,
)

# El prompt de lote hereda integras las reglas de producto. Solo se anade la
# instruccion de independencia entre elementos, que es el riesgo propio del
# formato: mezclar textos en un mismo prompt invita a que el modelo confunda
# contenidos entre ellos.
_BATCH_HEADER = SYSTEM_PROMPT.replace(
    "Recibes UN texto de interfaz y devuelves una evaluacion estructurada.",
    "Recibes VARIOS textos de interfaz, cada uno con su identificador, y "
    "devuelves una evaluacion estructurada por cada uno.",
)

BATCH_SYSTEM_PROMPT = _BATCH_HEADER + """

AISLAMIENTO ENTRE ELEMENTOS (regla absoluta):
- Cada elemento se evalua POR SEPARADO, como si fuera el unico.
- NUNCA mezcles el contenido de un elemento con otro.
- NUNCA uses palabras, cifras, nombres ni marcadores de un elemento en la
  "suggestion" o el "reason" de otro.
- Devuelve EXACTAMENTE un objeto por cada identificador recibido, con el mismo
  "id", en el mismo orden. Ni uno mas, ni uno menos.
"""

BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "clarity": {"type": "integer", "minimum": 1, "maximum": 5},
                    "concision": {"type": "integer", "minimum": 1, "maximum": 5},
                    "utility": {"type": "integer", "minimum": 1, "maximum": 5},
                    "predictability": {"type": "integer", "minimum": 1, "maximum": 5},
                    "jargon": {"type": "boolean"},
                    "reason": {"type": "string"},
                    "suggestion": {"type": "string"},
                },
                "required": ["id", "clarity", "concision", "utility",
                             "predictability", "jargon", "reason", "suggestion"],
            },
        },
    },
    "required": ["items"],
}


def _batch_user_message(items) -> str:
    parts = ["Evalua cada uno de estos textos de interfaz por separado.", ""]
    for item in items:
        parts.append("--- id: " + item["id"])
        parts.append("Texto de interfaz:")
        parts.append(item["text"])
        if item.get("context", "").strip():
            parts.append("Contexto de la pantalla:")
            parts.append(item["context"].strip())
        parts.append("")
    return "\n".join(parts)


async def analyze_batch(client: httpx.AsyncClient, items):
    """Una llamada a Ollama con varios textos. Devuelve (salida cruda, segundos)."""
    payload = {
        "model": config.MODEL,
        "messages": [
            {"role": "system", "content": BATCH_SYSTEM_PROMPT},
            {"role": "user", "content": _batch_user_message(items)},
        ],
        "stream": False,
        "think": False,
        "format": BATCH_SCHEMA,
        "keep_alive": config.KEEP_ALIVE,
        "options": {"temperature": config.TEMPERATURE, "seed": config.SEED,
                    "num_ctx": config.NUM_CTX},
    }

    started = time.perf_counter()
    try:
        response = await client.post(
            config.OLLAMA_CHAT_URL, json=payload,
            timeout=config.OLLAMA_TIMEOUT_SECONDS * 4,
        )
    except httpx.TimeoutException as exc:
        raise ModelTimeout("el modelo no respondio a tiempo") from exc
    except httpx.HTTPError as exc:
        raise OllamaUnavailable("fallo de transporte") from exc

    elapsed = time.perf_counter() - started

    if response.status_code >= 400:
        raise InvalidModelResponse("HTTP " + str(response.status_code))

    try:
        content = response.json().get("message", {}).get("content", "")
        parsed = json.loads(content)
    except Exception as exc:
        raise InvalidModelResponse("respuesta ilegible") from exc

    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        raise InvalidModelResponse("respuesta fuera de contrato")

    return parsed, elapsed


def finalize(text: str, context: str, model_out: dict):
    """
    Aplica a UN elemento las mismas capas deterministas que `analysis_service`.

    Replica fiel del camino de produccion SIN regeneracion semantica: cuando la
    guarda rechaza, se cae al piso determinista y se marca. Asi el experimento
    mide el lote en igualdad de condiciones y sin gastar llamadas ocultas.
    """
    telemetry = {
        "fallback_suggestion_used": False,
        "rejection_layers": [],
        "high_quality_noop": False,
    }

    floor, ortho_changes, glossary_changes = suggestion_quality.deterministic_floor(text)
    orthography_score = orthography.score(text)

    criteria = {
        "clarity": model_out["clarity"],
        "concision": model_out["concision"],
        "utility": model_out["utility"],
        "predictability": model_out["predictability"],
        "orthography": orthography_score,
    }

    issues = suggestion_quality.build_issues(
        ortho_changes, glossary_changes, orthography.violations(text))
    jargon = suggestion_quality.explainable_jargon(glossary_changes)
    score = scoring.compute_score(criteria, jargon)
    severity = scoring.severity_for(score)

    if suggestion_quality.is_high_quality_noop(
            score, issues, orthography_score, glossary_changes):
        telemetry["high_quality_noop"] = True
        final_suggestion = text
    else:
        candidate = model_out.get("suggestion", "")
        ok, rejections = suggestion_quality.guard(text, candidate, context)
        if ok:
            final_suggestion = candidate if candidate.strip() else floor
        else:
            telemetry["fallback_suggestion_used"] = True
            telemetry["rejection_layers"] = sorted({layer for layer, _ in rejections})
            final_suggestion = floor

    response = {
        "text": text,
        "locale": config.LOCALE,
        "score": score,
        "severity": severity,
        "clarity": criteria["clarity"],
        "concision": criteria["concision"],
        "utility": criteria["utility"],
        "jargon": jargon,
        "predictability": criteria["predictability"],
        "orthography": orthography_score,
        "issues": issues,
        "reason": suggestion_quality.deterministic_reason(
            criteria, glossary_changes, ortho_changes),
        "suggestion": final_suggestion,
    }
    return response, telemetry


# --- Identidad de analisis reutilizable (STEP 23) ----------------------------

PROMPT_VERSION = "single-v1"
SCORE_VERSION = "v2"
DETERMINISTIC_RULES_VERSION = "8.5.6"


def analysis_version() -> str:
    """
    Identidad del analisis. Cualquier cambio en alguno de sus componentes
    invalida un resultado reutilizado: el mismo texto con otro modelo, otro
    prompt u otras reglas deterministas NO produce el mismo veredicto.
    """
    return "|".join([
        config.MODEL, PROMPT_VERSION, SCORE_VERSION, DETERMINISTIC_RULES_VERSION,
    ])


def reuse_key(text: str, context: str, locale: str = None) -> str:
    """
    Clave de reutilizacion exacta y conservadora.

    Se usa el texto SIN normalizar: ni recorte, ni minusculas, ni coincidencia
    aproximada. "Continuar" en dos contextos distintos NO comparte resultado,
    porque el contexto forma parte de la identidad.
    """
    resolved_locale = config.LOCALE if locale is None else locale
    material = " ".join([text, context, resolved_locale, analysis_version()])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
