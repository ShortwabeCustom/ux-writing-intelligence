from src import protected_content as pc

SRC = ("Tu visita será el {{Jueves 10 de abril de 2026}} a las {{6:00 p.m.}}. "
       "Escríbenos a soporte@bancoazteca.com.mx o entra a https://bancoazteca.com.mx/x")


def test_extrae_los_tres_tipos():
    kinds = {k for _, k in pc.extract(SRC)}
    assert kinds == {"placeholder", "URL", "correo"}


def test_mask_unmask_es_reversible():
    masked, toks = pc.mask(SRC)
    assert "{{" not in masked and "@" not in masked
    assert pc.unmask(masked, toks) == SRC


def test_identidad_pasa():
    ok, problems = pc.verify(SRC, SRC)
    assert ok and problems == []


def test_placeholder_alterado_falla():
    ok, problems = pc.verify(SRC, SRC.replace("{{6:00 p.m.}}", "{{6:00 pm}}"))
    assert not ok and any("6:00 p.m." in p for p in problems)


def test_placeholder_inventado_falla():
    ok, problems = pc.verify("Hola {{name}}", "Hola {{name}} {{extra}}")
    assert not ok and any("inventado" in p for p in problems)


def test_url_perdida_falla():
    ok, _ = pc.verify(SRC, SRC.replace("https://bancoazteca.com.mx/x", "nuestro sitio"))
    assert not ok


def test_correo_perdido_falla():
    ok, _ = pc.verify(SRC, SRC.replace("soporte@bancoazteca.com.mx", "soporte"))
    assert not ok
