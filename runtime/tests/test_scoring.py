from src import scoring

PERFECT = {"clarity": 5, "utility": 5, "concision": 5, "predictability": 5, "orthography": 5}
WORST = {k: 1 for k in PERFECT}


def test_pesos_suman_cien():
    assert scoring.TOTAL_WEIGHT == 100
    assert scoring.WEIGHTS == {"clarity": 25, "utility": 20, "concision": 15,
                               "predictability": 15, "orthography": 15}
    assert scoring.JARGON_WEIGHT == 10


def test_maximo_es_cien_sin_jerga():
    assert scoring.compute_score(PERFECT, jargon=False) == 100.0


def test_jerga_cuesta_exactamente_diez():
    assert (scoring.compute_score(PERFECT, jargon=False)
            - scoring.compute_score(PERFECT, jargon=True)) == 10.0


def test_score_siempre_en_rango():
    for jargon in (True, False):
        for crit in (PERFECT, WORST):
            s = scoring.compute_score(crit, jargon)
            assert 0 <= s <= 100


def test_no_hay_penalizaciones_ocultas():
    """El total debe ser exactamente la suma del desglose."""
    for jargon in (True, False):
        b = scoring.breakdown(PERFECT, jargon)
        assert round(sum(b.values()), 1) == scoring.compute_score(PERFECT, jargon)


def test_umbrales_de_severidad():
    assert scoring.severity_for(100) == "low"
    assert scoring.severity_for(80) == "low"
    assert scoring.severity_for(79.9) == "medium"
    assert scoring.severity_for(60) == "medium"
    assert scoring.severity_for(59.9) == "high"
