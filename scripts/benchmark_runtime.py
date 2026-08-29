#!/usr/bin/env python3
"""
Smoke de rendimiento del runtime HTTP (STEP 40).

Mide el sobrecosto del runtime frente a la medición directa contra Ollama de
FASE 8.5.2 (qwen3.5:4b warm p50 4.861 s, p95 8.109 s).
"""
import argparse
import json
import statistics
import sys
import time
import urllib.request

SHORT = [
    # 20 textos cortos DISTINTOS. No se repiten a propósito: reenviar el mismo
    # texto aprovecharía la caché de prompt de Ollama y daría un p50 optimista.
    "Continuar", "prestamo", "¿Como funciona?", "hola ,María", "no  fue posible",
    "Ingresa tus credenciales", "Tu visita ha sido agendada.", "Este campo es opcional.",
    "Consulta tu solicitud.", "Hubo un problema al guardar.", "Reintentar",
    "Tu solicitud quedó registrada.", "Guardamos tus cambios.", "Puedes usar tu préstamo inicial.",
    "El monto mínimo es de 3,000 pesos.", "Revisa el monto antes de continuar.",
    "Tu incremento fue rechazado.", "No compartas tu contraseña con nadie.",
    "Recibimos tu documentación.", "Programaremos tu visita en los próximos días.",
]
LONG = [
    "Hola María, seguimos contigo. 👋\n\nEsta vez no fue posible aprobar el incremento porque "
    "no se cumplieron todos los requisitos.\n\nSin embargo, aún puedes usar tu préstamo inicial "
    "desde tu App Banco Azteca.",
    "Tu visita domiciliaria está programada.\n\nUn asesor acudirá al domicilio que registraste. "
    "Ten a la mano tu identificación oficial vigente y un comprobante de domicilio con antigüedad "
    "no mayor a tres meses.\n\nSi no hay errores en tus datos, el proceso tarda alrededor de 20 minutos.",
    "Escribe el monto que quieres solicitar.\n\nEl monto mínimo es de 3,000 pesos y el máximo "
    "depende de tu historial de pagos con nosotros.\n\nEste dato no afecta tu historial crediticio.",
    "No pudimos aprobar tu solicitud en esta ocasión.\n\nTu historial con nosotros sigue activo y "
    "tu préstamo actual no cambia.\n\nPuedes volver a solicitar un incremento dentro de 60 días.",
    "Hola {{name}}, tu visita domiciliaria quedó agendada para el {{date}} a las {{time}}.\n\n"
    "Si necesitas cambiarla, escríbenos a soporte@bancoazteca.com.mx antes del {{date}}.",
]


def post(base, text):
    req = urllib.request.Request(
        base + "/v1/analyze/text",
        data=json.dumps({"text": text, "context": "", "locale": "es-MX"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=90) as r:
        body = json.loads(r.read().decode())
    return time.perf_counter() - t0, body


def stats(vals):
    v = sorted(vals)
    n = len(v)
    out = {"n": n, "mean": round(statistics.fmean(v), 3), "p50": round(statistics.median(v), 3),
           "min": round(v[0], 3), "max": round(v[-1], 3)}
    out["p95"] = round(v[min(n - 1, int(round(0.95 * (n - 1))))], 3)
    out["p95_basis"] = ("percentil empírico" if n >= 20
                        else f"percentil sobre muestra pequeña (n={n}); indicativo, no robusto")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8787")
    ap.add_argument("--out")
    a = ap.parse_args()

    post(a.base, "Continuar")  # precalentamiento, no se mide

    result = {}
    for label, corpus in (("short", SHORT), ("long", LONG)):
        walls = []
        for t in corpus:
            w, _ = post(a.base, t)
            walls.append(w)
            print(f"  [{label}] {w:6.3f}s  {t[:40]!r}")
        result[label] = stats(walls)
        print(f"  -> {label}: p50={result[label]['p50']}s p95={result[label]['p95']}s n={result[label]['n']}\n")

    result["reference_8_5_2_direct_ollama"] = {"warm_p50": 4.861, "warm_p95": 8.109}
    result["note"] = ("La comparación contra 8.5.2 no aísla el sobrecosto del runtime: "
                      "la máquina derivó entre ambas mediciones. El sobrecosto limpio se "
                      "mide con orden alternado en overhead-interleaved.json.")

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if a.out:
        with open(a.out, "w") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
