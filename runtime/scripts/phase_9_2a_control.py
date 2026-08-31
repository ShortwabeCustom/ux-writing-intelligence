"""
Control de reproducibilidad (FASE 9.2A).

Sin esto no se puede afirmar nada sobre el lote: si dos corridas INDIVIDUALES
del mismo texto ya difieren entre si, atribuir esa diferencia al lote seria un
error de atribucion.

Ejecuta la linea base secuencial DOS veces y compara individual contra
individual, con exactamente el mismo comparador que se usa contra el lote.
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.phase_9_2a_bench import (  # noqa: E402
    compare_quality, load_candidates, strategy_sequential,
)
from src import config  # noqa: E402

RUNTIME = "http://127.0.0.1:8787/v1/analyze/text"


async def main():
    candidates = load_candidates()

    async with httpx.AsyncClient() as client:
        await client.post(RUNTIME, json={
            "text": "Continuar", "context": "", "locale": config.LOCALE,
        }, timeout=120)

        print("corrida individual A...", flush=True)
        run_a = await strategy_sequential(client, candidates)
        print("corrida individual B...", flush=True)
        run_b = await strategy_sequential(client, candidates)

    control = compare_quality(run_a["results"], run_b["results"], candidates)
    control["total_a_seconds"] = round(run_a["completions"][-1], 3)
    control["total_b_seconds"] = round(run_b["completions"][-1], 3)

    out = ROOT / "reports/phase-9-2a-control.json"
    out.write_text(json.dumps(control, indent=2, ensure_ascii=False))

    print(json.dumps({
        "comparados": control["compared"],
        "criticos": control["critical_failure_count"],
        "acuerdo_noop": control["noop_agreement"],
        "acuerdo_ortografia": control["orthography_agreement"],
        "delta_score_medio": control["score_delta_mean"],
        "delta_score_max": control["score_delta_max"],
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
