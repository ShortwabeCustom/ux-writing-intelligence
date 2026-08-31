#!/usr/bin/env python3
"""Agrega los resultados de FASE 8.5.2 y emite las métricas de STEP 14 y 16."""
import collections
import json
import pathlib
import sys

RES = pathlib.Path(sys.argv[1])
MODELS = ["qwen3.5:4b", "qwen3.5:9b"]


def load(model, kind, mode="warm"):
    p = RES / f"{kind}-{model.replace(':', '-')}-{mode}.json"
    return json.loads(p.read_text()) if p.exists() else None


def rate(a, b):
    return f"{a}/{b} ({100 * a / b:.1f}%)" if b else "n/a"


def check_rate(runs, level, prefix=None, names=None):
    ok = tot = 0
    for r in runs:
        for c in r["parity"][level]["checks"]:
            if (prefix and c["check"].startswith(prefix)) or (names and c["check"] in names):
                tot += 1
                ok += c["status"] == "PASS"
    return ok, tot


def main():
    D = {}
    for m in MODELS:
        stress, par = load(m, "semantic-stress"), load(m, "parity")
        if not stress or not par:
            print(f"[falta corrida de {m}]")
            continue
        runs = stress["runs"] + par["runs"]
        walls = [r["metrics"]["wall_s"] for r in runs if r["metrics"].get("wall_s")]
        walls.sort()
        n = len(walls)
        D[m] = {
            "stress": stress, "parity": par, "runs": runs, "cold": load(m, "parity", "cold"),
            "p50": walls[n // 2], "p95": walls[min(n - 1, int(round(0.95 * (n - 1))))], "n": n,
        }

    print("=== STEP 14 — MÉTRICAS DESAGREGADAS ===\n")
    rows = collections.OrderedDict()
    for m, d in D.items():
        R = d["runs"]
        sem_ok, sem_tot = check_rate(R, "raw", prefix="FACT:")
        semf_ok, semf_tot = check_rate(R, "final", prefix="FACT:")
        pc_ok, pc_tot = check_rate(R, "final", names={"PROTECTED_CONTENT"})
        pcr_ok, pcr_tot = check_rate(R, "raw", names={"PROTECTED_CONTENT"})
        or_ok, or_tot = check_rate(R, "final", names={"ORTHOGRAPHY_CLEAN"})
        gl_ok, gl_tot = check_rate(R, "final", names={"GLOSSARY_CLEAN"})
        noop = [r for r in R if r["no_op"]]
        rew = [r for r in noop if any(c["check"] == "NO_UNNECESSARY_REWRITE" and c["status"] == "FAIL"
                                      for c in r["parity"]["raw"]["checks"])]
        rows[m] = {
            "structured_output_success_rate": rate(sum(1 for r in R if r["parity"]["structured_ok"]), len(R)),
            "retries_needed": sum(1 for r in R if r["retried"]),
            "raw_success_rate": rate(sum(1 for r in R if r["parity"]["raw_pass"]), len(R)),
            "parity_success_rate": rate(sum(1 for r in R if r["parity"]["final_pass"]), len(R)),
            "critical_raw_failures": len([c for r in R for c in r["parity"]["raw_critical"]]),
            "critical_final_failures": len([c for r in R for c in r["parity"]["final_critical"]]),
            "semantic_fidelity_raw": rate(sem_ok, sem_tot),
            "semantic_fidelity_final": rate(semf_ok, semf_tot),
            "protected_content_raw": rate(pcr_ok, pcr_tot),
            "protected_content_final": rate(pc_ok, pc_tot),
            "orthography_final": rate(or_ok, or_tot),
            "glossary_final": rate(gl_ok, gl_tot),
            "unnecessary_rewrite_rate": rate(len(rew), len(noop)),
            "warm_p50_s": d["p50"], "warm_p95_s": d["p95"], "n_requests": d["n"],
        }
    keys = list(next(iter(rows.values())).keys())
    print("| Métrica | " + " | ".join(rows) + " |")
    print("|---|" + "---:|" * len(rows))
    for k in keys:
        print(f"| {k} | " + " | ".join(str(rows[m][k]) for m in rows) + " |")

    print("\n=== FALLOS CRÍTICOS RAW POR TIPO ===")
    allk = set()
    cr = {}
    for m, d in D.items():
        cr[m] = collections.Counter(c for r in d["runs"] for c in r["parity"]["raw_critical"])
        allk |= set(cr[m])
    print("| Fallo crítico (RAW) | " + " | ".join(D) + " |")
    print("|---|" + "---:|" * len(D))
    for k in sorted(allk):
        print(f"| {k} | " + " | ".join(str(cr[m].get(k, 0)) for m in D) + " |")
    if not allk:
        print("| (ninguno) | " + " | ".join("0" for _ in D) + " |")

    print("\n=== FALLOS CRÍTICOS FINAL POR TIPO ===")
    allk = set(); cf = {}
    for m, d in D.items():
        cf[m] = collections.Counter(c for r in d["runs"] for c in r["parity"]["final_critical"])
        allk |= set(cf[m])
    if allk:
        print("| Fallo crítico (FINAL) | " + " | ".join(D) + " |")
        print("|---|" + "---:|" * len(D))
        for k in sorted(allk):
            print(f"| {k} | " + " | ".join(str(cf[m].get(k, 0)) for m in D) + " |")
    else:
        print("**CERO fallos críticos finales en ambos modelos.**")

    print("\n=== REGRESIÓN OBLIGATORIA: originación (STEP 8) ===")
    for m, d in D.items():
        rr = [r for r in d["runs"] if r["mandatory_regression"]]
        print(f"\n-- {m} — {len(rr)} corridas --")
        seen = set()
        for r in rr:
            p = r["parity"]
            key = (p["raw_suggestion"], p["final_text"])
            if key in seen:
                continue
            seen.add(key)
            cnt = sum(1 for x in rr if (x["parity"]["raw_suggestion"], x["parity"]["final_text"]) == key)
            print(f"   x{cnt}  RAW  : {p['raw_suggestion']!r}")
            print(f"         FINAL: {p['final_text']!r}")
            print(f"         raw_crit={p['raw_critical']} final_crit={p['final_critical']}")

    print("\n=== VARIABILIDAD ENTRE REPETICIONES (STEP 11) ===")
    for m, d in D.items():
        byc = collections.defaultdict(set)
        for r in d["runs"]:
            byc[r["case_id"]].add(r["parity"]["raw_suggestion"])
        var = {k: v for k, v in byc.items() if len(v) > 1}
        print(f"  {m}: {len(var)}/{len(byc)} casos con salida NO determinista entre 3 reps")
        for k in sorted(var)[:6]:
            print(f"     - {k}: {len(var[k])} variantes")

    print("\n=== COLD (1 corrida representativa por modelo, STEP 12) ===")
    print("| Modelo | Casos | Cold p50 | load p50 |")
    print("|---|---:|---:|---:|")
    for m, d in D.items():
        c = d["cold"]
        if c:
            s = c["summary"]
            print(f"| {m} | {s['requests']} | {s['wall_s']['p50']}s | {s['load_s']['p50']}s |")

    print("\n=== STEP 16 — MATRIZ DE DECISIÓN ===")
    print("| Metric | " + " | ".join(f"`{m}`" for m in rows) + " |")
    print("|---|" + "---:|" * len(rows))
    order = [("Warm p50", "warm_p50_s", "s"), ("Warm p95", "warm_p95_s", "s"),
             ("Structured success", "structured_output_success_rate", ""),
             ("Raw critical failures", "critical_raw_failures", ""),
             ("Final critical failures", "critical_final_failures", ""),
             ("Semantic fidelity (raw)", "semantic_fidelity_raw", ""),
             ("Protected content (raw)", "protected_content_raw", ""),
             ("Glossary final", "glossary_final", ""),
             ("Orthography final", "orthography_final", ""),
             ("Unnecessary rewrites", "unnecessary_rewrite_rate", "")]
    for label, k, suf in order:
        print(f"| {label} | " + " | ".join(f"{rows[m][k]}{suf}" for m in rows) + " |")
    for m, d in D.items():
        ps = [l for l in d["stress"]["memory"][-1]["ollama_ps"].splitlines()[1:] if l.strip()]
        mem = next((l.split()[2] + " " + l.split()[3] for l in ps if m.split(":")[0] in l), "n/d")
        print(f"| Resident memory ({m}) | {mem} |" if len(rows) == 1 else "", end="")
    print("| Resident memory | " + " | ".join(
        next((" ".join(l.split()[2:4]) for l in d["stress"]["memory"][-1]["ollama_ps"].splitlines()[1:]
              if l.startswith(m)), "n/d") for m, d in D.items()) + " |")

    print("\n=== STEP 18 — PROYECCIÓN SCREEN AUDIT (secuencial, warm p50) ===")
    print("| Modelo | p50 | 5 | 10 | 15 | 20 |")
    print("|---|---:|---:|---:|---:|---:|")
    for m, d in D.items():
        p = d["p50"]
        print(f"| {m} | {p}s | " + " | ".join(f"{p * k:.0f}s" for k in (5, 10, 15, 20)) + " |")


main()
