import pytest

from src import orthography as o

MANDATORY = [
    ("prestamo", "préstamo"),
    ("¿Como funciona?", "¿Cómo funciona?"),
    ("hola ,María", "hola, María"),
    ("no  fue posible", "no fue posible"),
]


@pytest.mark.parametrize("source,expected", MANDATORY)
def test_casos_obligatorios(source, expected):
    assert o.apply(source)[0] == expected


@pytest.mark.parametrize("word", ["esta", "mas", "aun", "si", "solicito", "el"])
def test_pares_ambiguos_no_se_tocan(word):
    """Política conservadora: sin contexto suficiente, no se corrige."""
    text = f"Yo {word} aqui"
    out = o.apply(text)[0]
    assert word in out


def test_contenido_protegido_intacto():
    src = "Tu visita será el {{Jueves 10 de abril de 2026}} a las {{6:00 p.m.}}."
    assert o.apply(src)[0] == src


def test_no_toca_numeros_con_coma():
    src = "El monto mínimo es de 3,000 pesos."
    assert o.apply(src)[0] == src


def test_sufijo_cion():
    assert o.apply("Revisa tu informacion")[0] == "Revisa tu información"


def test_signo_de_apertura_restaurado():
    assert o.apply("Como funciona?")[0] == "¿Cómo funciona?"


def test_violations_detecta_y_se_limpia():
    assert o.violations("no  fue") != []
    assert o.violations(o.apply("no  fue")[0]) == []


def test_score_baja_con_defectos():
    assert o.score("Tu solicitud quedó registrada.") == 5
    assert o.score("prestamo") < 5


def test_cambios_son_explicables():
    _, changes = o.apply("prestamo")
    assert changes and all("reason" in c and c["reason"] for c in changes)


# El puntaje y los issues no pueden contradecirse: si apply() corrige algo y
# genera evidencia visible, violations() debe contarlo. Esta regresión nació de
# ver `¿Como funciona?` reportando un issue de ortografía y a la vez orthography=5.
CON_DEFECTO = ["prestamo", "¿Como funciona?", "hola ,María", "no  fue posible",
               "¿Que necesitas?", "Revisa tu informacion"]


@pytest.mark.parametrize("text", CON_DEFECTO)
def test_puntaje_y_correccion_son_coherentes(text):
    corrected, changes = o.apply(text)
    assert changes, "apply() no corrigió nada"
    assert corrected != text
    assert o.score(text) < 5, "hay corrección pero el puntaje es perfecto"
    assert o.score(corrected) == 5, "el texto ya corregido no puntúa 5"


@pytest.mark.parametrize("text", ["Continuar", "Tu visita ha sido confirmada.",
                                  "¿Cómo funciona?", "El monto mínimo es de 3,000 pesos."])
def test_texto_correcto_puntua_cinco(text):
    assert o.score(text) == 5
    assert o.apply(text)[0] == text


def test_interrogativo_fuera_de_pregunta_no_penaliza():
    """Política conservadora: «como» sin signos no es interrogativo."""
    assert o.violations("No sé como llegar") == []
    assert o.score("No sé como llegar") == 5
