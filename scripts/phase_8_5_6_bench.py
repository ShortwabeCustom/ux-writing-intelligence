"""
Banco de medición de FASE 8.5.6 — rendimiento y fiabilidad.

No modifica el runtime ni el modelo. Solo mide.

FRÍO se establece descargando el modelo de memoria con `ollama stop`, que NO
lo desinstala, y reiniciando el proceso del runtime. No se toca ninguna otra
caché del sistema.
"""
import json
import statistics
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:8787"
MODEL = "qwen3.5:4b"
HEAD = {"Content-Type": "application/json"}
CONTEXT = "Texto de interfaz seleccionado en Figma"

report: dict = {}


def http(path: str, payload=None, timeout=120):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, headers=HEAD,
        method="POST" if payload is not None else "GET",
    )
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read())
    return time.perf_counter() - started, body


def analyze(text: str, timeout=120):
    return http("/v1/analyze/text",
                {"text": text, "locale": "es-MX", "context": CONTEXT},
                timeout=timeout)


def stats(samples, label):
    if not samples:
        return {}
    ordered = sorted(samples)
    out = {
        "n": len(ordered),
        "p50": round(statistics.median(ordered), 3),
        "min": round(ordered[0], 3),
        "max": round(ordered[-1], 3),
    }
    # Con n pequeño un p95 es ruido disfrazado de dato: no se publica.
    if len(ordered) >= 20:
        out["p95"] = round(ordered[int(len(ordered) * 0.95) - 1], 3)
    print(f"  {label}: {out}", flush=True)
    return out


def runtime_pid():
    result = subprocess.run(
        ["lsof", "-nP", "-iTCP:8787", "-sTCP:LISTEN"],
        capture_output=True, text=True,
    )
    lines = result.stdout.strip().splitlines()
    return int(lines[1].split()[1]) if len(lines) > 1 else None


def stop_runtime():
    pid = runtime_pid()
    if pid is None:
        return
    subprocess.run(["kill", str(pid)], check=False)
    for _ in range(60):
        if runtime_pid() is None:
            return
        time.sleep(0.1)


def start_runtime():
    """Arranca el runtime y devuelve los segundos hasta que /health responde."""
    started = time.perf_counter()
    subprocess.Popen(
        [str(ROOT / ".venv/bin/uvicorn"), "src.main:app",
         "--host", "127.0.0.1", "--port", "8787", "--log-level", "warning"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    while time.perf_counter() - started < 30:
        try:
            urllib.request.urlopen(BASE + "/health", timeout=1).read()
            return time.perf_counter() - started
        except Exception:
            time.sleep(0.05)
    raise RuntimeError("el runtime no respondió en 30 s")


def unload_model():
    subprocess.run(["ollama", "stop", MODEL], check=False,
                   capture_output=True)
    time.sleep(1)


def model_resident() -> bool:
    result = subprocess.run(["ollama", "ps"], capture_output=True, text=True)
    return MODEL in result.stdout


def runtime_rss_mb():
    pid = runtime_pid()
    if pid is None:
        return None
    result = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)],
                            capture_output=True, text=True)
    value = result.stdout.strip()
    return round(int(value) / 1024, 1) if value else None


# --- textos distintos, para no medir la caché de prompt --------------------
SHORT = [
    "Continuar", "Guardar cambios", "Enviar solicitud", "Cancelar pago",
    "Ver detalles", "Confirmar cita", "Actualizar datos", "Cerrar sesion",
    "Aceptar terminos", "Buscar sucursal", "Descargar estado",
    "Agregar tarjeta", "Editar perfil", "Reintentar operacion",
    "Solicitar credito", "Bloquear tarjeta", "Cambiar contrasena",
    "Activar notificaciones", "Consultar saldo", "Programar pago",
]
MEDIUM = [
    "Tu pago fue programado para el proximo martes.",
    "Revisamos tu solicitud y necesitamos un documento adicional.",
    "La transferencia se aplicara en un plazo de dos dias habiles.",
    "Tu tarjeta quedo bloqueada por seguridad tras varios intentos.",
    "Actualiza tu numero de telefono para recibir avisos importantes.",
    "El comprobante se envio al correo registrado en tu cuenta.",
    "Tu cita quedo agendada y recibiras un recordatorio un dia antes.",
    "No pudimos validar el documento porque la imagen esta borrosa.",
    "Tu saldo disponible se actualiza cada hora durante el dia.",
    "Cambiamos el diseno de esta seccion para que encuentres todo mas rapido.",
]
LONG = [
    "Tu visita fue confirmada para la fecha acordada.\n\nNo olvides tener a "
    "la mano tu identificacion oficial y un comprobante de domicilio "
    "reciente.\n\nTe avisaremos cuando el asesor este en camino.",
    "Recibimos tu solicitud de credito y comenzamos la revision.\n\nDurante "
    "los proximos dias podriamos pedirte documentos adicionales para "
    "completar el expediente.\n\nTe notificaremos por correo en cuanto haya "
    "una resolucion.",
    "Detectamos un movimiento inusual en tu cuenta.\n\nPor seguridad "
    "suspendimos temporalmente las operaciones en linea mientras "
    "verificamos la actividad.\n\nUn asesor se comunicara contigo para "
    "confirmar los cargos.",
    "Tu contrato quedo firmado y registrado correctamente.\n\nPuedes "
    "consultar una copia desde la seccion de documentos cuando lo "
    "necesites.\n\nGuardamos el archivo mientras tu cuenta siga activa.",
    "Actualizamos las condiciones del servicio que tienes contratado.\n\nLos "
    "cambios entran en vigor el proximo periodo de facturacion y no "
    "modifican el precio actual.\n\nPuedes revisar el detalle completo en "
    "tu perfil.",
]
# Textos con errores deliberados: fuerzan trabajo determinista y, a veces,
# regeneracion semantica.
REGENERATION = [
    "prestamo",
    "¿Como funciona?",
    "Ingresa tus credenciales",
    "No se pudo completar la operacion, intentelo de nuevo mas tarde",
    "Da click en el boton para continuar con tu solicitud de credito",
]

