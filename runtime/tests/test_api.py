import pytest
from fastapi.testclient import TestClient

from src import analysis_service, config, ollama_client
from src.main import app

VALID = {"clarity": 5, "concision": 5, "utility": 5, "predictability": 5,
         "jargon": False, "reason": "ok", "suggestion": "Continuar"}


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def patch_model(monkeypatch, result):
    async def fake(cl, text, context="", stricter=False):
        if isinstance(result, Exception):
            raise result
        return {**result, "suggestion": result.get("suggestion", text)}
    monkeypatch.setattr(ollama_client, "analyze", fake)
    monkeypatch.setattr(analysis_service.ollama_client, "analyze", fake)


def post(client, text="Continuar", **over):
    body = {"text": text, "context": "", "locale": "es-MX"}
    body.update(over)
    return client.post("/v1/analyze/text", json=body)


# --- /health ----------------------------------------------------------------

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    b = r.json()
    assert b == {"status": "ok", "service": "ux-writing-local-runtime",
                 "version": config.VERSION, "model": "qwen3.5:4b"}


def test_health_no_expone_informacion_del_sistema(client):
    b = client.get("/health").json()
    for key in ("host", "port", "path", "cwd", "env", "ollama_url"):
        assert key not in b


def test_health_no_dispara_inferencia(client, monkeypatch):
    called = []

    async def fake(*a, **k):
        called.append(1)
        return VALID
    monkeypatch.setattr(ollama_client, "analyze", fake)
    client.get("/health")
    assert called == []


# --- /v1/runtime/status -----------------------------------------------------

def test_status_ready(client, monkeypatch):
    async def probe(cl):
        return True, True
    monkeypatch.setattr("src.main.probe", probe)
    b = client.get("/v1/runtime/status").json()
    assert b == {"runtime": "ready", "ollama": "ready",
                 "model": "qwen3.5:4b", "model_available": True}


def test_status_ollama_caido(client, monkeypatch):
    async def probe(cl):
        return False, False
    monkeypatch.setattr("src.main.probe", probe)
    b = client.get("/v1/runtime/status").json()
    assert b["runtime"] == "degraded" and b["ollama"] == "unavailable"


def test_status_modelo_ausente(client, monkeypatch):
    async def probe(cl):
        return True, False
    monkeypatch.setattr("src.main.probe", probe)
    b = client.get("/v1/runtime/status").json()
    assert b["runtime"] == "degraded" and b["model_available"] is False
    assert b["model"] == "qwen3.5:4b"


# --- POST /v1/analyze/text: contrato ---------------------------------------

def test_analisis_valido(client, monkeypatch):
    patch_model(monkeypatch, VALID)
    r = post(client, "Continuar")
    assert r.status_code == 200
    b = r.json()
    for k in ("text", "locale", "score", "severity", "clarity", "concision",
              "utility", "jargon", "predictability", "orthography", "issues",
              "reason", "suggestion"):
        assert k in b, f"falta {k} en la respuesta"
    assert b["text"] == "Continuar"
    assert b["suggestion"] == "Continuar"
    assert 0 <= b["score"] <= 100
    assert b["severity"] in ("low", "medium", "high")
    assert isinstance(b["jargon"], bool)


def test_response_text_igual_al_request(client, monkeypatch):
    patch_model(monkeypatch, {**VALID, "clarity": 3, "concision": 3,
                              "utility": 3, "predictability": 3,
                              "suggestion": "otra cosa distinta"})
    src = "no  fue posible"
    b = post(client, src).json()
    assert b["text"] == src


def test_issues_respetan_el_contrato(client, monkeypatch):
    patch_model(monkeypatch, VALID)
    b = post(client, "Ingresa tus credenciales").json()
    assert b["issues"]
    for i in b["issues"]:
        assert set(i) == {"category", "severity", "term", "reason"}
        assert i["severity"] in ("low", "medium", "high")


# --- Validación de entrada --------------------------------------------------

def test_texto_vacio(client, monkeypatch):
    patch_model(monkeypatch, VALID)
    r = post(client, "   ")
    assert r.status_code == 400 and r.json()["code"] == "ANALYSIS_FAILED"


def test_locale_no_soportado(client, monkeypatch):
    patch_model(monkeypatch, VALID)
    r = post(client, "Continuar", locale="en-US")
    assert r.status_code == 400


def test_campo_requerido_ausente(client):
    assert client.post("/v1/analyze/text", json={"context": "", "locale": "es-MX"}).status_code == 422


def test_campo_desconocido_rechazado(client):
    r = client.post("/v1/analyze/text",
                    json={"text": "x", "context": "", "locale": "es-MX", "extra": 1})
    assert r.status_code == 422


