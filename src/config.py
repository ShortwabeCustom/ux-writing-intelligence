"""
Configuración del runtime local.

Los valores por defecto SON la arquitectura local aprobada en FASE 8.5.2.
Las variables de entorno permiten ajustarlos en desarrollo, pero un default
inseguro nunca es aceptable: HOST no se lee del entorno para que sea imposible
exponer el runtime por descuido.
"""
import os

VERSION = "8.5.3"
SERVICE_NAME = "ux-writing-local-runtime"

# --- Red ---------------------------------------------------------------------
# HOST es CONSTANTE a propósito. No se lee del entorno.
# Bindear a 0.0.0.0 expondría el runtime a la LAN, y el modelo de seguridad
# de esta fase (STEP 4) es exactamente "solo loopback, sin autenticación".
HOST = "127.0.0.1"
PORT = int(os.getenv("UXW_PORT", "8787"))

# --- Ollama ------------------------------------------------------------------
OLLAMA_BASE = os.getenv("UXW_OLLAMA_BASE", "http://127.0.0.1:11434")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE}/api/chat"
OLLAMA_TAGS_URL = f"{OLLAMA_BASE}/api/tags"

# --- Modelo (FASE 8.5.2: selección explícita, sin sustitución silenciosa) -----
MODEL = os.getenv("UXW_MODEL", "qwen3.5:4b")
KEEP_ALIVE = os.getenv("UXW_KEEP_ALIVE", "30m")
TEMPERATURE = 0
SEED = 42
NUM_CTX = 4096

# --- Locale ------------------------------------------------------------------
LOCALE = "es-MX"
SUPPORTED_LOCALES = frozenset({"es-MX"})

# --- Presupuesto de llamadas (STEP 23) ---------------------------------------
MAX_OLLAMA_CALLS = 2          # 1 normal + como máximo 1 adicional
MAX_STRUCTURED_RETRIES = 1    # STEP 24
MAX_SEMANTIC_REGENERATIONS = 1  # STEP 25

# --- Timeouts (STEP 26) ------------------------------------------------------
# Evidencia 8.5.2 para qwen3.5:4b: warm p50 4.861 s, warm p95 8.109 s,
# max observado 9.833 s, cold p50 7.362 s. 30 s deja ~3x de margen sobre el
# peor caso warm y cubre un arranque en frío sin sacrificar la detección de
# un cuelgue real.
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("UXW_OLLAMA_TIMEOUT", "30"))
OLLAMA_PROBE_TIMEOUT_SECONDS = 2.0  # /health y /status nunca deben tardar

# --- Límites de entrada ------------------------------------------------------
MAX_TEXT_CHARS = 5000
MAX_CONTEXT_CHARS = 2000

# --- CORS (FASE 8.5.4) -------------------------------------------------------
# El plugin de Figma ya consume este runtime, así que se habilitan los orígenes
# estrictamente necesarios y ninguno más.
#
# "null" es el origen que envía un iframe con sandbox, que es como Figma
# ejecuta la UI de un plugin. Los dos dominios de figma.com cubren el editor.
#
# NO se usa "*". Y CORS **no es autenticación**: es una política del navegador,
# no un control de acceso. Lo que realmente aísla este runtime es el binding a
# loopback — ningún equipo de la red puede alcanzarlo, con o sin CORS.
#
# Riesgo residual conocido y aceptado: una página abierta en el navegador de la
# persona usuaria cuyo origen esté en esta lista podría enviar peticiones al
# runtime y consumir CPU local. No hay fuga de datos (el atacante solo analiza
# su propio texto), pero queda documentado en docs/local-transport.md.
#
# UXW_CORS_ORIGINS permite ajustar la lista si Figma Desktop enviara un origen
# distinto al esperado, sin tener que recompilar.
CORS_ALLOW_ORIGINS: list[str] = [
    o.strip() for o in os.getenv(
        "UXW_CORS_ORIGINS", "null,https://www.figma.com,https://figma.com"
    ).split(",") if o.strip()
]
CORS_ALLOW_METHODS = ["GET", "POST", "OPTIONS"]
CORS_ALLOW_HEADERS = ["Content-Type"]