print("=== FASE 8.5.6 — banco de medición ===", flush=True)

# --- STEP 44 — arranque del runtime ---------------------------------------
print("\n[1/6] Arranque del runtime", flush=True)
startups = []
for index in range(5):
    stop_runtime()
    startups.append(start_runtime())
    print(f"  arranque {index + 1}: {startups[-1]:.3f}s", flush=True)
report["runtime_startup_seconds"] = stats(startups, "arranque")

# --- STEP 45 — parada y rearranque repetidos ------------------------------
print("\n[2/6] Parada / arranque repetidos", flush=True)
shutdown_clean = True
for index in range(3):
    stop_runtime()
    if runtime_pid() is not None:
        shutdown_clean = False
    start_runtime()
    if runtime_pid() is None:
        shutdown_clean = False
listeners = subprocess.run(
    ["lsof", "-nP", "-iTCP:8787", "-sTCP:LISTEN"],
    capture_output=True, text=True).stdout.strip().splitlines()
report["shutdown"] = {
    "clean_port_release": shutdown_clean,
    "listeners_after_cycles": max(0, len(listeners) - 1),
}
print(f"  {report['shutdown']}", flush=True)

# --- STEP 6 — frío --------------------------------------------------------
print("\n[3/6] Arranque en frío", flush=True)
cold_total, cold_startup, cold_load = [], [], []
for index in range(5):
    unload_model()
    stop_runtime()
    cold_startup.append(start_runtime())
    assert not model_resident(), "el modelo seguía residente: la corrida no era fría"
    duration, body = analyze(SHORT[index], timeout=180)
    cold_total.append(duration)
    cold_load.append(body.get("_debug_load_seconds"))
    print(f"  frío {index + 1}: {duration:.3f}s", flush=True)
report["cold"] = {
    "definition": "modelo descargado de memoria con `ollama stop` + proceso del runtime reiniciado",
    "analysis_seconds": stats(cold_total, "análisis frío"),
    "startup_seconds": stats(cold_startup, "arranque frío"),
}

# --- STEP 7 — caliente ----------------------------------------------------
print("\n[4/6] Caliente", flush=True)
analyze(SHORT[0])  # asegura modelo residente
warm_short = [analyze(t)[0] for t in SHORT]
report["warm_short"] = stats(warm_short, "corto")
warm_medium = [analyze(t)[0] for t in MEDIUM]
report["warm_medium"] = stats(warm_medium, "medio")
warm_long = [analyze(t)[0] for t in LONG]
report["warm_long"] = stats(warm_long, "largo")

# --- STEP 8 — regeneración ------------------------------------------------
print("\n[5/6] Regeneración semántica", flush=True)
regen_times, regen_calls = [], []
for text in REGENERATION:
    duration, body = analyze(text)
    regen_times.append(duration)
    print(f"  {duration:.3f}s  score={body.get('score')}", flush=True)
report["regeneration"] = stats(regen_times, "regeneración")

# --- STEP 9 — keep_alive --------------------------------------------------
print("\n[6/6] keep_alive y soak", flush=True)
keep_alive = {"resident_after_analysis": model_resident()}
time.sleep(20)
keep_alive["resident_after_20s_idle"] = model_resident()
duration, _ = analyze("Confirmar operacion")
keep_alive["reanalysis_after_idle_seconds"] = round(duration, 3)
keep_alive["resident_after_reanalysis"] = model_resident()
report["keep_alive"] = keep_alive
print(f"  {keep_alive}", flush=True)

# --- STEP 10/11 — memoria y soak -----------------------------------------
soak_texts = SHORT + MEDIUM + LONG
samples, failures = [], 0
rss_series = [runtime_rss_mb()]
for index in range(50):
    try:
        duration, _ = analyze(soak_texts[index % len(soak_texts)])
        samples.append(duration)
    except Exception:
        failures += 1
    if (index + 1) % 10 == 0:
        rss_series.append(runtime_rss_mb())
        print(f"  soak {index + 1}/50  rss={rss_series[-1]} MB", flush=True)
report["soak"] = {
    "requests": 50,
    "failures": failures,
    "latency": stats(samples, "soak"),
    "runtime_rss_mb_series": rss_series,
    "runtime_rss_growth_mb": round((rss_series[-1] or 0) - (rss_series[0] or 0), 1),
}

out = ROOT / "reports/phase-8-5-6-raw.json"
out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(f"\n=== listo -> {out} ===", flush=True)
