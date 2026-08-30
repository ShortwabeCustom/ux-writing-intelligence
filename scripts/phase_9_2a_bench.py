"""
FASE 9.2A - banco de estrategias de ejecucion de Screen Audit.

Mide como conviene ejecutar el analisis semantico de los candidatos que
sobrevivieron al preflight estructural de 9.1. NO decide que texto merece
analisis: eso ya se resolvio, y adivinarlo estaria prohibido.

No modifica produccion. El runtime se usa tal cual esta publicado.
"""
import argparse
import asyncio
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmarks import batch_client as bc  # noqa: E402
from src import config  # noqa: E402

RUNTIME = "http://127.0.0.1:8787/v1/analyze/text"
FIXTURE = ROOT / "benchmarks/screen_fixture.json"


def load_candidates():
    data = json.loads(FIXTURE.read_text())
    frame = data["frameName"]
    items = []
    for candidate in data["candidates"]:
        parent = candidate.get("parentName")
        context = "Pantalla: {}. Capa: {}.".format(frame, candidate["layerName"])
        if parent:
            context += " Contenedor: {}.".format(parent)
        items.append({
            "id": candidate["id"],
            "category": candidate["category"],
            "text": candidate["text"],
            "context": context,
        })
    return items


def stats(samples, label=None):
    if not samples:
        return {}
    ordered = sorted(samples)
    out = {
        "n": len(ordered),
        "p50": round(statistics.median(ordered), 3),
        "min": round(ordered[0], 3),
        "max": round(ordered[-1], 3),
    }
    if len(ordered) >= 20:
        out["p95"] = round(ordered[int(len(ordered) * 0.95) - 1], 3)
    else:
        out["p95_note"] = "n<20: un p95 aqui seria ruido, no dato"
    if label:
        print("  {}: {}".format(label, out), flush=True)
    return out


def rss_mb():
    result = subprocess.run(
        ["lsof", "-nP", "-iTCP:8787", "-sTCP:LISTEN"],
        capture_output=True, text=True)
    lines = result.stdout.strip().splitlines()
    if len(lines) < 2:
        return None
    pid = lines[1].split()[1]
    value = subprocess.run(["ps", "-o", "rss=", "-p", pid],
                           capture_output=True, text=True).stdout.strip()
    return round(int(value) / 1024, 1) if value else None


# =============================================================================
# S0 / S1 - secuencial y secuencial progresiva
# =============================================================================

async def strategy_sequential(client, candidates):
    """
    Una peticion de produccion por candidato.

    S0 y S1 comparten EXACTAMENTE las mismas llamadas: la diferencia esta en
    cuando se muestra cada resultado, no en cuanto se calcula. Por eso se mide
    una sola vez y se derivan ambas.
    """
    started = time.perf_counter()
    completions = []
    results = {}
    failures = 0

    for candidate in candidates:
        try:
            response = await client.post(RUNTIME, json={
                "text": candidate["text"],
                "context": candidate["context"],
                "locale": config.LOCALE,
            }, timeout=120)
            response.raise_for_status()
            results[candidate["id"]] = response.json()
        except Exception:
            failures += 1
        completions.append(time.perf_counter() - started)

    return {"completions": completions, "results": results, "failures": failures}


def sequential_report(completions, sizes):
    """Corta la corrida secuencial en pantallas de distinto tamano."""
    report = {}
    for size in sizes:
        if size > len(completions):
            continue
        window = completions[:size]
        report[str(size)] = {
            "total_seconds": round(window[-1], 3),
            "time_to_first_result": round(window[0], 3),
            "time_to_25pct": round(window[max(0, round(size * 0.25) - 1)], 3),
            "time_to_50pct": round(window[max(0, round(size * 0.50) - 1)], 3),
            "time_to_100pct": round(window[-1], 3),
            "llm_calls_minimum": size,
            "texts_per_second": round(size / window[-1], 3),
            "avg_seconds_per_candidate": round(window[-1] / size, 3),
        }
    return report


# =============================================================================
# S2 - reutilizacion exacta y segura
# =============================================================================

