#!/usr/bin/env python3
"""
CONTROL DE AUTO-CONSISTENCIA DEL BANCO DE PRUEBAS.

Un caso bien construido debe cumplir sus propios 'facts' cuando el candidato
ES el texto de origen (o su piso determinista). Si el origen falla su propia
expectativa, el defecto es del validador o del caso, NUNCA del modelo.

Sin este control, un bug de regex se reporta como fallo semántico del modelo.
"""
import json
import pathlib
import sys

import production_parity as parity

HERE = pathlib.Path(__file__).resolve().parent
bad = 0
total = 0

for f in ("parity_cases.json", "semantic_stress_cases.json"):
    for c in json.loads((HERE / f).read_text())["cases"]:
        total += 1
        floor, _ = parity.deterministic_floor(c["text"])
        ev = parity.evaluate(c["text"], floor, c)
        fails = [x for x in ev["checks"] if x["status"] == "FAIL"]
        if fails:
            bad += 1
            print(f"[CASO INCONSISTENTE] {c['id']}  ({f})")
            print(f"   origen : {c['text']!r}")
            print(f"   piso   : {floor!r}")
            for x in fails:
                print(f"   FAIL {x['check']}: {x['reason']}")
            print()

print(f"{total - bad}/{total} casos auto-consistentes; {bad} inconsistentes")
sys.exit(1 if bad else 0)
