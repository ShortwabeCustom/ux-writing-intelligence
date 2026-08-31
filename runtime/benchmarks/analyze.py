#!/usr/bin/env python3
"""Agrega los resultados crudos de una corrida y emite las tablas del reporte."""
import collections
import json
import pathlib
import statistics
import sys

RES = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../results/2026-08-29")
MODELS = ["qwen3.5:4b", "qwen3.5:9b", "qwen3:1.7b"]


def load(model, mode):
    p = RES / f"{model.replace(':', '-')}-{mode}.json"
    return json.loads(p.read_text()) if p.exists() else None


def pct(a, b):
    return f"{a}/{b} ({100 * a / b:.0f}%)" if b else "n/a"


def main():
    out = {}
    for m in MODELS:
        cold, warm = load(m, "cold"), load(m, "warm")
        if not warm:
            continue
        ok = [r for r in warm["runs"] if not r["request_error"]]
        walls = [r["metrics"]["wall_s"] for r in ok]
        crit = collections.Counter(c for r in warm["runs"] for c in r["validation"]["critical_failures"])
        # fallos por check (warm)
        chk = collections.defaultdict(lambda: [0, 0])
        for r in warm["runs"]:
            for c in r["validation"]["checks"]:
                chk[c["check"]][1] += 1
                if c["status"] == "PASS":
                    chk[c["check"]][0] += 1
        # por caso
        percase = collections.defaultdict(lambda: [0, 0])
        for r in warm["runs"]:
            percase[r["case_id"]][1] += 1
            if r["validation"]["case_status"] == "PASS":
                percase[r["case_id"]][0] += 1
        out[m] = {
            "cold": cold, "warm": warm, "walls": sorted(walls),
            "crit": crit, "chk": dict(chk), "percase": dict(percase),
        }

    print("\n=== TABLA COMPARATIVA (STEP 25) ===")
    print("| Modelo | Warm p50 | Warm p95 | Warm min–max | tok/s | Checks OK | Casos OK | Fallos críticos | Cold 1ª resp | Load cold |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for m, d in out.items():
        w, s = d["warm"], d["warm"]["summary"]
        p95 = s["wall_s"].get("p95")
        cold = d["cold"]
        cw = cl = "n/a"
        if cold:
            cs = cold["summary"]
            cw = f"{cs['wall_s'].get('p50')}s"
            cl = f"{cs['load_s'].get('p50')}s"
        print(f"| {m} | {s['wall_s']['p50']}s | {p95 if p95 else 'n/d'} | "
              f"{s['wall_s']['min']}–{s['wall_s']['max']}s | {s['eval_tok_s']['p50']} | "
              f"{pct(s['checks_passed'], s['checks_total'])} | "
              f"{pct(s['cases_pass'], s['requests'])} | {len(s['critical_failures'])} | {cw} | {cl} |")

    print("\n=== FALLOS CRÍTICOS POR CATEGORÍA (STEP 18) ===")
    allc = sorted({k for d in out.values() for k in d["crit"]})
    print("| Check crítico | " + " | ".join(out) + " |")
    print("|---|" + "---|" * len(out))
    for c in allc:
        print(f"| {c} | " + " | ".join(str(out[m]['crit'].get(c, 0)) for m in out) + " |")
    if not allc:
        print("| (ninguno) | " + " | ".join("0" for _ in out) + " |")

    print("\n=== CHECKS DE CALIDAD (warm, pass/total) ===")
    allk = sorted({k for d in out.values() for k in d["chk"]})
    print("| Check | " + " | ".join(out) + " |")
    print("|---|" + "---|" * len(out))
    for k in allk:
        row = []
        for m in out:
            v = out[m]["chk"].get(k)
            row.append(f"{v[0]}/{v[1]}" if v else "—")
        print(f"| {k} | " + " | ".join(row) + " |")

    print("\n=== POR CASO (warm, corridas PASS de 3) ===")
    allcase = sorted({k for d in out.values() for k in d["percase"]})
    print("| Caso | " + " | ".join(out) + " |")
    print("|---|" + "---|" * len(out))
    for c in allcase:
        row = []
        for m in out:
            v = out[m]["percase"].get(c)
            row.append(f"{v[0]}/{v[1]}" if v else "—")
        print(f"| {c} | " + " | ".join(row) + " |")

    print("\n=== PROYECCIÓN SCREEN AUDIT (STEP 20) — secuencial, warm p50 ===")
    print("| Modelo | p50 | 5 textos | 10 | 15 | 20 |")
    print("|---|---|---|---|---|---|")
    for m, d in out.items():
        p = d["warm"]["summary"]["wall_s"]["p50"]
        print(f"| {m} | {p}s | " + " | ".join(f"{p * n:.0f}s" for n in (5, 10, 15, 20)) + " |")

    print("\n=== COLD vs WARM (STEP 22) ===")
    print("| Modelo | Cold p50 | Cold load p50 | Warm p50 (mismos casos) | Delta |")
    print("|---|---|---|---|---|")
    for m, d in out.items():
        if not d["cold"]:
            continue
        cold_ids = {r["case_id"] for r in d["cold"]["runs"]}
        wsub = [r["metrics"]["wall_s"] for r in d["warm"]["runs"]
                if r["case_id"] in cold_ids and not r["request_error"]]
        cp = d["cold"]["summary"]["wall_s"]["p50"]
        wp = round(statistics.median(wsub), 3)
        print(f"| {m} | {cp}s | {d['cold']['summary']['load_s']['p50']}s | {wp}s | +{cp - wp:.2f}s |")

    print("\n=== MEMORIA (STEP 15) ===")
    for m, d in out.items():
        print(f"\n-- {m} --")
        for snap in d["warm"]["memory"]:
            ps = [l for l in snap["ollama_ps"].splitlines()[1:] if l.strip()]
            print(f"  [{snap['label']}] rss_total={int(snap['ollama_rss_kb'] or 0)/1048576:.2f} GB | "
                  f"swap={snap['swap']}")
            for l in ps:
                print(f"      ollama ps: {l}")


main()
