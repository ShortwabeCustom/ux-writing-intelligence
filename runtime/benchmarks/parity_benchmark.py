#!/usr/bin/env python3
"""
FASE 8.5.2 — Benchmark de selección de modelo con harness de paridad.

Secuencial. Solo compara qwen3.5:4b y qwen3.5:9b.
Mismo prompt y mismo esquema para ambos. Sin optimización por modelo.

Uso:
  python3 parity_benchmark.py --model qwen3.5:4b --suite stress --mode warm --out ../results/<ts>
"""
import argparse
import json
import os
import pathlib
import statistics
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import production_parity as parity  # noqa: E402

OLLAMA = "http://127.0.0.1:11434"
HERE = pathlib.Path(__file__).resolve().parent
KEEP_ALIVE = "30m"

# ---------------------------------------------------------------------------
# STEP 5 — PROMPT ÚNICO PARA 4B Y 9B. No se ajusta por modelo.
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """Eres un especialista en UX Writing para producto digital en español de México (es-MX).

Recibes UN texto de interfaz y devuelves una evaluación estructurada.

EVALÚA del 1 al 5 (5 es óptimo):
- clarity: se entiende a la primera lectura.
- concision: no sobra ninguna palabra.
- utility: le sirve a la persona para decidir o actuar.
- predictability: anticipa correctamente lo que va a ocurrir.

REGLAS ABSOLUTAS SOBRE "suggestion":

1. CONSERVA EL SIGNIFICADO. No cambies lo que el producto afirma, niega, permite u obliga.
2. No conviertas una condición en certeza. Si el texto dice "si" o "cuando", consérvalo.
3. No elimines negaciones. Si el texto dice que algo NO ocurrió, debe seguir diciéndolo.
4. No conviertas un permiso ("puedes") en obligación ("debes"), ni al revés.
5. No conviertas lo opcional en obligatorio.
6. No cambies un estado por otro: "agendada" no es "confirmada"; "en revisión" no es "aprobada".
7. No inventes acciones, pasos, pantallas ni funcionalidad que no estén en el texto.
8. No inventes causas de un error ni rutas de recuperación.
9. No cambies montos, fechas, horas ni cifras. No agregues cifras nuevas.
10. Conserva EXACTAMENTE, carácter por carácter, todo lo que esté entre llaves dobles {{ }}, las URLs y los correos.
11. Conserva la estructura de párrafos y los saltos de línea.
12. Nunca unas dos palabras en una sola. Respeta los espacios.
13. EDITA POCO. Si el texto ya está bien, devuélvelo IDÉNTICO en "suggestion".

FORMATO:
- "suggestion" contiene ÚNICAMENTE el texto de interfaz para la persona usuaria.
- "suggestion" NUNCA contiene comentarios, explicaciones, veredictos, ni frases como
  "el texto está bien escrito" o "cumple con los criterios". Si el texto está bien,
  "suggestion" es el texto mismo, no un comentario sobre él.
- "reason" es una sola frase breve en español explicando tu evaluación.
- No incluyas razonamiento, notas, ni etiquetas de control.
- Escribe siempre en español de México."""

USER_TEMPLATE = "Texto de interfaz:\n\n{text}"

OPTIONS = {"temperature": 0, "seed": 42, "num_ctx": 4096}
NS = 1e9


