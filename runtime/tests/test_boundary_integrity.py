from src import boundary_integrity as b


def test_fusion_detectada_relativa_al_origen():
    ok, problems = b.check("Revisa tu App Banco Azteca", "Revisa tu AppBanco Azteca")
    assert not ok and "App" in problems[0]


def test_no_fue():
    ok, _ = b.check("no fue posible", "nofue posible")
    assert not ok


def test_hay_errores():
    ok, _ = b.check("hay errores en los datos", "hayerrores en los datos")
    assert not ok


def test_reparar_frontera_esta_permitido():
    ok, problems = b.check("Revisa tuApp Banco", "Revisa tu App Banco")
    assert ok and problems == []


def test_texto_identico_pasa():
    src = "Revisa tu App Banco Azteca porque hay errores"
    assert b.check(src, src)[0]


def test_sin_lista_negra():
    """Detecta una fusión nueva que ninguna lista negra contendría."""
    ok, _ = b.check("Consulta tu saldo disponible", "Consulta tu saldodisponible")
    assert not ok


def test_no_reporta_espaciado_ni_puntuacion():
    """El espaciado es ortografía, no frontera. Este módulo no debe opinar."""
    assert b.check("hola ,María", "hola ,María")[0]
    assert b.check("no  fue", "no  fue")[0]
