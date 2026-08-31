"""
Scoring v2. Pesos aprobados, sin penalizaciones ocultas.

    clarity          25
    utility          20
    concision        15
    predictability   15
    orthography      15
    jargon           10
    -------------------
    TOTAL           100

Cada criterio 1..5 aporta `peso × valor/5`. Los 10 puntos de `jargon` se
pierden únicamente cuando existe evidencia de glosario que lo justifique, y
esa evidencia SIEMPRE aparece como issue visible en la respuesta. Ninguna
resta ocurre sin que la persona usuaria pueda verla.
"""
WEIGHTS = {
    "clarity": 25,
    "utility": 20,
    "concision": 15,
    "predictability": 15,
    "orthography": 15,
}
JARGON_WEIGHT = 10
TOTAL_WEIGHT = sum(WEIGHTS.values()) + JARGON_WEIGHT  # 100

SEVERITY_THRESHOLDS = ((80, "low"), (60, "medium"))


def compute_score(criteria: dict, jargon: bool) -> float:
    """criteria: {clarity, utility, concision, predictability, orthography} en 1..5."""
    total = sum(w * (criteria[k] / 5.0) for k, w in WEIGHTS.items())
    if not jargon:
        total += JARGON_WEIGHT
    return round(total, 1)


def severity_for(score: float) -> str:
    for threshold, label in SEVERITY_THRESHOLDS:
        if score >= threshold:
            return label
    return "high"


def breakdown(criteria: dict, jargon: bool) -> dict:
    """Desglose auditable: cuánto aportó cada criterio."""
    out = {k: round(w * (criteria[k] / 5.0), 2) for k, w in WEIGHTS.items()}
    out["jargon"] = 0.0 if jargon else float(JARGON_WEIGHT)
    return out
