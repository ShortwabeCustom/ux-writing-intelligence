"""
Cliente de Ollama. Solo transporte y validación de esquema.

No contiene reglas de producto: la seguridad vive en las capas deterministas.
"""
import json

import httpx

from . import config
from .models import OLLAMA_SCHEMA

# --- Prompt del sistema (heredado de la configuración de paridad de 8.5.2) ---
SYSTEM_PROMPT = """Eres un especialista en UX Writing para producto digital en español de México (es-MX).

Recibes UN texto de interfaz y devuelves una evaluación estructurada.

EVALÚA del 1 al 5 (5 es óptimo):
- clarity: se entiende a la primera lectura.
- concision: no sobra ninguna palabra.
- utility: le sirve a la persona para decidir o actuar.
- predictability: anticipa correctamente lo que va a ocurrir.

REGLAS ABSOLUTAS SOBRE "suggestion":

1. CONSERVA EL SIGNIFICADO. No cambies lo que el producto afirma, niega, permite u obliga.
2. No conviertas una condición en certeza. Si el texto dice "si" o "cuando", consérvalo.
3. No elimines negaciones. Si el texto dice que algo NO ocurrió, debe seguir diciéndolo.
4. No conviertas un permiso ("puedes") en obligación ("debes"), ni al revés.
5. No conviertas lo opcional en obligatorio.
6. No cambies un estado por otro: "agendada" no es "confirmada"; "en revisión" no es "aprobada".
7. No inventes acciones, pasos, pantallas ni funcionalidad que no estén en el texto.
8. No inventes causas de un error ni rutas de recuperación.
9. No cambies montos, fechas, horas ni cifras. No agregues cifras nuevas.
10. Conserva EXACTAMENTE, carácter por carácter, todo lo que esté entre llaves dobles {{ }}, las URLs y los correos.
11. Conserva la estructura de párrafos y los saltos de línea.
12. Nunca unas dos palabras en una sola. Respeta los espacios.
13. EDITA POCO. Si el texto ya está bien, devuélvelo IDÉNTICO en "suggestion".

FORMATO:
- "suggestion" contiene ÚNICAMENTE el texto de interfaz para la persona usuaria.
- "suggestion" NUNCA contiene comentarios, explicaciones, veredictos, ni frases como
  "el texto está bien escrito" o "cumple con los criterios". Si el texto está bien,
  "suggestion" es el texto mismo, no un comentario sobre él.
- "reason" es una sola frase breve en español explicando tu evaluación.
- No incluyas razonamiento, notas, ni etiquetas de control.
- Escribe siempre en español de México."""

RETRY_HINT = ("\n\nIMPORTANTE: tu respuesta anterior no respetó el significado del texto "
              "original. NO agregues acciones, causas ni pasos que no estén en el texto. "
              "Si no puedes mejorarlo sin cambiar lo que dice, devuelve el texto IDÉNTICO.")


class OllamaError(Exception):
    code = "ANALYSIS_FAILED"
    http_status = 500


class OllamaUnavailable(OllamaError):
    code = "OLLAMA_UNAVAILABLE"
    http_status = 503


class ModelNotAvailable(OllamaError):
    code = "MODEL_NOT_AVAILABLE"
    http_status = 503


class ModelTimeout(OllamaError):
    code = "MODEL_TIMEOUT"
    http_status = 504


class InvalidModelResponse(OllamaError):
    code = "INVALID_MODEL_RESPONSE"
    http_status = 502


def _user_message(text: str, context: str, stricter: bool) -> str:
    parts = ["Texto de interfaz:", "", text]
    if context.strip():
        parts += ["", "Contexto de la pantalla:", context.strip()]
    msg = "\n".join(parts)
    return msg + RETRY_HINT if stricter else msg


def validate_payload(obj) -> bool:
    """Valida contra OLLAMA_SCHEMA sin dependencias externas."""
    if not isinstance(obj, dict):
        return False
    for k in ("clarity", "concision", "utility", "predictability"):
        v = obj.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or not (1 <= v <= 5):
            return False
    if not isinstance(obj.get("jargon"), bool):
        return False
    for k in ("reason", "suggestion"):
        if not isinstance(obj.get(k), str):
            return False
    return True


async def probe(client: httpx.AsyncClient):
    """
    Estado de Ollama y disponibilidad del modelo. NO dispara inferencia.
    (ollama_ready, model_available)
    """
    try:
        r = await client.get(config.OLLAMA_TAGS_URL,
                             timeout=config.OLLAMA_PROBE_TIMEOUT_SECONDS)
        r.raise_for_status()
        names = {m.get("name", "") for m in r.json().get("models", [])}
    except Exception:
        return False, False
    base = config.MODEL.split(":")[0]
    available = config.MODEL in names or any(
        n == config.MODEL or n.startswith(base + ":") and n == config.MODEL for n in names)
    return True, available


async def analyze(client: httpx.AsyncClient, text: str, context: str = "",
                  stricter: bool = False) -> dict:
    """
    Una llamada a Ollama. Lanza excepciones tipadas; no reintenta por su cuenta.
    El presupuesto de llamadas lo administra analysis_service.
    """
    payload = {
        "model": config.MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _user_message(text, context, stricter)},
        ],
        "stream": False,
        "think": False,
        "format": OLLAMA_SCHEMA,
        "keep_alive": config.KEEP_ALIVE,
        "options": {"temperature": config.TEMPERATURE, "seed": config.SEED,
                    "num_ctx": config.NUM_CTX},
    }
    try:
        r = await client.post(config.OLLAMA_CHAT_URL, json=payload,
                              timeout=config.OLLAMA_TIMEOUT_SECONDS)
    except httpx.TimeoutException as exc:
        raise ModelTimeout("el modelo no respondió a tiempo") from exc
    except httpx.ConnectError as exc:
        raise OllamaUnavailable("no hay servicio de inferencia local") from exc
    except httpx.HTTPError as exc:
        raise OllamaUnavailable("fallo de transporte con el servicio local") from exc

    if r.status_code == 404:
        raise ModelNotAvailable("el modelo no está instalado")
    if r.status_code >= 500:
        raise OllamaUnavailable("el servicio local devolvió un error")
    if r.status_code >= 400:
        raise InvalidModelResponse("el servicio local rechazó la petición")

    try:
        content = r.json().get("message", {}).get("content", "")
        obj = json.loads(content)
    except Exception as exc:
        raise InvalidModelResponse("respuesta del modelo ilegible") from exc

    if not validate_payload(obj):
        raise InvalidModelResponse("respuesta del modelo fuera de contrato")
    return obj
