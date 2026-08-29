"""
Aplicación HTTP del runtime local.

Escucha exclusivamente en 127.0.0.1:8787. El modelo de seguridad de esta fase
es el binding a loopback: no hay API key local (STEP 4/29). La clave de la nube
sigue siendo un asunto exclusivo del backend remoto y del plugin, que no se
tocan aquí.
"""
import contextlib

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import analysis_service, config, observability
from .models import (AnalyzeRequest, AnalyzeResponse, HealthResponse,
                     RuntimeStatusResponse)
from .ollama_client import OllamaError, probe

observability.configure()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient()
    try:
        yield
    finally:
        await app.state.http.aclose()


app = FastAPI(title="UX Writing Local Runtime", version=config.VERSION,
              lifespan=lifespan)

if config.CORS_ALLOW_ORIGINS:
    from fastapi.middleware.cors import CORSMiddleware

    # allow_credentials queda en False a propósito: el runtime local no usa
    # cookies ni encabezados de autenticación, y activarlo prohibiría el
    # origen "null" que envía el iframe de Figma.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ALLOW_ORIGINS,
        allow_credentials=False,
        allow_methods=config.CORS_ALLOW_METHODS,
        allow_headers=config.CORS_ALLOW_HEADERS,
    )


def _error(code: str, message: str, status: int) -> JSONResponse:
    """Contrato de error. Nunca expone rutas, prompts, trazas ni salida cruda."""
    observability.log_analysis(event="analysis_error", error_code=code, status=status)
    return JSONResponse(status_code=status, content={"code": code, "message": message})


@app.get("/health", response_model=HealthResponse)
async def health():
    """Rápido. No dispara inferencia ni consulta a Ollama."""
    return {"status": "ok", "service": config.SERVICE_NAME,
            "version": config.VERSION, "model": config.MODEL}


@app.get("/v1/runtime/status", response_model=RuntimeStatusResponse)
async def runtime_status(request: Request):
    """Estado de producto. Consulta el catálogo de Ollama; no genera texto."""
    ollama_ready, model_available = await probe(request.app.state.http)
    return {
        "runtime": "ready" if (ollama_ready and model_available) else "degraded",
        "ollama": "ready" if ollama_ready else "unavailable",
        "model": config.MODEL,
        "model_available": model_available,
    }


@app.post("/v1/analyze/text", response_model=AnalyzeResponse)
async def analyze_text(payload: AnalyzeRequest, request: Request):
    text = payload.text
    if not text.strip():
        return _error("ANALYSIS_FAILED", "El texto está vacío.", 400)
    if len(text) > config.MAX_TEXT_CHARS:
        return _error("ANALYSIS_FAILED", "El texto es demasiado largo.", 400)
    if len(payload.context) > config.MAX_CONTEXT_CHARS:
        return _error("ANALYSIS_FAILED", "El contexto es demasiado largo.", 400)
    if payload.locale not in config.SUPPORTED_LOCALES:
        return _error("ANALYSIS_FAILED", "El idioma solicitado no está disponible.", 400)

    try:
        result = await analysis_service.analyze(
            request.app.state.http, text, payload.context, payload.locale)
    except OllamaError as exc:
        return _error(exc.code, _MESSAGES.get(exc.code, "No fue posible completar el análisis."),
                      exc.http_status)
    except Exception:
        return _error("ANALYSIS_FAILED", "No fue posible completar el análisis.", 500)

    observability.log_analysis(event="analysis_ok", **result.telemetry)
    return result.response


_MESSAGES = {
    "OLLAMA_UNAVAILABLE": "El servicio de análisis local no está disponible.",
    "MODEL_NOT_AVAILABLE": "El modelo de análisis local no está instalado.",
    "MODEL_TIMEOUT": "El análisis tardó demasiado.",
    "INVALID_MODEL_RESPONSE": "El análisis local devolvió una respuesta no válida.",
    "ANALYSIS_FAILED": "No fue posible completar el análisis.",
}
