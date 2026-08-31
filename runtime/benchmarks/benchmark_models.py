#!/usr/bin/env python3
"""
FASE 8.5.1 — Benchmark de modelos locales sobre Ollama.

Secuencial. Sin concurrencia (STEP 21).
Todos los modelos usan EXACTAMENTE el mismo system prompt y el mismo schema.

Uso:
    python3 benchmark_models.py --model qwen3.5:4b --mode cold  --out ../results/<fecha>
    python3 benchmark_models.py --model qwen3.5:4b --mode warm  --out ../results/<fecha>
"""

import argparse
import json
import os
import pathlib
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_output import validate  # noqa: E402

OLLAMA = "http://127.0.0.1:11434"
HERE = pathlib.Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# STEP 12 — SYSTEM PROMPT COMPARTIDO. Idéntico para todos los modelos.
# No se optimiza por modelo: eso invalidaría la comparación.
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """Eres un especialista en UX Writing para producto digital en español de México (es-MX).

Analizas UN texto de interfaz y devuelves una evaluación estructurada.

CRITERIOS DE EVALUACIÓN (1 a 5, donde 5 es óptimo):
- clarity: se entiende a la primera lectura.
- concision: no sobra ninguna palabra.
- utility: le sirve a la persona para decidir o actuar.
- predictability: el texto anticipa correctamente lo que va a pasar.
- orthography: ortografía, tildes, puntuación y espaciado correctos en español.

REGLAS OBLIGATORIAS:
1. Conserva el significado del texto original. No cambies lo que el producto dice.
2. No inventes acciones, pasos, pantallas ni funcionalidad que no estén en el texto original.
3. Conserva EXACTAMENTE, carácter por carácter, todo lo que esté entre llaves dobles {{ }}. No traduzcas, no reformatees, no muevas su contenido.
4. Conserva EXACTAMENTE las URLs y las direcciones de correo.
5. Conserva la estructura de párrafos y los saltos de línea del texto original.
6. Nunca unas dos palabras en una sola. Respeta los espacios entre palabras.
7. Evita jerga técnica o interna del negocio. Usa el lenguaje de la persona usuaria.
8. No uses lenguaje de implementación técnica.
9. Si el texto ya está bien escrito, NO lo reescribas. Devuélvelo idéntico y marca jargon en false.
10. Escribe siempre en español de México. Nunca en inglés.

FORMATO DE SALIDA:
Devuelve ÚNICAMENTE un objeto JSON válido, sin texto antes ni después, sin bloques de código, sin explicaciones.

{
  "clarity": 1,
  "concision": 1,
  "utility": 1,
  "predictability": 1,
  "orthography": 1,
  "jargon": true,
  "issues": [
    {"category": "ortografia|jerga|claridad|concision|utilidad|predictibilidad", "term": "fragmento exacto del texto", "reason": "por qué es un problema"}
  ],
  "suggestion": "el texto corregido, o el texto original si ya estaba bien"
}

"issues" puede ser una lista vacía. "suggestion" nunca puede estar vacía."""

USER_TEMPLATE = "Analiza este texto de interfaz:\n\n{text}"

OPTIONS = {
    "temperature": 0,
    "seed": 42,
    "num_ctx": 2048,
}
KEEP_ALIVE_WARM = "10m"


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def post(path, payload, timeout=600):
    req = urllib.request.Request(
        OLLAMA + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def unload(model):
    """Descarga el modelo de memoria (keep_alive=0) para forzar cold start."""
    try:
        post("/api/chat", {"model": model, "messages": [], "keep_alive": 0}, timeout=120)
    except Exception as e:
        print(f"  [warn] unload: {e}", file=sys.stderr)
    time.sleep(3)


def chat(model, text, keep_alive, think_supported=True):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_TEMPLATE.format(text=text)},
        ],
        "stream": False,
        "options": dict(OPTIONS),
        "keep_alive": keep_alive,
    }
    if think_supported:
        payload["think"] = False  # STEP 9: sin razonamiento visible
    t0 = time.perf_counter()
    try:
        resp = post("/api/chat", payload)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if think_supported and "think" in body.lower():
            return chat(model, text, keep_alive, think_supported=False)
        raise
    wall = time.perf_counter() - t0
    return resp, wall


# ---------------------------------------------------------------------------
# Memoria (STEP 15) — solo lectura, sin tocar configuración del sistema
# ---------------------------------------------------------------------------

def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True,
                              text=True, timeout=30).stdout.strip()
    except Exception as e:
        return f"<error: {e}>"


def memory_snapshot(label):
    return {
        "label": label,
        "ollama_ps": sh("ollama ps"),
        "vm_stat": sh("vm_stat"),
        "swap": sh("sysctl -n vm.swapusage"),
        "ollama_rss_kb": sh("ps -Ao rss,comm | grep -i ollama | awk '{s+=$1} END {print s+0}'"),
    }


# ---------------------------------------------------------------------------
# Métricas nativas (STEP 13)
# ---------------------------------------------------------------------------

NS = 1e9


