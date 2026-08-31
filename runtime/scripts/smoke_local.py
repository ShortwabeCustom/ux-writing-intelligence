#!/usr/bin/env python3
"""
Smoke HTTP del runtime local: los 10 casos dorados de STEP 37.

Uso:  .venv/bin/python scripts/smoke_local.py [--base http://127.0.0.1:8787]
"""
import argparse
import json
import sys
import urllib.request

GOLDEN = [
    ("Continuar", "no_op", None),
    ("prestamo", "equals", "préstamo"),
    ("¿Como funciona?", "equals", "¿Cómo funciona?"),
    ("hola ,María", "equals", "hola, María"),
    ("no  fue posible", "equals", "no fue posible"),
    ("Ingresa tus credenciales", "equals", "Ingresa tus datos de acceso"),
    ("Proceder con la originación", "equals", "Proceder con la solicitud"),
    ("Tu visita será el {{Jueves 10 de abril de 2026}} a las {{6:00 p.m.}}.",
     "protected", ["{{Jueves 10 de abril de 2026}}", "{{6:00 p.m.}}"]),
    ("Hola María, seguimos contigo. 👋\n\nEsta vez no fue posible aprobar el incremento "
     "porque no se cumplieron todos los requisitos.\n\nSin embargo, aún puedes usar tu "
     "préstamo inicial desde tu App Banco Azteca.", "multiline", 3),
    ("Hubo un problema al guardar.", "no_recovery",
     ["revisa tu conexión", "inténtalo de nuevo", "intenta de nuevo", "contacta"]),
]


def post(base, text):
    req = urllib.request.Request(
        base + "/v1/analyze/text",
        data=json.dumps({"text": text, "context": "", "locale": "es-MX"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8787")
    a = ap.parse_args()

    failures = 0
    for i, (text, kind, expected) in enumerate(GOLDEN, 1):
        try:
            r = post(a.base, text)
        except Exception as e:
            print(f"{i:2}. ERROR  {type(e).__name__}: {e}")
            failures += 1
            continue

        s = r["suggestion"]
        ok, detail = True, ""

        if r["text"] != text:
            ok, detail = False, "response.text != request.text"
        elif kind == "no_op":
            ok = s == text
            detail = f"suggestion={s!r}"
        elif kind == "equals":
            ok = s == expected
            detail = f"esperado {expected!r}, obtenido {s!r}"
        elif kind == "protected":
            missing = [t for t in expected if t not in s]
            ok, detail = not missing, f"perdidos: {missing}"
        elif kind == "multiline":
            got = len([p for p in s.split("\n\n") if p.strip()])
            ok, detail = got == expected, f"párrafos esperados {expected}, obtenidos {got}"
        elif kind == "no_recovery":
            hits = [p for p in expected if p in s.casefold()]
            ok, detail = not hits, f"inventó: {hits}"

        print(f"{i:2}. {'PASS' if ok else 'FAIL'}  [{kind}] {text[:44]!r}"
              + ("" if ok else f"\n       {detail}"))
        failures += 0 if ok else 1

    print(f"\n{len(GOLDEN) - failures}/{len(GOLDEN)} casos dorados en verde")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
