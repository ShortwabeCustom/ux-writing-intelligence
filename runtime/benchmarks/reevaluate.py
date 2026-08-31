#!/usr/bin/env python3
"""
FASE 8.5.2B — Re-evaluación offline.

Los runs guardan el JSON crudo de cada modelo (`model_json`). Este script
recalcula RAW y FINAL con los evaluadores corregidos de 8.5.2B (frontera
relativa al origen, NO_ADDED_CONTENT restringido, taxonomía, intervenciones)
SIN volver a ejecutar inferencia.

Preserva intactos los artefactos originales; escribe en phase-8-5-2-final/.
"""
import collections
import importlib
import json
import pathlib
import statistics
import sys

import production_parity as parity
importlib.reload(parity)

HERE = pathlib.Path(__file__).resolve().parent
IN = pathlib.Path(sys.argv[1])
OUT = IN / "phase-8-5-2-final"
MODELS = ["qwen3.5:4b", "qwen3.5:9b"]

CASES = {}
for f in ("parity_cases.json", "semantic_stress_cases.json"):
    for c in json.loads((HERE / f).read_text())["cases"]:
        CASES[c["id"]] = c


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def summarize(vals):
    v = sorted(x for x in vals if x is not None)
    n = len(v)
    if not n:
        return {"n": 0}
    o = {"n": n, "mean": round(statistics.fmean(v), 3), "p50": round(statistics.median(v), 3),
         "min": round(v[0], 3), "max": round(v[-1], 3)}
    if n >= 20:
        o["p95"] = round(v[min(n - 1, int(round(0.95 * (n - 1))))], 3)
        o["p95_basis"] = f"percentil empírico, n={n}"
    else:
        o["p95"] = None
        o["p95_basis"] = f"muestra insuficiente (n={n} < 20); no se fabrica"
    return o


