from src import glossary as g


def test_credenciales():
    out, changes = g.apply("Ingresa tus credenciales")
    assert out == "Ingresa tus datos de acceso"
    assert changes[0]["term"] == "credenciales"
    assert changes[0]["recommended"] == "datos de acceso"


def test_originacion():
    assert g.apply("Proceder con la originación")[0] == "Proceder con la solicitud"


def test_originacion_sin_tilde():
    assert g.apply("Proceder con la originacion")[0] == "Proceder con la solicitud"


def test_autoridad_sobre_el_modelo():
    """Aunque el candidato venga del modelo, el glosario manda."""
    assert g.apply("Proceder con la originación ahora")[0] == "Proceder con la solicitud ahora"


def test_conserva_mayuscula_inicial():
    assert g.apply("Credenciales requeridas")[0].startswith("Datos de acceso")


def test_no_toca_contenido_protegido():
    src = "Revisa {{credenciales}} y https://x.com/credenciales"
    assert g.apply(src)[0] == src


def test_violations():
    assert g.violations("Ingresa tus credenciales") == ["credenciales"]
    assert g.violations("Ingresa tus datos de acceso") == []


def test_terminos_declaran_evitar_en_ui():
    assert g.GLOSSARY["credenciales"].avoid_in_ui is True
    assert g.GLOSSARY["originación"].recommended == "solicitud"