def test_texto_demasiado_largo(client, monkeypatch):
    patch_model(monkeypatch, VALID)
    r = post(client, "a" * (config.MAX_TEXT_CHARS + 1))
    assert r.status_code == 400


# --- Errores de servicio ----------------------------------------------------

@pytest.mark.parametrize("exc,code,status", [
    (ollama_client.OllamaUnavailable("x"), "OLLAMA_UNAVAILABLE", 503),
    (ollama_client.ModelNotAvailable("x"), "MODEL_NOT_AVAILABLE", 503),
    (ollama_client.ModelTimeout("x"), "MODEL_TIMEOUT", 504),
])
def test_errores_de_servicio(client, monkeypatch, exc, code, status):
    patch_model(monkeypatch, exc)
    r = post(client)
    assert r.status_code == status
    assert r.json()["code"] == code


def test_estructura_invalida_persistente(client, monkeypatch):
    patch_model(monkeypatch, ollama_client.InvalidModelResponse("x"))
    r = post(client)
    assert r.status_code == 502 and r.json()["code"] == "INVALID_MODEL_RESPONSE"


def test_errores_no_filtran_detalles_internos(client, monkeypatch):
    patch_model(monkeypatch, ollama_client.OllamaUnavailable("boom"))
    body = post(client).text
    for leak in ("/Users/", "Traceback", "ollama_client", "127.0.0.1",
                 "Eres un especialista", "src/", ".py"):
        assert leak not in body, f"la respuesta de error filtró: {leak}"


def test_error_solo_expone_code_y_message(client, monkeypatch):
    patch_model(monkeypatch, ollama_client.ModelTimeout("x"))
    assert set(post(client).json()) == {"code", "message"}


# --- Presupuesto por HTTP ---------------------------------------------------

def test_presupuesto_maximo_por_peticion(client, monkeypatch):
    calls = []

    async def fake(cl, text, context="", stricter=False):
        calls.append(stricter)
        return {**VALID, "clarity": 3, "concision": 3, "utility": 3,
                "predictability": 3,
                "suggestion": text + " Revisa tu conexión e inténtalo de nuevo."}
    monkeypatch.setattr(ollama_client, "analyze", fake)
    monkeypatch.setattr(analysis_service.ollama_client, "analyze", fake)
    r = post(client, "Hubo un problema al guardar.")
    assert r.status_code == 200
    assert len(calls) <= config.MAX_OLLAMA_CALLS == 2
    assert r.json()["suggestion"] == "Hubo un problema al guardar."


# --- Sin autenticación local (STEP 4/29) ------------------------------------

def test_no_requiere_api_key(client, monkeypatch):
    """El modelo de seguridad local es el binding a loopback, no una clave."""
    patch_model(monkeypatch, VALID)
    assert post(client).status_code == 200


def test_api_key_no_cambia_nada(client, monkeypatch):
    patch_model(monkeypatch, VALID)
    r = client.post("/v1/analyze/text",
                    json={"text": "Continuar", "context": "", "locale": "es-MX"},
                    headers={"X-API-Key": "irrelevante"})
    assert r.status_code == 200


# --- CORS para el plugin de Figma (FASE 8.5.4) ------------------------------

FIGMA_ORIGINS = ["null", "https://www.figma.com", "https://figma.com"]


@pytest.mark.parametrize("origin", FIGMA_ORIGINS)
def test_preflight_permite_post_de_analisis(client, origin):
    r = client.options("/v1/analyze/text", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin
    assert "POST" in r.headers["access-control-allow-methods"]


@pytest.mark.parametrize("origin", FIGMA_ORIGINS)
def test_post_con_origen_de_figma(client, monkeypatch, origin):
    patch_model(monkeypatch, VALID)
    r = client.post("/v1/analyze/text",
                    json={"text": "Continuar", "context": "", "locale": "es-MX"},
                    headers={"Origin": origin})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


def test_health_con_origen_de_figma(client):
    r = client.get("/health", headers={"Origin": "null"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "null"


def test_cors_no_es_comodin(client):
    """No se usa '*': un origen arbitrario no recibe permiso."""
    assert "*" not in config.CORS_ALLOW_ORIGINS
    r = client.get("/health", headers={"Origin": "https://sitio-malicioso.example"})
    assert r.headers.get("access-control-allow-origin") != "*"


def test_cors_no_habilita_credenciales(client):
    r = client.get("/health", headers={"Origin": "null"})
    assert r.headers.get("access-control-allow-credentials") != "true"