def strategy_reuse(candidates):
    """
    Potencial de reutilizacion REAL sobre la pantalla.

    Identidad conservadora: texto exacto + contexto exacto + locale + version
    de analisis. Sin normalizar y sin similitud semantica.
    """
    text_only = {}
    full_identity = {}

    for candidate in candidates:
        text_only.setdefault(candidate["text"], []).append(candidate["id"])
        key = bc.reuse_key(candidate["text"], candidate["context"])
        full_identity.setdefault(key, []).append(candidate["id"])

    duplicate_texts = sum(len(v) - 1 for v in text_only.values() if len(v) > 1)
    reusable = sum(len(v) - 1 for v in full_identity.values() if len(v) > 1)

    return {
        "candidates": len(candidates),
        "distinct_texts": len(text_only),
        "exact_duplicate_texts": duplicate_texts,
        "distinct_text_plus_context": len(full_identity),
        "reusable_within_screen": reusable,
        "reuse_ratio_within_screen": round(reusable / len(candidates), 4),
        "analysis_version": bc.analysis_version(),
        "note": (
            "duplicate_texts cuenta textos identicos; reusable exige ademas el "
            "mismo contexto. La diferencia entre ambos es exactamente lo que la "
            "identidad conservadora se niega a reutilizar."
        ),
    }


# =============================================================================
# S3 - mini-lotes
# =============================================================================

def check_contamination(inputs, outputs):
    """
    Ataca el aislamiento entre elementos.

    Un elemento no puede llevarse contenido de otro: ni marcadores, ni cifras,
    ni frases. Es el riesgo propio del formato de lote.
    """
    problems = []
    by_id = {item["id"]: item for item in inputs}
    input_ids = [item["id"] for item in inputs]
    output_ids = [item.get("id") for item in outputs]

    if len(outputs) != len(inputs):
        problems.append("conteo: {} entradas, {} salidas".format(
            len(inputs), len(outputs)))
    if len(set(output_ids)) != len(output_ids):
        problems.append("identificadores duplicados en la salida")
    for unexpected in set(output_ids) - set(input_ids):
        problems.append("identificador inventado: {}".format(unexpected))
    for missing in set(input_ids) - set(output_ids):
        problems.append("identificador ausente: {}".format(missing))

    import re
    placeholder_re = re.compile(r"\{\{[^}]*\}\}")

    for out in outputs:
        item_id = out.get("id")
        source = by_id.get(item_id)
        if source is None:
            continue

        blob = " ".join([str(out.get("suggestion", "")), str(out.get("reason", ""))])
        own_placeholders = set(placeholder_re.findall(source["text"]))

        for other in inputs:
            if other["id"] == item_id:
                continue
            # Marcadores de OTRO elemento migrados a este.
            for placeholder in placeholder_re.findall(other["text"]):
                if placeholder in blob and placeholder not in own_placeholders:
                    problems.append("{}: marcador {} migrado desde {}".format(
                        item_id, placeholder, other["id"]))
            # La sugerencia de este elemento es el texto de otro.
            if str(out.get("suggestion", "")).strip() == other["text"].strip():
                problems.append("{}: la sugerencia es el texto de {}".format(
                    item_id, other["id"]))

    return problems


async def strategy_batch(client, candidates, size):
    """Ejecuta la pantalla en lotes de `size` y valida cada elemento."""
    started = time.perf_counter()
    batch_latencies = []
    completions = []
    results = {}
    contamination = []
    invalid_items = 0
    missing_items = 0
    calls = 0

    for index in range(0, len(candidates), size):
        chunk = candidates[index:index + size]
        try:
            raw, elapsed = await bc.analyze_batch(client, chunk)
            calls += 1
        except Exception as exc:
            invalid_items += len(chunk)
            completions.extend([time.perf_counter() - started] * len(chunk))
            contamination.append("lote fallido: {}".format(type(exc).__name__))
            continue

        batch_latencies.append(elapsed)
        outputs = raw.get("items", [])
        contamination.extend(check_contamination(chunk, outputs))

        by_id = {o.get("id"): o for o in outputs if isinstance(o, dict)}
        now = time.perf_counter() - started

        for candidate in chunk:
            model_out = by_id.get(candidate["id"])
            if model_out is None:
                missing_items += 1
                completions.append(now)
                continue
            try:
                final, _tel = bc.finalize(
                    candidate["text"], candidate["context"], model_out)
                results[candidate["id"]] = final
            except Exception:
                invalid_items += 1
            completions.append(now)

    total = time.perf_counter() - started

    return {
        "batch_size": size,
        "llm_calls": calls,
        "total_seconds": round(total, 3),
        "time_to_first_result": round(completions[0], 3) if completions else None,
        "batch_latency": stats(batch_latencies),
        "texts_per_second": round(len(candidates) / total, 3),
        "avg_seconds_per_candidate": round(total / len(candidates), 3),
        "contamination_problems": contamination,
        "missing_items": missing_items,
        "invalid_items": invalid_items,
        "results": results,
    }


