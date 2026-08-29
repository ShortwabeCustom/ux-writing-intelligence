import asyncio

import pytest

from src import analysis_service, config, ollama_client

VALID = {"clarity": 5, "concision": 5, "utility": 5, "predictability": 5,
         "jargon": False, "reason": "ok", "suggestion": "Continuar"}


class FakeOllama:
    """Sustituye ollama_client.analyze y cuenta llamadas."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0
        self.stricter_flags = []

    async def __call__(self, client, text, context="", stricter=False):
        self.calls += 1
        self.stricter_flags.append(stricter)
        # Al agotarse, repite la última respuesta: así un presupuesto excedido
        # se manifiesta como un conteo de llamadas alto, no como un TypeError.
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(r, Exception):
            raise r
        return r


def run(monkeypatch, fake, text, context=""):
    monkeypatch.setattr(ollama_client, "analyze", fake)
    monkeypatch.setattr(analysis_service.ollama_client, "analyze", fake)
    return asyncio.run(analysis_service.analyze(None, text, context))


# Criterios "débiles": puntúan por debajo de 90 para que el no-op de alta
# calidad NO cortocircuite y las guardas se ejerciten de verdad.
WEAK = {"clarity": 3, "concision": 3, "utility": 3, "predictability": 3}


def sugg(text, **over):
    return {**VALID, "suggestion": text, **over}


def weak(text, **over):
    return {**VALID, **WEAK, "suggestion": text, **over}


# --- Contrato base ----------------------------------------------------------

def test_response_text_siempre_igual_al_request(monkeypatch):
    src = "no  fue posible"
    f = FakeOllama([weak("cualquier otra cosa")])
    r = run(monkeypatch, f, src)
    assert r.response["text"] == src


def test_una_sola_llamada_en_el_caso_normal(monkeypatch):
    f = FakeOllama([sugg("Continuar")])
    r = run(monkeypatch, f, "Continuar")
    assert f.calls == 1
    assert r.telemetry["ollama_call_count"] == 1


# --- No-op de alta calidad (STEP 21) ---------------------------------------

def test_no_op_de_alta_calidad(monkeypatch):
    f = FakeOllama([sugg("Continuar ahora mismo por favor")])
    r = run(monkeypatch, f, "Continuar")
    assert r.response["suggestion"] == "Continuar"
    assert r.telemetry["high_quality_noop"] is True
    assert r.response["issues"] == []
    assert r.response["score"] >= 90


def test_no_hay_no_op_si_hay_evidencia_de_glosario(monkeypatch):
    f = FakeOllama([sugg("Ingresa tus credenciales")])
    r = run(monkeypatch, f, "Ingresa tus credenciales")
    assert r.telemetry["high_quality_noop"] is False
    assert r.response["suggestion"] == "Ingresa tus datos de acceso"


# --- Autoridad determinista -------------------------------------------------

def test_glosario_manda_sobre_el_modelo(monkeypatch):
    f = FakeOllama([sugg("Proceder con la originación")])
    r = run(monkeypatch, f, "Proceder con la originación")
    assert r.response["suggestion"] == "Proceder con la solicitud"
    assert r.response["jargon"] is True
    assert any(i["category"] == "glosario" for i in r.response["issues"])


def test_jerga_es_explicable(monkeypatch):
    """jargon=True del modelo no basta: sin evidencia, es False."""
    f = FakeOllama([sugg("Continuar", jargon=True)])
    r = run(monkeypatch, f, "Continuar")
    assert r.response["jargon"] is False


def test_ortografia_es_determinista_no_del_modelo(monkeypatch):
    f = FakeOllama([sugg("prestamo")])
    r = run(monkeypatch, f, "prestamo")
    assert r.response["suggestion"] == "préstamo"
    assert r.response["orthography"] < 5


# --- Guardas y fallback -----------------------------------------------------

def test_placeholder_alterado_cae_al_piso(monkeypatch):
    src = "Tu visita será el {{Jueves 10}} a las {{6:00 p.m.}}."
    f = FakeOllama([weak("Tu visita será el {{Jueves}} a las {{6 pm}}.")])
    r = run(monkeypatch, f, src)
    assert r.response["suggestion"] == src
    assert r.telemetry["protected_content_rejection_used"] is True
    assert r.telemetry["fallback_suggestion_used"] is True


def test_fuga_de_meta_cae_al_piso(monkeypatch):
    f = FakeOllama([weak("Continuar /no_think")])
    r = run(monkeypatch, f, "Continuar mas tarde con el proceso pendiente")
    assert "/no_think" not in r.response["suggestion"]
    assert r.telemetry["meta_rejection_used"] is True


def test_frontera_corrompida_cae_al_piso(monkeypatch):
    src = "Revisa tu App Banco porque hay errores"
    f = FakeOllama([weak("Revisa tu AppBanco porque hayerrores")])
    r = run(monkeypatch, f, src)
    assert r.response["suggestion"] == src
    assert r.telemetry["boundary_rejection_used"] is True


# --- Presupuesto de llamadas (STEP 23/24/25) --------------------------------

def test_regeneracion_semantica_una_sola_vez(monkeypatch):
    src = "Hubo un problema al guardar."
    malo = weak("Hubo un problema al guardar. Revisa tu conexión e inténtalo de nuevo.")
    f = FakeOllama([malo, malo])
    r = run(monkeypatch, f, src)
    assert f.calls == 2
    assert f.stricter_flags == [False, True]
    assert r.telemetry["semantic_regeneration_used"] is True
    assert r.telemetry["fallback_suggestion_used"] is True
    assert r.response["suggestion"] == src


def test_regeneracion_exitosa_se_acepta(monkeypatch):
    src = "Hubo un problema al guardar."
    malo = weak("Hubo un problema al guardar. Revisa tu conexión e inténtalo de nuevo.")
    bueno = weak("Ocurrió un problema al guardar.")
    f = FakeOllama([malo, bueno])
    r = run(monkeypatch, f, src)
    assert f.calls == 2
    assert r.response["suggestion"] == "Ocurrió un problema al guardar."
    assert r.telemetry["fallback_suggestion_used"] is False


def test_reintento_estructurado_una_sola_vez(monkeypatch):
    f = FakeOllama([ollama_client.InvalidModelResponse("mal"), sugg("Continuar")])
    r = run(monkeypatch, f, "Continuar")
    assert f.calls == 2
    assert r.telemetry["structured_retry_used"] is True


def test_estructurado_invalido_dos_veces_propaga(monkeypatch):
    f = FakeOllama([ollama_client.InvalidModelResponse("a"),
                    ollama_client.InvalidModelResponse("b")])
    with pytest.raises(ollama_client.InvalidModelResponse):
        run(monkeypatch, f, "Continuar")
    assert f.calls == 2


def test_nunca_tres_llamadas(monkeypatch):
    """Reintento estructurado + rechazo semántico NO deben sumar una tercera."""
    src = "Hubo un problema al guardar."
    malo = weak("Hubo un problema al guardar. Revisa tu conexión e inténtalo de nuevo.")
    f = FakeOllama([ollama_client.InvalidModelResponse("x"), malo, malo, malo])
    r = run(monkeypatch, f, src)
    assert f.calls == 2, "el presupuesto máximo de 2 llamadas fue superado"
    assert f.calls <= config.MAX_OLLAMA_CALLS
    assert r.telemetry["structured_retry_used"] is True
    assert r.telemetry["semantic_regeneration_used"] is False
    assert r.response["suggestion"] == src


def test_timeout_no_se_reintenta(monkeypatch):
    f = FakeOllama([ollama_client.ModelTimeout("t"), sugg("Continuar")])
    with pytest.raises(ollama_client.ModelTimeout):
        run(monkeypatch, f, "Continuar")
    assert f.calls == 1


def test_fallo_de_conexion_no_se_reintenta(monkeypatch):
    f = FakeOllama([ollama_client.OllamaUnavailable("c"), sugg("Continuar")])
    with pytest.raises(ollama_client.OllamaUnavailable):
        run(monkeypatch, f, "Continuar")
    assert f.calls == 1


# --- Telemetría -------------------------------------------------------------

def test_telemetria_no_contiene_contenido(monkeypatch):
    f = FakeOllama([sugg("Continuar")])
    r = run(monkeypatch, f, "texto secreto de la persona usuaria")
    joined = " ".join(str(v) for v in r.telemetry.values())
    assert "secreto" not in joined
    assert "text" not in r.telemetry and "suggestion" not in r.telemetry


# --- Variación cosmética ----------------------------------------------------

def test_variacion_cosmetica_prefiere_el_piso(monkeypatch):
    """«no fue posible» no debe volver como «No fue posible.»."""
    f = FakeOllama([weak("No fue posible.")])
    r = run(monkeypatch, f, "no  fue posible")
    assert r.response["suggestion"] == "no fue posible"


def test_mejora_real_si_se_acepta(monkeypatch):
    src = "El usuario debera de ingresar su informacion"
    f = FakeOllama([weak("Ingresa tus datos")])
    r = run(monkeypatch, f, src)
    assert r.response["suggestion"] == "Ingresa tus datos"
