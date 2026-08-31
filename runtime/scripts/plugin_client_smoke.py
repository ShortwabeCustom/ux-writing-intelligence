#!/usr/bin/env python3
"""
STEP 37 / 40 — Smoke equivalente al cliente del plugin.

Reproduce EXACTAMENTE lo que envía LocalAnalysisTransport: misma URL, mismos
encabezados (solo Content-Type) y el mismo `context` que el plugin construye.
"""
import json
import statistics
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "http://localhost:8787/v1/analyze/text"
CONTEXT = "Texto de interfaz seleccionado en Figma"   # ANALYZE_CONTEXT del plugin
HEADERS = {"Content-Type": "application/json"}        # createLocalHeaders()

REQUIRED = ("text", "locale", "score", "severity", "clarity", "concision", "utility",
            "jargon", "predictability", "orthography", "issues", "reason", "suggestion")

SHORT = [
    ("Continuar", "no_op"),
    ("prestamo", "orthography"),
    ("¿Como funciona?", "orthography"),
    ("Ingresa tus credenciales", "glossary"),
    ("Tu visita ha sido confirmada.", "no_op"),
    ("hola ,María", "orthography"),
    ("Hubo un problema al guardar.", "no_recovery"),
]
LONG = [
    ("Tu visita será el {{Jueves 10 de abril de 2026}} a las {{6:00 p.m.}}.", "placeholder"),
    ("Hola María, seguimos contigo. 👋\n\nEsta vez no fue posible aprobar el incremento "
     "porque no se cumplieron todos los requisitos.\n\nSin embargo, aún puedes usar tu "
     "préstamo inicial desde tu App Banco Azteca.", "multiline"),
    ("Escribe el monto que quieres solicitar.\n\nEl monto mínimo es de 3,000 pesos y el "
     "máximo depende de tu historial de pagos con nosotros.\n\nEste dato no afecta tu "
     "historial crediticio.", "multiline"),
]


def analyze(text):
    body = json.dumps({"text": text, "context": CONTEXT, "locale": "es-MX"}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers=HEADERS, method="POST")
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=90) as r:
        payload = json.loads(r.read().decode())
    return payload, time.perf_counter() - t0


def validate_contract(b):
    problems = [k for k in REQUIRED if k not in b]
    if problems:
        return problems
    if not (0 <= b["score"] <= 100):
        problems.append("score fuera de rango")
    if b["severity"] not in ("low", "medium", "high"):
        problems.append("severity inválida")
    for k in ("clarity", "concision", "utility", "predictability", "orthography"):
        if not (1 <= b[k] <= 5):
            problems.append(f"{k} fuera de rango")
    if not isinstance(b["jargon"], bool):
        problems.append("jargon no booleano")
    for i in b["issues"]:
        if set(i) != {"category", "severity", "term", "reason"}:
            problems.append("issue fuera de contrato")
    return problems


def main():
    results, short_w, long_w, failures = [], [], [], 0

    analyze("Continuar")  # precalentamiento, no se mide

    for corpus, bucket, label in ((SHORT, short_w, "corto"), (LONG, long_w, "largo")):
        for text, kind in corpus:
            try:
                b, wall = analyze(text)
            except urllib.error.HTTPError as e:
                print(f"  FAIL [{kind}] HTTP {e.code}  {text[:38]!r}")
                failures += 1
                continue
            bucket.append(wall)

            problems = validate_contract(b)
            if b["text"] != text:
                problems.append("response.text != request.text")

            s = b["suggestion"]
            if kind == "no_op" and s != text:
                problems.append(f"reescribió texto correcto: {s!r}")
            if kind == "placeholder":
                for ph in ("{{Jueves 10 de abril de 2026}}", "{{6:00 p.m.}}"):
                    if ph not in s:
                        problems.append(f"placeholder perdido: {ph}")
            if kind == "multiline":
                exp = len([p for p in text.split("\n\n") if p.strip()])
                got = len([p for p in s.split("\n\n") if p.strip()])
                if exp != got:
                    problems.append(f"párrafos {exp} -> {got}")
            if kind == "glossary":
                if not b["jargon"]:
                    problems.append("jargon debería ser true")
                if "credencial" in s.lower():
                    problems.append("conserva la jerga")
            if kind == "orthography" and b["orthography"] == 5:
                problems.append("no detectó el defecto ortográfico")
            if kind == "no_recovery":
                for bad in ("revisa tu conexión", "inténtalo de nuevo", "contacta"):
                    if bad in s.lower():
                        problems.append(f"inventó recuperación: {bad}")

            ok = not problems
            failures += 0 if ok else 1
            print(f"  {'PASS' if ok else 'FAIL'} [{label}/{kind}] {wall:6.3f}s "
                  f"score={b['score']:5.1f} orto={b['orthography']} jerga={b['jargon']} "
                  f"issues={len(b['issues'])}  {text[:34]!r}")
            if not ok:
                for p in problems:
                    print(f"        {p}")
            results.append({"text": text, "kind": kind, "wall_s": round(wall, 3),
                            "suggestion": s, "score": b["score"],
                            "orthography": b["orthography"], "jargon": b["jargon"],
                            "issues": b["issues"], "reason": b["reason"],
                            "problems": problems})

    def stats(v):
        v = sorted(v)
        n = len(v)
        return {"n": n, "p50": round(statistics.median(v), 3),
                "min": round(v[0], 3), "max": round(v[-1], 3),
                "mean": round(statistics.fmean(v), 3)}

    summary = {"short": stats(short_w), "long": stats(long_w), "failures": failures}
    print("\n" + json.dumps(summary, ensure_ascii=False, indent=2))

    with open("results/2026-08-29-phase-8-5-4/plugin-client-smoke.json", "w") as f:
        json.dump({"summary": summary, "results": results}, f, ensure_ascii=False, indent=2)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