# =============================================================================
# Comparacion de calidad: individual contra lote
# =============================================================================

CRITICAL_KEYS = ("text", "orthography", "jargon")


def compare_quality(single_results, batch_results, candidates):
    """
    Compara el veredicto FINAL de cada estrategia.
    No se exige redaccion identica: el modelo genera. Se exige que las
    garantias no cambien.
    """
    compared = 0
    critical_failures = []
    score_deltas = []
    metric_deltas = {"clarity": [], "concision": [], "utility": [], "predictability": []}
    orthography_agreement = 0
    jargon_agreement = 0
    issue_category_agreement = 0
    noop_agreement = 0

    for candidate in candidates:
        single = single_results.get(candidate["id"])
        batch = batch_results.get(candidate["id"])
        if single is None or batch is None:
            continue
        compared += 1

        # --- garantias que NO pueden cambiar ---
        if batch["text"] != candidate["text"]:
            critical_failures.append(
                "{}: el lote altero el texto de origen".format(candidate["id"]))
        if batch["orthography"] != single["orthography"]:
            critical_failures.append(
                "{}: ortografia divergente".format(candidate["id"]))
        else:
            orthography_agreement += 1
        if batch["jargon"] != single["jargon"]:
            critical_failures.append("{}: jerga divergente".format(candidate["id"]))
        else:
            jargon_agreement += 1

        single_cats = sorted(i["category"] for i in single.get("issues", []))
        batch_cats = sorted(i["category"] for i in batch.get("issues", []))
        if single_cats == batch_cats:
            issue_category_agreement += 1
        else:
            critical_failures.append(
                "{}: categorias de hallazgo divergentes".format(candidate["id"]))

        single_noop = single["suggestion"] == single["text"]
        batch_noop = batch["suggestion"] == batch["text"]
        if single_noop == batch_noop:
            noop_agreement += 1

        score_deltas.append(abs(batch["score"] - single["score"]))
        for key in metric_deltas:
            metric_deltas[key].append(abs(batch[key] - single[key]))

    return {
        "compared": compared,
        "critical_failures": critical_failures,
        "critical_failure_count": len(critical_failures),
        "score_delta_mean": round(statistics.mean(score_deltas), 2) if score_deltas else None,
        "score_delta_max": max(score_deltas) if score_deltas else None,
        "metric_delta_mean": {
            k: round(statistics.mean(v), 2) for k, v in metric_deltas.items() if v
        },
        "orthography_agreement": "{}/{}".format(orthography_agreement, compared),
        "jargon_agreement": "{}/{}".format(jargon_agreement, compared),
        "issue_category_agreement": "{}/{}".format(issue_category_agreement, compared),
        "noop_agreement": "{}/{}".format(noop_agreement, compared),
    }


# =============================================================================
# Concurrencia controlada
# =============================================================================

async def strategy_concurrent(client, candidates, workers):
    started = time.perf_counter()
    queue = asyncio.Queue()
    for candidate in candidates:
        queue.put_nowait(candidate)
    completions = []

    async def worker():
        while True:
            try:
                candidate = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                await client.post(RUNTIME, json={
                    "text": candidate["text"],
                    "context": candidate["context"],
                    "locale": config.LOCALE,
                }, timeout=180)
            except Exception:
                pass
            completions.append(time.perf_counter() - started)

    await asyncio.gather(*[worker() for _ in range(workers)])
    total = time.perf_counter() - started

    return {
        "workers": workers,
        "candidates": len(candidates),
        "total_seconds": round(total, 3),
        "time_to_first_result": round(min(completions), 3) if completions else None,
        "texts_per_second": round(len(candidates) / total, 3),
        "rss_mb": rss_mb(),
    }


# =============================================================================
# Caracterizacion de fallos de lote (sin modelo)
# =============================================================================

