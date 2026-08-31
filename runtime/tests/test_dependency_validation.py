"""
Validación de la dependencia de inferencia (FASE 8.5.6, STEP 47).

No se puede dar por bueno que cualquier proceso escuchando en el puerto de
Ollama SEA Ollama. El texto de la persona no debe salir hacia una dependencia
que el runtime no ha verificado.
"""
import asyncio

import httpx
import pytest

from src import config
from src.ollama_client import probe


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _probe(handler):
    """Sondea con un transporte simulado. Sin plugin de asyncio: el proyecto
    usa asyncio.run, igual que tests/test_ollama_client.py."""
    async def run():
        async with _client(handler) as client:
            return await probe(client)

    return asyncio.run(run())


def test_servicio_ajeno_que_no_habla_json_no_esta_listo():
    assert _probe(lambda r: httpx.Response(200, text="<html>Hola</html>")) == (False, False)


def test_servicio_ajeno_con_json_distinto_no_ofrece_el_modelo():
    """Un JSON cualquiera no basta: hace falta el modelo esperado."""
    _, model_available = _probe(lambda r: httpx.Response(200, json={"status": "ok"}))
    assert model_available is False


def test_catalogo_con_otros_modelos_no_habilita_el_nuestro():
    payload = {"models": [{"name": "llama3:8b"}, {"name": "mistral:7b"}]}
    assert _probe(lambda r: httpx.Response(200, json=payload)) == (True, False)


def test_nombre_parecido_no_cuenta_como_el_modelo():
    """Coincidencia exacta: `qwen3.5:4b-instruct` no es `qwen3.5:4b`."""
    payload = {"models": [{"name": config.MODEL + "-instruct"}]}
    assert _probe(lambda r: httpx.Response(200, json=payload)) == (True, False)


def test_puerto_cerrado_no_esta_listo():
    def boom(request):
        raise httpx.ConnectError("conexión rechazada")

    assert _probe(boom) == (False, False)


def test_solo_el_modelo_exacto_habilita_el_runtime():
    payload = {"models": [{"name": config.MODEL}]}
    assert _probe(lambda r: httpx.Response(200, json=payload)) == (True, True)


@pytest.mark.parametrize("handler", [
    lambda r: httpx.Response(200, text="no soy ollama"),
    lambda r: httpx.Response(200, json={"status": "ok"}),
    lambda r: httpx.Response(200, json={"models": [{"name": "llama3:8b"}]}),
    lambda r: httpx.Response(500),
])
def test_ningun_servicio_ajeno_produce_runtime_listo(handler):
    """
    Garantía de release: `runtime: ready` exige Ollama vivo Y el modelo exacto.
    El plugin solo enruta a local con ese estado, así que un servicio ajeno en
    el puerto nunca puede recibir el texto de la persona.
    """
    ollama_ready, model_available = _probe(handler)
    assert (ollama_ready and model_available) is False