def metrics(resp, wall):
    g = lambda k: resp.get(k)  # noqa: E731
    total = g("total_duration")
    load = g("load_duration")
    pe_d, pe_c = g("prompt_eval_duration"), g("prompt_eval_count")
    ev_d, ev_c = g("eval_duration"), g("eval_count")
    out = {
        "wall_s": round(wall, 3),
        "total_s": round(total / NS, 3) if total else None,
        "load_s": round(load / NS, 3) if load else None,
        "prompt_eval_s": round(pe_d / NS, 3) if pe_d else None,
        "eval_s": round(ev_d / NS, 3) if ev_d else None,
        "prompt_eval_count": pe_c,
        "eval_count": ev_c,
    }
    out["eval_tok_s"] = round(ev_c / (ev_d / NS), 2) if ev_d and ev_c else None
    out["prompt_tok_s"] = round(pe_c / (pe_d / NS), 2) if pe_d and pe_c else None
    return out


# ---------------------------------------------------------------------------
# Agregados (STEP 14)
# ---------------------------------------------------------------------------

def summarize(values):
    vals = sorted(v for v in values if v is not None)
    n = len(vals)
    if n == 0:
        return {"n": 0}
    out = {
        "n": n,
        "mean": round(statistics.fmean(vals), 3),
        "p50": round(statistics.median(vals), 3),
        "min": round(vals[0], 3),
        "max": round(vals[-1], 3),
    }
    # p95 solo si hay muestra suficiente; si no, se declara null explícitamente.
    if n >= 20:
        idx = min(n - 1, int(round(0.95 * (n - 1))))
        out["p95"] = round(vals[idx], 3)
        out["p95_basis"] = f"percentil empírico sobre n={n}"
    else:
        out["p95"] = None
        out["p95_basis"] = f"muestra insuficiente (n={n} < 20); no se fabrica p95"
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--mode", choices=["cold", "warm"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--reps", type=int, default=None)
    args = ap.parse_args()

    cases = json.loads((HERE / "cases.json").read_text())["cases"]
    if args.mode == "cold":
        cases = [c for c in cases if c.get("cold")]
        reps = args.reps or 1
        keep_alive = 0
    else:
        reps = args.reps or 3
        keep_alive = KEEP_ALIVE_WARM

    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    slug = args.model.replace(":", "-").replace("/", "-")
    outfile = outdir / f"{slug}-{args.mode}.json"

    run = {
        "model": args.model,
        "mode": args.mode,
        "reps_per_case": reps,
        "keep_alive": keep_alive,
        "options": OPTIONS,
        "system_prompt_sha_len": len(SYSTEM_PROMPT),
        "json_format_forced": False,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "memory": [],
        "runs": [],
    }

    run["memory"].append(memory_snapshot("antes de cargar el modelo"))

    if args.mode == "warm":
        print(f"[{args.model}] precalentando…")
        unload(args.model)
        chat(args.model, "Continuar", KEEP_ALIVE_WARM)
        run["memory"].append(memory_snapshot("modelo residente (warm)"))

    for case in cases:
        for rep in range(reps):
            if args.mode == "cold":
                unload(args.model)
            print(f"[{args.model}][{args.mode}] {case['id']} rep {rep + 1}/{reps}", flush=True)
            try:
                resp, wall = chat(args.model, case["text"], keep_alive)
                raw = resp.get("message", {}).get("content", "")
                m = metrics(resp, wall)
                err = None
            except Exception as e:
                raw, m, err = "", {"wall_s": None}, f"{type(e).__name__}: {e}"

            v = validate(case, raw)
            run["runs"].append({
                "case_id": case["id"], "category": case["category"], "rep": rep + 1,
                "request_error": err, "metrics": m, "raw": raw,
                "validation": {k: v[k] for k in
                               ("json_ok", "json_error", "checks", "passed",
                                "total", "case_status", "critical_failures")},
                "suggestion": (v["parsed"] or {}).get("suggestion"),
            })
            if args.mode == "cold":
                run["memory"].append(memory_snapshot(f"cold {case['id']} rep{rep + 1}"))

    if args.mode == "warm":
        run["memory"].append(memory_snapshot("fin de benchmark, modelo aún residente"))
    run["memory"].append(memory_snapshot("después del benchmark"))

    ok = [r for r in run["runs"] if not r["request_error"]]
    run["summary"] = {
        "requests": len(run["runs"]),
        "request_errors": len(run["runs"]) - len(ok),
        "wall_s": summarize([r["metrics"].get("wall_s") for r in ok]),
        "total_s": summarize([r["metrics"].get("total_s") for r in ok]),
        "load_s": summarize([r["metrics"].get("load_s") for r in ok]),
        "eval_tok_s": summarize([r["metrics"].get("eval_tok_s") for r in ok]),
        "checks_passed": sum(r["validation"]["passed"] for r in run["runs"]),
        "checks_total": sum(r["validation"]["total"] for r in run["runs"]),
        "cases_pass": sum(1 for r in run["runs"] if r["validation"]["case_status"] == "PASS"),
        "json_ok": sum(1 for r in run["runs"] if r["validation"]["json_ok"]),
        "critical_failures": [c for r in run["runs"] for c in r["validation"]["critical_failures"]],
    }
    run["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    outfile.write_text(json.dumps(run, ensure_ascii=False, indent=2))
    s = run["summary"]
    print(f"\n-> {outfile}")
    print(f"   requests={s['requests']} errores={s['request_errors']} "
          f"json_ok={s['json_ok']} checks={s['checks_passed']}/{s['checks_total']} "
          f"wall p50={s['wall_s'].get('p50')}s críticos={len(s['critical_failures'])}")


if __name__ == "__main__":
    main()