def failure_characterization(candidates):
    """Somete al validador de aislamiento salidas deliberadamente rotas."""
    chunk = candidates[:3]
    cases = {}

    def outputs_for(ids):
        return [{"id": i, "clarity": 4, "concision": 4, "utility": 4,
                 "predictability": 4, "jargon": False, "reason": "ok",
                 "suggestion": "texto"} for i in ids]

    ids = [c["id"] for c in chunk]

    cases["elemento_ausente"] = check_contamination(chunk, outputs_for(ids[:2]))
    cases["identificador_duplicado"] = check_contamination(
        chunk, outputs_for([ids[0], ids[0], ids[1]]))
    cases["identificador_inventado"] = check_contamination(
        chunk, outputs_for([ids[0], ids[1], "inventado"]))
    cases["elemento_de_mas"] = check_contamination(
        chunk, outputs_for(ids + ["extra"]))

    migrated = outputs_for(ids)
    migrated[0]["suggestion"] = chunk[1]["text"]
    cases["sugerencia_migrada"] = check_contamination(chunk, migrated)

    return {k: {"detected": len(v) > 0, "problems": v} for k, v in cases.items()}


# =============================================================================

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-sizes", default="1,2,4,6")
    args = parser.parse_args()

    candidates = load_candidates()
    report = {
        "model": config.MODEL,
        "candidates": len(candidates),
        "analysis_version": bc.analysis_version(),
    }

    print("=== FASE 9.2A - banco de estrategias ===", flush=True)
    print("candidatos: {}".format(len(candidates)), flush=True)

    async with httpx.AsyncClient() as client:
        # Calentamiento: que el modelo este residente antes de medir.
        await client.post(RUNTIME, json={
            "text": "Continuar", "context": "", "locale": config.LOCALE,
        }, timeout=120)

        print("\n[1/6] S0/S1 - secuencial", flush=True)
        rss_before = rss_mb()
        sequential = await strategy_sequential(client, candidates)
        report["s0_sequential"] = sequential_report(
            sequential["completions"], [5, 10, 15, 20])
        report["s0_failures"] = sequential["failures"]
        report["s0_rss_mb"] = {"before": rss_before, "after": rss_mb()}
        for size, data in report["s0_sequential"].items():
            print("  {} candidatos: total {}s  TTFR {}s".format(
                size, data["total_seconds"], data["time_to_first_result"]), flush=True)

        print("\n[2/6] S2 - reutilizacion exacta", flush=True)
        report["s2_reuse"] = strategy_reuse(candidates)
        print("  {}".format({k: v for k, v in report["s2_reuse"].items()
                             if k != "note"}), flush=True)

        print("\n[3/6] S3 - mini-lotes", flush=True)
        report["s3_batch"] = {}
        report["quality_single_vs_batch"] = {}
        for size in [int(s) for s in args.batch_sizes.split(",")]:
            print("  lote de {}...".format(size), flush=True)
            result = await strategy_batch(client, candidates, size)
            batch_results = result.pop("results")
            report["s3_batch"][str(size)] = result
            report["quality_single_vs_batch"][str(size)] = compare_quality(
                sequential["results"], batch_results, candidates)
            print("    total {}s  llamadas {}  TTFR {}s  contaminacion {}".format(
                result["total_seconds"], result["llm_calls"],
                result["time_to_first_result"],
                len(result["contamination_problems"])), flush=True)
            print("    criticos: {}".format(
                report["quality_single_vs_batch"][str(size)]["critical_failure_count"]),
                flush=True)

        print("\n[4/6] Concurrencia", flush=True)
        report["concurrency"] = {}
        subset = candidates[:6]
        for workers in [1, 2]:
            result = await strategy_concurrent(client, subset, workers)
            report["concurrency"][str(workers)] = result
            print("  {} trabajador(es): {}s  {} textos/s  rss {} MB".format(
                workers, result["total_seconds"], result["texts_per_second"],
                result["rss_mb"]), flush=True)

    print("\n[5/6] Caracterizacion de fallos de lote", flush=True)
    report["failure_characterization"] = failure_characterization(candidates)
    for name, data in report["failure_characterization"].items():
        print("  {}: detectado={}".format(name, data["detected"]), flush=True)

    print("\n[6/6] Escribiendo informe", flush=True)
    out = ROOT / "reports/phase-9-2a-raw.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print("=== listo -> {} ===".format(out), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
