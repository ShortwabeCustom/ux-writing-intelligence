import httpx
import pytest

from src import config, ollama_client as oc

VALID = {"clarity": 4, "concision": 4, "utility": 4, "predictability": 4,
         "jargon": False, "reason": "ok", "suggestion": "Continuar"}


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok_response(payload):
    import json
    return httpx.Response(200, json={"message": {"content": json.dumps(payload)}})


@pytest.mark.parametrize("bad", [
    {**VALID, "clarity": 0}, {**VALID, "clarity": 6}, {**VALID, "clarity": "4"},
    {**VALID, "jargon": "no"}, {k: v for k, v in VALID.items() if k != "suggestion"},
    {**VALID, "suggestion": 3}, None, [], "texto",
])
def test_valida_esquema(bad):
    assert oc.validate_payload(bad) is False


def test_acepta_payload_conforme():
    assert oc.validate_payload(VALID) is True


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def test_respuesta_valida():
    async def go():
        async with _client(lambda r: _ok_response(VALID)) as c:
            return await oc.analyze(c, "Continuar")
    assert _run(go())["suggestion"] == "Continuar"


def test_timeout_se_mapea():
    def h(request):
        raise httpx.TimeoutException("t", request=request)

    async def go():
        async with _client(h) as c:
            await oc.analyze(c, "x")
    with pytest.raises(oc.ModelTimeout) as e:
        _run(go())
    assert e.value.code == "MODEL_TIMEOUT" and e.value.http_status == 504


def test_conexion_se_mapea():
    def h(request):
        raise httpx.ConnectError("c", request=request)

    async def go():
        async with _client(h) as c:
            await oc.analyze(c, "x")
    with pytest.raises(oc.OllamaUnavailable) as e:
        _run(go())
    assert e.value.http_status == 503


def test_modelo_ausente_se_mapea():
    async def go():
        async with _client(lambda r: httpx.Response(404, json={"error": "not found"})) as c:
            await oc.analyze(c, "x")
    with pytest.raises(oc.ModelNotAvailable) as e:
        _run(go())
    assert e.value.code == "MODEL_NOT_AVAILABLE"


def test_json_ilegible_se_mapea():
    async def go():
        async with _client(lambda r: httpx.Response(200, json={"message": {"content": "{{{"}})) as c:
            await oc.analyze(c, "x")
    with pytest.raises(oc.InvalidModelResponse) as e:
        _run(go())
    assert e.value.http_status == 502


def test_fuera_de_contrato_se_mapea():
    async def go():
        async with _client(lambda r: _ok_response({**VALID, "clarity": 9})) as c:
            await oc.analyze(c, "x")
    with pytest.raises(oc.InvalidModelResponse):
        _run(go())


def test_payload_usa_configuracion_aprobada():
    captured = {}

    def h(request):
        import json
        captured.update(json.loads(request.content))
        return _ok_response(VALID)

    async def go():
        async with _client(h) as c:
            await oc.analyze(c, "Continuar")
    _run(go())
    assert captured["model"] == config.MODEL == "qwen3.5:4b"
    assert captured["keep_alive"] == "30m"
    assert captured["stream"] is False
    assert captured["think"] is False
    assert captured["format"]["type"] == "object"
    assert captured["options"] == {"temperature": 0, "seed": 42, "num_ctx": 4096}


def test_probe_no_dispara_inferencia():
    calls = []

    def h(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={"models": [{"name": "qwen3.5:4b"}]})

    async def go():
        async with _client(h) as c:
            return await oc.probe(c)
    ready, available = _run(go())
    assert ready and available
    assert all("/api/tags" in u for u in calls)
    assert not any("/api/chat" in u for u in calls)


def test_probe_detecta_modelo_ausente():
    async def go():
        async with _client(lambda r: httpx.Response(200, json={"models": [{"name": "qwen3.5:9b"}]})) as c:
            return await oc.probe(c)
    ready, available = _run(go())
    assert ready and not available
