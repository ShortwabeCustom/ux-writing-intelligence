#!/usr/bin/env python3
"""
STEP 38 — El runtime HTTP contra el banco de 62 casos de FASE 8.5.2.

Los archivos de benchmark se usan SOLO como datos de prueba. Este script no
importa implementación de benchmarks/: la verificación usa las capas del
runtime (src/), que es justamente lo que se quiere validar.
"""
import argparse
import collections
import json
import pathlib
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import (boundary_integrity, glossary, locale_integrity,  # noqa: E402
                 orthography, protected_content, semantic_fidelity)

BANK = ROOT / "benchmarks"


def load_cases():
    cases = []
    for f in ("parity_cases.json", "semantic_stress_cases.json"):
        d = json.loads((BANK / f).read_text())
        for c in d["cases"]:
            c["_suite"] = d["suite"]
            cases.append(c)
    return cases


def post(base, text, context=""):
    req = urllib.request.Request(
        base + "/v1/analyze/text",
        data=json.dumps({"text": text, "context": context, "locale": "es-MX"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode()), time.perf_counter() - t0


REQUIRED = ("text", "locale", "score", "severity", "clarity", "concision", "utility",
            "jargon", "predictability", "orthography", "issues", "reason", "suggestion")


def check_contract(body):
    problems = []
    for k in REQUIRED:
        if k not in body:
            problems.append(f"falta el campo {k}")
    if problems:
        return problems
    if not (0 <= body["score"] <= 100):
        problems.append("score fuera de rango")
    if body["severity"] not in ("low", "medium", "high"):
        problems.append("severity inválida")
    for k in ("clarity", "concision", "utility", "predictability", "orthography"):
        if not (1 <= body[k] <= 5):
            problems.append(f"{k} fuera de rango")
    if not isinstance(body["jargon"], bool):
        problems.append("jargon no booleano")
    for i in body["issues"]:
        if set(i) != {"category", "severity", "term", "reason"}:
            problems.append("issue fuera de contrato")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8787")
    ap.add_argument("--out")
    a = ap.parse_args()

    cases = load_cases()
    results, walls = [], []
    counters = collections.Counter()

    for c in cases:
        src = c["text"]
        try:
            body, wall = post(a.base, src)
        except Exception as e:
            results.append({"id": c["id"], "critical": [f"HTTP: {type(e).__name__}"]})
            counters["transport_error"] += 1
            continue
        walls.append(wall)

        critical, notes = [], []

        contract = check_contract(body)
        if contract:
            critical += [f"CONTRACT: {p}" for p in contract]
            counters["structured_invalid"] += 1
            results.append({"id": c["id"], "critical": critical})
            continue
        counters["structured_valid"] += 1

        if body["text"] != src:
            critical.append("response.text != request.text")

        sug = body["suggestion"]

        ok, probs = protected_content.verify(src, sug)
        counters["protected_ok" if ok else "protected_fail"] += 1
        critical += [f"PROTECTED: {p}" for p in probs]

        ok, probs = boundary_integrity.check(src, sug)
        counters["boundary_ok" if ok else "boundary_fail"] += 1
        critical += [f"BOUNDARY: {p}" for p in probs]

        meta = locale_integrity.detect_meta(sug)
        counters["meta_ok" if not meta else "meta_fail"] += 1
        critical += [f"META: {m}" for m in meta]

        eng = locale_integrity.detect_english(src, sug)
        counters["locale_ok" if not eng else "locale_fail"] += 1
        if eng:
            critical.append(f"LOCALE: {eng}")

        ok, probs = semantic_fidelity.check(src, sug)
        counters["semantic_ok" if ok else "semantic_fail"] += 1
        critical += [f"SEMANTIC: {p}" for p in probs]

        gv = glossary.violations(sug)
        counters["glossary_ok" if not gv else "glossary_fail"] += 1
        if gv:
            critical.append(f"GLOSSARY: jerga presente {gv}")

        ov = orthography.violations(sug)
        counters["orthography_ok" if not ov else "orthography_fail"] += 1
        if ov:
            critical.append(f"ORTHOGRAPHY: {ov}")

        if "expected_final" in c:
            if sug == c["expected_final"]:
                counters["expected_final_ok"] += 1
            else:
                counters["expected_final_fail"] += 1
                entry = f"EXPECTED_FINAL: esperado {c['expected_final']!r}, obtenido {sug!r}"
                (critical if c.get("mandatory_regression") else notes).append(entry)

        if not sug.strip():
            critical.append("EMPTY: sugerencia vacía")

        results.append({"id": c["id"], "suite": c["_suite"], "category": c["category"],
                        "source": src, "suggestion": sug, "score": body["score"],
                        "issues": len(body["issues"]), "wall_s": round(wall, 3),
                        "critical": critical, "notes": notes})

    crit = [r for r in results if r["critical"]]
    walls.sort()
    n = len(walls)
    summary = {
        "cases": len(cases),
        "final_critical_failures": sum(len(r["critical"]) for r in results),
        "cases_with_critical": len(crit),
        "structured_valid": f"{counters['structured_valid']}/{len(cases)}",
        "protected_content": f"{counters['protected_ok']}/{counters['protected_ok'] + counters['protected_fail']}",
        "glossary": f"{counters['glossary_ok']}/{counters['glossary_ok'] + counters['glossary_fail']}",
        "orthography": f"{counters['orthography_ok']}/{counters['orthography_ok'] + counters['orthography_fail']}",
        "boundary": f"{counters['boundary_ok']}/{counters['boundary_ok'] + counters['boundary_fail']}",
        "meta_leakage_failures": counters["meta_fail"],
        "locale_failures": counters["locale_fail"],
        "semantic_failures": counters["semantic_fail"],
        "expected_final": f"{counters['expected_final_ok']}/{counters['expected_final_ok'] + counters['expected_final_fail']}",
        "wall_p50": round(walls[n // 2], 3) if n else None,
        "wall_p95": round(walls[min(n - 1, int(round(0.95 * (n - 1))))], 3) if n else None,
    }

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if crit:
        print("\n--- CASOS CON FALLO CRÍTICO ---")
        for r in crit:
            print(f"  [{r['id']}] {r.get('source', '')[:60]!r}")
            for c in r["critical"]:
                print(f"      {c}")
    notes = [r for r in results if r.get("notes")]
    if notes:
        print("\n--- DESVIACIONES NO CRÍTICAS ---")
        for r in notes:
            for x in r["notes"]:
                print(f"  [{r['id']}] {x}")

    if a.out:
        pathlib.Path(a.out).write_text(json.dumps(
            {"summary": summary, "results": results}, ensure_ascii=False, indent=2))
    return 1 if crit else 0


if __name__ == "__main__":
    sys.exit(main())