def check_rate(runs, level, names=None, prefix=None):
    ok = tot = 0
    for r in runs:
        for c in r["re"][level]["checks"]:
            if (names and c["check"] in names) or (prefix and c["check"].startswith(prefix)):
                tot += 1
                ok += c["status"] == "PASS"
    return {"pass": ok, "total": tot, "pct": pct(ok, tot)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"input_dir": str(IN), "models": {}}

    for model in MODELS:
        slug = model.replace(":", "-")
        files = {k: IN / f"{k}-{slug}-warm.json" for k in ("semantic-stress", "parity")}
        cold_f = IN / f"parity-{slug}-cold.json"
        if not all(f.exists() for f in files.values()):
            print(f"[FALTA] corrida warm de {model}")
            continue

        runs, meta = [], {}
        for kind, f in files.items():
            d = json.loads(f.read_text())
            meta[kind] = {"memory": d["memory"], "options": d["options"],
                          "keep_alive": d["keep_alive"], "schema": d["schema"]}
            for r in d["runs"]:
                case = CASES[r["case_id"]]
                res = parity.run_parity(case["text"], r["model_json"], case)
                if "expected_final" in case:
                    ok = res["final_text"] == case["expected_final"]
                    res["final"]["checks"].append({
                        "check": "EXPECTED_FINAL", "status": "PASS" if ok else "FAIL",
                        "reason": ("coincide con el objetivo determinista del producto" if ok
                                   else f"esperado {case['expected_final']!r}, obtenido {res['final_text']!r}"),
                        "heuristic": False})
                    if not ok and case.get("mandatory_regression"):
                        res["final"]["critical"].append("EXPECTED_FINAL")
                        res["final_critical"] = sorted(set(res["final"]["critical"]))
                    if not ok:
                        res["final_pass"] = False
                res["interventions"] = parity.classify_interventions(case["text"], res, case)
                res["taxonomy_raw"] = parity.classify_failures(res["raw"])
                res["taxonomy_final"] = parity.classify_failures(res["final"])
                runs.append({**r, "re": res, "source": case["text"],
                             "suite": kind, "case": case})

        N = len(runs)
        uniq = {r["case_id"] for r in runs}

        # --- STEP 3: intervenciones ---
        reason_ct = collections.Counter(x for r in runs for x in r["re"]["interventions"])
        any_int = [r for r in runs if r["re"]["interventions"]]
        cases_int = {r["case_id"] for r in any_int}
        fb = [r for r in runs if "fallback_to_source" in r["re"]["interventions"]]
        det = [r for r in runs if {"glossary_override", "orthography_override"} & set(r["re"]["interventions"])]

        # --- STEP 4: reescritura innecesaria ---
        noop = [r for r in runs if r["case"].get("no_op")]
        rw_raw = [r for r in noop if any(c["check"] == "NO_UNNECESSARY_REWRITE" and c["status"] == "FAIL"
                                         for c in r["re"]["raw"]["checks"])]
        rw_fin = [r for r in noop if any(c["check"] == "NO_UNNECESSARY_REWRITE" and c["status"] == "FAIL"
                                         for c in r["re"]["final"]["checks"])]

        walls = [r["metrics"].get("wall_s") for r in runs if not r["request_error"]]
        toks = [r["metrics"].get("eval_tok_s") for r in runs if not r["request_error"]]

        # --- memoria residente atribuible al modelo (ollama ps) ---
        resident = None
        for snap in reversed(meta["semantic-stress"]["memory"]):
            for line in snap["ollama_ps"].splitlines()[1:]:
                if line.startswith(model):
                    parts = line.split()
                    resident = f"{parts[2]} {parts[3]}"
                    proc = parts[4] if len(parts) > 4 else "?"
                    resident = {"size": f"{parts[2]} {parts[3]}", "processor": proc,
                                "evidence": line.strip(), "snapshot": snap["label"]}
                    break
            if resident:
                break

        m = {
            "completeness": {
                "requests": N, "unique_cases": len(uniq),
                "reps_per_case": round(N / len(uniq), 2),
                "transport_errors": sum(1 for r in runs if r["request_error"]),
                "retries": sum(1 for r in runs if r["retried"]),
                "structured_invalid": sum(1 for r in runs if not r["re"]["structured_ok"]),
            },
            "structured_output_success_rate": pct(sum(1 for r in runs if r["re"]["structured_ok"]), N),
            "raw_success_rate": pct(sum(1 for r in runs if r["re"]["raw_pass"]), N),
            "parity_success_rate": pct(sum(1 for r in runs if r["re"]["final_pass"]), N),
            "critical_raw_failures": sum(len(r["re"]["raw_critical"]) for r in runs),
            "critical_final_failures": sum(len(r["re"]["final_critical"]) for r in runs),
            "critical_raw_by_type": dict(collections.Counter(
                c for r in runs for c in r["re"]["raw_critical"])),
            "critical_final_by_type": dict(collections.Counter(
                c for r in runs for c in r["re"]["final_critical"])),
            "taxonomy_raw": dict(collections.Counter(
                k for r in runs for k, v in r["re"]["taxonomy_raw"].items() for _ in range(v))),
            "taxonomy_final": dict(collections.Counter(
                k for r in runs for k, v in r["re"]["taxonomy_final"].items() for _ in range(v))),
            "safety_intervention": {
                "runs_with_any": len(any_int), "runs_total": N,
                "rate_runs_pct": pct(len(any_int), N),
                "cases_with_any": len(cases_int), "cases_total": len(uniq),
                "rate_cases_pct": pct(len(cases_int), len(uniq)),
                "reasons": dict(reason_ct),
            },
            "fallback_to_source": {
                "count": len(fb), "rate_pct": pct(len(fb), N),
                "case_ids": sorted({r["case_id"] for r in fb}),
                "reasons": dict(collections.Counter(
                    c for r in fb for c in r["re"]["raw_critical"])),
            },
            "deterministic_override": {
                "count": len(det), "rate_pct": pct(len(det), N),
                "case_ids": sorted({r["case_id"] for r in det}),
                "glossary": reason_ct.get("glossary_override", 0),
                "orthography": reason_ct.get("orthography_override", 0),
            },
            "unnecessary_rewrite": {
                "no_op_runs": len(noop),
                "raw_count": len(rw_raw), "raw_rate_pct": pct(len(rw_raw), len(noop)),
                "final_count": len(rw_fin), "final_rate_pct": pct(len(rw_fin), len(noop)),
                "raw_case_ids": sorted({r["case_id"] for r in rw_raw}),
                "final_case_ids": sorted({r["case_id"] for r in rw_fin}),
            },
            "semantic_detected_pass": {
                "raw": check_rate(runs, "raw", prefix="FACT:"),
                "final": check_rate(runs, "final", prefix="FACT:"),
            },
            "protected_content": {
                "raw": check_rate(runs, "raw", names={"PROTECTED_CONTENT"}),
                "final": check_rate(runs, "final", names={"PROTECTED_CONTENT"}),
            },
            "glossary": {
                "raw": check_rate(runs, "raw", names={"GLOSSARY_CLEAN"}),
                "final": check_rate(runs, "final", names={"GLOSSARY_CLEAN"}),
            },
            "orthography": {
                "raw": check_rate(runs, "raw", names={"ORTHOGRAPHY_CLEAN"}),
                "final": check_rate(runs, "final", names={"ORTHOGRAPHY_CLEAN"}),
            },
            "boundary": {
                "raw": check_rate(runs, "raw", names={"SOURCE_BOUNDARY"}),
                "final": check_rate(runs, "final", names={"SOURCE_BOUNDARY"}),
            },
            "meta_leakage": {
                "raw": check_rate(runs, "raw", names={"NO_META_LEAKAGE"}),
                "final": check_rate(runs, "final", names={"NO_META_LEAKAGE"}),
            },
            "locale": {
                "raw": check_rate(runs, "raw", names={"LOCALE_ES_MX"}),
                "final": check_rate(runs, "final", names={"LOCALE_ES_MX"}),
            },
            "performance_warm": {
                "wall_s": summarize(walls), "eval_tok_s": summarize(toks),
                "prompt_eval_s": summarize([r["metrics"].get("prompt_eval_s") for r in runs]),
                "eval_s": summarize([r["metrics"].get("eval_s") for r in runs]),
                "eval_count": summarize([r["metrics"].get("eval_count") for r in runs]),
            },
            "resident_memory": resident,
            "keep_alive_used": meta["semantic-stress"]["keep_alive"],
        }

        if cold_f.exists():
            cd = json.loads(cold_f.read_text())
            m["cold"] = {"requests": cd["summary"]["requests"],
                         "wall_s": cd["summary"]["wall_s"],
                         "load_s": cd["summary"]["load_s"]}

        # regresión obligatoria
        reg = [r for r in runs if r["case"].get("mandatory_regression")]
        m["originacion_regression"] = [{
            "case_id": r["case_id"], "rep": r["rep"],
            "raw": r["re"]["raw_suggestion"],
            "raw_valid": r["re"]["raw_pass"],
            "raw_critical": r["re"]["raw_critical"],
            "intervened": bool(r["re"]["interventions"]),
            "interventions": r["re"]["interventions"],
            "final": r["re"]["final_text"],
            "final_valid": r["re"]["final_pass"],
        } for r in reg]

        # variabilidad entre repeticiones
        byc = collections.defaultdict(set)
        for r in runs:
            byc[r["case_id"]].add(r["re"]["raw_suggestion"])
        var = {k: len(v) for k, v in byc.items() if len(v) > 1}
        m["variability"] = {"non_deterministic_cases": len(var), "total_cases": len(byc),
                            "rate_pct": pct(len(var), len(byc)), "detail": var}

        report["models"][model] = m
        (OUT / f"reevaluated-{slug}.json").write_text(json.dumps(
            {"model": model, "runs": [{
                "case_id": r["case_id"], "rep": r["rep"], "suite": r["suite"],
                "source": r["source"], "raw_suggestion": r["re"]["raw_suggestion"],
                "final_text": r["re"]["final_text"], "decision": r["re"]["decision"],
                "interventions": r["re"]["interventions"],
                "raw_critical": r["re"]["raw_critical"],
                "final_critical": r["re"]["final_critical"],
                "taxonomy_raw": r["re"]["taxonomy_raw"],
                "taxonomy_final": r["re"]["taxonomy_final"],
                "raw_checks": r["re"]["raw"]["checks"],
                "final_checks": r["re"]["final"]["checks"],
                "metrics": r["metrics"],
            } for r in runs]}, ensure_ascii=False, indent=1))
        print(f"[ok] {model}: {N} corridas re-evaluadas")

    (OUT / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\n-> {OUT}/metrics.json")


main()