def post(path, payload, timeout=900):
    req = urllib.request.Request(
        OLLAMA + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def unload(model):
    try:
        post("/api/chat", {"model": model, "messages": [], "keep_alive": 0}, timeout=120)
    except Exception:
        pass
    time.sleep(3)


def chat(model, text, keep_alive):
    """STEP 4: salida estructurada con esquema JSON, idéntico para ambos modelos."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_TEMPLATE.format(text=text)},
        ],
        "stream": False,
        "think": False,
        "format": parity.SCHEMA,
        "options": dict(OPTIONS),
        "keep_alive": keep_alive,
    }
    t0 = time.perf_counter()
    resp = post("/api/chat", payload)
    return resp, time.perf_counter() - t0


def metrics(resp, wall):
    g = resp.get
    out = {
        "wall_s": round(wall, 3),
        "total_s": round(g("total_duration") / NS, 3) if g("total_duration") else None,
        "load_s": round(g("load_duration") / NS, 3) if g("load_duration") else None,
        "prompt_eval_s": round(g("prompt_eval_duration") / NS, 3) if g("prompt_eval_duration") else None,
        "eval_s": round(g("eval_duration") / NS, 3) if g("eval_duration") else None,
        "prompt_eval_count": g("prompt_eval_count"),
        "eval_count": g("eval_count"),
    }
    if g("eval_duration") and g("eval_count"):
        out["eval_tok_s"] = round(g("eval_count") / (g("eval_duration") / NS), 2)
    return out


def sh(c):
    try:
        return subprocess.run(c, shell=True, capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception as e:
        return f"<error {e}>"


def memory_snapshot(label):
    return {"label": label, "ollama_ps": sh("ollama ps"),
            "swap": sh("sysctl -n vm.swapusage"),
            "ollama_rss_kb": sh("ps -Ao rss,comm | grep -i ollama | awk '{s+=$1} END {print s+0}'")}


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
        o["p95_basis"] = f"muestra insuficiente (n={n} < 20)"
    return o


def load_cases(suite):
    files = {"parity": ["parity_cases.json"], "stress": ["semantic_stress_cases.json"],
             "both": ["parity_cases.json", "semantic_stress_cases.json"]}[suite]
    out = []
    for f in files:
        d = json.loads((HERE / f).read_text())
        for c in d["cases"]:
            c["_suite"] = d["suite"]
            out.append(c)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--suite", choices=["parity", "stress", "both"], default="both")
    ap.add_argument("--mode", choices=["warm", "cold"], default="warm")
    ap.add_argument("--reps", type=int, default=None)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    cases = load_cases(a.suite)
    if a.mode == "cold":
        cases = [c for c in cases if c.get("cold")]
        reps, keep_alive = 1, 0
    else:
        reps, keep_alive = (a.reps or 3), KEEP_ALIVE

    outdir = pathlib.Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    slug = a.model.replace(":", "-")
    outfile = outdir / f"{'semantic-stress' if a.suite == 'stress' else 'parity'}-{slug}-{a.mode}.json"

    run = {"phase": "8.5.2", "model": a.model, "suite": a.suite, "mode": a.mode,
           "reps_per_case": reps, "keep_alive": keep_alive, "options": OPTIONS,
           "structured_output": True, "schema": parity.SCHEMA,
           "system_prompt_chars": len(SYSTEM_PROMPT),
           "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "memory": [], "runs": []}

    run["memory"].append(memory_snapshot("antes de cargar"))
    if a.mode == "warm":
        unload(a.model)
        chat(a.model, "Continuar", KEEP_ALIVE)
        run["memory"].append(memory_snapshot("modelo residente (keep_alive=30m)"))

    for case in cases:
        for rep in range(reps):
            if a.mode == "cold":
                unload(a.model)
            print(f"[{a.model}][{a.mode}] {case['id']} {rep + 1}/{reps}", flush=True)

            obj, err, m, retried = None, None, {"wall_s": None}, False
            for attempt in range(2):  # STEP 9: un reintento permitido
                try:
                    resp, wall = chat(a.model, case["text"], keep_alive)
                    m = metrics(resp, wall)
                    raw = resp.get("message", {}).get("content", "")
                    try:
                        obj = json.loads(raw)
                    except Exception:
                        obj = None
                    ok, _ = parity.validate_structure(obj)
                    if ok:
                        err = None
                        break
                    err = "salida estructurada inválida"
                except Exception as e:
                    err = f"{type(e).__name__}: {e}"
                if attempt == 0:
                    retried = True

            res = parity.run_parity(case["text"], obj, case)

            # Expectativa de texto final del caso, cuando existe.
            if "expected_final" in case:
                ok = res["final_text"] == case["expected_final"]
                res["final"]["checks"].append({
                    "check": "EXPECTED_FINAL", "status": "PASS" if ok else "FAIL",
                    "reason": ("final coincide con la expectativa del producto" if ok else
                               f"esperado {case['expected_final']!r}, obtenido {res['final_text']!r}"),
                    "heuristic": False})
                # Crítico solo en la regresión obligatoria (STEP 8). En el resto
                # es una desviación reportable del objetivo determinista.
                if not ok and case.get("mandatory_regression"):
                    res["final"]["critical"].append("EXPECTED_FINAL")
                    res["final_critical"] = sorted(set(res["final"]["critical"]))
                if not ok:
                    res["final_pass"] = False

            run["runs"].append({
                "case_id": case["id"], "category": case["category"], "suite": case["_suite"],
                "rep": rep + 1, "request_error": err, "retried": retried,
                "no_op": bool(case.get("no_op")),
                "mandatory_regression": bool(case.get("mandatory_regression")),
                "metrics": m, "model_json": obj, "parity": res,
            })

    if a.mode == "warm":
        run["memory"].append(memory_snapshot("fin, modelo residente"))
    run["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    ok_runs = [r for r in run["runs"] if not r["request_error"]]
    noop = [r for r in run["runs"] if r["no_op"]]
    rewrote = [r for r in noop if any(
        c["check"] == "NO_UNNECESSARY_REWRITE" and c["status"] == "FAIL"
        for c in r["parity"]["raw"]["checks"])]
    run["summary"] = {
        "requests": len(run["runs"]),
        "request_errors": len(run["runs"]) - len(ok_runs),
        "retries": sum(1 for r in run["runs"] if r["retried"]),
        "structured_ok": sum(1 for r in run["runs"] if r["parity"]["structured_ok"]),
        "raw_pass": sum(1 for r in run["runs"] if r["parity"]["raw_pass"]),
        "final_pass": sum(1 for r in run["runs"] if r["parity"]["final_pass"]),
        "raw_critical": [c for r in run["runs"] for c in r["parity"]["raw_critical"]],
        "final_critical": [c for r in run["runs"] for c in r["parity"]["final_critical"]],
        "no_op_cases": len(noop), "unnecessary_rewrites": len(rewrote),
        "wall_s": summarize([r["metrics"].get("wall_s") for r in ok_runs]),
        "load_s": summarize([r["metrics"].get("load_s") for r in ok_runs]),
        "eval_tok_s": summarize([r["metrics"].get("eval_tok_s") for r in ok_runs]),
    }
    outfile.write_text(json.dumps(run, ensure_ascii=False, indent=2))
    s = run["summary"]
    print(f"\n-> {outfile}")
    print(f"   n={s['requests']} err={s['request_errors']} struct={s['structured_ok']} "
          f"raw_pass={s['raw_pass']} final_pass={s['final_pass']} "
          f"raw_crit={len(s['raw_critical'])} final_crit={len(s['final_critical'])} "
          f"p50={s['wall_s'].get('p50')}s")


if __name__ == "__main__":
    main()
