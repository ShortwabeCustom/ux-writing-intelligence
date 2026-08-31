#!/usr/bin/env python3
"""
Verificador para el smoke manual en Figma Desktop (STEP 38).

Muestra, en vivo, cada análisis que llega al runtime local. NO imprime el texto
de la persona usuaria: el runtime solo registra métricas y banderas.

Uso:
    .venv/bin/python scripts/watch_plugin_requests.py /tmp/uxw-runtime.log
"""
import json
import sys
import time

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/uxw-runtime.log"
print(f"Observando {path} — abre el plugin en Figma y pulsa «Analizar texto».")
print(f"{'ms':>8} {'llamadas':>8} {'regen':>6} {'noop':>5} {'fallback':>9} {'score':>6} {'chars':>6}")

with open(path) as f:
    f.seek(0, 2)
    while True:
        line = f.readline()
        if not line:
            time.sleep(0.4)
            continue
        i = line.find("{")
        if i < 0:
            continue
        try:
            d = json.loads(line[i:])
        except Exception:
            continue
        if d.get("event") == "analysis_ok":
            print(f"{d.get('analysis_duration_ms', 0):>8} {d.get('ollama_call_count', 0):>8} "
                  f"{str(d.get('semantic_regeneration_used'))[:1]:>6} "
                  f"{str(d.get('high_quality_noop'))[:1]:>5} "
                  f"{str(d.get('fallback_suggestion_used'))[:1]:>9} "
                  f"{d.get('score', 0):>6} {d.get('text_length', 0):>6}")
        elif d.get("event") == "analysis_error":
            print(f"  ERROR  {d.get('error_code')}  (HTTP {d.get('status')})")
